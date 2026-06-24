// Access Gate — time-limited ad-free pass.
// User clears the gate page once → granted N hours of player access.
import { db, ref, onValue, get } from "@/lib/firebase";
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

const deviceScopedKey = (base: string) => {
  try { return `${base}_${getDeviceId()}`; } catch { return base; }
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
    const v = Math.max(
      Number(localStorage.getItem(deviceScopedKey(STORAGE_KEY)) || "0"),
      Number(localStorage.getItem(STORAGE_KEY) || "0"),
    );
    return v > Date.now();
  } catch { return false; }
}

export function grantGateAccess(hours: number) {
  try {
    const until = Date.now() + Math.max(0.1, hours) * 3600 * 1000;
    localStorage.setItem(deviceScopedKey(STORAGE_KEY), String(until));
    localStorage.setItem(STORAGE_KEY, String(until));
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(deviceScopedKey(PROGRESS_KEY));
  } catch {}
}

export function clearGateAccess() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(deviceScopedKey(STORAGE_KEY));
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(deviceScopedKey(PROGRESS_KEY));
  } catch {}
}

export function getGateAccessUntil(): number {
  try {
    return Math.max(
      Number(localStorage.getItem(deviceScopedKey(STORAGE_KEY)) || "0"),
      Number(localStorage.getItem(STORAGE_KEY) || "0"),
    );
  } catch { return 0; }
}

export function getGateProgress(): number {
  try {
    return Math.max(
      0,
      Number(localStorage.getItem(deviceScopedKey(PROGRESS_KEY)) || "0"),
      Number(localStorage.getItem(PROGRESS_KEY) || "0"),
    );
  } catch { return 0; }
}

export function setGateProgress(n: number) {
  try {
    const next = String(Math.max(0, n));
    localStorage.setItem(deviceScopedKey(PROGRESS_KEY), next);
    localStorage.setItem(PROGRESS_KEY, next);
  } catch {}
}
