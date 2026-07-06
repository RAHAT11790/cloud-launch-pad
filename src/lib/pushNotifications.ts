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

// VAPID public key — safe to ship in client code (it's a public key by design).
// Precedence: VITE env → Firebase settings/fcmVapidKey → hardcoded default.
const DEFAULT_VAPID_KEY = "BBEEfj8RvypJfWDs2KobRAQ6xAprjcmc0rMdddRHHe4nUMaSx27Sk_dWd0SRoUtp0WrNFdwz1N4_5CNGObW2H1w";
const LS_LAST_REG = "rs_fcm_last_register_at";
const LS_LAST_TOKEN = "rs_fcm_last_token";
const LS_USER_ID = "rs_fcm_user_id";
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h
const REVALIDATE_MS = 6 * 60 * 60 * 1000; // 6h
const TOKEN_RECHECK_MS = 30 * 60 * 1000; // 30m — retry if permission is already granted but backend was down

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
  _vapidKey = DEFAULT_VAPID_KEY;
  return _vapidKey;
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

async function postRegister(userId: string, token: string): Promise<boolean> {
  const endpoint = await getEdgeFunctionUrl("send-fcm");
  if (!endpoint) {
    console.warn("[FCM] send-fcm endpoint not configured in EGD Router");
    return false;
  }
  const url = endpoint.replace(/\/+$/, "") + "/register";
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, token, ua: navigator.userAgent }),
    });
    const text = await r.text().catch(() => "");
    if (!r.ok) {
      console.warn("[FCM] register HTTP", r.status, text);
      return false;
    }
    try {
      localStorage.setItem(LS_LAST_REG, String(Date.now()));
      localStorage.setItem(LS_LAST_TOKEN, token);
      localStorage.setItem(LS_USER_ID, userId);
    } catch {}
    console.info("[FCM] token registered for", userId);
    return true;
  } catch (err) {
    console.warn("[FCM] register POST failed", err);
    return false;
  }
}

async function acquireAndRegisterToken(userId: string): Promise<string | null> {
  const messaging = await ensureMessaging();
  if (!messaging) { console.warn("[FCM] messaging not supported"); return null; }
  const vapidKey = await loadVapidKey();
  if (!vapidKey) { console.warn("[FCM] VAPID key missing"); return null; }
  const swReg = await ensureServiceWorker();
  if (!swReg) { console.warn("[FCM] service worker registration failed"); return null; }
  try {
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
    if (!token) { console.warn("[FCM] getToken returned empty"); return null; }
    const ok = await postRegister(userId, token);
    return ok ? token : null;
  } catch (err) {
    console.warn("[FCM] getToken failed", err);
    return null;
  }
}

