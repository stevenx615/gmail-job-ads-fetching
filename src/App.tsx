import { useState, useCallback } from 'react';
import { GmailAuthProvider } from './context/GmailAuthContext';
import { GmailConnectButton } from './components/gmail/GmailConnectButton';
import { FetchEmailsPanel } from './components/gmail/FetchEmailsPanel';
import { Dashboard } from './components/Dashboard';
import './App.css';

function AppContent() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleFetchComplete = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  return (
    <div className="app-layout">
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-inner">
          <div className="navbar-brand">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
            </svg>
            <span>Gmail Job Parser</span>
          </div>
          <div className="navbar-actions">
            <FetchEmailsPanel onFetchComplete={handleFetchComplete} />
            <GmailConnectButton />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        <Dashboard refreshTrigger={refreshTrigger} />
      </main>
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
