import { useGmailAuth } from '../../hooks/useGmailAuth';

export function GmailConnectButton() {
  const { isSignedIn, isLoading, signIn, signOut } = useGmailAuth();

  if (isLoading) {
    return <button className="nav-btn nav-btn-outline" disabled>Loading...</button>;
  }

  if (isSignedIn) {
    return (
      <button className="nav-btn nav-btn-outline" onClick={signOut}>
        Disconnect Gmail
      </button>
    );
  }

  return (
    <button className="nav-btn nav-btn-accent" onClick={signIn}>
      Connect Gmail
    </button>
  );
}
