// pushNotifications.ts — FCM Web Push client
// ============================================================
// • Registers /firebase-messaging-sw.js on page load
// • Requests notification permission (once, after first user gesture)
// • Fetches / refreshes the FCM registration token
// • POSTs the token to the send-fcm worker /register endpoint so it's
//   persisted under fcmTokens/{userId}/{hash}
// • Auto-refreshes every 12h and re-registers the token so the CF worker's
//   24h TTL never expires an active user's token
// • On visibility change / focus, re-checks token if last refresh > 6h ago
// • Foreground onMessage → in-app toast fallback so the user still sees it
// ============================================================

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getMessaging, getToken, onMessage, deleteToken, isSupported,
} from "firebase/messaging";
import { toast } from "sonner";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCP5bfue5FOc0eTO4E52-0A0w3PppO3Mvw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rs-anime.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://rs-anime-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rs-anime",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "rs-anime.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "843989457516",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:843989457516:web:57e0577d092183eedd9649",
};

// VAPID key is loaded from Firebase → settings/fcmVapidKey OR VITE env.
// Admin can update it live without a redeploy.
const LS_LAST_REG = "rs_fcm_last_register_at";
const LS_LAST_TOKEN = "rs_fcm_last_token";
const LS_USER_ID = "rs_fcm_user_id";
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h
const REVALIDATE_MS = 6 * 60 * 60 * 1000; // 6h

let _bootstrapped = false;
let _vapidKey = "";
let _messagingInstance: ReturnType<typeof getMessaging> | null = null;

async function loadVapidKey(): Promise<string> {
  if (_vapidKey) return _vapidKey;
  const fromEnv = String(import.meta.env.VITE_FCM_VAPID_KEY || "").trim();
  if (fromEnv) { _vapidKey = fromEnv; return _vapidKey; }
  try {
    const { db, ref, get } = await import("@/lib/firebase");
    const snap = await get(ref(db, "settings/fcmVapidKey"));
    const val = String(snap.val() || "").trim();
    if (val) { _vapidKey = val; return _vapidKey; }
  } catch {}
  return "";
}

function getFirebaseApp() {
  return getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    // Reuse an existing registration if the SW file is already installed
    const existing = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
    if (existing) return existing;
    return await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
  } catch (err) {
    console.warn("[FCM] SW registration failed", err);
    return null;
  }
}

async function ensureMessaging() {
  if (_messagingInstance) return _messagingInstance;
  if (!(await isSupported().catch(() => false))) return null;
  _messagingInstance = getMessaging(getFirebaseApp());
  return _messagingInstance;
}

async function postRegister(userId: string, token: string) {
  const endpoint = await getEdgeFunctionUrl("send-fcm");
  if (!endpoint) return; // router not configured — skip silently
  const url = endpoint.replace(/\/+$/, "") + "/register";
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, token, ua: navigator.userAgent }),
    });
    try {
      localStorage.setItem(LS_LAST_REG, String(Date.now()));
      localStorage.setItem(LS_LAST_TOKEN, token);
      localStorage.setItem(LS_USER_ID, userId);
    } catch {}
  } catch (err) {
    console.warn("[FCM] register POST failed", err);
  }
}

async function acquireAndRegisterToken(userId: string): Promise<string | null> {
  const messaging = await ensureMessaging();
  if (!messaging) return null;
  const vapidKey = await loadVapidKey();
  if (!vapidKey) {
    console.warn("[FCM] VAPID key missing — set settings/fcmVapidKey in Firebase or VITE_FCM_VAPID_KEY");
    return null;
  }
  const swReg = await ensureServiceWorker();
  if (!swReg) return null;
  try {
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
    if (!token) return null;
    await postRegister(userId, token);
    return token;
  } catch (err) {
    console.warn("[FCM] getToken failed", err);
    return null;
  }
}

