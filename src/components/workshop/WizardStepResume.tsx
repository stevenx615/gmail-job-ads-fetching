import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import mammoth from 'mammoth';
import { getSavedResumes, saveResume, deleteResume, renameResume, duplicateResume, daysAgo } from './resumeStorage';
import type { SavedResume } from './resumeStorage';

interface Props {
  onUpload: (file: File) => void;
  onScratch: () => void;
  onBack: () => void;
  onSelectResume?: (content: string, resumeId?: string) => void;
  hasExistingAnalysis?: boolean;
  onGoToWorkshop?: (content: string, resumeId?: string) => void;
  analyzedResumeId?: string | null;
}

export function WizardStepResume({ onUpload, onScratch, onBack, onSelectResume, hasExistingAnalysis, onGoToWorkshop, analyzedResumeId }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [savedResumes, setSavedResumes] = useState<SavedResume[]>(() => getSavedResumes());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [extractedContent, setExtractedContent] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  function openMenu(id: string, btn: HTMLButtonElement) {
    const rect = btn.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuOpenId(id);
    menuTriggerRef.current = btn;
  }

  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        menuTriggerRef.current && !menuTriggerRef.current.contains(target)
      ) setMenuOpenId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  const hasSaved = savedResumes.length > 0;
  const selectedResume = selectedId ? savedResumes.find(r => r.id === selectedId) ?? null : null;
  const previewResume = previewId ? savedResumes.find(r => r.id === previewId) ?? null : null;

  async function handleFileSelected(f: File) {
    setFile(f);
    setExtracting(true);
    setExtractedContent(null);
    setExtractError(false);
    try {
      const ab = await f.arrayBuffer();
      const [plainResult, htmlResult] = await Promise.all([
        mammoth.extractRawText({ arrayBuffer: ab }),
        mammoth.convertToHtml({ arrayBuffer: ab }),
      ]);
      const plain = plainResult.value;
      const html = htmlResult.value;
      const saved = saveResume({ name: f.name, type: 'docx', content: plain, preview: plain.slice(0, 150), html });
      setSavedResumes(getSavedResumes());
      setExtractedContent(plain);
      setSelectedId(saved.id);
    } catch {
      setExtractError(true);
    } finally {
      setExtracting(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith('.docx')) handleFileSelected(f);
  }

  function startRename(r: { id: string; name: string }) {
    setConfirmDeleteId(null);
    setMenuOpenId(null);
    setRenamingId(r.id);
    setRenameValue(r.name);
    setRenameError('');
    setTimeout(() => renameInputRef.current?.select(), 0);
  }

  function handleDuplicate(id: string) {
    setMenuOpenId(null);
    duplicateResume(id);
    setSavedResumes(getSavedResumes());
  }

  function commitRename() {
    if (!renamingId) return;
    const name = renameValue.trim();
    if (!name) { setRenamingId(null); setRenameError(''); return; }
    const duplicate = savedResumes.some(r => r.id !== renamingId && r.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) { setRenameError('A resume with this name already exists.'); renameInputRef.current?.focus(); return; }
    renameResume(renamingId, name);
    setSavedResumes(getSavedResumes());
    setRenamingId(null);
    setRenameError('');
  }

  function handleDelete(id: string) {
    deleteResume(id);
    setSavedResumes(getSavedResumes());
    if (previewId === id) setPreviewId(null);
    if (selectedId === id) setSelectedId(null);
    setConfirmDeleteId(null);
  }

  function handleAnalyze() {
    if (extractedContent && selectedId) {
      onSelectResume?.(extractedContent, selectedId);
    } else if (file) {
      onUpload(file);
    }
  }

  const progressBar = (
    <div className="wz-progress-bar">
      <div className="wz-progress-step done">
        <div className="wz-progress-dot">✓</div>
        <span className="wz-progress-label">Job Description</span>
      </div>
      <div className="wz-progress-line done" />
      <div className="wz-progress-step active">
        <div className="wz-progress-dot">2</div>
        <span className="wz-progress-label">Resume</span>
      </div>
      <div className="wz-progress-line" />
      <div className="wz-progress-step pending">
        <div className="wz-progress-dot">3</div>
        <span className="wz-progress-label">Analyze</span>
      </div>
    </div>
  );

  const tipsPanel = (
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
        <span>Tips for best results</span>
      </div>
      <div className="wz-tip-item">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
        </svg>
        <span>Choose the resume closest to the target role</span>
      </div>
      <div className="wz-tip-item">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
        </svg>
        <span>You can still edit after analysis</span>
      </div>
      <div className="wz-tip-item">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <span>We will compare it against the job description</span>
      </div>
      <div className="wz-tip-privacy">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>All files are stored securely. We respect your privacy.</span>
      </div>
    </div>
  );

  /* ── Layout A: no saved resumes ── */
  if (!hasSaved) {
    const uploadDesc = extracting ? 'Reading file…' : extractError ? 'Could not read file. Try again.' : file ? `📎 ${file.name}` : 'Drag & drop or click to browse';
    return (
      <div className="wz-step">
        {progressBar}
        <div className="wz-header">
          <div className="wz-header-title-row">
            <svg className="wz-header-icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z"/></svg>
            <div className="wz-header-text">
              <div className="wz-title">How would you like to provide your resume?</div>
              <div className="wz-subtitle">Choose the option that works best for you.</div>
            </div>
          </div>
        </div>
        <div className="wz-resume-body">
          <div className="wz-resume-options">
            <div className="wz-resume-option wz-option-upload" onClick={() => !extracting && inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
              <div className="wz-option-icon wz-option-icon-upload">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <polyline points="9 15 12 12 15 15"/>
                </svg>
              </div>
              <div className="wz-option-text">
                <div className="wz-option-title">Upload DOCX</div>
                <div className="wz-option-desc">{uploadDesc}</div>
              </div>
              <div className="wz-option-recommended">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z"/></svg>
                Recommended
              </div>
              <input ref={inputRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="wz-file-input-hidden" onChange={e => { if (e.target.files?.[0]) handleFileSelected(e.target.files[0]); }} />
            </div>
            <div className="wz-resume-option wz-option-scratch" onClick={onScratch}>
              <div className="wz-option-icon wz-option-icon-scratch">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                </svg>
              </div>
              <div className="wz-option-text">
                <div className="wz-option-title">Build from Scratch</div>
                <div className="wz-option-desc">Fill in your info section by section.<br/>AI tailors each one.</div>
              </div>
              <svg className="wz-option-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
          {tipsPanel}
        </div>
        <div className="wz-footer wz-footer-split">
          <button className="wz-back-btn" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          {file && !extracting && (
            <button className="nav-btn nav-btn-accent" onClick={handleAnalyze}>Analyze</button>
          )}
        </div>
      </div>
    );
  }

  /* ── Layout B: has saved resumes ── */
  const newUploadLabel = extracting ? 'Reading file…' : file ? `📎 ${file.name}` : 'Upload new DOCX';

  return (
    <div className="wz-step">
      {progressBar}
      <div className="wz-header">
        <div className="wz-header-title-row">
          <svg className="wz-header-icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z"/></svg>
          <div className="wz-header-text">
            <div className="wz-title">Choose a resume</div>
            <div className="wz-subtitle">Select a saved resume or add a new one.</div>
          </div>
        </div>
      </div>

      <div className="wz-resume-body">
        <div className="wz-resume-explorer-col">
          {/* Saved resume list card */}
          <div className="wz-re-list-card">
            <div className="wz-re-list-card-title">Saved resumes</div>
            <div className="wz-resume-explorer">
              {savedResumes.map(r => (
                <div key={r.id} className={`wz-re-card${selectedId === r.id ? ' active' : ''}`} onClick={() => renamingId !== r.id && setSelectedId(selectedId === r.id ? null : r.id)}>
                  <div className="wz-re-card-icon">
                    {r.type === 'docx'
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                    }
                  </div>
                  <div className="wz-re-card-info">
                    {renamingId === r.id ? (
                      <>
                        <input
                          ref={renameInputRef}
                          className={`wz-re-rename-input${renameError ? ' wz-re-rename-input-error' : ''}`}
                          value={renameValue}
                          onChange={e => { setRenameValue(e.target.value); setRenameError(''); }}
                          onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setRenamingId(null); setRenameError(''); } }}
                          onBlur={commitRename}
                          onClick={e => e.stopPropagation()}
                        />
                        {renameError && <div className="wz-re-rename-error">{renameError}</div>}
                      </>
                    ) : (
                      <div className="wz-re-card-name">{r.name}</div>
                    )}
                    <div className="wz-re-card-meta">Updated {daysAgo(r.uploadedAt)} · {r.type === 'docx' ? 'DOCX' : 'Scratch'}</div>
                  </div>
                  <div className="wz-re-card-actions" onClick={e => e.stopPropagation()}>
                    {renamingId === r.id ? (
                      <>
                        <button className="wz-re-btn wz-re-btn-confirm" onMouseDown={e => { e.preventDefault(); commitRename(); }} title="Save name">✓</button>
                        <button className="wz-re-btn" onMouseDown={e => { e.preventDefault(); setRenamingId(null); }} title="Cancel">✕</button>
                      </>
                    ) : confirmDeleteId === r.id ? (
                      <>
                        <span className="wz-re-confirm-label">Remove?</span>
                        <button className="wz-re-btn wz-re-btn-danger" onClick={() => handleDelete(r.id)}>Yes</button>
                        <button className="wz-re-btn" onClick={() => setConfirmDeleteId(null)}>No</button>
                      </>
                    ) : (
                      <>
                        {r.id === analyzedResumeId && hasExistingAnalysis && (
                          <span className="wz-re-analyzed-badge">Analyzed</span>
                        )}
                        <button className="wz-re-btn" onClick={() => setPreviewId(r.id)}>Preview</button>
                        <button
                          className={`wz-re-menu-btn${menuOpenId === r.id ? ' active' : ''}`}
                          onClick={e => menuOpenId === r.id ? setMenuOpenId(null) : openMenu(r.id, e.currentTarget)}
                          title="More actions"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Add new — same style as Layout A option cards, row layout */}
          <div className="wz-resume-options wz-resume-options-row">
            <div className="wz-resume-option wz-option-upload" onClick={() => !extracting && inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
              <div className="wz-option-icon wz-option-icon-upload">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <polyline points="9 15 12 12 15 15"/>
                </svg>
              </div>
              <div className="wz-option-text">
                <div className="wz-option-title">Upload DOCX</div>
                <div className="wz-option-desc">{newUploadLabel}</div>
              </div>
              <input ref={inputRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="wz-file-input-hidden" onChange={e => { if (e.target.files?.[0]) handleFileSelected(e.target.files[0]); }} />
            </div>
            <div className="wz-resume-option wz-option-scratch" onClick={onScratch}>
              <div className="wz-option-icon wz-option-icon-scratch">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                </svg>
              </div>
              <div className="wz-option-text">
                <div className="wz-option-title">Build from Scratch</div>
                <div className="wz-option-desc">Fill in your info section by section.<br/>AI tailors each one.</div>
              </div>
              <svg className="wz-option-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        </div>

        {tipsPanel}
      </div>

      <div className="wz-footer wz-footer-split">
        <button className="wz-back-btn" onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        {selectedResume && (
          hasExistingAnalysis && selectedResume.id === analyzedResumeId
            ? <button className="nav-btn nav-btn-green" onClick={() => onGoToWorkshop?.(selectedResume.content, selectedResume.id)}>Go to Workshop</button>
            : <button className="nav-btn nav-btn-accent" onClick={() => onSelectResume?.(selectedResume.content, selectedResume.id)}>Analyze</button>
        )}
      </div>

      {/* Three-dots dropdown — portaled to body to escape overflow:hidden ancestors */}
      {menuOpenId && menuPos && (() => {
        const r = savedResumes.find(x => x.id === menuOpenId);
        if (!r) return null;
        return createPortal(
          <div ref={menuRef} className="wz-re-menu-dropdown" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}>
            <button className="wz-re-menu-item" onClick={() => startRename(r)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
              Rename
            </button>
            <button className="wz-re-menu-item" onClick={() => handleDuplicate(r.id)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Duplicate
            </button>
            <div className="wz-re-menu-divider" />
            <button className="wz-re-menu-item wz-re-menu-item-danger" onClick={() => { setMenuOpenId(null); setConfirmDeleteId(r.id); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              Delete
            </button>
          </div>,
          document.body
        );
      })()}

      {/* Resume preview modal-on-modal */}
      {previewResume && (
        <div className="wz-preview-overlay" onClick={() => setPreviewId(null)}>
          <div className="wz-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="wz-preview-modal-header">
              <span className="wz-preview-modal-name">{previewResume.name}</span>
              <button className="wz-re-preview-close" onClick={() => setPreviewId(null)}>✕</button>
            </div>
            {previewResume.html
              ? <div className="wz-preview-modal-body wz-preview-html" dangerouslySetInnerHTML={{ __html: previewResume.html }} />
              : <pre className="wz-preview-modal-body">{previewResume.content}</pre>
            }
          </div>
        </div>
      )}
    </div>
  );
}
