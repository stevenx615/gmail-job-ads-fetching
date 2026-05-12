import { useState, useEffect, useCallback } from 'react';
import mammoth from 'mammoth';
import type { Job } from '../types';
import type { AppSettings } from '../types/settings';
import type { TailorAnalysis, TailorQualification, TailorExperience, TailorSkill, TailorOtherSection } from '../types/ai';
import { analyzeTailorSections } from '../services/aiService';

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

function scoreLabel(s: number) {
  if (s >= 90) return 'Excellent Match';
  if (s >= 75) return 'Good Match';
  if (s >= 60) return 'Fair Match';
  return 'Needs Work';
}
function scoreColor(s: number) {
  if (s >= 90) return '#3fa163';
  if (s >= 75) return '#f59e0b';
  if (s >= 60) return '#f97316';
  return '#ef4444';
}

function ScoreCircle({ score }: { score: number }) {
  const r = 36, circ = 2 * Math.PI * r;
  const color = scoreColor(score);
  return (
    <div className="ws-score-wrap">
      <div className="ws-score-ring-wrap">
        <svg className="ws-score-svg" viewBox="0 0 88 88">
          <circle cx="44" cy="44" r={r} fill="none" stroke="var(--card-border)" strokeWidth="9" />
          <circle
            cx="44" cy="44" r={r} fill="none"
            stroke={color} strokeWidth="9"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - score / 100)}
            strokeLinecap="round"
            transform="rotate(-90 44 44)"
          />
        </svg>
        <div className="ws-score-inner">
          <div className="ws-score-number" style={{ color }}>{score}</div>
          <div className="ws-score-sub">ATS Score</div>
        </div>
      </div>
      <div className="ws-score-label" style={{ color }}>{scoreLabel(score)}</div>
    </div>
  );
}

type BulletMode = 'tailored' | 'original';
type TabKey = 'all' | 'matched' | 'partial' | 'none';

