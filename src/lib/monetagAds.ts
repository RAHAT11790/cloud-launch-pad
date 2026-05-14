// ============================================
// Monetag Ads — multi-slot loader with premium gate + anti-adblock fallback
// Active ONLY inside the video player route AND ONLY for non-premium users.
// ============================================
import { db, ref, get, onValue } from "@/lib/firebase";

declare global {
  interface Window {
    __mtSlotsLoaded?: Record<string, boolean>;
    __mtDirectLastTs?: number;
    __mtPremium?: boolean;
  }
}

// Every Monetag "format" you can get from the dashboard.
// Each one is just a <script src="..."> snippet from Monetag (or a Direct Link URL).
export type MonetagSlotKey =
  | "popunder"        // Classic Pop-Under (script src) — fires on user gesture, once per session
  | "onclickPop"      // OnClick Pop-Under (script src) — fires on every click (we throttle)
  | "inPagePush"      // In-Page Push (script src) — slide-in notification
  | "nativeBanner"    // Native Banner (script src) — content-style ad block
  | "vignette"        // Vignette Banner / Interstitial (script src)
  | "smartBanner"     // Smart / Sticky Banner (script src)
  | "directLink"      // Direct Link URL (open in new tab on tap, with cooldown)
  | "custom1"         // Free-form raw <script> snippet (any provider)
  | "custom2"
  | "custom3";

export type MonetagSlot = {
  enabled: boolean;
  // For script-based slots: full URL of the Monetag script (e.g. https://al5sm.com/tag.min.js)
  // For directLink: the destination URL
  src?: string;
  // Optional dataset attributes Monetag asks for (e.g. zone, domain). Stored as JSON object.
  data?: Record<string, string | number>;
  // For custom slots: full raw HTML/script snippet to inject as-is
  raw?: string;
  // Per-slot cooldown (seconds) — used by directLink + onclickPop
  cooldownSec?: number;
};

export type MonetagConfig = {
  enabled: boolean;
  slots: Partial<Record<MonetagSlotKey, MonetagSlot>>;
};

const DEFAULT_CONFIG: MonetagConfig = { enabled: true, slots: {} };

let cached: MonetagConfig | null = null;
let cachedPromise: Promise<MonetagConfig> | null = null;

function normalize(v: any): MonetagConfig {
  const slots: MonetagConfig["slots"] = {};
  const raw = (v && v.slots) || {};
  for (const k of Object.keys(raw)) {
    const s = raw[k] || {};
    slots[k as MonetagSlotKey] = {
      enabled: s.enabled !== false,
      src: typeof s.src === "string" ? s.src.trim() : "",
      data: typeof s.data === "object" && s.data ? s.data : undefined,
      raw: typeof s.raw === "string" ? s.raw : "",
      cooldownSec: Number(s.cooldownSec) > 0 ? Number(s.cooldownSec) : undefined,
    };
  }
  return { enabled: v?.enabled !== false, slots };
}

export async function getMonetagConfig(): Promise<MonetagConfig> {
  if (cached) return cached;
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    try {
      const snap = await get(ref(db, "settings/monetag"));
      cached = normalize(snap.val());
    } catch {
      cached = { ...DEFAULT_CONFIG };
    }
    return cached!;
  })();
  return cachedPromise;
}

export function subscribeMonetagConfig(cb: (c: MonetagConfig) => void) {
  return onValue(ref(db, "settings/monetag"), (snap) => {
    cached = normalize(snap.val());
    cb(cached);
  });
}

export function setPremium(isPremium: boolean) {
  if (typeof window !== "undefined") window.__mtPremium = !!isPremium;
}

function premiumActive(): boolean {
  return typeof window !== "undefined" && window.__mtPremium === true;
}

function slotMarker(key: string) {
  if (typeof window === "undefined") return false;
  if (!window.__mtSlotsLoaded) window.__mtSlotsLoaded = {};
  if (window.__mtSlotsLoaded[key]) return true;
  window.__mtSlotsLoaded[key] = true;
  return false;
}

