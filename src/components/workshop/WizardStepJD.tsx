import { useRef, useEffect, useState } from 'react';

interface Props {
  jobTitle: string;
  jobCompany: string;
  initialJD: string;
  htmlDescription?: string;
  onNext: (jd: string) => void;
  onBack: () => void;
  onJDChange?: (jd: string) => void;
  navDir?: 'forward' | 'backward';
}

export function WizardStepJD({ jobTitle, jobCompany, initialJD, htmlDescription, onNext, onBack, onJDChange, navDir }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const readOnly = !!htmlDescription;
  const [empty, setEmpty] = useState(!readOnly && !initialJD.replace(/<[^>]*>/g, '').trim());

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
            {(jobTitle || jobCompany) && (
              <div className="wz-jd-readonly-jobline">
                {jobTitle && <span className="wz-jd-readonly-title">{jobTitle}</span>}
                {jobCompany && <span className="wz-jd-readonly-company">{jobCompany}</span>}
              </div>
            )}
            <div dangerouslySetInnerHTML={{ __html: htmlDescription! }} />
          </div>
        ) : (
          <div
            ref={editorRef}
            className="wz-jd-textarea"
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            data-placeholder="Paste job description here…"
          />
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
