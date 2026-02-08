import { useState, useCallback, useRef } from 'react';
import { listMessageIds, getMessages, getMessageDate, archiveMessages } from '../services/gmailService';
import { parseEmail } from '../parsers/parserRegistry';
import { addJobIfNotExists, DedupCache, getAllJobs, invalidateJobsCache } from '../services/jobService';
import { buildEmailQuery } from '../config/gmail';
import type { EmailQueryOptions } from '../config/gmail';
import type { FetchProgress, NewJob } from '../types';

export interface FetchEmailsOptions extends EmailQueryOptions {
  shouldArchive: boolean;
}

const initialProgress: FetchProgress = {
  phase: 'done',
  current: 0,
  total: 0,
  message: '',
  newJobsCount: 0,
};

export function useFetchEmails() {
  const [progress, setProgress] = useState<FetchProgress>(initialProgress);
  const [isFetching, setIsFetching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stopFetching = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const fetchEmails = useCallback(async (options: FetchEmailsOptions) => {
    const { shouldArchive, ...queryOptions } = options;
    const abort = new AbortController();
    abortRef.current = abort;
    const signal = abort.signal;
    setIsFetching(true);
    let newJobsCount = 0;

    try {
      // Phase 1: List message IDs
      setProgress({
        phase: 'listing',
        current: 0,
        total: 0,
        message: 'Searching for job alert emails...',
        newJobsCount: 0,
      });

      const emailQuery = buildEmailQuery(queryOptions);
      console.log('[FetchEmails] Query:', emailQuery);
      const messageIds = await listMessageIds(emailQuery, signal);

      if (signal.aborted) throw new Error('Stopped');

      if (messageIds.length === 0) {
        setProgress({
          phase: 'done',
          current: 0,
          total: 0,
          message: 'No job alert emails found.',
          newJobsCount: 0,
        });
        setIsFetching(false);
        return;
      }

      // Phase 2: Fetch messages
      setProgress({
        phase: 'fetching',
        current: 0,
        total: messageIds.length,
        message: `Fetching ${messageIds.length} emails...`,
        newJobsCount: 0,
      });

      const messages = await getMessages(messageIds, (fetched, total) => {
        setProgress(prev => ({
          ...prev,
          current: fetched,
          total,
          message: `Fetching emails... ${fetched}/${total}`,
        }));
      }, signal);

      if (signal.aborted) throw new Error('Stopped');

      // Phase 3: Parse emails
      setProgress({
        phase: 'parsing',
        current: 0,
        total: messages.length,
        message: 'Parsing job listings from emails...',
        newJobsCount: 0,
      });

      const allJobs: NewJob[] = [];

      for (let i = 0; i < messages.length; i++) {
        if (signal.aborted) throw new Error('Stopped');
        const message = messages[i];
        const parsedJobs = parseEmail(message);
        const dateReceived = getMessageDate(message);

        for (const pj of parsedJobs) {
          allJobs.push({
            ...pj,
            emailId: message.id,
            dateReceived,
          });
        }

        setProgress(prev => ({
          ...prev,
          current: i + 1,
          message: `Parsed ${i + 1}/${messages.length} emails (${allJobs.length} jobs found)`,
        }));
      }

      // Phase 4: Save to Firestore (dedup by URL + title/company)
      setProgress({
        phase: 'saving',
        current: 0,
        total: allJobs.length,
        message: 'Loading dedup cache...',
        newJobsCount: 0,
      });

      console.log('[FetchEmails] Loading dedup cache...');
      const existingJobs = await getAllJobs();
      console.log('[FetchEmails] Dedup cache loaded, existing jobs:', existingJobs.length);
      const cache = DedupCache.fromJobs(existingJobs);
      if (signal.aborted) throw new Error('Stopped');

      setProgress(prev => ({
        ...prev,
        message: `Saving ${allJobs.length} jobs to database...`,
      }));

      for (let i = 0; i < allJobs.length; i++) {
        if (signal.aborted) throw new Error('Stopped');
        const result = await addJobIfNotExists(allJobs[i], cache);
        if (result) newJobsCount++;

        setProgress(prev => ({
          ...prev,
          current: i + 1,
          newJobsCount,
          message: `Saving jobs... ${i + 1}/${allJobs.length} (${newJobsCount} new)`,
        }));
      }

      // Phase 5: Archive fetched emails (conditional)
      if (shouldArchive) {
        if (signal.aborted) throw new Error('Stopped');

        setProgress({
          phase: 'archiving',
          current: 0,
          total: messageIds.length,
          message: `Archiving ${messageIds.length} emails...`,
          newJobsCount,
        });

        await archiveMessages(messageIds, (archived, total) => {
          setProgress(prev => ({
            ...prev,
            current: archived,
            message: `Archiving emails... ${archived}/${total}`,
          }));
        }, signal);
      }

      // Invalidate cache so Dashboard picks up newly added jobs
      if (newJobsCount > 0) invalidateJobsCache();

      const archiveMsg = shouldArchive
        ? `, ${messageIds.length} emails archived`
        : '';

      setProgress({
        phase: 'done',
        current: allJobs.length,
        total: allJobs.length,
        message: `Done! ${newJobsCount} new jobs added${archiveMsg}.`,
        newJobsCount,
      });
    } catch (err) {
      if (signal.aborted) {
        setProgress(prev => ({
          ...prev,
          phase: 'done',
          message: `Stopped. ${newJobsCount} jobs saved before stopping.`,
        }));
      } else {
        console.error('Fetch emails error:', err);
        setProgress({
          phase: 'error',
          current: 0,
          total: 0,
          message: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          newJobsCount,
        });
      }
    } finally {
      setIsFetching(false);
    }
  }, []);

  const reset = useCallback(() => {
    setProgress(initialProgress);
  }, []);

  return { progress, isFetching, fetchEmails, stopFetching, reset };
}
