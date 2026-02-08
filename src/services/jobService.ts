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
import type { Job, NewJob } from '../types';

const COLLECTION_NAME = 'jobs';

// In-memory cache to avoid redundant Firestore reads
let jobsCache: Job[] | null = null;

export async function getAllJobs(forceRefresh = false): Promise<Job[]> {
  if (jobsCache && !forceRefresh) return jobsCache;

  const jobsCollection = collection(db, COLLECTION_NAME);
  const q = query(jobsCollection, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  jobsCache = snapshot.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      source: (data.source || '').toLowerCase(),
      type: (data.type || '').toLowerCase(),
    };
  }) as Job[];
  return jobsCache;
}

export function invalidateJobsCache(): void {
  jobsCache = null;
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
