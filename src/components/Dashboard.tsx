import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getAllJobs, deleteJob, toggleJobSaved } from '../services/jobService';
import type { Job } from '../types';

interface DashboardProps {
  refreshTrigger: number;
}

export function Dashboard({ refreshTrigger }: DashboardProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [savedFilter, setSavedFilter] = useState(false);
  const [sortBy, setSortBy] = useState('date-desc');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const jobListRef = useRef<HTMLDivElement>(null);
  const pageSize = 20;

  const loadJobs = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      const fetchedJobs = await getAllJobs(forceRefresh);
      setJobs(fetchedJobs);
      setError(null);
    } catch (err) {
      console.error('Error loading jobs:', err);
      setError('Failed to load jobs. Check Firebase configuration.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshTriggerRef = useRef(refreshTrigger);
  useEffect(() => {
    // Force refresh when refreshTrigger changes (after email fetch), use cache on initial mount
    const forceRefresh = refreshTriggerRef.current !== refreshTrigger;
    refreshTriggerRef.current = refreshTrigger;
    loadJobs(forceRefresh);
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
    setSortBy('date-desc');
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
      switch (sortBy) {
        case 'date-desc': return new Date(b.dateReceived || 0).getTime() - new Date(a.dateReceived || 0).getTime();
        case 'date-asc': return new Date(a.dateReceived || 0).getTime() - new Date(b.dateReceived || 0).getTime();
        case 'title-asc': return (a.title || '').localeCompare(b.title || '');
        case 'title-desc': return (b.title || '').localeCompare(a.title || '');
        case 'company-asc': return (a.company || '').localeCompare(b.company || '');
        default: return 0;
      }
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

  const handleCopy = async (job: Job) => {
    if (job.url) {
      await navigator.clipboard.writeText(job.url);
      setCopiedId(job.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
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
          {['junior', 'entry level', 'intern', 'remote', 'developer', 'it support'].map(tag => (
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
                  <div key={job.id} className={`job-card ${selectedIds.has(job.id) ? 'selected' : ''}`}>
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
                          {job.url && (
                            <a href={job.url} target="_blank" rel="noopener noreferrer" className="card-icon-btn card-btn-view" title="Open link">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            </a>
                          )}
                          <button
                            className={`card-icon-btn card-btn-copy ${copiedId === job.id ? 'copied' : ''}`}
                            onClick={() => handleCopy(job)}
                            disabled={!job.url}
                            title={copiedId === job.id ? 'Copied!' : 'Copy link'}
                          >
                            {copiedId === job.id
                              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            }
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
                        {job.source && (
                          <button className={`source-tag ${getSourceBadgeClass(job.source)}`} onClick={() => setSourceFilter(job.source)}>
                            {job.source}
                          </button>
                        )}
                        {job.type && (
                          <button className={`type-badge ${getTypeBadgeClass(job.type)}`} onClick={() => setTypeFilter(job.type)}>{job.type}</button>
                        )}
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
                      </div>
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
