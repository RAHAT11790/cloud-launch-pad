// pushNotifications.ts — RS Anime FCM Web Push
// ============================================================
// • Registers /firebase-messaging-sw.js
// • Requests notification permission (3-strike cooldown)
// • Fetches FCM token and stores directly to Firebase RTDB
//   at fcmTokens/{userId}/{tokenKey}
// • Sends push via the Supabase edge function `send-fcm`
// • Foreground onMessage → native browser notification via SW
// ============================================================

import { initializeApp, getApps, getApp } from "firebase/app";
import { getMessaging, getToken, onMessage, deleteToken, isSupported } from "firebase/messaging";
import { db, ref, set, get, update, remove } from "@/lib/firebase";

const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCP5bfue5FOc0eTO4E52-0A0w3PppO3Mvw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rs-anime.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://rs-anime-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rs-anime",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "rs-anime.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "843989457516",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:843989457516:web:57e0577d092183eedd9649",
};

const DEFAULT_VAPID_KEY = "BBEEfj8RvypJfWDs2KobRAQ6xAprjcmc0rMdddRHHe4nUMaSx27Sk_dWd0SRoUtp0WrNFdwz1N4_5CNGObW2H1w";
const BRAND_ICON = "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png";
const LS_LAST_REG = "rs_fcm_last_register_at";
const LS_LAST_TOKEN = "rs_fcm_last_token";
const LS_USER_ID = "rs_fcm_user_id";
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const REVALIDATE_MS = 6 * 60 * 60 * 1000;
const MAX_TOKENS_PER_USER = 3;

let _bootstrapped = false;
let _vapidKey = "";
let _messaging: ReturnType<typeof getMessaging> | null = null;
let _foregroundBound = false;

function firebaseApp() {
  return getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
}

async function loadVapidKey(): Promise<string> {
  if (_vapidKey) return _vapidKey;
  const env = String(import.meta.env.VITE_FCM_VAPID_KEY || "").trim();
  if (env) return (_vapidKey = env);
  try {
    const snap = await get(ref(db, "settings/fcmVapidKey"));
    const v = String(snap.val() || "").trim();
    if (v) return (_vapidKey = v);
  } catch {}
  return (_vapidKey = DEFAULT_VAPID_KEY);
}

