import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, push, set, remove, update, query, orderByChild, orderByKey, equalTo, get, runTransaction, limitToLast, limitToFirst, startAfter, startAt, endAt } from "firebase/database";
import { getAuth, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, confirmPasswordReset, updatePassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDIMMW8WMG8b_lAJfEcY0tpT9JnipyL3mc",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rs-anime-web.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://rs-anime-web-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rs-anime-web",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "rs-anime-web.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "856791666296",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:856791666296:web:9b769ba6d774734e0ce78d"
};

// Guard against Vite HMR re-initializing the app on every hot update.
// A second `initializeApp` call with the same name tears down the existing
// WebSocket and forces every listener to reconnect — which is exactly what
// the user was seeing as "Firebase disconnect after update".
const globalKey = "__rs_firebase_app__";
const g = globalThis as any;
const app = g[globalKey] || (g[globalKey] = initializeApp(firebaseConfig));

export const db = g.__rs_firebase_db__ || (g.__rs_firebase_db__ = getDatabase(app));
export const auth = g.__rs_firebase_auth__ || (g.__rs_firebase_auth__ = getAuth(app));
export const googleProvider = new GoogleAuthProvider();

export { ref, onValue, push, set, remove, update, query, orderByChild, orderByKey, equalTo, get, runTransaction, limitToLast, limitToFirst, startAfter, startAt, endAt, signInWithEmailAndPassword, signOut, signInWithPopup, sendPasswordResetEmail, confirmPasswordReset, updatePassword };
