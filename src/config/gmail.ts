export const GMAIL_CONFIG = {
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  scopes: 'https://www.googleapis.com/auth/gmail.modify',
  discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest'],
};

export const DEFAULT_SENDERS = [
  'jobalerts-noreply@linkedin.com',
  'alert@indeed.com',
  'noreply@glassdoor.com',
];

export interface EmailQueryOptions {
  senders: string[];
  afterDate?: string;
  beforeDate?: string;
  label?: string;
  folder?: string;
}

export const buildEmailQuery = (options: EmailQueryOptions): string => {
  const { senders, afterDate, beforeDate, label, folder } = options;

  const fromParts = senders.map(s => `from:${s}`);
  let q = `(${fromParts.join(' OR ')})`;

  if (folder && folder !== 'ALL_MAIL') {
    q += ` in:${folder.toLowerCase()}`;
  }

  if (label) {
    q += ` label:${label}`;
  }

  if (afterDate) q += ` after:${afterDate}`;
  if (beforeDate) q += ` before:${beforeDate}`;

  return q;
};
