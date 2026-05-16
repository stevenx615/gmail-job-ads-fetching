import { useState } from 'react';
import type { ScratchResume, ScratchExperience, ScratchEducation, ScratchPersonal } from './wizardTypes';

type SubStep = 'personal' | 'summary' | 'experience' | 'skills' | 'education';
const OPTIONAL_STEPS: SubStep[] = ['summary', 'experience', 'skills', 'education'];
const SUB_LABELS: Record<SubStep, string> = {
  personal: 'Personal Info',
  summary: 'Summary',
  experience: 'Work Experience',
  skills: 'Skills',
  education: 'Education',
};
const SUB_DESCS: Record<SubStep, string> = {
  personal: 'Your name, contact info, and links',
  summary: 'A brief overview of your background and goals',
  experience: 'Your work history and achievements',
  skills: 'Technical and soft skills',
  education: 'Degrees, certifications, and courses',
};

const EMPTY_EXP = (): ScratchExperience => ({ company: '', role: '', startDate: '', endDate: '', location: '', bullets: '' });
const EMPTY_EDU = (): ScratchEducation => ({ institution: '', degree: '', field: '', startDate: '', endDate: '' });

interface Props {
  onComplete: (scratch: ScratchResume) => void;
  onBack: () => void;
}

export function WizardStepScratch({ onComplete, onBack }: Props) {
  const [configured, setConfigured] = useState(false);
  const [included, setIncluded] = useState<Set<SubStep>>(new Set(OPTIONAL_STEPS));
  const [sub, setSub] = useState<SubStep>('personal');
  const [personal, setPersonal] = useState<ScratchPersonal>({ name: '', email: '', phone: '', linkedin: '', location: '', github: '', website: '' });
  const [summary, setSummary] = useState('');
  const [experience, setExperience] = useState<ScratchExperience[]>([EMPTY_EXP()]);
  const [skills, setSkills] = useState('');
  const [education, setEducation] = useState<ScratchEducation[]>([EMPTY_EDU()]);

  const activeSteps: SubStep[] = ['personal', ...OPTIONAL_STEPS.filter(s => included.has(s))];
  const idx = activeSteps.indexOf(sub);
  const isLast = idx === activeSteps.length - 1;

  function toggleSection(s: SubStep) {
    setIncluded(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  function handleBack() { idx === 0 ? onBack() : setSub(activeSteps[idx - 1]); }
  function handleNext() {
    if (isLast) onComplete({ personal, summary, experience, skills, education });
    else setSub(activeSteps[idx + 1]);
  }

  function setExp(i: number, patch: Partial<ScratchExperience>) {
    setExperience(prev => prev.map((e, j) => j === i ? { ...e, ...patch } : e));
  }
  function deleteExp(i: number) {
    setExperience(prev => prev.filter((_, j) => j !== i));
  }
  function setEdu(i: number, patch: Partial<ScratchEducation>) {
    setEducation(prev => prev.map((e, j) => j === i ? { ...e, ...patch } : e));
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

  /* ── Section picker ── */
  if (!configured) {
    return (
      <div className="wz-step">
        {progressBar}
        <div className="wz-header">
          <div className="wz-header-title-row">
            <svg className="wz-header-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
            </svg>
            <div className="wz-header-text">
              <div className="wz-title">Choose your sections</div>
              <div className="wz-subtitle">Select which sections to include in your resume.</div>
            </div>
          </div>
        </div>

        <div className="wz-section-picker">
          {/* Personal Info — always included, locked */}
          <div className="wz-section-pick-item wz-section-pick-locked">
            <div className="wz-section-pick-check wz-section-pick-check-on">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div className="wz-section-pick-info">
              <div className="wz-section-pick-name">{SUB_LABELS.personal}</div>
              <div className="wz-section-pick-desc">{SUB_DESCS.personal}</div>
            </div>
            <span className="wz-section-pick-required">Required</span>
          </div>

          {OPTIONAL_STEPS.map(s => {
            const on = included.has(s);
            return (
              <div key={s} className={`wz-section-pick-item${on ? ' wz-section-pick-on' : ''}`} onClick={() => toggleSection(s)}>
                <div className={`wz-section-pick-check${on ? ' wz-section-pick-check-on' : ''}`}>
                  {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <div className="wz-section-pick-info">
                  <div className="wz-section-pick-name">{SUB_LABELS[s]}</div>
                  <div className="wz-section-pick-desc">{SUB_DESCS[s]}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="wz-footer wz-footer-split">
          <button className="wz-back-btn" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <button className="nav-btn nav-btn-accent" onClick={() => { setSub('personal'); setConfigured(true); }}>
            Start Building
          </button>
        </div>
      </div>
    );
  }

  /* ── Section forms ── */
  return (
    <div className="wz-step">
      {progressBar}
      <div className="wz-scratch-sub">
        Section {idx + 1} of {activeSteps.length} · <strong>{SUB_LABELS[sub]}</strong>
      </div>

      {sub === 'personal' && (
        <div className="wz-scratch-form">
          <div className="wz-personal-tip">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '0.1rem', color: '#818cf8' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span><strong>Tips:</strong> In the workshop you can <strong>drag</strong> any section to reorder it and <strong>toggle</strong> individual fields on or off before exporting.</span>
          </div>
          <div className="wz-field"><label>Full Name</label><input value={personal.name} onChange={e => setPersonal(p => ({ ...p, name: e.target.value }))} placeholder="Jane Smith" /></div>
          <div className="wz-form-row">
            <div className="wz-field"><label>Email</label><input value={personal.email} onChange={e => setPersonal(p => ({ ...p, email: e.target.value }))} placeholder="jane@example.com" /></div>
            <div className="wz-field"><label>Phone</label><input value={personal.phone} onChange={e => setPersonal(p => ({ ...p, phone: e.target.value }))} placeholder="+1 555 000 0000" /></div>
          </div>
          <div className="wz-form-row">
            <div className="wz-field"><label>LinkedIn URL</label><input value={personal.linkedin} onChange={e => setPersonal(p => ({ ...p, linkedin: e.target.value }))} placeholder="linkedin.com/in/jane" /></div>
            <div className="wz-field"><label>Location</label><input value={personal.location} onChange={e => setPersonal(p => ({ ...p, location: e.target.value }))} placeholder="San Francisco, CA" /></div>
          </div>
          <div className="wz-form-row">
            <div className="wz-field"><label>GitHub</label><input value={personal.github} onChange={e => setPersonal(p => ({ ...p, github: e.target.value }))} placeholder="github.com/jane" /></div>
            <div className="wz-field"><label>Website</label><input value={personal.website} onChange={e => setPersonal(p => ({ ...p, website: e.target.value }))} placeholder="janesmith.dev" /></div>
          </div>
        </div>
      )}

      {sub === 'summary' && (
        <div className="wz-scratch-form">
          <div className="wz-field">
            <label>Professional Summary</label>
            <textarea className="wz-textarea-summary" value={summary} onChange={e => setSummary(e.target.value)} placeholder="Briefly describe your background, strengths, and what you're looking for…" />
          </div>
        </div>
      )}

      {sub === 'experience' && (
        <div className="wz-scratch-form">
          <div className="wz-exp-scroll">
            {experience.map((exp, i) => (
              <div key={i} className="wz-exp-block">
                <div className="wz-exp-block-header">
                  <span className="wz-exp-block-label">Position {i + 1}</span>
                  {experience.length > 1 && (
                    <button className="wz-exp-delete-btn" onClick={() => deleteExp(i)} title="Remove position">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                      Remove
                    </button>
                  )}
                </div>
                <div className="wz-form-row">
                  <div className="wz-field"><label>Company</label><input value={exp.company} onChange={e => setExp(i, { company: e.target.value })} placeholder="Acme Corp" /></div>
                  <div className="wz-field"><label>Role</label><input value={exp.role} onChange={e => setExp(i, { role: e.target.value })} placeholder="Frontend Engineer" /></div>
                </div>
                <div className="wz-form-row">
                  <div className="wz-field"><label>Start Date</label><input value={exp.startDate} onChange={e => setExp(i, { startDate: e.target.value })} placeholder="Jan 2022" /></div>
                  <div className="wz-field"><label>End Date</label><input value={exp.endDate} onChange={e => setExp(i, { endDate: e.target.value })} placeholder="Present" /></div>
                  <div className="wz-field"><label>Location</label><input value={exp.location} onChange={e => setExp(i, { location: e.target.value })} placeholder="Remote" /></div>
                </div>
                <div className="wz-field">
                  <label>Bullets (one per line)</label>
                  <textarea value={exp.bullets} onChange={e => setExp(i, { bullets: e.target.value })} placeholder={"Built scalable UI components with React\nReduced load time by 40% via code splitting"} />
                </div>
              </div>
            ))}
          </div>
          <button className="wz-add-link" onClick={() => setExperience(prev => [...prev, EMPTY_EXP()])}>+ Add another position</button>
        </div>
      )}

      {sub === 'skills' && (
        <div className="wz-scratch-form">
          <div className="wz-field">
            <label>Skills (comma-separated or one per line)</label>
            <textarea className="wz-textarea-skills" value={skills} onChange={e => setSkills(e.target.value)} placeholder={"React, TypeScript, Node.js\nSQL, REST APIs, Docker"} />
          </div>
        </div>
      )}

      {sub === 'education' && (
        <div className="wz-scratch-form">
          {education.map((edu, i) => (
            <div key={i} className="wz-exp-block">
              <div className="wz-field"><label>Institution</label><input value={edu.institution} onChange={e => setEdu(i, { institution: e.target.value })} placeholder="University of California, Berkeley" /></div>
              <div className="wz-form-row">
                <div className="wz-field"><label>Degree</label><input value={edu.degree} onChange={e => setEdu(i, { degree: e.target.value })} placeholder="B.S." /></div>
                <div className="wz-field"><label>Field</label><input value={edu.field} onChange={e => setEdu(i, { field: e.target.value })} placeholder="Computer Science" /></div>
              </div>
              <div className="wz-form-row">
                <div className="wz-field"><label>Start</label><input value={edu.startDate} onChange={e => setEdu(i, { startDate: e.target.value })} placeholder="2016" /></div>
                <div className="wz-field"><label>End</label><input value={edu.endDate} onChange={e => setEdu(i, { endDate: e.target.value })} placeholder="2020" /></div>
              </div>
            </div>
          ))}
          <button className="wz-add-link" onClick={() => setEducation(prev => [...prev, EMPTY_EDU()])}>+ Add another degree</button>
        </div>
      )}

      <div className="wz-footer wz-footer-split">
        <button className="wz-back-btn" onClick={handleBack}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>Back</button>
        <button className="nav-btn nav-btn-accent" onClick={handleNext}>
          {isLast ? 'Analyze' : 'Next Section'}
        </button>
      </div>
    </div>
  );
}
