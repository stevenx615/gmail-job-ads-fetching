export interface JobBadges {
  responsibilities: string[];
  qualifications: string[];
  skills: string[];
  benefits: string[];
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  type: string;
  tags: string[];
  emailId: string;
  dateReceived: string;
  saved?: boolean;
  applied?: boolean;
  read?: boolean;
  description?: string;
  badges?: JobBadges;
  createdAt?: unknown;
}

export type NewJob = Omit<Job, 'id' | 'createdAt'>;

export interface ParsedJob {
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  type: string;
  tags: string[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailMessagePart;
  internalDate?: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailMessagePart[];
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailBody {
  attachmentId?: string;
  size: number;
  data?: string;
}

export interface FetchProgress {
  phase: 'listing' | 'fetching' | 'parsing' | 'saving' | 'archiving' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
  newJobsCount: number;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
}
