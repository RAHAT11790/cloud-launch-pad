import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { initializeApp, getApps } from "firebase/app";
import { db, ref, set, get, update, remove } from "@/lib/firebase";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";
import { SITE_ICON_URL, SITE_URL, SUPABASE_ANON_KEY } from "@/lib/siteConfig";
import { toast } from "sonner";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCP5bfue5FOc0eTO4E52-0A0w3PppO3Mvw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rs-anime.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rs-anime",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "rs-anime.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "843989457516",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:843989457516:web:57e0577d092183eedd9649"
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "BDMR1Q2pzEWQZtt-E_g_T4GD0AN0_DkGfpDDs2_4a0Oy27INY1LPUGeR8n6NPmIDG3_dBL1OwHbN4a-Toku0Xs4";
const APP_ICON_URL = SITE_ICON_URL;
const PRIMARY_SITE_ORIGIN = (() => {
  try {
    return new URL(SITE_URL).origin;
  } catch {
    return SITE_URL;
  }
})();
const CHUNK_SIZE = 180;
const CHUNK_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_TOKENS_PER_USER = 3;

let messaging: any = null;
let cachedSendFcmEndpoint: string | null = null;
let cachedFcmProvider: { provider: "cloudflare" | "supabase"; url: string; url2?: string } | null = null;

type FcmProviderConfig = {
  provider: "cloudflare" | "supabase";
  url: string;
  url2?: string;
};

/** Get the active FCM provider config from Firebase */
const getFcmProviderConfig = async (): Promise<FcmProviderConfig> => {
  if (cachedFcmProvider) return cachedFcmProvider;
  try {
    const snap = await get(ref(db, "settings/fcmProvider"));
    const val = snap.val();
    if (val?.active) {
      // Read the correct URL based on active provider
      const activeProvider = val.active as "cloudflare" | "supabase";
      const url = activeProvider === "supabase" 
        ? (val.supabaseUrl || val.url || "")
        : (val.cloudflareUrl || val.url || "");
      const url2 = activeProvider === "supabase" ? (val.supabaseUrl2 || "") : "";
      if (url) {
        cachedFcmProvider = { provider: activeProvider, url, url2 };
        setTimeout(() => { cachedFcmProvider = null; }, 30000);
        return cachedFcmProvider;
      }
    }
  } catch {}
  // Fallback to edge router (Cloudflare)
  const url = await getEdgeFunctionUrl("send-fcm");
  cachedFcmProvider = { provider: "cloudflare", url };
  setTimeout(() => { cachedFcmProvider = null; }, 30000);
  return cachedFcmProvider;
};

const getSendFcmEndpoint = async () => {
  const config = await getFcmProviderConfig();
  return config.url;
};

const getMessagingInstance = () => {
  if (messaging) return messaging;
  try {
    const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
    messaging = getMessaging(app);
    return messaging;
  } catch (err) {
    console.warn("FCM not supported in this browser:", err);
    return null;
  }
};

const getTokenKey = (token: string) =>
  btoa(token)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const chunkArray = <T,>(arr: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resolvePublicUrl = (url?: string) => {
  if (!url) return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${SITE_URL}${url.startsWith("/") ? url : `/${url}`}`;
};

const isSupabaseFunctionUrl = (url?: string) => {
  if (!url) return false;
  return /supabase\.co\/functions\/v1\//i.test(url);
};

const buildFunctionHeaders = (endpoint: string): HeadersInit => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (isSupabaseFunctionUrl(endpoint) && SUPABASE_ANON_KEY) {
    headers.apikey = SUPABASE_ANON_KEY;
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  return headers;
};

/** Get or create a stable device ID for this browser */
const getDeviceId = (): string => {
  const KEY = "rs_fcm_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
};

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const requestWithRetry = async (body: unknown, retries = 2): Promise<Response> => {
  let lastError: unknown = null;
  const endpoint = await getSendFcmEndpoint();
  if (!endpoint) throw new Error("FCM endpoint is not configured");
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: buildFunctionHeaders(endpoint),
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (res.ok) return res;

      const text = await res.text();
      const retryable = res.status >= 500 || res.status === 429;
      if (!retryable || attempt === retries) {
        throw new Error(text || `Push request failed with ${res.status}`);
      }
      lastError = new Error(text || `Retryable push error ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
    }

    await sleep(350 * Math.pow(2, attempt));
  }

  throw lastError instanceof Error ? lastError : new Error("Push request failed");
};

