import { useGmailAuth } from '../../hooks/useGmailAuth';

const GmailIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
    <path d="M2 6C2 4.9 2.9 4 4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <path d="M2 6L12 13L22 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const DisconnectIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
    <path d="M2 6C2 4.9 2.9 4 4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <path d="M2 6L12 13L22 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M17 17L21 21M21 17L17 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export function GmailConnectButton() {
  const { isSignedIn, isLoading, signIn, signOut } = useGmailAuth();

  if (isLoading) {
    return <button className="nav-btn nav-btn-outline" disabled>Loading...</button>;
  }

  if (isSignedIn) {
    return (
      <button className="nav-btn nav-btn-outline" onClick={signOut} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <DisconnectIcon />
        Disconnect Gmail
      </button>
    );
  }

  return (
    <button className="nav-btn nav-btn-accent" onClick={signIn} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <GmailIcon />
      Connect Gmail
    </button>
  );
}
