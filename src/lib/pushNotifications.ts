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
import { SUPABASE_ANON_KEY } from "@/lib/siteConfig";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDIMMW8WMG8b_lAJfEcY0tpT9JnipyL3mc",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rs-anime-web.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://rs-anime-web-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rs-anime-web",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "rs-anime-web.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "856791666296",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:856791666296:web:9b769ba6d774734e0ce78d",
};

const DEFAULT_VAPID_KEY = "BGCz843-vYBPT50ADLGHy6cvLp0Zft-i_74y58ZtqS2qmTk6Hs9glz2eppNNt3fEfREVBX8Ewo0MdCEI5YkHQxc";
const BRAND_ICON = "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png";
const LS_LAST_REG = "rs_fcm_last_register_at";
const LS_LAST_TOKEN = "rs_fcm_last_token";
const LS_USER_ID = "rs_fcm_user_id";
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const REVALIDATE_MS = 6 * 60 * 60 * 1000;
const MAX_TOKENS_PER_USER = 100;
const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTO_CLEANUP_KEY = "rs_fcm_auto_cleanup_last";
const AUTO_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const isStandaloneApp = () => {
  if (typeof window === "undefined") return false;
  return !!(window.matchMedia?.("(display-mode: standalone)").matches || (window.navigator as any).standalone === true);
};

let _bootstrapped = false;
let _currentUserId = "";
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
    await reg.update().catch(() => {});
    return (await navigator.serviceWorker.ready.catch(() => reg)) || reg;
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

function currentLocalUserMeta(userId: string) {
  try {
    const raw = localStorage.getItem("rsanime_user");
    const u = raw ? JSON.parse(raw) : {};
    return {
      name: String(u?.name || localStorage.getItem("rs_display_name") || "").trim(),
      email: String(u?.email || (String(userId).includes("@") ? userId : "")).trim(),
    };
  } catch {
    return { name: "", email: String(userId).includes("@") ? userId : "" };
  }
}

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
    // Keep all real devices for the user. We only remove replaced tokens from
    // the same device above; this high cap prevents extra phones/browsers from
    // being silently dropped from future offline pushes.
    if (remaining.length + 1 > MAX_TOKENS_PER_USER) {
      remaining.sort((a, b) => a.updatedAt - b.updatedAt);
      const toRemove = remaining.length + 1 - MAX_TOKENS_PER_USER;
      for (let i = 0; i < toRemove; i++) updates[`fcmTokens/${userId}/${remaining[i].key}`] = null;
    }
    if (Object.keys(updates).length) await update(ref(db), updates);
  } catch (e) { console.warn("[FCM] prune failed", e); }
}

async function migrateTokenAcrossUsers(newUserId: string, currentKey: string, currentDevice: string) {
  // Remove this device's token from any OTHER userId bucket (guest→login,
  // or account switch on the same device). Multi-device same-account is
  // preserved because each device has a unique deviceId.
  try {
    const root = await get(ref(db, `fcmTokens`));
    const tree = root.val() || {};
    const updates: Record<string, null> = {};
    Object.entries(tree).forEach(([uid, userTokens]: any) => {
      if (uid === newUserId) return;
      Object.entries(userTokens || {}).forEach(([key, entry]: any) => {
        if (entry?.deviceId === currentDevice || key === currentKey) {
          updates[`fcmTokens/${uid}/${key}`] = null;
        }
      });
    });
    if (Object.keys(updates).length) await update(ref(db), updates);
  } catch (e) { console.warn("[FCM] cross-user migration failed", e); }
}

