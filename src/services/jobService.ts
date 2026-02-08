import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Job, NewJob } from '../types';

const COLLECTION_NAME = 'jobs';

export async function getAllJobs(): Promise<Job[]> {
  const jobsCollection = collection(db, COLLECTION_NAME);
  const q = query(jobsCollection, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      source: (data.source || '').toLowerCase(),
      type: (data.type || '').toLowerCase(),
    };
  }) as Job[];
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
}

export async function toggleJobSaved(id: string, saved: boolean): Promise<void> {
  const jobDoc = doc(db, COLLECTION_NAME, id);
  await updateDoc(jobDoc, { saved });
}

const MAX_URL_LENGTH = 1400;

function truncateUrl(url: string): string {
  return url.length > MAX_URL_LENGTH ? url.slice(0, MAX_URL_LENGTH) : url;
}

export class DedupCache {
  private urls = new Set<string>();
  private titleCompany = new Set<string>();

  static async load(): Promise<DedupCache> {
    const cache = new DedupCache();
    const jobsCollection = collection(db, COLLECTION_NAME);
    const snapshot = await getDocs(jobsCollection);
    for (const d of snapshot.docs) {
      const data = d.data();
      if (data.url) cache.urls.add(data.url);
      if (data.title && data.company) {
        cache.titleCompany.add(`${data.title}|${data.company}`);
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
  // Fallback without cache (single job)
  const jobsCollection = collection(db, COLLECTION_NAME);
  const q = query(jobsCollection, where('url', '==', safeJob.url));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) return null;
  return addJob(safeJob);
}
