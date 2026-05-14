# Workshop Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move resume upload inside `ResumeTailorWorkshop` behind a linear wizard (JD → Resume → AI Analysis → Workshop), removing resume state from `Dashboard` and adding a standalone workshop entry in the navbar.

**Architecture:** The wizard lives as early phases inside `ResumeTailorWorkshop` — no new top-level component. A `wizardStep` state machine controls which screen renders; when it reaches `'workshop'`, the existing workshop UI shows. Returning users (valid localStorage save found) skip to `'workshop'` immediately. Four new focused files handle wizard step UIs; `ResumeTailorWorkshop` wires them together.

**Tech Stack:** React 18, TypeScript strict, mammoth (DOCX extraction), existing `analyzeTailorSections` service, localStorage for save/restore.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/components/workshop/wizardTypes.ts` | `WizardStep` type, scratch data interfaces, `assembleResumeText()` |
| Create | `src/components/workshop/WizardStepJD.tsx` | Step 0 — editable job description |
| Create | `src/components/workshop/WizardStepResume.tsx` | Step 1 — upload DOCX or go to scratch |
| Create | `src/components/workshop/WizardStepScratch.tsx` | Step 2 — five-sub-step scratch form |
| Modify | `src/components/ResumeTailorWorkshop.tsx` | Remove old props; add wizard state + wiring; update `runAnalysis` |
| Modify | `src/components/Dashboard.tsx` | Remove all resume state, modal, sidebar section, `canTailorResume` |
| Modify | `src/App.tsx` | Add standalone "Workshop" button + state |
| Modify | `src/App.css` | Wizard step styles |

---

## Task 1: Wizard types and scratch assembly

**Files:**
- Create: `src/components/workshop/wizardTypes.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/components/workshop/wizardTypes.ts

export type WizardStep =
  | 'jd'
  | 'resume'
  | 'scratch'
  | 'analyzing'
  | 'workshop';

export interface ScratchPersonal {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  location: string;
}

export interface ScratchExperience {
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  location: string;
  bullets: string; // one bullet per line
}

export interface ScratchEducation {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
}

export interface ScratchResume {
  personal: ScratchPersonal;
  summary: string;
  experience: ScratchExperience[];
  skills: string;
  education: ScratchEducation[];
}

