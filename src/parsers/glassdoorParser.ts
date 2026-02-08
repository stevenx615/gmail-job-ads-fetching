import type { EmailParser } from './types';
import type { ParsedJob, GmailMessage } from '../types';
import { cleanText, cleanUrl, inferType, inferTags, createDomParser } from './utils';

export const glassdoorParser: EmailParser = {
  name: 'glassdoor',

  canParse(senderEmail: string): boolean {
    return senderEmail.includes('glassdoor.com');
  },

  parse(htmlBody: string, _message: GmailMessage): ParsedJob[] {
    const doc = createDomParser(htmlBody);
    const jobs: ParsedJob[] = [];
    const seenUrls = new Set<string>();

    const links = doc.querySelectorAll(
      'a[href*="glassdoor.com/partner/jobListing"], a[href*="glassdoor.com/job-listing"], a[href*="glassdoor.com/Job"]'
    );

    links.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;

      const url = cleanUrl(href);
      if (seenUrls.has(url)) return;
      seenUrls.add(url);

      const paragraphs = link.querySelectorAll('p');
      let title = '';
      let company = '';
      let location = '';

      paragraphs.forEach(p => {
        const style = p.getAttribute('style') || '';
        const text = cleanText(p.textContent ?? '');
        if (!text) return;

        if (style.includes('font-weight:600') && style.includes('font-size:14px')) {
          title = text;
        } else if (!title && style.includes('font-size:12px') && style.includes('font-weight:400') && !style.includes('color:#')) {
          company = text;
        } else if (style.includes('margin-top:4px')) {
          location = text;
        }
      });

      if (!title || title.length < 3) return;

      jobs.push({
        title,
        company: company || 'Unknown',
        location,
        url,
        source: 'glassdoor',
        type: inferType(title),
        tags: inferTags(title),
      });
    });

    return jobs;
  },
};