const cleanupInvalidTokens = async (invalidTokens: string[]) => {
  if (!invalidTokens.length) return 0;
  const invalidSet = new Set(invalidTokens);

  try {
    const snap = await get(ref(db, "fcmTokens"));
    const all = snap.val() || {};
    const updates: Record<string, null> = {};

    Object.entries(all).forEach(([uid, userTokens]: any) => {
      Object.entries(userTokens || {}).forEach(([tokenKey, entry]: any) => {
        if (entry?.token && invalidSet.has(entry.token)) {
          updates[`fcmTokens/${uid}/${tokenKey}`] = null;
        }
      });
    });

    const paths = Object.keys(updates);
    if (paths.length > 0) {
      await update(ref(db), updates);
    }

    return paths.length;
  } catch (err) {
    console.warn("Failed to cleanup invalid FCM tokens:", err);
    return 0;
  }
};

/**
 * Clean up old tokens for the same device, and enforce per-user max token cap.
 * Returns number of tokens pruned.
 */
const pruneUserTokens = async (userId: string, currentTokenKey: string, deviceId: string): Promise<number> => {
  try {
    const snap = await get(ref(db, `fcmTokens/${userId}`));
    const tokens = snap.val() || {};
    const updates: Record<string, null> = {};

    // 1) Remove entries with the same deviceId but different tokenKey (old token from this device)
    Object.entries(tokens).forEach(([key, entry]: any) => {
      if (key !== currentTokenKey && entry?.deviceId === deviceId) {
        updates[`fcmTokens/${userId}/${key}`] = null;
      }
    });

    // 2) Enforce max token cap: keep newest MAX_TOKENS_PER_USER, prune oldest
    const remaining = Object.entries(tokens)
      .filter(([key]) => key !== currentTokenKey && !updates[`fcmTokens/${userId}/${key}`])
      .map(([key, entry]: any) => ({ key, updatedAt: entry?.updatedAt || 0 }));

    // +1 for the current token we just saved
    const totalAfterCleanup = remaining.length + 1;
    if (totalAfterCleanup > MAX_TOKENS_PER_USER) {
      remaining.sort((a, b) => a.updatedAt - b.updatedAt);
      const toRemove = totalAfterCleanup - MAX_TOKENS_PER_USER;
      for (let i = 0; i < toRemove && i < remaining.length; i++) {
        updates[`fcmTokens/${userId}/${remaining[i].key}`] = null;
      }
    }

    const count = Object.keys(updates).length;
    if (count > 0) {
      await update(ref(db), updates);
    }
    return count;
  } catch (err) {
    console.warn("[FCM] Token pruning failed:", err);
    return 0;
  }
};

/** Get email-based key for fcmTokens (matches existing Firebase structure) */
const getEmailKey = (): string | null => {
  try {
    const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
    if (u.email) return u.email.replace(/\./g, ",");
  } catch {}
  return null;
};

const toEmailKey = (email?: string | null): string | null => {
  if (!email || typeof email !== "string") return null;
  return email.replace(/\./g, ",");
};

const isPrimaryOriginToken = (entry: any) => {
  const origin = typeof entry?.origin === "string" ? entry.origin : "";
  return !origin || origin === PRIMARY_SITE_ORIGIN;
};