async function ensureMessaging() {
  if (_messaging) return _messaging;
  if (!(await isSupported().catch(() => false))) return null;
  _messaging = getMessaging(firebaseApp());
  return _messaging;
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const swPath = "/firebase-messaging-sw.js";
    const existing = await navigator.serviceWorker.getRegistration("/");
    const url = existing?.active?.scriptURL || existing?.waiting?.scriptURL || existing?.installing?.scriptURL || "";
    if (existing && !url.includes("firebase-messaging-sw")) {
      await existing.unregister().catch(() => false);
      try { localStorage.removeItem(LS_LAST_TOKEN); localStorage.removeItem(LS_LAST_REG); } catch {}
    } else if (existing) {
      existing.update?.().catch(() => {});
      return existing;
    }
    const reg = await navigator.serviceWorker.register(swPath, { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready.catch(() => reg);
    return reg;
  } catch (err) {
    console.warn("[FCM] SW registration failed", err);
    return null;
  }
}

const tokenKey = (t: string) => btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const deviceId = (): string => {
  const K = "rs_fcm_device_id";
  let id = localStorage.getItem(K);
  if (!id) { id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem(K, id); }
  return id;
};

async function pruneUserTokens(userId: string, currentKey: string, currentDevice: string) {
  try {
    const snap = await get(ref(db, `fcmTokens/${userId}`));
    const tokens = snap.val() || {};
    const updates: Record<string, null> = {};
    Object.entries(tokens).forEach(([key, entry]: any) => {
      if (key !== currentKey && entry?.deviceId === currentDevice) {
        updates[`fcmTokens/${userId}/${key}`] = null;
      }
    });
    const remaining = Object.entries(tokens)
      .filter(([key]) => key !== currentKey && !updates[`fcmTokens/${userId}/${key}`])
      .map(([key, entry]: any) => ({ key, updatedAt: entry?.updatedAt || 0 }));
    if (remaining.length + 1 > MAX_TOKENS_PER_USER) {
      remaining.sort((a, b) => a.updatedAt - b.updatedAt);
      const toRemove = remaining.length + 1 - MAX_TOKENS_PER_USER;
      for (let i = 0; i < toRemove; i++) updates[`fcmTokens/${userId}/${remaining[i].key}`] = null;
    }
    if (Object.keys(updates).length) await update(ref(db), updates);
  } catch (e) { console.warn("[FCM] prune failed", e); }
}

async function acquireAndRegister(userId: string): Promise<string | null> {
  const msg = await ensureMessaging();
  if (!msg) return null;
  const vapidKey = await loadVapidKey();
  const swReg = await ensureServiceWorker();
  if (!swReg) return null;
  try {
    const token = await getToken(msg, { vapidKey, serviceWorkerRegistration: swReg });
    if (!token) return null;
    const key = tokenKey(token);
    const dev = deviceId();
    await set(ref(db, `fcmTokens/${userId}/${key}`), {
      token, deviceId: dev, origin: window.location.origin, updatedAt: Date.now(),
      userAgent: navigator.userAgent.substring(0, 160),
    });
    await pruneUserTokens(userId, key, dev);
    try {
      localStorage.setItem(LS_LAST_REG, String(Date.now()));
      localStorage.setItem(LS_LAST_TOKEN, token);
      localStorage.setItem(LS_USER_ID, userId);
    } catch {}
    console.info("[FCM] token saved for", userId);
    return token;
  } catch (err) {
    console.warn("[FCM] getToken failed", err);
    return null;
  }
}

function bindForeground() {
  if (_foregroundBound) return;
  _foregroundBound = true;
  ensureMessaging().then((m) => {
    if (!m) return;
    onMessage(m, async (payload) => {
      if (Notification.permission !== "granted") return;
      const n = payload.notification || {};
      const d = (payload.data || {}) as Record<string, string>;
      const title = n.title || d.title || "🎬 RS Anime";
      const link = d.url || d.deepLink || (d.contentId ? `/?anime=${d.contentId}` : "/");
      const swReg = await ensureServiceWorker();
      swReg?.showNotification(title, {
        body: n.body || d.body || "",
        icon: (n as any).icon || d.icon || BRAND_ICON,
        badge: BRAND_ICON,
        image: (n as any).image || d.image || undefined,
        tag: d.contentId ? `rsanime-${d.contentId}` : `rsanime-${Date.now()}`,
        vibrate: [200, 100, 200],
        renotify: true,
        data: { url: link, ...d },
      } as any).catch(() => {});
    });
  });
}

export async function initPushNotifications(userIdInput?: string) {
  if (_bootstrapped) return;
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return;

  let userId = String(userIdInput || "").trim();
  if (!userId) {
    try {
      const { getDeviceId } = await import("@/lib/premiumAccess");
      userId = `guest_${getDeviceId()}`;
    } catch { userId = "guest_unknown"; }
  }
  _bootstrapped = true;

  const LS_ATT = "rs_fcm_perm_attempts";
  const LS_LAST = "rs_fcm_perm_last_prompt";
  const LS_STOP = "rs_fcm_perm_stopped";
  const COOLDOWN = 24 * 60 * 60 * 1000;
  const MAX = 3;

  let permission = Notification.permission;
  if (permission === "default") {
    const stopped = localStorage.getItem(LS_STOP) === "1";
    const att = Number(localStorage.getItem(LS_ATT) || 0);
    const last = Number(localStorage.getItem(LS_LAST) || 0);
    if (!stopped && att < MAX && (!last || Date.now() - last >= COOLDOWN)) {
      await new Promise((r) => setTimeout(r, 1500));
      try { permission = await Notification.requestPermission(); } catch { permission = Notification.permission; }
      try {
        localStorage.setItem(LS_LAST, String(Date.now()));
        localStorage.setItem(LS_ATT, String(att + 1));
        if (permission !== "granted" && att + 1 >= MAX) localStorage.setItem(LS_STOP, "1");
      } catch {}
    }
  } else if (permission === "granted") {
    try { [LS_ATT, LS_LAST, LS_STOP].forEach((k) => localStorage.removeItem(k)); } catch {}
  }

  if (permission !== "granted") return;

  await ensureServiceWorker();
  await acquireAndRegister(userId);
  bindForeground();

  setInterval(() => { acquireAndRegister(userId).catch(() => {}); }, REFRESH_INTERVAL_MS);
  const revalidate = () => {
    try {
      const last = Number(localStorage.getItem(LS_LAST_REG) || 0);
      if (Date.now() - last >= REVALIDATE_MS) acquireAndRegister(userId).catch(() => {});
    } catch {}
  };
  window.addEventListener("focus", revalidate);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) revalidate(); });
}

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
  let tokenRegistered = false, lastRegisterAt = 0;
  try {
    const t = localStorage.getItem(LS_LAST_TOKEN) || "";
    lastRegisterAt = Number(localStorage.getItem(LS_LAST_REG) || 0);
    tokenRegistered = !!t && Date.now() - lastRegisterAt < REFRESH_INTERVAL_MS * 2;
  } catch {}
  return { supported, permission: Notification.permission, tokenRegistered, lastRegisterAt };
}

