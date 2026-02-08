import type { EmailParser } from './types';
import type { ParsedJob, GmailMessage } from '../types';
import { getSenderEmail, extractHtmlBody } from '../services/gmailService';
import { linkedinParser } from './linkedinParser';
import { indeedParser } from './indeedParser';
import { glassdoorParser } from './glassdoorParser';
import { genericParser } from './genericParser';

const parsers: EmailParser[] = [
  linkedinParser,
  indeedParser,
  glassdoorParser,
  genericParser, // fallback — always returns true for canParse
];

export function parseEmail(message: GmailMessage): ParsedJob[] {
  const senderEmail = getSenderEmail(message);
  const htmlBody = extractHtmlBody(message);

  if (!htmlBody) return [];

  // Use the first matching non-generic parser; only fall back to generic
  // if no specific parser claims this sender
  for (const parser of parsers) {
    if (parser === genericParser) continue;
    if (parser.canParse(senderEmail)) {
      return parser.parse(htmlBody, message);
    }
  }

  // No specific parser matched — use generic fallback
  return genericParser.parse(htmlBody, message);
}

export function getParserForSender(senderEmail: string): EmailParser {
  for (const parser of parsers) {
    if (parser.canParse(senderEmail)) {
      return parser;
    }
  }
  return genericParser;
}