// ----------------------------------------------------------------
// Anti-adblock loader.
// Strategy: try direct <script src=...> first. If onerror fires within
// 2.5s (most common adblock signal), refetch the file via fetch() and
// inject as an inline blob script. Adblockers that only filter by URL
// will be bypassed; those that scan content may still block — Monetag's
// own service worker (already registered at /sw.js) handles the rest.
// ----------------------------------------------------------------
async function loadScriptResilient(
  url: string,
  dataAttrs?: Record<string, string | number>,
  attr: string = "data-mt-x"
): Promise<boolean> {
  if (!url || typeof document === "undefined") return false;

  // Direct injection first
  const direct = await new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    try {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.referrerPolicy = "no-referrer";
      s.setAttribute(attr, "1");
      s.dataset.cfasync = "false";
      if (dataAttrs) {
        for (const k of Object.keys(dataAttrs)) {
          try { s.setAttribute(`data-${k}`, String(dataAttrs[k])); } catch {}
        }
      }
      s.onload = () => finish(true);
      s.onerror = () => finish(false);
      (document.body || document.documentElement).appendChild(s);
      // Safety timeout — adblockers that silently drop the request
      setTimeout(() => finish(false), 2500);
    } catch {
      finish(false);
    }
  });
  if (direct) return true;

  // Fallback: fetch + blob inject (bypasses URL-based filters)
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) return false;
    const code = await res.text();
    if (!code || code.length < 8) return false;
    const blob = new Blob([code], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    return await new Promise<boolean>((resolve) => {
      const s = document.createElement("script");
      s.src = blobUrl;
      s.async = true;
      s.setAttribute(attr, "2");
      s.dataset.cfasync = "false";
      if (dataAttrs) {
        for (const k of Object.keys(dataAttrs)) {
          try { s.setAttribute(`data-${k}`, String(dataAttrs[k])); } catch {}
        }
      }
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      (document.body || document.documentElement).appendChild(s);
      setTimeout(() => resolve(true), 1500);
    });
  } catch {
    return false;
  }
}

async function injectRawSnippet(html: string, attr: string): Promise<void> {
  if (!html || typeof document === "undefined") return;
  try {
    const wrapper = document.createElement("div");
    wrapper.setAttribute(attr, "1");
    wrapper.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
    // Parse and re-create script tags so they actually execute
    wrapper.innerHTML = html;
    const scripts = Array.from(wrapper.querySelectorAll("script"));
    for (const old of scripts) {
      const ns = document.createElement("script");
      for (const a of Array.from(old.attributes)) ns.setAttribute(a.name, a.value);
      ns.text = old.text;
      old.replaceWith(ns);
    }
    document.body.appendChild(wrapper);
  } catch {}
}

// ---- Public API ------------------------------------------------

/**
 * Load all "ambient" Monetag slots (popunder, in-page push, native, vignette,
 * smart banner, custom). Skipped entirely for premium users.
 */
export async function loadAmbientSlots(): Promise<void> {
  if (typeof window === "undefined") return;
  if (premiumActive()) return;
  const cfg = await getMonetagConfig();
  if (!cfg.enabled) return;

  const ambientKeys: MonetagSlotKey[] = [
    "popunder", "inPagePush", "nativeBanner", "vignette", "smartBanner",
    "custom1", "custom2", "custom3",
  ];

  for (const key of ambientKeys) {
    const slot = cfg.slots[key];
    if (!slot || slot.enabled === false) continue;
    if (slotMarker(`mt_${key}`)) continue;

    // Custom slots accept raw HTML
    if ((key === "custom1" || key === "custom2" || key === "custom3") && slot.raw) {
      injectRawSnippet(slot.raw, `data-mt-${key}`);
      continue;
    }
    if (slot.src) {
      // fire-and-forget
      loadScriptResilient(slot.src, slot.data, `data-mt-${key}`);
    }
  }
}

/**
 * Click-driven slot: trigger direct link or onclick popunder on user gesture.
 * Cooldown enforced. Premium → no-op.
 */
export async function triggerClickSlots(): Promise<void> {
  if (typeof window === "undefined") return;
  if (premiumActive()) return;

  const cfg = await getMonetagConfig();
  if (!cfg.enabled) return;

  const now = Date.now();
  const last = window.__mtDirectLastTs || 0;

  // OnClick popunder script — load once on first user gesture
  const onclick = cfg.slots.onclickPop;
  if (onclick && onclick.enabled !== false && onclick.src && !slotMarker("mt_onclickPop")) {
    loadScriptResilient(onclick.src, onclick.data, "data-mt-onclickPop");
  }

  // Direct link — open in new tab, cooldown
  const dl = cfg.slots.directLink;
  if (dl && dl.enabled !== false && dl.src) {
    const cd = (dl.cooldownSec || 60) * 1000;
    if (now - last >= cd) {
      window.__mtDirectLastTs = now;
      try { window.open(dl.src, "_blank", "noopener,noreferrer"); } catch {}
    }
  }
}

// Back-compat aliases (older code paths)
export const loadPopunderOnce = loadAmbientSlots;
export const triggerDirectLink = async (): Promise<boolean> => {
  await triggerClickSlots();
  return true;
};

export function resetMonetagSession() {
  if (typeof window !== "undefined") {
    window.__mtSlotsLoaded = {};
    window.__mtDirectLastTs = 0;
  }
}
