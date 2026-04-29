import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { firebaseConfig, ADMIN_EMAILS } from '../config/firebase.config';

// ─── Initialize ────────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ─── Providers ─────────────────────────────────────────────────────────────────
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('profile');
googleProvider.addScope('email');

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Determine role from email */
export function getRoleFromEmail(email) {
  return ADMIN_EMAILS.includes(email?.toLowerCase()) ? 'admin' : 'user';
}

/** Normalise a Firebase User object to the app's user shape */
export function normaliseUser(firebaseUser) {
  if (!firebaseUser) return null;
  const providerData = firebaseUser.providerData?.[0];
  const provider =
    providerData?.providerId === 'google.com'
      ? 'google'
      : 'local';

  return {
    id: firebaseUser.uid,
    name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
    email: firebaseUser.email,
    avatar: firebaseUser.photoURL || null,
    role: getRoleFromEmail(firebaseUser.email),
    provider,
    emailVerified: firebaseUser.emailVerified,
  };
}

// ─── Firestore user sync ───────────────────────────────────────────────────────

/**
 * Upsert a user document in Firestore `users` collection.
 * Uses merge:true so existing fields are not overwritten on subsequent logins.
 */
async function upsertUserDoc(firebaseUser, extra = {}) {
  try {
    const role = getRoleFromEmail(firebaseUser.email);
    const now = new Date().toISOString();
    await setDoc(
      doc(db, 'users', firebaseUser.uid),
      {
        uid: firebaseUser.uid,
        email: firebaseUser.email || null,
        displayName: firebaseUser.displayName || null,
        avatar: firebaseUser.photoURL || null,
        role,
        emailVerified: firebaseUser.emailVerified ?? false,
        lastSignIn: now,
        ...extra,
      },
      { merge: true }
    );
  } catch (err) {
    // Non-fatal — auth still succeeds if Firestore write fails
    console.warn('[firebase] upsertUserDoc failed:', err.message);
  }
}

/** Public: sync any Firebase user to Firestore (called on session restore) */
export async function syncUserToFirestore(firebaseUser) {
  if (!firebaseUser) return;
  const provider = firebaseUser.providerData?.[0]?.providerId === 'google.com' ? 'google' : 'local';
  await upsertUserDoc(firebaseUser, { provider });
}

// ─── Auth actions ──────────────────────────────────────────────────────────────

/** Sign in with Google popup */
export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  await upsertUserDoc(result.user, { provider: 'google' });
  return normaliseUser(result.user);
}

/** Sign in with email + password */
export async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  await upsertUserDoc(result.user, { provider: 'local' });
  return normaliseUser(result.user);
}

/** Register with email + password + send verification email */
export async function registerWithEmail(name, email, password) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  const { updateProfile } = await import('firebase/auth');
  await updateProfile(result.user, { displayName: name });
  await sendEmailVerification(result.user, {
    url: `${window.location.origin}/login?verified=1`,
    handleCodeInApp: false,
  });
  // Write to Firestore — createdAt only set here (merge won't overwrite on future logins)
  await upsertUserDoc(
    { ...result.user, displayName: name },
    { provider: 'local', createdAt: new Date().toISOString() }
  );
  return normaliseUser({ ...result.user, displayName: name });
}

/** Resend verification email */
export async function resendVerificationEmail() {
  if (auth.currentUser) {
    await sendEmailVerification(auth.currentUser, {
      url: `${window.location.origin}/login?verified=1`,
      handleCodeInApp: false,
    });
  }
}

/** Send password reset email */
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email, {
    url: `${window.location.origin}/login`,
  });
}

/** Sign out */
export async function firebaseSignOut() {
  await signOut(auth);
}

/** Subscribe to auth state changes */
export { onAuthStateChanged };