function bindForegroundHandler() {
  ensureMessaging().then((messaging) => {
    if (!messaging) return;
    onMessage(messaging, (payload) => {
      const n = payload.notification || {};
      const d = (payload.data || {}) as Record<string, string>;
      const title = n.title || d.title || "🎬 New Notification";
      const body = n.body || d.body || "";
      const link = d.deepLink || (d.contentId ? `/watch/${d.contentId}` : "/");
      toast(title, {
        description: body,
        duration: 8000,
        action: { label: "Watch", onClick: () => { window.location.href = link; } },
      });
    });
  });
}

/**
 * Public entry: kick off FCM registration for the current user.
 * Safe to call multiple times — deduped.
 */
export async function initPushNotifications(userId: string) {
  if (_bootstrapped || !userId) return;
  _bootstrapped = true;
  if (typeof window === "undefined" || !("Notification" in window)) return;

  // Don't nag: only request permission if it hasn't been decided yet.
  // Users who denied stay denied (no notifications sent).
  let permission = Notification.permission;
  if (permission === "default") {
    try { permission = await Notification.requestPermission(); } catch { permission = Notification.permission; }
  }
  if (permission !== "granted") return;

  await acquireAndRegisterToken(userId);
  bindForegroundHandler();

  // Periodic refresh (12h) — keeps token < CF worker's 24h TTL
  setInterval(() => { acquireAndRegisterToken(userId).catch(() => {}); }, REFRESH_INTERVAL_MS);

  // Revalidate on focus / visibility if > 6h since last register
  const revalidate = () => {
    try {
      const last = Number(localStorage.getItem(LS_LAST_REG) || 0);
      if (Date.now() - last >= REVALIDATE_MS) acquireAndRegisterToken(userId).catch(() => {});
    } catch {}
  };
  window.addEventListener("focus", revalidate);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) revalidate(); });
}

/**
 * Unregister the current token for the user (e.g. on logout).
 */
export async function unregisterPushNotifications() {
  try {
    const userId = localStorage.getItem(LS_USER_ID) || "";
    const token = localStorage.getItem(LS_LAST_TOKEN) || "";
    if (userId && token) {
      const endpoint = await getEdgeFunctionUrl("send-fcm");
      if (endpoint) {
        await fetch(endpoint.replace(/\/+$/, "") + "/unregister", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, token }),
        }).catch(() => {});
      }
    }
    const messaging = await ensureMessaging();
    if (messaging) await deleteToken(messaging).catch(() => {});
    localStorage.removeItem(LS_LAST_REG);
    localStorage.removeItem(LS_LAST_TOKEN);
    localStorage.removeItem(LS_USER_ID);
  } catch {}
}

/**
 * Fire a push send by calling the send-fcm worker /send endpoint.
 * Accepts either a full deepLink or content id + season/episode to build one.
 */
export async function sendPushNotification(payload: {
  title: string;
  body: string;
  image?: string;
  deepLink?: string;
  contentId?: string;
  contentType?: string;
  seasonNumber?: number | string;
  episodeNumber?: number | string;
  userIds?: string[];
}): Promise<{ ok: boolean; total: number; sent: number; failed: number; invalidRemoved: number; error?: string }> {
  const endpoint = await getEdgeFunctionUrl("send-fcm");
  if (!endpoint) return { ok: false, total: 0, sent: 0, failed: 0, invalidRemoved: 0, error: "send-fcm URL not configured in EGD Router" };
  const url = endpoint.replace(/\/+$/, "") + "/send";
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, total: 0, sent: 0, failed: 0, invalidRemoved: 0, error: data?.error || `HTTP ${r.status}` };
    return { ok: true, total: data.total || 0, sent: data.sent || 0, failed: data.failed || 0, invalidRemoved: data.invalidRemoved || 0 };
  } catch (err: any) {
    return { ok: false, total: 0, sent: 0, failed: 0, invalidRemoved: 0, error: String(err?.message || err) };
  }
}
