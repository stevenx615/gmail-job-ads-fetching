import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, ExternalHyperlink } from 'docx';
import type { Job } from '../types';
import type { AppSettings } from '../types/settings';
import type { TailorAnalysis, TailorQualification, TailorExperience, TailorSkill, TailorEducation, CustomSection, CustomSectionEntry } from '../types/ai';
import { analyzeTailorSections, regenerateBullet, regenerateQualification, suggestBullet } from '../services/aiService';
import { WizardStepJD } from './workshop/WizardStepJD';
import { WizardStepResume } from './workshop/WizardStepResume';
import { WizardStepScratch } from './workshop/WizardStepScratch';
import type { WizardStep, ScratchResume } from './workshop/wizardTypes';
import { assembleResumeText } from './workshop/wizardTypes';
import { saveResume, getSavedResumes } from './workshop/resumeStorage';

interface Props {
  job: Job;
  settings: AppSettings;
  onClose: () => void;
}

export const STANDALONE_JOB: Job = {
  id: 'standalone',
  title: '',
  company: '',
  location: '',
  url: '',
  source: 'manual',
  type: '',
  tags: [],
  emailId: '',
  dateReceived: '',
  saved: false,
  applied: false,
  description: '',
  createdAt: null,
};

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

type ScrapedMeta = { title: string; company: string; location: string; salary: string; jobType: string };
const navKey = (jobId: string) => `wz_nav_${jobId}`;
function loadNavState(jobId: string): { step: WizardStep; jd: string; scraped?: ScrapedMeta } | null {
  try {
    const raw = localStorage.getItem(navKey(jobId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveNavState(jobId: string, step: WizardStep, jd: string, scraped?: ScrapedMeta) {
  try {
    if (step === 'workshop') { localStorage.removeItem(navKey(jobId)); return; }
    localStorage.setItem(navKey(jobId), JSON.stringify({ step, jd, scraped }));
  } catch {}
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

// Irregular past-tense verbs and short/common forms that don't end in -ed
const ACTION_VERBS_IRREGULAR = new Set(['built','cut','drove','fed','grew','led','met','ran','rose','set','sold','spoke','taught','told','won','wrote']);
function isActionVerb(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 3) return false;
  // Past tense regular verbs end in -ed (>= 4 chars: e.g. "used", "led" excluded via length)
  if (w.endsWith('ed') && w.length >= 4) return true;
  // Present-participle / gerund forms (-ing) used in some resume styles
  if (w.endsWith('ing') && w.length >= 5) return true;
  return ACTION_VERBS_IRREGULAR.has(w);
}

const SCORE_IMPACT: Record<string, string> = {
  'Tailored bullets': '+8–12 pts',
  'Requirements match': '+6–10 pts',
  'Quantified results': '+4–8 pts',
  'Keyword coverage': '+5–9 pts',
  'Action verbs': '+3–6 pts',
  'Summary depth': '+2–4 pts',
  'Bullet density': '+2–3 pts',
  'Contact info': '+1–2 pts',
  'Education': '+1–2 pts',
};

function suggestVerbFix(text: string): string {
  const t = text.trim();
  if (/^responsible for /i.test(t)) return 'Managed' + t.slice('responsible for'.length);
  if (/^in charge of /i.test(t)) return 'Oversaw' + t.slice('in charge of'.length);
  if (/^worked on /i.test(t)) return 'Built' + t.slice('worked on'.length);
  if (/^helped /i.test(t)) return 'Contributed to' + t.slice('helped'.length);
  if (/^was /i.test(t)) return 'Served as' + t.slice('was'.length);
  return 'Led ' + t.charAt(0).toLowerCase() + t.slice(1);
}

function suggestMetricFix(text: string): string {
  return text.trim().replace(/[.!?]$/, '') + ' — e.g., by 35%, saving $50K, or for 10K+ users';
}

function highlightKeywordsInHtml(html: string, matched: string[], missing: string[], weak: string[]): string {
  type KwEntry = { kw: string; cls: string };
  const entries: KwEntry[] = [
    ...missing.map(kw => ({ kw, cls: 'jd-kw jd-kw-missing' })),
    ...weak.map(kw => ({ kw, cls: 'jd-kw jd-kw-weak' })),
    ...matched.map(kw => ({ kw, cls: 'jd-kw jd-kw-matched' })),
  ].sort((a, b) => b.kw.length - a.kw.length);
  if (entries.length === 0) return html;
  const escaped = entries.map(e => e.kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  const container = document.createElement('div');
  container.innerHTML = html;
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (!regex.test(text)) { regex.lastIndex = 0; return; }
      regex.lastIndex = 0;
      const span = document.createElement('span');
      span.innerHTML = text.replace(regex, match => {
        const lm = match.toLowerCase();
        const entry = entries.find(e => e.kw.toLowerCase() === lm);
        return entry ? `<mark class="${entry.cls}">${match}</mark>` : match;
      });
      node.parentNode?.replaceChild(span, node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'mark') return;
      Array.from(node.childNodes).forEach(walk);
    }
  }
  walk(container);
  return container.innerHTML;
}

function normalizeSectionTitle(title: string): string {
  // If the title has no lowercase letters but has at least one uppercase letter, it's all-caps.
  if (!/[a-z]/.test(title) && /[A-Z]/.test(title)) {
    return title.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
  }
  return title;
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

export function ResumeTailorWorkshop({ job, settings, onClose }: Props) {
  const currentTheme = useSyncExternalStore(subscribeTheme, getThemeSnapshot);
  const isDark = currentTheme === 'dark';
  const isStandalone = job.id === 'standalone';
  const [wizardStep, setWizardStep] = useState<WizardStep>(() => {
    const nav = loadNavState(job.id);
    if (nav?.step && nav.step !== 'analyzing') return nav.step;
    const saved = loadTailorState(job.id);
    return saved?.analysis && isSaveCompatible(saved) ? 'workshop' : 'jd';
  });
  const [navDir, setNavDir] = useState<'forward' | 'backward'>('forward');
  const [localJobDescription, setLocalJobDescription] = useState(() => {
    const nav = loadNavState(job.id);
    // Prefer job.description (most up-to-date, e.g. freshly scraped via job card) over
    // a saved nav-state jd, unless the nav state was itself set from the wizard's own fetch
    // (detected by scrapedMeta being present in nav state).
    if (nav?.jd && nav?.scraped) return nav.jd;
    if (job.description) return job.description;
    if (nav?.jd) return nav.jd;
    return '';
  });
  const [scrapedMeta, setScrapedMeta] = useState<ScrapedMeta | null>(() => loadNavState(job.id)?.scraped ?? null);
  const scrapedTitle   = scrapedMeta?.title   ?? '';
  const scrapedCompany = scrapedMeta?.company ?? '';
  const effectiveTitle   = scrapedTitle   || job.title   || '';
  const effectiveCompany = scrapedCompany || job.company || '';
  const [wizardDocxFile, setWizardDocxFile] = useState<File | null>(null);
  type Phase = 'extracting' | 'analyzing' | 'review';
  const [phase, setPhase] = useState<Phase>('analyzing');
  const [analyzingStep, setAnalyzingStep] = useState(0);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [plainResume, setPlainResume] = useState('');
  const [analysis, setAnalysis] = useState<TailorAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>('overview');
  const [kwTab, setKwTab] = useState<'matched' | 'missing' | 'weak'>('missing');
  const [sectionOrder, setSectionOrder] = useState<string[]>(['summary', 'requirements', 'experience', 'education', 'skills']);
  const [navReorderMode, setNavReorderMode] = useState(false);
  const [navDragOverIdx, setNavDragOverIdx] = useState<number | null>(null);
  const navDragIdx = useRef<number | null>(null);
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
  const [jdHighlight, setJdHighlight] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(() => {
    try { const s = localStorage.getItem('ws_preview_width'); return s ? Math.max(320, Math.min(960, Number(s))) : 700; } catch { return 700; }
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const resizeLiveW = useRef(previewWidth);
  const threepanelRef = useRef<HTMLDivElement>(null);
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartW.current = previewWidth;
    resizeLiveW.current = previewWidth;
    setIsResizing(true);
    const onMove = (ev: MouseEvent) => {
      const containerW = threepanelRef.current?.clientWidth ?? 1200;
      const maxW = containerW - 200 - 14 - 300; // leftnav(200) + handle(14) + editor min(300)
      const next = Math.max(320, Math.min(maxW, resizeStartW.current + (resizeStartX.current - ev.clientX)));
      resizeLiveW.current = next;
      setPreviewWidth(next);
    };
    const onUp = () => {
      setIsResizing(false);
      try { localStorage.setItem('ws_preview_width', String(resizeLiveW.current)); } catch {}
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [previewWidth]);
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
    setCustomSections((a.customSections ?? []).map(s => ({ ...s, title: normalizeSectionTitle(s.title) })));
    setSectionOrder(prev => {
      const standardKeys = new Set(['summary', 'requirements', 'experience', 'education', 'skills']);
      const customIds = (a.customSections ?? []).map((s: CustomSection) => s.id);
      return [...prev.filter(k => standardKeys.has(k)), ...customIds];
    });
    const modes: Record<string, BulletMode> = {};
    a.experience.forEach((exp, ei) => exp.bullets.forEach((_, bi) => { modes[`${ei}-${bi}`] = 'tailored'; }));
    setBulletModes(modes);
    setPhase('review');
    setBuildDone(false);
  };

  const runAnalysis = useCallback(async (resume: string, jobDesc: string): Promise<boolean> => {
    setPhase('analyzing');
    setError(null);
    setBuildDone(false);
    const plain = stripHtml(jobDesc);
    const desc = plain.trim() || `${effectiveTitle} at ${effectiveCompany}`;
    const result = await analyzeTailorSections(resume, desc, effectiveTitle, effectiveCompany, settings);
    if (result.error || !result.analysis) { setError(result.error || 'Analysis failed'); return false; }
    applyAnalysis(result.analysis);
    return true;
  }, [job, settings]);

  function restoreFromSaved(): boolean {
    const saved = loadTailorState(job.id);
    if (!saved?.analysis || !isSaveCompatible(saved)) return false;
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
    if (Array.isArray(saved.customSections)) {
      setCustomSections((saved.customSections as CustomSection[]).map(s => ({ ...s, title: normalizeSectionTitle(s.title) })));
      const standardKeys = new Set(['summary', 'requirements', 'experience', 'education', 'skills']);
      const customIds = (saved.customSections as CustomSection[]).map(s => s.id);
      setSectionOrder(prev => [...prev.filter(k => standardKeys.has(k)), ...customIds]);
    }
    if (saved.showSummarySection !== undefined) setShowSummarySection(saved.showSummarySection);
    if (saved.showRequirementsSection !== undefined) setShowRequirementsSection(saved.showRequirementsSection);
    if (saved.showSkillsSection !== undefined) setShowSkillsSection(saved.showSkillsSection);
    if (saved.personalInfo) setPersonalInfo(saved.personalInfo);
    if (saved.personalInclude) setPersonalInclude(saved.personalInclude);
    if (saved.personalFieldOrder) setPersonalFieldOrder(saved.personalFieldOrder);
    if (Array.isArray(saved.skillCategoryOrder)) setSkillCategoryOrder(saved.skillCategoryOrder as string[]);
    else setSkillCategoryOrder(initSkillCategoryOrder(saved.skills ?? []));
    if (saved.jd) setLocalJobDescription(saved.jd as string);
    if (saved.scrapedMeta) setScrapedMeta(saved.scrapedMeta as ScrapedMeta);
    setPhase('review');
    setRestored(true);
    return true;
  }

  // Restore saved state when opening directly into workshop
  useEffect(() => {
    if (wizardStep !== 'workshop') return;
    restoreFromSaved();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasExistingAnalysis = (() => {
    const saved = loadTailorState(job.id);
    return !!(saved?.analysis && isSaveCompatible(saved));
  })();

  // Run analysis when wizard reaches 'analyzing' step
  useEffect(() => {
    saveNavState(job.id, wizardStep, localJobDescription, scrapedMeta ?? undefined);
  }, [wizardStep, localJobDescription]); // eslint-disable-line react-hooks/exhaustive-deps

  // Simulate step-by-step progress during analysis (wizard step AND workshop re-analyze)
  useEffect(() => {
    if (wizardStep !== 'analyzing' && phase === 'review') return;
    if (phase === 'extracting') { setAnalyzingStep(0); return; }
    if (phase === 'analyzing') {
      setAnalyzingStep(1);
      const d1 = 3000 + Math.random() * 3000;       // 3.0–6.0 s
      const d2 = d1 + 2000 + Math.random() * 2500;  // +2.0–4.5 s
      const d3 = d2 + 1500 + Math.random() * 2000;  // +1.5–3.5 s
      const t1 = setTimeout(() => setAnalyzingStep(2), d1);
      const t2 = setTimeout(() => setAnalyzingStep(3), d2);
      const t3 = setTimeout(() => setAnalyzingStep(4), d3);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }
    // phase === 'review': API finished before animation — fast-forward (wizard only; workshop shows nothing)
    if (wizardStep === 'analyzing') setAnalyzingStep(4);
  }, [phase, wizardStep]);

  // Transition to workshop only after API done AND all steps shown
  useEffect(() => {
    if (analysisReady && analyzingStep >= 4) {
      setAnalysisReady(false);
      setWizardStep('workshop');
    }
  }, [analysisReady, analyzingStep]);

  useEffect(() => {
    if (wizardStep !== 'analyzing') return;
    const run = async () => {
      setAnalysisReady(false);
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
        plain = plainResume;
      }
      setPlainResume(plain);
      const ok = await runAnalysis(plain, localJobDescription);
      if (ok) setAnalysisReady(true);
    };
    run();
  }, [wizardStep]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save whenever user edits any section
  useEffect(() => {
    if (phase !== 'review' || !analysis) return;
    saveTailorState(job.id, { analysis, summary, qualifications, qualifOverrides, experience, bulletModes, skills, education, customSections, showSummarySection, showRequirementsSection, showSkillsSection, personalInfo, personalInclude, personalFieldOrder, skillCategoryOrder, jd: localJobDescription, scrapedMeta });
  }, [phase, analysis, summary, qualifications, qualifOverrides, experience, bulletModes, skills, education, customSections, showSummarySection, showRequirementsSection, showSkillsSection, personalInfo, personalInclude, personalFieldOrder, skillCategoryOrder, localJobDescription, scrapedMeta]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const reanalyze = () => { setRestored(false); setAnalyzingStep(0); runAnalysis(plainResume, localJobDescription); };

  function handleWizardJDNext(jd: string) {
    setLocalJobDescription(jd);
    setNavDir('forward');
    setWizardStep('resume');
  }

  function handleWizardUpload(file: File) {
    setWizardDocxFile(file);
    setResumeName(file.name.replace(/\.[^.]+$/, ''));
    setWizardStep('analyzing');
  }

  function handleScratchComplete(scratch: ScratchResume) {
    const text = assembleResumeText(scratch);
    const name = scratch.personal.name ? `${scratch.personal.name} (scratch)` : 'Scratch Resume';
    saveResume({ name, type: 'scratch', content: text, preview: text.slice(0, 150) });
    setResumeName(name);
    setPlainResume(text);
    setWizardStep('analyzing');
  }

  function handleSelectResume(content: string, resumeId?: string) {
    if (resumeId) {
      localStorage.setItem(`wz_resume_${job.id}`, resumeId);
      const saved = getSavedResumes().find(r => r.id === resumeId);
      if (saved?.name) setResumeName(saved.name);
    }
    setPlainResume(content);
    setWizardStep('analyzing');
  }

  function handleGoToWorkshop(content: string, resumeId?: string) {
    if (resumeId) {
      localStorage.setItem(`wz_resume_${job.id}`, resumeId);
      const saved = getSavedResumes().find(r => r.id === resumeId);
      if (saved?.name) setResumeName(saved.name);
    }
    setPlainResume(content);
    restoreFromSaved();
    setWizardStep('workshop');
  }

  function handleChangeResume() {
    setWizardDocxFile(null);
    setPlainResume('');
    setWizardStep('resume');
  }

  const analyzedResumeId = localStorage.getItem(`wz_resume_${job.id}`);
  const [resumeName, setResumeName] = useState<string>(() => localStorage.getItem(`wz_resume_name_${job.id}`) ?? '');
  useEffect(() => {
    if (resumeName) localStorage.setItem(`wz_resume_name_${job.id}`, resumeName);
  }, [resumeName]); // eslint-disable-line react-hooks/exhaustive-deps
  const resumeDisplayName = resumeName || null;

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
    const result = await regenerateBullet(bullet.text, effectiveTitle, effectiveCompany, bullet.keywords, settings);
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
    const jobDesc = job.description ? stripHtml(job.description) : `${effectiveTitle} at ${effectiveCompany}`;
    const result = await suggestBullet(exp.title, exp.company, effectiveTitle, effectiveCompany, jobDesc, analysis?.matchedKeywords ?? [], settings);
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
    const result = await regenerateQualification(q.requirement, effectiveTitle, effectiveCompany, currentMatch, settings);
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

    // Sections in user-defined order
    for (const key of sectionOrder) {
      if (key === 'summary') {
        if (showSummarySection && summary.trim()) {
          content += `<div class="r-section">Professional Summary</div><p>${summary.replace(/\n/g, '<br>')}</p>`;
        }
      } else if (key === 'requirements') {
        const includedQualifs = qualifications
          .map((q, i) => ({ ...q, effectiveText: qualifOverrides[i] ?? q.match }))
          .filter(q => q.include && q.effectiveText);
        if (showRequirementsSection && includedQualifs.length > 0) {
          content += `<div class="r-section">Key Qualifications</div><ul>${includedQualifs.map(q => `<li>${q.effectiveText}</li>`).join('')}</ul>`;
        }
      } else if (key === 'experience') {
        const expSections = experience.filter(e => e.include !== false).map(exp => {
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
      } else if (key === 'education') {
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
      } else if (key === 'skills') {
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
      } else {
        const sec = customSections.find(s => s.id === key);
        if (sec && sec.include) {
          const includedEntries = sec.entries.filter(e => e.include);
          if (includedEntries.length > 0) {
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
        }
      }
    }

    const empty = `<p style="color:${isDark ? '#4a527a' : '#9ca3af'};font-style:italic;text-align:center;padding:2rem 0">Your tailored resume will appear here as you make selections.</p>`;

    const t = isDark ? {
      bodyBg: '#0C1017', bodyColor: '#c5cee8',
      paperBg: '#0C1118', paperBorder: '#1A2330',
      name: '#f0f2fa', contact: '#7b85a8',
      section: '#818cf8', sectionBorder: '#1A2330',
      text: '#c5cee8', title: '#f0f2fa', meta: '#7b85a8',
      skillLabel: '#c5cee8',
    } : {
      bodyBg: '#ffffff', bodyColor: '#374151',
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
  }, [analysis, summary, qualifications, qualifOverrides, experience, bulletModes, skills, education, customSections, sectionOrder, showSummarySection, showRequirementsSection, showSkillsSection, personalInfo, personalInclude, personalFieldOrder, skillCategoryOrder, isDark]);

  // Write preview HTML imperatively so the iframe doesn't reload and lose scroll position
  useEffect(() => {
    const iframe = previewIframeRef.current;
    if (!iframe || !previewHtml) return;
    const scrollY = iframe.contentWindow?.scrollY ?? 0;
    iframe.contentDocument?.open();
    iframe.contentDocument?.write(previewHtml);
    iframe.contentDocument?.close();
    iframe.contentWindow?.scrollTo(0, scrollY);
  }, [previewHtml, wizardStep]); // wizardStep: re-run when iframe first mounts on transition to workshop

  const buildResume = async () => {
    if (!analysis) return;
    const safeTitle = effectiveTitle.replace(/[^a-z0-9]/gi, '_');
    const safeCompany = effectiveCompany.replace(/[^a-z0-9]/gi, '_');

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

    // Sections in user-defined order
    for (const key of sectionOrder) {
      if (key === 'summary') {
        if (showSummarySection && summary) {
          children.push(sectionHeading('Professional Summary'));
          children.push(new Paragraph({ children: [new TextRun({ text: summary, size: 20 })], spacing: { after: 80 } }));
        }
      } else if (key === 'requirements') {
        const includedQualifs = qualifications.filter(q => q.include);
        if (showRequirementsSection && includedQualifs.length > 0) {
          children.push(sectionHeading('Qualifications'));
          includedQualifs.forEach(q => {
            const text = qualifOverrides[qualifications.indexOf(q)] ?? q.match ?? q.readySentence ?? q.requirement;
            children.push(bullet(text || q.requirement));
          });
        }
      } else if (key === 'experience') {
        const includedExp = experience.filter(exp => exp.include !== false && exp.bullets.some(b => b.include));
        if (includedExp.length > 0) {
          children.push(sectionHeading('Work Experience'));
          includedExp.forEach(exp => {
            const expIdx = experience.indexOf(exp);
            children.push(new Paragraph({
              children: [
                new TextRun({ text: exp.title, bold: true, size: 20 }),
                ...(exp.period ? [new TextRun({ text: '\t' + exp.period, size: 20, bold: true, italics: true })] : []),
              ],
              tabStops: [{ type: 'right', position: 10440 }],
              spacing: { before: 120, after: 20 },
            }));
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
      } else if (key === 'education') {
        const includedEdu = education.filter(e => e.include);
        if (includedEdu.length > 0) {
          children.push(sectionHeading('Education'));
          includedEdu.forEach(e => {
            const datePart = [e.startDate, e.endDate].filter(Boolean).join(' – ');
            children.push(new Paragraph({
              children: [
                new TextRun({ text: e.program || '', bold: true, size: 20 }),
                ...(datePart ? [new TextRun({ text: '\t' + datePart, size: 20, bold: true, italics: true })] : []),
              ],
              tabStops: [{ type: 'right', position: 10440 }],
              spacing: { before: 80, after: 20 },
            }));
            const eduMeta = [e.school, e.location].filter(Boolean).join(', ');
            if (eduMeta) children.push(new Paragraph({ children: [new TextRun({ text: eduMeta, size: 20, italics: true })], spacing: { after: 80 } }));
          });
        }
      } else if (key === 'skills') {
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
      } else {
        const sec = customSections.find(s => s.id === key);
        if (sec && sec.include) {
          const includedEntries = sec.entries.filter(e => e.include);
          if (includedEntries.length > 0) {
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

  // Must be before any early returns — hooks cannot come after conditional returns
  const highlightedJdHtml = useMemo(() => {
    if (!jdHighlight || !analysis) return null;
    const html = job.description || localJobDescription || '';
    if (!html) return null;
    return highlightKeywordsInHtml(html, analysis.matchedKeywords ?? [], analysis.missingKeywords ?? [], analysis.weakKeywords ?? []);
  }, [jdHighlight, analysis, job.description, localJobDescription]);

  if (wizardStep === 'jd') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card wz-modal-card" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              <svg className="wz-modal-title-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>
              </svg>
              Resume Tailor Workshop
            </div>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
          <WizardStepJD
            jobTitle={effectiveTitle}
            jobCompany={effectiveCompany}
            initialJD={localJobDescription}
            jobUrl={job.url ?? ''}
            initialScrapeInfo={scrapedMeta ?? ((job.title || job.company) ? { title: job.title || '', company: job.company || '', location: job.location || '', salary: '', jobType: job.type || '' } : null)}
            onNext={handleWizardJDNext}
            onBack={onClose}
            onJDChange={setLocalJobDescription}
            onScrapedMeta={(title, company, location, salary, jobType) => setScrapedMeta({ title, company, location: location ?? '', salary: salary ?? '', jobType: jobType ?? '' })}
            navDir={navDir}
          />
        </div>
      </div>
    );
  }

  if (wizardStep === 'resume') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card wz-modal-card" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              <svg className="wz-modal-title-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>
              </svg>
              Resume Tailor Workshop
            </div>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
          <WizardStepResume
            onUpload={handleWizardUpload}
            onScratch={() => setWizardStep('scratch')}
            onBack={() => { setNavDir('backward'); setWizardStep('jd'); }}
            onSelectResume={handleSelectResume}
            hasExistingAnalysis={hasExistingAnalysis}
            onGoToWorkshop={handleGoToWorkshop}
            analyzedResumeId={analyzedResumeId}
          />
        </div>
      </div>
    );
  }

  if (wizardStep === 'scratch') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card wz-modal-card" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              <svg className="wz-modal-title-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>
              </svg>
              Resume Tailor Workshop
            </div>
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
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card wz-modal-card" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              <svg className="wz-modal-title-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>
              </svg>
              Resume Tailor Workshop
            </div>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
          <div className="wz-step">
            {/* Progress bar */}
            <div className="wz-progress-bar">
              <div className="wz-progress-step done">
                <div className="wz-progress-dot">✓</div>
                <span className="wz-progress-label">Job Description</span>
              </div>
              <div className="wz-progress-line done" />
              <div className="wz-progress-step done">
                <div className="wz-progress-dot">✓</div>
                <span className="wz-progress-label">Resume</span>
              </div>
              <div className="wz-progress-line done" />
              <div className="wz-progress-step active">
                <div className="wz-progress-dot">3</div>
                <span className="wz-progress-label">Analyze</span>
              </div>
            </div>

            {error ? (
              <>
                <div className="wz-analyze-error">
                  <div className="wz-analyze-error-icon">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                  </div>
                  <div className="wz-analyze-error-title">Analysis failed</div>
                  <div className="wz-analyze-error-msg">{error}</div>
                  <div className="wz-analyze-suggestions">
                    <div className="wz-analyze-suggestion-item">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <span>If you've hit a quota limit, wait a moment and try again, or switch to a different AI provider in Settings.</span>
                    </div>
                    <div className="wz-analyze-suggestion-item">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                      <span>Double-check your API key is correct in Settings → AI Provider.</span>
                    </div>
                    <div className="wz-analyze-suggestion-item">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                      <span>Try trimming the resume or job description to reduce token usage.</span>
                    </div>
                  </div>
                </div>
                <div className="wz-footer wz-footer-split">
                  <button className="wz-back-btn" onClick={() => { setError(null); setWizardStep('resume'); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    Back
                  </button>
                </div>
              </>
            ) : (
              <div className="wz-analyzing-body">
                {/* Pulsing rings animation */}
                <div className="wz-analyzing-hero">
                  <div className="wz-ring wz-ring-3" />
                  <div className="wz-ring wz-ring-2" />
                  <div className="wz-ring wz-ring-1" />
                  <div className="wz-analyzing-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                      <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                      <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                      <line x1="8.12" y1="8.12" x2="12" y2="12"/>
                    </svg>
                  </div>
                </div>

                <div className="wz-analyzing-text">
                  <div className="wz-title">{phase === 'extracting' ? 'Extracting resume content…' : 'Analyzing your resume…'}</div>
                  <div className="wz-analyzing-sub">This takes about 10–20 seconds</div>
                </div>

                {/* Shimmer progress bar */}
                <div className="wz-analyzing-bar"><div className="wz-analyzing-bar-fill" /></div>

                {/* Step checklist */}
                <div className="wz-analyzing-list">
                  {['Extracting resume content', 'Matching requirements', 'Tailoring experience', 'Reviewing skills & education', 'Generating tailored content'].map((label, i) => {
                    const isDone = phase === 'review' || i < analyzingStep;
                    const isActive = wizardStep === 'analyzing' && i === analyzingStep;
                    return (
                      <div key={label} className="wz-analyzing-row">
                        <div className={`wz-analyzing-dot ${isDone ? 'done' : isActive ? 'active' : 'pending'}`}>
                          {isDone ? '✓' : isActive ? <span className="wz-dot-spinner" /> : ''}
                        </div>
                        <span className={`wz-analyzing-label${isDone ? ' done' : isActive ? ' active' : ''}`}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Live score — recomputes whenever workshop state changes
  const liveScore = (() => {
    if (!analysis) return 0;
    const expIncluded = experience.filter(e => e.include !== false);
    const allBullets = expIncluded.flatMap((e, ei) => e.bullets.map((b, bi) => ({ b, ei: experience.indexOf(e), bi })));
    const totalBullets = allBullets.length;
    const tailoredBullets = allBullets.filter(({ ei, bi }) => getBulletMode(ei, bi) === 'tailored').length;
    const bulletsWithMetric = allBullets.filter(({ b, ei, bi }) => /\d/.test(getBulletMode(ei, bi) === 'tailored' ? (b.tailored || b.text) : b.text)).length;
    const bulletsWithVerb = allBullets.filter(({ b, ei, bi }) => {
      const text = getBulletMode(ei, bi) === 'tailored' ? (b.tailored || b.text) : b.text;
      const first = text.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
      return isActionVerb(first);
    }).length;
    const contactFields = ['email', 'phone', 'linkedin'] as const;
    const contactFilled = contactFields.filter(k => personalInclude[k] && personalInfo[k]?.trim()).length;
    const reqSelected = qualifications.filter(q => q.include).length;
    const reqTotal = qualifications.length;
    const missingKwCount = analysis.missingKeywords?.length ?? 0;
    const jTitleWords = effectiveTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const summaryLower = summary.toLowerCase();
    const expText = experience.map(e => `${e.title} ${e.company}`).join(' ').toLowerCase();
    const jTitleHits = jTitleWords.filter(w => summaryLower.includes(w) || expText.includes(w)).length;
    const jobTitleScore = jTitleWords.length > 0 ? Math.min(10, Math.round((jTitleHits / jTitleWords.length) * 10)) : 6;
    const reqSkillScore = reqTotal > 0 ? Math.min(25, Math.round((reqSelected / reqTotal) * 25)) : 12;
    const tailoredRatio = totalBullets > 0 ? tailoredBullets / totalBullets : 0;
    const expRelevScore = Math.min(20, Math.round(tailoredRatio * 20));
    const totalKw = analysis.matchedKeywords.length + missingKwCount;
    const kwContextScore = totalKw > 0 ? Math.min(15, Math.round((analysis.matchedKeywords.length / totalKw) * 15)) : 8;
    const sectionsCount = [summary.trim().length > 20, expIncluded.length > 0, education.some(e => e.include), skills.some(s => s.include), contactFilled >= 2].filter(Boolean).length;
    const structScore = Math.min(10, Math.round((sectionsCount / 5) * 10));
    const verbRatio = totalBullets > 0 ? bulletsWithVerb / totalBullets : 0;
    const metricRatio = totalBullets > 0 ? bulletsWithMetric / totalBullets : 0;
    const achieveScore = Math.min(10, Math.round(verbRatio * 5 + metricRatio * 5));
    return Math.min(100, jobTitleScore + reqSkillScore + expRelevScore + kwContextScore + structScore + 8 + achieveScore);
  })();
  const scoreDelta = analysis ? liveScore - analysis.atsScore : 0;

  return (
    <div className="modal-overlay">
      <div className="modal-card workshop-modal">

        {/* Header */}
        <div className="modal-header ws-modal-header">
          <div className="ws-header-left">
            <div className="modal-title">
              <svg className="ws-modal-title-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                <line x1="8.12" y1="8.12" x2="12" y2="12"/>
              </svg>
              Resume Workshop
              {restored && <span className="ws-restored-badge">Restored</span>}
            </div>
            <div className="tailor-resume-subtitle">{effectiveTitle} · {effectiveCompany}</div>
          </div>
          <button className="wz-change-resume" onClick={() => { setNavDir('backward'); setWizardStep('jd'); }} title="Change job description">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Change Job
          </button>
          <button className="wz-change-resume" onClick={handleChangeResume} title="Change resume">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
            Change Resume
          </button>
          {phase === 'review' && !isLoading && (
            <button className="wz-change-resume" onClick={reanalyze} title="Re-analyze resume against job description">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Re-analyze
            </button>
          )}
          {analysis && (
            <div className="ws-header-score">
              <span className="ws-header-score-label">ATS Score</span>
              <div className="ws-header-score-circle" style={{ borderColor: scoreColor(liveScore), color: scoreColor(liveScore) }}>
                {liveScore}
              </div>
              {scoreDelta !== 0 && (
                <span className="ws-header-score-delta" style={{ color: scoreDelta > 0 ? 'var(--ws-matched-color)' : 'var(--danger)' }}>
                  {scoreDelta > 0 ? '+' : ''}{scoreDelta}
                </span>
              )}
              <span className="ws-header-score-match" style={{ color: scoreColor(liveScore) }}>
                {scoreLabel(liveScore)}
              </span>
            </div>
          )}
          <button className="modal-close" onClick={onClose} disabled={isLoading}>&times;</button>
        </div>

        {/* Loading / Error */}
        {isLoading && (
          <div className="workshop-loading-body">
            <div className="wz-analyzing-body">
              <div className="wz-analyzing-hero">
                <div className="wz-ring wz-ring-3" />
                <div className="wz-ring wz-ring-2" />
                <div className="wz-ring wz-ring-1" />
                <div className="wz-analyzing-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                    <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                    <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                    <line x1="8.12" y1="8.12" x2="12" y2="12"/>
                  </svg>
                </div>
              </div>
              <div className="wz-analyzing-text">
                <div className="wz-title">{phase === 'extracting' ? 'Extracting resume content…' : 'Analyzing your resume…'}</div>
                <div className="wz-analyzing-sub">This takes about 10–20 seconds</div>
              </div>
              <div className="wz-analyzing-bar"><div className="wz-analyzing-bar-fill" /></div>
              <div className="wz-analyzing-list">
                {['Extracting resume content', 'Matching requirements', 'Tailoring experience', 'Reviewing skills & education', 'Generating tailored content'].map((label, i) => {
                  const isDone = i < analyzingStep;
                  const isActive = isLoading && i === analyzingStep;
                  return (
                    <div key={label} className="wz-analyzing-row">
                      <div className={`wz-analyzing-dot ${isDone ? 'done' : isActive ? 'active' : 'pending'}`}>
                        {isDone ? '✓' : isActive ? <span className="wz-dot-spinner" /> : ''}
                      </div>
                      <span className={`wz-analyzing-label${isDone ? ' done' : isActive ? ' active' : ''}`}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {!isLoading && error && (
          <div className="workshop-error-body">
            <div className="tailor-resume-error">{error}</div>
          </div>
        )}

        {/* Three-panel layout */}
        {phase === 'review' && analysis && (
          <div className="workshop-threepanel" ref={threepanelRef} style={{ cursor: isResizing ? 'col-resize' : undefined }}>
            {isResizing && <div style={{ position: 'fixed', inset: 0, zIndex: 9999, cursor: 'col-resize' }} />}

            {/* ── Left nav ── */}
            <nav className="ws-leftnav">
              <div className="ws-nav-top-bar">
                <button
                  className={`ws-nav-reorder-btn${navReorderMode ? ' active' : ''}`}
                  onClick={() => { setNavReorderMode(m => !m); setNavDragOverIdx(null); }}
                  title={navReorderMode ? 'Done reordering' : 'Reorder sections'}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                  </svg>
                  {navReorderMode ? 'Done' : 'Reorder'}
                </button>
              </div>
              <div className="ws-nav-sections">
                <button
                  className={`ws-nav-item${activeSection === 'overview' ? ' active' : ''}`}
                  onClick={() => setActiveSection('overview')}
                >
                  <span className="ws-nav-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                  </span>
                  <span className="ws-nav-label">Overview</span>
                </button>
                {/* Personal Info — pinned, always first */}
                <div className="ws-nav-divider" />
                {(() => {
                  const personalDef = SECTION_DEFS.find(d => d.key === 'personal')!;
                  return (
                    <button
                      className={`ws-nav-item${activeSection === 'personal' ? ' active' : ''}`}
                      onClick={() => setActiveSection('personal')}
                    >
                      <span className="ws-nav-icon">{personalDef.icon}</span>
                      <span className="ws-nav-label">{personalDef.label}</span>
                    </button>
                  );
                })()}

                {/* Draggable sections in user-defined order */}
                {sectionOrder.map((key, idx) => {
                  const std = SECTION_DEFS.find(d => d.key === key && d.key !== 'personal');
                  const cust = !std ? customSections.find(s => s.id === key) : null;
                  const label = std ? std.label : (cust?.title ?? key);
                  const icon = std ? std.icon : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                  );
                  return (
                    <div
                      key={key}
                      className={`ws-nav-drag-wrap${navReorderMode ? ' reorder-mode' : ''}`}
                      draggable={navReorderMode}
                      onDragStart={navReorderMode ? () => { navDragIdx.current = idx; } : undefined}
                      onDragOver={navReorderMode ? e => { e.preventDefault(); setNavDragOverIdx(idx); } : undefined}
                      onDragEnd={navReorderMode ? () => { setNavDragOverIdx(null); navDragIdx.current = null; } : undefined}
                      onDrop={navReorderMode ? () => {
                        if (navDragIdx.current === null || navDragIdx.current === idx) { setNavDragOverIdx(null); return; }
                        setSectionOrder(prev => {
                          const next = [...prev];
                          const [moved] = next.splice(navDragIdx.current!, 1);
                          next.splice(idx, 0, moved);
                          return next;
                        });
                        setNavDragOverIdx(null);
                        navDragIdx.current = null;
                      } : undefined}
                    >
                      {navDragOverIdx === idx && <div className="ws-nav-drop-line" />}
                      <button
                        className={`ws-nav-item${activeSection === key ? ' active' : ''}`}
                        onClick={() => { if (!navReorderMode) setActiveSection(key); }}
                      >
                        {navReorderMode && (
                          <span className="ws-nav-drag-grip">
                            <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
                              <circle cx="3" cy="3" r="1.5" fill="currentColor"/>
                              <circle cx="7" cy="3" r="1.5" fill="currentColor"/>
                              <circle cx="3" cy="7" r="1.5" fill="currentColor"/>
                              <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
                              <circle cx="3" cy="11" r="1.5" fill="currentColor"/>
                              <circle cx="7" cy="11" r="1.5" fill="currentColor"/>
                            </svg>
                          </span>
                        )}
                        <span className="ws-nav-icon">{icon}</span>
                        <span className="ws-nav-label">{label}</span>
                      </button>
                    </div>
                  );
                })}
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
                            setSectionOrder(prev => [...prev, newSec.id]);
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

              {/* Overview */}
              {activeSection === 'overview' && (() => {
                const score = liveScore;
                const circumference = 2 * Math.PI * 38;
                const offset = circumference - (score / 100) * circumference;

                // Raw metrics
                const expIncluded = experience.filter(e => e.include !== false);
                const allBullets = expIncluded.flatMap((e, ei) => e.bullets.map((b, bi) => ({ b, ei: experience.indexOf(e), bi })));
                const totalBullets = allBullets.length;
                const tailoredBullets = allBullets.filter(({ ei, bi }) => getBulletMode(ei, bi) === 'tailored').length;
                const bulletsWithMetric = allBullets.filter(({ b, ei, bi }) => /\d/.test(getBulletMode(ei, bi) === 'tailored' ? (b.tailored || b.text) : b.text)).length;
                const bulletsWithVerb = allBullets.filter(({ b, ei, bi }) => {
                  const text = getBulletMode(ei, bi) === 'tailored' ? (b.tailored || b.text) : b.text;
                  const first = text.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
                  return isActionVerb(first);
                }).length;
                const avgBulletsPerJob = expIncluded.length ? totalBullets / expIncluded.length : 0;
                const summaryWords = summary.trim().split(/\s+/).filter(Boolean).length;
                const contactFields: (keyof typeof personalInfo)[] = ['email', 'phone', 'linkedin'];
                const contactFilled = contactFields.filter(k => personalInclude[k as keyof typeof personalInclude] && personalInfo[k]?.trim()).length;
                const reqSelected = qualifications.filter(q => q.include).length;
                const reqTotal = qualifications.length;
                const skillsIncluded = skills.filter(s => s.include).length;
                const missingKwCount = analysis?.missingKeywords?.length ?? 0;
                const weakKwCount = analysis?.weakKeywords?.length ?? 0;
                const eduIncluded = education.filter(e => e.include).length;

                // Standards
                type Std = { ok: boolean; label: string; value: string; tip: string; target: string };
                const standards: Std[] = [
                  {
                    ok: contactFilled === 3,
                    label: 'Contact info',
                    value: `${contactFilled}/3 key fields`,
                    tip: 'Include email, phone, and LinkedIn so recruiters can reach you.',
                    target: 'personal',
                  },
                  {
                    ok: showSummarySection && summaryWords >= 40,
                    label: 'Summary depth',
                    value: summaryWords ? `${summaryWords} words` : 'Not written',
                    tip: 'Aim for 40–80 words: your background, top strengths, and what you bring to this role.',
                    target: 'summary',
                  },
                  {
                    ok: avgBulletsPerJob >= 3,
                    label: 'Bullet density',
                    value: expIncluded.length ? `avg ${avgBulletsPerJob.toFixed(1)} per role` : 'No experience',
                    tip: '3–5 bullets per role gives enough detail without overwhelming. Add more with + Add Bullet.',
                    target: 'experience',
                  },
                  {
                    ok: totalBullets > 0 && bulletsWithVerb / totalBullets >= 0.7,
                    label: 'Action verbs',
                    value: totalBullets ? `${bulletsWithVerb}/${totalBullets} bullets` : 'No bullets',
                    tip: 'Start each bullet with a strong verb: Led, Built, Reduced, Launched, Optimized…',
                    target: 'experience',
                  },
                  {
                    ok: totalBullets > 0 && bulletsWithMetric / totalBullets >= 0.4,
                    label: 'Quantified results',
                    value: totalBullets ? `${bulletsWithMetric}/${totalBullets} bullets` : 'No bullets',
                    tip: 'Add numbers and percentages: "Reduced load time by 40%", "Managed $2M budget". Aim for 40%+ of bullets.',
                    target: 'experience',
                  },
                  {
                    ok: tailoredBullets === totalBullets && totalBullets > 0,
                    label: 'Tailored bullets',
                    value: totalBullets ? `${tailoredBullets}/${totalBullets} bullets` : 'No bullets',
                    tip: 'Switch bullets to Tailored (T) so the language aligns with this job\'s requirements.',
                    target: 'experience',
                  },
                  {
                    ok: reqTotal > 0 && reqSelected === reqTotal,
                    label: 'Requirements match',
                    value: reqTotal ? `${reqSelected}/${reqTotal} selected` : 'None extracted',
                    tip: 'Select a response for every requirement so the section is complete.',
                    target: 'requirements',
                  },
                  {
                    ok: skillsIncluded >= 5 && missingKwCount === 0,
                    label: 'Keyword coverage',
                    value: missingKwCount ? `${missingKwCount} missing` : `${skillsIncluded} skills`,
                    tip: 'Add missing keywords from the job post to your skills section to boost ATS match.',
                    target: 'skills',
                  },
                  {
                    ok: eduIncluded > 0,
                    label: 'Education',
                    value: eduIncluded ? `${eduIncluded} entr${eduIncluded > 1 ? 'ies' : 'y'}` : 'None included',
                    tip: 'Include at least one education entry so the recruiter can verify your background.',
                    target: 'education',
                  },
                ];

                const passed = standards.filter(s => s.ok).length;
                const verbStd = standards.find(s => s.label === 'Action verbs')!;
                const metricStd = standards.find(s => s.label === 'Quantified results')!;

                // Score breakdown: use AI-provided if available, otherwise estimate from local data
                const scoreBreakdown = analysis.scoreBreakdown ?? (() => {
                  const jTitleWords = effectiveTitle.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
                  const summaryLower = summary.toLowerCase();
                  const expText = experience.map(e => `${e.title} ${e.company}`).join(' ').toLowerCase();
                  const jTitleHits = jTitleWords.filter((w: string) => summaryLower.includes(w) || expText.includes(w)).length;
                  const jobTitleScore = jTitleWords.length > 0 ? Math.min(10, Math.round((jTitleHits / jTitleWords.length) * 10)) : 6;
                  const reqSkillScore = reqTotal > 0 ? Math.min(25, Math.round((reqSelected / reqTotal) * 25)) : 12;
                  const fullBullets = allBullets.filter(({ b }) => b.matchLevel === 'full').length;
                  const partialBullets = allBullets.filter(({ b }) => b.matchLevel === 'partial').length;
                  const expRelevScore = totalBullets > 0 ? Math.min(20, Math.round(((fullBullets + partialBullets * 0.5) / totalBullets) * 20)) : 10;
                  const totalKw = analysis.matchedKeywords.length + missingKwCount;
                  const kwContextScore = totalKw > 0 ? Math.min(15, Math.round((analysis.matchedKeywords.length / totalKw) * 15)) : 8;
                  const sectionsCount = [summary.trim().length > 20, expIncluded.length > 0, education.some(e => e.include), skills.some(s => s.include), contactFilled >= 2].filter(Boolean).length;
                  const structScore = Math.min(10, Math.round((sectionsCount / 5) * 10));
                  const verbRatio = totalBullets > 0 ? bulletsWithVerb / totalBullets : 0;
                  const metricRatio = totalBullets > 0 ? bulletsWithMetric / totalBullets : 0;
                  const achieveScore = Math.min(10, Math.round(verbRatio * 5 + metricRatio * 5));
                  return [
                    { category: 'Job Title Match', score: jobTitleScore, max: 10 },
                    { category: 'Required Skills', score: reqSkillScore, max: 25 },
                    { category: 'Experience Relevance', score: expRelevScore, max: 20 },
                    { category: 'Keyword Context', score: kwContextScore, max: 15 },
                    { category: 'Resume Structure', score: structScore, max: 10 },
                    { category: 'ATS Formatting', score: 8, max: 10 },
                    { category: 'Achievement Quality', score: achieveScore, max: 10 },
                  ];
                })();

                const baVerbBefore = (() => {
                  const item = allBullets.find(({ b, ei, bi }) => {
                    const text = getBulletMode(ei, bi) === 'tailored' ? (b.tailored || b.text) : b.text;
                    const first = text.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
                    return text.trim().length > 10 && !isActionVerb(first);
                  });
                  if (!item) return null;
                  return getBulletMode(item.ei, item.bi) === 'tailored' ? (item.b.tailored || item.b.text) : item.b.text;
                })();
                const baVerbAfter = baVerbBefore ? suggestVerbFix(baVerbBefore) : null;

                const baMetricBefore = (() => {
                  const item = allBullets.find(({ b, ei, bi }) => {
                    const text = getBulletMode(ei, bi) === 'tailored' ? (b.tailored || b.text) : b.text;
                    return text.trim().length > 10 && !/\d/.test(text);
                  });
                  if (!item) return null;
                  return getBulletMode(item.ei, item.bi) === 'tailored' ? (item.b.tailored || item.b.text) : item.b.text;
                })();
                const baMetricAfter = baMetricBefore ? suggestMetricFix(baMetricBefore) : null;

                type Action = { label: string; tip: string; target: string; priority: 'high' | 'med' | 'low' };
                const actions: Action[] = standards
                  .filter(s => !s.ok)
                  .map(s => {
                    const priority: 'high' | 'med' | 'low' =
                      ['Tailored bullets', 'Requirements match', 'Action verbs', 'Quantified results'].includes(s.label) ? 'high'
                      : ['Keyword coverage', 'Summary depth', 'Bullet density'].includes(s.label) ? 'med'
                      : 'low';
                    return { label: s.label, tip: s.tip, target: s.target, priority };
                  })
                  .sort((a, b) => ({ high: 0, med: 1, low: 2 }[a.priority] - { high: 0, med: 1, low: 2 }[b.priority]));

                const priorityColor = { high: '#ef4444', med: '#f59e0b', low: '#6366f1' };
                const priorityLabel = { high: 'High', med: 'Med', low: 'Low' };
                const effectiveKwTab = kwTab === 'weak' && weakKwCount === 0 ? 'missing' : kwTab;

                return <>
                  <div className="ws-editor-header">
                    <div className="ws-editor-section-title">Overview</div>
                    <div className="ws-ov-header-meta">{passed}/{standards.length} standards met</div>
                  </div>
                  <div className="ws-editor-body ws-overview-body">

                    {/* 1. ATS Readiness Score  +  2. Short AI Summary */}
                    <div className="ws-ov-score-card">
                      <svg width="96" height="96" viewBox="0 0 96 96" style={{ flexShrink: 0 }}>
                        <circle cx="48" cy="48" r="38" fill="none" stroke="var(--card-border)" strokeWidth="7" />
                        <circle cx="48" cy="48" r="38" fill="none" stroke={scoreColor(score)} strokeWidth="7"
                          strokeDasharray={circumference} strokeDashoffset={offset}
                          strokeLinecap="round" transform="rotate(-90 48 48)" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
                        <text x="48" y="53" textAnchor="middle" fontSize="20" fontWeight="700" fill={scoreColor(score)}>{score}</text>
                      </svg>
                      <div style={{ flex: 1 }}>
                        <div className="ws-ov-score-label" style={{ color: scoreColor(score) }}>{scoreLabel(score)} · ATS Readiness Score</div>
                        {scoreDelta !== 0 && (
                          <div className="ws-ov-score-delta">
                            <span style={{ color: scoreDelta > 0 ? 'var(--ws-matched-color)' : 'var(--danger)', fontWeight: 600 }}>
                              {scoreDelta > 0 ? '+' : ''}{scoreDelta} pts
                            </span>
                            {' '}from initial AI score of <strong>{analysis.atsScore}</strong>
                          </div>
                        )}
                        {(analysis.aiSummary || analysis.tips?.[0]) && (
                          <div className="ws-ov-ai-summary">{analysis.aiSummary || analysis.tips[0]}</div>
                        )}
                      </div>
                      {(effectiveTitle || effectiveCompany || resumeDisplayName) && (
                        <div className="ws-ov-score-context">
                          {(effectiveTitle || effectiveCompany) && (
                            <div className="ws-ov-score-ctx-row">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ws-ov-score-ctx-icon"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                              <div>
                                <div className="ws-ov-score-ctx-label">Applying for</div>
                                <div className="ws-ov-score-ctx-value">{effectiveTitle || effectiveCompany}{effectiveTitle && effectiveCompany ? <><br/><span style={{ opacity: 0.75 }}>{effectiveCompany}</span></> : ''}</div>
                              </div>
                            </div>
                          )}
                          {resumeDisplayName && (
                            <div className="ws-ov-score-ctx-row">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ws-ov-score-ctx-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              <div>
                                <div className="ws-ov-score-ctx-label">Resume</div>
                                <div className="ws-ov-score-ctx-value">{resumeDisplayName}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 3. Score Breakdown Cards */}
                    <div className="ws-ov-block">
                      <div className="ws-ov-block-title">
                        Score Breakdown
                        {!analysis.scoreBreakdown && <span className="ws-ov-block-sub"> · estimated</span>}
                      </div>
                      <div className="ws-ov-breakdown-grid">
                        {scoreBreakdown.map((cat, i) => {
                          const ratio = cat.max > 0 ? cat.score / cat.max : 0;
                          const col = ratio >= 0.8 ? '#3fa163' : ratio >= 0.55 ? '#f59e0b' : '#ef4444';
                          return (
                            <div key={i} className="ws-ov-breakdown-card">
                              <div className="ws-ov-breakdown-top">
                                <span className="ws-ov-breakdown-name">{cat.category}</span>
                                <span className="ws-ov-breakdown-pts" style={{ color: col }}>{cat.score}<span className="ws-ov-breakdown-max">/{cat.max}</span></span>
                              </div>
                              <div className="ws-ov-breakdown-bar-bg">
                                <div className="ws-ov-breakdown-bar-fill" style={{ width: `${ratio * 100}%`, background: col }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* 4. Top Improvements to Increase Score */}
                    {actions.length > 0 && (
                      <div className="ws-ov-block">
                        <div className="ws-ov-block-title">Top Improvements</div>
                        {actions.map((a, i) => (
                          <button key={i} className="ws-ov-action" onClick={() => setActiveSection(a.target)}>
                            <span className="ws-ov-action-badge" style={{ background: priorityColor[a.priority] }}>{priorityLabel[a.priority]}</span>
                            <div className="ws-ov-action-content">
                              <div className="ws-ov-action-label">
                                {a.label}
                                {SCORE_IMPACT[a.label] && <span className="ws-ov-impact-badge ws-ov-impact-badge--action">{SCORE_IMPACT[a.label]}</span>}
                              </div>
                              <div className="ws-ov-action-tip">{a.tip}</div>
                            </div>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ws-ov-chevron"><polyline points="9 18 15 12 9 6"/></svg>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* 5+6. Matched / Missing / Weak Keywords */}
                    {((analysis?.matchedKeywords?.length ?? 0) > 0 || missingKwCount > 0 || weakKwCount > 0) && (
                      <div className="ws-ov-block">
                        <div className="ws-ov-block-title">Keyword Coverage</div>
                        <div className="ws-ov-kw-tabs">
                          <button className={`ws-ov-kw-tab${effectiveKwTab === 'missing' ? ' active' : ''}`} onClick={() => setKwTab('missing')}>
                            Missing ({analysis!.missingKeywords.length})
                          </button>
                          {weakKwCount > 0 && (
                            <button className={`ws-ov-kw-tab${effectiveKwTab === 'weak' ? ' active' : ''}`} onClick={() => setKwTab('weak')}>
                              Weak ({weakKwCount})
                            </button>
                          )}
                          <button className={`ws-ov-kw-tab${effectiveKwTab === 'matched' ? ' active' : ''}`} onClick={() => setKwTab('matched')}>
                            Matched ({analysis!.matchedKeywords.length})
                          </button>
                        </div>
                        <div className="ws-ov-kw-row">
                          {effectiveKwTab === 'matched' && analysis!.matchedKeywords.map((kw, i) => <span key={i} className="ws-ov-kw ws-ov-kw-match">✓ {kw}</span>)}
                          {effectiveKwTab === 'missing' && analysis!.missingKeywords.map((kw, i) => <span key={i} className="ws-ov-kw ws-ov-kw-miss">+ {kw}</span>)}
                          {effectiveKwTab === 'weak' && (analysis.weakKeywords ?? []).map((kw, i) => <span key={i} className="ws-ov-kw ws-ov-kw-weak">~ {kw}</span>)}
                          {effectiveKwTab === 'missing' && analysis!.missingKeywords.length === 0 && (
                            <span className="ws-ov-kw-empty">No missing keywords — great coverage!</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 8. Before & After Bullet Suggestions */}
                    {((!verbStd.ok && baVerbBefore) || (!metricStd.ok && baMetricBefore)) && (
                      <div className="ws-ov-block">
                        <div className="ws-ov-block-title">Before &amp; After</div>
                        {!verbStd.ok && baVerbBefore && baVerbAfter && (
                          <div className="ws-ov-ba">
                            <div className="ws-ov-ba-caption">Action Verb · from your resume</div>
                            <div className="ws-ov-ba-panel ws-ov-ba-panel--before">
                              <span className="ws-ov-ba-pill ws-ov-ba-pill--before">Before</span>
                              <span className="ws-ov-ba-txt">{baVerbBefore}</span>
                            </div>
                            <div className="ws-ov-ba-panel ws-ov-ba-panel--after">
                              <span className="ws-ov-ba-pill ws-ov-ba-pill--after">After</span>
                              <span className="ws-ov-ba-txt">{baVerbAfter}</span>
                            </div>
                          </div>
                        )}
                        {!metricStd.ok && baMetricBefore && baMetricAfter && (
                          <div className="ws-ov-ba">
                            <div className="ws-ov-ba-caption">Quantified Result · from your resume</div>
                            <div className="ws-ov-ba-panel ws-ov-ba-panel--before">
                              <span className="ws-ov-ba-pill ws-ov-ba-pill--before">Before</span>
                              <span className="ws-ov-ba-txt">{baMetricBefore}</span>
                            </div>
                            <div className="ws-ov-ba-panel ws-ov-ba-panel--after">
                              <span className="ws-ov-ba-pill ws-ov-ba-pill--after">After</span>
                              <span className="ws-ov-ba-txt">{baMetricAfter}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 9. Final Action Buttons */}
                    {actions.length === 0 && (
                      <div className="ws-ov-done">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3fa163" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        All standards met — your resume is ready to export!
                      </div>
                    )}

                  </div>
                </>;
              })()}

              {/* Personal Info */}
              {activeSection === 'personal' && <>
                <div className="ws-editor-header">
                  <div className="ws-editor-section-title">Personal Info</div>
                </div>
                <div className="ws-editor-body">
                  <div className="ws-personal-tip">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '0.1rem', color: '#818cf8' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span><strong>Tips:</strong> <strong>Drag</strong> any row to reorder fields. Use the <strong>toggle</strong> to include or exclude a field from your resume.</span>
                  </div>
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
                  <div className="ws-editor-section-title">Professional Summary</div>
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
                  <div className="ws-personal-tip">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '0.1rem', color: '#818cf8' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span><strong>Tips:</strong> Edit the summary directly. Use the <strong>toggle</strong> in the header to show or hide this section. Your original summary is shown below for reference.</span>
                  </div>
                  <textarea
                    className="ws-editor-textarea"
                    value={summary}
                    onChange={e => setSummary(e.target.value)}
                    rows={8}
                    placeholder="Your professional summary will appear here after analysis…"
                  />
                  {analysis?.originalSummary && (
                    <div className="ws-original-block">
                      <div className="ws-original-block-header">
                        <span className="ws-original-block-label">Original from resume</span>
                      </div>
                      <div className="ws-original-block-text">{analysis.originalSummary}</div>
                    </div>
                  )}
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
                  <div className="ws-personal-tip">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '0.1rem', color: '#818cf8' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span><strong>Tips:</strong> Each card shows a job requirement and your matching experience. <strong>Click an option</strong> to select it. Use <strong>↺ Regenerate</strong> for a new suggestion or <strong>✎ Edit</strong> to tweak it manually.</span>
                  </div>
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
                </div>
                <div className="ws-editor-body">
                  <div className="ws-personal-tip">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '0.1rem', color: '#818cf8' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span><strong>Tips:</strong> <strong>Toggle</strong> each entry to include or exclude it. Bullets show <strong>O</strong> (original) and <strong>T</strong> (tailored) versions — click to switch. Use <strong>↺</strong> to regenerate a tailored bullet or <strong>+ Add Bullet</strong> for an AI suggestion.</span>
                  </div>
                  {experience.length === 0
                    ? <div className="ws-empty">No experience extracted.</div>
                    : <div className="ws-edu-list">
                        {experience.map((exp, ei) => (
                          <div key={ei} className={`ws-edu-card${exp.include === false ? ' excluded' : ''}`}>
                            <div className="ws-edu-card-header">
                              <span className="ws-edu-card-label">Entry {ei + 1}</span>
                              <div className="ws-entry-actions">
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
                                        <div className="ws-bullet-regen-msg">
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
                  <div className="ws-editor-section-title">Skills</div>
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
                  <div className="ws-personal-tip">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '0.1rem', color: '#818cf8' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span><strong>Tips:</strong> <strong>Click</strong> a chip to toggle it on/off. <strong>Drag</strong> chips between categories or use <strong>⠿</strong> to reorder categories. <strong>Double-click</strong> a category label to rename it. <span style={{ color: '#f59e0b' }}>Yellow chips</span> are AI-suggested skills from the job post — add them if they apply.</span>
                  </div>
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
                </div>
                <div className="ws-editor-body">
                  <div className="ws-personal-tip">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '0.1rem', color: '#818cf8' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span><strong>Tips:</strong> <strong>Toggle</strong> each entry to include or exclude it from your resume. Use <strong>✕</strong> to delete an entry or <strong>+ Add Entry</strong> to add a new one.</span>
                  </div>
                  <div className="ws-edu-list">
                    {education.map((edu, idx) => {
                      const setField = (field: keyof TailorEducation, val: string) =>
                        setEducation(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item));
                      return (
                        <div key={idx} className={`ws-edu-card${edu.include ? '' : ' excluded'}`}>
                          <div className="ws-edu-card-header">
                            <span className="ws-edu-card-label">Entry {idx + 1}</span>
                            <div className="ws-entry-actions">
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
                    <div className="ws-personal-tip">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '0.1rem', color: '#818cf8' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      <span><strong>Tips:</strong> Use the header <strong>toggle</strong> to show or hide this entire section. <strong>Toggle</strong> individual entries to include or exclude them. Use <strong>✕</strong> to remove an entry or <strong>+ Add Entry</strong> to add one.</span>
                    </div>
                    <div className="ws-edu-list">
                      {sec.entries.map((entry, ei) => (
                        <div key={ei} className={`ws-edu-card${entry.include ? '' : ' excluded'}`}>
                          <div className="ws-edu-card-header">
                            <span className="ws-edu-card-label">Entry {ei + 1}</span>
                            <div className="ws-custom-entry-actions">
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

            {/* ── Resize handle ── */}
            <div className="ws-resize-handle" onMouseDown={handleResizeMouseDown}>
              <div className="ws-resize-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/>
                </svg>
              </div>
            </div>

            {/* ── Right preview ── */}
            <div className={`ws-preview${isResizing ? ' ws-preview--resizing' : ''}`} style={{ width: previewWidth }}>
              <div className="ws-preview-header">
                <button className={`ws-preview-tab${previewTab === 'preview' ? ' active' : ''}`} onClick={() => setPreviewTab('preview')}>Live Preview</button>
                <button className={`ws-preview-tab${previewTab === 'jd' ? ' active' : ''}`} onClick={() => setPreviewTab('jd')}>Job Description</button>
              </div>
              <iframe
                ref={previewIframeRef}
                title="Resume Preview"
                sandbox="allow-same-origin"
                className={`ws-preview-iframe${previewTab !== 'preview' ? ' ws-preview-iframe--hidden' : ''}`}
              />
              {previewTab === 'jd' && (
                <div className="ws-jd-panel">
                  {(effectiveTitle || effectiveCompany) && (
                    <div className="jd-meta-card">
                      {effectiveTitle && <div className="jd-meta-title">{effectiveTitle}</div>}
                      <div className="jd-meta-chips">
                        {effectiveCompany && (
                          <span className="jd-meta-chip">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                            {effectiveCompany}
                          </span>
                        )}
                        {scrapedMeta?.location && (
                          <span className="jd-meta-chip">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                            {scrapedMeta.location}
                          </span>
                        )}
                        {scrapedMeta?.jobType && (
                          <span className="jd-meta-chip">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            {scrapedMeta.jobType}
                          </span>
                        )}
                        {scrapedMeta?.salary && (
                          <span className="jd-meta-chip jd-meta-chip-salary">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                            {scrapedMeta.salary}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {analysis && (
                    <div className="ws-jd-kw-bar">
                      <button
                        className={`ws-jd-highlight-toggle${jdHighlight ? ' active' : ''}`}
                        onClick={() => setJdHighlight(v => !v)}
                        title={jdHighlight ? 'Hide keyword highlights' : 'Highlight keywords'}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                        </svg>
                        View Keywords
                      </button>
                      {jdHighlight && (
                        <div className="ws-jd-kw-legend">
                          <span className="ws-jd-kw-chip jd-kw-matched">Covered</span>
                          <span className="ws-jd-kw-chip jd-kw-weak">Weak</span>
                          <span className="ws-jd-kw-chip jd-kw-missing">Missing</span>
                        </div>
                      )}
                    </div>
                  )}
                  {job.description
                    ? <div className="description-content" dangerouslySetInnerHTML={{ __html: highlightedJdHtml ?? job.description }} />
                    : localJobDescription
                      ? <div className="description-content" dangerouslySetInnerHTML={{ __html: highlightedJdHtml ?? localJobDescription }} />
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
            <span className="ws-footer-provider">
              {settings.aiProvider}/{settings.aiModel || '—'}
            </span>
          )}
          <button className="nav-btn nav-btn-outline" onClick={onClose} disabled={isLoading}>Close</button>
          <div className="ws-footer-actions">
            {!isLoading && error && <button className="nav-btn nav-btn-outline" onClick={reanalyze}>Retry</button>}
            {phase === 'review' && buildDone && <span className="workshop-done-msg">Downloaded!</span>}
            {phase === 'review' && (
              <button className="nav-btn nav-btn-accent" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={() => buildResume().catch(e => setError(String(e)))}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Build &amp; Download Resume
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
