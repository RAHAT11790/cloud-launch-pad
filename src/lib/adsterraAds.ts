// ============================================
// Adsterra config layer — iframe-driven (see AdsterraAdManager.tsx).
//
// The previous version injected scripts straight into <body> and could
// not be confined or rate-limited because the network scripts attach
// document-level click listeners. We now host both ad slots inside
// sandboxed iframes mounted INSIDE the video player only. This file
// only exposes config + scope flags; all rendering / cooldown logic
// lives in AdsterraAdManager.tsx.
// ============================================
import { db, ref, get, onValue } from "@/lib/firebase";

declare global {
  interface Window {
    __adsterraPlayerScopeActive?: boolean;
    __adsterraPremium?: boolean;
  }
}

export type AdsterraConfig = {
  enabled: boolean;
  popunder: string;     // Direct Link / One-click popunder script snippet
  socialBar: string;    // Push Notification / Social Bar script snippet
  refreshIntervalSec: number; // cooldown between ad cycles (>=0)
};

const DEFAULT: AdsterraConfig = {
  enabled: true,
  popunder: "",
  socialBar: "",
  refreshIntervalSec: 60,
};

let cached: AdsterraConfig | null = null;
let cachedPromise: Promise<AdsterraConfig> | null = null;

function normalize(v: any): AdsterraConfig {
  const n = Number(v?.refreshIntervalSec);
  return {
    enabled: v?.enabled !== false,
    popunder: typeof v?.popunder === "string" ? v.popunder : "",
    socialBar: typeof v?.socialBar === "string" ? v.socialBar : "",
    refreshIntervalSec: Number.isFinite(n) && n >= 0 ? Math.min(n, 3600) : 60,
  };
}

export async function getAdsterraConfig(): Promise<AdsterraConfig> {
  if (cached) return cached;
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    try {
      const snap = await get(ref(db, "settings/adsterra"));
      cached = normalize(snap.val());
    } catch {
      cached = { ...DEFAULT };
    }
    cachedPromise = null;
    return cached!;
  })();
  return cachedPromise;
}

export function subscribeAdsterraConfig(cb: (c: AdsterraConfig) => void) {
  return onValue(ref(db, "settings/adsterra"), (snap) => {
    cached = normalize(snap.val());
    cb(cached);
  });
}

export function setAdsterraPremium(p: boolean) {
  if (typeof window !== "undefined") window.__adsterraPremium = !!p;
}

export function enterAdsterraPlayerScope() {
  if (typeof window !== "undefined") window.__adsterraPlayerScopeActive = true;
}

export function exitAdsterraPlayerScope() {
  if (typeof window !== "undefined") window.__adsterraPlayerScopeActive = false;
}

// Back-compat no-op: rendering is now handled by AdsterraAdManager component.
export async function loadAdsterraSlots(): Promise<void> { /* no-op */ }
