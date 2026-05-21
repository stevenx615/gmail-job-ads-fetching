import {
  collection,
  getDocs,
  getDoc,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  serverTimestamp,
  onSnapshot,
  deleteField,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Job, JobBadges, NewJob, ApplicationStage } from '../types';

const COLLECTION_NAME = 'jobs';

// In-memory cache to avoid redundant Firestore reads
let jobsCache: Job[] | null = null;

// Stable order cache in localStorage
const ORDER_CACHE_KEY = 'jobs_stable_order';

// Persistent cache: survives page refresh, stored in IndexedDB (no size limit)
const JOBS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const IDB_NAME = 'job-board';
const IDB_JOBS_STORE = 'cached-jobs';
const IDB_META_STORE = 'meta';
const IDB_VERSION = 2; // bump to wipe cache when schema changes

type CachedJob = Omit<Job, 'createdAt'>;

let _idbPromise: Promise<IDBDatabase> | null = null;

function getIDB(): Promise<IDBDatabase> {
  if (!_idbPromise) {
    _idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        // Drop and recreate stores on every version bump to wipe stale cache
        if (db.objectStoreNames.contains(IDB_JOBS_STORE)) db.deleteObjectStore(IDB_JOBS_STORE);
        if (db.objectStoreNames.contains(IDB_META_STORE)) db.deleteObjectStore(IDB_META_STORE);
        db.createObjectStore(IDB_JOBS_STORE, { keyPath: 'id' });
        db.createObjectStore(IDB_META_STORE);
      };
      req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
      req.onerror = () => { _idbPromise = null; reject(req.error); };
    });
  }
  return _idbPromise;
}

