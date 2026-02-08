import type { EmailParser } from './types';
import type { ParsedJob, GmailMessage } from '../types';
import { cleanText, cleanUrl, inferType, inferTags, createDomParser } from './utils';
import { getHeader } from '../services/gmailService';

export const genericParser: EmailParser = {
  name: 'generic',

  canParse(): boolean {
    return true;
  },

  parse(htmlBody: string, message: GmailMessage): ParsedJob[] {
    const doc = createDomParser(htmlBody);
    const jobs: ParsedJob[] = [];
    const seenUrls = new Set<string>();

    // Look for any links that might be job postings
    const links = doc.querySelectorAll('a[href]');
    const subject = getHeader(message, 'Subject') ?? '';

    links.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;

      // Skip common non-job links
      if (
        href.includes('unsubscribe') ||
        href.includes('mailto:') ||
        href.includes('privacy') ||
        href.includes('terms') ||
        href.includes('preferences') ||
        href.includes('#') ||
        href.length < 20
      ) return;

      const url = cleanUrl(href);
      if (seenUrls.has(url)) return;
      seenUrls.add(url);

      const titleText = cleanText(link.textContent ?? '');
      if (!titleText || titleText.length < 5 || titleText.length > 200) return;

      // Skip generic link texts
      if (['click here', 'learn more', 'read more', 'view', 'apply'].includes(titleText.toLowerCase())) return;

      jobs.push({
        title: titleText,
        company: 'Unknown',
        location: '',
        url,
        source: 'email',
        type: inferType(titleText || subject),
        tags: inferTags(titleText || subject),
      });
    });

    return jobs;
  },
};
