import { useState } from 'react';
import type { ScratchResume, ScratchExperience, ScratchEducation, ScratchPersonal } from './wizardTypes';

type SubStep = 'personal' | 'summary' | 'experience' | 'skills' | 'education';
const SUB_STEPS: SubStep[] = ['personal', 'summary', 'experience', 'skills', 'education'];
const SUB_LABELS: Record<SubStep, string> = {
  personal: 'Personal Info',
  summary: 'Summary',
  experience: 'Work Experience',
  skills: 'Skills',
  education: 'Education',
};

const EMPTY_EXP = (): ScratchExperience => ({ company: '', role: '', startDate: '', endDate: '', location: '', bullets: '' });
const EMPTY_EDU = (): ScratchEducation => ({ institution: '', degree: '', field: '', startDate: '', endDate: '' });

interface Props {
  onComplete: (scratch: ScratchResume) => void;
  onBack: () => void;
}

export function WizardStepScratch({ onComplete, onBack }: Props) {
  const [sub, setSub] = useState<SubStep>('personal');
  const [personal, setPersonal] = useState<ScratchPersonal>({ name: '', email: '', phone: '', linkedin: '', location: '' });
  const [summary, setSummary] = useState('');
  const [experience, setExperience] = useState<ScratchExperience[]>([EMPTY_EXP()]);
  const [skills, setSkills] = useState('');
  const [education, setEducation] = useState<ScratchEducation[]>([EMPTY_EDU()]);

  const idx = SUB_STEPS.indexOf(sub);
  const isFirst = idx === 0;
  const isLast = idx === SUB_STEPS.length - 1;

  function handleBack() { isFirst ? onBack() : setSub(SUB_STEPS[idx - 1]); }
  function handleNext() {
    if (isLast) onComplete({ personal, summary, experience, skills, education });
    else setSub(SUB_STEPS[idx + 1]);
  }

  function setExp(i: number, patch: Partial<ScratchExperience>) {
    setExperience(prev => prev.map((e, j) => j === i ? { ...e, ...patch } : e));
  }
  function setEdu(i: number, patch: Partial<ScratchEducation>) {
    setEducation(prev => prev.map((e, j) => j === i ? { ...e, ...patch } : e));
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
      <div className="wz-scratch-sub">
        Section {idx + 1} of {SUB_STEPS.length} · <strong>{SUB_LABELS[sub]}</strong>
      </div>

      {sub === 'personal' && (
        <div className="wz-scratch-form">
          <div className="wz-field"><label>Full Name</label><input value={personal.name} onChange={e => setPersonal(p => ({ ...p, name: e.target.value }))} placeholder="Jane Smith" /></div>
          <div className="wz-form-row">
            <div className="wz-field"><label>Email</label><input value={personal.email} onChange={e => setPersonal(p => ({ ...p, email: e.target.value }))} placeholder="jane@example.com" /></div>
            <div className="wz-field"><label>Phone</label><input value={personal.phone} onChange={e => setPersonal(p => ({ ...p, phone: e.target.value }))} placeholder="+1 555 000 0000" /></div>
          </div>
          <div className="wz-form-row">
            <div className="wz-field"><label>LinkedIn URL</label><input value={personal.linkedin} onChange={e => setPersonal(p => ({ ...p, linkedin: e.target.value }))} placeholder="linkedin.com/in/jane" /></div>
            <div className="wz-field"><label>Location</label><input value={personal.location} onChange={e => setPersonal(p => ({ ...p, location: e.target.value }))} placeholder="San Francisco, CA" /></div>
          </div>
        </div>
      )}

      {sub === 'summary' && (
        <div className="wz-scratch-form">
          <div className="wz-field">
            <label>Professional Summary</label>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} placeholder="Briefly describe your background, strengths, and what you're looking for…" style={{ minHeight: 120 }} />
          </div>
        </div>
      )}

      {sub === 'experience' && (
        <div className="wz-scratch-form">
          {experience.map((exp, i) => (
            <div key={i} className="wz-exp-block">
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
          <button className="wz-add-link" onClick={() => setExperience(prev => [...prev, EMPTY_EXP()])}>+ Add another position</button>
        </div>
      )}

      {sub === 'skills' && (
        <div className="wz-scratch-form">
          <div className="wz-field">
            <label>Skills (comma-separated or one per line)</label>
            <textarea value={skills} onChange={e => setSkills(e.target.value)} placeholder={"React, TypeScript, Node.js\nSQL, REST APIs, Docker"} style={{ minHeight: 100 }} />
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
        <button className="wz-back-btn" onClick={handleBack}>← Back</button>
        <button className="nav-btn nav-btn-accent" onClick={handleNext}>
          {isLast ? 'Analyze →' : 'Next Section →'}
        </button>
      </div>
    </div>
  );
}
