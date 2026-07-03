import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, push, set, remove, update, query, orderByChild, equalTo, get, runTransaction, goOnline, goOffline } from "firebase/database";
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

// ---- Firebase RTDB connection watchdog ----
// Live domain-এ Firebase মাঝে মাঝে disconnect হয়ে যায় (tab throttle, network switch,
// browser websocket idle timeout)। এই watchdog visibility/online/connection-loss
// event-এ automatic reconnect করে যাতে সব স্ক্রিন frozen না থাকে।
if (typeof window !== "undefined") {
  let reconnectTimer: number | null = null;
  const kick = (delay = 0) => {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      try { goOffline(db); } catch {}
      try { goOnline(db); } catch {}
      reconnectTimer = null;
    }, delay);
  };

  // .info/connected listen করে, disconnect হলে ২ সেকেন্ড পরে reconnect trigger।
  try {
    onValue(ref(db, ".info/connected"), (snap) => {
      const connected = snap.val() === true;
      if (!connected) kick(2000);
    });
  } catch {}

  // Tab visible হলে সাথে সাথে reconnect চেষ্টা।
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick(0);
  });

  // Network এলে reconnect, গেলে সাফভাবে offline।
  window.addEventListener("online", () => kick(0));
  window.addEventListener("offline", () => { try { goOffline(db); } catch {} });

  // Page focus fallback।
  window.addEventListener("focus", () => kick(0));
}

export { ref, onValue, push, set, remove, update, query, orderByChild, equalTo, get, runTransaction, goOnline, goOffline, signInWithEmailAndPassword, signOut, signInWithPopup, sendPasswordResetEmail, confirmPasswordReset, updatePassword };