async function loadPersistentCache(): Promise<CachedJob[] | null> {
  try {
    const db = await getIDB();
    return await new Promise<CachedJob[] | null>((resolve) => {
      const tx = db.transaction([IDB_JOBS_STORE, IDB_META_STORE], 'readonly');
      const metaReq = tx.objectStore(IDB_META_STORE).get('cachedAt');
      metaReq.onsuccess = () => {
        const cachedAt = metaReq.result as number | undefined;
        if (!cachedAt || Date.now() - cachedAt > JOBS_CACHE_TTL) { resolve(null); return; }
        const jobsReq = tx.objectStore(IDB_JOBS_STORE).getAll();
        jobsReq.onsuccess = () => resolve(jobsReq.result as CachedJob[]);
        jobsReq.onerror = () => resolve(null);
      };
      metaReq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function savePersistentCache(jobs: Job[]): Promise<void> {
  try {
    const db = await getIDB();
    // Exclude createdAt (Date object — not JSON-serializable, not needed client-side)
    const slim: CachedJob[] = jobs.map(({ createdAt: _c, ...rest }) => rest);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([IDB_JOBS_STORE, IDB_META_STORE], 'readwrite');
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      const store = tx.objectStore(IDB_JOBS_STORE);
      store.clear();
      for (const job of slim) store.add(job);
      tx.objectStore(IDB_META_STORE).put(Date.now(), 'cachedAt');
    });
  } catch (e) {
    console.warn('[jobService] Failed to persist jobs cache:', e);
  }
}

function clearPersistentCache(): void {
  // Fire-and-forget: clears IDB before any subsequent page load can read it
  getIDB().then(db => {
    const tx = db.transaction([IDB_JOBS_STORE, IDB_META_STORE], 'readwrite');
    tx.objectStore(IDB_JOBS_STORE).clear();
    tx.objectStore(IDB_META_STORE).delete('cachedAt');
  }).catch(() => { /* ignore */ });
}

function getStableOrder(): string[] {
  try {
    const stored = localStorage.getItem(ORDER_CACHE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function setStableOrder(ids: string[]): void {
  try {
    localStorage.setItem(ORDER_CACHE_KEY, JSON.stringify(ids));
  } catch (e) {
    console.warn('[jobService] Failed to save stable order to localStorage:', e);
  }
}

function applyStableOrder(jobs: Job[]): Job[] {
  const stableOrder = getStableOrder();
  if (stableOrder.length === 0) return jobs;

  const orderMap = new Map(stableOrder.map((id, index) => [id, index]));
  return [...jobs].sort((a, b) => {
    const aIndex = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
}

/**
 * Fetches all jobs from Firestore, ordered by creation date (newest first).
 * Uses in-memory cache to avoid redundant reads unless forced to refresh.
 * Normalizes source and type fields to lowercase for consistent filtering.
 * @param forceRefresh - If true, bypasses cache and re-fetches from Firestore
 * @returns Array of all jobs with normalized fields
 */
export async function getAllJobs(forceRefresh = false): Promise<Job[]> {
  // 1. In-memory cache (fastest — same session)
  if (jobsCache && !forceRefresh) {
    return jobsCache;
  }

  // 2. IndexedDB cache (fast — survives page refresh, no size limit)
  if (!forceRefresh) {
    const cached = await loadPersistentCache();
    if (cached) {
      jobsCache = cached as Job[]; // description is undefined, which is expected
      return jobsCache;
    }
  }

  // 3. Firestore fetch
  const jobsCollection = collection(db, COLLECTION_NAME);
  const q = query(jobsCollection, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  const fetchedJobs = snapshot.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title || '',
      company: data.company || '',
      location: data.location || '',
      url: truncateUrl(data.url || ''),
      source: (data.source || 'generic').toLowerCase() as Job['source'],
      type: (data.type || '').toLowerCase(),
      tags: data.tags || [],
      saved: data.saved || false,
      applied: data.applied || false,
      read: data.read || false,
      description: data.description || undefined,
      badges: data.badges || undefined,
      applicationStage: data.applicationStage as ApplicationStage | undefined,
      stageDate: data.stageDate ?? undefined,
      notes: data.notes ?? undefined,
      followUpDate: data.followUpDate ?? undefined,
      emailId: data.emailId,
      dateReceived: data.dateReceived?.toDate ? data.dateReceived.toDate().toISOString() : (data.dateReceived || new Date().toISOString()),
      createdAt: data.createdAt?.toDate?.() || new Date(),
    };
  }) as Job[];

  // Apply stable order from localStorage, or save current order if none exists
  const stableOrder = getStableOrder();

  if (stableOrder.length === 0 || stableOrder.length !== fetchedJobs.length) {
    setStableOrder(fetchedJobs.map(j => j.id));
    jobsCache = fetchedJobs;
  } else {
    jobsCache = applyStableOrder(fetchedJobs);
  }

  // Persist to IndexedDB so next page load skips the Firestore round-trip
  await savePersistentCache(jobsCache);

  return jobsCache;
}

/**
 * Fetches unread jobs from Firestore, filtered client-side.
 * Uses cached data when available for consistent ordering.
 * @returns Array of unread jobs with normalized fields, or empty array on error
 */
export async function getUnreadJobs(): Promise<Job[]> {
  try {
    const allJobs = await getAllJobs();
    return allJobs.filter(job => !job.read);
  } catch (error) {
    console.error('Error fetching unread jobs:', error);
    return [];
  }
}

/**
 * Fetches read jobs from Firestore, filtered client-side.
 * Uses cached data when available for consistent ordering.
 * @returns Array of read jobs with normalized fields, or empty array on error
 */
export async function getReadJobs(): Promise<Job[]> {
  try {
    const allJobs = await getAllJobs();
    return allJobs.filter(job => job.read);
  } catch (error) {
    console.error('Error fetching read jobs:', error);
    return [];
  }
}

/**
 * Subscribe to real-time Firestore updates.
 * Calls onUpdate with the changed job's id and updated fields
 * whenever a document in the jobs collection is modified.
 * Returns an unsubscribe function.
 */
export function onJobsChanged(onUpdate: (jobId: string, data: Partial<Job>) => void): () => void {
  const jobsCollection = collection(db, COLLECTION_NAME);
  const q = query(jobsCollection, orderBy('createdAt', 'desc'));

  return onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'modified') {
        const data = change.doc.data();
        onUpdate(change.doc.id, {
          description: data.description || undefined,
          title: data.title || '',
          company: data.company || '',
          saved: data.saved || false,
          applied: data.applied || false,
          read: data.read || false,
          badges: data.badges || undefined,
          applicationStage: data.applicationStage as ApplicationStage | undefined,
          stageDate: data.stageDate ?? undefined,
          notes: data.notes ?? undefined,
          followUpDate: data.followUpDate ?? undefined,
        });
      }
    });
  });
}

