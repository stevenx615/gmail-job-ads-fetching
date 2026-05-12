import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, ExternalHyperlink } from 'docx';
import type { Job } from '../types';
import type { AppSettings } from '../types/settings';
import type { TailorAnalysis, TailorQualification, TailorExperience, TailorSkill, TailorOtherSection, TailorEducation } from '../types/ai';
import { analyzeTailorSections, regenerateBullet, regenerateQualification } from '../services/aiService';

interface Props {
  job: Job;
  resumeText: string;
  resumeDocxFile: File | null;
  resumeInputTab: 'upload' | 'paste';
  settings: AppSettings;
  onClose: () => void;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const storageKey = (jobId: string) => `tailor_ws_${jobId}`;

function loadTailorState(jobId: string) {
  try {
    const raw = localStorage.getItem(storageKey(jobId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveTailorState(jobId: string, data: object) {
  try { localStorage.setItem(storageKey(jobId), JSON.stringify(data)); } catch {}
}

// Returns false if the save is missing fields added in recent schema updates,
// so the workshop falls back to fresh AI analysis instead of restoring stale data.
function isSaveCompatible(saved: Record<string, unknown>): boolean {
  // Education must be structured objects with a 'program' field
  const edu = saved.education as unknown[];
  if (Array.isArray(edu) && edu.length > 0) {
    const e = edu[0] as Record<string, unknown>;
    if (typeof e === 'string' || ('text' in e && !('program' in e))) return false;
  }
  // Experience entries must have a 'location' field
  const exp = saved.experience as unknown[];
  if (Array.isArray(exp) && exp.length > 0) {
    if (!('location' in (exp[0] as Record<string, unknown>))) return false;
  }
  return true;
}

function scoreColor(s: number) {
  if (s >= 90) return '#3fa163';
  if (s >= 75) return '#f59e0b';
  if (s >= 60) return '#f97316';
  return '#ef4444';
}
function scoreLabel(s: number) {
  if (s >= 90) return 'Excellent';
  if (s >= 75) return 'Good';
  if (s >= 60) return 'Fair';
  return 'Needs Work';
}

type BulletMode = 'tailored' | 'original';
type TabKey = 'all' | 'matched' | 'partial' | 'none';
type SectionKey = 'personal' | 'summary' | 'requirements' | 'experience' | 'skills' | 'education' | 'other';

interface PersonalInfo { name: string; email: string; phone: string; location: string; linkedin: string; github: string; website: string; }
interface PersonalInfoInclude { name: boolean; email: boolean; phone: boolean; location: boolean; linkedin: boolean; github: boolean; website: boolean; }
const DEFAULT_PERSONAL: PersonalInfo = { name: '', email: '', phone: '', location: '', linkedin: '', github: '', website: '' };
const DEFAULT_PERSONAL_INCLUDE: PersonalInfoInclude = { name: true, email: true, phone: true, location: true, linkedin: true, github: true, website: true };
const PERSONAL_FIELD_DEFS: { key: keyof PersonalInfo; label: string; placeholder: string }[] = [
  { key: 'name',     label: 'Full Name', placeholder: 'Jane Doe' },
  { key: 'email',    label: 'Email',     placeholder: 'jane@example.com' },
  { key: 'phone',    label: 'Phone',     placeholder: '+1 555 123 4567' },
  { key: 'location', label: 'Location',  placeholder: 'New York, NY' },
  { key: 'linkedin', label: 'LinkedIn',  placeholder: 'linkedin.com/in/janedoe' },
  { key: 'github',   label: 'GitHub',    placeholder: 'github.com/janedoe' },
  { key: 'website',  label: 'Website',   placeholder: 'janedoe.dev' },
];
const DEFAULT_FIELD_ORDER: (keyof PersonalInfo)[] = PERSONAL_FIELD_DEFS.map(f => f.key);

const SECTION_DEFS: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: 'personal', label: 'Personal Info', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
  )},
  { key: 'summary', label: 'Summary', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
  )},
  { key: 'requirements', label: 'Requirements', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
  )},
  { key: 'experience', label: 'Experience', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
  )},
  { key: 'skills', label: 'Skills', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
  )},
  { key: 'education', label: 'Education', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
  )},
  { key: 'other', label: 'Other', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
  )},
];

