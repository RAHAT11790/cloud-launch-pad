// ============================================
// Monetag Ads — popunder (once per session) + direct link (cooldown)
// Active only inside the video player route.
// ============================================
import { db, ref, get, onValue } from "@/lib/firebase";

declare global {
  interface Window {
    __mtPopShown?: boolean;
    __mtDirectLastTs?: number;
  }
}

type MonetagConfig = {
  enabled: boolean;
  popunderSrc: string;       // full <script src> URL from Monetag dashboard
  directLinkUrl: string;     // direct link URL from Monetag
  directCooldownSec: number; // minimum seconds between direct-link triggers
};

const DEFAULT_CONFIG: MonetagConfig = {
  enabled: true,
  popunderSrc: "",
  directLinkUrl: "",
  directCooldownSec: 60,
};

let cached: MonetagConfig | null = null;

export async function getMonetagConfig(): Promise<MonetagConfig> {
  if (cached) return cached;
  try {
    const snap = await get(ref(db, "settings/monetag"));
    const v = snap.val() || {};
    cached = {
      enabled: v.enabled !== false,
      popunderSrc: String(v.popunderSrc || "").trim(),
      directLinkUrl: String(v.directLinkUrl || "").trim(),
      directCooldownSec: Number(v.directCooldownSec) > 0 ? Number(v.directCooldownSec) : 60,
    };
  } catch {
    cached = { ...DEFAULT_CONFIG };
  }
  return cached;
}

export function subscribeMonetagConfig(cb: (c: MonetagConfig) => void) {
  return onValue(ref(db, "settings/monetag"), (snap) => {
    const v = snap.val() || {};
    cached = {
      enabled: v.enabled !== false,
      popunderSrc: String(v.popunderSrc || "").trim(),
      directLinkUrl: String(v.directLinkUrl || "").trim(),
      directCooldownSec: Number(v.directCooldownSec) > 0 ? Number(v.directCooldownSec) : 60,
    };
    cb(cached);
  });
}

const POP_FLAG = "mt_pop_loaded";
const POP_ATTR = "data-mt-pop";

/**
 * Load Monetag popunder script ONCE per session.
 * Triple guard: window flag → sessionStorage → DOM duplicate check.
 */
export async function loadPopunderOnce(): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.__mtPopShown) return;
  try {
    if (sessionStorage.getItem(POP_FLAG) === "1") {
      window.__mtPopShown = true;
      return;
    }
  } catch {}
  if (document.querySelector(`script[${POP_ATTR}="1"]`)) {
    window.__mtPopShown = true;
    return;
  }
  const cfg = await getMonetagConfig();
  if (!cfg.enabled || !cfg.popunderSrc) return;

  // Mark BEFORE injecting so any re-entrancy is blocked
  window.__mtPopShown = true;
  try { sessionStorage.setItem(POP_FLAG, "1"); } catch {}

  const s = document.createElement("script");
  s.src = cfg.popunderSrc;
  s.async = true;
  s.setAttribute(POP_ATTR, "1");
  s.dataset.cfasync = "false";
  s.referrerPolicy = "no-referrer";
  document.head.appendChild(s);
}

/**
 * Trigger Monetag direct link on user tap inside video player.
 * Rate-limited by directCooldownSec.
 * Returns true if a tab was opened (so caller can skip default behavior if needed).
 */
export async function triggerDirectLink(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const cfg = await getMonetagConfig();
  if (!cfg.enabled || !cfg.directLinkUrl) return false;

  const now = Date.now();
  const last = window.__mtDirectLastTs || 0;
  if (now - last < cfg.directCooldownSec * 1000) return false;
  window.__mtDirectLastTs = now;

  try {
    const w = window.open(cfg.directLinkUrl, "_blank", "noopener,noreferrer");
    if (!w) {
      // Popup blocked — silently ignore
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function resetMonetagSession() {
  try { sessionStorage.removeItem(POP_FLAG); } catch {}
  if (typeof window !== "undefined") {
    window.__mtPopShown = false;
    window.__mtDirectLastTs = 0;
  }
}
