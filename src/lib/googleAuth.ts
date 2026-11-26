import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
] as const;

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

const resolvedFirebaseConfig = {
  apiKey: env?.VITE_FIREBASE_API_KEY || firebaseConfig?.apiKey || '',
  authDomain: env?.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig?.authDomain || '',
  projectId: env?.VITE_FIREBASE_PROJECT_ID || firebaseConfig?.projectId || '',
  storageBucket: env?.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig?.storageBucket || '',
  messagingSenderId:
    env?.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig?.messagingSenderId || '',
  appId: env?.VITE_FIREBASE_APP_ID || firebaseConfig?.appId || '',
};

export const isGoogleOAuthConfigured = Boolean(
  resolvedFirebaseConfig.apiKey &&
    resolvedFirebaseConfig.authDomain &&
    resolvedFirebaseConfig.projectId
);

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

if (isGoogleOAuthConfigured) {
  firebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp(resolvedFirebaseConfig);
  firebaseAuth = getAuth(firebaseApp);
}

const googleProvider = new GoogleAuthProvider();
for (const scope of GOOGLE_OAUTH_SCOPES) {
  googleProvider.addScope(scope);
}
// Allow staff sharing a POS device to always choose which Google account to sign in with
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Keep Google OAuth access token strictly in memory (never in localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export interface GoogleSignInResult {
  user: User;
  accessToken: string | null;
}

/**
 * Initializes Firebase Auth state listener and clears in-memory access token on sign-out.
 */
export function initGoogleAuthListener(
  onSignedIn: (user: User, accessToken: string | null) => void,
  onSignedOut: () => void
): () => void {
  if (!firebaseAuth) {
    onSignedOut();
    return () => {};
  }

  return onAuthStateChanged(firebaseAuth, (user) => {
    if (user) {
      if (!isSigningIn) {
        onSignedIn(user, cachedAccessToken);
      }
    } else {
      cachedAccessToken = null;
      onSignedOut();
    }
  });
}

/**
 * Triggers the Google OAuth popup sign-in flow. Must be invoked from a direct user click.
 */
export async function signInWithGooglePopup(): Promise<GoogleSignInResult> {
  if (!firebaseAuth) {
    throw new Error('Layanan Google Sign-In belum dikonfigurasi pada aplikasi ini.');
  }

  try {
    isSigningIn = true;
    const result = await signInWithPopup(firebaseAuth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken ?? null;
    return {
      user: result.user,
      accessToken: cachedAccessToken,
    };
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

export async function signOutGoogle(): Promise<void> {
  cachedAccessToken = null;
  if (firebaseAuth) {
    await signOut(firebaseAuth);
  }
}
