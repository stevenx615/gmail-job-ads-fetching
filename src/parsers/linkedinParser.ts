import type { EmailParser } from './types';
import type { ParsedJob, GmailMessage } from '../types';
import { cleanText, cleanUrl, inferType, inferTags, createDomParser } from './utils';

export const linkedinParser: EmailParser = {
  name: 'linkedin',

  canParse(senderEmail: string): boolean {
    return senderEmail.includes('linkedin.com');
  },

  parse(htmlBody: string, _message: GmailMessage): ParsedJob[] {
    const doc = createDomParser(htmlBody);
    const jobs: ParsedJob[] = [];
    const seenUrls = new Set<string>();

    // Find title links: <a> with font-size:16px and font-weight:600
    const allLinks = doc.querySelectorAll('a[href*="linkedin.com/comm/jobs/view"]');

    allLinks.forEach(link => {
      const style = link.getAttribute('style') || '';
      if (!style.includes('font-size:16px') || !style.includes('font-weight:600')) return;

      const href = link.getAttribute('href');
      if (!href) return;

      const url = cleanUrl(href);
      if (seenUrls.has(url)) return;
      seenUrls.add(url);

      const title = cleanText(link.textContent ?? '');
      if (!title || title.length < 3) return;

      let company = '';
      let location = '';

      // Walk up to find the container table, then find the <p> with company · location
      const containerTd = link.closest('td');
      const containerTr = containerTd?.parentElement;
      const nextTr = containerTr?.nextElementSibling;

      if (nextTr) {
        const p = nextTr.querySelector('p');
        if (p) {
          const text = cleanText(p.textContent ?? '');
          // Format: "Company · Location"
          const dotIndex = text.indexOf(' · ');
          if (dotIndex !== -1) {
            company = text.substring(0, dotIndex).trim();
            location = text.substring(dotIndex + 3).trim();
          } else {
            company = text;
          }
        }
      }

      jobs.push({
        title,
        company: company || 'Unknown',
        location,
        url,
        source: 'linkedin',
        type: inferType(title),
        tags: inferTags(title + ' ' + location),
      });
    });

    return jobs;
  },
};
