import { useState, useEffect, useCallback } from 'react';
import { useGmailAuth } from '../../hooks/useGmailAuth';
import { useFetchEmails } from '../../hooks/useFetchEmails';
import { DEFAULT_SENDERS } from '../../config/gmail';
import { listLabels } from '../../services/gmailService';
import type { GmailLabel } from '../../types';

interface FetchEmailsPanelProps {
  onFetchComplete: () => void;
}

const SYSTEM_FOLDERS = ['INBOX', 'SENT', 'TRASH', 'SPAM', 'DRAFT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'];

function getTodayString(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function formatFolderName(id: string): string {
  return id
    .replace('CATEGORY_', '')
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase());
}

export function FetchEmailsPanel({ onFetchComplete }: FetchEmailsPanelProps) {
  const { isSignedIn } = useGmailAuth();
  const { progress, isFetching, fetchEmails, stopFetching } = useFetchEmails();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [senders, setSenders] = useState<string[]>([...DEFAULT_SENDERS]);
  const [newSender, setNewSender] = useState('');
  const [afterDate, setAfterDate] = useState(getTodayString);
  const [beforeDate, setBeforeDate] = useState(getTodayString);
  const [folder, setFolder] = useState('INBOX');
  const [label, setLabel] = useState('');
  const [shouldArchive, setShouldArchive] = useState(true);

  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [labelsLoaded, setLabelsLoaded] = useState(false);

  const loadLabels = useCallback(async () => {
    if (labelsLoaded) return;
    try {
      const allLabels = await listLabels();
      setLabels(allLabels);
      setLabelsLoaded(true);
    } catch (err) {
      console.error('Failed to load labels:', err);
    }
  }, [labelsLoaded]);

  useEffect(() => {
    if (isModalOpen && !labelsLoaded) {
      loadLabels();
    }
  }, [isModalOpen, labelsLoaded, loadLabels]);

  const folderLabels = labels.filter(l => SYSTEM_FOLDERS.includes(l.id));
  const userLabels = labels.filter(l => l.type === 'user');

  const handleAddSender = () => {
    const trimmed = newSender.trim().toLowerCase();
    if (trimmed && !senders.includes(trimmed)) {
      setSenders(prev => [...prev, trimmed]);
      setNewSender('');
    }
  };

  const handleRemoveSender = (email: string) => {
    setSenders(prev => prev.filter(s => s !== email));
  };

  const handleSenderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSender();
    }
  };

  const openModal = () => {
    setAfterDate(getTodayString());
    setBeforeDate(getTodayString());
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (!isFetching) {
      setIsModalOpen(false);
    }
  };

  const handleFetch = async () => {
    await fetchEmails({
      senders,
      afterDate: afterDate || undefined,
      beforeDate: beforeDate || undefined,
      label: label || undefined,
      folder: folder || undefined,
      shouldArchive,
    });
    onFetchComplete();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isFetching) {
      closeModal();
    }
  };

  if (!isSignedIn) return null;

  const progressPercent =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <>
      <button className="nav-btn nav-btn-accent" onClick={openModal}>
        Fetch Emails
      </button>

      {isModalOpen && (
        <div className="modal-overlay" onClick={handleOverlayClick}>
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Fetch Settings</h3>
              <button
                className="modal-close"
                onClick={closeModal}
                disabled={isFetching}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="modal-body">
              {/* Senders */}
              <div className="modal-section">
                <label className="modal-label">Senders</label>
                <div className="sender-chips">
                  {senders.map(email => (
                    <span key={email} className="sender-chip">
                      {email}
                      <button
                        className="sender-chip-remove"
                        onClick={() => handleRemoveSender(email)}
                        disabled={isFetching}
                        aria-label={`Remove ${email}`}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
                <div className="sender-add-row">
                  <input
                    type="email"
                    value={newSender}
                    onChange={e => setNewSender(e.target.value)}
                    onKeyDown={handleSenderKeyDown}
                    placeholder="Add sender email..."
                    className="modal-input"
                    disabled={isFetching}
                  />
                  <button
                    className="nav-btn nav-btn-outline modal-add-btn"
                    onClick={handleAddSender}
                    disabled={isFetching || !newSender.trim()}
                  >
                    + Add
                  </button>
                </div>
              </div>

              {/* Date Range */}
              <div className="modal-section">
                <label className="modal-label">Date Range</label>
                <div className="modal-date-row">
                  <input
                    type="date"
                    value={afterDate}
                    onChange={e => setAfterDate(e.target.value)}
                    className="modal-input"
                    disabled={isFetching}
                  />
                  <span className="modal-date-sep">to</span>
                  <input
                    type="date"
                    value={beforeDate}
                    onChange={e => setBeforeDate(e.target.value)}
                    className="modal-input"
                    disabled={isFetching}
                  />
                </div>
              </div>

              {/* Folder & Label */}
              <div className="modal-section modal-row">
                <div className="modal-field">
                  <label className="modal-label">Folder</label>
                  <select
                    value={folder}
                    onChange={e => setFolder(e.target.value)}
                    className="modal-select"
                    disabled={isFetching}
                  >
                    <option value="ALL_MAIL">All Mail</option>
                    {folderLabels.map(l => (
                      <option key={l.id} value={l.id}>
                        {formatFolderName(l.id)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="modal-field">
                  <label className="modal-label">Label</label>
                  <select
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                    className="modal-select"
                    disabled={isFetching}
                  >
                    <option value="">All Labels</option>
                    {userLabels.map(l => (
                      <option key={l.id} value={l.name}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Archive checkbox */}
              <div className="modal-section">
                <label className="modal-checkbox-label">
                  <input
                    type="checkbox"
                    checked={shouldArchive}
                    onChange={e => setShouldArchive(e.target.checked)}
                    disabled={isFetching}
                  />
                  Archive emails after fetching
                </label>
              </div>

              {/* Progress */}
              {(isFetching || progress.message) && (
                <div className="modal-progress">
                  {progress.total > 0 && progress.phase !== 'done' && (
                    <div className="modal-progress-bar">
                      <div
                        className="modal-progress-fill"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  )}
                  <span
                    className={`modal-progress-msg ${progress.phase === 'error' ? 'error' : ''}`}
                  >
                    {progress.message}
                  </span>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="nav-btn nav-btn-outline"
                onClick={closeModal}
                disabled={isFetching}
              >
                Cancel
              </button>
              {isFetching ? (
                <button className="nav-btn nav-btn-stop" onClick={stopFetching}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    stroke="none"
                  >
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                  Stop
                </button>
              ) : (
                <button
                  className="nav-btn nav-btn-accent"
                  onClick={handleFetch}
                  disabled={senders.length === 0}
                >
                  Fetch Emails
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