async function acquireAndRegister(userId: string, forceFresh = false): Promise<string | null> {
  const msg = await ensureMessaging();
  if (!msg) return null;
  const vapidKey = await loadVapidKey();
  const swReg = await ensureServiceWorker();
  if (!swReg) return null;
  try {
    if (forceFresh) {
      console.info("[FCM] Forcing fresh token generation...");
      try { await deleteToken(msg); } catch {}
      try { 
        localStorage.removeItem(LS_LAST_TOKEN); 
        localStorage.removeItem(LS_LAST_REG);
      } catch {}
    }

    const token = await getToken(msg, { vapidKey, serviceWorkerRegistration: swReg });
    if (!token) return null;
    const key = tokenKey(token);
    const dev = deviceId();
    const meta = currentLocalUserMeta(userId);
    await set(ref(db, `fcmTokens/${userId}/${key}`), {
      token, deviceId: dev, origin: window.location.origin, updatedAt: Date.now(),
      name: meta.name,
      email: meta.email,
      userAgent: navigator.userAgent.substring(0, 160),
    });
    await migrateTokenAcrossUsers(userId, key, dev);
    await pruneUserTokens(userId, key, dev);
    try {
      localStorage.setItem(LS_LAST_REG, String(Date.now()));
      localStorage.setItem(LS_LAST_TOKEN, token);
      localStorage.setItem(LS_USER_ID, userId);
    } catch {}
    _currentUserId = userId;
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
      const d = { ...((payload.data as Record<string, string>) || {}) };
      if (payload.notification) {
        d.title = d.title || (payload.notification as any).title || "";
        d.body = d.body || (payload.notification as any).body || "";
        d.image = d.image || (payload.notification as any).image || "";
        d.icon = d.icon || (payload.notification as any).icon || "";
      }
      const title = d.title || "🎬 RS Anime";
      const link = d.url || d.deepLink || (d.contentId ? `/?anime=${d.contentId}` : "/");
      const swReg = await ensureServiceWorker();
      swReg?.showNotification(title, {
        body: d.body || "",
        icon: d.icon || BRAND_ICON,
        badge: "/notification-badge.svg",
        image: d.image || undefined,
        tag: d.contentId ? `rsanime-${d.contentId}` : `rsanime-${Date.now()}`,
        vibrate: [200, 100, 200],
        renotify: true,
        data: { url: link, ...d },
      } as any).catch(() => {});
    });
  });
}


