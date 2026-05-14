# Workshop Wizard Design

**Date:** 2026-05-14  
**Status:** Approved

## Overview

Move resume upload into the Resume Tailor Workshop, and add a guided wizard that leads the user through job description → resume entry → AI analysis before the existing workshop UI is shown. The wizard lives as prepended phases inside `ResumeTailorWorkshop` — no new top-level component, no state handoff.

---

## Entry Points

| Trigger | Behaviour |
|---------|-----------|
| Job card → Tailor button | Workshop opens with Step 0 pre-filled from `job.description`, `job.title`, `job.company` |
| Standalone "New Workshop" button (navbar or Dashboard) | Workshop opens with Step 0 blank |
| Job already analyzed (localStorage save exists) | Wizard skipped entirely — opens directly in Workshop |

The "Tailor" button on job cards is **always enabled** — no resume gate before opening. The resume gate moves inside the wizard.

---

## Wizard Steps

### Step 0 — Job Description

- Shows the job title + company in the header.
- Editable textarea pre-populated with `job.description` (from card) or empty (standalone).
- If textarea is empty: amber warning bar — _"Without a job description, AI tailoring will be less targeted."_ — with a **"Skip for now →"** link that advances to Step 1.
- If textarea has content: **Next →** button enabled.

### Step 1 — Resume Entry

Two mutually exclusive options shown as cards:

**Upload DOCX**
- Drag-and-drop area + "Choose File" button (`.docx` only).
- On file selected: filename shown, Next → enabled.
- Advances directly to Step 3 (AI Analysis) — skips all scratch sub-steps.

**Build from Scratch**
- Clicking "Start →" advances to Step 2 (scratch sub-steps).

### Step 2 — Scratch Sections _(Upload path skips this entirely)_

One sub-step per section, navigated with Back / Next Section buttons:

| Sub-step | Fields |
|----------|--------|
| Personal Info | Name, Email, Phone, LinkedIn URL, Location |
| Summary | Textarea — professional summary |
| Work Experience | Repeating block: Company, Role, Start, End, Location, Bullets (one per line). "+ Add another position" link. |
| Skills | Tag-style input — comma-separated or one per line |
| Education | Repeating block: Institution, Degree, Field, Start, End |

All fields optional — user can leave any section blank and proceed.

### Step 3 — AI Analysis

- Runs `analyzeTailorSections()` exactly as today, using either the extracted DOCX text or the assembled scratch-section text.
- Progress displayed per section (Requirements → Experience → Skills → Education → Summary) with a per-item progress bar and ✓ tick on completion.
- No user interaction required — auto-advances to Workshop when analysis finishes.
- On error: inline error message with Retry button.

### Workshop

Existing workshop UI, unchanged. All current tabs (Requirements, Experience, Skills, Education, Preview, Export) remain as-is.

A small **"← Change Resume"** link in the workshop header allows returning to Step 1 (clears saved analysis state and re-runs wizard from resume entry).

---

## Returning Users

If `localStorage` contains a compatible `tailor_ws_{jobId}` entry (checked via `isSaveCompatible()`), the wizard is skipped and the component opens directly in Workshop state. This preserves the existing fast-reload behaviour.

Standalone sessions (`job.id === 'standalone'`) are excluded from this shortcut — they always start from Step 0.

---

## Standalone Entry Point

A **"Resume Workshop"** button is added to the navbar (or Dashboard sidebar). It opens `ResumeTailorWorkshop` with a synthetic blank job object (`id: 'standalone'`, `description: ''`, `title: ''`, `company: ''`). The wizard starts at Step 0 with an empty JD textarea.

---

## State Machine

```
wizardStep: 'jd' | 'resume' | 'scratch-personal' | 'scratch-summary'
          | 'scratch-experience' | 'scratch-skills' | 'scratch-education'
          | 'analyzing' | 'workshop'
```

Transitions:
- `jd` → `resume` (Next or Skip)
- `resume` → `analyzing` (Upload path)
- `resume` → `scratch-personal` (Scratch path)
- `scratch-*` → next scratch sub-step → `analyzing`
- `analyzing` → `workshop` (auto on success)
- `workshop` → `resume` ("Change Resume" link — clears analysis)

---

## Data Flow

**Upload path:**
1. User picks `.docx` file → stored as `File` in component state.
2. On Analyze: `mammoth.extractRawText()` → plain text → `analyzeTailorSections(plainText, jobDescription, settings)`.

**Scratch path:**
1. Scratch section states assembled into a plain-text resume string (same format mammoth would produce).
2. Same `analyzeTailorSections()` call — no special handling needed.

**Scratch resume assembly format:**
```
{name}
{email} | {phone} | {location}
{linkedin}

SUMMARY
{summary}

EXPERIENCE
{company} — {role} | {startDate} – {endDate} | {location}
• {bullet}
• {bullet}

SKILLS
{skills}

EDUCATION
{institution} — {degree} in {field} | {startDate} – {endDate}
```

---

## Props Interface Change

`ResumeTailorWorkshop` **removes** the props `resumeText`, `resumeDocxFile`, and `resumeInputTab` — these become internal state. The only props retained are `job`, `settings`, and `onClose`. `Dashboard.tsx` drops the corresponding state and the "My Resume" modal entirely once this ships.

## What Doesn't Change

- All existing workshop tabs, AI tailoring logic, DOCX export, and localStorage persistence are untouched.
- The job description used for analysis is the (potentially user-edited) value from Step 0, stored as `localJobDescription` in component state — not `job.description` directly.

---

## Out of Scope

- Paste-text resume input (upload and scratch cover the use cases; paste mode is removed).
- Multi-job comparison within the wizard.
- Saving scratch resume as a reusable template.
