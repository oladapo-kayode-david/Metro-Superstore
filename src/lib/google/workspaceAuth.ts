import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
] as const;

export interface GoogleAccountProfile {
  displayName: string | null;
  email: string | null;
  authMethod: 'firebase' | 'gis';
}

export class GoogleDomainAuthError extends Error {
  hostname: string;
  projectId: string;
  authorizedDomains: string[];

  constructor(hostname: string, projectId: string, authorizedDomains: string[]) {
    super(
      `Google Sign-In is not authorized for "${hostname}". You can either paste a link-shared Google Sheet URL below or open the app from an authorized URL.`
    );
    this.name = 'GoogleDomainAuthError';
    this.hostname = hostname;
    this.projectId = projectId;
    this.authorizedDomains = authorizedDomains;
  }
}

interface GisTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleIdentityGlobal {
  accounts?: {
    oauth2?: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (resp: GisTokenResponse) => void;
        error_callback?: (err: { type?: string; message?: string }) => void;
      }) => GisTokenClient;
      revoke?: (token: string, done?: () => void) => void;
    };
  };
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

let isSigningIn = false;
// Strictly in-memory OAuth access token cache (never persisted to localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let cachedProfile: GoogleAccountProfile | null = null;
let cachedAuthorizedDomains: string[] | null = null;

function toProfile(user: User): GoogleAccountProfile {
  return {
    displayName: user.displayName,
    email: user.email,
    authMethod: 'firebase',
  };
}

function isHostnameAuthorized(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase();
  return domains.some((d) => {
    const clean = d.toLowerCase().trim();
    return host === clean || host.endsWith(`.${clean}`);
  });
}

/**
 * Pre-fetches the Firebase project's authorizedDomains list in the background so click handlers
 * know synchronously whether Firebase popup sign-in is permitted on the current hostname.
 */