export async function initPushNotifications(userIdInput?: string) {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return;

  let userId = String(userIdInput || "").trim();
  if (!userId) {
    try {
      const { getDeviceId } = await import("@/lib/premiumAccess");
      userId = `guest_${getDeviceId()}`;
    } catch { userId = "guest_unknown"; }
  }

  // If already bootstrapped but the userId changed (guest → login,
  // or account switch), re-register the token under the new user
  // so multi-device same-account push always reaches this device.
  if (_bootstrapped) {
    if (userId && userId !== _currentUserId && Notification.permission === "granted") {
      await acquireAndRegister(userId).catch(() => {});
    }
    return;
  }
  _bootstrapped = true;
  _currentUserId = userId;

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
    const standalone = isStandaloneApp();
    if ((standalone || !stopped) && (standalone || att < MAX) && (standalone || !last || Date.now() - last >= COOLDOWN)) {
      await new Promise((r) => setTimeout(r, standalone ? 350 : 1500));
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
  window.addEventListener("online", revalidate);
  window.addEventListener("pageshow", revalidate);
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

/** Professional background cleanup to keep DB healthy without hitting size limits */
async function runAutoCleanup() {
  try {
    const last = Number(localStorage.getItem(AUTO_CLEANUP_KEY) || 0);
    if (Date.now() - last < AUTO_CLEANUP_INTERVAL) return;

    console.info("[FCM] Running background auto-cleanup...");
    const userId = localStorage.getItem(LS_USER_ID);
    if (!userId) return;

    // Only clean current user's old tokens locally to save bandwidth
    const snap = await get(ref(db, `fcmTokens/${userId}`));
    const tokens = snap.val() || {};
    const now = Date.now();
    
    for (const [key, entry] of Object.entries(tokens)) {
      const upd = (entry as any)?.updatedAt || 0;
      if (now - upd > TOKEN_MAX_AGE_MS) {
        await remove(ref(db, `fcmTokens/${userId}/${key}`)).catch(() => {});
      }
    }
    
    // Also clear user's own old notification logs
    await remove(ref(db, `notifications/${userId}`)).catch(() => {});

    localStorage.setItem(AUTO_CLEANUP_KEY, String(Date.now()));
    console.info("[FCM] Auto-cleanup finished.");
  } catch (e) {
    console.warn("[FCM] Auto-cleanup skipped", e);
  }
}


/** Wipe all FCM data from RTDB and force client re-registration */
export async function wipeAndResetFcmSystem() {
  if (!confirm("This will clean up expired tokens and old logs. This is a safe professional cleanup. Continue?")) return;
  
  try {
    console.info("[FCM] Starting professional cleanup...");
    
    // 1. Delete old notifications (usually the largest node causing WRITE_TOO_BIG)
    // We do this by user to keep requests small
    const notifSnap = await get(ref(db, "notifications"));
    const notifs = notifSnap.val() || {};
    const notifUserIds = Object.keys(notifs);
    
    console.info(`[FCM] Cleaning notifications for ${notifUserIds.length} users...`);
    for (const uid of notifUserIds) {
      await remove(ref(db, `notifications/${uid}`)).catch(() => {});
    }

    // 2. Clean tokens (Only remove truly old ones, e.g. > 30 days)
    const tokenSnap = await get(ref(db, "fcmTokens"));
    const allTokens = tokenSnap.val() || {};
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    let removedCount = 0;
    for (const [uid, userTokens] of Object.entries(allTokens)) {
      if (!userTokens || typeof userTokens !== "object") continue;
      for (const [tKey, entry] of Object.entries(userTokens as any)) {
        const lastUpd = (entry as any)?.updatedAt || 0;
        if (now - lastUpd > THIRTY_DAYS) {
          await remove(ref(db, `fcmTokens/${uid}/${tKey}`)).catch(() => {});
          removedCount++;
        }
      }
    }
    
    console.info(`[FCM] Cleanup complete. Removed ${removedCount} expired tokens.`);
    
    // Also reset local device state for current admin/user
    const userId = localStorage.getItem(LS_USER_ID) || "admin";
    await acquireAndRegister(userId, true);
    
    return { ok: true, removedCount };
  } catch (err: any) {
    console.error("[FCM] Professional cleanup failed", err);
    throw err;
  }
}

// ============================================================
// SEND
// ============================================================

async function resolveSendFcmEndpoint(): Promise<{ url: string; provider: "cloudflare" | "supabase" }> {
  const url = await getEdgeFunctionUrl("send-fcm").catch(() => "");
  const provider = /\/functions\/v1\/send-fcm/i.test(url) ? "supabase" : "cloudflare";
  return { url, provider };
}

function sendHeaders(url: string, provider: "cloudflare" | "supabase") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider === "supabase" || /\/functions\/v1\/send-fcm/i.test(url)) {
    if (SUPABASE_ANON_KEY) {
      headers.apikey = SUPABASE_ANON_KEY;
      headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
    }
  }
  return headers;
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

/** Compose a compact notification body: "Title • Season • Episode X" */
function composeBody(p: SendPushPayload): string {
  if (p.body && p.body.trim()) return p.body.trim();
  const season = p.seasonName || (p.seasonNumber != null && p.seasonNumber !== "" ? `Season ${p.seasonNumber}` : "");
  const ep = p.episodeRange || (p.episodeNumber != null && p.episodeNumber !== "" ? `Episode ${p.episodeNumber}` : "");
  return [season, ep].filter(Boolean).join(" • ");
}

export async function sendPushNotification(payload: SendPushPayload): Promise<{
  ok: boolean; total: number; sent: number; failed: number; invalidRemoved: number; reason?: string; error?: string; deliveredUserIds: string[]; deliveredUsers: number; provider?: "cloudflare" | "supabase";
}> {
  const { url, provider } = await resolveSendFcmEndpoint();
  if (!url) return { ok: false, total: 0, sent: 0, failed: 0, invalidRemoved: 0, deliveredUserIds: [], deliveredUsers: 0, error: "send-fcm URL not configured", provider };
  try {
    const userIds = Array.isArray(payload.userIds) ? [...new Set(payload.userIds.filter(Boolean))] : undefined;

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
      headers: sendHeaders(url, provider),
      body: JSON.stringify({
        ...(userIds && userIds.length ? { userIds } : {}),
        title: payload.title || "RS ANIME",
        body,
        image: payload.image,
        data: {
          ...data,
          notificationId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      }),
    });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, total: 0, sent: 0, failed: 0, invalidRemoved: 0, deliveredUserIds: [], deliveredUsers: 0, error: res?.error || `HTTP ${r.status}`, provider };
    const total = Number(res.totalTokens || 0);
    const sent = Number(res.success || 0);
    const failed = Number(res.failed || 0);
    const deliveredUserIds = Array.isArray(res.deliveredUserIds) ? res.deliveredUserIds.map(String).filter(Boolean) : [];
    const failReasons = res.failReasons && typeof res.failReasons === "object"
      ? Object.entries(res.failReasons).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}:${v}`).join(" ")
      : "";
    return {
      ok: sent > 0,
      total, sent, failed,
      invalidRemoved: Number(res.invalidRemoved || 0),
      reason: res.reason,
      error: sent > 0 ? undefined : (res.reason || failReasons || (total ? "No browser push was delivered" : "No matching FCM tokens")),
      deliveredUserIds,
      deliveredUsers: Number(res.deliveredUsers || deliveredUserIds.length || 0),
      provider,
    };
  } catch (err: any) {
    return { ok: false, total: 0, sent: 0, failed: 0, invalidRemoved: 0, deliveredUserIds: [], deliveredUsers: 0, error: String(err?.message || err), provider };
  }
}
