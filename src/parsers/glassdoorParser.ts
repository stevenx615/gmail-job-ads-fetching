import type { EmailParser } from './types';
import type { ParsedJob, GmailMessage } from '../types';
import { cleanText, cleanUrl, inferType, inferTags, createDomParser } from './utils';

// Glassdoor uses regional TLDs (.com, .ca, .co.uk, .com.au, etc.)
const GD_DOMAINS = ['glassdoor.com', 'glassdoor.ca', 'glassdoor.co.uk', 'glassdoor.com.au', 'glassdoor.de', 'glassdoor.fr'];
const GD_JOB_PATHS = ['partner/jobListing', 'job-listing', 'Job/', 'jobs/', 'listing', 'apply'];

const JOB_LINK_SELECTOR = GD_DOMAINS.flatMap(domain =>
  GD_JOB_PATHS.map(path => `a[href*="${domain}/${path}"]`)
).join(', ');

// Skip text values that aren't job fields
const SKIP_PATTERNS = [
  /^\d(\.\d+)?\s*[★☆]?$/, // ratings: "4.3", "3.9 ★"
  /^easy\s+apply$/i,
  /^\d+[dhm]$/, // age labels: "3d", "2h"
  /[\$€£¥]|per\s+hour|salary|estimate|k\s*-\s*\$?\d|k\/yr/i, // salary
  /^apply(\s+now)?$/i,
  /^view\s+(job|listing|all)$/i,
  /^learn\s+more$/i,
  /^see\s+(more|details)$/i,
  /^glassdoor$/i,
  /^promoted$/i,
  /^new$/i,
  /^\d+\s*(open|job)/i, // "3 open jobs"
];

function shouldSkip(text: string): boolean {
  const t = text.trim();
  return !t || t.length < 2 || SKIP_PATTERNS.some(re => re.test(t));
}

/**
 * Extract text from an element's direct paragraphs + spans,
 * returning [title, otherTexts[]] using bold/weight heuristic for title.
 */
function extractTextsFromElement(el: Element): { title: string; others: string[] } {
  const paragraphs = el.querySelectorAll('p');
  let title = '';
  const others: string[] = [];

  paragraphs.forEach(p => {
    const style = p.getAttribute('style') ?? '';
    const text = cleanText(p.textContent ?? '');
    if (!text || shouldSkip(text)) return;

    const isBold =
      style.includes('font-weight:600') ||
      style.includes('font-weight: 600') ||
      style.includes('font-weight:700') ||
      style.includes('font-weight: 700') ||
      style.includes('font-weight:bold') ||
      !!p.querySelector('strong, b');

    if (!title && isBold) {
      title = text;
    } else {
      others.push(text);
    }
  });

  // Fallback: first paragraph is the title
  if (!title && others.length > 0) {
    title = others.shift()!;
  }

  return { title, others };
}

/**
 * Extract company from spans inside an element (skip container spans, ratings, labels).
 */
function extractCompanyFromElement(el: Element): string {
  for (const span of el.querySelectorAll('span')) {
    if (span.querySelector('span')) continue; // skip containers
    const text = cleanText(span.textContent ?? '');
    if (!text || shouldSkip(text)) continue;
    return text;
  }
  return '';
}

/**
 * Extract company from table cells or divs adjacent/above the link.
 */
function extractCompanyFromAncestor(link: Element): string {
  // Walk up to a block container and look at sibling/child text nodes
  let el: Element | null = link.parentElement;
  for (let depth = 0; depth < 5 && el; depth++, el = el.parentElement) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'td' || tag === 'div' || tag === 'li') {
      const company = extractCompanyFromElement(el);
      if (company) return company;
    }
  }
  return '';
}

/**
 * Pick location from a list of text strings (first non-salary, non-title-like string).
 */
function pickLocation(candidates: string[]): string {
  for (const text of candidates) {
    if (shouldSkip(text)) continue;
    // A location typically has a comma, or looks like "City, State" or "Remote"
    if (
      text.includes(',') ||
      /remote|on.?site|hybrid/i.test(text) ||
      text.split(' ').length <= 4
    ) {
      return text;
    }
  }
  return candidates[0] ?? '';
}

/**
 * Strategy A: job data lives INSIDE the <a> tag (classic Glassdoor format).
 */
function tryExtractFromInsideLink(link: Element): Partial<ParsedJob> | null {
  const { title, others } = extractTextsFromElement(link);
  if (!title || title.length < 3) return null;

  const company = extractCompanyFromElement(link) || 'Unknown';
  const location = pickLocation(others);

  return { title, company, location };
}

/**
 * Strategy B: job data lives OUTSIDE the <a> tag, in surrounding table cells / container.
 * The link itself is typically a short CTA like "Apply" or "View Job".
 */
function tryExtractFromAncestor(link: Element): Partial<ParsedJob> | null {
  // Walk up to find a table row or card container
  let container: Element | null = link.parentElement;
  for (let depth = 0; depth < 6 && container; depth++, container = container.parentElement) {
    const tag = container.tagName.toLowerCase();
    if (tag !== 'tr' && tag !== 'td' && tag !== 'div' && tag !== 'li') continue;

    const { title, others } = extractTextsFromElement(container);
    if (!title || title.length < 3) continue;

    const company = extractCompanyFromElement(container) || extractCompanyFromAncestor(link) || 'Unknown';
    const location = pickLocation(others);

    return { title, company, location };
  }
  return null;
}

export const glassdoorParser: EmailParser = {
  name: 'glassdoor',

  canParse(senderEmail: string): boolean {
    return senderEmail.includes('glassdoor.com') || senderEmail.includes('glassdoor.ca');
  },

  parse(htmlBody: string, _message: GmailMessage): ParsedJob[] {
    const doc = createDomParser(htmlBody);
    const jobs: ParsedJob[] = [];
    const seenUrls = new Set<string>();

    // Try specific job-link selectors first
    let links = Array.from(doc.querySelectorAll(JOB_LINK_SELECTOR));

    // Fallback: any glassdoor link on any regional domain
    if (links.length === 0) {
      const fallbackSelector = GD_DOMAINS.map(d => `a[href*="${d}"]`).join(', ');
      links = Array.from(doc.querySelectorAll(fallbackSelector)).filter(a => {
        const href = a.getAttribute('href') ?? '';
        return !/unsubscribe|preference|optout|account|manage|brand-view|assets|fonts/i.test(href);
      });
    }

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;

      const url = cleanUrl(href);
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      // Try Strategy A first (text inside link), then Strategy B (text in ancestor)
      const linkText = cleanText(link.textContent ?? '');
      const isCtaLink = !linkText || linkText.length < 30 || shouldSkip(linkText);

      const extracted = isCtaLink
        ? tryExtractFromAncestor(link) ?? tryExtractFromInsideLink(link)
        : tryExtractFromInsideLink(link) ?? tryExtractFromAncestor(link);

      if (!extracted || !extracted.title || extracted.title.length < 3) continue;

      const { title, company = 'Unknown', location = '' } = extracted;

      jobs.push({
        title,
        company,
        location,
        url,
        source: 'glassdoor',
        type: inferType(title),
        tags: inferTags(title),
      });
    }

    return jobs;
  },
};
