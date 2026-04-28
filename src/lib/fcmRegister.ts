/**
 * Web FCM Token Registration
 * 
 * Registers the browser's FCM token to Firebase RTDB at:
 *   fcmTokens/{uid}/{tokenKey} = { token, platform: "web", ua, createdAt, lastSeenAt }
 * 
 * The send-fcm Supabase Edge Function reads from this same path.
 * 
 * Foreground messages are shown via the in-app NotificationPanel (Firebase RTDB
 * /notifications/{uid}/...), so we don't need to display them again here — but we
 * fall back to a browser Notification if the tab is hidden, so the user still sees it.
 */

import { initializeApp, getApp, getApps } from "firebase/app";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported,
  type Messaging,
} from "firebase/messaging";
import { db, ref, set, get, update } from "@/lib/firebase";
import { FIREBASE_VAPID_KEY, SITE_ICON_URL } from "@/lib/siteConfig";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCP5bfue5FOc0eTO4E52-0A0w3PppO3Mvw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rs-anime.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://rs-anime-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rs-anime",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "rs-anime.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "843989457516",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:843989457516:web:57e0577d092183eedd9649",
};

const TOKEN_KEY_LS = "rs_fcm_token";
const TOKEN_UID_LS = "rs_fcm_uid";
const TOKEN_TIME_LS = "rs_fcm_saved_at";
const REFRESH_INTERVAL = 1000 * 60 * 60 * 24 * 7; // 7 days

let messagingInstance: Messaging | null = null;
let foregroundUnsub: (() => void) | null = null;
let registeredForUid: string | null = null;

function safeKeyFromToken(token: string): string {
  // Firebase RTDB keys cannot contain . # $ [ ] /
  return token.replace(/[.#$\[\]/]/g, "_").substring(0, 200);
}

async function getMessagingSafe(): Promise<Messaging | null> {
  try {
    if (typeof window === "undefined") return null;
    if (!(await isSupported())) {
      console.info("[FCM] Browser does not support Firebase Messaging");
      return null;
    }
    if (messagingInstance) return messagingInstance;
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    messagingInstance = getMessaging(app);
    return messagingInstance;
  } catch (err) {
    console.warn("[FCM] init failed:", err);
    return null;
  }
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    // Re-use existing registration if same script
    const existing = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
    if (existing) return existing;
    return await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
  } catch (err) {
    console.warn("[FCM] SW registration failed:", err);
    return null;
  }
}

async function saveTokenToDb(uid: string, token: string) {
  const tokenKey = safeKeyFromToken(token);
  const path = `fcmTokens/${uid}/${tokenKey}`;
  const payload = {
    token,
    platform: "web",
    ua: navigator.userAgent.substring(0, 200),
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  // Merge so we don't overwrite createdAt if entry exists
  try {
    const existing = await get(ref(db, path));
    if (existing.exists()) {
      await update(ref(db, path), { lastSeenAt: Date.now(), token });
    } else {
      await set(ref(db, path), payload);
    }
    localStorage.setItem(TOKEN_KEY_LS, token);
    localStorage.setItem(TOKEN_UID_LS, uid);
    localStorage.setItem(TOKEN_TIME_LS, String(Date.now()));
    console.info("[FCM] token saved for uid", uid);
  } catch (err) {
    console.warn("[FCM] save token failed:", err);
  }
}

/**
 * Register the current browser for push notifications and save the token
 * under the given user ID. Safe to call multiple times — uses cache to avoid
 * redundant work but always re-asserts presence in RTDB.
 */
export async function registerFcmForUser(uid: string): Promise<string | null> {
  if (!uid) return null;
  if (registeredForUid === uid) {
    // Refresh lastSeenAt periodically, even if cached
    const last = Number(localStorage.getItem(TOKEN_TIME_LS) || 0);
    if (Date.now() - last < REFRESH_INTERVAL) {
      return localStorage.getItem(TOKEN_KEY_LS);
    }
  }

  const messaging = await getMessagingSafe();
  if (!messaging) return null;

  // Permission gate
  if (!("Notification" in window)) return null;
  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return null;
    }
  }
  if (permission !== "granted") {
    console.info("[FCM] permission not granted:", permission);
    return null;
  }

  const swReg = await ensureServiceWorker();
  if (!swReg) return null;

  let token: string | null = null;
  try {
    token = await getToken(messaging, {
      vapidKey: FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
  } catch (err) {
    console.warn("[FCM] getToken failed:", err);
    return null;
  }

  if (!token) return null;
  await saveTokenToDb(uid, token);
  registeredForUid = uid;

  // Set up foreground listener once
  if (!foregroundUnsub) {
    try {
      foregroundUnsub = onMessage(messaging, (payload) => {
        try {
          // If tab is visible, NotificationPanel already shows the in-app entry.
          // Only surface a system notification when the tab is hidden.
          if (document.visibilityState === "visible") return;
          const title =
            payload.notification?.title ||
            (payload.data?.title as string) ||
            "RS ANIME";
          const body =
            payload.notification?.body ||
            (payload.data?.body as string) ||
            "";
          const icon =
            payload.notification?.icon ||
            (payload.data?.icon as string) ||
            SITE_ICON_URL;
          const image = payload.notification?.image || (payload.data?.image as string);
          const link = (payload.data?.url as string) || (payload.fcmOptions as any)?.link;

          if ("Notification" in window) {
            const n = new Notification(title, {
              body,
              icon,
              image,
              badge: "/notification-badge.svg",
              data: { url: link },
            } as NotificationOptions);
            n.onclick = () => {
              window.focus();
              if (link) window.location.href = link;
              n.close();
            };
          }
        } catch (err) {
          console.warn("[FCM] foreground handler error:", err);
        }
      });
    } catch (err) {
      console.warn("[FCM] onMessage subscribe failed:", err);
    }
  }

  return token;
}

/**
 * Remove this browser's token entry from RTDB (e.g. on logout).
 */
export async function unregisterFcmForCurrentDevice(): Promise<void> {
  try {
    const uid = localStorage.getItem(TOKEN_UID_LS);
    const token = localStorage.getItem(TOKEN_KEY_LS);
    if (uid && token) {
      const tokenKey = safeKeyFromToken(token);
      await set(ref(db, `fcmTokens/${uid}/${tokenKey}`), null);
    }
  } catch (err) {
    console.warn("[FCM] unregister failed:", err);
  } finally {
    localStorage.removeItem(TOKEN_KEY_LS);
    localStorage.removeItem(TOKEN_UID_LS);
    localStorage.removeItem(TOKEN_TIME_LS);
    registeredForUid = null;
  }
}
