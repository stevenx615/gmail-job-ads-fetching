import type { EmailParser } from './types';
import type { ParsedJob, GmailMessage } from '../types';
import { cleanText, cleanUrl, inferType, inferTags, createDomParser } from './utils';

// Indeed wraps entire job cards inside a single <a> tag.
// Internal structure typically has distinct elements for title, company, location, salary.
function parseJobFromLink(link: Element): { title: string; company: string; location: string } | null {
  // Try to find structured child elements inside the link
  const children = link.querySelectorAll('td, div, span, p, b, strong, h2, h3');

  if (children.length >= 2) {
    // Indeed emails usually have: first prominent text = title, then company, then location
    const textBlocks: string[] = [];
    const seen = new Set<string>();

    children.forEach(el => {
      // Skip elements that contain other matched elements (avoid duplication)
      let isParent = false;
      children.forEach(other => {
        if (el !== other && el.contains(other)) isParent = true;
      });
      if (isParent) return;

      const text = cleanText(el.textContent ?? '');
      if (text && text.length > 1 && !seen.has(text)) {
        seen.add(text);
        textBlocks.push(text);
      }
    });

    if (textBlocks.length >= 1) {
      const title = textBlocks[0];
      const company = textBlocks[1] || '';
      // Location is often the block that contains a comma or province/state abbreviation
      let location = '';
      for (let i = 2; i < textBlocks.length; i++) {
        const block = textBlocks[i];
        if (
          block.match(/,\s*[A-Z]{2}/) ||        // "City, ON" or "City, CA"
          block.toLowerCase().includes('remote') ||
          block.toLowerCase().includes('hybrid') ||
          (block.match(/^[A-Z]/) && !block.includes('$') && !block.includes('ago') && !block.includes('apply') && block.length < 50)
        ) {
          location = block;
          break;
        }
      }
      return { title, company, location };
    }
  }

  // Fallback: split the full text by common patterns
  const fullText = cleanText(link.textContent ?? '');
  if (!fullText) return null;

  // Indeed pattern: "Title Company Location Salary ... Easily apply ... Description ... X days ago"
  // Try splitting by known suffixes
  const salaryMatch = fullText.match(/\$[\d,]+/);
  const easyApplyIdx = fullText.toLowerCase().indexOf('easily apply');
  const agoIdx = fullText.search(/\d+\s+days?\s+ago/i);

  let relevantText = fullText;
  if (easyApplyIdx > 0) relevantText = fullText.substring(0, easyApplyIdx);
  else if (salaryMatch?.index) relevantText = fullText.substring(0, salaryMatch.index);
  else if (agoIdx > 0) relevantText = fullText.substring(0, agoIdx);

  // Try to detect location pattern (word/phrase followed by comma and 2-letter code)
  const locationMatch = relevantText.match(/([A-Z][a-zA-Z\s]+,\s*[A-Z]{2})/);
  let location = locationMatch ? locationMatch[1].trim() : '';

  let beforeLocation = locationMatch
    ? relevantText.substring(0, locationMatch.index).trim()
    : relevantText.trim();

  // Check for "Remote" as location
  if (!location) {
    const remoteIdx = relevantText.toLowerCase().indexOf('remote');
    if (remoteIdx > 0) {
      location = 'Remote';
      beforeLocation = relevantText.substring(0, remoteIdx).trim();
    }
  }

  if (!beforeLocation || beforeLocation.length < 3) return null;

  // Heuristic: the last "word group" before location is the company
  // Try to split on where company name likely starts (capital letter after lowercase)
  const parts = beforeLocation.split(/(?<=[a-z])(?=[A-Z][a-z])/);
  if (parts.length >= 2) {
    const title = parts.slice(0, -1).join('');
    const company = parts[parts.length - 1];
    return { title, company, location };
  }

  return { title: beforeLocation, company: '', location };
}

export const indeedParser: EmailParser = {
  name: 'indeed',

  canParse(senderEmail: string): boolean {
    return senderEmail.includes('indeed.com');
  },

  parse(htmlBody: string, _message: GmailMessage): ParsedJob[] {
    const doc = createDomParser(htmlBody);
    const jobs: ParsedJob[] = [];
    const seenUrls = new Set<string>();

    const links = doc.querySelectorAll(
      'a[href*="indeed.com/viewjob"], a[href*="indeed.com/rc/clk"], a[href*="indeed.com/job/"]'
    );

    links.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;

      const url = cleanUrl(href);
      if (seenUrls.has(url)) return;
      seenUrls.add(url);

      const parsed = parseJobFromLink(link);
      if (!parsed) return;
      if (parsed.title.length < 3 || parsed.title.length > 150) return;

      // Skip non-job links
      const lower = parsed.title.toLowerCase();
      if (lower === 'view' || lower === 'apply' || lower.includes('unsubscribe')) return;

      jobs.push({
        title: parsed.title,
        company: parsed.company || 'Unknown',
        location: parsed.location || '',
        url,
        source: 'indeed',
        type: inferType(parsed.title),
        tags: inferTags(parsed.title + ' ' + parsed.location),
      });
    });

    return jobs;
  },
};