export function assembleResumeText(s: ScratchResume): string {
  const lines: string[] = [];
  const { personal, summary, experience, skills, education } = s;

  if (personal.name) lines.push(personal.name);
  const contact = [personal.email, personal.phone, personal.location].filter(Boolean);
  if (contact.length) lines.push(contact.join(' | '));
  if (personal.linkedin) lines.push(personal.linkedin);

  if (summary) lines.push('', 'SUMMARY', summary);

  if (experience.length) {
    lines.push('', 'EXPERIENCE');
    for (const e of experience) {
      const header = [e.company, e.role].filter(Boolean).join(' — ');
      const period = [e.startDate, e.endDate].filter(Boolean).join(' – ');
      const meta = [period, e.location].filter(Boolean).join(' | ');
      if (header) lines.push(header + (meta ? ' | ' + meta : ''));
      e.bullets.split('\n').filter(b => b.trim()).forEach(b => lines.push('• ' + b.trim()));
    }
  }

  if (skills) lines.push('', 'SKILLS', skills);

  if (education.length) {
    lines.push('', 'EDUCATION');
    for (const e of education) {
      const deg = [e.degree, e.field].filter(Boolean).join(' in ');
      const header = [e.institution, deg].filter(Boolean).join(' — ');
      const period = [e.startDate, e.endDate].filter(Boolean).join(' – ');
      if (header) lines.push(header + (period ? ' | ' + period : ''));
    }
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -20
```
Expected: no errors referencing `wizardTypes.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/components/workshop/wizardTypes.ts
git commit -m "feat: add wizard types and scratch resume assembly"
```

---

## Task 2: CSS for wizard steps

**Files:**
- Modify: `src/App.css` (append to end)

- [ ] **Step 1: Add wizard styles**

Append to the end of `src/App.css`:

```css
/* ── Wizard steps ──────────────────────────────────────────── */
.wz-step { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem 2rem; max-width: 640px; margin: 0 auto; }
.wz-header { display: flex; flex-direction: column; gap: 0.2rem; }
.wz-title { font-size: 1.1rem; font-weight: 700; color: var(--text-dark); }
.wz-subtitle { font-size: 0.78rem; color: var(--text-mid); }
.wz-progress { display: flex; align-items: center; justify-content: center; gap: 0; margin-bottom: 0.25rem; }
.wz-progress-dot { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; }
.wz-progress-dot.done { background: #16a34a; color: #fff; }
.wz-progress-dot.active { background: #6366f1; color: #fff; }
.wz-progress-dot.pending { background: var(--input-bg); border: 1.5px solid var(--card-border); color: var(--text-mid); }
.wz-progress-label { font-size: 9px; color: var(--text-mid); margin: 0 2px; }
.wz-progress-label.active { color: #a5b4fc; font-weight: 600; }
.wz-progress-line { width: 24px; height: 1.5px; background: var(--card-border); margin: 0 2px; }
.wz-progress-line.done { background: #16a34a; }
.wz-progress-line.active { background: #6366f1; }
.wz-jd-textarea { width: 100%; min-height: 160px; resize: vertical; background: var(--input-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 0.75rem; color: var(--text-dark); font-size: 0.85rem; line-height: 1.5; font-family: inherit; box-sizing: border-box; }
.wz-jd-textarea:focus { outline: none; border-color: #6366f1; }
.wz-warning { display: flex; align-items: center; gap: 0.5rem; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.3); border-radius: 7px; padding: 0.5rem 0.75rem; font-size: 0.8rem; color: #fbbf24; flex-wrap: wrap; }
.wz-skip-btn { background: none; border: none; color: #6366f1; font-size: 0.8rem; cursor: pointer; padding: 0; margin-left: auto; white-space: nowrap; }
.wz-skip-btn:hover { text-decoration: underline; }
.wz-footer { display: flex; justify-content: flex-end; padding-top: 0.5rem; }
.wz-footer-split { justify-content: space-between; align-items: center; }
.wz-back-btn { background: none; border: none; color: var(--text-mid); font-size: 0.85rem; cursor: pointer; padding: 0; }
.wz-back-btn:hover { color: var(--text-dark); }
.wz-resume-options { display: flex; gap: 1rem; }
.wz-resume-card { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 1.5rem 1rem; border-radius: 10px; cursor: pointer; text-align: center; transition: border-color 0.15s, background 0.15s; }
.wz-upload-card { background: rgba(22,163,74,0.05); border: 2px dashed rgba(22,163,74,0.4); }
.wz-upload-card:hover { background: rgba(22,163,74,0.09); border-color: rgba(22,163,74,0.7); }
.wz-scratch-card { background: rgba(99,102,241,0.05); border: 2px solid rgba(99,102,241,0.25); }
.wz-scratch-card:hover { background: rgba(99,102,241,0.09); border-color: rgba(99,102,241,0.5); }
.wz-card-icon { font-size: 1.75rem; }
.wz-card-title { font-size: 0.95rem; font-weight: 700; color: var(--text-dark); }
.wz-card-desc { font-size: 0.78rem; color: var(--text-mid); }
.wz-filename { font-size: 0.75rem; color: #4ade80; background: rgba(22,163,74,0.1); border-radius: 4px; padding: 0.2rem 0.5rem; word-break: break-all; }
.wz-scratch-sub { font-size: 0.75rem; color: var(--text-mid); text-align: center; padding: 0.25rem 0; }
.wz-scratch-form { display: flex; flex-direction: column; gap: 0.65rem; }
.wz-form-row { display: flex; gap: 0.65rem; }
.wz-form-row .wz-field { flex: 1; }
.wz-field { display: flex; flex-direction: column; gap: 0.3rem; }
.wz-field label { font-size: 0.72rem; font-weight: 600; color: var(--text-mid); text-transform: uppercase; letter-spacing: 0.04em; }
.wz-field input, .wz-field textarea { background: var(--input-bg); border: 1px solid var(--card-border); border-radius: 6px; padding: 0.45rem 0.65rem; color: var(--text-dark); font-size: 0.83rem; font-family: inherit; box-sizing: border-box; width: 100%; }
.wz-field input:focus, .wz-field textarea:focus { outline: none; border-color: #6366f1; }
.wz-field textarea { min-height: 80px; resize: vertical; line-height: 1.45; }
.wz-exp-block { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.6rem; }
.wz-add-link { background: none; border: none; color: #6366f1; font-size: 0.82rem; cursor: pointer; padding: 0; text-align: left; }
.wz-add-link:hover { text-decoration: underline; }
.wz-analyzing { display: flex; flex-direction: column; align-items: center; gap: 1.25rem; padding: 2rem 1rem; text-align: center; }
.wz-analyzing-title { font-size: 1rem; font-weight: 600; color: var(--text-dark); }
.wz-analyzing-sub { font-size: 0.8rem; color: var(--text-mid); margin-top: -0.75rem; }
.wz-analyzing-list { display: flex; flex-direction: column; gap: 0.6rem; width: 100%; max-width: 280px; }
.wz-analyzing-row { display: flex; align-items: center; gap: 0.6rem; }
.wz-analyzing-dot { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; }
.wz-analyzing-dot.done { background: #16a34a; color: #fff; }
.wz-analyzing-dot.active { background: #6366f1; }
.wz-analyzing-dot.pending { background: var(--input-bg); border: 1.5px solid var(--card-border); }
.wz-analyzing-bar-wrap { flex: 1; background: var(--input-bg); border-radius: 3px; height: 4px; overflow: hidden; }
.wz-analyzing-bar { height: 100%; border-radius: 3px; background: #6366f1; transition: width 0.4s ease; }
.wz-analyzing-label { font-size: 0.8rem; color: var(--text-mid); flex: 1; text-align: left; }
.wz-analyzing-label.active { color: #a5b4fc; }
.wz-error { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3); border-radius: 7px; padding: 0.75rem 1rem; color: #f87171; font-size: 0.85rem; display: flex; align-items: center; gap: 0.75rem; }
.wz-retry-btn { background: none; border: 1px solid rgba(239,68,68,0.4); border-radius: 5px; color: #f87171; font-size: 0.78rem; padding: 0.25rem 0.65rem; cursor: pointer; white-space: nowrap; }
.wz-retry-btn:hover { background: rgba(239,68,68,0.1); }
.wz-change-resume { background: none; border: none; color: var(--text-mid); font-size: 0.78rem; cursor: pointer; padding: 0; }
.wz-change-resume:hover { color: var(--text-dark); text-decoration: underline; }
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```
Expected: build succeeds (CSS errors would show here).

- [ ] **Step 3: Commit**

```bash
git add src/App.css
git commit -m "feat: add wizard CSS styles"
```

---

## Task 3: WizardStepJD component

**Files:**
- Create: `src/components/workshop/WizardStepJD.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/workshop/WizardStepJD.tsx
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
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run build 2>&1 | grep WizardStepJD
```
Expected: no output (no errors for this file).

- [ ] **Step 3: Commit**

```bash
git add src/components/workshop/WizardStepJD.tsx
git commit -m "feat: add WizardStepJD component"
```

---

## Task 4: WizardStepResume component

**Files:**
- Create: `src/components/workshop/WizardStepResume.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/workshop/WizardStepResume.tsx
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
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run build 2>&1 | grep WizardStepResume
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/workshop/WizardStepResume.tsx
git commit -m "feat: add WizardStepResume component"
```

---

## Task 5: WizardStepScratch component

**Files:**
- Create: `src/components/workshop/WizardStepScratch.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/workshop/WizardStepScratch.tsx
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
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run build 2>&1 | grep WizardStepScratch
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/workshop/WizardStepScratch.tsx
git commit -m "feat: add WizardStepScratch component with 5 sub-steps"
```

---

## Task 6: Wire wizard into ResumeTailorWorkshop

**Files:**
- Modify: `src/components/ResumeTailorWorkshop.tsx`

This task has the most changes. Apply them in sub-steps.

- [ ] **Step 1: Update imports (top of file)**

Add after the existing imports:
```typescript
import { WizardStepJD } from './workshop/WizardStepJD';
import { WizardStepResume } from './workshop/WizardStepResume';
import { WizardStepScratch } from './workshop/WizardStepScratch';
import type { WizardStep, ScratchResume } from './workshop/wizardTypes';
import { assembleResumeText } from './workshop/wizardTypes';
```

- [ ] **Step 2: Replace the Props interface**

Find and replace:
```typescript
interface Props {
  job: Job;
  resumeText: string;
  resumeDocxFile: File | null;
  resumeInputTab: 'upload' | 'paste';
  settings: AppSettings;
  onClose: () => void;
}
```

Replace with:
```typescript
interface Props {
  job: Job;
  settings: AppSettings;
  onClose: () => void;
}
```

- [ ] **Step 3: Update the function signature**

Find:
```typescript
export function ResumeTailorWorkshop({ job, resumeText, resumeDocxFile, resumeInputTab, settings, onClose }: Props) {
```

Replace with:
```typescript
export function ResumeTailorWorkshop({ job, settings, onClose }: Props) {
```

- [ ] **Step 4: Add wizard state (after `const isDark = ...` line)**

After this line:
```typescript
const isDark = currentTheme === 'dark';
```

Add:
```typescript
  const isStandalone = job.id === 'standalone';
  const [wizardStep, setWizardStep] = useState<WizardStep>(() => {
    if (isStandalone) return 'jd';
    const saved = loadTailorState(job.id);
    return saved?.analysis && isSaveCompatible(saved) ? 'workshop' : 'jd';
  });
  const [localJobDescription, setLocalJobDescription] = useState(
    job.description ? job.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : ''
  );
  const [wizardDocxFile, setWizardDocxFile] = useState<File | null>(null);
```

- [ ] **Step 5: Update `runAnalysis` to accept jobDesc parameter**

Find:
```typescript
  const runAnalysis = useCallback(async (resume: string) => {
    setPhase('analyzing');
    setError(null);
    setBuildDone(false);
    const jobDesc = job.description ? stripHtml(job.description) : `${job.title} at ${job.company}`;
    const result = await analyzeTailorSections(resume, jobDesc, job.title, job.company, settings);
```

Replace with:
```typescript
  const runAnalysis = useCallback(async (resume: string, jobDesc: string) => {
    setPhase('analyzing');
    setError(null);
    setBuildDone(false);
    const desc = jobDesc.trim() || `${job.title} at ${job.company}`;
    const result = await analyzeTailorSections(resume, desc, job.title, job.company, settings);
```

- [ ] **Step 6: Update `runAnalysis` deps array**

Find:
```typescript
  }, [job, settings]);
```
(the closing of `runAnalysis` useCallback)

Replace with:
```typescript
  }, [job, settings]); // localJobDescription passed at call site
```

- [ ] **Step 7: Replace the `init` useEffect**

Find the entire `useEffect` that calls `init()` (lines ~222–277). Replace it with:

```typescript
  // Restore saved state when opening directly into workshop
  useEffect(() => {
    if (wizardStep !== 'workshop') return;
    const saved = loadTailorState(job.id);
    if (!saved?.analysis || !isSaveCompatible(saved)) return;
    setAnalysis(saved.analysis);
    setSummary(saved.summary);
    setQualifications(saved.qualifications);
    setQualifOverrides(saved.qualifOverrides);
    setExperience(saved.experience);
    setBulletModes(saved.bulletModes);
    setSkills(saved.skills);
    setEducation((saved.education as (TailorEducation & { include: boolean } | { text: string; include: boolean } | string)[]).map(e => {
      if (typeof e === 'string') return { program: e, school: '', location: '', startDate: '', endDate: '', include: true };
      if ('text' in e) return { program: (e as { text: string; include: boolean }).text, school: '', location: '', startDate: '', endDate: '', include: (e as { include: boolean }).include };
      return e as TailorEducation & { include: boolean };
    }));
    if (Array.isArray(saved.customSections)) setCustomSections(saved.customSections as CustomSection[]);
    if (saved.showSummarySection !== undefined) setShowSummarySection(saved.showSummarySection);
    if (saved.showRequirementsSection !== undefined) setShowRequirementsSection(saved.showRequirementsSection);
    if (saved.showSkillsSection !== undefined) setShowSkillsSection(saved.showSkillsSection);
    if (saved.personalInfo) setPersonalInfo(saved.personalInfo);
    if (saved.personalInclude) setPersonalInclude(saved.personalInclude);
    if (saved.personalFieldOrder) setPersonalFieldOrder(saved.personalFieldOrder);
    if (Array.isArray(saved.skillCategoryOrder)) setSkillCategoryOrder(saved.skillCategoryOrder as string[]);
    else setSkillCategoryOrder(initSkillCategoryOrder(saved.skills ?? []));
    setPhase('review');
    setRestored(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Run analysis when wizard reaches 'analyzing' step
  useEffect(() => {
    if (wizardStep !== 'analyzing') return;
    const run = async () => {
      let plain = '';
      if (wizardDocxFile) {
        setPhase('extracting');
        try {
          const ab = await wizardDocxFile.arrayBuffer();
          plain = (await mammoth.extractRawText({ arrayBuffer: ab })).value;
        } catch {
          setError('Could not extract text from DOCX file.');
          setWizardStep('resume');
          return;
        }
      } else {
        plain = plainResume; // assembled scratch text stored before transition
      }
      setPlainResume(plain);
      await runAnalysis(plain, localJobDescription);
      setWizardStep('workshop');
    };
    run();
  }, [wizardStep]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 8: Update `reanalyze` to pass localJobDescription**

Find:
```typescript
  const reanalyze = () => { setRestored(false); runAnalysis(plainResume); };
```

Replace with:
```typescript
  const reanalyze = () => { setRestored(false); runAnalysis(plainResume, localJobDescription); };
```

- [ ] **Step 9: Add wizard handlers (after `reanalyze` line)**

```typescript
  function handleWizardJDNext(jd: string) {
    setLocalJobDescription(jd);
    setWizardStep('resume');
  }

  function handleWizardUpload(file: File) {
    setWizardDocxFile(file);
    setWizardStep('analyzing');
  }

  function handleWizardScratch() {
    setWizardStep('scratch');
  }

  function handleScratchComplete(scratch: ScratchResume) {
    setPlainResume(assembleResumeText(scratch));
    setWizardStep('analyzing');
  }

  function handleChangeResume() {
    localStorage.removeItem(storageKey(job.id));
    setWizardDocxFile(null);
    setPlainResume('');
    setWizardStep('resume');
  }
```

- [ ] **Step 10: Add wizard rendering before the existing return**

Find the line:
```typescript
  return (
    <div className="modal-overlay">
```

Insert before it:
```typescript
  // Wizard screens — rendered instead of the full workshop modal
  if (wizardStep === 'jd') {
    return (
      <div className="modal-overlay">
        <div className="modal-card" style={{ maxWidth: 680, width: '90vw' }}>
          <div className="modal-header">
            <div className="modal-title">Resume Tailor Workshop</div>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
          <WizardStepJD
            jobTitle={job.title ?? ''}
            jobCompany={job.company ?? ''}
            initialJD={localJobDescription}
            onNext={handleWizardJDNext}
          />
        </div>
      </div>
    );
  }

  if (wizardStep === 'resume') {
    return (
      <div className="modal-overlay">
        <div className="modal-card" style={{ maxWidth: 680, width: '90vw' }}>
          <div className="modal-header">
            <div className="modal-title">Resume Tailor Workshop</div>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
          <WizardStepResume
            onUpload={handleWizardUpload}
            onScratch={handleWizardScratch}
            onBack={() => setWizardStep('jd')}
          />
        </div>
      </div>
    );
  }

  if (wizardStep === 'scratch') {
    return (
      <div className="modal-overlay">
        <div className="modal-card" style={{ maxWidth: 680, width: '90vw' }}>
          <div className="modal-header">
            <div className="modal-title">Resume Tailor Workshop</div>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
          <WizardStepScratch
            onComplete={handleScratchComplete}
            onBack={() => setWizardStep('resume')}
          />
        </div>
      </div>
    );
  }

  if (wizardStep === 'analyzing') {
    return (
      <div className="modal-overlay">
        <div className="modal-card" style={{ maxWidth: 480, width: '90vw' }}>
          <div className="modal-header">
            <div className="modal-title">Resume Tailor Workshop</div>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
          <div className="wz-analyzing">
            <div className="wz-title">Analyzing your resume</div>
            <div className="wz-analyzing-sub">This takes about 10–20 seconds</div>
            {error ? (
              <div className="wz-error">
                <span>{error}</span>
                <button className="wz-retry-btn" onClick={() => { setError(null); setWizardStep('resume'); }}>← Back</button>
              </div>
            ) : (
              <div className="wz-analyzing-list">
                {['Extracting resume content', 'Matching requirements', 'Tailoring experience', 'Reviewing skills & education'].map((label, i) => {
                  const phaseOrder = ['extracting', 'analyzing', 'analyzing', 'analyzing'];
                  const isDone = phase === 'review' || (phase === 'analyzing' && i === 0);
                  const isActive = phase === phaseOrder[i] && !isDone;
                  return (
                    <div key={label} className="wz-analyzing-row">
                      <div className={`wz-analyzing-dot ${isDone ? 'done' : isActive ? 'active' : 'pending'}`}>
                        {isDone ? '✓' : ''}
                      </div>
                      <span className={`wz-analyzing-label ${isActive ? 'active' : ''}`}>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
```

- [ ] **Step 11: Add "Change Resume" button to workshop header**

In the existing workshop JSX, find the modal header section (around `modal-title` with "Resume Tailor Workshop"). After the close button, add:

```tsx
<button className="wz-change-resume" onClick={handleChangeResume} title="Change resume">
  ← Change Resume
</button>
```

Place it inside the `modal-header` div, before the close button.

- [ ] **Step 12: Build and verify**

```bash
npm run build 2>&1 | tail -10
```
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 13: Manual smoke test**
  - Run `npm run dev`
  - Open a job card → click Tailor (now always enabled) → verify wizard opens at Step 0 (JD pre-filled)
  - Click Next → Step 1 (Upload / Scratch cards)
  - Upload a `.docx` → click Analyze → see analyzing screen → workshop opens
  - Close and re-open same job → workshop opens directly (restored from localStorage)
  - Click "← Change Resume" → back to Step 1

- [ ] **Step 14: Commit**

```bash
git add src/components/ResumeTailorWorkshop.tsx
git commit -m "feat: wire wizard phases into ResumeTailorWorkshop"
```

---

## Task 7: Clean up Dashboard

**Files:**
- Modify: `src/components/Dashboard.tsx`

- [ ] **Step 1: Remove resume state declarations**

Remove these lines (approximately lines 38–48):
```typescript
const [resumeText, setResumeText] = useState(() => localStorage.getItem('resumeText') || '');
const [resumeModalOpen, setResumeModalOpen] = useState(false);
const [resumeDocxFile, setResumeDocxFile] = useState<File | null>(null);
const [docxPreviewHtml, setDocxPreviewHtml] = useState(() => localStorage.getItem('docxPreviewHtml') || '');
const [resumeInputTab, setResumeInputTab] = useState<'upload' | 'paste'>(
  () => (localStorage.getItem('resumeMode') as 'upload' | 'paste') || 'upload'
);
```

And remove these refs:
```typescript
const resumeEditorRef = useRef<HTMLDivElement>(null);
const docxInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 2: Remove resume-related useEffects**

Remove the two `useEffect` blocks that reference `resumeModalOpen` and `resumeInputTab` (the ones that sync `resumeEditorRef.current.innerHTML`).

Remove the `useEffect` block that restores DOCX from localStorage (the one with `localStorage.getItem('resumeDocxData')`).

- [ ] **Step 3: Remove `canTailorResume` function**

Remove:
```typescript
const canTailorResume = (job: Job) => {
  const hasResume = resumeInputTab === 'upload'
    ? !!resumeDocxFile
    : !!resumeText.replace(/<[^>]*>/g, '').trim();
  return !!job.description &&
    settings.aiProvider !== 'none' &&
    !!settings.aiApiKey &&
    hasResume;
};
```

- [ ] **Step 4: Make Tailor button always render**

Find the Tailor button render (currently inside `{canTailorResume(job) && (`). Change to always render it, with a disabled state only when no AI provider is configured:

```tsx
<button
  className="job-tailor-btn"
  onClick={() => setTailorModalJob(job)}
  disabled={settings.aiProvider === 'none' || !settings.aiApiKey}
  title={settings.aiProvider === 'none' || !settings.aiApiKey ? 'Configure an AI provider in Settings to use this feature' : 'Tailor resume to this job'}
>
  Tailor
</button>
```

- [ ] **Step 5: Remove resume sidebar section**

Find and remove the entire resume sidebar block in the JSX — the section containing `.resume-sidebar-header`, `.resume-mode-badge`, `.resume-sidebar-file`, and the "Add Resume" / "Edit Resume" button.

- [ ] **Step 6: Remove "My Resume" modal JSX**

Remove the entire `{resumeModalOpen && ( ... )}` block (approximately lines 835–1020 in the original file), which includes the modal overlay, tabs (upload/paste), DOCX input, the contenteditable editor, and Done buttons.

- [ ] **Step 7: Update ResumeTailorWorkshop invocation**

Find:
```tsx
{tailorModalJob && (
  <ResumeTailorWorkshop
    job={tailorModalJob}
    resumeText={resumeText}
    resumeDocxFile={resumeDocxFile}
    resumeInputTab={resumeInputTab}
    settings={settings}
    onClose={closeTailorModal}
  />
)}
```

Replace with:
```tsx
{tailorModalJob && (
  <ResumeTailorWorkshop
    job={tailorModalJob}
    settings={settings}
    onClose={closeTailorModal}
  />
)}
```

- [ ] **Step 8: Build and verify**

```bash
npm run build 2>&1 | tail -10
```
Expected: no errors. If TypeScript complains about removed variables still being referenced somewhere, track down and remove those references too.

- [ ] **Step 9: Commit**

```bash
git add src/components/Dashboard.tsx
git commit -m "feat: remove resume state and modal from Dashboard"
```

---

## Task 8: Add standalone Workshop entry in navbar

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ResumeTailorWorkshop.tsx` (STANDALONE_JOB constant)

- [ ] **Step 1: Add STANDALONE_JOB constant to ResumeTailorWorkshop**

At the top of `src/components/ResumeTailorWorkshop.tsx`, after the imports, add:

```typescript
export const STANDALONE_JOB: Job = {
  id: 'standalone',
  title: '',
  company: '',
  location: '',
  url: '',
  source: 'manual' as const,
  type: '',
  tags: [],
  emailId: '',
  dateReceived: '',
  saved: false,
  applied: false,
  description: '',
  createdAt: null,
};
```

Adjust any fields to satisfy the `Job` type exactly — check `src/types/index.ts` for the full required shape and add any missing fields with empty/falsy defaults.

- [ ] **Step 2: Update App.tsx imports**

In `src/App.tsx`, add to existing imports:
```typescript
import { ResumeTailorWorkshop, STANDALONE_JOB } from './components/ResumeTailorWorkshop';
```

- [ ] **Step 3: Add Workshop state in AppContent**

In `AppContent`, add after the existing `useState` declarations:
```typescript
const [showWorkshop, setShowWorkshop] = useState(false);
```

- [ ] **Step 4: Add Workshop button to navbar**

In the navbar `<div className="navbar-actions">`, add the Workshop button before the Applications button:

```tsx
<button
  className="nav-btn nav-btn-outline"
  onClick={() => setShowWorkshop(true)}
  title="Open Resume Workshop"
>
  Workshop
</button>
```

- [ ] **Step 5: Render standalone Workshop modal**

After the existing `{showDebug && ...}` block, add:

```tsx
{showWorkshop && (
  <ResumeTailorWorkshop
    job={STANDALONE_JOB}
    settings={getSettings()}
    onClose={() => setShowWorkshop(false)}
  />
)}
```

Note: `getSettings()` is already imported. If `settings` is a prop/state passed differently in `AppContent`, use that reference instead.

- [ ] **Step 6: Build and verify**

```bash
npm run build 2>&1 | tail -10
```
Expected: clean build.

- [ ] **Step 7: Manual smoke test**
  - Click "Workshop" in navbar → wizard opens with blank JD (Step 0 blank)
  - Paste a JD → Next → Resume step → choose Scratch → fill some fields → Analyze → workshop opens
  - Close and re-open Workshop from navbar → wizard starts fresh (not restored, since id=standalone)

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/ResumeTailorWorkshop.tsx
git commit -m "feat: add standalone Workshop button to navbar"
```

---

## Self-Review Notes

- **Spec coverage:** All wizard steps (JD, Resume, Scratch, Analyzing) ✓ · returning-user shortcut ✓ · standalone entry ✓ · "Change Resume" link ✓ · Dashboard cleanup ✓ · props interface change ✓ · `localJobDescription` for analysis ✓ · skip JD warning ✓
- **Scratch path to analyzing:** `WizardStepScratch.onComplete` → `handleScratchComplete` sets `plainResume` from `assembleResumeText`, then sets `wizardStep = 'analyzing'`. The analyzing `useEffect` reads `plainResume` (not `wizardDocxFile`) since `wizardDocxFile` is null on scratch path. ✓
- **Upload path to analyzing:** `handleWizardUpload` sets `wizardDocxFile` + `wizardStep = 'analyzing'`. The analyzing `useEffect` reads `wizardDocxFile`, extracts text, sets `plainResume`. ✓
- **`reanalyze`:** Uses `plainResume` (set during wizard) + `localJobDescription`. Works in same session; empty on restore (known limitation — user can "Change Resume" to re-run wizard). ✓
- **Job type:** `STANDALONE_JOB` must satisfy the exact `Job` interface. Verify against `src/types/index.ts` before committing Task 8.