const extractTokensFromMap = (data: Record<string, any> | null | undefined): string[] => {
  if (!data || typeof data !== "object") return [];
  return Object.values(data)
    .filter((entry: any) => entry?.token && isPrimaryOriginToken(entry))
    .map((entry: any) => entry.token);
};

const getUserTokenStorageKeys = async (userIds: string[]): Promise<string[]> => {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  try {
    const snaps = await Promise.all(uniqueIds.map((uid) => get(ref(db, `users/${uid}`))));
    const keys = new Set<string>();

    uniqueIds.forEach((uid, index) => {
      keys.add(uid);

      if (uid.includes("@") || uid.includes(",")) {
        keys.add(uid.replace(/\./g, ","));
      }

      const user = snaps[index]?.val?.();
      const emailKey = toEmailKey(user?.email);
      if (emailKey) keys.add(emailKey);
      if (typeof user?.id === "string" && user.id) keys.add(user.id);
    });

    return [...keys];
  } catch (err) {
    console.warn("Failed to resolve FCM storage keys:", err);
    return uniqueIds;
  }
};

// Register FCM token for a user
export const registerFCMToken = async (userId: string, showDiagnostics = false) => {
  // If permission is already granted, skip all diagnostic toasts
  const alreadyGranted = "Notification" in window && Notification.permission === "granted";
  const shouldShowToasts = showDiagnostics && !alreadyGranted;

  const diag = (msg: string, type: "info" | "success" | "error" | "warning" = "info") => {
    console.log(`[FCM] ${msg}`);
    if (shouldShowToasts) {
      if (type === "error") toast.error(`[FCM] ${msg}`, { duration: 6000 });
      else if (type === "warning") toast.warning(`[FCM] ${msg}`, { duration: 5000 });
      else if (type === "success") toast.success(`[FCM] ${msg}`, { duration: 4000 });
      else toast.info(`[FCM] ${msg}`, { duration: 3000 });
    }
  };

  const persistPushState = async (patch: Record<string, any>) => {
    if (!userId) return;
    try {
      await update(ref(db, `users/${userId}`), {
        id: userId,
        lastPushCheckAt: Date.now(),
        ...patch,
      });
    } catch (stateErr) {
      console.warn("[FCM] Failed to persist push state:", stateErr);
    }
  };

  try {
    diag(`Step 1: Checking messaging support for user ${userId || "unknown"}...`);
    const msg = getMessagingInstance();
    if (!msg) {
      await persistPushState({ pushEnabled: false, pushPermission: "unsupported", pushTokenState: "unsupported" });
      diag("FAILED: Firebase Messaging not supported", "error");
      return;
    }
    if (!userId) {
      diag("FAILED: No userId provided", "error");
      return;
    }
    if (!("serviceWorker" in navigator)) {
      await persistPushState({ pushEnabled: false, pushPermission: "unsupported", pushTokenState: "sw_not_supported" });
      diag("FAILED: Service Worker not supported", "error");
      return;
    }

    diag("Step 2: Registering service worker...");
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    diag(`SW registered ✓ scope: ${registration.scope}`, "success");

    diag(`Step 3: Permission check... Current: ${Notification.permission}`);

    if (Notification.permission === "denied") {
      await persistPushState({ pushEnabled: false, pushPermission: "denied", pushTokenState: "blocked" });
      diag("❌ Notifications BLOCKED! Go to browser Settings → Site Settings → Notifications → Allow for this site", "error");
      return;
    }

    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();

    if (permission !== "granted") {
      await persistPushState({ pushEnabled: false, pushPermission: permission, pushTokenState: "not_granted" });
      diag(`Permission not granted: ${permission}. Please tap 'Allow' when prompted`, "warning");
      return;
    }
    await persistPushState({ pushEnabled: true, pushPermission: "granted", pushTokenState: "requesting_token" });
    diag("Permission granted ✓", "success");

    diag("Step 4: Requesting FCM token...");

    const token = await getToken(msg, {
      vapidKey: VAPID_KEY || undefined,
      serviceWorkerRegistration: registration,
    });

    if (token) {
      const tokenKey = getTokenKey(token);
      const deviceId = getDeviceId();
      const origin = window.location.origin;

      // Store under email key (matches existing Firebase structure)
      // Also store under userId as fallback
      const emailKey = getEmailKey();
      const storageKey = emailKey || userId;
      
      diag(`Step 5: Token received ✓ Saving to DB at fcmTokens/${storageKey}/${tokenKey}...`);

      const tokenData = {
        token,
        deviceId,
        origin,
        updatedAt: Date.now(),
        userAgent: navigator.userAgent.substring(0, 160),
      };

      // Save under primary key (email-based if available)
      await set(ref(db, `fcmTokens/${storageKey}/${tokenKey}`), tokenData);
      
      // If email key is different from userId, also save under userId for redundancy
      if (emailKey && emailKey !== userId) {
        await set(ref(db, `fcmTokens/${userId}/${tokenKey}`), tokenData).catch(() => {});
      }

      // Prune old tokens from same device + enforce max cap
      const pruned = await pruneUserTokens(storageKey, tokenKey, deviceId);
      if (pruned > 0) {
        console.log(`[FCM] Pruned ${pruned} old token(s) for ${storageKey}`);
      }

      await persistPushState({
        pushEnabled: true,
        pushPermission: "granted",
        pushTokenState: "saved",
        lastPushTokenAt: Date.now(),
      });

      if (showDiagnostics) {
        toast.success(`✅ Push token saved! ${pruned > 0 ? `(${pruned} old token${pruned > 1 ? "s" : ""} cleaned)` : ""}`, { duration: 4000 });
      }
    } else {
      await persistPushState({ pushEnabled: true, pushPermission: "granted", pushTokenState: "empty_token" });
      diag("FAILED: getToken() returned null. VAPID key may be wrong or browser incompatible", "error");
    }
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error("[FCM] Full error:", err);

    await persistPushState({
      pushTokenState: "error",
      pushEnabled: false,
      lastPushError: errMsg.substring(0, 140),
    });

    if (errMsg.includes("messaging/permission-blocked")) {
      diag("❌ Browser has BLOCKED notifications. Go to Settings → Notifications → Allow", "error");
    } else if (errMsg.includes("messaging/failed-service-worker-registration")) {
      diag("❌ Service worker failed - check firebase-messaging-sw.js", "error");
    } else if (errMsg.includes("messaging/token-subscribe-failed")) {
      diag("❌ Token subscribe failed - VAPID key may be incorrect", "error");
    } else {
      diag(`❌ Registration failed: ${errMsg.substring(0, 100)}`, "error");
    }
  }
};

