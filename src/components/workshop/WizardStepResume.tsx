import { useRef, useState } from 'react';

interface Props {
  onUpload: (file: File) => void;
  onScratch: () => void;
  onBack: () => void;
}

export function WizardStepResume({ onUpload, onScratch, onBack }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith('.docx')) setFile(f);
  }

  return (
    <div className="wz-step">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '0.5rem' }}>
        <div className="wz-progress-dot done">✓</div>
        <div className="wz-progress-label">Job Description</div>
        <div className="wz-progress-line done" />
        <div className="wz-progress-dot active">2</div>
        <div className="wz-progress-label active">Resume</div>
        <div className="wz-progress-line" />
        <div className="wz-progress-dot pending">3</div>
        <div className="wz-progress-label">Analyze</div>
      </div>
      <div className="wz-header">
        <div className="wz-title">How would you like to provide your resume?</div>
      </div>
      <div className="wz-resume-options">
        <div
          className="wz-resume-card wz-upload-card"
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="wz-card-icon">📄</div>
          <div className="wz-card-title">Upload DOCX</div>
          <div className="wz-card-desc">Drag & drop or click to browse</div>
          {file && <div className="wz-filename">📎 {file.name}</div>}
          <input
            ref={inputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); }}
          />
        </div>
        <div className="wz-resume-card wz-scratch-card" onClick={onScratch}>
          <div className="wz-card-icon">✏️</div>
          <div className="wz-card-title">Build from Scratch</div>
          <div className="wz-card-desc">Fill in your info section by section — AI tailors each one.</div>
        </div>
      </div>
      <div className="wz-footer wz-footer-split">
        <button className="wz-back-btn" onClick={onBack}>← Back</button>
        {file && (
          <button className="nav-btn nav-btn-accent" onClick={() => onUpload(file)}>
            Analyze →
          </button>
        )}
      </div>
    </div>
  );
}
