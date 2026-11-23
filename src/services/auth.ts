import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

// Ensure Firebase Auth persists user session in IndexedDB/localStorage across browser restarts
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Firebase Auth persistence setup warning:', err);
});

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
];

const STORAGE_KEY_PERSISTENT_USER = 'seat_lookup_persistent_user_v1';
const STORAGE_KEY_EXPLICIT_LOGOUT = 'seat_lookup_explicit_logout_v1';
const DEFAULT_PERSISTENT_EMAIL = 'ubcyber@gmail.com';

export interface PersistentUserProfile {
  email: string;
  displayName: string;
  photoURL?: string | null;
  uid?: string;
  loggedInAt: string;
}

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the OAuth access token in memory only (never in localStorage/sessionStorage).
let cachedAccessToken: string | null = null;

export function getPersistentUser(): PersistentUserProfile | null {
  try {
    const explicitlyLoggedOut = localStorage.getItem(STORAGE_KEY_EXPLICIT_LOGOUT) === 'true';
    if (explicitlyLoggedOut) {
      return null;
    }

    const raw = localStorage.getItem(STORAGE_KEY_PERSISTENT_USER);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.email === 'string' && parsed.email.trim()) {
        return parsed as PersistentUserProfile;
      }
    }

    // Default permanent login session for the owner's email until explicitly logged out
    const defaultProfile: PersistentUserProfile = {
      email: DEFAULT_PERSISTENT_EMAIL,
      displayName: DEFAULT_PERSISTENT_EMAIL.split('@')[0],
      loggedInAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY_PERSISTENT_USER, JSON.stringify(defaultProfile));
    return defaultProfile;
  } catch {
    return {
      email: DEFAULT_PERSISTENT_EMAIL,
      displayName: DEFAULT_PERSISTENT_EMAIL.split('@')[0],
      loggedInAt: new Date().toISOString(),
    };
  }
}

export function savePersistentUser(userOrProfile: User | PersistentUserProfile): PersistentUserProfile {
  const profile: PersistentUserProfile = {
    email: userOrProfile.email || DEFAULT_PERSISTENT_EMAIL,
    displayName:
      userOrProfile.displayName ||
      (userOrProfile.email ? userOrProfile.email.split('@')[0] : 'Admin'),
    photoURL: userOrProfile.photoURL || null,
    uid: 'uid' in userOrProfile ? userOrProfile.uid : undefined,
    loggedInAt: new Date().toISOString(),
  };

  try {
    localStorage.removeItem(STORAGE_KEY_EXPLICIT_LOGOUT);
    localStorage.setItem(STORAGE_KEY_PERSISTENT_USER, JSON.stringify(profile));
  } catch (e) {
    console.error('Failed to save persistent user profile:', e);
  }
  return profile;
}

export const initAuth = (
  onAuthSuccess?: (profile: PersistentUserProfile, hasDriveToken: boolean) => void,
  onLoggedOut?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    const explicitlyLoggedOut =
      typeof window !== 'undefined' &&
      localStorage.getItem(STORAGE_KEY_EXPLICIT_LOGOUT) === 'true';

    if (user && !explicitlyLoggedOut) {
      const profile = savePersistentUser(user);
      if (onAuthSuccess) {
        onAuthSuccess(profile, Boolean(cachedAccessToken));
      }
      return;
    }

    if (!explicitlyLoggedOut) {
      const savedProfile = getPersistentUser();
      if (savedProfile) {
        if (onAuthSuccess) {
          onAuthSuccess(savedProfile, Boolean(cachedAccessToken));
        }
        return;
      }
    }

    if (!isSigningIn) {
      cachedAccessToken = null;
      if (onLoggedOut) onLoggedOut();
    }
  });
};

export const googleSignIn = async (options?: {
  loginHint?: string;
  forceAccountSelect?: boolean;
}): Promise<{ user: User; profile: PersistentUserProfile; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const provider = new GoogleAuthProvider();
    for (const scope of WORKSPACE_SCOPES) {
      provider.addScope(scope);
    }

    const savedProfile = getPersistentUser();
    const hintEmail =
      options?.loginHint ||
      auth.currentUser?.email ||
      savedProfile?.email ||
      DEFAULT_PERSISTENT_EMAIL;

    const customParams: Record<string, string> = {};
    if (options?.forceAccountSelect) {
      customParams.prompt = 'select_account';
    } else if (hintEmail) {
      customParams.login_hint = hintEmail;
    }
    provider.setCustomParameters(customParams);

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('ไม่สามารถดึง Access Token สำหรับ Google Drive ได้ กรุณาลองอีกครั้ง');
    }

    cachedAccessToken = credential.accessToken;
    const profile = savePersistentUser(result.user);
    return { user: result.user, profile, accessToken: cachedAccessToken };
  } catch (error: any) {
    // If the user closed the popup or cancelled the sign-in prompt, handle gracefully
    const errorCode = error?.code || '';
    if (
      errorCode === 'auth/popup-closed-by-user' ||
      errorCode === 'auth/cancelled-popup-request' ||
      errorCode === 'auth/user-cancelled'
    ) {
      return null;
    }
    console.error('Google Sign-In error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const hasActiveDriveToken = (): boolean => {
  return Boolean(cachedAccessToken);
};

export const clearAccessToken = () => {
  cachedAccessToken = null;
};

export const logout = async () => {
  try {
    localStorage.setItem(STORAGE_KEY_EXPLICIT_LOGOUT, 'true');
    localStorage.removeItem(STORAGE_KEY_PERSISTENT_USER);
  } catch {
    // ignore storage errors
  }
  cachedAccessToken = null;
  await auth.signOut().catch(() => {});
};
