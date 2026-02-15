import { useState, useEffect } from 'react';
import { getSettings, saveSettings, resetSettings } from '../services/settingsService';
import { deleteAllJobs, deleteReadJobs, markAllJobsRead, exportJobs, getAllJobs, updateJobBadges } from '../services/jobService';
import type { AppSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../types/settings';

interface SettingsProps {
  onClose: () => void;
  onSettingsSaved: () => void;
}

export function Settings({ onClose, onSettingsSaved }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);
  const [newBadge, setNewBadge] = useState('');
  const [customBadgeCategory, setCustomBadgeCategory] = useState<keyof AppSettings['customBadges']>('responsibilities');
  const [bulkActionStatus, setBulkActionStatus] = useState('');
  const [isBulkRunning, setIsBulkRunning] = useState(false);

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  const handleChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    saveSettings(settings);
    setHasChanges(false);
    onSettingsSaved();
    onClose();
  };

  const handleReset = () => {
    if (confirm('Reset all settings to defaults?')) {
      resetSettings();
      setSettings(DEFAULT_SETTINGS);
      setHasChanges(true);
    }
  };

  const handleCancel = () => {
    if (hasChanges) {
      if (confirm('Discard unsaved changes?')) onClose();
    } else {
      onClose();
    }
  };

  // Custom badges
  const addCustomBadge = () => {
    const trimmed = newBadge.trim();
    if (!trimmed || settings.customBadges[customBadgeCategory].includes(trimmed)) return;
    handleChange('customBadges', {
      ...settings.customBadges,
      [customBadgeCategory]: [...settings.customBadges[customBadgeCategory], trimmed],
    });
    setNewBadge('');
  };

  const removeCustomBadge = async (category: keyof AppSettings['customBadges'], badge: string) => {
    handleChange('customBadges', {
      ...settings.customBadges,
      [category]: settings.customBadges[category].filter(b => b !== badge),
    });
    // Remove this badge from all jobs that have it
    try {
      const allJobs = await getAllJobs();
      const affected = allJobs.filter(j => j.badges?.[category]?.includes(badge));
      for (const job of affected) {
        await updateJobBadges(job.id, {
          ...job.badges!,
          [category]: job.badges![category].filter(b => b !== badge),
        });
      }
      if (affected.length > 0) {
        onSettingsSaved();
      }
    } catch (err) {
      console.error('Error removing badge from jobs:', err);
    }
  };

  // Bulk actions
  const runBulkAction = async (action: () => Promise<number | string>, successMsg: (result: number | string) => string) => {
    setIsBulkRunning(true);
    setBulkActionStatus('Processing...');
    try {
      const result = await action();
      setBulkActionStatus(successMsg(result));
      onSettingsSaved();
    } catch (err) {
      setBulkActionStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsBulkRunning(false);
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    setIsBulkRunning(true);
    setBulkActionStatus('Exporting...');
    try {
      const data = await exportJobs(format);
      const blob = new Blob([data], { type: format === 'json' ? 'application/json' : 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jobs-export-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setBulkActionStatus(`Exported successfully as ${format.toUpperCase()}`);
    } catch (err) {
      setBulkActionStatus(`Export error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsBulkRunning(false);
    }
  };

  const categoryLabel = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Settings</h2>
          <button className="modal-close" onClick={handleCancel}>&times;</button>
        </div>

        <div className="settings-body">
          {/* ===== Display Settings ===== */}
          <section className="settings-section">
            <h3 className="settings-section-title">Display</h3>

            <div className="settings-field">
              <label className="settings-label">Jobs per page</label>
              <select
                className="settings-select"
                value={settings.jobsPerPage}
                onChange={e => handleChange('jobsPerPage', Number(e.target.value))}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="settings-field">
              <label className="settings-label">Default view</label>
              <select
                className="settings-select"
                value={settings.defaultView}
                onChange={e => handleChange('defaultView', e.target.value as AppSettings['defaultView'])}
              >
                <option value="unread">Unread Jobs</option>
                <option value="read">Read Jobs</option>
                <option value="all">All Jobs</option>
              </select>
            </div>

            <div className="settings-field">
              <label className="settings-label">Default sort</label>
              <select
                className="settings-select"
                value={settings.defaultSort}
                onChange={e => handleChange('defaultSort', e.target.value as AppSettings['defaultSort'])}
              >
                <option value="none">Default Order</option>
                <option value="date-desc">Most Recent</option>
                <option value="date-asc">Oldest First</option>
                <option value="title-asc">Title A-Z</option>
                <option value="title-desc">Title Z-A</option>
                <option value="company-asc">Company A-Z</option>
              </select>
            </div>
          </section>


          {/* ===== Job Management ===== */}
          <section className="settings-section">
            <h3 className="settings-section-title">Job Management</h3>

            <div className="settings-field">
              <label className="settings-label">Auto-mark as read after (days)</label>
              <div className="settings-inline">
                <input
                  type="number"
                  className="settings-input settings-input-sm"
                  min="0"
                  max="365"
                  value={settings.autoMarkReadAfterDays}
                  onChange={e => handleChange('autoMarkReadAfterDays', Number(e.target.value))}
                />
                <span className="settings-hint">0 = never</span>
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-label">Auto-delete jobs after (days)</label>
              <div className="settings-inline">
                <input
                  type="number"
                  className="settings-input settings-input-sm"
                  min="0"
                  max="365"
                  value={settings.autoDeleteAfterDays}
                  onChange={e => handleChange('autoDeleteAfterDays', Number(e.target.value))}
                />
                <span className="settings-hint">0 = never</span>
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-label">Bulk actions</label>
              <div className="settings-bulk-actions">
                <button
                  className="settings-btn settings-btn-bulk"
                  disabled={isBulkRunning}
                  onClick={() => {
                    if (confirm('Mark ALL jobs as read? This cannot be undone.')) {
                      runBulkAction(markAllJobsRead, (n) => `${n} jobs marked as read`);
                    }
                  }}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  Mark All as Read
                </button>
                <button
                  className="settings-btn settings-btn-bulk settings-btn-warn"
                  disabled={isBulkRunning}
                  onClick={() => {
                    if (confirm('Delete all READ jobs? This cannot be undone.')) {
                      runBulkAction(deleteReadJobs, (n) => `${n} read jobs deleted`);
                    }
                  }}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Clear Read Jobs
                </button>
                <button
                  className="settings-btn settings-btn-bulk settings-btn-danger"
                  disabled={isBulkRunning}
                  onClick={() => {
                    if (confirm('DELETE ALL JOBS? This action is irreversible!')) {
                      if (confirm('Are you absolutely sure? All job data will be permanently lost.')) {
                        runBulkAction(deleteAllJobs, (n) => `${n} jobs deleted`);
                      }
                    }
                  }}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Clear All Jobs
                </button>
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-label">Export</label>
              <div className="settings-bulk-actions">
                <button
                  className="settings-btn settings-btn-bulk"
                  disabled={isBulkRunning}
                  onClick={() => handleExport('csv')}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export CSV
                </button>
                <button
                  className="settings-btn settings-btn-bulk"
                  disabled={isBulkRunning}
                  onClick={() => handleExport('json')}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export JSON
                </button>
              </div>
              {bulkActionStatus && (
                <span className={`settings-bulk-status ${bulkActionStatus.startsWith('Error') ? 'error' : ''}`}>
                  {bulkActionStatus}
                </span>
              )}
            </div>
          </section>

          {/* ===== Badge Settings ===== */}
          <section className="settings-section">
            <h3 className="settings-section-title">Badge Settings</h3>

            <div className="settings-field">
              <label className="settings-label">Badge category visibility</label>
              <div className="settings-checkbox-group">
                {Object.entries(settings.badgeVisibility).map(([key, value]) => (
                  <label key={key} className="settings-checkbox-label">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={e => handleChange('badgeVisibility', {
                        ...settings.badgeVisibility,
                        [key]: e.target.checked,
                      })}
                    />
                    <span>{categoryLabel(key)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-label">Custom badges</label>
              {(['responsibilities', 'qualifications', 'skills', 'benefits'] as const).map(cat => (
                <div key={cat} className="settings-custom-badge-cat">
                  <span className="settings-custom-badge-cat-title">{categoryLabel(cat)}</span>
                  <div className="settings-chips">
                    {settings.customBadges[cat].map(badge => (
                      <span key={badge} className="settings-chip">
                        {badge}
                        <button className="settings-chip-remove" onClick={() => removeCustomBadge(cat, badge)}>&times;</button>
                      </span>
                    ))}
                    {settings.customBadges[cat].length === 0 && (
                      <span className="settings-hint-inline">None</span>
                    )}
                  </div>
                </div>
              ))}
              <div className="settings-add-row">
                <select
                  className="settings-select settings-select-sm"
                  value={customBadgeCategory}
                  onChange={e => setCustomBadgeCategory(e.target.value as keyof AppSettings['customBadges'])}
                >
                  <option value="responsibilities">Responsibilities</option>
                  <option value="qualifications">Qualifications</option>
                  <option value="skills">Skills</option>
                  <option value="benefits">Benefits</option>
                </select>
                <input
                  type="text"
                  className="settings-input"
                  placeholder="New badge name"
                  value={newBadge}
                  onChange={e => setNewBadge(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustomBadge()}
                />
                <button className="settings-btn settings-btn-add" onClick={addCustomBadge}>Add</button>
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.autoSuggestBadges}
                  onChange={e => handleChange('autoSuggestBadges', e.target.checked)}
                />
                <span>Enable AI badge suggestions (experimental)</span>
              </label>
              <span className="settings-hint">When enabled, badges will be auto-suggested based on job description content. Coming soon.</span>
            </div>
          </section>
        </div>

        <div className="settings-footer">
          <button className="settings-btn settings-btn-reset" onClick={handleReset}>
            Reset to Defaults
          </button>
          <div className="settings-footer-right">
            <button className="settings-btn settings-btn-cancel" onClick={handleCancel}>
              Cancel
            </button>
            <button className="settings-btn settings-btn-save" onClick={handleSave} disabled={!hasChanges}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
