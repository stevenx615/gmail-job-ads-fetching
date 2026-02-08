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

export async function jobExistsByUrl(url: string): Promise<boolean> {
  const jobsCollection = collection(db, COLLECTION_NAME);
  const q = query(jobsCollection, where('url', '==', truncateUrl(url)));
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

export async function addJobIfNotExists(jobData: NewJob): Promise<string | null> {
  const safeJob = { ...jobData, url: truncateUrl(jobData.url) };
  const exists = await jobExistsByUrl(safeJob.url);
  if (exists) return null;
  return addJob(safeJob);
}