async function prefetchFirebaseAuthorizedDomains(): Promise<string[]> {
  if (cachedAuthorizedDomains) return cachedAuthorizedDomains;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(
        firebaseConfig.apiKey
      )}`
    );
    if (res.ok) {
      const data = (await res.json()) as { authorizedDomains?: string[] };
      if (Array.isArray(data.authorizedDomains)) {
        cachedAuthorizedDomains = data.authorizedDomains;
        return cachedAuthorizedDomains;
      }
    }
  } catch {
    // Ignore network errors during background prefetch
  }
  return [];
}

function ensureGisScriptLoaded(): Promise<void> {
  const g = (window as unknown as { google?: GoogleIdentityGlobal }).google;
  if (g?.accounts?.oauth2?.initTokenClient) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="accounts.google.com/gsi/client"]'
    );
    if (existing) {
      let waited = 0;
      const poll = window.setInterval(() => {
        waited += 100;
        const ready = (window as unknown as { google?: GoogleIdentityGlobal }).google?.accounts
          ?.oauth2?.initTokenClient;
        if (ready) {
          window.clearInterval(poll);
          resolve();
        } else if (waited >= 6000) {
          window.clearInterval(poll);
          reject(new Error('Google Identity Services script did not finish loading.'));
        }
      }, 100);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Google Sign-In library.'));
    document.head.appendChild(script);
  });
}

async function fetchDriveUserProfile(accessToken: string): Promise<GoogleAccountProfile> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );
    if (res.ok) {
      const data = (await res.json()) as {
        user?: { displayName?: string; emailAddress?: string };
      };
      return {
        displayName: data.user?.displayName ?? 'Google Account',
        email: data.user?.emailAddress ?? null,
        authMethod: 'gis',
      };
    }
  } catch {
    // Fallback to generic label if Drive about lookup fails
  }
  return {
    displayName: 'Google Drive Connected',
    email: null,
    authMethod: 'gis',
  };
}

async function signInViaGis(): Promise<{ user: GoogleAccountProfile; accessToken: string }> {
  const clientId = (firebaseConfig as { oAuthClientId?: string }).oAuthClientId;
  if (!clientId) {
    throw new Error('Google OAuth Client ID is not configured.');
  }

  await ensureGisScriptLoaded();

  const oauth2 = (window as unknown as { google?: GoogleIdentityGlobal }).google?.accounts?.oauth2;
  if (!oauth2?.initTokenClient) {
    throw new Error('Google Sign-In client is unavailable in this browser.');
  }

  const accessToken = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES.join(' '),
      callback: (resp: GisTokenResponse) => {
        if (settled) return;
        settled = true;
        if (resp.access_token) {
          resolve(resp.access_token);
        } else {
          reject(
            new Error(
              resp.error_description ||
                resp.error ||
                'Google authorization was not granted.'
            )
          );
        }
      },
      error_callback: (err) => {
        if (settled) return;
        settled = true;
        if (err?.type === 'popup_closed') {
          reject(new Error('popup-closed-by-user'));
        } else if (err?.type === 'popup_failed_to_open') {
          reject(
            new Error(
              'Sign-in popup was blocked by the browser. Please allow popups for this site and click again.'
            )
          );
        } else {
          reject(new Error(err?.message || 'Google Sign-In failed.'));
        }
      },
    });

    client.requestAccessToken({ prompt: '' });
  });

  cachedAccessToken = accessToken;
  const profile = await fetchDriveUserProfile(accessToken);
  cachedProfile = profile;
  return { user: profile, accessToken };
}

export const initAuth = (
  onAuthSuccess?: (user: GoogleAccountProfile, token: string) => void,
  onAuthFailure?: (user: GoogleAccountProfile | null) => void
) => {
  // Warm up authorized domain list in background so sign-in never hits auth/unauthorized-domain
  void prefetchFirebaseAuthorizedDomains();

  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      const profile = toProfile(user);
      if (cachedAccessToken) {
        cachedProfile = profile;
        onAuthSuccess?.(profile, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        cachedProfile = profile;
        onAuthFailure?.(profile);
      }
    } else if (cachedAccessToken && cachedProfile?.authMethod === 'gis') {
      onAuthSuccess?.(cachedProfile, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      cachedProfile = null;
      onAuthFailure?.(null);
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: GoogleAccountProfile;
  accessToken: string;
}> => {
  const hostname = window.location.hostname;

  try {
    isSigningIn = true;

    // If we already know the current hostname is outside Firebase's authorizedDomains,
    // use Google Identity Services directly inside the user click gesture to avoid
    // Firebase: Error (auth/unauthorized-domain) and browser popup blocking.
    const firebaseAllowed =
      cachedAuthorizedDomains === null
        ? true
        : isHostnameAuthorized(hostname, cachedAuthorizedDomains);

    if (firebaseAllowed) {
      try {
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (!credential?.accessToken) {
          throw new Error(
            'Could not obtain Google Drive & Sheets permission. Please try signing in again.'
          );
        }
        cachedAccessToken = credential.accessToken;
        const profile = toProfile(result.user);
        cachedProfile = profile;
        return { user: profile, accessToken: cachedAccessToken };
      } catch (firebaseErr: unknown) {
        const code =
          typeof firebaseErr === 'object' && firebaseErr !== null && 'code' in firebaseErr
            ? String((firebaseErr as { code?: unknown }).code)
            : '';
        const msg = firebaseErr instanceof Error ? firebaseErr.message : String(firebaseErr);

        const isDomainOrEnvError =
          code === 'auth/unauthorized-domain' ||
          code === 'auth/operation-not-supported-in-this-environment' ||
          msg.includes('auth/unauthorized-domain');

        if (!isDomainOrEnvError) {
          throw firebaseErr;
        }

        // Fall back to Google Identity Services OAuth2 token client
        try {
          return await signInViaGis();
        } catch (gisErr) {
          const domains = await prefetchFirebaseAuthorizedDomains();
          const gisMsg = gisErr instanceof Error ? gisErr.message : '';
          if (gisMsg.includes('popup-closed-by-user')) {
            throw gisErr;
          }
          throw new GoogleDomainAuthError(hostname, firebaseConfig.projectId, domains);
        }
      }
    } else {
      try {
        return await signInViaGis();
      } catch (gisErr) {
        const gisMsg = gisErr instanceof Error ? gisErr.message : '';
        if (gisMsg.includes('popup-closed-by-user')) {
          throw gisErr;
        }
        throw new GoogleDomainAuthError(
          hostname,
          firebaseConfig.projectId,
          cachedAuthorizedDomains ?? []
        );
      }
    }
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => cachedAccessToken;

export const clearAccessToken = (): void => {
  cachedAccessToken = null;
};

export const googleSignOut = async (): Promise<void> => {
  const tokenToRevoke = cachedAccessToken;
  const method = cachedProfile?.authMethod;
  cachedAccessToken = null;
  cachedProfile = null;

  if (method === 'gis' && tokenToRevoke) {
    try {
      const oauth2 = (window as unknown as { google?: GoogleIdentityGlobal }).google?.accounts
        ?.oauth2;
      oauth2?.revoke?.(tokenToRevoke);
    } catch {
      // ignore revoke errors
    }
  }
  await auth.signOut().catch(() => {});
};
