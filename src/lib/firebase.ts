import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, push, set, remove, update, query, orderByChild, orderByKey, equalTo, get, runTransaction, limitToLast, limitToFirst, startAfter, startAt, endAt } from "firebase/database";
import { getAuth, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, confirmPasswordReset, updatePassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyASjrQM27mfAbHXA9ZqYv3YbubZPUxOR50",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "animeverse-d7b79.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "animeverse-d7b79",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "animeverse-d7b79.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1050779978318",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1050779978318:web:8bc00ed477bec7a14f511f",
  measurementId: "G-GWGVY15T2V"
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