export function watchJobDescription(jobId: string, onDescription: (description: string) => void): () => void {
  const jobDoc = doc(db, COLLECTION_NAME, jobId);
  return onSnapshot(jobDoc, (snap) => {
    const description = snap.data()?.description;
    if (description) onDescription(description);
  });
}

export async function fetchMissingDescriptions(jobIds: string[]): Promise<Map<string, string>> {
  const snaps = await Promise.all(jobIds.map(id => getDoc(doc(db, COLLECTION_NAME, id))));
  const result = new Map<string, string>();
  snaps.forEach((snap, i) => {
    const desc = snap.data()?.description;
    if (desc) result.set(jobIds[i], desc);
  });
  return result;
}

/**
 * Patches a freshly-scraped description into both the in-memory cache and the
 * IDB persistent cache so the next page refresh doesn't lose it.
 */
export function updateCachedDescription(jobId: string, description: string): void {
  if (jobsCache) {
    jobsCache = jobsCache.map(j => j.id === jobId ? { ...j, description } : j);
  }
  // Targeted IDB update — read the stored record, set description, put it back
  getIDB().then(db => {
    const tx = db.transaction(IDB_JOBS_STORE, 'readwrite');
    const store = tx.objectStore(IDB_JOBS_STORE);
    const req = store.get(jobId);
    req.onsuccess = () => {
      if (req.result) store.put({ ...req.result, description });
    };
  }).catch(() => { /* ignore — IDB may not be seeded yet */ });
}

export async function saveJobDescription(id: string, description: string): Promise<void> {
  await updateDoc(doc(db, COLLECTION_NAME, id), { description });
  updateCachedDescription(id, description);
}

export async function fetchJobsWithDescriptions(): Promise<Map<string, string>> {
  const q = query(collection(db, COLLECTION_NAME), where('description', '!=', ''));
  const snap = await getDocs(q);
  const result = new Map<string, string>();
  snap.forEach(d => { const desc = d.data().description; if (desc) result.set(d.id, desc); });
  return result;
}

const CLEANUP_TIMESTAMP_KEY = 'last_auto_cleanup';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function runAutoCleanup(autoDeleteDays: number, autoMarkReadDays: number): Promise<boolean> {
  // Skip if already ran in the last 24 hours
  try {
    const last = localStorage.getItem(CLEANUP_TIMESTAMP_KEY);
    if (last && Date.now() - Number(last) < ONE_DAY_MS) return false;
  } catch { return false; }

  // Record timestamp first so a crash doesn't cause an infinite retry loop
  try { localStorage.setItem(CLEANUP_TIMESTAMP_KEY, String(Date.now())); } catch { /* ignore */ }

  if (autoDeleteDays === 0 && autoMarkReadDays === 0) return false;

  const allJobs = await getAllJobs();
  const now = Date.now();
  let changed = false;

  if (autoMarkReadDays > 0) {
    const cutoff = now - autoMarkReadDays * ONE_DAY_MS;
    const toMark = allJobs.filter(j => !j.read && new Date(j.dateReceived || 0).getTime() < cutoff);
    for (const job of toMark) {
      await updateDoc(doc(db, COLLECTION_NAME, job.id), { read: true });
    }
    if (toMark.length > 0) {
      if (jobsCache) {
        const ids = new Set(toMark.map(j => j.id));
        jobsCache = jobsCache.map(j => ids.has(j.id) ? { ...j, read: true } : j);
      }
      clearPersistentCache();
      changed = true;
    }
  }

  if (autoDeleteDays > 0) {
    const cutoff = now - autoDeleteDays * ONE_DAY_MS;
    const toDelete = allJobs.filter(j => new Date(j.dateReceived || 0).getTime() < cutoff);
    for (const job of toDelete) {
      await deleteDoc(doc(db, COLLECTION_NAME, job.id));
    }
    if (toDelete.length > 0) {
      if (jobsCache) {
        const ids = new Set(toDelete.map(j => j.id));
        jobsCache = jobsCache.filter(j => !ids.has(j.id));
      }
      clearPersistentCache();
      changed = true;
    }
  }

  return changed;
}

