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
// আগের watchdog implementation-এ `.info/connected=false` হলে goOffline→goOnline
// কল করা হচ্ছিল, যেটা আবার `.info/connected=false` trigger করে infinite loop
// তৈরি করত এবং user panel-এ কোন data আসত না। এখন state track করে শুধু
// সত্যিকারের disconnect + tab visible হলে reconnect চেষ্টা হবে।
if (typeof window !== "undefined") {
  let wasConnected = false;
  let everConnected = false;
  let reconnectTimer: number | null = null;
  let reconnecting = false;

  const reconnectNow = () => {
    if (reconnecting) return;
    reconnecting = true;
    try { goOffline(db); } catch {}
    // small gap so socket teardown completes before re-open
    window.setTimeout(() => {
      try { goOnline(db); } catch {}
      reconnecting = false;
    }, 250);
  };

  const scheduleReconnect = (delay = 1500) => {
    if (reconnectTimer) return; // already scheduled
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (!wasConnected) reconnectNow();
    }, delay);
  };

  try {
    onValue(ref(db, ".info/connected"), (snap) => {
      const connected = snap.val() === true;
      wasConnected = connected;
      if (connected) {
        everConnected = true;
        if (reconnectTimer) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
      } else if (everConnected && navigator.onLine !== false) {
        // Only try to recover after we've been connected at least once.
        scheduleReconnect(2000);
      }
    });
  } catch {}

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !wasConnected && navigator.onLine !== false) {
      reconnectNow();
    }
  });

  window.addEventListener("online", () => {
    if (!wasConnected) reconnectNow();
  });
  // Offline event-এ কিছু করার দরকার নেই — Firebase নিজেই detect করবে,
  // আর জোর করে goOffline ডাকলে online হলে auto-recover হবে না।

  window.addEventListener("focus", () => {
    if (!wasConnected && navigator.onLine !== false) reconnectNow();
  });
}

export { ref, onValue, push, set, remove, update, query, orderByChild, equalTo, get, runTransaction, goOnline, goOffline, signInWithEmailAndPassword, signOut, signInWithPopup, sendPasswordResetEmail, confirmPasswordReset, updatePassword };
