import { createContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { GMAIL_CONFIG } from '../config/gmail';

const TOKEN_KEY = 'gmail_access_token';
const TOKEN_EXPIRY_KEY = 'gmail_token_expiry';

interface GmailAuthState {
  isSignedIn: boolean;
  isLoading: boolean;
  accessToken: string | null;
  error: string | null;
}

interface GmailAuthContextType extends GmailAuthState {
  signIn: () => void;
  signOut: () => void;
}

export const GmailAuthContext = createContext<GmailAuthContextType>({
  isSignedIn: false,
  isLoading: true,
  accessToken: null,
  error: null,
  signIn: () => {},
  signOut: () => {},
});

function saveToken(accessToken: string, expiresIn: number) {
  sessionStorage.setItem(TOKEN_KEY, accessToken);
  sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
}

function loadToken(): string | null {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiry = sessionStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() > Number(expiry)) {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
    return null;
  }
  return token;
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
}

export function GmailAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GmailAuthState>({
    isSignedIn: false,
    isLoading: true,
    accessToken: null,
    error: null,
  });
  const [tokenClient, setTokenClient] = useState<TokenClient | null>(null);

  useEffect(() => {
    const initGapi = () => {
      gapi.load('client', async () => {
        try {
          await gapi.client.init({
            discoveryDocs: GMAIL_CONFIG.discoveryDocs,
          });

          // Restore saved token if still valid
          const savedToken = loadToken();
          if (savedToken) {
            gapi.client.setToken({ access_token: savedToken });
            setState({
              isSignedIn: true,
              isLoading: false,
              accessToken: savedToken,
              error: null,
            });
          }

          const client = google.accounts.oauth2.initTokenClient({
            client_id: GMAIL_CONFIG.clientId,
            scope: GMAIL_CONFIG.scopes,
            callback: (response) => {
              if (response.error) {
                setState(prev => ({
                  ...prev,
                  isLoading: false,
                  error: response.error ?? 'Auth failed',
                }));
                return;
              }
              saveToken(response.access_token, response.expires_in);
              setState({
                isSignedIn: true,
                isLoading: false,
                accessToken: response.access_token,
                error: null,
              });
            },
          });

          setTokenClient(client);
          if (!savedToken) {
            setState(prev => ({ ...prev, isLoading: false }));
          }
        } catch (err) {
          setState(prev => ({
            ...prev,
            isLoading: false,
            error: 'Failed to initialize Gmail API',
          }));
          console.error('Gmail API init error:', err);
        }
      });
    };

    if (typeof gapi !== 'undefined') {
      initGapi();
    } else {
      const interval = setInterval(() => {
        if (typeof gapi !== 'undefined') {
          clearInterval(interval);
          initGapi();
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, []);

  const signIn = useCallback(() => {
    if (tokenClient) {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    }
  }, [tokenClient]);

  const signOut = useCallback(() => {
    const token = gapi.client.getToken();
    if (token) {
      google.accounts.oauth2.revoke(token.access_token);
      gapi.client.setToken(null);
    }
    clearToken();
    setState({
      isSignedIn: false,
      isLoading: false,
      accessToken: null,
      error: null,
    });
  }, []);

  return (
    <GmailAuthContext.Provider value={{ ...state, signIn, signOut }}>
      {children}
    </GmailAuthContext.Provider>
  );
}