// Get all FCM tokens for specific user IDs
export const getFCMTokens = async (userIds: string[]): Promise<string[]> => {
  try {
    const storageKeys = await getUserTokenStorageKeys(userIds);
    const snaps = await Promise.all(storageKeys.map((key) => get(ref(db, `fcmTokens/${key}`))));
    const tokens: string[] = [];

    snaps.forEach((snap) => {
      tokens.push(...extractTokensFromMap(snap.val()));
    });

    return [...new Set(tokens)];
  } catch (err) {
    console.warn("Failed to get FCM tokens:", err);
    return [];
  }
};

// Get ALL FCM tokens
export const getAllFCMTokens = async (): Promise<string[]> => {
  const tokens: string[] = [];
  try {
    const snap = await get(ref(db, "fcmTokens"));
    const data = snap.val();
    if (data) {
      Object.values(data).forEach((userTokens: any) => {
        tokens.push(...extractTokensFromMap(userTokens));
      });
    }
  } catch (err) {
    console.warn("Failed to get all FCM tokens:", err);
  }
  return [...new Set(tokens)];
};

type PushPayload = {
  title: string;
  body: string;
  image?: string;
  url?: string;
  icon?: string;
  badge?: string;
  data?: Record<string, string | number | boolean | null | undefined>;
};

