import { useState, useCallback } from 'react';
import { useGmailAuth } from '../hooks/useGmailAuth';
import {
  listMessageIds,
  getMessages,
  getSenderEmail,
  extractHtmlBody,
  getHeader,
} from '../services/gmailService';
import { parseEmail, getParserForSender } from '../parsers/parserRegistry';
import type { GmailMessage, ParsedJob } from '../types';

interface DebugResult {
  id: string;
  sender: string;
  subject: string;
  date: string;
  parserName: string;
  parsedJobs: ParsedJob[];
  htmlBody: string;
  error?: string;
}

interface ParserDebugModalProps {
  onClose: () => void;
}

export function ParserDebugModal({ onClose }: ParserDebugModalProps) {
  const { isSignedIn } = useGmailAuth();
  const [query, setQuery] = useState('from:glassdoor.com');
  const [maxEmails, setMaxEmails] = useState(10);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<DebugResult[]>([]);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [expandedHtml, setExpandedHtml] = useState<Set<string>>(new Set());

  const runDebug = useCallback(async () => {
    setLoading(true);
    setStatus('Searching for emails...');
    setResults([]);
    setExpandedJobs(new Set());
    setExpandedHtml(new Set());

    try {
      const allIds = await listMessageIds(query);
      const ids = allIds.slice(0, maxEmails);

      if (ids.length === 0) {
        setStatus(`No emails found matching: ${query}`);
        setLoading(false);
        return;
      }

      setStatus(`Found ${allIds.length} email(s), fetching first ${ids.length}...`);

      const messages: GmailMessage[] = await getMessages(ids, (fetched, total) => {
        setStatus(`Fetching emails… ${fetched}/${total}`);
      });

      setStatus(`Parsing ${messages.length} email(s)…`);

      const debugResults: DebugResult[] = messages.map(msg => {
        const sender = getSenderEmail(msg);
        const subject = getHeader(msg, 'Subject') ?? '(no subject)';
        const date = getHeader(msg, 'Date') ?? '(no date)';
        const parser = getParserForSender(sender);
        const htmlBody = extractHtmlBody(msg) ?? '(no HTML body)';

        let parsedJobs: ParsedJob[] = [];
        let error: string | undefined;
        try {
          parsedJobs = parseEmail(msg);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }

        return {
          id: msg.id,
          sender,
          subject,
          date,
          parserName: parser.name,
          parsedJobs,
          htmlBody,
          error,
        };
      });

      setResults(debugResults);
      const totalJobs = debugResults.reduce((s, r) => s + r.parsedJobs.length, 0);
      setStatus(
        `Done — ${messages.length} email(s) parsed, ${totalJobs} job(s) extracted total.`
      );
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [query, maxEmails]);

  const toggleSet = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="modal-card debug-modal-card">
        <div className="modal-header">
          <h3 className="modal-title">Parser Debugger</h3>
          <button className="modal-close" onClick={onClose} disabled={loading} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="modal-body">
          {!isSignedIn && (
            <div className="debug-warning">Connect to Gmail first to use the parser debugger.</div>
          )}

          {/* Query controls */}
          <div className="modal-section">
            <label className="modal-label">Gmail Search Query</label>
            <div className="debug-query-row">
              <input
                type="text"
                className="modal-input debug-query-input"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="e.g. from:glassdoor.com"
                disabled={loading}
              />
              <div className="debug-quick-btns">
                {[
                  ['Glassdoor', 'from:glassdoor.com'],
                  ['LinkedIn', 'from:jobalerts-noreply@linkedin.com'],
                  ['Indeed', 'from:alert@indeed.com'],
                ].map(([label, q]) => (
                  <button
                    key={label}
                    className={`modal-date-quick-btn${query === q ? ' active' : ''}`}
                    onClick={() => setQuery(q)}
                    disabled={loading}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="debug-max-row">
              <label className="modal-label" style={{ marginBottom: 0 }}>Max emails to fetch</label>
              <select
                className="modal-select debug-max-select"
                value={maxEmails}
                onChange={e => setMaxEmails(Number(e.target.value))}
                disabled={loading}
              >
                {[5, 10, 20, 50].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status */}
          {status && (
            <div className={`debug-status${status.startsWith('Error') ? ' error' : ''}`}>
              {status}
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div className="debug-results">
              {results.map(r => {
                const isJobsOpen = expandedJobs.has(r.id);
                const isHtmlOpen = expandedHtml.has(r.id);
                const parserColor =
                  r.parserName === 'glassdoor' ? '#4a90d9'
                  : r.parserName === 'linkedin' ? '#0077b5'
                  : r.parserName === 'indeed' ? '#2557a7'
                  : '#888';

                return (
                  <div key={r.id} className="debug-row">
                    <div className="debug-row-header">
                      <span
                        className="debug-parser-badge"
                        style={{ background: parserColor }}
                      >
                        {r.parserName}
                      </span>
                      <span className="debug-row-subject" title={r.subject}>{r.subject}</span>
                      <span className="debug-row-jobs">
                        {r.parsedJobs.length > 0
                          ? <span className="debug-jobs-count">{r.parsedJobs.length} job{r.parsedJobs.length !== 1 ? 's' : ''}</span>
                          : <span className="debug-jobs-zero">0 jobs</span>
                        }
                      </span>
                    </div>
                    <div className="debug-row-meta">
                      <span className="debug-sender">{r.sender}</span>
                      <span className="debug-date">{r.date}</span>
                    </div>

                    {r.error && (
                      <div className="debug-parse-error">Parse error: {r.error}</div>
                    )}

                    <div className="debug-row-actions">
                      <button
                        className="debug-toggle-btn"
                        onClick={() => toggleSet(expandedJobs, r.id, setExpandedJobs)}
                        disabled={r.parsedJobs.length === 0 && !r.error}
                      >
                        {isJobsOpen ? '▲ Hide jobs' : `▼ Show ${r.parsedJobs.length} job(s)`}
                      </button>
                      <button
                        className="debug-toggle-btn debug-toggle-html"
                        onClick={() => toggleSet(expandedHtml, r.id, setExpandedHtml)}
                      >
                        {isHtmlOpen ? '▲ Hide HTML' : '▼ Show raw HTML'}
                      </button>
                    </div>

                    {isJobsOpen && r.parsedJobs.length > 0 && (
                      <table className="debug-jobs-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Title</th>
                            <th>Company</th>
                            <th>Location</th>
                            <th>Type</th>
                            <th>URL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.parsedJobs.map((job, i) => (
                            <tr key={i}>
                              <td>{i + 1}</td>
                              <td>{job.title}</td>
                              <td>{job.company}</td>
                              <td>{job.location}</td>
                              <td>{job.type ?? '—'}</td>
                              <td>
                                <a href={job.url} target="_blank" rel="noreferrer" className="debug-url">
                                  link
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {isHtmlOpen && (
                      <div className="debug-html-block">
                        <div className="debug-html-meta">
                          Length: {r.htmlBody.length} chars
                          {r.htmlBody.length > 8000 && ' (showing first 8000)'}
                        </div>
                        <pre className="debug-html-pre">
                          {r.htmlBody.slice(0, 8000)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="nav-btn nav-btn-outline" onClick={onClose} disabled={loading}>
            Close
          </button>
          <button
            className="nav-btn nav-btn-accent"
            onClick={runDebug}
            disabled={loading || !isSignedIn || !query.trim()}
          >
            {loading ? 'Running…' : 'Fetch & Parse'}
          </button>
        </div>
      </div>
    </div>
  );
}
