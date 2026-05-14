import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, ExternalHyperlink } from 'docx';
import type { Job } from '../types';
import type { AppSettings } from '../types/settings';
import type { TailorAnalysis, TailorQualification, TailorExperience, TailorSkill, TailorEducation, CustomSection, CustomSectionEntry } from '../types/ai';
import { analyzeTailorSections, regenerateBullet, regenerateQualification, suggestBullet } from '../services/aiService';

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
  // Must use customSections (not old 'other') format
  if (!('customSections' in saved)) return false;
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
type SectionKey = 'personal' | 'summary' | 'requirements' | 'experience' | 'skills' | 'education';

interface SectionFieldDef { key: string; label: string; multiline?: boolean; half?: boolean; }
interface SectionTypeDef { type: string; title: string; fields: SectionFieldDef[]; }

const CUSTOM_SECTION_TYPES: SectionTypeDef[] = [
  { type: 'volunteer',       title: 'Volunteer Experience',  fields: [{ key: 'org', label: 'Organization' }, { key: 'role', label: 'Role' }, { key: 'startDate', label: 'Start Date', half: true }, { key: 'endDate', label: 'End Date', half: true }, { key: 'location', label: 'Location' }, { key: 'description', label: 'Description', multiline: true }] },
  { type: 'additional',      title: 'Additional Experience', fields: [{ key: 'company', label: 'Company' }, { key: 'role', label: 'Role' }, { key: 'period', label: 'Period', half: true }, { key: 'location', label: 'Location', half: true }, { key: 'description', label: 'Description', multiline: true }] },
  { type: 'projects',        title: 'Projects',              fields: [{ key: 'name', label: 'Project Name' }, { key: 'tech', label: 'Technologies' }, { key: 'period', label: 'Period', half: true }, { key: 'link', label: 'Link', half: true }, { key: 'description', label: 'Description', multiline: true }] },
  { type: 'certifications',  title: 'Certifications',        fields: [{ key: 'name', label: 'Certification' }, { key: 'issuer', label: 'Issuer', half: true }, { key: 'date', label: 'Date', half: true }, { key: 'link', label: 'Credential Link' }] },
  { type: 'publications',    title: 'Publications',          fields: [{ key: 'title', label: 'Title' }, { key: 'publisher', label: 'Publisher / Journal', half: true }, { key: 'date', label: 'Date', half: true }, { key: 'link', label: 'Link' }] },
  { type: 'awards',          title: 'Awards & Honors',       fields: [{ key: 'title', label: 'Award' }, { key: 'issuer', label: 'Issuer', half: true }, { key: 'date', label: 'Date', half: true }, { key: 'description', label: 'Description' }] },
  { type: 'languages',       title: 'Languages',             fields: [{ key: 'language', label: 'Language', half: true }, { key: 'proficiency', label: 'Proficiency', half: true }] },
  { type: 'courses',         title: 'Courses & Training',    fields: [{ key: 'name', label: 'Course' }, { key: 'institution', label: 'Institution', half: true }, { key: 'date', label: 'Date', half: true }] },
];

function emptyEntry(def: SectionTypeDef): CustomSectionEntry {
  return { fields: Object.fromEntries(def.fields.map(f => [f.key, ''])), include: true };
}

const DEFAULT_SKILL_CATEGORIES = ['Languages', 'Frameworks', 'Databases', 'Cloud & DevOps', 'Tools', 'Soft Skills', 'Other'];

function initSkillCategoryOrder(skillList: { category?: string }[]): string[] {
  const usedCats = [...new Set(skillList.map(s => s.category || 'Other'))];
  return [...new Set([...DEFAULT_SKILL_CATEGORIES.filter(c => usedCats.includes(c)), ...usedCats.filter(c => !DEFAULT_SKILL_CATEGORIES.includes(c))])];
}

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

const SECTION_DEFS: { key: string; label: string; icon: React.ReactNode }[] = [
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
];

const getThemeSnapshot = () => document.documentElement.dataset.theme ?? 'dark';
const subscribeTheme = (cb: () => void) => {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
};