export function invalidateJobsCache(): void {
  jobsCache = null;
  clearPersistentCache();
  try {
    localStorage.removeItem(ORDER_CACHE_KEY);
  } catch (e) {
    console.warn('[jobService] Failed to clear stable order:', e);
  }
}

export async function addJob(jobData: NewJob): Promise<string> {
  const jobsCollection = collection(db, COLLECTION_NAME);
  const docRef = await addDoc(jobsCollection, {
    ...jobData,
    createdAt: serverTimestamp(),
  });
  clearPersistentCache();
  return docRef.id;
}

export async function deleteJob(id: string): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  await deleteDoc(jobDoc);
  if (jobsCache) {
    jobsCache = jobsCache.filter(j => j.id !== id);
  }
  clearPersistentCache();
}

export async function toggleJobSaved(id: string, saved: boolean): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  await updateDoc(jobDoc, { saved });
  if (jobsCache) {
    jobsCache = jobsCache.map(j => j.id === id ? { ...j, saved } : j);
  }
  clearPersistentCache();
}

export async function toggleJobApplied(id: string, applied: boolean): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  const update: Record<string, unknown> = { applied };
  if (applied) {
    update.applicationStage = 'applied';
    update.stageDate = new Date().toISOString().slice(0, 10);
  }
  await updateDoc(jobDoc, update);
  if (jobsCache) {
    jobsCache = jobsCache.map(j =>
      j.id === id
        ? { ...j, applied, ...(applied ? { applicationStage: 'applied' as ApplicationStage, stageDate: new Date().toISOString().slice(0, 10) } : {}) }
        : j
    );
  }
  clearPersistentCache();
}

export async function toggleJobReadStatus(jobId: string, read: boolean): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, jobId);
  await updateDoc(jobDoc, { read });
  if (jobsCache) {
    jobsCache = jobsCache.map(j => j.id === jobId ? { ...j, read } : j);
  }
  clearPersistentCache();
}

export async function updateJobBadges(id: string, badges: JobBadges): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  await updateDoc(jobDoc, { badges });
  if (jobsCache) {
    jobsCache = jobsCache.map(j => j.id === id ? { ...j, badges } : j);
  }
  clearPersistentCache();
}

// Bulk operations for settings page
export async function deleteAllJobs(): Promise<number> {
  const allJobs = await getAllJobs();
  for (const job of allJobs) {
    await deleteDoc(doc(db, COLLECTION_NAME, job.id));
  }
  const count = allJobs.length;
  invalidateJobsCache();
  return count;
}

export async function deleteReadJobs(): Promise<number> {
  const allJobs = await getAllJobs();
  const readJobs = allJobs.filter(j => j.read);
  for (const job of readJobs) {
    await deleteDoc(doc(db, COLLECTION_NAME, job.id));
  }
  if (jobsCache) {
    jobsCache = jobsCache.filter(j => !j.read);
  }
  clearPersistentCache();
  return readJobs.length;
}

export async function markAllJobsRead(): Promise<number> {
  const allJobs = await getAllJobs();
  const unreadJobs = allJobs.filter(j => !j.read);
  for (const job of unreadJobs) {
    await updateDoc(doc(db, COLLECTION_NAME, job.id), { read: true });
  }
  if (jobsCache) {
    jobsCache = jobsCache.map(j => ({ ...j, read: true }));
  }
  clearPersistentCache();
  return unreadJobs.length;
}