export type PushProgress = {
  phase: "tokens" | "sending" | "cleanup" | "done";
  totalTokens: number;
  sent: number;
  success: number;
  failed: number;
  invalidRemoved: number;
  totalUsers?: number;
  failReasons?: { invalid: number; transient: number; other: number };
};

type SendFcmResult = {
  ok?: boolean;
  error?: string;
  totalTokens?: number;
  success?: number;
  failed?: number;
  invalidRemoved?: number;
  invalidTokens?: string[];
  failReasons?: { invalid: number; transient: number; other: number };
};

const postFcmRequest = async (
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs = 120000
): Promise<SendFcmResult> => {
  if (!endpoint) throw new Error("FCM endpoint is not configured");

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: buildFunctionHeaders(endpoint),
    body: JSON.stringify(body),
  }, timeoutMs);

  const raw = await response.text();
  let data: SendFcmResult = {};

  if (raw) {
    try {
      data = JSON.parse(raw) as SendFcmResult;
    } catch {
      if (!response.ok) {
        throw new Error(raw || `FCM request failed with ${response.status}`);
      }
    }
  }

  if (!response.ok) {
    throw new Error(data?.error || raw || `FCM request failed with ${response.status}`);
  }

  if (data?.ok === false) {
    throw new Error(data.error || "FCM endpoint returned ok=false");
  }

  return data;
};

const normalizePushData = (payload: PushPayload) => {
  const normalizedData: Record<string, string> = {};
  Object.entries(payload.data || {}).forEach(([key, value]) => {
    normalizedData[key] = value == null ? "" : String(value);
  });
  const publicUrl = resolvePublicUrl(payload.url);
  if (publicUrl) normalizedData.url = publicUrl;
  normalizedData.baseUrl = SITE_URL;
  return normalizedData;
};

const getPushEligibleUserIds = async (userIds: string[]): Promise<string[]> => {
  try {
    const snaps = await Promise.all(userIds.map((uid) => get(ref(db, `users/${uid}`))));
    return userIds.filter((uid, index) => {
      const user = snaps[index]?.val?.();
      if (!user) return true;
      if (user.pushEnabled === false) return false;
      if (user.pushPermission === "denied") return false;
      if (user.pushTokenState === "disabled") return false;
      return true;
    });
  } catch (err) {
    console.warn("Failed to filter push-eligible users:", err);
    return userIds;
  }
};

export const sendPushToTokens = async (
  tokens: string[],
  payload: PushPayload,
  onProgress?: (progress: PushProgress) => void
) => {
  const cleanTokens = [...new Set(tokens.filter(Boolean))];
  if (cleanTokens.length === 0) return { skipped: true, success: 0, failed: 0 };

  const normalizedData = normalizePushData(payload);

  const progress: PushProgress = {
    phase: "sending",
    totalTokens: cleanTokens.length,
    sent: 0,
    success: 0,
    failed: 0,
    invalidRemoved: 0,
  };
  onProgress?.(progress);

  const chunks = chunkArray(cleanTokens, CHUNK_SIZE);
  let nextIndex = 0;

  const aggregate = {
    success: 0,
    failed: 0,
    invalidTokens: new Set<string>(),
  };

  const worker = async () => {
    while (nextIndex < chunks.length) {
      const current = nextIndex++;
      const chunkTokens = chunks[current];

      try {
        const res = await requestWithRetry({
          tokens: chunkTokens,
          title: payload.title,
          body: payload.body,
          image: payload.image,
          icon: payload.icon || APP_ICON_URL,
          badge: payload.badge || APP_ICON_URL,
          data: normalizedData,
        });

        const data = await res.json().catch(() => ({}));
        aggregate.success += Number(data?.success || 0);
        aggregate.failed += Number(data?.failed || 0);

        if (Array.isArray(data?.invalidTokens)) {
          data.invalidTokens.forEach((token: string) => {
            if (token) aggregate.invalidTokens.add(token);
          });
        }
      } catch (err) {
        console.warn(`FCM chunk ${current + 1}/${chunks.length} failed:`, err);
        aggregate.failed += chunkTokens.length;
      }

      progress.sent = Math.min(cleanTokens.length, (current + 1) * CHUNK_SIZE);
      progress.success = aggregate.success;
      progress.failed = aggregate.failed;
      onProgress?.({ ...progress });
    }
  };

  await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, () => worker()));

  const invalidTokenList = [...aggregate.invalidTokens];
  progress.phase = "cleanup";
  onProgress?.({ ...progress });

  const removedInvalid = await cleanupInvalidTokens(invalidTokenList);

  progress.phase = "done";
  progress.invalidRemoved = removedInvalid;
  progress.sent = cleanTokens.length;
  progress.success = aggregate.success;
  progress.failed = aggregate.failed;
  onProgress?.({ ...progress });

  return {
    success: aggregate.success,
    failed: aggregate.failed,
    total: cleanTokens.length,
    invalidTokensRemoved: removedInvalid,
  };
};

