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
}

export class GoogleDomainAuthError extends Error {
  hostname: string;
  projectId: string;
  authorizedDomains: string[];

  constructor(hostname: string, projectId: string, authorizedDomains: string[]) {
    super(
      `Google Sign-In is not authorized for "${hostname}". Paste a link-shared Google Sheet URL in Option 1, or open the app on an authorized domain.`
    );
    this.name = 'GoogleDomainAuthError';
    this.hostname = hostname;
    this.projectId = projectId;
    this.authorizedDomains = authorizedDomains;
  }
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({ prompt: 'select_account' });

// Flag to indicate an active sign-in flow
let isSigningIn = false;
// Strictly in-memory OAuth access token cache (never persisted to localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

function toProfile(user: User): GoogleAccountProfile {
  return {
    displayName: user.displayName,
    email: user.email,
  };
}

async function fetchAuthorizedDomainsBestEffort(): Promise<string[]> {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(
        firebaseConfig.apiKey
      )}`
    );
    if (res.ok) {
      const data = (await res.json()) as { authorizedDomains?: string[] };
      if (Array.isArray(data.authorizedDomains)) {
        return data.authorizedDomains;
      }
    }
  } catch {
    // Ignore network errors when fetching diagnostic metadata
  }
  return [];
}

/**
 * Initialize Firebase Auth state listener. Call on app load.
 * Clears the in-memory OAuth access token whenever the user signs out.
 */
export const initAuth = (
  onAuthSuccess?: (user: GoogleAccountProfile, token: string) => void,
  onAuthFailure?: (user: GoogleAccountProfile | null) => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      const profile = toProfile(user);
      if (cachedAccessToken) {
        onAuthSuccess?.(profile, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.(profile);
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.(null);
    }
  });
};

/**
 * Sign in via Firebase Auth Google popup (routes through firebaseapp.com authDomain,
 * preventing OAuth 2.0 JavaScript origin_mismatch errors).
 * Must be invoked directly from a user click handler.
 */
export const googleSignIn = async (): Promise<{
  user: GoogleAccountProfile;
  accessToken: string;
}> => {
  const hostname = window.location.hostname;

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Could not obtain Google Drive & Sheets permission. Please try signing in again.'
      );
    }

    cachedAccessToken = credential.accessToken;
    return {
      user: toProfile(result.user),
      accessToken: cachedAccessToken,
    };
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    const msg = error instanceof Error ? error.message : String(error);

    if (code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain')) {
      const domains = await fetchAuthorizedDomainsBestEffort();
      throw new GoogleDomainAuthError(hostname, firebaseConfig.projectId, domains);
    }

    if (code === 'auth/popup-blocked') {
      throw new Error(
        'The Google Sign-In popup was blocked by your browser. Please allow popups for this site and try again, or paste a shared Google Sheet link in Option 1.'
      );
    }

    if (code === 'auth/operation-not-supported-in-this-environment') {
      throw new Error(
        'Google Sign-In popups are not supported in this embedded browser mode. Open the app in a standard browser tab, or paste a shared Google Sheet link in Option 1.'
      );
    }

    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('popup-closed-by-user');
    }

    throw error instanceof Error ? error : new Error('Google sign-in failed.');
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => cachedAccessToken;

export const clearAccessToken = (): void => {
  cachedAccessToken = null;
};

export const googleSignOut = async (): Promise<void> => {
  cachedAccessToken = null;
  await auth.signOut().catch(() => {});
};
