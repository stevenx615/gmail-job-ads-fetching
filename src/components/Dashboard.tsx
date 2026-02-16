import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getUnreadJobs, getReadJobs, getAllJobs, deleteJob, toggleJobSaved, toggleJobApplied, toggleJobReadStatus, updateJobBadges } from '../services/jobService';
import { getSettings } from '../services/settingsService';
import { BadgeSelector } from './BadgeSelector';
import { BADGE_CATEGORIES } from '../constants/badgeDefinitions';
import type { Job, JobBadges } from '../types';

interface DashboardProps {
  refreshTrigger: number;
}

export function Dashboard({ refreshTrigger }: DashboardProps) {
  // Re-read settings whenever refreshTrigger changes (e.g. after settings saved)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const settings = useMemo(() => getSettings(), [refreshTrigger]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [savedFilter, setSavedFilter] = useState(false);
  const [sortBy, setSortBy] = useState<string>(settings.defaultSort);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [showReadJobs, setShowReadJobs] = useState(settings.defaultView === 'read');
  const [showAllJobs, setShowAllJobs] = useState(settings.defaultView === 'all');
  const [badgeSelectorOpenId, setBadgeSelectorOpenId] = useState<string | null>(null);
  const jobListRef = useRef<HTMLDivElement>(null);
  const pageSize = settings.jobsPerPage;

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      let data: Job[];
      if (showAllJobs) {
        data = await getAllJobs();
      } else if (showReadJobs) {
        data = await getReadJobs();
      } else {
        data = await getUnreadJobs();
      }
      setJobs(data);
      setError(null);
    } catch (err) {
      console.error('Error loading jobs:', err);
      setError('Failed to load jobs. Check Firebase configuration.');
    } finally {
      setLoading(false);
    }
  }, [showReadJobs, showAllJobs]);

  const refreshTriggerRef = useRef(refreshTrigger);
  useEffect(() => {
    // Load jobs when refreshTrigger or showReadJobs changes
    refreshTriggerRef.current = refreshTrigger;
    loadJobs();
  }, [loadJobs, refreshTrigger]);

  const sources = useMemo(() => {
    const srcSet = new Set<string>();
    jobs.forEach(job => { if (job.source) srcSet.add(job.source); });
    return Array.from(srcSet).sort();
  }, [jobs]);

  const types = useMemo(() => {
    const typeSet = new Set<string>();
    jobs.forEach(job => { if (job.type) typeSet.add(job.type); });
    return Array.from(typeSet).sort();
  }, [jobs]);

  const savedCount = useMemo(() => jobs.filter(j => j.saved).length, [jobs]);

  const uniqueLocations = useMemo(() => {
    const locMap = new Map<string, number>();
    jobs.forEach(job => {
      const loc = (job.location || '').trim();
      if (loc) {
        const key = loc.toLowerCase();
        locMap.set(key, (locMap.get(key) || 0) + 1);
      }
    });
    return Array.from(locMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([loc, count]) => ({ label: loc, count }));
  }, [jobs]);

  const filteredLocations = useMemo(() => {
    if (!locationSearch) return uniqueLocations;
    const term = locationSearch.toLowerCase();
    return uniqueLocations.filter(l => l.label.includes(term));
  }, [uniqueLocations, locationSearch]);

  const repostCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    jobs.forEach(job => {
      const key = `${(job.title || '').toLowerCase()}|${(job.company || '').toLowerCase()}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [jobs]);

  const getRepostCount = (job: Job) => {
    const key = `${(job.title || '').toLowerCase()}|${(job.company || '').toLowerCase()}`;
    return repostCounts[key] || 1;
  };

  const hasFilters = searchTerm || locationSearch || typeFilter !== 'all' || sourceFilter !== 'all' || savedFilter;

  const clearAllFilters = () => {
    setSearchTerm('');
    setLocationSearch('');
    setTypeFilter('all');
    setSourceFilter('all');
    setSavedFilter(false);
    setSortBy(settings.defaultSort);
  };

  const handleRepostClick = (job: Job) => {
    setSearchTerm(job.title);
    setTypeFilter('all');
    setSourceFilter('all');
    setSavedFilter(false);
    setLocationSearch('');
  };

  const filteredJobs = useMemo(() => {
    let result = [...jobs];
    if (savedFilter) result = result.filter(j => j.saved);
    if (typeFilter !== 'all') result = result.filter(j => j.type === typeFilter);
    if (sourceFilter !== 'all') result = result.filter(j => j.source === sourceFilter);
    if (locationSearch) {
      const loc = locationSearch.toLowerCase();
      result = result.filter(j => j.location?.toLowerCase().includes(loc));
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(j =>
        j.title?.toLowerCase().includes(term) ||
        j.company?.toLowerCase().includes(term) ||
        j.location?.toLowerCase().includes(term)
      );
    }
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'none':
          // Preserve original order from Firestore
          return 0;
        case 'date-desc':
          comparison = new Date(b.dateReceived || 0).getTime() - new Date(a.dateReceived || 0).getTime();
          break;
        case 'date-asc':
          comparison = new Date(a.dateReceived || 0).getTime() - new Date(b.dateReceived || 0).getTime();
          break;
        case 'title-asc':
          comparison = (a.title || '').localeCompare(b.title || '');
          break;
        case 'title-desc':
          comparison = (b.title || '').localeCompare(a.title || '');
          break;
        case 'company-asc':
          comparison = (a.company || '').localeCompare(b.company || '');
          break;
        default:
          comparison = 0;
      }
      // Secondary sort by id for stable ordering when primary values are equal
      return comparison !== 0 ? comparison : a.id.localeCompare(b.id);
    });
    return result;
  }, [jobs, savedFilter, typeFilter, sourceFilter, locationSearch, searchTerm, sortBy]);

  useEffect(() => { setCurrentPage(1); }, [savedFilter, typeFilter, sourceFilter, locationSearch, searchTerm, sortBy]);
  useEffect(() => { jobListRef.current?.scrollTo({ top: 0 }); }, [currentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const paginatedJobs = filteredJobs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const stats = useMemo(() => {
    const bySource: Record<string, number> = {};
    const byType: Record<string, number> = {};
    jobs.forEach(job => {
      bySource[job.source] = (bySource[job.source] || 0) + 1;
      byType[job.type] = (byType[job.type] || 0) + 1;
    });
    return { total: jobs.length, bySource, byType };
  }, [jobs]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    const pageIds = paginatedJobs.map(j => j.id);
    setSelectedIds(prev => {
      const allSelected = pageIds.every(id => prev.has(id));
      if (allSelected) { const next = new Set(prev); pageIds.forEach(id => next.delete(id)); return next; }
      return new Set([...prev, ...pageIds]);
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    try {
      for (const id of selectedIds) await deleteJob(id);
      setJobs(prev => prev.filter(j => !selectedIds.has(j.id)));
      setSelectedIds(new Set());
    } catch (err) { console.error('Bulk delete error:', err); }
    finally { setIsDeleting(false); }
  };

  const handleDelete = async (id: string) => {
    await deleteJob(id);
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  const handleSave = async (id: string) => {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const newSaved = !job.saved;
    await toggleJobSaved(id, newSaved);
    setJobs(prev => prev.map(j => j.id === id ? { ...j, saved: newSaved } : j));
  };

  const handleApplied = async (id: string) => {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const newApplied = !job.applied;
    await toggleJobApplied(id, newApplied);
    setJobs(prev => prev.map(j => j.id === id ? { ...j, applied: newApplied } : j));
  };

  const toggleRead = async (jobId: string, read: boolean) => {
    // Store original jobs state for rollback on error
    const originalJobs = jobs;

    // Update local state optimistically
    setJobs(jobs.map(j =>
      j.id === jobId ? { ...j, read } : j
    ));

    try {
      await toggleJobReadStatus(jobId, read);
    } catch (error) {
      console.error('Error toggling read status:', error);
      // Rollback to original state on error
      setJobs(originalJobs);
    }
  };

  const handleBadgeConfirm = async (jobId: string, badges: JobBadges) => {
    const originalJobs = jobs;
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, badges } : j));
    setBadgeSelectorOpenId(null);
    try {
      await updateJobBadges(jobId, badges);
    } catch (error) {
      console.error('Error saving badges:', error);
      setJobs(originalJobs);
    }
  };

  const getBadgeCategoryClass = (key: string) => {
    switch (key) {
      case 'responsibilities': return 'badge-cat-resp';
      case 'qualifications': return 'badge-cat-qual';
      case 'skills': return 'badge-cat-skill';
      case 'benefits': return 'badge-cat-bene';
      default: return '';
    }
  };

  const visibleBadgeCategories = useMemo(() =>
    BADGE_CATEGORIES.filter(cat => settings.badgeVisibility[cat.key as keyof typeof settings.badgeVisibility]),
    [settings.badgeVisibility]
  );

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);
    if (diffH < 1) return 'Just now';
    if (diffH < 24) return `${diffH}h ago`;
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getSourceBadgeClass = (source: string) => {
    switch (source) {
      case 'linkedin': return 'source-linkedin';
      case 'indeed': return 'source-indeed';
      case 'glassdoor': return 'source-glassdoor';
      default: return 'source-other';
    }
  };

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'developer': return 'badge-developer';
      case 'game-dev': return 'badge-gamedev';
      case 'designer': return 'badge-designer';
      case 'it-support': return 'badge-itsupport';
      case 'data-entry': return 'badge-dataentry';
      default: return 'badge-other';
    }
  };

  if (loading) return <div className="state-message">Loading jobs...</div>;
  if (error) return <div className="state-message state-error">{error}</div>;

  return (
    <div className="dashboard-layout">
      {/* Stats + Search Bar */}
      <div className="hero">
        <div className="stats-row">
          <div className="stat-card stat-total">
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">Total Jobs</span>
          </div>
          {Object.entries(stats.bySource).map(([source, count]) => (
            <div key={source} className={`stat-card stat-source-${source}`}>
              <span className="stat-value">{count}</span>
              <span className="stat-label">{source}</span>
            </div>
          ))}
          {Object.entries(stats.byType).map(([type, count]) => (
            <div key={type} className={`stat-card stat-type-${type}`}>
              <span className="stat-value">{count}</span>
              <span className="stat-label">{type}</span>
            </div>
          ))}
        </div>
        <div className="hero-search">
          <div className="hero-input-group">
            <svg className="hero-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              type="text"
              placeholder="Job title, keywords, or company"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="hero-input"
            />
          </div>
          <div className="hero-divider" />
          <div className="hero-input-group hero-location-wrapper">
            <svg className="hero-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <input
              type="text"
              placeholder="City, state, or remote"
              value={locationSearch}
              onChange={e => { setLocationSearch(e.target.value); setShowLocationDropdown(true); }}
              onFocus={() => setShowLocationDropdown(true)}
              onBlur={() => setShowLocationDropdown(false)}
              className="hero-input"
            />
            {showLocationDropdown && filteredLocations.length > 0 && (
              <div className="location-dropdown">
                {filteredLocations.map(loc => (
                  <button
                    key={loc.label}
                    className="location-option"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setLocationSearch(loc.label); setShowLocationDropdown(false); }}
                  >
                    <span>{loc.label}</span>
                    <span className="location-count">{loc.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {hasFilters && (
            <button className="hero-clear-btn" onClick={clearAllFilters} title="Clear all filters">&times;</button>
          )}
          <button className="hero-search-btn" onClick={() => {}}>Search Jobs</button>
        </div>
        <div className="hero-tags">
          <span className="hero-tags-label">Popular:</span>
          {['junior', 'entry level', 'intern', 'remote', 'developer', 'it support', 'winnipeg'].map(tag => (
            <button
              key={tag}
              className={`hero-tag ${searchTerm.toLowerCase() === tag ? 'active' : ''}`}
              onClick={() => setSearchTerm(prev => prev.toLowerCase() === tag ? '' : tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="content-area">
        {/* Sidebar */}
        <aside className="sidebar">
          <h3 className="sidebar-title">Filters</h3>

          <button
            className={`saved-filter-btn ${savedFilter ? 'active' : ''}`}
            onClick={() => setSavedFilter(f => !f)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={savedFilter ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            <span>Saved Jobs</span>
            <span className="filter-count">{savedCount}</span>
          </button>

          <div className="view-toggle-group">
            <button
              className={`view-toggle-btn ${!showReadJobs && !showAllJobs ? 'active' : ''}`}
              onClick={() => { setShowReadJobs(false); setShowAllJobs(false); }}
              title="Show unread jobs only"
            >
              Unread
            </button>
            <button
              className={`view-toggle-btn ${showReadJobs ? 'active' : ''}`}
              onClick={() => { setShowReadJobs(true); setShowAllJobs(false); }}
              title="Show read jobs only"
            >
              Read
            </button>
            <button
              className={`view-toggle-btn ${showAllJobs ? 'active' : ''}`}
              onClick={() => { setShowAllJobs(true); setShowReadJobs(false); }}
              title="Show all jobs"
            >
              All
            </button>
          </div>

          <div className="filter-section">
            <h4 className="filter-heading">Source</h4>
            <label className="filter-radio">
              <input type="radio" name="source" checked={sourceFilter === 'all'} onChange={() => setSourceFilter('all')} />
              <span>All Sources</span>
              <span className="filter-count">{stats.total}</span>
            </label>
            {sources.map(src => (
              <label key={src} className="filter-radio">
                <input type="radio" name="source" checked={sourceFilter === src} onChange={() => setSourceFilter(src)} />
                <span>{src}</span>
                <span className="filter-count">{stats.bySource[src] || 0}</span>
              </label>
            ))}
          </div>

          <div className="filter-section">
            <h4 className="filter-heading">Job Type</h4>
            <label className="filter-radio">
              <input type="radio" name="type" checked={typeFilter === 'all'} onChange={() => setTypeFilter('all')} />
              <span>All Types</span>
              <span className="filter-count">{stats.total}</span>
            </label>
            {types.map(t => (
              <label key={t} className="filter-radio">
                <input type="radio" name="type" checked={typeFilter === t} onChange={() => setTypeFilter(t)} />
                <span>{t}</span>
                <span className="filter-count">{stats.byType[t] || 0}</span>
              </label>
            ))}
          </div>
        </aside>

        {/* Job Results */}
        <div className="results">
          {/* Results Header */}
          <div className="results-header">
            <div className="results-header-left">
              <input
                type="checkbox"
                className="select-all-checkbox"
                checked={paginatedJobs.length > 0 && paginatedJobs.every(j => selectedIds.has(j.id))}
                onChange={selectAllVisible}
                title={paginatedJobs.length > 0 && paginatedJobs.every(j => selectedIds.has(j.id)) ? 'Deselect page' : 'Select page'}
              />
              <span className="results-count">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${filteredJobs.length} Jobs Found`}
              </span>
              {selectedIds.size > 0 && (
                <button className="delete-selected-btn" onClick={handleBulkDelete} disabled={isDeleting}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              )}
              {hasFilters && selectedIds.size === 0 && (
                <button className="clear-filters-btn" onClick={clearAllFilters}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Clear Filters
                </button>
              )}
            </div>
            <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="none">Default Order</option>
              <option value="date-desc">Most Recent</option>
              <option value="date-asc">Oldest First</option>
              <option value="title-asc">Title A-Z</option>
              <option value="title-desc">Title Z-A</option>
              <option value="company-asc">Company A-Z</option>
            </select>
          </div>

          {/* Job Cards */}
          <div className="job-list-scroll" ref={jobListRef}>
            {filteredJobs.length === 0 ? (
              <div className="empty-state">
                {jobs.length === 0
                  ? 'No jobs found. Connect Gmail and fetch emails to get started!'
                  : 'No jobs match your current filters.'}
              </div>
            ) : (
              <div className="job-cards">
                {paginatedJobs.map(job => (
                  <div key={job.id} className={`job-card ${selectedIds.has(job.id) ? 'selected' : ''} ${job.read ? 'read' : ''}`}>
                    <input
                      type="checkbox"
                      className="job-checkbox"
                      checked={selectedIds.has(job.id)}
                      onChange={() => toggleSelect(job.id)}
                    />
                    <div className="job-card-body">
                      <div className="job-card-top">
                        <div>
                          <h3 className="job-card-title">{job.url ? <a href={job.url} target="_blank" rel="noopener noreferrer">{job.title}</a> : job.title}</h3>
                          <p className="job-card-company">{job.company}</p>
                        </div>
                        <div className="job-card-actions">
                          <button
                            className={`card-icon-btn card-btn-save ${job.saved ? 'saved' : ''}`}
                            onClick={() => handleSave(job.id)}
                            title={job.saved ? 'Unsave' : 'Save'}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill={job.saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                          </button>
                          <button
                            className={`card-icon-btn card-btn-applied ${job.applied ? 'applied' : ''}`}
                            onClick={() => handleApplied(job.id)}
                            title={job.applied ? 'Mark as not applied' : 'Mark as applied'}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill={job.applied ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M7.3,11.4,10.1,3a.6.6,0,0,1,.8-.3l1,.5a2.6,2.6,0,0,1,1.4,2.3V9.4h6.4a2,2,0,0,1,1.9,2.5l-2,8a2,2,0,0,1-1.9,1.5H4.3a2,2,0,0,1-2-2v-6a2,2,0,0,1,2-2h3v10"/></svg>
                          </button>
                          <button
                            className={`card-icon-btn card-btn-read ${job.read ? 'read' : ''}`}
                            onClick={() => toggleRead(job.id, !job.read)}
                            title={job.read ? 'Mark as unread' : 'Mark as read'}
                            aria-label={job.read ? 'Mark job as unread' : 'Mark job as read'}
                          >
                            {job.read ? (
                              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.99902 3L20.999 21M9.8433 9.91364C9.32066 10.4536 8.99902 11.1892 8.99902 12C8.99902 13.6569 10.3422 15 11.999 15C12.8215 15 13.5667 14.669 14.1086 14.133M6.49902 6.64715C4.59972 7.90034 3.15305 9.78394 2.45703 12C3.73128 16.0571 7.52159 19 11.9992 19C13.9881 19 15.8414 18.4194 17.3988 17.4184M10.999 5.04939C11.328 5.01673 11.6617 5 11.9992 5C16.4769 5 20.2672 7.94291 21.5414 12C21.2607 12.894 20.8577 13.7338 20.3522 14.5" />
                              </svg>
                            ) : (
                              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            )}
                          </button>
                          <button className="card-icon-btn card-btn-delete" onClick={() => handleDelete(job.id)} title="Delete">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </div>
                      <div className="job-card-meta">
                        {job.location && (
                          <span className="meta-item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                            {job.location}
                          </span>
                        )}
                        <span className="meta-item">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          {formatDate(job.dateReceived)}
                        </span>
                      </div>
                      <div className="job-card-tags">
                        {job.applied && (
                          <span className="applied-badge">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2"><path d="M7.3,11.4,10.1,3a.6.6,0,0,1,.8-.3l1,.5a2.6,2.6,0,0,1,1.4,2.3V9.4h6.4a2,2,0,0,1,1.9,2.5l-2,8a2,2,0,0,1-1.9,1.5H4.3a2,2,0,0,1-2-2v-6a2,2,0,0,1,2-2h3v10"/></svg>
                            Applied
                          </span>
                        )}
                        {job.source && (
                          <button className={`source-tag ${getSourceBadgeClass(job.source)}`} onClick={() => setSourceFilter(job.source)}>
                            {job.source}
                          </button>
                        )}
                        {job.type && (
                          <button className={`type-badge ${getTypeBadgeClass(job.type)}`} onClick={() => setTypeFilter(job.type)}>{job.type}</button>
                        )}
                        {job.badges && visibleBadgeCategories.map(cat => {
                            const items = job.badges?.[cat.key as keyof JobBadges] || [];
                            if (items.length === 0) return null;
                            return items.map(badge => (
                              <span key={`${cat.key}-${badge}`} className={`category-badge ${getBadgeCategoryClass(cat.key)}`}>{badge}</span>
                            ));
                          })}
                        {job.tags?.map(tag => (
                          <button key={tag} className="tag" onClick={() => setSearchTerm(tag)}>{tag}</button>
                        ))}
                        {getRepostCount(job) > 1 && (
                          <button
                            className="repost-badge"
                            onClick={() => handleRepostClick(job)}
                            title={`Seen ${getRepostCount(job)} times — click to view all`}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                            {getRepostCount(job)}x
                          </button>
                        )}
                        <button
                          className="card-btn-badge-add"
                          onClick={() => setBadgeSelectorOpenId(prev => prev === job.id ? null : job.id)}
                          title="Add badges"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </button>
                      </div>
                      {badgeSelectorOpenId === job.id && (
                        <BadgeSelector
                          badges={job.badges || { responsibilities: [], qualifications: [], skills: [], benefits: [] }}
                          jobType={job.type}
                          jobTitle={job.title}
                          jobCompany={job.company}
                          jobTags={job.tags}
                          jobLocation={job.location}
                          onConfirm={(badges) => handleBadgeConfirm(job.id, badges)}
                          onCancel={() => setBadgeSelectorOpenId(null)}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fixed Pagination */}
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
                if (i > 0 && p - (arr[i - 1]) > 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === '...'
                  ? <span key={`dot-${i}`} className="page-dots">...</span>
                  : <button key={p} className={`page-num ${p === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(p)}>{p}</button>
              )}
          </div>
          <button className="page-nav" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages}>
            Next
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
