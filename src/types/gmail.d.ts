/* eslint-disable @typescript-eslint/no-explicit-any */

declare namespace gapi {
  function load(apiName: string, callback: () => void): void;

  namespace client {
    function init(config: Record<string, any>): Promise<void>;
    function setToken(token: { access_token: string } | null): void;
    function getToken(): { access_token: string } | null;

    namespace gmail {
      namespace users {
        namespace messages {
          function list(params: {
            userId: string;
            q?: string;
            maxResults?: number;
            pageToken?: string;
          }): Promise<{
            result: {
              messages?: Array<{ id: string; threadId: string }>;
              nextPageToken?: string;
              resultSizeEstimate?: number;
            };
          }>;

          function get(params: {
            userId: string;
            id: string;
            format?: string;
          }): Promise<{
            result: import('./index').GmailMessage;
          }>;

          function modify(params: {
            userId: string;
            id: string;
            resource: {
              addLabelIds?: string[];
              removeLabelIds?: string[];
            };
          }): Promise<{ result: any }>;
        }

        namespace labels {
          function list(params: {
            userId: string;
          }): Promise<{
            result: {
              labels?: Array<{
                id: string;
                name: string;
                type: 'system' | 'user';
                messageListVisibility?: string;
                labelListVisibility?: string;
              }>;
            };
          }>;
        }
      }
    }
  }
}

interface TokenClient {
  requestAccessToken(config?: { prompt?: string }): void;
  callback: (response: google.accounts.oauth2.TokenResponse) => void;
}

declare namespace google {
  namespace accounts {
    namespace oauth2 {
      interface TokenResponse {
        access_token: string;
        expires_in: number;
        scope: string;
        token_type: string;
        error?: string;
      }

      function initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
      }): TokenClient;

      function revoke(token: string, callback?: () => void): void;
    }
  }
}
