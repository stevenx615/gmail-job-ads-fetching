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

function truncateNotes(notes: string | undefined, max = 60): string {
  if (!notes) return '';
  return notes.length > max ? notes.slice(0, max) + '…' : notes;
}

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

  return (
    <div className="pipeline-stats-bar">
      <div className="pipeline-stat-badge pipeline-stat-total">
        <span className="pipeline-stat-count">{total}</span>
        <span className="pipeline-stat-label">Total</span>
      </div>
      {STAGES.map(stage => (
        <div key={stage} className={`pipeline-stat-badge ${STAGE_COLOR_CLASS[stage]}`}>
          <span className="pipeline-stat-count">{counts[stage]}</span>
          <span className="pipeline-stat-label">{STAGE_LABELS[stage]}</span>
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
  const [activeOnly, setActiveOnly] = useState(false);

  // ── Sort state ──
  const [sortField, setSortField] = useState<SortField>('dateReceived');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // ── Pagination ──
  const [currentPage, setCurrentPage] = useState(1);

  // ── Inline editing ──
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});

  // ── Pending stage change (awaiting date confirmation) ──
  const [pendingStage, setPendingStage] = useState<{
    rowId: string;
    newStage: ApplicationStage;
    date: string;
  } | null>(null);

  // Effective hideRejected = activeOnly || hideRejected
  const effectiveHideRejected = activeOnly || hideRejected;

  // ── Filtering ──
  const nowMs = Date.now();
  /* eslint-disable react-hooks/exhaustive-deps */
  const cutoffMs = useMemo(
    () => dateRange !== 'all' ? nowMs - parseInt(dateRange) * 86400000 : null,
    [dateRange] // nowMs intentionally omitted: recompute only when dateRange changes
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  const filtered = jobs.filter(job => {
    const stage = getEffectiveStage(job);
    if (!stage) return false;
    if (effectiveHideRejected && stage === 'rejected') return false;
    if (activeOnly && stage === 'saved') return false;
    if (stageFilter !== 'all' && stage !== stageFilter) return false;
    if (cutoffMs !== null) {
      if (new Date(job.dateReceived).getTime() < cutoffMs) return false;
    }
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
      case 'title':    cmp = a.title.localeCompare(b.title); break;
      case 'company':  cmp = a.company.localeCompare(b.company); break;
      case 'stage':    cmp = stageOrder(getEffectiveStage(a)) - stageOrder(getEffectiveStage(b)); break;
      case 'dateReceived': cmp = new Date(a.dateReceived).getTime() - new Date(b.dateReceived).getTime(); break;
      case 'followUpDate':
        cmp = (a.followUpDate ?? '').localeCompare(b.followUpDate ?? ''); break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕';

  // Reset to page 1 whenever filters or sort change
  useEffect(() => { setCurrentPage(1); }, [search, stageFilter, dateRange, hideRejected, activeOnly, sortField, sortDir]);

  const clearFilters = () => {
    setSearch('');
    setStageFilter('all');
    setDateRange('30');
    setHideRejected(true);
    setActiveOnly(false);
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

  // commitEdit handles notes and followUpDate only.
  // Stage changes go directly through the select onChange handler (see below)
  // to avoid the React async state issue where editValue would be stale.
  const commitEdit = async (job: Job) => {
    if (!editingCell) return;
    const { rowId, field } = editingCell;
    if (field === 'stage') return; // handled in select onChange
    // Skip save if value hasn't changed
    const currentValue = field === 'notes' ? (job.notes ?? '') : (job.followUpDate ?? '');
    if (editValue === currentValue) { cancelEdit(); return; }
    // Capture pre-optimistic values BEFORE calling onJobUpdate so revert is always correct
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
      // Clear any previous error for this cell on success
      setCellErrors(e => { const next = { ...e }; delete next[errorKey]; return next; });
    } catch {
      onJobUpdate(rowId, field === 'notes' ? { notes: revertNotes } : { followUpDate: revertFollowUpDate });
      setCellErrors(e => ({ ...e, [errorKey]: `Failed to update ${field}` }));
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    // Date-only strings (YYYY-MM-DD) parse as UTC midnight — use local constructor to avoid day-off bug
    const d = iso.includes('T')
      ? new Date(iso)
      : (() => { const [y, m, day] = iso.split('-').map(Number); return new Date(y, m - 1, day); })();
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (sorted.length === 0) {
    return (
      <div className="pipeline-table-empty">
        <p>No applications match the current filters.</p>
        <button className="pipeline-clear-filters" onClick={clearFilters}>Clear filters</button>
      </div>
    );
  }

  return (
    <div className="pipeline-table-wrapper">
      {/* Filter Bar */}
      <div className="pipeline-filter-bar">
        <input
          className="pipeline-search"
          type="text"
          placeholder="Search role or company…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <label className="pipeline-filter-label">
          Stage
          <select
            className="pipeline-filter-select"
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value as ApplicationStage | 'all')}
          >
            <option value="all">All</option>
            {STAGES.map(s => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="pipeline-filter-label">
          Date
          <select
            className="pipeline-filter-select"
            value={dateRange}
            onChange={e => setDateRange(e.target.value as typeof dateRange)}
          >
            <option value="all">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
        <button
          className={`pipeline-filter-toggle${effectiveHideRejected && !activeOnly ? ' active' : ''}`}
          onClick={() => !activeOnly && setHideRejected(v => !v)}
          disabled={activeOnly}
          title={activeOnly ? 'Forced on by Active Only' : undefined}
        >
          Hide Rejected
        </button>
        <button
          className={`pipeline-filter-toggle${activeOnly ? ' active' : ''}`}
          onClick={() => setActiveOnly(v => !v)}
        >
          Active Only
        </button>
      </div>

      {/* Table */}
      <div className="pipeline-table-scroll">
        <table className="pipeline-table">
          <thead>
            <tr>
              <th className="pt-sortable" onClick={() => toggleSort('title')}>Role{sortIndicator('title')}</th>
              <th className="pt-sortable" onClick={() => toggleSort('company')}>Company{sortIndicator('company')}</th>
              <th>Location</th>
              <th>Source</th>
              <th>Type</th>
              <th className="pt-sortable" onClick={() => toggleSort('stage')}>Stage{sortIndicator('stage')}</th>
              <th className="pt-sortable" onClick={() => toggleSort('dateReceived')}>Received{sortIndicator('dateReceived')}</th>
              <th className="pt-sortable" onClick={() => toggleSort('followUpDate')}>Follow-up{sortIndicator('followUpDate')}</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(job => {
              const stage = getEffectiveStage(job);
              const isEditingStage = editingCell?.rowId === job.id && editingCell.field === 'stage';
              const isEditingNotes = editingCell?.rowId === job.id && editingCell.field === 'notes';
              const isEditingFollowUp = editingCell?.rowId === job.id && editingCell.field === 'followUpDate';

              return (
                <tr key={job.id} className="pt-row">
                  {/* Role */}
                  <td className="pt-role">
                    {job.url
                      ? <a href={job.url} target="_blank" rel="noopener noreferrer">{job.title}</a>
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

                  {/* Stage — inline editable */}
                  <td className="pt-stage">
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
                    ) : isEditingStage ? (
                      <select
                        className="pt-stage-select"
                        value={editValue}
                        autoFocus
                        onChange={async e => {
                          const val = e.target.value;
                          setEditingCell(null);
                          if (val === '__remove__') {
                            const oldStage = getEffectiveStage(job);
                            const oldStageDate = job.stageDate;
                            onJobUpdate(job.id, { applied: false, applicationStage: undefined, stageDate: undefined });
                            try {
                              await removeFromApplications(job.id);
                            } catch {
                              onJobUpdate(job.id, { applicationStage: oldStage ?? undefined, stageDate: oldStageDate, applied: job.applied });
                              setCellErrors(prev => ({ ...prev, [`${job.id}-stage`]: 'Failed to remove' }));
                            }
                            return;
                          }
                          setPendingStage({
                            rowId: job.id,
                            newStage: val as ApplicationStage,
                            date: new Date().toISOString().slice(0, 10),
                          });
                        }}
                        onBlur={cancelEdit}
                      >
                        {STAGES.map(s => (
                          <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                        ))}
                        <option disabled>──────────</option>
                        <option value="__remove__">Remove from board</option>
                      </select>
                    ) : (
                      <button
                        className={`pt-stage-badge ${stage ? STAGE_COLOR_CLASS[stage] : ''}`}
                        onClick={() => startEdit(job.id, 'stage', stage ?? 'applied')}
                        title="Click to change stage"
                      >
                        <span>
                          {stage ? STAGE_LABELS[stage] : '—'}
                          {job.stageDate && <span className="pt-stage-date-inline"> · {formatDate(job.stageDate)}</span>}
                        </span>
                        <span>▾</span>
                      </button>
                    )}
                    {cellErrors[`${job.id}-stage`] && (
                      <span className="pt-cell-error">{cellErrors[`${job.id}-stage`]}</span>
                    )}
                  </td>

                  {/* Date Applied */}
                  <td className="pt-date">{formatDate(job.dateReceived)}</td>

                  {/* Follow-up Date — inline editable */}
                  <td className="pt-followup">
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

                  {/* Notes — inline editable */}
                  <td className="pt-notes">
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
                          if (e.key === 'Enter') { e.currentTarget.blur(); }
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pipeline-table-footer">
        <span>Showing {Math.min(currentPage * PAGE_SIZE, sorted.length)} of {sorted.length} applications</span>
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
    </div>
  );
}

// ─── PipelineView (exported) ──────────────────────────────────────────────────

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

  useEffect(() => {
    loadJobs();
  }, [loadJobs, refreshTrigger]);

  // Optimistic in-place job update (used by PipelineTable on inline edits)
  const handleJobUpdate = useCallback((id: string, patch: Partial<Job>) => {
    setAllJobs(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j));
  }, []);

  if (loading) {
    return <div className="pipeline-view"><p className="pipeline-empty">Loading…</p></div>;
  }

  if (allJobs.length === 0) {
    return (
      <div className="pipeline-view">
        <h2>Applications</h2>
        <p className="pipeline-empty">
          No applications yet — apply to a job to start tracking it here.
        </p>
      </div>
    );
  }

  return (
    <div className="pipeline-view">
      <PipelineStatsBar jobs={allJobs} />
      <PipelineTable jobs={allJobs} onJobUpdate={handleJobUpdate} />
    </div>
  );
}
