import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Job, JobBadges, NewJob } from '../types';

const COLLECTION_NAME = 'jobs';

// In-memory cache to avoid redundant Firestore reads
let jobsCache: Job[] | null = null;

// Stable order cache in localStorage
const ORDER_CACHE_KEY = 'jobs_stable_order';

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
  if (jobsCache && !forceRefresh) {
    console.log('[jobService] Returning cached jobs:', jobsCache.length);
    return jobsCache;
  }

  console.log('[jobService] Fetching jobs from Firestore...');
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
      badges: data.badges || undefined,
      emailId: data.emailId,
      dateReceived: data.dateReceived?.toDate?.() || new Date(),
      createdAt: data.createdAt?.toDate?.() || new Date(),
    };
  }) as Job[];

  console.log('[jobService] First 5 job IDs from Firestore:', fetchedJobs.slice(0, 5).map(j => j.id));

  // Apply stable order from localStorage, or save current order if none exists
  const stableOrder = getStableOrder();
  console.log('[jobService] Stable order exists:', stableOrder.length > 0, 'count:', stableOrder.length);

  if (stableOrder.length === 0 || stableOrder.length !== fetchedJobs.length) {
    // First time or job count changed - save the current Firestore order
    console.log('[jobService] Saving new stable order');
    setStableOrder(fetchedJobs.map(j => j.id));
    jobsCache = fetchedJobs;
  } else {
    // Apply the stable order
    console.log('[jobService] Applying stable order');
    jobsCache = applyStableOrder(fetchedJobs);
  }

  console.log('[jobService] First 5 job IDs after ordering:', jobsCache.slice(0, 5).map(j => j.id));
  console.log('[jobService] Fetched and cached jobs:', jobsCache.length);
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

export function invalidateJobsCache(): void {
  console.log('[jobService] Cache invalidated');
  jobsCache = null;
  // Clear stable order so new jobs get incorporated in the next fetch
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
  return docRef.id;
}

export async function deleteJob(id: string): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  await deleteDoc(jobDoc);
  // Update cache in place instead of re-fetching
  if (jobsCache) {
    jobsCache = jobsCache.filter(j => j.id !== id);
  }
}

export async function toggleJobSaved(id: string, saved: boolean): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  await updateDoc(jobDoc, { saved });
  if (jobsCache) {
    jobsCache = jobsCache.map(j => j.id === id ? { ...j, saved } : j);
  }
}

export async function toggleJobApplied(id: string, applied: boolean): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  await updateDoc(jobDoc, { applied });
  if (jobsCache) {
    jobsCache = jobsCache.map(j => j.id === id ? { ...j, applied } : j);
  }
}

export async function toggleJobReadStatus(jobId: string, read: boolean): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, jobId);
  await updateDoc(jobDoc, { read });
  if (jobsCache) {
    jobsCache = jobsCache.map(j => j.id === jobId ? { ...j, read } : j);
  }
}

export async function updateJobBadges(id: string, badges: JobBadges): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  await updateDoc(jobDoc, { badges });
  if (jobsCache) {
    jobsCache = jobsCache.map(j => j.id === id ? { ...j, badges } : j);
  }
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
