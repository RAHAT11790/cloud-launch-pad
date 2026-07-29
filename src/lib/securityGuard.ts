// ============================================================
// securityGuard — Admin access logging, intruder blocking, owner immunity
// ============================================================
import { db, ref, push, set, get, remove, update, onValue } from "@/lib/firebase";
import { getDeviceFingerprint } from "@/lib/premiumDevice";

// Hard-coded owner emails — these accounts can NEVER be blocked.
// Even if a malicious admin tries to add them to `adminAccess/blocked`,
// the guard ignores those records for these emails.
export const OWNER_EMAILS: string[] = [
  "rahatsarker224@gmail.com",
  "sarkeremon207@gmail.com",
];

export const isOwnerEmail = (email?: string | null): boolean => {
  if (!email) return false;
  return OWNER_EMAILS.includes(email.trim().toLowerCase());
};

type Geo = { ip?: string; country?: string; city?: string };

let cachedGeo: Geo | null = null;
let geoPromise: Promise<Geo> | null = null;

export const fetchGeo = async (): Promise<Geo> => {
  if (cachedGeo) return cachedGeo;
  if (geoPromise) return geoPromise;
  geoPromise = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch("https://ipapi.co/json/", { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error("geo fail");
      const j = await res.json();
      cachedGeo = { ip: j.ip, country: j.country_name || j.country, city: j.city };
      return cachedGeo;
    } catch {
      cachedGeo = {};
      return cachedGeo;
    } finally {
      geoPromise = null;
    }
  })();
  return geoPromise;
};

export type AdminAccessLog = {
  email?: string;
  name?: string;
  method: "pin" | "google" | "session";
  success: boolean;
  reason?: string;
  ip?: string;
  country?: string;
  city?: string;
  ua?: string;
  fingerprint?: string;
  ts: number;
};

/**
 * Record a known display name for the current device fingerprint so the
 * Security Center can render a human-readable identity next to the raw
 * fingerprint. Called once after a successful Google login.
 */
export const rememberDeviceName = async (name?: string | null, email?: string | null) => {
  try {
    const fp = getDeviceFingerprint();
    if (!fp) return;
    await set(ref(db, `adminAccess/devices/${fp}`), {
      name: name || null,
      email: email?.trim().toLowerCase() || null,
      ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
      lastSeen: Date.now(),
    });
  } catch (e) {
    console.warn("[securityGuard] rememberDeviceName failed", e);
  }
};

const getDeviceName = async (fp: string): Promise<string | undefined> => {
  try {
    const snap = await get(ref(db, `adminAccess/devices/${fp}`));
    return snap.val()?.name || undefined;
  } catch {
    return undefined;
  }
};

export const logAdminAccess = async (entry: Omit<AdminAccessLog, "ts" | "fingerprint" | "ua" | "ip" | "country" | "city" | "name"> & { name?: string }) => {
  try {
    const geo = await fetchGeo();
    const fp = getDeviceFingerprint();
    const name = entry.name || (fp ? await getDeviceName(fp) : undefined);
    const payload: AdminAccessLog = {
      ...entry,
      email: entry.email?.trim().toLowerCase(),
      name,
      ts: Date.now(),
      fingerprint: fp,
      ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
      ip: geo.ip,
      country: geo.country,
      city: geo.city,
    };
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    ) as AdminAccessLog;
    await push(ref(db, "adminAccess/logs"), cleanPayload);
  } catch (e) {
    // swallow — never block login on logging failure
    console.warn("[securityGuard] log failed", e);
  }
};

export type BlockEntry = {
  type: "email" | "ip" | "fingerprint";
  value: string;
  reason?: string;
  blockedAt: number;
  blockedBy?: string;
};

/**
 * Check if current visitor (email + ip + fingerprint) is blocked.
 * Owner emails ALWAYS pass.
 */