export const sendPushToUsers = async (
  userIds: string[],
  payload: PushPayload,
  onProgress?: (progress: PushProgress) => void
) => {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  const eligibleUserIds = await getPushEligibleUserIds(uniqueUserIds);

  onProgress?.({
    phase: "tokens",
    totalTokens: 0,
    sent: 0,
    success: 0,
    failed: 0,
    invalidRemoved: 0,
    totalUsers: eligibleUserIds.length,
  });

  if (eligibleUserIds.length === 0) {
    onProgress?.({ phase: "done", totalTokens: 0, sent: 0, success: 0, failed: 0, invalidRemoved: 0, totalUsers: 0 });
    return { skipped: true, success: 0, failed: 0, total: 0, invalidTokensRemoved: 0, reason: "NO_TARGET_USERS" };
  }

  console.log(`[FCM] Resolving tokens for ${eligibleUserIds.length} target users on ${PRIMARY_SITE_ORIGIN}...`);
  const tokens = await getFCMTokens(eligibleUserIds);
  console.log(`[FCM] Found ${tokens.length} matching tokens for target users`);

  if (tokens.length === 0) {
    onProgress?.({
      phase: "done",
      totalTokens: 0,
      sent: 0,
      success: 0,
      failed: 0,
      invalidRemoved: 0,
      totalUsers: eligibleUserIds.length,
    });
    return { skipped: true, success: 0, failed: 0, total: 0, invalidTokensRemoved: 0, reason: "NO_TOKENS" };
  }

  const result = await sendPushToTokens(tokens, payload, (progress) => {
    onProgress?.({ ...progress, totalUsers: eligibleUserIds.length });
  });

  return {
    ...result,
    reason: result.total === 0 ? "NO_TOKENS" : undefined,
  };
};

