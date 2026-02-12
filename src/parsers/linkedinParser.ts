import type { EmailParser } from './types';
import type { ParsedJob, GmailMessage } from '../types';
import { cleanText, cleanUrl, inferType, inferTags, createDomParser } from './utils';

/** Extract the job ID from a LinkedIn job URL for grouping */
function extractJobKey(href: string): string | null {
  // URLs like: linkedin.com/comm/jobs/view/1234567890?tracking...
  const match = href.match(/\/jobs\/view\/(\d+)/);
  return match ? match[1] : null;
}

export const linkedinParser: EmailParser = {
  name: 'linkedin',

  canParse(senderEmail: string): boolean {
    return senderEmail.includes('linkedin.com');
  },

  parse(htmlBody: string, _message: GmailMessage): ParsedJob[] {
    const doc = createDomParser(htmlBody);
    const jobs: ParsedJob[] = [];

    const allLinks = doc.querySelectorAll('a[href*="linkedin.com/comm/jobs/view"]');

    // Group links by job ID — each job has multiple <a> tags with different tracking params
    const linksByJobId = new Map<string, { links: Element[]; firstHref: string }>();
    allLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;
      const jobId = extractJobKey(href);
      if (!jobId) return;
      if (!linksByJobId.has(jobId)) {
        linksByJobId.set(jobId, { links: [], firstHref: href });
      }
      linksByJobId.get(jobId)!.links.push(link);
    });

    for (const [, { links, firstHref }] of linksByJobId) {
      let title = '';
      let company = '';
      let location = '';
      const url = cleanUrl(firstHref);

      for (const link of links) {
        const paragraphs = link.querySelectorAll('p');

        if (paragraphs.length === 0) {
          // Link with no <p> — its textContent is the job title
          const text = cleanText(link.textContent ?? '');
          if (text && text.length >= 5 && !title) {
            title = text;
          }
        } else {
          // Link with <p> elements — contains company/location and hints
          paragraphs.forEach(p => {
            const text = cleanText(p.textContent ?? '');
            if (!text) return;

            // Skip labels
            if (/^easy\s+apply$/i.test(text)) return;
            if (/^\d+\s+(school|company|connection|alum|mutual)/i.test(text)) return;
            if (/^(school alum|alumni|connection|promoted|viewed|new|reposted)$/i.test(text)) return;

            // "Company · Location"
            if (!company && text.includes(' · ')) {
              const dotIndex = text.indexOf(' · ');
              company = text.substring(0, dotIndex).trim();
              location = text.substring(dotIndex + 3).trim();
            }
          });
        }
      }

      if (!title || title.length < 3) continue;

      jobs.push({
        title,
        company: company || 'Unknown',
        location,
        url,
        source: 'linkedin',
        type: inferType(title),
        tags: inferTags(title + ' ' + location),
      });
    }

    return jobs;
  },
};