export const isBlocked = async (email?: string | null): Promise<{ blocked: boolean; reason?: string }> => {
  if (isOwnerEmail(email)) return { blocked: false };
  try {
    const snap = await get(ref(db, "adminAccess/blocked"));
    const list: Record<string, BlockEntry> = snap.val() || {};
    if (!Object.keys(list).length) return { blocked: false };
    const fp = getDeviceFingerprint();
    const geo = await fetchGeo();
    const normEmail = email?.trim().toLowerCase();
    for (const entry of Object.values(list)) {
      if (!entry?.value) continue;
      if (entry.type === "email" && normEmail && entry.value.toLowerCase() === normEmail) {
        return { blocked: true, reason: entry.reason || "Email blocked" };
      }
      if (entry.type === "fingerprint" && entry.value === fp) {
        return { blocked: true, reason: entry.reason || "Device blocked" };
      }
      if (entry.type === "ip" && geo.ip && entry.value === geo.ip) {
        return { blocked: true, reason: entry.reason || "IP blocked" };
      }
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
};

export const addBlock = async (entry: Omit<BlockEntry, "blockedAt">, blockedBy?: string) => {
  // Refuse to block owner emails — defence in depth.
  if (entry.type === "email" && isOwnerEmail(entry.value)) {
    throw new Error("Cannot block the owner account.");
  }
  const node = await push(ref(db, "adminAccess/blocked"), {
    ...entry,
    value: entry.value.trim().toLowerCase(),
    blockedAt: Date.now(),
    blockedBy: blockedBy || "admin",
  });
  return node.key;
};

export const removeBlock = async (key: string) => {
  await remove(ref(db, `adminAccess/blocked/${key}`));
};

export const subscribeLogs = (cb: (logs: Record<string, AdminAccessLog>) => void) => {
  const r = ref(db, "adminAccess/logs");
  return onValue(r, (snap) => cb(snap.val() || {}));
};

export const subscribeBlocks = (cb: (blocks: Record<string, BlockEntry>) => void) => {
  const r = ref(db, "adminAccess/blocked");
  return onValue(r, (snap) => cb(snap.val() || {}));
};

export const clearOldLogs = async (olderThanMs = 30 * 24 * 60 * 60 * 1000): Promise<number> => {
  const snap = await get(ref(db, "adminAccess/logs"));
  const all: Record<string, AdminAccessLog> = snap.val() || {};
  const cutoff = Date.now() - olderThanMs;
  const updates: Record<string, null> = {};
  Object.entries(all).forEach(([k, v]) => {
    if ((v?.ts || 0) < cutoff) updates[`adminAccess/logs/${k}`] = null;
  });
  const count = Object.keys(updates).length;
  if (count) await update(ref(db), updates);
  return count;
};

/**
 * Wipe EVERY login log entry. Use when the log table has grown huge.
 */
export const clearAllLogs = async (): Promise<number> => {
  const snap = await get(ref(db, "adminAccess/logs"));
  const all: Record<string, AdminAccessLog> = snap.val() || {};
  const count = Object.keys(all).length;
  if (count) await remove(ref(db, "adminAccess/logs"));
  return count;
};

/**
 * Global admin sign-out marker. Every admin device subscribes to this key;
 * when the timestamp is newer than the device's local `rs_admin_session.ts`,
 * that device force-clears its session and reloads.
 * Owner emails are exempt from the auto-logout for the CURRENT device only if
 * they re-login within the same second; otherwise they log out too (intended).
 */
export const setGlobalAdminLogout = async (): Promise<number> => {
  const ts = Date.now();
  await set(ref(db, "adminAccess/globalLogoutTs"), ts);
  return ts;
};

export const subscribeGlobalLogout = (cb: (ts: number) => void) => {
  return onValue(ref(db, "adminAccess/globalLogoutTs"), (snap) => {
    const v = snap.val();
    cb(typeof v === "number" ? v : 0);
  });
};

