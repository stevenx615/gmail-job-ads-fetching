export interface SavedResume {
  id: string;
  name: string;
  uploadedAt: number;
  type: 'docx' | 'scratch';
  preview: string;
  content: string;
  html?: string;
}

const KEY = 'wz_saved_resumes';
const MAX = 10;

export function getSavedResumes(): SavedResume[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: SavedResume[] = raw ? JSON.parse(raw) : [];
    return list.sort((a, b) => b.uploadedAt - a.uploadedAt);
  } catch { return []; }
}

export function saveResume(data: Omit<SavedResume, 'id' | 'uploadedAt'>): SavedResume {
  const all = getSavedResumes();
  const entry: SavedResume = { ...data, id: String(Date.now()), uploadedAt: Date.now() };
  const updated = [entry, ...all].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(updated)); } catch {}
  return entry;
}

export function deleteResume(id: string): void {
  const updated = getSavedResumes().filter(r => r.id !== id);
  try { localStorage.setItem(KEY, JSON.stringify(updated)); } catch {}
}

export function daysAgo(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}
