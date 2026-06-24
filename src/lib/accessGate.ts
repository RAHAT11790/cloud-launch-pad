// Access Gate — time-limited ad-free pass.
// User clears the gate page once → granted N hours of player access.
import { db, ref, onValue, get, set, remove } from "@/lib/firebase";
import { getDeviceId } from "@/lib/premiumDevice";

export type AccessGateConfig = {
  enabled: boolean;
  directLink: string;
  nativeBanner: string;
  banner160x300: string;
  popunder: string;
  socialBar: string;
  clicksRequired: number;
  dwellSeconds: number;
  accessHours: number;
};

export const DEFAULT_GATE_CONFIG: AccessGateConfig = {
  enabled: false,
  directLink: "",
  nativeBanner: "",
  banner160x300: "",
  popunder: "",
  socialBar: "",
  clicksRequired: 5,
  dwellSeconds: 10,
  accessHours: 6,
};

const STORAGE_KEY = "rsanime_gate_access_until";
const PROGRESS_KEY = "rsanime_gate_progress";

const getCurrentUserId = (): string | null => {
  try {
    const raw = localStorage.getItem("rsanime_user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.id || parsed?.uid || null;
  } catch { return null; }
};

const deviceScopedKey = (base: string) => {
  try { return `${base}_${getDeviceId()}`; } catch { return base; }
};

const identityScopedKey = (base: string) => {
  const uid = getCurrentUserId();
  return uid ? `${base}_user_${uid}` : deviceScopedKey(base);
};

function normalize(v: any): AccessGateConfig {
  return {
    enabled: !!v?.enabled,
    directLink: String(v?.directLink || "").trim(),
    nativeBanner: String(v?.nativeBanner || "").trim(),
    banner160x300: String(v?.banner160x300 || "").trim(),
    popunder: String(v?.popunder || "").trim(),
    socialBar: String(v?.socialBar || "").trim(),
    clicksRequired: Math.max(1, Math.min(50, Number(v?.clicksRequired) || 5)),
    dwellSeconds: Math.max(1, Math.min(120, Number(v?.dwellSeconds) || 10)),
    accessHours: Math.max(0.1, Math.min(168, Number(v?.accessHours) || 6)),
  };
}

let cached: AccessGateConfig | null = null;

export async function getGateConfig(): Promise<AccessGateConfig> {
  if (cached) return cached;
  try {
    const snap = await get(ref(db, "settings/accessGate"));
    cached = normalize(snap.val());
  } catch {
    cached = { ...DEFAULT_GATE_CONFIG };
  }
  return cached!;
}

export function subscribeGateConfig(cb: (c: AccessGateConfig) => void) {
  return onValue(ref(db, "settings/accessGate"), (snap) => {
    cached = normalize(snap.val());
    cb(cached);
  });
}

export function hasGateAccess(): boolean {
  try {
    const uid = getCurrentUserId();
    const v = uid
      ? Number(localStorage.getItem(identityScopedKey(STORAGE_KEY)) || "0")
      : Math.max(
          Number(localStorage.getItem(deviceScopedKey(STORAGE_KEY)) || "0"),
          Number(localStorage.getItem(STORAGE_KEY) || "0"),
        );
    return v > Date.now();
  } catch { return false; }
}

export async function grantGateAccess(hours: number) {
  try {
    const uid = getCurrentUserId();
    const until = Date.now() + Math.max(0.1, hours) * 3600 * 1000;
    const now = Date.now();
    if (uid) {
      localStorage.setItem(identityScopedKey(STORAGE_KEY), String(until));
      localStorage.removeItem(identityScopedKey(PROGRESS_KEY));
      await set(ref(db, `users/${uid}/freeAccess`), {
        active: true,
        grantedAt: now,
        expiresAt: until,
        viaToken: "access-gate",
        serviceId: "access-gate",
      });
    } else {
      localStorage.setItem(deviceScopedKey(STORAGE_KEY), String(until));
      localStorage.setItem(STORAGE_KEY, String(until));
      localStorage.removeItem(PROGRESS_KEY);
      localStorage.removeItem(deviceScopedKey(PROGRESS_KEY));
    }
  } catch {}
}

export function clearGateAccess() {
  try {
    const uid = getCurrentUserId();
    if (uid) {
      localStorage.removeItem(identityScopedKey(STORAGE_KEY));
      localStorage.removeItem(identityScopedKey(PROGRESS_KEY));
      remove(ref(db, `users/${uid}/freeAccess`)).catch(() => {});
    }
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(deviceScopedKey(STORAGE_KEY));
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(deviceScopedKey(PROGRESS_KEY));
  } catch {}
}

export function getGateAccessUntil(): number {
  try {
    const uid = getCurrentUserId();
    if (uid) return Number(localStorage.getItem(identityScopedKey(STORAGE_KEY)) || "0");
    return Math.max(Number(localStorage.getItem(deviceScopedKey(STORAGE_KEY)) || "0"), Number(localStorage.getItem(STORAGE_KEY) || "0"));
  } catch { return 0; }
}

export function getGateProgress(): number {
  try {
    const uid = getCurrentUserId();
    if (uid) return Math.max(0, Number(localStorage.getItem(identityScopedKey(PROGRESS_KEY)) || "0"));
    return Math.max(0, Number(localStorage.getItem(deviceScopedKey(PROGRESS_KEY)) || "0"), Number(localStorage.getItem(PROGRESS_KEY) || "0"));
  } catch { return 0; }
}

export function setGateProgress(n: number) {
  try {
    const uid = getCurrentUserId();
    const next = String(Math.max(0, n));
    if (uid) localStorage.setItem(identityScopedKey(PROGRESS_KEY), next);
    else {
      localStorage.setItem(deviceScopedKey(PROGRESS_KEY), next);
      localStorage.setItem(PROGRESS_KEY, next);
    }
  } catch {}
}