function getSavedTokenState() {
  try {
    return {
      token: localStorage.getItem(LS_LAST_TOKEN) || "",
      userId: localStorage.getItem(LS_USER_ID) || "",
      lastRegisterAt: Number(localStorage.getItem(LS_LAST_REG) || 0),
    };
  } catch {
    return { token: "", userId: "", lastRegisterAt: 0 };
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
export async function initPushNotifications(userIdInput?: string) {
  if (_bootstrapped) return;
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (!("serviceWorker" in navigator)) return;

  // Resolve an ID even for guests so tokens can still be stored & pushed to.
  let userId = String(userIdInput || "").trim();
  if (!userId) {
    try {
      const { getDeviceId } = await import("@/lib/premiumAccess");
      userId = `guest_${getDeviceId()}`;
    } catch {
      userId = "guest_unknown";
    }
  }

  _bootstrapped = true;

  // ============ 3-strike permission prompt logic ============
  // Prompt on first visit; if user dismisses/declines, wait 24h and try again,
  // up to 3 attempts total. After 3 declines, stop prompting forever.
  const LS_PERM_ATTEMPTS = "rs_fcm_perm_attempts";
  const LS_PERM_LAST_PROMPT = "rs_fcm_perm_last_prompt";
  const LS_PERM_STOPPED = "rs_fcm_perm_stopped";
  const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h
  const MAX_ATTEMPTS = 3;

  let permission = Notification.permission;

  if (permission === "default") {
    const stopped = localStorage.getItem(LS_PERM_STOPPED) === "1";
    const attempts = Number(localStorage.getItem(LS_PERM_ATTEMPTS) || 0);
    const lastPrompt = Number(localStorage.getItem(LS_PERM_LAST_PROMPT) || 0);
    const cooldownOk = !lastPrompt || Date.now() - lastPrompt >= PROMPT_COOLDOWN_MS;

    if (!stopped && attempts < MAX_ATTEMPTS && cooldownOk) {
      // Slight delay so it doesn't hit before the page paints.
      await new Promise((r) => setTimeout(r, 1500));
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = Notification.permission;
      }
      try {
        localStorage.setItem(LS_PERM_LAST_PROMPT, String(Date.now()));
        const newAttempts = attempts + 1;
        localStorage.setItem(LS_PERM_ATTEMPTS, String(newAttempts));
        if (permission !== "granted" && newAttempts >= MAX_ATTEMPTS) {
          localStorage.setItem(LS_PERM_STOPPED, "1");
        }
      } catch {}
    }
  } else if (permission === "granted") {
    // Reset attempt counter so a future re-permission works cleanly.
    try {
      localStorage.removeItem(LS_PERM_ATTEMPTS);
      localStorage.removeItem(LS_PERM_LAST_PROMPT);
      localStorage.removeItem(LS_PERM_STOPPED);
    } catch {}
  } else if (permission === "denied") {
    // Browser-level denial → cannot be re-prompted; stop trying.
    try { localStorage.setItem(LS_PERM_STOPPED, "1"); } catch {}
  }

  if (permission !== "granted") return;

  const saved = getSavedTokenState();
  if (!saved.token || saved.userId !== userId || Date.now() - saved.lastRegisterAt >= TOKEN_RECHECK_MS) {
    await acquireAndRegisterToken(userId);
  }
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
 * Returns the current push status for UI display in Profile → Notifications.
 */
export async function getPushStatus(): Promise<{
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  tokenRegistered: boolean;
  lastRegisterAt: number;
}> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return { supported: false, permission: "unsupported", tokenRegistered: false, lastRegisterAt: 0 };
  }
  const supported = await isSupported().catch(() => false);
  let tokenRegistered = false;
  let lastRegisterAt = 0;
  try {
    const saved = getSavedTokenState();
    tokenRegistered = !!saved.token && Date.now() - saved.lastRegisterAt < REFRESH_INTERVAL_MS * 2;
    lastRegisterAt = saved.lastRegisterAt;
  } catch {}
  return { supported, permission: Notification.permission, tokenRegistered, lastRegisterAt };
}

/**
 * User-gesture triggered: force a permission prompt and register the FCM token.
 * Call this from a click handler (e.g. "Enable Notifications" button).
 * Returns a status string the UI can toast/show.
 */
export async function enablePushNotifications(userIdInput?: string): Promise<{
  ok: boolean;
  status: "granted" | "denied" | "default" | "unsupported" | "error";
  token?: string;
  message: string;
}> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return { ok: false, status: "unsupported", message: "Your browser does not support notifications." };
  }
  if (!(await isSupported().catch(() => false))) {
    return { ok: false, status: "unsupported", message: "Push messaging is not supported in this browser." };
  }

  // Resolve user id (guest fallback)
  let userId = String(userIdInput || "").trim();
  if (!userId) {
    try {
      const { getDeviceId } = await import("@/lib/premiumAccess");
      userId = `guest_${getDeviceId()}`;
    } catch {
      userId = "guest_unknown";
    }
  }

  let permission = Notification.permission;
  if (permission === "denied") {
    return {
      ok: false,
      status: "denied",
      message: "Notifications are blocked. Click the lock icon in your browser's address bar → Site settings → Notifications → Allow, then try again.",
    };
  }

  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return { ok: false, status: "error", message: "Could not open the permission prompt." };
    }
    try {
      // Reset the 3-strike counters since the user actively opted in
      localStorage.removeItem("rs_fcm_perm_attempts");
      localStorage.removeItem("rs_fcm_perm_last_prompt");
      localStorage.removeItem("rs_fcm_perm_stopped");
    } catch {}
  }

  if (permission !== "granted") {
    return { ok: false, status: permission as any, message: "You did not allow notifications." };
  }

  const token = await acquireAndRegisterToken(userId);
  if (!token) {
    return { ok: false, status: "error", message: "Permission is allowed, but the push token could not be saved. Refresh and tap Enable Notifications again." };
  }
  bindForegroundHandler();
  _bootstrapped = true;
  return { ok: true, status: "granted", token, message: "Notifications enabled successfully!" };
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
