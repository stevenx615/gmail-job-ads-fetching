import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAllJobs, updateJobStage, updateJobFields, removeFromApplications } from '../services/jobService';
import type { Job, ApplicationStage } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES: ApplicationStage[] = [
  'applied', 'phone_screen', 'interview', 'offer', 'rejected',
];

const STAGE_LABELS: Record<ApplicationStage, string> = {
  saved: 'Saved',
  applied: 'Applied',
  phone_screen: 'Phone Screen',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};

const STAGE_COLOR_CLASS: Record<ApplicationStage, string> = {
  saved: 'stage-dot-saved',
  applied: 'stage-dot-applied',
  phone_screen: 'stage-dot-phone',
  interview: 'stage-dot-interview',
  offer: 'stage-dot-offer',
  rejected: 'stage-dot-rejected',
};

type SortField = 'title' | 'company' | 'stage' | 'dateReceived' | 'followUpDate';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEffectiveStage(job: Job): ApplicationStage | null {
  if (job.applicationStage) return job.applicationStage;
  if (job.applied) return 'applied';
  if (job.saved) return 'saved';
  return null;
}

function stageOrder(stage: ApplicationStage | null): number {
  if (!stage) return 99;
  return STAGES.indexOf(stage);
}

function truncateNotes(notes: string | undefined, max = 50): string {
  if (!notes) return '';
  return notes.length > max ? notes.slice(0, max) + '…' : notes;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const BriefcaseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2"/>
    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
);

const PhoneIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.18 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
);

const UsersIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

const StarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

const XCircleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
);

// ─── PipelineStatsBar ─────────────────────────────────────────────────────────

interface StatsBarProps {
  jobs: Job[];
}

