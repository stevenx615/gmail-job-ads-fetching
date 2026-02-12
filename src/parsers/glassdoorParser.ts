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

      // Collect all paragraph texts in order
      const paragraphs = link.querySelectorAll('p');
      let title = '';
      const otherTexts: string[] = [];

      paragraphs.forEach(p => {
        const style = p.getAttribute('style') || '';
        const text = cleanText(p.textContent ?? '');
        if (!text) return;

        // Title is the bold/large one
        if (!title && style.includes('font-weight:600')) {
          title = text;
        } else {
          otherTexts.push(text);
        }
      });

      if (!title || title.length < 3) return;

      // Classify remaining texts by content, not style
      let company = '';
      let location = '';

      for (const text of otherTexts) {
        // Skip ratings like "3.5", "4.2", "3.9 ★"
        if (/^\d(\.\d)?\s*[★☆]?$/.test(text.trim())) continue;
        // Skip salary patterns like "$50K - $80K", "$20 Per Hour", "CA$60K"
        if (/[\$€£]|per\s+hour|salary|estimate/i.test(text)) continue;
        // Skip "Easy Apply" or action labels
        if (/^easy\s+apply$/i.test(text.trim())) continue;

        if (!company) {
          company = text;
        } else if (!location) {
          location = text;
        }
      }

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
