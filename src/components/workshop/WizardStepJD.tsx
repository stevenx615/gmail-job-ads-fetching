import { useRef, useEffect, useState } from 'react';

function plainTextToHtml(text: string): string {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      chunks.push(`<ul>${listItems.map(li => `<li>${li}</li>`).join('')}</ul>`);
      listItems = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flushList(); continue; }
    // Bullet: -, •, *, ·  or numbered: 1. / 1)
    const bullet = trimmed.match(/^[-•·*]\s*(.+)/) ?? trimmed.match(/^\d+[.)]\s+(.+)/);
    if (bullet) {
      listItems.push(bullet[1].trim());
    } else {
      flushList();
      chunks.push(`<p>${trimmed}</p>`);
    }
  }
  flushList();
  return chunks.join('');
}

interface ScrapeInfo { title: string; company: string; location: string; salary: string; jobType: string; }

interface Props {
  jobTitle: string;
  jobCompany: string;
  initialJD: string;
  htmlDescription?: string;
  jobUrl?: string;
  initialScrapeInfo?: ScrapeInfo | null;
  onNext: (jd: string) => void;
  onBack: () => void;
  onJDChange?: (jd: string) => void;
  onScrapedMeta?: (title: string, company: string, location: string, salary: string, jobType: string) => void;
  navDir?: 'forward' | 'backward';
}

