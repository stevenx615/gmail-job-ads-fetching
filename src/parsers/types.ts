import type { ParsedJob, GmailMessage } from '../types';

export interface EmailParser {
  name: string;
  canParse(senderEmail: string): boolean;
  parse(htmlBody: string, message: GmailMessage): ParsedJob[];
}