export async function enablePushNotifications(userIdInput?: string): Promise<{
  ok: boolean; status: "granted" | "denied" | "default" | "unsupported" | "error"; token?: string; message: string;
}> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return { ok: false, status: "unsupported", message: "Your browser does not support notifications." };
  }
  if (!(await isSupported().catch(() => false))) {
    return { ok: false, status: "unsupported", message: "Push messaging is not supported in this browser." };
  }
  let userId = String(userIdInput || "").trim();
  if (!userId) {
    try {
      const { getDeviceId } = await import("@/lib/premiumAccess");
      userId = `guest_${getDeviceId()}`;
    } catch { userId = "guest_unknown"; }
  }
  let permission = Notification.permission;
  if (permission === "denied") {
    return { ok: false, status: "denied", message: "Notifications are blocked. Open browser Site Settings → Notifications → Allow, then retry." };
  }
  if (permission === "default") {
    try { permission = await Notification.requestPermission(); }
    catch { return { ok: false, status: "error", message: "Could not open the permission prompt." }; }
    try { ["rs_fcm_perm_attempts", "rs_fcm_perm_last_prompt", "rs_fcm_perm_stopped"].forEach((k) => localStorage.removeItem(k)); } catch {}
  }
  if (permission !== "granted") {
    return { ok: false, status: permission as any, message: "You did not allow notifications." };
  }
  const token = await acquireAndRegister(userId);
  if (!token) return { ok: false, status: "error", message: "Permission allowed but token could not be saved. Refresh and try again." };
  bindForeground();
  _bootstrapped = true;
  return { ok: true, status: "granted", token, message: "Notifications enabled!" };
}

export async function unregisterPushNotifications() {
  try {
    const userId = localStorage.getItem(LS_USER_ID) || "";
    const token = localStorage.getItem(LS_LAST_TOKEN) || "";
    if (userId && token) {
      await remove(ref(db, `fcmTokens/${userId}/${tokenKey(token)}`)).catch(() => {});
    }
    const m = await ensureMessaging();
    if (m) await deleteToken(m).catch(() => {});
    [LS_LAST_REG, LS_LAST_TOKEN, LS_USER_ID].forEach((k) => localStorage.removeItem(k));
  } catch {}
}

// ============================================================
// SEND
// ============================================================

function sendFcmUrl(): string {
  const base = String((import.meta as any)?.env?.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/functions/v1/send-fcm`;
}

export type SendPushPayload = {
  title: string;
  body: string;
  image?: string;
  deepLink?: string;
  url?: string;
  contentId?: string;
  contentType?: string;
  seasonNumber?: number | string;
  episodeNumber?: number | string;
  seasonName?: string;
  episodeRange?: string;
  userIds?: string[]; // if omitted, targets all users with tokens
  data?: Record<string, any>;
};

async function loadAllUserIds(): Promise<string[]> {
  try {
    const snap = await get(ref(db, "fcmTokens"));
    const tree = snap.val() || {};
    return Object.keys(tree);
  } catch { return []; }
}

/** Compose a compact notification body: "Title • Season • Episode X" */
function composeBody(p: SendPushPayload): string {
  if (p.body && p.body.trim()) return p.body.trim();
  const season = p.seasonName || (p.seasonNumber != null && p.seasonNumber !== "" ? `Season ${p.seasonNumber}` : "");
  const ep = p.episodeRange || (p.episodeNumber != null && p.episodeNumber !== "" ? `Episode ${p.episodeNumber}` : "");
  return [season, ep].filter(Boolean).join(" • ");
}

export async function sendPushNotification(payload: SendPushPayload): Promise<{
  ok: boolean; total: number; sent: number; failed: number; invalidRemoved: number; reason?: string; error?: string;
}> {
  const url = sendFcmUrl();
  if (!url) return { ok: false, total: 0, sent: 0, failed: 0, invalidRemoved: 0, error: "send-fcm URL not configured" };
  try {
    let userIds = Array.isArray(payload.userIds) ? [...new Set(payload.userIds.filter(Boolean))] : undefined;
    if (!userIds || userIds.length === 0) userIds = await loadAllUserIds();
    if (!userIds.length) return { ok: false, total: 0, sent: 0, failed: 0, invalidRemoved: 0, error: "No users with tokens" };

    const deepLink = payload.deepLink || payload.url || (payload.contentId ? `/?anime=${payload.contentId}` : "/");
    const body = composeBody(payload);

    const data: Record<string, string> = {
      url: deepLink,
      deepLink,
      contentId: String(payload.contentId || ""),
      contentType: String(payload.contentType || ""),
      seasonNumber: payload.seasonNumber != null ? String(payload.seasonNumber) : "",
      episodeNumber: payload.episodeNumber != null ? String(payload.episodeNumber) : "",
      baseUrl: window.location.origin,
    };
    if (payload.data) Object.entries(payload.data).forEach(([k, v]) => { data[k] = v == null ? "" : String(v); });

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userIds,
        title: payload.title || "RS ANIME",
        body,
        image: payload.image,
        data,
      }),
    });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, total: 0, sent: 0, failed: 0, invalidRemoved: 0, error: res?.error || `HTTP ${r.status}` };
    const total = Number(res.totalTokens || 0);
    const sent = Number(res.success || 0);
    const failed = Number(res.failed || 0);
    return {
      ok: sent > 0 || total > 0,
      total, sent, failed,
      invalidRemoved: Number(res.invalidRemoved || 0),
      reason: res.reason,
    };
  } catch (err: any) {
    return { ok: false, total: 0, sent: 0, failed: 0, invalidRemoved: 0, error: String(err?.message || err) };
  }
}