export function WizardStepJD({ jobTitle, jobCompany, initialJD, htmlDescription, jobUrl, initialScrapeInfo, onNext, onBack, onJDChange, onScrapedMeta, navDir }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const readOnly = !!htmlDescription;
  const [empty, setEmpty] = useState(!readOnly && !initialJD.replace(/<[^>]*>/g, '').trim());
  const [scrapeUrl, setScrapeUrl] = useState(jobUrl ?? '');
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState('');
  const [scrapeSuccess, setScrapeSuccess] = useState(false);
  const [scrapeInfo, setScrapeInfo] = useState<ScrapeInfo | null>(initialScrapeInfo ?? null);

  useEffect(() => {
    if (!readOnly && editorRef.current) {
      editorRef.current.innerHTML = initialJD;
      editorRef.current.focus();
    }
  }, []);

  function handleInput() {
    const el = editorRef.current;
    if (!el) return;
    setEmpty(!el.innerText.trim());
    onJDChange?.(el.innerHTML);
  }

  function handleNext() {
    if (readOnly) { onNext(initialJD); return; }
    const el = editorRef.current;
    onNext(el ? el.innerHTML : '');
  }

  async function handleFetch() {
    if (!scrapeUrl.trim()) return;
    setScraping(true);
    setScrapeError('');
    try {
      const res = await fetch('/api/scrape-job', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: scrapeUrl.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        setScrapeError(err.detail ?? 'Scrape failed');
        return;
      }
      const data = await res.json();
      const description: string = data.description ?? '';
      if (editorRef.current) {
        // Backend now returns inner HTML; fall back to plain-text formatter if it looks like plain text
        const looksLikeHtml = /<[a-z][\s\S]*>/i.test(description);
        const html = looksLikeHtml ? description : plainTextToHtml(description);
        editorRef.current.innerHTML = html;
        setEmpty(!description.trim());
        onJDChange?.(html);
      }
      const info: ScrapeInfo = { title: data.title ?? '', company: data.company ?? '', location: data.location ?? '', salary: data.salary ?? '', jobType: data.jobType ?? '' };
      setScrapeInfo(info);
      onScrapedMeta?.(info.title, info.company, info.location, info.salary, info.jobType);
      setScrapeSuccess(true);
      setTimeout(() => setScrapeSuccess(false), 3000);
    } catch {
      setScrapeError('Backend not reachable — make sure the server is running (uvicorn main:app --reload)');
    } finally {
      setScraping(false);
    }
  }

  return (
    <div className="wz-step">
      <div className="wz-progress-bar">
        <div className="wz-progress-step active">
          <div className="wz-progress-dot">1</div>
          <span className="wz-progress-label">Job Description</span>
        </div>
        <div className={`wz-progress-line${navDir === 'backward' ? ' undoing' : ''}`} />
        <div className="wz-progress-step pending">
          <div className="wz-progress-dot">2</div>
          <span className="wz-progress-label">Resume</span>
        </div>
        <div className="wz-progress-line" />
        <div className="wz-progress-step pending">
          <div className="wz-progress-dot">3</div>
          <span className="wz-progress-label">Analyze</span>
        </div>
      </div>
      <div className="wz-header">
        <div className="wz-header-title-row">
          <svg className="wz-header-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <div className="wz-header-text">
            <div className="wz-title">{readOnly ? 'Job Description' : 'Add the job description'}</div>
            <div className="wz-subtitle">{readOnly ? 'The job posting from your email — used to tailor your resume.' : 'Paste a job posting, so we can tailor your resume accurately.'}</div>
          </div>
        </div>
      </div>

      <div className="wz-jd-body">
        {readOnly ? (
          <div className="wz-jd-readonly description-content">
            {(() => {
              const displayTitle   = scrapeInfo?.title   || jobTitle;
              const displayCompany = scrapeInfo?.company || jobCompany;
              const displayLoc     = scrapeInfo?.location ?? '';
              const displaySalary  = scrapeInfo?.salary   ?? '';
              const displayType    = scrapeInfo?.jobType  ?? '';
              if (!displayTitle && !displayCompany) return null;
              return (
                <div className="jd-meta-card">
                  {displayTitle && <div className="jd-meta-title">{displayTitle}</div>}
                  <div className="jd-meta-chips">
                    {displayCompany && (
                      <span className="jd-meta-chip">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                        {displayCompany}
                      </span>
                    )}
                    {displayLoc && (
                      <span className="jd-meta-chip">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        {displayLoc}
                      </span>
                    )}
                    {displayType && (
                      <span className="jd-meta-chip">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        {displayType}
                      </span>
                    )}
                    {displaySalary && (
                      <span className="jd-meta-chip jd-meta-chip-salary">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                        {displaySalary}
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
            <div dangerouslySetInnerHTML={{ __html: htmlDescription! }} />
          </div>
        ) : (
          <div className="wz-jd-left">
            <div className="wz-jd-fetch-bar">
              <input
                className="wz-jd-fetch-input"
                type="url"
                placeholder="Paste a job URL to auto-fill the description…"
                value={scrapeUrl}
                onChange={e => { setScrapeUrl(e.target.value); setScrapeError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleFetch()}
                disabled={scraping}
              />
              <button className={`wz-jd-fetch-btn${scrapeSuccess ? ' wz-jd-fetch-btn-success' : ''}`} onClick={handleFetch} disabled={scraping || !scrapeUrl.trim()}>
                {scraping ? (
                  <svg className="wz-jd-fetch-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                ) : scrapeSuccess ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                )}
                {scraping ? 'Fetching…' : scrapeSuccess ? 'Fetched!' : 'Fetch JD'}
              </button>
            </div>
            {scrapeError && <div className="wz-jd-fetch-error">{scrapeError}</div>}
            {scrapeInfo && (scrapeInfo.title || scrapeInfo.company) && (
              <div className="jd-meta-card">
                {scrapeInfo.title && <div className="jd-meta-title">{scrapeInfo.title}</div>}
                <div className="jd-meta-chips">
                  {scrapeInfo.company && (
                    <span className="jd-meta-chip">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                      {scrapeInfo.company}
                    </span>
                  )}
                  {scrapeInfo.location && (
                    <span className="jd-meta-chip">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {scrapeInfo.location}
                    </span>
                  )}
                  {scrapeInfo.jobType && (
                    <span className="jd-meta-chip">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      {scrapeInfo.jobType}
                    </span>
                  )}
                  {scrapeInfo.salary && (
                    <span className="jd-meta-chip jd-meta-chip-salary">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                      {scrapeInfo.salary}
                    </span>
                  )}
                </div>
              </div>
            )}
            <div
              ref={editorRef}
              className="wz-jd-textarea"
              contentEditable
              suppressContentEditableWarning
              onInput={handleInput}
              data-placeholder="Paste job description here…"
            />
          </div>
        )}
        {!readOnly && (
          <div className="wz-jd-tips">
            <div className="wz-tips-header">
              <div className="wz-tips-header-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                  <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
                </svg>
              </div>
              <span>Tips</span>
            </div>
            <div className="wz-tip-item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
              </svg>
              <span>Include the full posting for better keyword matching</span>
            </div>
            <div className="wz-tip-item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
              <span>Company name and job title help improve tailoring</span>
            </div>
            <div className="wz-tip-item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/>
              </svg>
              <span>We highlight missing skills in the next step</span>
            </div>
            {empty && (
              <div className="wz-tip-warning">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>Without a job description, AI tailoring will be less targeted.</span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="wz-footer wz-footer-split">
        <button className="wz-back-btn" onClick={onBack}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>Back</button>
        <div className="wz-footer-right">
          {!readOnly && empty && (
            <button className="wz-skip-btn" onClick={() => onNext('')}>Skip for now</button>
          )}
          <button
            className="nav-btn nav-btn-accent"
            disabled={!readOnly && empty}
            onClick={handleNext}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
