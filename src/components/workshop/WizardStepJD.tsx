import { useState } from 'react';

interface Props {
  jobTitle: string;
  jobCompany: string;
  initialJD: string;
  onNext: (jd: string) => void;
}

export function WizardStepJD({ jobTitle, jobCompany, initialJD, onNext }: Props) {
  const [jd, setJd] = useState(initialJD);
  const empty = !jd.trim();
  const heading = [jobTitle, jobCompany].filter(Boolean).join(' — ') || 'New Workshop';

  return (
    <div className="wz-step">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '0.5rem' }}>
        <div className="wz-progress-dot active">1</div>
        <div className="wz-progress-label active">Job Description</div>
        <div className="wz-progress-line" />
        <div className="wz-progress-dot pending">2</div>
        <div className="wz-progress-label">Resume</div>
        <div className="wz-progress-line" />
        <div className="wz-progress-dot pending">3</div>
        <div className="wz-progress-label">Analyze</div>
      </div>
      <div className="wz-header">
        <div className="wz-title">{heading}</div>
        <div className="wz-subtitle">Paste or edit the job description below</div>
      </div>
      <textarea
        className="wz-jd-textarea"
        value={jd}
        onChange={e => setJd(e.target.value)}
        placeholder="Paste job description here…"
        autoFocus
      />
      {empty && (
        <div className="wz-warning">
          <span>⚠ Without a job description, AI tailoring will be less targeted.</span>
          <button className="wz-skip-btn" onClick={() => onNext('')}>Skip for now →</button>
        </div>
      )}
      <div className="wz-footer">
        <button
          className="nav-btn nav-btn-accent"
          disabled={empty}
          onClick={() => onNext(jd.trim())}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