export function ResumeTailorWorkshop({ job, resumeText, resumeDocxFile, resumeInputTab, settings, onClose }: Props) {
  const currentTheme = useSyncExternalStore(subscribeTheme, getThemeSnapshot);
  const isDark = currentTheme === 'dark';
  type Phase = 'extracting' | 'analyzing' | 'review';
  const [phase, setPhase] = useState<Phase>('analyzing');
  const [plainResume, setPlainResume] = useState('');
  const [analysis, setAnalysis] = useState<TailorAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>('summary');
  const [summary, setSummary] = useState('');
  const [qualifications, setQualifications] = useState<TailorQualification[]>([]);
  const [qualifOverrides, setQualifOverrides] = useState<(string | null)[]>([]);
  const [experience, setExperience] = useState<TailorExperience[]>([]);
  const [skills, setSkills] = useState<TailorSkill[]>([]);
  const [education, setEducation] = useState<(TailorEducation & { include: boolean })[]>([]);
  const [customSections, setCustomSections] = useState<CustomSection[]>([]);
  const [bulletModes, setBulletModes] = useState<Record<string, BulletMode>>({});
  const [personalInfo, setPersonalInfo] = useState<PersonalInfo>(DEFAULT_PERSONAL);
  const [personalInclude, setPersonalInclude] = useState<PersonalInfoInclude>(DEFAULT_PERSONAL_INCLUDE);
  const [personalFieldOrder, setPersonalFieldOrder] = useState<(keyof PersonalInfo)[]>(DEFAULT_FIELD_ORDER);
  const [showSummarySection, setShowSummarySection] = useState(true);
  const [showRequirementsSection, setShowRequirementsSection] = useState(true);
  const [showSkillsSection, setShowSkillsSection] = useState(true);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dragIdx = useRef<number | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const [buildDone, setBuildDone] = useState(false);
  const [previewTab, setPreviewTab] = useState<'preview' | 'jd'>('preview');
  const [restored, setRestored] = useState(false);
  const [regeneratingBullets, setRegeneratingBullets] = useState<Record<string, boolean>>({});
  const [regeneratingQualifs, setRegeneratingQualifs] = useState<Record<number, boolean>>({});
  const [pendingSuggestions, setPendingSuggestions] = useState<Record<number, { text: string; keywords: string[] } | null>>({});
  const [loadingSuggestions, setLoadingSuggestions] = useState<Record<number, boolean>>({});
  const fetchedSuggestionIdx = useRef<Set<number>>(new Set());
  const [skillCategoryOrder, setSkillCategoryOrder] = useState<string[]>([]);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryValue, setEditingCategoryValue] = useState('');
  const [dragOverSkillCat, setDragOverSkillCat] = useState<string | null>(null);
  const [dragOverCatInsertIdx, setDragOverCatInsertIdx] = useState<number | null>(null);
  const skillDragTarget = useRef<{ type: 'category'; cat: string } | { type: 'skill'; skillIdx: number } | null>(null);
  const [addingSkillToCat, setAddingSkillToCat] = useState<string | null>(null);
  const [newSkillName, setNewSkillName] = useState('');
  const [editingOptKey, setEditingOptKey] = useState<string | null>(null);
  const [editingOptValue, setEditingOptValue] = useState('');

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
    setSkillCategoryOrder(initSkillCategoryOrder(a.skills));
    setEducation(a.education.map(e => ({ ...e, include: true })));
    setCustomSections(a.customSections ?? []);
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
    saveTailorState(job.id, { analysis, summary, qualifications, qualifOverrides, experience, bulletModes, skills, education, customSections, showSummarySection, showRequirementsSection, showSkillsSection, personalInfo, personalInclude, personalFieldOrder, skillCategoryOrder });
  }, [phase, analysis, summary, qualifications, qualifOverrides, experience, bulletModes, skills, education, customSections, showSummarySection, showRequirementsSection, showSkillsSection, personalInfo, personalInclude, personalFieldOrder, skillCategoryOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showAddMenu) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddMenu]);

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

  const saveEditCategory = () => {
    if (!editingCategory) return;
    const newName = editingCategoryValue.trim();
    if (newName && newName !== editingCategory) {
      setSkillCategoryOrder(prev => prev.map(c => c === editingCategory ? newName : c));
      setSkills(prev => prev.map(s => s.category === editingCategory ? { ...s, category: newName } : s));
    }
    setEditingCategory(null);
  };

  const addSkillCategory = () => {
    let name = 'New Category';
    let n = 2;
    while (skillCategoryOrder.includes(name)) { name = `New Category ${n++}`; }
    setSkillCategoryOrder(prev => [...prev, name]);
    setEditingCategory(name);
    setEditingCategoryValue(name);
  };

  const deleteSkillCategory = (cat: string) => {
    const newOrder = skillCategoryOrder.filter(c => c !== cat);
    if (!newOrder.length) return;
    const fallback = newOrder[0];
    setSkills(prev => prev.map(s => (s.category || 'Other') === cat ? { ...s, category: fallback } : s));
    setSkillCategoryOrder(newOrder);
  };

  const reorderCategory = (fromCat: string, toIdx: number) => {
    setSkillCategoryOrder(prev => {
      const next = prev.filter(c => c !== fromCat);
      next.splice(toIdx, 0, fromCat);
      return next;
    });
  };

  const moveSkillToCategory = (skillIdx: number, toCat: string) => {
    setSkills(prev => prev.map((s, i) => i === skillIdx ? { ...s, category: toCat } : s));
  };

  const confirmAddSkill = (cat: string) => {
    const name = newSkillName.trim();
    if (name) {
      setSkills(prev => [...prev, { name, category: cat, fromResume: false, isSuggestion: false, include: true }]);
    }
    setAddingSkillToCat(null);
    setNewSkillName('');
  };

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

  const fetchBulletSuggestion = useCallback(async (ei: number, exp: TailorExperience) => {
    setLoadingSuggestions(prev => ({ ...prev, [ei]: true }));
    const jobDesc = job.description ? stripHtml(job.description) : `${job.title} at ${job.company}`;
    const result = await suggestBullet(exp.title, exp.company, job.title, job.company, jobDesc, analysis?.matchedKeywords ?? [], settings);
    setPendingSuggestions(prev => ({ ...prev, [ei]: result.text ? { text: result.text, keywords: result.keywords } : null }));
    setLoadingSuggestions(prev => ({ ...prev, [ei]: false }));
  }, [job, analysis, settings]);

  useEffect(() => {
    if (activeSection !== 'experience' || !analysis) return;
    experience.forEach((exp, ei) => {
      if (!fetchedSuggestionIdx.current.has(ei)) {
        fetchedSuggestionIdx.current.add(ei);
        fetchBulletSuggestion(ei, exp);
      }
    });
  }, [activeSection, analysis, experience.length, fetchBulletSuggestion]);

  const handleAddBullet = (ei: number) => {
    const pending = pendingSuggestions[ei];
    const exp = experience[ei];
    const newBi = exp.bullets.length;
    const key = `${ei}-${newBi}`;
    const newBullet = pending
      ? { text: pending.text, tailored: pending.text, keywords: pending.keywords, matchLevel: (pending.keywords.length > 2 ? 'full' : pending.keywords.length > 0 ? 'partial' : 'none') as 'full' | 'partial' | 'none', isSuggestion: true, include: true }
      : { text: '', tailored: '', keywords: [], matchLevel: 'none' as const, isSuggestion: true, include: true };
    setExperience(prev => prev.map((ex, i) => i !== ei ? ex : { ...ex, bullets: [...ex.bullets, newBullet] }));
    setBulletModes(prev => ({ ...prev, [key]: 'tailored' }));
    // Reset and pre-fetch next suggestion for this entry
    setPendingSuggestions(prev => ({ ...prev, [ei]: null }));
    fetchedSuggestionIdx.current.delete(ei);
    fetchBulletSuggestion(ei, exp);
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
    const expSections = experience.filter(e => e.include !== false).map((exp, ei) => {
      const origEi = experience.indexOf(exp);
      const bullets = exp.bullets.map((b, bi) => {
        const mode = getBulletMode(origEi, bi);
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

    // Skills grouped by category
    const includedSkills = skills.filter(s => s.include);
    if (showSkillsSection && includedSkills.length > 0) {
      content += `<div class="r-section">Skills</div>`;
      const skillsByCat = includedSkills.reduce<Record<string, string[]>>((acc, s) => {
        const cat = s.category || 'Other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(s.name);
        return acc;
      }, {});
      const orderedCats = [...new Set([...skillCategoryOrder, ...Object.keys(skillsByCat)])].filter(c => skillsByCat[c]?.length);
      content += `<ul>${orderedCats.map(cat =>
        `<li><span class="skill-cat-label">${cat}:</span> ${skillsByCat[cat].join(', ')}</li>`
      ).join('')}</ul>`;
    }

    // Custom extra sections
    for (const sec of customSections.filter(s => s.include)) {
      const includedEntries = sec.entries.filter(e => e.include);
      if (!includedEntries.length) continue;
      content += `<div class="r-section">${sec.title}</div>`;
      for (const entry of includedEntries) {
        const f = entry.fields;
        if (sec.type === 'volunteer' || sec.type === 'additional') {
          const role = f.role || ''; const org = f.org || f.company || ''; const loc = f.location || '';
          const period = sec.type === 'volunteer'
            ? [f.startDate, f.endDate].filter(Boolean).join(' – ')
            : (f.period || '');
          content += `<div class="exp-block"><div class="exp-hdr"><span class="exp-title">${role}</span><span class="exp-period">${period}</span></div>`;
          const meta = [org, loc].filter(Boolean).join(', ');
          if (meta) content += `<div class="exp-meta">${meta}</div>`;
          const descLines = (f.description || '').split('\n').filter(Boolean);
          if (descLines.length) content += `<ul>${descLines.map(l => `<li>${l}</li>`).join('')}</ul>`;
          content += `</div>`;
        } else if (sec.type === 'projects') {
          content += `<div class="exp-block"><div class="exp-hdr"><span class="exp-title">${f.name || ''}</span><span class="exp-period">${f.period || ''}</span></div>`;
          const meta = [f.tech, f.link].filter(Boolean).join(' · ');
          if (meta) content += `<div class="exp-meta">${meta}</div>`;
          const descLines = (f.description || '').split('\n').filter(Boolean);
          if (descLines.length) content += `<ul>${descLines.map(l => `<li>${l}</li>`).join('')}</ul>`;
          content += `</div>`;
        } else {
          const def = CUSTOM_SECTION_TYPES.find(d => d.type === sec.type);
          const parts = (def?.fields ?? []).map(fd => f[fd.key]).filter(Boolean);
          content += `<ul><li>${parts.join(' · ')}</li></ul>`;
        }
      }
    }

    const empty = `<p style="color:${isDark ? '#4a527a' : '#9ca3af'};font-style:italic;text-align:center;padding:2rem 0">Your tailored resume will appear here as you make selections.</p>`;

    const t = isDark ? {
      bodyBg: '#06090E', bodyColor: '#c5cee8',
      paperBg: '#0C1118', paperBorder: '#1A2330',
      name: '#f0f2fa', contact: '#7b85a8',
      section: '#818cf8', sectionBorder: '#1A2330',
      text: '#c5cee8', title: '#f0f2fa', meta: '#7b85a8',
      skillLabel: '#c5cee8',
    } : {
      bodyBg: '#f3f5fb', bodyColor: '#374151',
      paperBg: '#ffffff', paperBorder: '#dde2ee',
      name: '#111827', contact: '#6b7280',
      section: '#533ab6', sectionBorder: '#dde2ee',
      text: '#374151', title: '#111827', meta: '#6b7280',
      skillLabel: '#374151',
    };

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;line-height:1.4;color:${t.bodyColor};background:${t.bodyBg};padding:14px}
.paper{background:${t.paperBg};border:1px solid ${t.paperBorder};border-radius:10px;padding:22px 26px;min-height:calc(100vh - 28px)}
.r-name{font-size:24px;font-weight:800;color:${t.name};letter-spacing:-0.02em;margin-bottom:3px}
.r-contact{font-size:12px;color:${t.contact};margin-bottom:16px}
.r-section{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${t.section};border-bottom:1px solid ${t.sectionBorder};margin:14px 0 7px;padding-bottom:3px}
p{margin-bottom:5px;font-size:13px;color:${t.text}}
ul{margin:3px 0 5px 15px}
li{margin-bottom:3px;font-size:13px;color:${t.text}}
.exp-block{margin-bottom:10px}
.exp-hdr{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1px}
.exp-title{font-weight:700;font-size:13px;color:${t.title}}
.exp-period{font-size:12px;color:${t.meta};font-style:italic;white-space:nowrap;margin-left:8px}
.exp-meta{font-size:12px;color:${t.meta};margin-bottom:4px}
.skill-cat-label{font-size:12px;font-weight:700;color:${t.skillLabel}}
.skill-chip{font-size:12px;padding:2px 9px;border-radius:20px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc}
</style></head><body><div class="paper">${content || empty}</div></body></html>`;
  }, [analysis, summary, qualifications, qualifOverrides, experience, bulletModes, skills, education, customSections, showSummarySection, showRequirementsSection, showSkillsSection, personalInfo, personalInclude, personalFieldOrder, skillCategoryOrder, isDark]);

  // Write preview HTML imperatively so the iframe doesn't reload and lose scroll position
  useEffect(() => {
    const iframe = previewIframeRef.current;
    if (!iframe || !previewHtml) return;
    const scrollY = iframe.contentWindow?.scrollY ?? 0;
    iframe.contentDocument?.open();
    iframe.contentDocument?.write(previewHtml);
    iframe.contentDocument?.close();
    iframe.contentWindow?.scrollTo(0, scrollY);
  }, [previewHtml]);

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
    const includedExp = experience.filter(exp => exp.include !== false && exp.bullets.some(b => b.include));
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

    // Skills grouped by category
    const includedSkills = skills.filter(s => s.include);
    if (showSkillsSection && includedSkills.length > 0) {
      children.push(sectionHeading('Skills'));
      const skillsByCat = includedSkills.reduce<Record<string, string[]>>((acc, s) => {
        const cat = s.category || 'Other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(s.name);
        return acc;
      }, {});
      const orderedCats = [...new Set([...skillCategoryOrder, ...Object.keys(skillsByCat)])].filter(c => skillsByCat[c]?.length);
      for (const cat of orderedCats) {
        children.push(new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: `${cat}: `, bold: true, size: 20 }),
            new TextRun({ text: skillsByCat[cat].join(', '), size: 20 }),
          ],
          spacing: { after: 60 },
        }));
      }
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

    // Custom extra sections
    for (const sec of customSections.filter(s => s.include)) {
      const includedEntries = sec.entries.filter(e => e.include);
      if (!includedEntries.length) continue;
      const def = CUSTOM_SECTION_TYPES.find(d => d.type === sec.type);
      children.push(sectionHeading(sec.title));
      for (const entry of includedEntries) {
        const f = entry.fields;
        if (sec.type === 'volunteer' || sec.type === 'additional') {
          const role = f.role || ''; const org = f.org || f.company || ''; const loc = f.location || '';
          const period = sec.type === 'volunteer'
            ? [f.startDate, f.endDate].filter(Boolean).join(' – ')
            : (f.period || '');
          children.push(new Paragraph({ children: [new TextRun({ text: role, bold: true, size: 20 }), ...(period ? [new TextRun({ text: '\t' + period, size: 20, bold: true, italics: true })] : [])], tabStops: [{ type: 'right', position: 10440 }], spacing: { before: 100, after: 20 } }));
          const meta = [org, loc].filter(Boolean).join(', ');
          if (meta) children.push(new Paragraph({ children: [new TextRun({ text: meta, size: 20, italics: true })], spacing: { after: 40 } }));
          (f.description || '').split('\n').filter(Boolean).forEach(line => children.push(bullet(line)));
        } else if (sec.type === 'projects') {
          children.push(new Paragraph({ children: [new TextRun({ text: f.name || '', bold: true, size: 20 }), ...(f.period ? [new TextRun({ text: '\t' + f.period, size: 20, bold: true, italics: true })] : [])], tabStops: [{ type: 'right', position: 10440 }], spacing: { before: 100, after: 20 } }));
          const meta = [f.tech, f.link].filter(Boolean).join('  ·  ');
          if (meta) children.push(new Paragraph({ children: [new TextRun({ text: meta, size: 20, italics: true })], spacing: { after: 40 } }));
          (f.description || '').split('\n').filter(Boolean).forEach(line => children.push(bullet(line)));
        } else {
          const parts = (def?.fields ?? []).map(fd => f[fd.key]).filter(Boolean);
          children.push(bullet(parts.join('  ·  ')));
        }
      }
    }

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

                {/* Custom section nav items */}
                {customSections.map(sec => (
                  <button
                    key={sec.id}
                    className={`ws-nav-item${activeSection === sec.id ? ' active' : ''}`}
                    onClick={() => setActiveSection(sec.id)}
                  >
                    <span className="ws-nav-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                    </span>
                    <span className="ws-nav-label">{sec.title}</span>
                  </button>
                ))}
              </div>

              {/* + Add Section button */}
              {(() => {
                const availableTypes = CUSTOM_SECTION_TYPES.filter(def => !customSections.some(s => s.type === def.type));
                if (availableTypes.length === 0) return null;
                return (
                  <div className="ws-nav-add-wrap" ref={addMenuRef}>
                    <button className="ws-nav-add-btn" onClick={() => setShowAddMenu(m => !m)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Add Section
                    </button>
                    {showAddMenu && (
                      <div className="ws-add-section-menu ws-add-section-menu--nav">
                        {availableTypes.map(def => (
                          <button key={def.type} className="ws-add-section-item" onClick={() => {
                            const newSec: CustomSection = { id: `${def.type}-${Date.now()}`, type: def.type, title: def.title, entries: [emptyEntry(def)], include: true };
                            setCustomSections(prev => [...prev, newSec]);
                            setActiveSection(newSec.id);
                            setShowAddMenu(false);
                          }}>{def.title}</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

            </nav>

            {/* ── Center editor ── */}
            <div className="ws-editor">

              {/* Personal Info */}
              {activeSection === 'personal' && <>
                <div className="ws-editor-header">
                  <div className="ws-editor-section-title">Personal Info</div>
                </div>
                <div className="ws-editor-body">
                  <div className="ws-personal-form">
                    {personalFieldOrder.map((key, idx) => {
                      const def = PERSONAL_FIELD_DEFS.find(f => f.key === key)!;
                      const included = personalInclude[key];
                      return (
                        <div key={key} className="ws-personal-field-wrap">
                          {dragOverIdx === idx && <div className="ws-drop-line" />}
                          <div
                            className={`ws-personal-field${included ? '' : ' excluded'}`}
                            draggable
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
                            <span className="ws-drag-handle" title="Drag to reorder">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
                            </span>
                            <input
                              className="ws-personal-input"
                              value={personalInfo[key]}
                              placeholder={def.placeholder}
                              disabled={!included}
                              onChange={e => setPersonalInfo(prev => ({ ...prev, [key]: e.target.value }))}
                            />
                            <button
                              className={`ws-toggle${included ? ' on' : ''}`}
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
                        const activeEdit = (() => {
                          if (q.match) {
                            if (override === null) return { key: `${idx}-match`, text: q.match };
                            const si = q.suggestions.indexOf(override);
                            if (si >= 0) return { key: `${idx}-s${si}`, text: override };
                            return override ? { key: `${idx}-override`, text: override } : null;
                          }
                          if (!override) return q.readySentence ? { key: `${idx}-ready`, text: q.readySentence } : null;
                          if (override === q.readySentence) return { key: `${idx}-ready`, text: override };
                          return { key: `${idx}-override`, text: override };
                        })();
                        return (
                          <div key={idx} className={`ws-req-card${q.include ? ' included' : ' disabled'}`}>
                            <div className="ws-req-card-top">
                              <div className="ws-req-text">{q.requirement}</div>
                              {!q.match && <span className="ws-req-missing-badge">Not found</span>}
                            </div>
                            {(() => {
                              const saveOptEdit = (key: string, text: string) => {
                                const val = text.trim();
                                if (val) {
                                  if (key === `${idx}-match`) {
                                    setQualifications(prev => prev.map((qi, i) => i !== idx ? qi : { ...qi, match: val, include: true }));
                                  } else if (key === `${idx}-ready`) {
                                    setQualifications(prev => prev.map((qi, i) => i !== idx ? qi : { ...qi, readySentence: val, include: true }));
                                    setQualifOverrides(prev => { const n = [...prev]; n[idx] = val; return n; });
                                  } else if (key.startsWith(`${idx}-s`)) {
                                    const si = parseInt(key.slice(`${idx}-s`.length));
                                    setQualifications(prev => prev.map((qi, i) => {
                                      if (i !== idx) return qi;
                                      const sArr = [...qi.suggestions]; sArr[si] = val;
                                      return { ...qi, suggestions: sArr, include: true };
                                    }));
                                    setQualifOverrides(prev => { const n = [...prev]; n[idx] = val; return n; });
                                  } else {
                                    setQualifOverrides(prev => { const n = [...prev]; n[idx] = val; return n; });
                                    setQualifications(prev => prev.map((qi, i) => i !== idx ? qi : { ...qi, include: true }));
                                  }
                                }
                                setEditingOptKey(null);
                              };
                              const renderOptInput = (key: string) => (
                                <textarea
                                  key={key}
                                  className="ws-req-edit-input"
                                  value={editingOptValue}
                                  autoFocus
                                  rows={2}
                                  onChange={e => setEditingOptValue(e.target.value)}
                                  onBlur={() => saveOptEdit(key, editingOptValue)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveOptEdit(key, editingOptValue); }
                                    if (e.key === 'Escape') setEditingOptKey(null);
                                  }}
                                />
                              );
                              if (q.match) return (
                                <div className="ws-req-options">
                                  {editingOptKey === `${idx}-match` ? renderOptInput(`${idx}-match`) : (
                                    <button className={`ws-req-opt${q.include && override === null ? ' sel' : ''}`} onClick={() => selectQualifOption(idx, null)}>{q.match}</button>
                                  )}
                                  {override && override !== q.match && !q.suggestions.includes(override) && (
                                    editingOptKey === `${idx}-override` ? renderOptInput(`${idx}-override`) : (
                                      <button className={`ws-req-opt${q.include && override !== null ? ' sel' : ''}`} onClick={() => selectQualifOption(idx, override)}>{override}</button>
                                    )
                                  )}
                                  {q.suggestions.map((s, si) => (
                                    editingOptKey === `${idx}-s${si}` ? renderOptInput(`${idx}-s${si}`) : (
                                      <button key={si} className={`ws-req-opt${q.include && override === s ? ' sel' : ''}`} onClick={() => selectQualifOption(idx, s)}>{s}</button>
                                    )
                                  ))}
                                </div>
                              );
                              return (
                                <>
                                  {q.suggestions.length > 0 && (
                                    <div className="ws-req-hints">
                                      {q.suggestions.map((s, si) => (
                                        <p key={si} className="ws-req-hint-text">{s}</p>
                                      ))}
                                    </div>
                                  )}
                                  {q.readySentence && (
                                    editingOptKey === `${idx}-ready` ? renderOptInput(`${idx}-ready`) : (
                                      <button
                                        className={`ws-req-ready-btn${q.include && override === q.readySentence ? ' sel' : ''}`}
                                        onClick={() => selectQualifOption(idx, q.readySentence!)}
                                      >{q.readySentence}</button>
                                    )
                                  )}
                                  {override && override !== q.readySentence && (
                                    editingOptKey === `${idx}-override` ? renderOptInput(`${idx}-override`) : (
                                      <button
                                        className={`ws-req-ready-btn${q.include ? ' sel' : ''}`}
                                        onClick={() => setQualifications(prev => prev.map((qi, i) => i !== idx ? qi : { ...qi, include: !qi.include }))}
                                      >{override}</button>
                                    )
                                  )}
                                </>
                              );
                            })()}
                            {regeneratingQualifs[idx] ? (
                              <div className="ws-bullet-regen-msg">
                                <span className="badge-selector-ai-spinner" />
                                Regenerating…
                              </div>
                            ) : (
                              <div className="ws-qualif-hover-bar">
                                {activeEdit && editingOptKey !== activeEdit.key && (
                                  <button
                                    className="ws-bullet-regen-btn"
                                    title="Edit selected option"
                                    onClick={() => { setEditingOptKey(activeEdit.key); setEditingOptValue(activeEdit.text); }}
                                  >✎ Edit</button>
                                )}
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
                  <button className="ws-reanalyze-btn" onClick={reanalyze}>↺ Re-analyze</button>
                </div>
                <div className="ws-editor-body">
                  {experience.length === 0
                    ? <div className="ws-empty">No experience extracted.</div>
                    : <div className="ws-edu-list">
                        {experience.map((exp, ei) => (
                          <div key={ei} className={`ws-edu-card${exp.include === false ? ' excluded' : ''}`}>
                            <div className="ws-edu-card-header">
                              <span className="ws-edu-card-label">Entry {ei + 1}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <button
                                  className="ws-edu-delete-btn"
                                  title="Delete entry"
                                  onClick={() => setExperience(prev => prev.filter((_, i) => i !== ei))}
                                >✕</button>
                                <button
                                  className={`ws-toggle${exp.include !== false ? ' on' : ''}`}
                                  onClick={() => setExperience(prev => prev.map((ex, i) => i !== ei ? ex : { ...ex, include: ex.include === false }))}
                                  aria-label={exp.include !== false ? 'Exclude' : 'Include'}
                                ><span className="ws-toggle-thumb" /></button>
                              </div>
                            </div>
                            <div className="ws-edu-fields">
                              <div className="ws-edu-field ws-full">
                                <label className="ws-personal-label">Title</label>
                                <input className="ws-edu-input" value={exp.title} onChange={e => setExperience(prev => prev.map((ex, i) => i !== ei ? ex : { ...ex, title: e.target.value }))} />
                              </div>
                              <div className="ws-edu-field">
                                <label className="ws-personal-label">Company</label>
                                <input className="ws-edu-input" value={exp.company} onChange={e => setExperience(prev => prev.map((ex, i) => i !== ei ? ex : { ...ex, company: e.target.value }))} />
                              </div>
                              <div className="ws-edu-field">
                                <label className="ws-personal-label">Period</label>
                                <input className="ws-edu-input" value={exp.period} onChange={e => setExperience(prev => prev.map((ex, i) => i !== ei ? ex : { ...ex, period: e.target.value }))} />
                              </div>
                              <div className="ws-edu-field ws-full">
                                <label className="ws-personal-label">Location</label>
                                <input className="ws-edu-input" value={exp.location ?? ''} onChange={e => setExperience(prev => prev.map((ex, i) => i !== ei ? ex : { ...ex, location: e.target.value }))} />
                              </div>
                            </div>

                            <div className="ws-exp-bullets">
                              <div className="ws-exp-bullets-label">Bullets</div>
                              {exp.bullets.map((bullet, bi) => {
                                const key = `${ei}-${bi}`;
                                const mode = getBulletMode(ei, bi);
                                const matchClass = bullet.matchLevel === 'full' ? 'match-full' : bullet.matchLevel === 'partial' ? 'match-partial' : 'match-none';
                                return (
                                  <div key={bi} className={`ws-exp-bullet-item ${matchClass}`}>
                                    {/* Original version */}
                                    <div className={`ws-bullet-version${mode === 'original' ? ' selected' : ''}`}
                                         onClick={() => setBulletModes(prev => ({ ...prev, [key]: 'original' }))}>
                                      <span className="ws-version-badge ws-version-o" title="Original">O</span>
                                      <textarea
                                        className="ws-tailored-edit ws-version-ta"
                                        value={bullet.text}
                                        placeholder="Describe what you did or achieved…"
                                        rows={1}
                                        onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                                        ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                                        onChange={e => setExperience(prev => prev.map((ex, i) => i !== ei ? ex : {
                                          ...ex, bullets: ex.bullets.map((b, j) => j !== bi ? b : { ...b, text: e.target.value }),
                                        }))}
                                      />
                                    </div>
                                    {/* Tailored version */}
                                    <div className={`ws-bullet-version${mode === 'tailored' ? ' selected' : ''}`}
                                         onClick={() => setBulletModes(prev => ({ ...prev, [key]: 'tailored' }))}>
                                      <span className="ws-version-badge ws-version-t" title="Tailored">T</span>
                                      {regeneratingBullets[key] ? (
                                        <div className="ws-bullet-regen-msg" style={{ flex: 1 }}>
                                          <span className="badge-selector-ai-spinner" />Regenerating…
                                        </div>
                                      ) : (
                                        <textarea
                                          className="ws-tailored-edit ws-version-ta"
                                          value={bullet.tailored || bullet.text}
                                          placeholder="Click ↺ to generate a tailored version…"
                                          rows={1}
                                          onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                                          ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                                          onChange={e => setExperience(prev => prev.map((ex, i) => i !== ei ? ex : {
                                            ...ex, bullets: ex.bullets.map((b, j) => j !== bi ? b : { ...b, tailored: e.target.value }),
                                          }))}
                                        />
                                      )}
                                    </div>
                                    {/* Keywords + hover actions */}
                                    <div className="ws-exp-bullet-bottom">
                                      <div className="ws-kw-chips-row">
                                        {bullet.keywords.map((kw, ki) => <span key={ki} className="ws-kw-chip">{kw}</span>)}
                                      </div>
                                      <div className="ws-exp-bullet-actions">
                                        <button className="ws-exp-bullet-action-btn" title="Regenerate tailored" disabled={!!regeneratingBullets[key]} onClick={e => { e.stopPropagation(); handleRegenerateBullet(ei, bi); }}>↺</button>
                                        <button className="ws-exp-bullet-action-btn ws-exp-bullet-remove" title="Remove bullet" onClick={e => { e.stopPropagation(); setExperience(prev => prev.map((ex, i) => i !== ei ? ex : { ...ex, bullets: ex.bullets.filter((_, j) => j !== bi) })); }}>✕</button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                              <button className="ws-add-desc-btn ws-add-bullet-btn" onClick={() => handleAddBullet(ei)} disabled={loadingSuggestions[ei]}>
                                {loadingSuggestions[ei]
                                  ? <><span className="badge-selector-ai-spinner" /> Generating suggestion…</>
                                  : pendingSuggestions[ei]
                                    ? `+ ${pendingSuggestions[ei]!.text.length > 90 ? pendingSuggestions[ei]!.text.slice(0, 90) + '…' : pendingSuggestions[ei]!.text}`
                                    : '+ Add Bullet'
                                }
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                  }
                </div>
              </>}

              {/* Skills */}
              {activeSection === 'skills' && <>
                <div className="ws-editor-header">
                  <div>
                    <div className="ws-editor-section-title">Skills</div>
                    <div className="ws-editor-subtitle">Click to toggle · drag chips between categories · drag ⠿ to reorder</div>
                    <div className="ws-editor-subtitle" style={{ marginTop: '0.2rem' }}>
                      <span style={{ color: '#fbbf24', fontWeight: 600 }}>Yellow chips</span> are AI-suggested skills from the job post not found in your resume — include them if they apply to you
                    </div>
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
                  {(() => {
                    const grouped = skills.reduce<Record<string, { skill: typeof skills[0]; idx: number }[]>>((acc, skill, idx) => {
                      const cat = skill.category || 'Other';
                      if (!acc[cat]) acc[cat] = [];
                      acc[cat].push({ skill, idx });
                      return acc;
                    }, {});
                    const orderedCats = [...new Set([...skillCategoryOrder, ...Object.keys(grouped)])];
                    return (
                      <div className="ws-skills-categories">
                        {orderedCats.map((cat, catIdx) => (
                          <div
                            key={cat}
                            className={`ws-skills-group${dragOverSkillCat === cat ? ' skill-drop-target' : ''}${dragOverCatInsertIdx === catIdx ? ' cat-insert-before' : ''}`}
                            onDragOver={e => {
                              e.preventDefault();
                              if (skillDragTarget.current?.type === 'skill') setDragOverSkillCat(cat);
                              if (skillDragTarget.current?.type === 'category') setDragOverCatInsertIdx(catIdx);
                            }}
                            onDragLeave={() => { setDragOverSkillCat(null); setDragOverCatInsertIdx(null); }}
                            onDrop={e => {
                              e.preventDefault();
                              if (skillDragTarget.current?.type === 'skill') {
                                moveSkillToCategory(skillDragTarget.current.skillIdx, cat);
                              } else if (skillDragTarget.current?.type === 'category') {
                                reorderCategory(skillDragTarget.current.cat, catIdx);
                              }
                              skillDragTarget.current = null;
                              setDragOverSkillCat(null);
                              setDragOverCatInsertIdx(null);
                            }}
                          >
                            <div className="ws-skills-group-header">
                              <span
                                className="ws-drag-handle ws-cat-drag-handle"
                                draggable
                                onDragStart={() => { skillDragTarget.current = { type: 'category', cat }; }}
                                onDragEnd={() => { skillDragTarget.current = null; setDragOverCatInsertIdx(null); }}
                                title="Drag to reorder category"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.8"/><circle cx="15" cy="5" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="19" r="1.8"/><circle cx="15" cy="19" r="1.8"/></svg>
                              </span>
                              {editingCategory === cat
                                ? <input
                                    className="ws-cat-edit-input"
                                    value={editingCategoryValue}
                                    autoFocus
                                    onChange={e => setEditingCategoryValue(e.target.value)}
                                    onBlur={saveEditCategory}
                                    onKeyDown={e => { if (e.key === 'Enter') saveEditCategory(); if (e.key === 'Escape') setEditingCategory(null); }}
                                  />
                                : <span
                                    className="ws-skills-group-label"
                                    title="Double-click to rename"
                                    onDoubleClick={() => { setEditingCategory(cat); setEditingCategoryValue(cat); }}
                                  >{cat}</span>
                              }
                              <button
                                className="ws-cat-delete-btn"
                                title="Remove category"
                                onClick={e => { e.stopPropagation(); deleteSkillCategory(cat); }}
                              >✕</button>
                            </div>
                            <div
                              className="workshop-skills ws-skill-drop-zone"
                              onDragOver={e => { if (skillDragTarget.current?.type === 'skill') { e.preventDefault(); setDragOverSkillCat(cat); } }}
                            >
                              {(grouped[cat] ?? []).map(({ skill, idx }) => (
                                <button
                                  key={idx}
                                  draggable
                                  onDragStart={e => { e.stopPropagation(); skillDragTarget.current = { type: 'skill', skillIdx: idx }; }}
                                  onDragEnd={() => { skillDragTarget.current = null; setDragOverSkillCat(null); }}
                                  className={`workshop-skill-chip${skill.include ? ' included' : ''}${skill.isSuggestion ? ' suggestion' : ''}`}
                                  onClick={() => toggleSkill(idx)}
                                  title={skill.note || undefined}
                                >
                                  {skill.name}
                                </button>
                              ))}
                              {addingSkillToCat === cat
                                ? <input
                                    className="ws-skill-add-input"
                                    autoFocus
                                    value={newSkillName}
                                    placeholder="Skill name…"
                                    onChange={e => setNewSkillName(e.target.value)}
                                    onBlur={() => confirmAddSkill(cat)}
                                    onKeyDown={e => { if (e.key === 'Enter') confirmAddSkill(cat); if (e.key === 'Escape') { setAddingSkillToCat(null); setNewSkillName(''); } }}
                                  />
                                : <button
                                    className="ws-skill-add-btn"
                                    title="Add skill"
                                    onClick={e => { e.stopPropagation(); setAddingSkillToCat(cat); setNewSkillName(''); }}
                                  >+</button>
                              }
                            </div>
                          </div>
                        ))}
                        <button className="ws-add-skill-cat-btn" onClick={addSkillCategory}>+ Add Category</button>
                      </div>
                    );
                  })()}
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
                  <div className="ws-edu-list">
                    {education.map((edu, idx) => {
                      const setField = (field: keyof TailorEducation, val: string) =>
                        setEducation(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item));
                      return (
                        <div key={idx} className={`ws-edu-card${edu.include ? '' : ' excluded'}`}>
                          <div className="ws-edu-card-header">
                            <span className="ws-edu-card-label">Entry {idx + 1}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <button
                                className="ws-edu-delete-btn"
                                title="Delete entry"
                                onClick={() => setEducation(prev => prev.filter((_, i) => i !== idx))}
                              >✕</button>
                              <button
                                className={`ws-toggle${edu.include ? ' on' : ''}`}
                                onClick={() => setEducation(prev => prev.map((item, i) => i === idx ? { ...item, include: !item.include } : item))}
                                aria-label={edu.include ? 'Exclude' : 'Include'}
                              ><span className="ws-toggle-thumb" /></button>
                            </div>
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
                    <button
                      className="ws-add-desc-btn"
                      onClick={() => setEducation(prev => [...prev, { program: '', school: '', location: '', startDate: '', endDate: '', include: true }])}
                    >+ Add Entry</button>
                  </div>
                </div>
              </>}

              {/* Custom section pages */}
              {(() => {
                const sec = customSections.find(s => s.id === activeSection);
                if (!sec) return null;
                const def = CUSTOM_SECTION_TYPES.find(d => d.type === sec.type);
                if (!def) return null;
                return <>
                  <div className="ws-editor-header">
                    <div>
                      <div className="ws-editor-section-title">{sec.title}</div>
                      <div className="ws-editor-subtitle">{sec.entries.filter(e => e.include).length} of {sec.entries.length} entries included</div>
                    </div>
                    <button className={`ws-toggle${sec.include ? ' on' : ''}`} onClick={() => setCustomSections(prev => prev.map(s => s.id === sec.id ? { ...s, include: !s.include } : s))} title={sec.include ? 'Hide from resume' : 'Show in resume'}><span className="ws-toggle-thumb" /></button>
                  </div>
                  <div className="ws-editor-body">
                    <div className="ws-edu-list">
                      {sec.entries.map((entry, ei) => (
                        <div key={ei} className={`ws-edu-card${entry.include ? '' : ' excluded'}`}>
                          <div className="ws-edu-card-header">
                            <span className="ws-edu-card-label">Entry {ei + 1}</span>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                              {sec.entries.length > 1 && <button className="ws-remove-sec-btn" title="Remove entry" onClick={() => setCustomSections(prev => prev.map(s => s.id !== sec.id ? s : { ...s, entries: s.entries.filter((_, j) => j !== ei) }))}>✕</button>}
                              <button className={`ws-toggle${entry.include ? ' on' : ''}`} onClick={() => setCustomSections(prev => prev.map(s => s.id !== sec.id ? s : { ...s, entries: s.entries.map((e, j) => j !== ei ? e : { ...e, include: !e.include }) }))} aria-label="Toggle entry"><span className="ws-toggle-thumb" /></button>
                            </div>
                          </div>
                          <div className="ws-edu-fields">
                            {def.fields.map(fd => {
                              const updateField = (val: string) =>
                                setCustomSections(prev => prev.map(s => s.id !== sec.id ? s : {
                                  ...s, entries: s.entries.map((en, j) => j !== ei ? en : { ...en, fields: { ...en.fields, [fd.key]: val } }),
                                }));
                              const disabled = !entry.include || !sec.include;
                              return (
                                <div key={fd.key} className={`ws-edu-field${fd.half ? '' : ' ws-full'}`}>
                                  <label className="ws-personal-label">{fd.label}</label>
                                  {fd.multiline ? (() => {
                                    const lines = (entry.fields[fd.key] || '').split('\n');
                                    const setLines = (next: string[]) => updateField(next.join('\n'));
                                    return (
                                      <div className="ws-desc-list">
                                        {lines.map((line, li) => (
                                          <div key={li} className="ws-desc-item">
                                            <input
                                              className="ws-edu-input ws-desc-input"
                                              value={line}
                                              disabled={disabled}
                                              placeholder="Add a description…"
                                              onChange={e => { const n = [...lines]; n[li] = e.target.value; setLines(n); }}
                                            />
                                            {lines.length > 1 && (
                                              <button className="ws-desc-remove" disabled={disabled} onClick={() => setLines(lines.filter((_, i) => i !== li))}>✕</button>
                                            )}
                                          </div>
                                        ))}
                                        <button className="ws-add-desc-btn" disabled={disabled} onClick={() => setLines([...lines, ''])}>+ Add</button>
                                      </div>
                                    );
                                  })() : (
                                    <input className="ws-edu-input" disabled={disabled} value={entry.fields[fd.key] || ''} onChange={e => updateField(e.target.value)} />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <button className="ws-add-entry-btn ws-add-entry-btn--standalone" onClick={() => setCustomSections(prev => prev.map(s => s.id !== sec.id ? s : { ...s, entries: [...s.entries, emptyEntry(def)] }))}>+ Add Entry</button>
                  </div>
                </>;
              })()}

            </div>

            {/* ── Right preview ── */}
            <div className="ws-preview">
              <div className="ws-preview-header">
                <button className={`ws-preview-tab${previewTab === 'preview' ? ' active' : ''}`} onClick={() => setPreviewTab('preview')}>Live Preview</button>
                <button className={`ws-preview-tab${previewTab === 'jd' ? ' active' : ''}`} onClick={() => setPreviewTab('jd')}>Job Description</button>
              </div>
              <iframe
                ref={previewIframeRef}
                className="ws-preview-iframe"
                title="Resume Preview"
                sandbox="allow-same-origin"
                style={{ display: previewTab === 'preview' ? 'block' : 'none' }}
              />
              {previewTab === 'jd' && (
                <div className="ws-jd-panel">
                  {job.description
                    ? <div className="ws-jd-text description-content" dangerouslySetInnerHTML={{ __html: job.description }} />
                    : <div className="ws-empty">No job description available.</div>
                  }
                </div>
              )}
            </div>

          </div>
        )}

        {/* Footer */}
        <div className="modal-footer">
          {settings.aiProvider !== 'none' && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', opacity: 0.7, fontFamily: 'monospace', marginRight: 'auto' }}>
              {settings.aiProvider}/{settings.aiModel || '—'}
            </span>
          )}
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
