import type { GmailMessage, GmailMessagePart, GmailLabel } from '../types';

const BATCH_SIZE = 5;
const BATCH_DELAY = 300;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function listMessageIds(
  query: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    if (signal?.aborted) throw new Error('Stopped');

    const response = await gapi.client.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    });

    const messages = response.result.messages ?? [];
    ids.push(...messages.map(m => m.id));

    pageToken = response.result.nextPageToken ?? undefined;
  } while (pageToken);

  return ids;
}

export async function getMessage(messageId: string): Promise<GmailMessage> {
  const response = await gapi.client.gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return response.result;
}

export async function getMessages(
  messageIds: string[],
  onProgress?: (fetched: number, total: number) => void,
  signal?: AbortSignal,
): Promise<GmailMessage[]> {
  const results: GmailMessage[] = [];

  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new Error('Stopped');

    const batch = messageIds.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(id => getMessage(id)));
    results.push(...batchResults);
    onProgress?.(results.length, messageIds.length);

    if (i + BATCH_SIZE < messageIds.length) {
      await sleep(BATCH_DELAY);
    }
  }

  return results;
}

export function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(
    atob(base64)
      .split('')
      .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
}

export function extractHtmlBody(message: GmailMessage): string | null {
  if (!message.payload) return null;

  const findHtml = (part: GmailMessagePart): string | null => {
    if (part.mimeType === 'text/html' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (part.parts) {
      for (const child of part.parts) {
        const result = findHtml(child);
        if (result) return result;
      }
    }
    return null;
  };

  return findHtml(message.payload);
}

export function extractPlainBody(message: GmailMessage): string | null {
  if (!message.payload) return null;

  const findPlain = (part: GmailMessagePart): string | null => {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (part.parts) {
      for (const child of part.parts) {
        const result = findPlain(child);
        if (result) return result;
      }
    }
    return null;
  };

  return findPlain(message.payload);
}

export function getHeader(message: GmailMessage, name: string): string | null {
  const headers = message.payload?.headers ?? [];
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header?.value ?? null;
}

export function getMessageDate(message: GmailMessage): string {
  const dateHeader = getHeader(message, 'Date');
  if (dateHeader) {
    return new Date(dateHeader).toISOString();
  }
  if (message.internalDate) {
    return new Date(parseInt(message.internalDate)).toISOString();
  }
  return new Date().toISOString();
}

export function getSenderEmail(message: GmailMessage): string {
  const from = getHeader(message, 'From') ?? '';
  const match = from.match(/<(.+?)>/);
  return match ? match[1].toLowerCase() : from.toLowerCase();
}

export async function listLabels(): Promise<GmailLabel[]> {
  const response = await gapi.client.gmail.users.labels.list({ userId: 'me' });
  const labels = response.result.labels ?? [];
  return labels.map(l => ({ id: l.id, name: l.name, type: l.type }));
}

export async function archiveMessage(messageId: string): Promise<void> {
  await gapi.client.gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    resource: { removeLabelIds: ['INBOX'] },
  });
}

export async function archiveMessages(
  messageIds: string[],
  onProgress?: (archived: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new Error('Stopped');

    const batch = messageIds.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(id => archiveMessage(id)));
    onProgress?.(Math.min(i + BATCH_SIZE, messageIds.length), messageIds.length);
    if (i + BATCH_SIZE < messageIds.length) {
      await sleep(BATCH_DELAY);
    }
  }
}