export async function exportJobs(format: 'csv' | 'json'): Promise<string> {
  const allJobs = await getAllJobs();

  if (format === 'json') {
    return JSON.stringify(allJobs, null, 2);
  }

  // CSV export
  const headers = ['id', 'title', 'company', 'location', 'url', 'source', 'type', 'tags', 'saved', 'applied', 'read', 'dateReceived'];
  const escapeCsv = (val: string) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const rows = allJobs.map(job =>
    [job.id, job.title, job.company, job.location, job.url, job.source, job.type, (job.tags || []).join('; '), job.saved, job.applied, job.read, job.dateReceived]
      .map(v => escapeCsv(String(v)))
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

const MAX_URL_LENGTH = 1400;

function truncateUrl(url: string): string {
  return url.length > MAX_URL_LENGTH ? url.slice(0, MAX_URL_LENGTH) : url;
}

export class DedupCache {
  private urls = new Set<string>();
  private titleCompany = new Set<string>();

  /** Build from already-loaded jobs array — zero Firestore reads */
  static fromJobs(jobs: Job[]): DedupCache {
    const cache = new DedupCache();
    for (const job of jobs) {
      if (job.url) cache.urls.add(job.url);
      if (job.title && job.company) {
        cache.titleCompany.add(`${job.title}|${job.company}`);
      }
    }
    return cache;
  }

  has(job: NewJob): boolean {
    if (this.urls.has(truncateUrl(job.url))) return true;
    if (this.titleCompany.has(`${job.title}|${job.company}`)) return true;
    return false;
  }

  add(job: NewJob): void {
    this.urls.add(truncateUrl(job.url));
    this.titleCompany.add(`${job.title}|${job.company}`);
  }
}

export async function addJobIfNotExists(jobData: NewJob, cache?: DedupCache): Promise<string | null> {
  const safeJob = { ...jobData, url: truncateUrl(jobData.url) };
  if (cache) {
    if (cache.has(safeJob)) return null;
    const id = await addJob(safeJob);
    cache.add(safeJob);
    return id;
  }
  // Fallback without cache
  const jobs = await getAllJobs();
  const exists = jobs.some(j => j.url === safeJob.url || (j.title === safeJob.title && j.company === safeJob.company));
  if (exists) return null;
  return addJob(safeJob);
}

export async function updateJobStage(id: string, stage: ApplicationStage, stageDate?: string): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  const update: Record<string, unknown> = { applicationStage: stage, stageDate: stageDate ?? new Date().toISOString().slice(0, 10) };
  if (stage === 'applied') update.applied = true;
  if (stage === 'saved') update.saved = true;
  await updateDoc(jobDoc, update);
  if (jobsCache) {
    jobsCache = jobsCache.map(j =>
      j.id === id
        ? {
            ...j,
            applicationStage: stage,
            stageDate: stageDate ?? new Date().toISOString().slice(0, 10),
            ...(stage === 'applied' ? { applied: true } : {}),
            ...(stage === 'saved' ? { saved: true } : {}),
          }
        : j
    );
  }
  clearPersistentCache();
}

export async function removeFromApplications(id: string): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  await updateDoc(jobDoc, {
    applied: false,
    applicationStage: deleteField(),
    stageDate: deleteField(),
  });
  if (jobsCache) {
    jobsCache = jobsCache.map(j =>
      j.id === id
        ? { ...j, applied: false, applicationStage: undefined, stageDate: undefined }
        : j
    );
  }
  clearPersistentCache();
}

/**
 * Updates notes and/or followUpDate for a job.
 * These fields have no side effects, unlike applicationStage.
 * For stage changes, always use updateJobStage instead.
 */
export async function updateJobFields(
  id: string,
  fields: Partial<Pick<Job, 'notes' | 'followUpDate'>>
): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  const firestoreFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    firestoreFields[key] = value === undefined ? deleteField() : value;
  }
  await updateDoc(jobDoc, firestoreFields);
  if (jobsCache) {
    jobsCache = jobsCache.map(j => j.id === id ? { ...j, ...fields } : j);
  }
  clearPersistentCache();
}
