import { useState, useCallback, useEffect } from 'react';
import { GmailAuthProvider } from './context/GmailAuthContext';
import { GmailConnectButton } from './components/gmail/GmailConnectButton';
import { FetchEmailsPanel } from './components/gmail/FetchEmailsPanel';
import { Dashboard } from './components/Dashboard';
import { ApplicationsView } from './components/PipelineView';
import { Settings } from './components/Settings';
import { ParserDebugModal } from './components/ParserDebugModal';
import { getSettings } from './services/settingsService';
import { getAllJobs } from './services/jobService';
import { useGmailAuth } from './hooks/useGmailAuth';
import './App.css';

function AppContent() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showApplications, setShowApplications] = useState(false);
  const [applicationsCount, setApplicationsCount] = useState(0);
  const { isSignedIn } = useGmailAuth();

  // Apply theme to <html> element
  useEffect(() => {
    const { theme } = getSettings();
    const applyTheme = (resolvedTheme: 'light' | 'dark') => {
      document.documentElement.dataset.theme = resolvedTheme;
    };

    if (theme === 'dark') {
      applyTheme('dark');
    } else if (theme === 'light') {
      applyTheme('light');
    } else {
      // auto: follow system preference
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mq.matches ? 'dark' : 'light');
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [refreshTrigger]);

  const handleFetchComplete = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  const handleSettingsSaved = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  const refreshCount = useCallback(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    getAllJobs().then(jobs => {
      setApplicationsCount(
        jobs.filter(j => {
          const stage = j.applicationStage ?? (j.applied ? 'applied' : j.saved ? 'saved' : null);
          if (!stage || stage === 'saved' || stage === 'rejected') return false;
          const date = j.stageDate
            ? new Date(j.stageDate).getTime()
            : j.dateReceived
              ? new Date(j.dateReceived).getTime()
              : j.createdAt?.toMillis?.() ?? 0;
          return date >= cutoff;
        }).length
      );
    }).catch(err => console.error('[App] applicationsCount fetch failed:', err));
  }, []);

  useEffect(() => { refreshCount(); }, [refreshTrigger, refreshCount]);

  // Triggers both a Dashboard reload and badge count refresh
  const handleJobsChanged = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  return (
    <div className="app-layout">
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-inner">
          <div className="navbar-brand">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
            </svg>
            <span>Gmail Job Parser</span>
          </div>
          <div className="navbar-actions">
            <FetchEmailsPanel onFetchComplete={handleFetchComplete} />
            {isSignedIn && (
              <button
                className="nav-btn nav-btn-outline"
                onClick={() => setShowDebug(true)}
                title="Parser Debugger"
              >
                Debug
              </button>
            )}
            <GmailConnectButton />
            <button
              className={`nav-btn nav-btn-applications${showApplications ? ' active' : ''}`}
              onClick={() => setShowApplications(true)}
            >
              Applications
              {applicationsCount > 0 && (
                <span className="nav-tab-badge">{applicationsCount}</span>
              )}
            </button>
            <button
              className="nav-btn-settings"
              onClick={() => setShowSettings(true)}
              title="Settings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        <Dashboard refreshTrigger={refreshTrigger} onJobsChanged={handleJobsChanged} />
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onSettingsSaved={handleSettingsSaved}
        />
      )}

      {/* Applications Fullscreen Modal */}
      {showApplications && (
        <div className="modal-overlay applications-modal-overlay" onClick={() => setShowApplications(false)}>
          <div className="applications-modal" onClick={e => e.stopPropagation()}>
            <div className="applications-modal-header">
              <div>
                <div className="modal-title">Applications</div>
                <div className="applications-modal-subtitle">Track and manage all your job applications in one place.</div>
              </div>
              <button className="modal-close" onClick={() => setShowApplications(false)}>&times;</button>
            </div>
            <div className="applications-modal-body">
              <ApplicationsView refreshTrigger={refreshTrigger} onJobsChanged={handleJobsChanged} />
            </div>
          </div>
        </div>
      )}

      {/* Parser Debug Modal */}
      {showDebug && (
        <ParserDebugModal onClose={() => setShowDebug(false)} />
      )}
    </div>
  );
}

function App() {
  return (
    <GmailAuthProvider>
      <AppContent />
    </GmailAuthProvider>
  );
}

export default App;