export function ResumeTailorWorkshop({ job, resumeText, resumeDocxFile, resumeInputTab, settings, onClose }: Props) {
  type Phase = 'extracting' | 'analyzing' | 'review';
  const [phase, setPhase] = useState<Phase>('analyzing');
  const [plainResume, setPlainResume] = useState('');
  const [analysis, setAnalysis] = useState<TailorAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [qualifications, setQualifications] = useState<TailorQualification[]>([]);
  const [qualifOverrides, setQualifOverrides] = useState<(string | null)[]>([]);
  const [experience, setExperience] = useState<TailorExperience[]>([]);
  const [skills, setSkills] = useState<TailorSkill[]>([]);
  const [education, setEducation] = useState<string[]>([]);
  const [other, setOther] = useState<TailorOtherSection[]>([]);
  const [bulletModes, setBulletModes] = useState<Record<string, BulletMode>>({});
  const [tab, setTab] = useState<TabKey>('all');
  const [buildDone, setBuildDone] = useState(false);

  const applyAnalysis = (a: TailorAnalysis) => {
    setAnalysis(a);
    setSummary(a.summary);
    setQualifications(a.qualifications);
    setQualifOverrides(a.qualifications.map(() => null));
    setExperience(a.experience);
    setSkills(a.skills);
    setEducation(a.education);
    setOther(a.other);
    // default: use tailored version for every bullet
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

  const reanalyze = () => runAnalysis(plainResume);

  const getBulletMode = (ei: number, bi: number): BulletMode => bulletModes[`${ei}-${bi}`] ?? 'tailored';
  const toggleBulletMode = (ei: number, bi: number) =>
    setBulletModes(prev => ({ ...prev, [`${ei}-${bi}`]: prev[`${ei}-${bi}`] === 'tailored' ? 'original' : 'tailored' }));

  const toggleQualif = (idx: number) =>
    setQualifications(prev => prev.map((q, i) => i === idx ? { ...q, include: !q.include } : q));
  const selectQualifOption = (idx: number, text: string | null) => {
    setQualifOverrides(prev => { const n = [...prev]; n[idx] = text; return n; });
    if (text !== null && qualifications[idx].match === null)
      setQualifications(prev => prev.map((q, i) => i === idx ? { ...q, include: true } : q));
  };
  const toggleSkill = (idx: number) =>
    setSkills(prev => prev.map((s, i) => i === idx ? { ...s, include: !s.include } : s));
  const toggleOtherItem = (si: number, ii: number) =>
    setOther(prev => prev.map((sec, i) => i !== si ? sec : {
      ...sec, items: sec.items.map((item, j) => j !== ii ? item : { ...item, include: !item.include }),
    }));

  // Flat bullet list with original indices for tab filtering
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
  // Group visible bullets by exp index
  const grouped = visibleBullets.reduce<Record<number, FlatBullet[]>>((acc, fb) => {
    (acc[fb.ei] ??= []).push(fb);
    return acc;
  }, {});

  const buildResume = () => {
    const name = analysis?.candidateName || '';
    let html = '';
    if (name) html += `<h2>${name}</h2>\n`;
    if (summary.trim()) html += `<h3>Professional Summary</h3>\n<p>${summary.replace(/\n/g, '<br>')}</p>\n`;

    const includedQualifs = qualifications
      .map((q, i) => ({ ...q, effectiveText: qualifOverrides[i] ?? q.match }))
      .filter(q => q.include && q.effectiveText);
    if (includedQualifs.length > 0) {
      html += `<h3>Key Qualifications</h3>\n<ul>\n${includedQualifs.map(q => `  <li>${q.effectiveText}</li>`).join('\n')}\n</ul>\n`;
    }

    const includedExp = experience.map((exp, ei) => ({
      ...exp,
      bullets: exp.bullets.map((b, bi) => {
        const mode = getBulletMode(ei, bi);
        return { effectiveText: mode === 'tailored' && b.tailored ? b.tailored : b.text };
      }),
    })).filter(exp => exp.bullets.length > 0);
    if (includedExp.length > 0) {
      html += `<h3>Work Experience</h3>\n`;
      for (const exp of includedExp) {
        html += `<p><strong>${exp.title}</strong> &mdash; ${exp.company}<br><em>${exp.period}</em></p>\n`;
        html += `<ul>\n${exp.bullets.map(b => `  <li>${b.effectiveText}</li>`).join('\n')}\n</ul>\n`;
      }
    }

    const includedSkills = skills.filter(s => s.include).map(s => s.name);
    if (includedSkills.length > 0) html += `<h3>Skills</h3>\n<p>${includedSkills.join(' &bull; ')}</p>\n`;
    if (education.length > 0) html += `<h3>Education</h3>\n<ul>\n${education.map(e => `  <li>${e}</li>`).join('\n')}\n</ul>\n`;
    for (const sec of other) {
      const items = sec.items.filter(i => i.include);
      if (items.length > 0) html += `<h3>${sec.title}</h3>\n<ul>\n${items.map(i => `  <li>${i.text}</li>`).join('\n')}\n</ul>\n`;
    }

    const safeTitle = job.title.replace(/[^a-z0-9]/gi, '_');
    const safeCompany = job.company.replace(/[^a-z0-9]/gi, '_');
    const fullHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Resume – ${job.title} at ${job.company}</title>
<style>body{font-family:Calibri,Arial,sans-serif;max-width:800px;margin:2rem auto;padding:1rem 2rem;color:#222}h2{font-size:1.6rem;font-weight:700;margin-bottom:.1rem}h3{font-size:1.05rem;font-weight:700;border-bottom:1px solid #ccc;margin-top:1.2rem;padding-bottom:.2rem;color:#333}p,li{font-size:.95rem;line-height:1.55;margin:.2rem 0}ul{margin:.3rem 0 .5rem 1.5rem;padding:0}em{color:#555;font-style:italic}strong{color:#111}</style>
</head><body>${html}</body></html>`;

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Resume_${safeTitle}_${safeCompany}.html`; a.click();
    URL.revokeObjectURL(url);
    setBuildDone(true);
  };

  const isLoading = phase === 'extracting' || phase === 'analyzing';
  const TABS: { key: TabKey; label: string }[] = [
    { key: 'all', label: 'Total Rows' },
    { key: 'matched', label: 'Matched' },
    { key: 'partial', label: 'Partial Match' },
    { key: 'none', label: 'No Match' },
  ];

  return (
    <div className="modal-overlay">
      <div className="modal-card workshop-modal">

        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title">Tailor Your Resume Row by Row</div>
            <div className="tailor-resume-subtitle">{job.title} at {job.company}</div>
          </div>
          <button className="modal-close" onClick={onClose} disabled={isLoading}>&times;</button>
        </div>

        {/* Loading / Error (full-body) */}
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

        {/* Two-panel layout */}
        {phase === 'review' && analysis && (
          <div className="workshop-twopanel">

            {/* ── Main panel ── */}
            <div className="workshop-main">

              {/* Summary bar */}
              <div className="ws-summary-bar">
                <button className="ws-summary-toggle" onClick={() => setSummaryExpanded(v => !v)}>
                  <span className="ws-summary-toggle-label">Professional Summary</span>
                  <span className="ws-summary-preview" hidden={summaryExpanded}>
                    {summary.slice(0, 120)}{summary.length > 120 ? '…' : ''}
                  </span>
                  <span className="ws-summary-caret">{summaryExpanded ? '▲' : '▼'}</span>
                </button>
                {summaryExpanded && (
                  <textarea
                    className="workshop-summary-input ws-summary-textarea"
                    value={summary}
                    onChange={e => setSummary(e.target.value)}
                    rows={3}
                  />
                )}
              </div>

              {/* Tab bar */}
              <div className="ws-tabs">
                {TABS.map(t => (
                  <button
                    key={t.key}
                    className={`ws-tab${tab === t.key ? ' active' : ''}`}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label}
                    <span className="ws-tab-count">{counts[t.key]}</span>
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button className="ws-reanalyze-btn" onClick={reanalyze}>↺ Re-analyze</button>
              </div>

              {/* Table */}
              <div className="ws-table-wrap">
                <div className="ws-table-head">
                  <span>Original</span>
                  <span>Suggested Tailored Version</span>
                  <span>Keywords Match</span>
                  <span>Action</span>
                </div>
                <div className="ws-table-body">
                  {Object.entries(grouped).map(([eiStr, fbs]) => {
                    const ei = Number(eiStr);
                    const exp = experience[ei];
                    return (
                      <div key={ei}>
                        <div className="ws-group-header">
                          <strong>{exp.title}</strong>
                          <span className="ws-group-dot">&middot;</span>
                          {exp.company}
                          {exp.period && <span className="ws-group-period">{exp.period}</span>}
                        </div>
                        {fbs.map(({ bi, bullet }) => {
                          const mode = getBulletMode(ei, bi);
                          return (
                            <div key={bi} className={`ws-row ws-row-${bullet.matchLevel}`}>
                              <div className="ws-cell ws-cell-original">{bullet.text}</div>
                              <div className="ws-cell ws-cell-tailored">{bullet.tailored || bullet.text}</div>
                              <div className="ws-cell ws-cell-keywords">
                                {bullet.keywords.map((kw, ki) => (
                                  <span key={ki} className="ws-kw-chip">{kw}</span>
                                ))}
                              </div>
                              <div className="ws-cell ws-cell-action">
                                <button
                                  className={`ws-mode-btn ws-mode-tailored${mode === 'tailored' ? ' active' : ''}`}
                                  onClick={() => toggleBulletMode(ei, bi)}
                                  title="Use the tailored version in the final resume"
                                >
                                  Tailored
                                </button>
                                <button
                                  className={`ws-mode-btn ws-mode-original${mode === 'original' ? ' active' : ''}`}
                                  onClick={() => toggleBulletMode(ei, bi)}
                                  title="Keep the original wording"
                                >
                                  Original
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {visibleBullets.length === 0 && (
                    <div className="ws-empty">No bullets in this category.</div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Sidebar ── */}
            <div className="workshop-sidebar">

              {/* ATS Score */}
              <ScoreCircle score={analysis.atsScore} />

              {/* Requirements Match */}
              {qualifications.length > 0 && (
                <div className="ws-sidebar-section">
                  <div className="ws-sidebar-title">Requirements Match</div>
                  {qualifications.map((q, idx) => {
                    const override = qualifOverrides[idx];
                    return (
                      <div key={idx} className="ws-req-row">
                        <label className="ws-req-check-label">
                          <input type="checkbox" checked={q.include} onChange={() => toggleQualif(idx)} />
                        </label>
                        <div className="ws-req-body">
                          <div className="ws-req-text">{q.requirement}</div>
                          {q.match ? (
                            <div className="ws-req-options">
                              <button className={`ws-req-opt${override === null ? ' sel' : ''}`} onClick={() => selectQualifOption(idx, null)}>{q.match}</button>
                              {q.suggestions.map((s, si) => (
                                <button key={si} className={`ws-req-opt${override === s ? ' sel' : ''}`} onClick={() => selectQualifOption(idx, s)}>{s}</button>
                              ))}
                            </div>
                          ) : (
                            <div>
                              <span className="ws-req-missing">Not found</span>
                              {q.suggestions.length > 0 && (
                                <div className="ws-req-suggestions">
                                  {q.suggestions.map((s, si) => (
                                    <button key={si} className={`ws-req-sug${override === s ? ' sel' : ''}`}
                                      onClick={() => selectQualifOption(idx, override === s ? null : s)}>{s}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Matched Skills */}
              {analysis.matchedKeywords.length > 0 && (
                <div className="ws-sidebar-section">
                  <div className="ws-sidebar-title">Matched Skills</div>
                  {analysis.matchedKeywords.map((kw, i) => (
                    <div key={i} className="ws-insight-matched">
                      <span className="ws-insight-icon">✓</span>{kw}
                    </div>
                  ))}
                </div>
              )}

              {/* Missing Keywords */}
              {analysis.missingKeywords.length > 0 && (
                <div className="ws-sidebar-section">
                  <div className="ws-sidebar-title">Missing Keywords</div>
                  {analysis.missingKeywords.map((kw, i) => (
                    <div key={i} className="ws-insight-missing">
                      <span className="ws-insight-icon">!</span>{kw}
                    </div>
                  ))}
                </div>
              )}

              {/* Tips */}
              {analysis.tips.length > 0 && (
                <div className="ws-sidebar-section">
                  <div className="ws-sidebar-title">Tips to Improve</div>
                  {analysis.tips.map((tip, i) => (
                    <div key={i} className="ws-insight-tip">&bull; {tip}</div>
                  ))}
                </div>
              )}

              {/* Skills chips */}
              {skills.length > 0 && (
                <div className="ws-sidebar-section">
                  <div className="ws-sidebar-title">Skills</div>
                  <div className="workshop-skills">
                    {skills.map((skill, idx) => (
                      <button
                        key={idx}
                        className={`workshop-skill-chip${skill.include ? ' included' : ''}${skill.isSuggestion ? ' suggestion' : ''}`}
                        onClick={() => toggleSkill(idx)}
                        title={skill.note || undefined}
                      >
                        {skill.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Education */}
              {education.length > 0 && (
                <div className="ws-sidebar-section">
                  <div className="ws-sidebar-title">Education</div>
                  <ul className="workshop-education-list">
                    {education.map((edu, idx) => <li key={idx}>{edu}</li>)}
                  </ul>
                </div>
              )}

              {/* Other sections */}
              {other.map((sec, si) => sec.items.length > 0 && (
                <div key={si} className="ws-sidebar-section">
                  <div className="ws-sidebar-title">{sec.title}</div>
                  {sec.items.map((item, ii) => (
                    <label key={ii} className="ws-other-item">
                      <input type="checkbox" checked={item.include} onChange={() => toggleOtherItem(si, ii)} />
                      <span>{item.text}</span>
                    </label>
                  ))}
                </div>
              ))}

            </div>
          </div>
        )}

        {/* Footer */}
        <div className="modal-footer">
          <button className="nav-btn nav-btn-outline" onClick={onClose} disabled={isLoading}>Close</button>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {!isLoading && error && <button className="nav-btn nav-btn-outline" onClick={reanalyze}>Retry</button>}
            {phase === 'review' && buildDone && <span className="workshop-done-msg">Downloaded!</span>}
            {phase === 'review' && (
              <button className="nav-btn nav-btn-accent" onClick={buildResume}>
                Apply Changes &amp; Export
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
