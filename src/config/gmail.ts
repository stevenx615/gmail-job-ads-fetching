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
  unreadOnly?: boolean;
}

export const buildEmailQuery = (options: EmailQueryOptions): string => {
  const { senders, afterDate, beforeDate, label, folder, unreadOnly } = options;

  const fromParts = senders.map(s => `from:${s}`);
  let q = `(${fromParts.join(' OR ')})`;

  if (folder && folder !== 'ALL_MAIL') {
    q += ` in:${folder.toLowerCase()}`;
  }

  if (label) {
    q += ` label:${label}`;
  }

  if (unreadOnly) q += ` is:unread`;
  // Use Unix timestamps so Gmail respects the user's local midnight, not UTC
  if (afterDate) {
    const epoch = Math.floor(new Date(afterDate + 'T00:00:00').getTime() / 1000);
    q += ` after:${epoch}`;
  }
  if (beforeDate) {
    // UI shows inclusive dates; Gmail "before:" is exclusive, so +1 day
    const d = new Date(beforeDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const epoch = Math.floor(d.getTime() / 1000);
    q += ` before:${epoch}`;
  }

  return q;
};