export const sendPushToAllUsers = async (
  payload: PushPayload,
  onProgress?: (progress: PushProgress) => void
) => {
  onProgress?.({
    phase: "tokens",
    totalTokens: 0,
    sent: 0,
    success: 0,
    failed: 0,
    invalidRemoved: 0,
  });

  // Check if Supabase provider is active — if so, send userIds and let server fetch tokens
  const providerConfig = await getFcmProviderConfig();
  
  if (providerConfig.provider === "supabase" && providerConfig.url) {
    console.log("[FCM] Using Supabase provider — server-side token resolution");
    try {
      const usersSnap = await get(ref(db, "users"));
      const usersData = usersSnap.val() || {};
      const allUserIds: string[] = [];
      const seenIds = new Set<string>();
      
      Object.entries(usersData).forEach(([key, userData]: any) => {
        const effectiveId = String(userData?.id || key || "").trim();
        if (effectiveId && !seenIds.has(effectiveId)) {
          seenIds.add(effectiveId);
          allUserIds.push(effectiveId);
        }
      });

      const tokenSnap = await get(ref(db, "fcmTokens"));
      const tokenData = tokenSnap.val() || {};
      Object.keys(tokenData).forEach(key => {
        if (!seenIds.has(key)) {
          seenIds.add(key);
          allUserIds.push(key);
        }
      });

      onProgress?.({
        phase: "sending",
        totalTokens: 0,
        sent: 0,
        success: 0,
        failed: 0,
        invalidRemoved: 0,
        totalUsers: allUserIds.length,
      });

      const normalizedData = normalizePushData(payload);
      const uniqueUserIds = [...new Set(allUserIds.filter(Boolean))];
      const secondEndpoint = providerConfig.url2 && providerConfig.url2 !== providerConfig.url ? providerConfig.url2 : "";
      const splitIndex = secondEndpoint ? Math.ceil(uniqueUserIds.length / 2) : uniqueUserIds.length;
      const firstHalf = uniqueUserIds.slice(0, splitIndex);
      const secondHalf = secondEndpoint ? uniqueUserIds.slice(splitIndex) : [];

      const requestBodyBase = {
        title: payload.title,
        body: payload.body,
        image: payload.image,
        icon: payload.icon || APP_ICON_URL,
        badge: payload.badge || APP_ICON_URL,
        data: normalizedData,
      };

      const requests = [postFcmRequest(providerConfig.url, { ...requestBodyBase, userIds: firstHalf })];

      if (secondEndpoint && secondHalf.length > 0) {
        requests.push(postFcmRequest(secondEndpoint, { ...requestBodyBase, userIds: secondHalf }));
      }

      const results = await Promise.all(requests);

      const merged = results.reduce((acc, result) => {
        acc.totalTokens += Number(result.totalTokens || 0);
        acc.success += Number(result.success || 0);
        acc.failed += Number(result.failed || 0);
        acc.invalidRemoved += Number(result.invalidRemoved || 0);
        acc.failReasons.invalid += Number(result.failReasons?.invalid || 0);
        acc.failReasons.transient += Number(result.failReasons?.transient || 0);
        acc.failReasons.other += Number(result.failReasons?.other || 0);
        return acc;
      }, {
        totalTokens: 0,
        success: 0,
        failed: 0,
        invalidRemoved: 0,
        failReasons: { invalid: 0, transient: 0, other: 0 },
      });

      const finalProgress: PushProgress = {
        phase: "done",
        totalTokens: merged.totalTokens,
        sent: merged.totalTokens,
        success: merged.success,
        failed: merged.failed,
        invalidRemoved: merged.invalidRemoved,
        totalUsers: uniqueUserIds.length,
        failReasons: merged.failReasons,
      };
      onProgress?.(finalProgress);

      return {
        success: merged.success,
        failed: merged.failed,
        total: merged.totalTokens,
        invalidTokensRemoved: merged.invalidRemoved,
      };
    } catch (err: any) {
      console.error("[FCM] Supabase send failed:", err);
      onProgress?.({ phase: "done", totalTokens: 0, sent: 0, success: 0, failed: 0, invalidRemoved: 0 });
      throw err;
    }
  }

  // Cloudflare mode — client-side token resolution
  const tokens = await getAllFCMTokens();

  if (tokens.length === 0) {
    onProgress?.({
      phase: "done",
      totalTokens: 0,
      sent: 0,
      success: 0,
      failed: 0,
      invalidRemoved: 0,
    });
    return { skipped: true, success: 0, failed: 0, total: 0, invalidTokensRemoved: 0, reason: "NO_TOKENS" };
  }

  return sendPushToTokens(tokens, payload, onProgress);
};

// Listen for foreground messages
export const onForegroundMessage = (callback: (payload: any) => void) => {
  const msg = getMessagingInstance();
  if (!msg) return () => {};
  return onMessage(msg, callback);
};
