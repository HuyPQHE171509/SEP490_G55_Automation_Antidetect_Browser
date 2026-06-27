import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD6x7MTOjOsh_QCLy2NAxHEVM2FL3j1fbU",
  authDomain: "huymck-98553.firebaseapp.com",
  projectId: "huymck-98553",
  storageBucket: "huymck-98553.firebasestorage.app",
  messagingSenderId: "119485242404",
  appId: "1:119485242404:web:30cfa89fae7a7a3011ccb1",
  measurementId: "G-CY2C3RKY0Q"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

async function upsertUserDoc(firebaseUser, extra = {}) {
  if (!firebaseUser) return;
  try {
    const now = new Date().toISOString();
    await setDoc(
      doc(db, 'users', firebaseUser.uid),
      {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0],
        emailVerified: firebaseUser.emailVerified,
        lastSignIn: now,
        role: 'user',
        ...extra
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[firebase] upsertUserDoc failed:', err.message);
  }
}

export { auth, db, googleProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, upsertUserDoc };
