import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, push, set, remove, update, query, orderByChild, equalTo, get, runTransaction, limitToLast, goOffline, goOnline } from "firebase/database";
import { getAuth, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, confirmPasswordReset, updatePassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCP5bfue5FOc0eTO4E52-0A0w3PppO3Mvw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rs-anime.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://rs-anime-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rs-anime",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "rs-anime.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "843989457516",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:843989457516:web:57e0577d092183eedd9649"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// ============================================================
// Connection watchdog — auto-reconnects when Firebase drops
// (common after admin updates, tab-sleep, or flaky networks).
// ============================================================
if (typeof window !== "undefined") {
  let disconnectedSince = 0;
  let recovering = false;
  const RECOVER_AFTER_MS = 8000;

  const forceReconnect = () => {
    if (recovering) return;
    recovering = true;
    try { goOffline(db); } catch {}
    setTimeout(() => {
      try { goOnline(db); } catch {}
      recovering = false;
    }, 400);
  };

  try {
    onValue(ref(db, ".info/connected"), (snap) => {
      const connected = !!snap.val();
      if (connected) {
        disconnectedSince = 0;
      } else if (!disconnectedSince) {
        disconnectedSince = Date.now();
        setTimeout(() => {
          if (disconnectedSince && Date.now() - disconnectedSince >= RECOVER_AFTER_MS) {
            forceReconnect();
          }
        }, RECOVER_AFTER_MS + 100);
      }
    });
  } catch {}

  // Nudge reconnection when the browser comes back online or the tab
  // becomes visible again.
  window.addEventListener("online", forceReconnect);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && disconnectedSince) {
      forceReconnect();
    }
  });
}

export { ref, onValue, push, set, remove, update, query, orderByChild, equalTo, get, runTransaction, limitToLast, goOffline, goOnline, signInWithEmailAndPassword, signOut, signInWithPopup, sendPasswordResetEmail, confirmPasswordReset, updatePassword };