export function ResumeTailorWorkshop({ job, resumeText, resumeDocxFile, resumeInputTab, settings, onClose }: Props) {
  type Phase = 'extracting' | 'analyzing' | 'review';
  const [phase, setPhase] = useState<Phase>('analyzing');
  const [plainResume, setPlainResume] = useState('');
  const [analysis, setAnalysis] = useState<TailorAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>('summary');
  const [summary, setSummary] = useState('');
  const [qualifications, setQualifications] = useState<TailorQualification[]>([]);
  const [qualifOverrides, setQualifOverrides] = useState<(string | null)[]>([]);
  const [experience, setExperience] = useState<TailorExperience[]>([]);
  const [skills, setSkills] = useState<TailorSkill[]>([]);
  const [education, setEducation] = useState<(TailorEducation & { include: boolean })[]>([]);
  const [other, setOther] = useState<TailorOtherSection[]>([]);
  const [bulletModes, setBulletModes] = useState<Record<string, BulletMode>>({});
  const [personalInfo, setPersonalInfo] = useState<PersonalInfo>(DEFAULT_PERSONAL);
  const [personalInclude, setPersonalInclude] = useState<PersonalInfoInclude>(DEFAULT_PERSONAL_INCLUDE);
  const [personalFieldOrder, setPersonalFieldOrder] = useState<(keyof PersonalInfo)[]>(DEFAULT_FIELD_ORDER);
  const [showSummarySection, setShowSummarySection] = useState(true);
  const [showRequirementsSection, setShowRequirementsSection] = useState(true);
  const [showSkillsSection, setShowSkillsSection] = useState(true);
  const [showOtherSection, setShowOtherSection] = useState(true);
  const [reordering, setReordering] = useState(false);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dragIdx = useRef<number | null>(null);
  const [tab, setTab] = useState<TabKey>('all');
  const [buildDone, setBuildDone] = useState(false);
  const [restored, setRestored] = useState(false);
  const [regeneratingBullets, setRegeneratingBullets] = useState<Record<string, boolean>>({});
  const [regeneratingQualifs, setRegeneratingQualifs] = useState<Record<number, boolean>>({});

  const applyAnalysis = (a: TailorAnalysis) => {
    setAnalysis(a);
    const ci = a.contactInfo ?? [];
    setPersonalInfo({
      name: a.candidateName || '',
      email: ci.find(x => x.includes('@')) ?? '',
      phone: ci.find(x => /\d.*\d.*\d/.test(x) && !x.includes('@')) ?? '',
      location: ci.find(x => /city|state|,/.test(x.toLowerCase()) || (!x.includes('@') && !/\d{3}/.test(x) && !x.includes('linkedin') && !x.includes('http'))) ?? '',
      linkedin: ci.find(x => x.toLowerCase().includes('linkedin')) ?? '',
      website: ci.find(x => x.includes('http') && !x.includes('linkedin')) ?? '',
    });
    setSummary(a.summary);
    setQualifications(a.qualifications);
    setQualifOverrides(a.qualifications.map(() => null));
    setExperience(a.experience);
    setSkills(a.skills);
    setEducation(a.education.map(e => ({ ...e, include: true })));
    setOther(a.other);
    const modes: Record<string, BulletMode> = {};
    a.experience.forEach((exp, ei) => exp.bullets.forEach((_, bi) => { modes[`${ei}-${bi}`] = 'tailored'; }));
    setBulletModes(modes);
    setPhase('review');
    setBuildDone(false);
  };

  const runAnalysis = useCallback(async (resume: string) => {
    setPhase('analyzing');
    setError(null);
    setBuildDone(false);
    const jobDesc = job.description ? stripHtml(job.description) : `${job.title} at ${job.company}`;
    const result = await analyzeTailorSections(resume, jobDesc, job.title, job.company, settings);
    if (result.error || !result.analysis) { setError(result.error || 'Analysis failed'); return; }
    applyAnalysis(result.analysis);
  }, [job, settings]);

  useEffect(() => {
    const init = async () => {
      // Read from resume first; restore from save only if save is current-format compatible
      const saved = loadTailorState(job.id);
      if (saved?.analysis && isSaveCompatible(saved)) {
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
        setOther(saved.other);
        if (saved.showSummarySection !== undefined) setShowSummarySection(saved.showSummarySection);
        if (saved.showRequirementsSection !== undefined) setShowRequirementsSection(saved.showRequirementsSection);
        if (saved.showSkillsSection !== undefined) setShowSkillsSection(saved.showSkillsSection);
        if (saved.showOtherSection !== undefined) setShowOtherSection(saved.showOtherSection);
        if (saved.personalInfo) setPersonalInfo(saved.personalInfo);
        if (saved.personalInclude) setPersonalInclude(saved.personalInclude);
        if (saved.personalFieldOrder) setPersonalFieldOrder(saved.personalFieldOrder);
        setPhase('review');
        setRestored(true);
        // Also extract plain resume for potential re-analysis
        if (resumeInputTab === 'paste') {
          setPlainResume(stripHtml(resumeText));
        } else if (resumeDocxFile) {
          try {
            const ab = await resumeDocxFile.arrayBuffer();
            setPlainResume((await mammoth.extractRawText({ arrayBuffer: ab })).value);
          } catch {}
        }
        return;
      }
      // No saved state — run fresh analysis
      if (resumeInputTab === 'paste') {
        const plain = stripHtml(resumeText);
        setPlainResume(plain);
        await runAnalysis(plain);
      } else if (resumeDocxFile) {
        setPhase('extracting');
        try {
          const ab = await resumeDocxFile.arrayBuffer();
          const plain = (await mammoth.extractRawText({ arrayBuffer: ab })).value;
          setPlainResume(plain);
          await runAnalysis(plain);
        } catch { setError('Could not extract text from DOCX file.'); }
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save whenever user edits any section
  useEffect(() => {
    if (phase !== 'review' || !analysis) return;
    saveTailorState(job.id, { analysis, summary, qualifications, qualifOverrides, experience, bulletModes, skills, education, other, showSummarySection, showRequirementsSection, showSkillsSection, showOtherSection, personalInfo, personalInclude, personalFieldOrder });
  }, [phase, analysis, summary, qualifications, qualifOverrides, experience, bulletModes, skills, education, other, showSummarySection, showRequirementsSection, showSkillsSection, showOtherSection, personalInfo, personalInclude, personalFieldOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  const reanalyze = () => { setRestored(false); runAnalysis(plainResume); };

  const getBulletMode = (ei: number, bi: number): BulletMode => bulletModes[`${ei}-${bi}`] ?? 'tailored';
  const toggleBulletMode = (ei: number, bi: number) =>
    setBulletModes(prev => ({ ...prev, [`${ei}-${bi}`]: prev[`${ei}-${bi}`] === 'tailored' ? 'original' : 'tailored' }));

  const selectQualifOption = (idx: number, text: string | null) => {
    const isAlreadyActive = qualifications[idx].include && qualifOverrides[idx] === text;
    setQualifOverrides(prev => { const n = [...prev]; n[idx] = isAlreadyActive ? null : text; return n; });
    setQualifications(prev => prev.map((q, i) => i !== idx ? q : { ...q, include: !isAlreadyActive }));
  };
  const toggleSkill = (idx: number) =>
    setSkills(prev => prev.map((s, i) => i === idx ? { ...s, include: !s.include } : s));
  const toggleOtherItem = (si: number, ii: number) =>
    setOther(prev => prev.map((sec, i) => i !== si ? sec : {
      ...sec, items: sec.items.map((item, j) => j !== ii ? item : { ...item, include: !item.include }),
    }));

  const handleRegenerateBullet = async (ei: number, bi: number) => {
    const key = `${ei}-${bi}`;
    const bullet = experience[ei]?.bullets[bi];
    if (!bullet) return;
    setRegeneratingBullets(prev => ({ ...prev, [key]: true }));
    const result = await regenerateBullet(bullet.text, job.title, job.company, bullet.keywords, settings);
    if (result.tailored) {
      setExperience(prev => prev.map((ex, i) => i !== ei ? ex : {
        ...ex,
        bullets: ex.bullets.map((b, j) => j !== bi ? b : { ...b, tailored: result.tailored! }),
      }));
    }
    setRegeneratingBullets(prev => ({ ...prev, [key]: false }));
  };

  const handleRegenerateQualif = async (idx: number) => {
    const q = qualifications[idx];
    if (!q) return;
    setRegeneratingQualifs(prev => ({ ...prev, [idx]: true }));
    const currentMatch = qualifOverrides[idx] ?? q.match;
    const result = await regenerateQualification(q.requirement, job.title, job.company, currentMatch, settings);
    if (result.text) {
      setQualifOverrides(prev => { const n = [...prev]; n[idx] = result.text; return n; });
      setQualifications(prev => prev.map((qi, i) => i === idx ? { ...qi, include: true } : qi));
    }
    setRegeneratingQualifs(prev => ({ ...prev, [idx]: false }));
  };

  // Flat bullets for experience tab
  type FlatBullet = { ei: number; bi: number; exp: TailorExperience; bullet: (typeof experience)[0]['bullets'][0] };
  const flatBullets: FlatBullet[] = experience.flatMap((exp, ei) =>
    exp.bullets.map((bullet, bi) => ({ ei, bi, exp, bullet }))
  );
  const counts = {
    all: flatBullets.length,
    matched: flatBullets.filter(f => f.bullet.matchLevel === 'full').length,
    partial: flatBullets.filter(f => f.bullet.matchLevel === 'partial').length,
    none: flatBullets.filter(f => f.bullet.matchLevel === 'none').length,
  };
  const visibleBullets = tab === 'all' ? flatBullets :
    flatBullets.filter(f =>
      tab === 'matched' ? f.bullet.matchLevel === 'full' :
      tab === 'partial' ? f.bullet.matchLevel === 'partial' :
      f.bullet.matchLevel === 'none'
    );
  const grouped = visibleBullets.reduce<Record<number, FlatBullet[]>>((acc, fb) => {
    (acc[fb.ei] ??= []).push(fb);
    return acc;
  }, {});

  // Live preview HTML (iframed)
  const previewHtml = useMemo(() => {
    if (!analysis) return '';
    let content = '';

    // Header
    const displayName = (personalInclude.name ? personalInfo.name : '') || analysis.candidateName || '';
    if (displayName) content += `<div class="r-name">${displayName}</div>`;
    const contactParts = personalFieldOrder
      .filter(k => k !== 'name' && personalInclude[k] && personalInfo[k])
      .map(k => personalInfo[k]);
    if (contactParts.length > 0) {
      content += `<div class="r-contact">${contactParts.join(' &nbsp;|&nbsp; ')}</div>`;
    }

    // Summary
    if (showSummarySection && summary.trim()) {
      content += `<div class="r-section">Professional Summary</div><p>${summary.replace(/\n/g, '<br>')}</p>`;
    }

    // Key Qualifications
    const includedQualifs = qualifications
      .map((q, i) => ({ ...q, effectiveText: qualifOverrides[i] ?? q.match }))
      .filter(q => q.include && q.effectiveText);
    if (showRequirementsSection && includedQualifs.length > 0) {
      content += `<div class="r-section">Key Qualifications</div><ul>${includedQualifs.map(q => `<li>${q.effectiveText}</li>`).join('')}</ul>`;
    }

    // Experience
    const expSections = experience.map((exp, ei) => {
      const bullets = exp.bullets.map((b, bi) => {
        const mode = getBulletMode(ei, bi);
        return mode === 'tailored' && b.tailored ? b.tailored : b.text;
      });
      return { ...exp, bullets };
    }).filter(e => e.bullets.length > 0);
    if (expSections.length > 0) {
      content += `<div class="r-section">Work Experience</div>`;
      for (const exp of expSections) {
        content += `<div class="exp-block">`;
        content += `<div class="exp-hdr"><span class="exp-title">${exp.title}</span><span class="exp-period">${exp.period || ''}</span></div>`;
        const expMeta = [exp.company, exp.location].filter(Boolean).join(', ');
        if (expMeta) content += `<div class="exp-meta">${expMeta}</div>`;
        content += `<ul>${exp.bullets.map(b => `<li>${b}</li>`).join('')}</ul>`;
        content += `</div>`;
      }
    }

    // Education
    const includedEdu = education.filter(e => e.include);
    if (includedEdu.length > 0) {
      content += `<div class="r-section">Education</div>`;
      for (const e of includedEdu) {
        const datePart = [e.startDate, e.endDate].filter(Boolean).join(' – ');
        const eduMeta = [e.school, e.location].filter(Boolean).join(', ');
        content += `<div class="exp-block">`;
        content += `<div class="exp-hdr"><span class="exp-title">${e.program || ''}</span><span class="exp-period">${datePart}</span></div>`;
        if (eduMeta) content += `<div class="exp-meta">${eduMeta}</div>`;
        content += `</div>`;
      }
    }

    // Skills as chips
    const includedSkills = skills.filter(s => s.include).map(s => s.name);
    if (showSkillsSection && includedSkills.length > 0) {
      content += `<div class="r-section">Skills</div><div class="skills-wrap">${includedSkills.map(s => `<span class="skill-chip">${s}</span>`).join('')}</div>`;
    }

    // Other sections
    if (showOtherSection) for (const sec of other) {
      const items = sec.items.filter(i => i.include);
      if (items.length > 0) {
        content += `<div class="r-section">${sec.title}</div><ul>${items.map(i => `<li>${i.text}</li>`).join('')}</ul>`;
      }
    }

    const empty = `<p style="color:#4a527a;font-style:italic;text-align:center;padding:2rem 0">Your tailored resume will appear here as you make selections.</p>`;

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;font-size:11px;line-height:1.6;color:#c5cee8;background:#06090E;padding:14px}
.paper{background:#0C1118;border:1px solid #1A2330;border-radius:10px;padding:22px 26px;min-height:calc(100vh - 28px)}
.r-name{font-size:21px;font-weight:800;color:#f0f2fa;letter-spacing:-0.02em;margin-bottom:3px}
.r-contact{font-size:10px;color:#7b85a8;margin-bottom:16px}
.r-section{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#818cf8;border-bottom:1px solid #1A2330;margin:14px 0 7px;padding-bottom:3px}
p{margin-bottom:5px;font-size:11px;color:#c5cee8}
ul{margin:3px 0 5px 15px}
li{margin-bottom:3px;font-size:11px;color:#c5cee8}
.exp-block{margin-bottom:10px}
.exp-hdr{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1px}
.exp-title{font-weight:700;font-size:11px;color:#f0f2fa}
.exp-period{font-size:10px;color:#7b85a8;font-style:italic;white-space:nowrap;margin-left:8px}
.exp-meta{font-size:10px;color:#7b85a8;margin-bottom:4px}
.skills-wrap{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
.skill-chip{font-size:10px;padding:2px 9px;border-radius:20px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc}
</style></head><body><div class="paper">${content || empty}</div></body></html>`;
  }, [analysis, summary, qualifications, qualifOverrides, experience, bulletModes, skills, education, other, showSummarySection, showRequirementsSection, showSkillsSection, showOtherSection, personalInfo, personalInclude, personalFieldOrder]);

  const buildResume = async () => {
    if (!analysis) return;
    const safeTitle = job.title.replace(/[^a-z0-9]/gi, '_');
    const safeCompany = job.company.replace(/[^a-z0-9]/gi, '_');

    const sectionHeading = (text: string) => new Paragraph({
      text: text.toUpperCase(),
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 4 } },
    });

    const bullet = (text: string) => new Paragraph({
      bullet: { level: 0 },
      children: [new TextRun({ text, size: 20 })],
      spacing: { after: 80 },
    });

    const children: Paragraph[] = [];

    // Name + contact row
    children.push(new Paragraph({
      children: [new TextRun({ text: (personalInclude.name ? personalInfo.name : '') || analysis.candidateName || 'Resume', bold: true, size: 32 })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 40 },
    }));
    const LINKED_FIELDS = new Set<keyof PersonalInfo>(['email', 'linkedin', 'github', 'website']);
    const getHref = (key: keyof PersonalInfo, value: string) => {
      if (key === 'email') return `mailto:${value}`;
      if (value.startsWith('http')) return value;
      return `https://${value}`;
    };
    const contactFields = personalFieldOrder.filter(k => k !== 'name' && personalInclude[k] && personalInfo[k]);
    if (contactFields.length > 0) {
      const runs: (TextRun | ExternalHyperlink)[] = [];
      contactFields.forEach((k, i) => {
        if (i > 0) runs.push(new TextRun({ text: '  |  ', size: 20 }));
        const val = personalInfo[k];
        if (LINKED_FIELDS.has(k)) {
          runs.push(new ExternalHyperlink({
            link: getHref(k, val),
            children: [new TextRun({ text: val, size: 20, style: 'Hyperlink' })],
          }));
        } else {
          runs.push(new TextRun({ text: val, size: 20 }));
        }
      });
      children.push(new Paragraph({ children: runs, alignment: AlignmentType.LEFT, spacing: { after: 200 } }));
    } else {
      children.push(new Paragraph({ children: [], spacing: { after: 200 } }));
    }

    // Summary
    if (showSummarySection && summary) {
      children.push(sectionHeading('Professional Summary'));
      children.push(new Paragraph({ children: [new TextRun({ text: summary, size: 20 })], spacing: { after: 80 } }));
    }

    // Qualifications
    const includedQualifs = qualifications.filter(q => q.include);
    if (showRequirementsSection && includedQualifs.length > 0) {
      children.push(sectionHeading('Qualifications'));
      includedQualifs.forEach((q, idx) => {
        const text = qualifOverrides[qualifications.indexOf(q)] ?? q.match ?? q.readySentence ?? q.requirement;
        children.push(bullet(text || q.requirement));
      });
    }

    // Experience
    const includedExp = experience.filter(exp => exp.bullets.some((_, bi) => {
      const ei = experience.indexOf(exp);
      const b = exp.bullets[bi];
      return b.include;
    }));
    if (includedExp.length > 0) {
      children.push(sectionHeading('Work Experience'));
      includedExp.forEach((exp, ei) => {
        const expIdx = experience.indexOf(exp);
        // Line 1: title (left) · period (right)
        children.push(new Paragraph({
          children: [
            new TextRun({ text: exp.title, bold: true, size: 20 }),
            ...(exp.period ? [new TextRun({ text: '\t' + exp.period, size: 20, bold: true, italics: true })] : []),
          ],
          tabStops: [{ type: 'right', position: 10440 }],
          spacing: { before: 120, after: 20 },
        }));
        // Line 2: company · location
        const expMeta = [exp.company, exp.location].filter(Boolean).join(', ');
        if (expMeta) children.push(new Paragraph({
          children: [new TextRun({ text: expMeta, size: 20, italics: true })],
          spacing: { after: 40 },
        }));
        exp.bullets.forEach((b, bi) => {
          if (!b.include) return;
          const mode = bulletModes[`${expIdx}-${bi}`] ?? 'tailored';
          const text = mode === 'tailored' ? (b.tailored || b.text) : b.text;
          children.push(bullet(text));
        });
      });
    }

    // Skills
    const includedSkills = skills.filter(s => s.include);
    if (showSkillsSection && includedSkills.length > 0) {
      children.push(sectionHeading('Skills'));
      children.push(new Paragraph({
        children: [new TextRun({ text: includedSkills.map(s => s.name).join('  ·  '), size: 20 })],
        spacing: { after: 80 },
      }));
    }

    // Education
    const includedEdu = education.filter(e => e.include);
    if (includedEdu.length > 0) {
      children.push(sectionHeading('Education'));
      includedEdu.forEach(e => {
        const datePart = [e.startDate, e.endDate].filter(Boolean).join(' – ');
        // Line 1: program (left) · date range (right)
        children.push(new Paragraph({
          children: [
            new TextRun({ text: e.program || '', bold: true, size: 20 }),
            ...(datePart ? [new TextRun({ text: '\t' + datePart, size: 20, bold: true, italics: true })] : []),
          ],
          tabStops: [{ type: 'right', position: 10440 }],
          spacing: { before: 80, after: 20 },
        }));
        // Line 2: school, location
        const eduMeta = [e.school, e.location].filter(Boolean).join(', ');
        if (eduMeta) children.push(new Paragraph({ children: [new TextRun({ text: eduMeta, size: 20, italics: true })], spacing: { after: 80 } }));
      });
    }

    // Other sections
    if (showOtherSection) other.forEach(sec => {
      const includedItems = sec.items.filter(i => i.include);
      if (includedItems.length === 0) return;
      children.push(sectionHeading(sec.title));
      includedItems.forEach(i => children.push(bullet(i.text)));
    });

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: 'Arial' },
          },
          heading2: {
            run: { bold: true, size: 22, font: 'Arial' },
          },
        },
      },
      sections: [{
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 900, right: 900 },
          },
        },
        children,
      }],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Resume_${safeTitle}_${safeCompany}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    setBuildDone(true);
  };

  const isLoading = phase === 'extracting' || phase === 'analyzing';
  const TABS: { key: TabKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'matched', label: 'Matched' },
    { key: 'partial', label: 'Partial' },
    { key: 'none', label: 'No Match' },
  ];

  return (
    <div className="modal-overlay">
      <div className="modal-card workshop-modal">

        {/* Header */}
        <div className="modal-header ws-modal-header">
          <div className="ws-header-left">
            <div className="modal-title">Resume Workshop</div>
            <div className="tailor-resume-subtitle">{job.title} · {job.company}</div>
          </div>
          {restored && (
            <span className="ws-restored-badge">Restored</span>
          )}
          {analysis && (
            <div className="ws-header-score">
              <span className="ws-header-score-num" style={{ color: scoreColor(analysis.atsScore) }}>{analysis.atsScore}</span>
              <span className="ws-header-score-label">ATS Score</span>
              <span className="ws-header-score-badge" style={{ background: scoreColor(analysis.atsScore) + '22', color: scoreColor(analysis.atsScore) }}>
                {scoreLabel(analysis.atsScore)}
              </span>
            </div>
          )}
          <button className="modal-close" onClick={onClose} disabled={isLoading}>&times;</button>
        </div>

        {/* Loading / Error */}
        {isLoading && (
          <div className="workshop-loading-body">
            <span className="badge-selector-ai-spinner" />
            <span>{phase === 'extracting' ? 'Extracting resume content…' : 'Analyzing resume against job description…'}</span>
          </div>
        )}
        {!isLoading && error && (
          <div className="workshop-error-body">
            <div className="tailor-resume-error">{error}</div>
          </div>
        )}

        {/* Three-panel layout */}
        {phase === 'review' && analysis && (
          <div className="workshop-threepanel">

            {/* ── Left nav ── */}
            <nav className="ws-leftnav">
              <div className="ws-nav-sections">
                {SECTION_DEFS.map(sec => (
                  <button
                    key={sec.key}
                    className={`ws-nav-item${activeSection === sec.key ? ' active' : ''}`}
                    onClick={() => setActiveSection(sec.key)}
                  >
                    <span className="ws-nav-icon">{sec.icon}</span>
                    <span className="ws-nav-label">{sec.label}</span>
                  </button>
                ))}
              </div>

            </nav>

            {/* ── Center editor ── */}
            <div className="ws-editor">

              {/* Personal Info */}
              {activeSection === 'personal' && <>
                <div className="ws-editor-header">
                  <div className="ws-editor-section-title">Personal Info</div>
                </div>
                <button
                  className={`ws-rearrange-btn${reordering ? ' active' : ''}`}
                  onClick={() => { setReordering(r => !r); setDragOverIdx(null); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                  {reordering ? 'Done' : 'Rearrange'}
                </button>
                <div className="ws-editor-body">
                  <div className="ws-personal-form">
                    {personalFieldOrder.map((key, idx) => {
                      const def = PERSONAL_FIELD_DEFS.find(f => f.key === key)!;
                      const included = personalInclude[key];
                      return (
                        <div key={key} className="ws-personal-field-wrap">
                          {reordering && dragOverIdx === idx && <div className="ws-drop-line" />}
                          <div
                            className={`ws-personal-field${included ? '' : ' excluded'}${reordering ? ' reordering' : ''}`}
                            draggable={reordering}
                            onDragStart={() => { dragIdx.current = idx; }}
                            onDragOver={e => { e.preventDefault(); setDragOverIdx(idx); }}
                            onDragEnd={() => { setDragOverIdx(null); dragIdx.current = null; }}
                            onDrop={() => {
                              if (dragIdx.current === null || dragIdx.current === idx) { setDragOverIdx(null); return; }
                              setPersonalFieldOrder(prev => {
                                const next = [...prev];
                                const [item] = next.splice(dragIdx.current!, 1);
                                next.splice(idx, 0, item);
                                return next;
                              });
                              setDragOverIdx(null);
                              dragIdx.current = null;
                            }}
                          >
                          <label className="ws-personal-label">{def.label}</label>
                          <div className="ws-personal-input-row">
                            {reordering && (
                              <span className="ws-drag-handle" title="Drag to reorder">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
                              </span>
                            )}
                            <input
                              className="ws-personal-input"
                              value={personalInfo[key]}
                              placeholder={def.placeholder}
                              disabled={!included || reordering}
                              onChange={e => setPersonalInfo(prev => ({ ...prev, [key]: e.target.value }))}
                            />
                            <button
                              className={`ws-toggle${included ? ' on' : ''}`}
                              disabled={reordering}
                              onClick={() => setPersonalInclude(prev => ({ ...prev, [key]: !prev[key] }))}
                              aria-label={included ? 'Exclude' : 'Include'}
                            >
                              <span className="ws-toggle-thumb" />
                            </button>
                          </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>}

              {/* Summary */}
              {activeSection === 'summary' && <>
                <div className="ws-editor-header">
                  <div>
                    <div className="ws-editor-section-title">Professional Summary</div>
                    <div className="ws-editor-subtitle">Edit your tailored summary for {job.title} at {job.company}</div>
                  </div>
                  <button
                    className={`ws-toggle${showSummarySection ? ' on' : ''}`}
                    onClick={() => setShowSummarySection(s => !s)}
                    aria-label={showSummarySection ? 'Hide summary section' : 'Show summary section'}
                    title={showSummarySection ? 'Hide from resume' : 'Show in resume'}
                  >
                    <span className="ws-toggle-thumb" />
                  </button>
                </div>
                <div className="ws-editor-body">
                  <textarea
                    className="ws-editor-textarea"
                    value={summary}
                    onChange={e => setSummary(e.target.value)}
                    rows={8}
                    placeholder="Your professional summary will appear here after analysis…"
                  />
                </div>
              </>}

              {/* Requirements */}
              {activeSection === 'requirements' && <>
                <div className="ws-editor-header">
                  <div>
                    <div className="ws-editor-section-title">Requirements Match</div>
                    <div className="ws-editor-subtitle">
                      {qualifications.filter(q => q.include).length} of {qualifications.length} selected — check items to include in your resume
                    </div>
                  </div>
                  <button
                    className={`ws-toggle${showRequirementsSection ? ' on' : ''}`}
                    onClick={() => setShowRequirementsSection(s => !s)}
                    aria-label={showRequirementsSection ? 'Hide requirements section' : 'Show requirements section'}
                    title={showRequirementsSection ? 'Hide from resume' : 'Show in resume'}
                  >
                    <span className="ws-toggle-thumb" />
                  </button>
                </div>
                <div className="ws-editor-body">
                  {qualifications.length === 0
                    ? <div className="ws-empty">No requirements extracted.</div>
                    : qualifications.map((q, idx) => {
                        const override = qualifOverrides[idx];
                        return (
                          <div key={idx} className={`ws-req-card${q.include ? ' included' : ' disabled'}`}>
                            <div className="ws-req-card-top">
                              <div className="ws-req-text">{q.requirement}</div>
                              {!q.match && <span className="ws-req-missing-badge">Not found</span>}
                            </div>
                            {q.match ? (
                              <div className="ws-req-options">
                                <button className={`ws-req-opt${q.include && override === null ? ' sel' : ''}`} onClick={() => selectQualifOption(idx, null)}>{q.match}</button>
                                {q.suggestions.map((s, si) => (
                                  <button key={si} className={`ws-req-opt${q.include && override === s ? ' sel' : ''}`} onClick={() => selectQualifOption(idx, s)}>{s}</button>
                                ))}
                              </div>
                            ) : (
                              <>
                                {q.suggestions.length > 0 && (
                                  <div className="ws-req-hints">
                                    {q.suggestions.map((s, si) => (
                                      <p key={si} className="ws-req-hint-text">{s}</p>
                                    ))}
                                  </div>
                                )}
                                {q.readySentence && (
                                  <button
                                    className={`ws-req-ready-btn${q.include && override === q.readySentence ? ' sel' : ''}`}
                                    onClick={() => selectQualifOption(idx, q.readySentence!)}
                                  >
                                    {q.readySentence}
                                  </button>
                                )}
                              </>
                            )}
                            {regeneratingQualifs[idx] ? (
                              <div className="ws-bullet-regen-msg">
                                <span className="badge-selector-ai-spinner" />
                                Regenerating…
                              </div>
                            ) : (
                              <div className="ws-qualif-hover-bar">
                                <button
                                  className="ws-bullet-regen-btn"
                                  title="Regenerate suggestion"
                                  onClick={() => handleRegenerateQualif(idx)}
                                >
                                  ↺ Regenerate
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                  }
                </div>
              </>}

              {/* Experience */}
              {activeSection === 'experience' && <>
                <div className="ws-editor-header">
                  <div className="ws-editor-section-title">Work Experience</div>
                  <div className="ws-editor-subtitle">Choose tailored or original wording for each bullet</div>
                </div>
                <div className="ws-tabs">
                  {TABS.map(t => (
                    <button key={t.key} className={`ws-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
                      {t.label}<span className="ws-tab-count">{counts[t.key]}</span>
                    </button>
                  ))}
                  <div style={{ flex: 1 }} />
                  <button className="ws-reanalyze-btn" onClick={reanalyze}>↺ Re-analyze</button>
                </div>
                <div className="ws-table-wrap">
                  <div className="ws-table-head">
                    <span>Original</span>
                    <span>Suggested Tailored Version</span>
                    <span>Keywords</span>
                    <span>Action</span>
                  </div>
                  <div className="ws-table-body">
                    {Object.entries(grouped).map(([eiStr, fbs]) => {
                      const ei = Number(eiStr);
                      const exp = experience[ei];
                      return (
                        <div key={ei} className="ws-exp-card">
                          <div className="ws-group-header">
                            <strong>{exp.title}</strong>
                            <span className="ws-group-dot">&middot;</span>
                            {exp.company}
                            {exp.period && <span className="ws-group-period">{exp.period}</span>}
                            <input
                              className="ws-exp-location-input"
                              value={exp.location ?? ''}
                              placeholder="Location"
                              onChange={e => setExperience(prev => prev.map((ex, i) => i === ei ? { ...ex, location: e.target.value } : ex))}
                            />
                          </div>
                          {fbs.map(({ bi, bullet }) => {
                            const mode = getBulletMode(ei, bi);
                            return (
                              <div key={bi} className={`ws-row ws-row-${bullet.matchLevel}`}>
                                <div className="ws-cell ws-cell-original">{bullet.text}</div>
                                <div className="ws-cell ws-cell-tailored">
                                  {regeneratingBullets[`${ei}-${bi}`] ? (
                                    <div className="ws-bullet-regen-msg">
                                      <span className="badge-selector-ai-spinner" />
                                      Regenerating…
                                    </div>
                                  ) : (
                                    <textarea
                                      className="ws-tailored-edit"
                                      value={bullet.tailored || bullet.text}
                                      rows={1}
                                      onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                                      ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                                      onChange={e => setExperience(prev => prev.map((ex, i) => i !== ei ? ex : {
                                        ...ex,
                                        bullets: ex.bullets.map((b, j) => j !== bi ? b : { ...b, tailored: e.target.value }),
                                      }))}
                                    />
                                  )}
                                  <div className="ws-tailored-hover-bar">
                                    <button
                                      className="ws-bullet-regen-btn"
                                      title="Regenerate tailored version"
                                      disabled={regeneratingBullets[`${ei}-${bi}`]}
                                      onClick={() => handleRegenerateBullet(ei, bi)}
                                    >
                                      ↺ Regenerate
                                    </button>
                                  </div>
                                </div>
                                <div className="ws-cell ws-cell-keywords">
                                  {bullet.keywords.map((kw, ki) => <span key={ki} className="ws-kw-chip">{kw}</span>)}
                                </div>
                                <div className="ws-cell ws-cell-action">
                                  <button className={`ws-mode-btn ws-mode-tailored${mode === 'tailored' ? ' active' : ''}`} onClick={() => toggleBulletMode(ei, bi)}>Tailored</button>
                                  <button className={`ws-mode-btn ws-mode-original${mode === 'original' ? ' active' : ''}`} onClick={() => toggleBulletMode(ei, bi)}>Original</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    {visibleBullets.length === 0 && <div className="ws-empty">No bullets in this category.</div>}
                  </div>
                </div>
              </>}

              {/* Skills */}
              {activeSection === 'skills' && <>
                <div className="ws-editor-header">
                  <div>
                    <div className="ws-editor-section-title">Skills</div>
                    <div className="ws-editor-subtitle">Click to toggle — included skills appear in your resume</div>
                  </div>
                  <button
                    className={`ws-toggle${showSkillsSection ? ' on' : ''}`}
                    onClick={() => setShowSkillsSection(s => !s)}
                    aria-label={showSkillsSection ? 'Hide skills section' : 'Show skills section'}
                    title={showSkillsSection ? 'Hide from resume' : 'Show in resume'}
                  >
                    <span className="ws-toggle-thumb" />
                  </button>
                </div>
                <div className="ws-editor-body">
                  {skills.length > 0
                    ? <div className="workshop-skills">
                        {skills.map((skill, idx) => (
                          <button key={idx}
                            className={`workshop-skill-chip${skill.include ? ' included' : ''}${skill.isSuggestion ? ' suggestion' : ''}`}
                            onClick={() => toggleSkill(idx)} title={skill.note || undefined}>
                            {skill.name}
                          </button>
                        ))}
                      </div>
                    : <div className="ws-empty">No skills extracted.</div>
                  }
                  {(analysis.matchedKeywords.length > 0 || analysis.missingKeywords.length > 0) && (
                    <div className="ws-kw-insight-groups">
                      {analysis.matchedKeywords.length > 0 && (
                        <div className="ws-kw-insight-group">
                          <div className="ws-kw-insight-title ws-kw-matched-title">Matched Keywords</div>
                          <div className="ws-kw-insight-chips">
                            {analysis.matchedKeywords.map((kw, i) => (
                              <span key={i} className="ws-insight-matched"><span className="ws-insight-icon">✓</span>{kw}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {analysis.missingKeywords.length > 0 && (
                        <div className="ws-kw-insight-group">
                          <div className="ws-kw-insight-title ws-kw-missing-title">Missing Keywords</div>
                          <div className="ws-kw-insight-chips">
                            {analysis.missingKeywords.map((kw, i) => (
                              <span key={i} className="ws-insight-missing"><span className="ws-insight-icon">!</span>{kw}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>}

              {/* Education */}
              {activeSection === 'education' && <>
                <div className="ws-editor-header">
                  <div className="ws-editor-section-title">Education</div>
                  <div className="ws-editor-subtitle">Edit entries and toggle each to include or exclude</div>
                </div>
                <div className="ws-editor-body">
                  {education.length > 0
                    ? <div className="ws-edu-list">
                        {education.map((edu, idx) => {
                          const setField = (field: keyof TailorEducation, val: string) =>
                            setEducation(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item));
                          return (
                            <div key={idx} className={`ws-edu-card${edu.include ? '' : ' excluded'}`}>
                              <div className="ws-edu-card-header">
                                <span className="ws-edu-card-label">Entry {idx + 1}</span>
                                <button
                                  className={`ws-toggle${edu.include ? ' on' : ''}`}
                                  onClick={() => setEducation(prev => prev.map((item, i) => i === idx ? { ...item, include: !item.include } : item))}
                                  aria-label={edu.include ? 'Exclude' : 'Include'}
                                ><span className="ws-toggle-thumb" /></button>
                              </div>
                              <div className="ws-edu-fields">
                                {([
                                  { field: 'program',   label: 'Program / Major' },
                                  { field: 'school',    label: 'School' },
                                  { field: 'location',  label: 'Location' },
                                  { field: 'startDate', label: 'Start Date' },
                                  { field: 'endDate',   label: 'End Date' },
                                ] as { field: keyof TailorEducation; label: string }[]).map(({ field, label }) => (
                                  <div key={field} className="ws-edu-field">
                                    <label className="ws-personal-label">{label}</label>
                                    <input
                                      className="ws-edu-input"
                                      value={edu[field]}
                                      disabled={!edu.include}
                                      onChange={e => setField(field, e.target.value)}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    : <div className="ws-empty">No education entries found.</div>
                  }
                </div>
              </>}

              {/* Other */}
              {activeSection === 'other' && <>
                <div className="ws-editor-header">
                  <div>
                    <div className="ws-editor-section-title">Additional Sections</div>
                    <div className="ws-editor-subtitle">Toggle items to include in your resume</div>
                  </div>
                  <button
                    className={`ws-toggle${showOtherSection ? ' on' : ''}`}
                    onClick={() => setShowOtherSection(s => !s)}
                    aria-label={showOtherSection ? 'Hide additional sections' : 'Show additional sections'}
                    title={showOtherSection ? 'Hide from resume' : 'Show in resume'}
                  >
                    <span className="ws-toggle-thumb" />
                  </button>
                </div>
                <div className="ws-editor-body">
                  {other.filter(s => s.items.length > 0).length > 0
                    ? other.map((sec, si) => sec.items.length > 0 && (
                        <div key={si} className="ws-other-block">
                          <div className="ws-sidebar-title">{sec.title}</div>
                          {sec.items.map((item, ii) => (
                            <label key={ii} className="ws-other-item">
                              <input type="checkbox" checked={item.include} onChange={() => toggleOtherItem(si, ii)} />
                              <span>{item.text}</span>
                            </label>
                          ))}
                        </div>
                      ))
                    : <div className="ws-empty">No additional sections found.</div>
                  }
                </div>
              </>}

            </div>

            {/* ── Right preview ── */}
            <div className="ws-preview">
              <div className="ws-preview-header">
                <span>Live Preview</span>
              </div>
              <iframe
                className="ws-preview-iframe"
                srcDoc={previewHtml}
                title="Resume Preview"
                sandbox="allow-same-origin"
              />
            </div>

          </div>
        )}

        {/* Footer */}
        <div className="modal-footer">
          <button className="nav-btn nav-btn-outline" onClick={onClose} disabled={isLoading}>Close</button>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {!isLoading && error && <button className="nav-btn nav-btn-outline" onClick={reanalyze}>Retry</button>}
            {phase === 'review' && !isLoading && (
              <button className="ws-reanalyze-btn" onClick={reanalyze} style={{ marginRight: '0.25rem' }}>↺ Re-analyze</button>
            )}
            {phase === 'review' && buildDone && <span className="workshop-done-msg">Downloaded!</span>}
            {phase === 'review' && (
              <button className="nav-btn nav-btn-accent" onClick={() => buildResume().catch(e => setError(String(e)))}>
                Download .docx
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
