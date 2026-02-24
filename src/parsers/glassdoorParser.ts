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

        // Title is the bold/large one (inline style) or first paragraph (class-based style)
        if (!title && style.includes('font-weight:600')) {
          title = text;
        } else {
          otherTexts.push(text);
        }
      });

      // Fallback: if no inline font-weight found, first paragraph is the title
      if (!title && otherTexts.length > 0) {
        title = otherTexts.shift()!;
      }

      if (!title || title.length < 3) return;

      // Company name is in a <span>, not a <p> (Glassdoor email layout)
      let company = '';
      for (const span of link.querySelectorAll('span')) {
        if (span.querySelector('span')) continue; // skip container spans
        const text = cleanText(span.textContent ?? '');
        if (!text) continue;
        if (/^\d(\.\d)?\s*[★☆]?$/.test(text)) continue; // skip ratings like "4.3 ★"
        if (/^easy\s+apply$/i.test(text)) continue;
        if (/^\d+[dhm]$/.test(text)) continue; // skip age labels like "3d"
        company = text;
        break;
      }

      // Location comes from remaining paragraph texts
      let location = '';

      for (const text of otherTexts) {
        // Skip ratings like "3.5", "4.2", "3.9 ★"
        if (/^\d(\.\d)?\s*[★☆]?$/.test(text.trim())) continue;
        // Skip salary patterns like "$50K - $80K", "$20 Per Hour", "CA$60K"
        if (/[\$€£]|per\s+hour|salary|estimate/i.test(text)) continue;
        // Skip "Easy Apply" or action labels
        if (/^easy\s+apply$/i.test(text.trim())) continue;
        // Skip age labels like "3d", "2h"
        if (/^\d+[dhm]$/.test(text.trim())) continue;

        if (!location) {
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
