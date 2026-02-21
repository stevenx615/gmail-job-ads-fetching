import { useState, useEffect, useCallback } from 'react';
import { getAllJobs, updateJobStage } from '../services/jobService';
import type { Job, ApplicationStage } from '../types';

const STAGES: ApplicationStage[] = [
  'saved', 'applied', 'phone_screen', 'interview', 'offer', 'rejected',
];

const STAGE_LABELS: Record<ApplicationStage, string> = {
  saved: 'Saved',
  applied: 'Applied',
  phone_screen: 'Phone Screen',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};

const STAGE_DOT_CLASS: Record<ApplicationStage, string> = {
  saved: 'stage-dot-saved',
  applied: 'stage-dot-applied',
  phone_screen: 'stage-dot-phone',
  interview: 'stage-dot-interview',
  offer: 'stage-dot-offer',
  rejected: 'stage-dot-rejected',
};

const NEXT_STAGE: Partial<Record<ApplicationStage, ApplicationStage>> = {
  saved: 'applied',
  applied: 'phone_screen',
  phone_screen: 'interview',
  interview: 'offer',
  offer: undefined,
  rejected: undefined,
};

function getEffectiveStage(job: Job): ApplicationStage | null {
  if (job.applicationStage) return job.applicationStage;
  if (job.applied) return 'applied';
  if (job.saved) return 'saved';
  return null;
}

interface PipelineViewProps {
  refreshTrigger: number;
}

export function PipelineView({ refreshTrigger }: PipelineViewProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<ApplicationStage>>(
    new Set(['rejected'])
  );
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const loadJobs = useCallback(async () => {
    setLoading(true);
    const all = await getAllJobs();
    setJobs(all.filter(j => getEffectiveStage(j) !== null));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs, refreshTrigger]);

  const toggleCollapse = (stage: ApplicationStage) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  const moveJob = async (job: Job, stage: ApplicationStage) => {
    // Optimistic update
    setJobs(prev =>
      prev.map(j => j.id === job.id ? { ...j, applicationStage: stage } : j)
    );
    setRowErrors(prev => { const n = { ...prev }; delete n[job.id]; return n; });
    try {
      await updateJobStage(job.id, stage);
    } catch {
      // Revert on failure
      setJobs(prev =>
        prev.map(j => j.id === job.id ? job : j)
      );
      setRowErrors(prev => ({ ...prev, [job.id]: 'Failed to update stage. Try again.' }));
    }
  };

  if (loading) {
    return <div className="pipeline-view"><p className="pipeline-empty">Loading…</p></div>;
  }

  if (jobs.length === 0) {
    return (
      <div className="pipeline-view">
        <h2>Pipeline</h2>
        <p className="pipeline-empty">
          No jobs in your pipeline yet — save or apply to a job to get started.
        </p>
      </div>
    );
  }

  const grouped = Object.fromEntries(
    STAGES.map(stage => [
      stage,
      jobs.filter(j => getEffectiveStage(j) === stage),
    ])
  ) as Record<ApplicationStage, Job[]>;

  const activeCount = jobs.filter(j => getEffectiveStage(j) !== 'rejected').length;

  return (
    <div className="pipeline-view">
      <h2>Pipeline <span className="pipeline-stage-count">{activeCount} active</span></h2>
      {STAGES.map(stage => {
        const stageJobs = grouped[stage];
        const isCollapsed = collapsed.has(stage);
        return (
          <div key={stage} className="pipeline-stage">
            <button
              className="pipeline-stage-header"
              onClick={() => toggleCollapse(stage)}
              aria-expanded={!isCollapsed}
            >
              <span className={`pipeline-stage-dot ${STAGE_DOT_CLASS[stage]}`} />
              <span className="pipeline-stage-label">{STAGE_LABELS[stage]}</span>
              <span className="pipeline-stage-count">{stageJobs.length}</span>
              <span className={`pipeline-chevron${isCollapsed ? '' : ' open'}`}>▶</span>
            </button>

            {!isCollapsed && stageJobs.length > 0 && (
              <div className="pipeline-jobs">
                {stageJobs.map(job => {
                  const nextStage = NEXT_STAGE[stage];
                  return (
                    <div key={job.id}>
                      <div className="pipeline-job-row">
                        <div className="pipeline-job-info">
                          <div className="pipeline-job-title">
                            {job.url ? (
                              <a href={job.url} target="_blank" rel="noopener noreferrer">
                                {job.title}
                              </a>
                            ) : (
                              job.title
                            )}
                          </div>
                          <div className="pipeline-job-meta">
                            {job.company}
                            {job.location ? ` · ${job.location}` : ''}
                            {` · ${job.source}`}
                          </div>
                        </div>
                        <div className="pipeline-job-actions">
                          <select
                            className="pipeline-stage-select"
                            value={stage}
                            onChange={e => moveJob(job, e.target.value as ApplicationStage)}
                          >
                            {STAGES.map(s => (
                              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                            ))}
                          </select>
                          {nextStage && (
                            <button
                              className="pipeline-next-btn"
                              onClick={() => moveJob(job, nextStage)}
                              title={`Move to ${STAGE_LABELS[nextStage]}`}
                            >
                              → {STAGE_LABELS[nextStage]}
                            </button>
                          )}
                        </div>
                      </div>
                      {rowErrors[job.id] && (
                        <div className="pipeline-row-error">{rowErrors[job.id]}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