function PipelineStatsBar({ jobs }: StatsBarProps) {
  const counts: Record<ApplicationStage, number> = {
    saved: 0, applied: 0, phone_screen: 0, interview: 0, offer: 0, rejected: 0,
  };
  let total = 0;
  for (const job of jobs) {
    const stage = getEffectiveStage(job);
    if (!stage) continue;
    counts[stage]++;
    if (stage !== 'rejected') total++;
  }

  const stats = [
    { key: 'total',        label: 'Total',        count: total,               icon: <BriefcaseIcon />,  cls: 'psc-total' },
    { key: 'applied',      label: 'Applied',       count: counts.applied,      icon: <CheckCircleIcon />, cls: 'psc-applied' },
    { key: 'phone_screen', label: 'Phone Screen',  count: counts.phone_screen, icon: <PhoneIcon />,      cls: 'psc-phone' },
    { key: 'interview',    label: 'Interview',     count: counts.interview,    icon: <UsersIcon />,      cls: 'psc-interview' },
    { key: 'offer',        label: 'Offer',         count: counts.offer,        icon: <StarIcon />,       cls: 'psc-offer' },
    { key: 'rejected',     label: 'Rejected',      count: counts.rejected,     icon: <XCircleIcon />,    cls: 'psc-rejected' },
  ];

  return (
    <div className="pipeline-stats-bar">
      {stats.map(s => (
        <div key={s.key} className={`pipeline-stat-card ${s.cls}`}>
          <div className="psc-icon">{s.icon}</div>
          <div className="psc-info">
            <div className="psc-count">{s.count}</div>
            <div className="psc-label">{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── PipelineTable ────────────────────────────────────────────────────────────

interface EditingCell {
  rowId: string;
  field: 'stage' | 'notes' | 'followUpDate';
}

interface TableProps {
  jobs: Job[];
  onJobUpdate: (id: string, patch: Partial<Job>) => void;
}

function PipelineTable({ jobs, onJobUpdate }: TableProps) {
  // ── Filter state ──
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<ApplicationStage | 'all'>('all');
  const [dateRange, setDateRange] = useState<'all' | '7' | '30' | '90'>('30');
  const [hideRejected, setHideRejected] = useState(true);

  // ── Sort state ──
  const [sortKey, setSortKey] = useState<string>('dateReceived:desc');

  // ── Row selection ──
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  // ── Delete confirmation ──
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── Stage dropdown menu ──
  const [stageMenuId, setStageMenuId] = useState<string | null>(null);

  // ── Inline editing ──
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});

  // ── Pending stage change ──
  const [pendingStage, setPendingStage] = useState<{
    rowId: string;
    newStage: ApplicationStage;
    date: string;
  } | null>(null);

  // ── Pagination ──
  const [currentPage, setCurrentPage] = useState(1);


  const [sortField, sortDir] = useMemo<[SortField, SortDir]>(() => {
    const [f, d] = sortKey.split(':');
    return [f as SortField, (d ?? 'asc') as SortDir];
  }, [sortKey]);

  // ── Filtering ──
  const nowMs = Date.now();
  const cutoffMs = useMemo(
    () => dateRange !== 'all' ? nowMs - parseInt(dateRange) * 86400000 : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateRange]
  );

  const filtered = jobs.filter(job => {
    const stage = getEffectiveStage(job);
    if (!stage) return false;
    if (hideRejected && stage === 'rejected') return false;
    if (stageFilter !== 'all' && stage !== stageFilter) return false;
    if (cutoffMs !== null && new Date(job.dateReceived).getTime() < cutoffMs) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!job.title.toLowerCase().includes(q) && !job.company.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ── Sorting ──
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'title':        cmp = a.title.localeCompare(b.title); break;
      case 'company':      cmp = a.company.localeCompare(b.company); break;
      case 'stage':        cmp = stageOrder(getEffectiveStage(a)) - stageOrder(getEffectiveStage(b)); break;
      case 'dateReceived': cmp = new Date(a.dateReceived).getTime() - new Date(b.dateReceived).getTime(); break;
      case 'followUpDate': cmp = (a.followUpDate ?? '').localeCompare(b.followUpDate ?? ''); break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  useEffect(() => { setCurrentPage(1); }, [search, stageFilter, dateRange, hideRejected, sortKey]);

  const clearFilters = () => {
    setSearch('');
    setStageFilter('all');
    setDateRange('30');
    setHideRejected(true);
    setSortKey('dateReceived:desc');
  };

  // ── Inline edit helpers ──
  const startEdit = (rowId: string, field: EditingCell['field'], currentValue: string) => {
    setEditingCell({ rowId, field });
    setEditValue(currentValue);
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const confirmStageChange = async () => {
    if (!pendingStage) return;
    const { rowId, newStage, date } = pendingStage;
    const job = jobs.find(j => j.id === rowId);
    const oldStage = job ? getEffectiveStage(job) : null;
    const oldStageDate = job?.stageDate;
    setPendingStage(null);
    onJobUpdate(rowId, { applicationStage: newStage, stageDate: date });
    try {
      await updateJobStage(rowId, newStage, date);
      setCellErrors(prev => { const next = { ...prev }; delete next[`${rowId}-stage`]; return next; });
    } catch {
      onJobUpdate(rowId, { applicationStage: oldStage ?? undefined, stageDate: oldStageDate });
      setCellErrors(prev => ({ ...prev, [`${rowId}-stage`]: 'Failed to update stage' }));
    }
  };

  const commitEdit = async (job: Job) => {
    if (!editingCell) return;
    const { rowId, field } = editingCell;
    if (field === 'stage') return;
    const currentValue = field === 'notes' ? (job.notes ?? '') : (job.followUpDate ?? '');
    if (editValue === currentValue) { cancelEdit(); return; }
    const revertNotes = job.notes;
    const revertFollowUpDate = job.followUpDate;
    const errorKey = `${rowId}-${field}`;
    const patch: Partial<Job> = field === 'notes'
      ? { notes: editValue || undefined }
      : { followUpDate: editValue || undefined };
    setEditingCell(null);
    onJobUpdate(rowId, patch);
    try {
      await updateJobFields(rowId, patch as Partial<Pick<Job, 'notes' | 'followUpDate'>>);
      setCellErrors(e => { const next = { ...e }; delete next[errorKey]; return next; });
    } catch {
      onJobUpdate(rowId, field === 'notes' ? { notes: revertNotes } : { followUpDate: revertFollowUpDate });
      setCellErrors(e => ({ ...e, [errorKey]: `Failed to update ${field}` }));
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    const d = iso.includes('T')
      ? new Date(iso)
      : (() => { const [y, m, day] = iso.split('-').map(Number); return new Date(y, m - 1, day); })();
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const removeJob = async (job: Job) => {
    const oldStage = getEffectiveStage(job);
    const oldStageDate = job.stageDate;
    onJobUpdate(job.id, { applied: false, applicationStage: undefined, stageDate: undefined });
    try {
      await removeFromApplications(job.id);
    } catch {
      onJobUpdate(job.id, { applicationStage: oldStage ?? undefined, stageDate: oldStageDate, applied: job.applied });
    }
  };

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="pipeline-table-wrapper">
      {/* Filter Bar */}
      <div className="pipeline-filter-bar">
        <div className="pfb-search-wrap">
          <svg className="pfb-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
          </svg>
          <input
            className="pfb-search"
            type="text"
            placeholder="Search role or company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select className="pfb-select" value={stageFilter} onChange={e => setStageFilter(e.target.value as ApplicationStage | 'all')}>
          <option value="all">Stage: All</option>
          {STAGES.map(s => <option key={s} value={s}>Stage: {STAGE_LABELS[s]}</option>)}
        </select>

        <select className="pfb-select" value={dateRange} onChange={e => setDateRange(e.target.value as typeof dateRange)}>
          <option value="all">Date: All time</option>
          <option value="7">Date: Last 7 days</option>
          <option value="30">Date: Last 30 days</option>
          <option value="90">Date: Last 90 days</option>
        </select>

        <select className="pfb-select" value={sortKey} onChange={e => setSortKey(e.target.value)}>
          <option value="dateReceived:desc">Sort: Received (Newest)</option>
          <option value="dateReceived:asc">Sort: Received (Oldest)</option>
          <option value="title:asc">Sort: Role (A–Z)</option>
          <option value="title:desc">Sort: Role (Z–A)</option>
          <option value="company:asc">Sort: Company (A–Z)</option>
          <option value="stage:asc">Sort: Stage</option>
          <option value="followUpDate:asc">Sort: Follow-up</option>
        </select>

        <div className="pfb-spacer" />

        <label className="pfb-toggle">
          <input type="checkbox" checked={hideRejected} onChange={e => setHideRejected(e.target.checked)} />
          <span className="pfb-toggle-slider" />
          <span className="pfb-toggle-label">Hide rejected</span>
        </label>
      </div>

      {sorted.length === 0 ? (
        <div className="pipeline-table-empty">
          <p>No applications match the current filters.</p>
          <button className="pipeline-clear-filters" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="pipeline-table-scroll">
            <table className="pipeline-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Company</th>
                  <th>Location</th>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Stage</th>
                  <th>Received</th>
                  <th>Follow-up</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(job => {
                  const stage = getEffectiveStage(job);
                  const isSelected = selectedRowId === job.id;
                  const isEditingStage    = editingCell?.rowId === job.id && editingCell.field === 'stage';
                  const isEditingNotes    = editingCell?.rowId === job.id && editingCell.field === 'notes';
                  const isEditingFollowUp = editingCell?.rowId === job.id && editingCell.field === 'followUpDate';

                  return (
                    <tr
                      key={job.id}
                      className={`pt-row${isSelected ? ' pt-row-selected' : ''}`}
                      onClick={() => setSelectedRowId(isSelected ? null : job.id)}
                    >
                      {/* Role */}
                      <td className="pt-role">
                        {job.url
                          ? <a href={job.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{job.title}</a>
                          : job.title}
                      </td>

                      {/* Company */}
                      <td className="pt-company">{job.company}</td>

                      {/* Location */}
                      <td className="pt-location">{job.location || '—'}</td>

                      {/* Source */}
                      <td className="pt-source">
                        <span className={`source-badge source-${job.source}`}>{job.source}</span>
                      </td>

                      {/* Type */}
                      <td className="pt-type">
                        <span className="type-badge">{job.type || '—'}</span>
                      </td>

                      {/* Stage */}
                      <td className="pt-stage" onClick={e => e.stopPropagation()}>
                        {pendingStage?.rowId === job.id ? (
                          <div className="pt-stage-popover">
                            <div className="pt-stage-popover-label">{STAGE_LABELS[pendingStage.newStage]}</div>
                            <input
                              type="date"
                              className="pt-date-input"
                              value={pendingStage.date}
                              onChange={e => setPendingStage(prev => prev ? { ...prev, date: e.target.value } : null)}
                              autoFocus
                            />
                            <div className="pt-stage-popover-actions">
                              <button className="pt-stage-popover-confirm" onClick={confirmStageChange}>Confirm</button>
                              <button className="pt-stage-popover-cancel" onClick={() => setPendingStage(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="pt-stage-menu-wrap">
                            <button
                              className={`pt-stage-badge ${stage ? STAGE_COLOR_CLASS[stage] : ''}`}
                              onClick={e => { e.stopPropagation(); setStageMenuId(stageMenuId === job.id ? null : job.id); }}
                              title="Click to change stage"
                            >
                              <span>
                                {stage ? STAGE_LABELS[stage] : '—'}
                                {job.stageDate && <span className="pt-stage-date-inline"> · {formatDate(job.stageDate)}</span>}
                              </span>
                              <span>▾</span>
                            </button>
                            {stageMenuId === job.id && (
                              <>
                              <div className="pt-stage-backdrop" onClick={() => setStageMenuId(null)} />
                              <div className="pt-stage-dropdown" onClick={e => e.stopPropagation()}>
                                {STAGES.map(s => (
                                  <button
                                    key={s}
                                    className={`pt-stage-option ${STAGE_COLOR_CLASS[s]}${stage === s ? ' active' : ''}`}
                                    onClick={async () => {
                                      setStageMenuId(null);
                                      if (s === stage) return;
                                      setPendingStage({ rowId: job.id, newStage: s, date: new Date().toISOString().slice(0, 10) });
                                    }}
                                  >
                                    {STAGE_LABELS[s]}
                                  </button>
                                ))}

                              </div>
                              </>
                            )}
                          </div>
                        )}
                        {cellErrors[`${job.id}-stage`] && (
                          <span className="pt-cell-error">{cellErrors[`${job.id}-stage`]}</span>
                        )}
                      </td>

                      {/* Received */}
                      <td className="pt-date">{formatDate(job.dateReceived)}</td>

                      {/* Follow-up */}
                      <td className="pt-followup" onClick={e => e.stopPropagation()}>
                        {isEditingFollowUp ? (
                          <input
                            type="date"
                            className="pt-date-input"
                            value={editValue}
                            autoFocus
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(job)}
                            onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }}
                          />
                        ) : (
                          <span
                            className="pt-followup-value"
                            onClick={() => startEdit(job.id, 'followUpDate', job.followUpDate ?? '')}
                            title="Click to set follow-up date"
                          >
                            {job.followUpDate ? formatDate(job.followUpDate) : <span className="pt-empty-cell">—</span>}
                          </span>
                        )}
                        {cellErrors[`${job.id}-followUpDate`] && (
                          <span className="pt-cell-error">{cellErrors[`${job.id}-followUpDate`]}</span>
                        )}
                      </td>

                      {/* Notes */}
                      <td className="pt-notes" onClick={e => e.stopPropagation()}>
                        {isEditingNotes ? (
                          <input
                            type="text"
                            className="pt-notes-input"
                            value={editValue}
                            maxLength={2000}
                            autoFocus
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(job)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                          />
                        ) : (
                          <span
                            className={`pt-notes-value${!job.notes ? ' pt-empty-cell' : ''}`}
                            onClick={() => startEdit(job.id, 'notes', job.notes ?? '')}
                            title={job.notes ?? 'Click to add note'}
                          >
                            {job.notes ? truncateNotes(job.notes) : 'Add note…'}
                          </span>
                        )}
                        {cellErrors[`${job.id}-notes`] && (
                          <span className="pt-cell-error">{cellErrors[`${job.id}-notes`]}</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="pt-actions" onClick={e => e.stopPropagation()}>
                        <div className="pt-actions-wrap">
                          <button
                            className="pt-action-btn"
                            title="Remove from board"
                            onClick={() => setConfirmDeleteId(confirmDeleteId === job.id ? null : job.id)}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                              <path d="M10 11v6M14 11v6"/>
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                            </svg>
                          </button>
                          {confirmDeleteId === job.id && (
                            <div className="pt-delete-confirm">
                              <span>Delete?</span>
                              <button className="pt-delete-confirm-yes" onClick={() => { setConfirmDeleteId(null); removeJob(job); }}>Yes</button>
                              <button className="pt-delete-confirm-no" onClick={() => setConfirmDeleteId(null)}>No</button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pipeline-table-footer">
            <span className="ptf-count">Showing {paginated.length} of {sorted.length} applications</span>
            {totalPages > 1 && (
              <div className="pagination">
                <button className="page-nav" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                  Previous
                </button>
                <div className="page-numbers">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                    .reduce<(number | '...')[]>((acc, p, i, arr) => {
                      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) =>
                      p === '...'
                        ? <span key={`dot-${i}`} className="page-dots">...</span>
                        : <button key={p} className={`page-num ${p === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(p as number)}>{p}</button>
                    )}
                </div>
                <button className="page-nav" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages}>
                  Next
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── ApplicationsView (exported) ──────────────────────────────────────────────

interface PipelineViewProps {
  refreshTrigger: number;
}

export function ApplicationsView({ refreshTrigger }: PipelineViewProps) {
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    const all = await getAllJobs();
    setAllJobs(all.filter(j => {
      const s = getEffectiveStage(j);
      return s !== null && s !== 'saved';
    }));
    setLoading(false);
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs, refreshTrigger]);

  const handleJobUpdate = useCallback((id: string, patch: Partial<Job>) => {
    setAllJobs(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j));
  }, []);

  if (loading) {
    return (
      <div className="pipeline-loading">
        <div className="pipeline-loading-spinner" />
        <span>Loading applications…</span>
      </div>
    );
  }

  if (allJobs.length === 0) {
    return (
      <div className="pipeline-empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
          <rect x="2" y="7" width="20" height="14" rx="2"/>
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
        </svg>
        <p>No applications yet</p>
        <span>Apply to a job from the dashboard to start tracking it here.</span>
      </div>
    );
  }

  return (
    <div className="pipeline-view">
      <PipelineStatsBar jobs={allJobs} />
      <div className="pipeline-table-card">
        <PipelineTable jobs={allJobs} onJobUpdate={handleJobUpdate} />
      </div>
    </div>
  );
}
