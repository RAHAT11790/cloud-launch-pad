// Monetag Ads Loader
// Admin-controlled, premium-gated ad system
// Supports 7 formats: multitag, banner, in_page_push, push_notifications, vignette, direct_link, onclick
import { db, ref, get, onValue } from "@/lib/firebase";

export type MonetagFormat =
  | "multitag"
  | "banner"
  | "in_page_push"
  | "push_notifications"
  | "vignette"
  | "direct_link"
  | "onclick";

export type MonetagPlacement = "home" | "details" | "player" | "search";

export interface MonetagFormatConfig {
  enabled: boolean;
  zoneId?: string;
  scriptCode?: string; // raw <script>...</script> content (without script tags)
  domain?: string; // for SW push (e.g., "3nbf4.com")
  swZoneId?: number; // service worker zone id
  swPath?: string; // e.g., "/act/files/service-worker.min.js?r=sw"
  placements?: MonetagPlacement[]; // where to show (banner/in_page_push/vignette/direct_link)
  directLinkUrl?: string; // for direct_link
}

export interface MonetagSettings {
  masterEnabled: boolean;
  shortenerEnabled: boolean; // master switch for ad-link shortener system
  formats: Partial<Record<MonetagFormat, MonetagFormatConfig>>;
}

const DEFAULT_SETTINGS: MonetagSettings = {
  masterEnabled: false,
  shortenerEnabled: true,
  formats: {},
};

// ---- Premium check ----
async function isCurrentUserPremium(): Promise<boolean> {
  try {
    const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
    if (!u?.id) return false;
    const snap = await get(ref(db, `users/${u.id}/premium`));
    const data = snap.val();
    return !!(data && data.active === true && data.expiresAt > Date.now());
  } catch {
    return false;
  }
}

// ---- Settings cache ----
let cachedSettings: MonetagSettings | null = null;
let settingsListenerInitialized = false;

export function subscribeMonetagSettings(cb: (s: MonetagSettings) => void): () => void {
  const r = ref(db, "settings/monetagAds");
  const unsub = onValue(r, (snap) => {
    const val = snap.val() || {};
    const merged: MonetagSettings = {
      masterEnabled: !!val.masterEnabled,
      shortenerEnabled: val.shortenerEnabled !== false,
      formats: val.formats || {},
    };
    cachedSettings = merged;
    cb(merged);
  });
  settingsListenerInitialized = true;
  return unsub;
}

export async function getMonetagSettings(): Promise<MonetagSettings> {
  if (cachedSettings) return cachedSettings;
  try {
    const snap = await get(ref(db, "settings/monetagAds"));
    const val = snap.val() || {};
    cachedSettings = {
      masterEnabled: !!val.masterEnabled,
      shortenerEnabled: val.shortenerEnabled !== false,
      formats: val.formats || {},
    };
    return cachedSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ---- Script injection helpers ----
const injectedFormats = new Set<MonetagFormat>();

function injectRawScript(code: string, idTag: string): boolean {
  if (document.getElementById(idTag)) return false;
  try {
    // Wrap & execute the user-pasted snippet (could be either a raw <script> tag or just JS)
    const wrapper = document.createElement("div");
    wrapper.innerHTML = code.includes("<script") ? code : `<script>${code}</script>`;
    const scripts = wrapper.querySelectorAll("script");
    scripts.forEach((old, i) => {
      const s = document.createElement("script");
      // copy attributes
      Array.from(old.attributes).forEach((a) => s.setAttribute(a.name, a.value));
      if (old.textContent) s.textContent = old.textContent;
      if (i === 0) s.id = idTag;
      document.body.appendChild(s);
    });
    return true;
  } catch (e) {
    console.warn("[Monetag] inject failed:", e);
    return false;
  }
}

// ---- Public API ----

/**
 * Initialize global Monetag SDK & site-wide formats (multitag, push, onclick).
 * Premium users get ZERO ads — bails out immediately.
 * Call once on app boot.
 */
export async function initMonetag(): Promise<void> {
  // PREMIUM = NO ADS, EVER
  if (await isCurrentUserPremium()) {
    if (typeof window !== "undefined") (window as any).__MONETAG_BLOCKED__ = true;
    return;
  }

  const settings = await getMonetagSettings();
  if (!settings.masterEnabled) return;

  // Multitag (all-in-one) — runs site-wide
  const multi = settings.formats.multitag;
  if (multi?.enabled && multi.scriptCode && !injectedFormats.has("multitag")) {
    if (injectRawScript(multi.scriptCode, "monetag-multitag")) injectedFormats.add("multitag");
  }

  // Onclick / Popunder — site-wide
  const oc = settings.formats.onclick;
  if (oc?.enabled && oc.scriptCode && !injectedFormats.has("onclick")) {
    if (injectRawScript(oc.scriptCode, "monetag-onclick")) injectedFormats.add("onclick");
  }

  // Push Notifications (Service Worker registration)
  const push = settings.formats.push_notifications;
  if (push?.enabled && push.domain && push.swZoneId && "serviceWorker" in navigator) {
    try {
      const swPath = push.swPath || "/act/files/service-worker.min.js?r=sw";
      const fullSwUrl = `https://${push.domain}${swPath.startsWith("/") ? "" : "/"}${swPath}`;
      // Monetag SW is hosted on their domain — register from same-origin proxy (firebase-messaging-sw.js handles it)
      // Just store config; FB messaging SW will pick it up.
      sessionStorage.setItem("monetag_push", JSON.stringify({
        domain: push.domain,
        zoneId: push.swZoneId,
        swUrl: fullSwUrl,
      }));
    } catch (e) {
      console.warn("[Monetag] push setup failed:", e);
    }
  }
}

/**
 * Render a placement-specific ad format.
 * Premium users see nothing.
 */
export async function renderPlacementAd(
  placement: MonetagPlacement,
  containerId: string
): Promise<void> {
  if (await isCurrentUserPremium()) return;
  const settings = await getMonetagSettings();
  if (!settings.masterEnabled) return;

  const formatsToCheck: MonetagFormat[] = ["banner", "in_page_push", "vignette", "direct_link"];
  for (const fmt of formatsToCheck) {
    const cfg = settings.formats[fmt];
    if (!cfg?.enabled) continue;
    const allowed = cfg.placements && cfg.placements.length > 0
      ? cfg.placements.includes(placement)
      : false;
    if (!allowed) continue;
    if (!cfg.scriptCode) continue;

    const tagId = `monetag-${fmt}-${placement}-${containerId}`;
    if (document.getElementById(tagId)) continue;
    const container = document.getElementById(containerId);
    if (!container) continue;

    try {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = cfg.scriptCode.includes("<script")
        ? cfg.scriptCode
        : `<script>${cfg.scriptCode}</script>`;
      const scripts = wrapper.querySelectorAll("script");
      scripts.forEach((old, i) => {
        const s = document.createElement("script");
        Array.from(old.attributes).forEach((a) => s.setAttribute(a.name, a.value));
        if (old.textContent) s.textContent = old.textContent;
        if (i === 0) s.id = tagId;
        container.appendChild(s);
      });
    } catch (e) {
      console.warn(`[Monetag] ${fmt} render failed:`, e);
    }
  }
}

/**
 * Get configured Direct Link URL (for "open ad" buttons), if enabled & placement allowed.
 */
export async function getMonetagDirectLink(placement: MonetagPlacement): Promise<string | null> {
  if (await isCurrentUserPremium()) return null;
  const settings = await getMonetagSettings();
  if (!settings.masterEnabled) return null;
  const dl = settings.formats.direct_link;
  if (!dl?.enabled || !dl.directLinkUrl) return null;
  if (dl.placements && dl.placements.length > 0 && !dl.placements.includes(placement)) return null;
  return dl.directLinkUrl;
}

/** Check shortener master state — if false, free users get instant access (no ad gate). */
export async function isShortenerEnabled(): Promise<boolean> {
  const settings = await getMonetagSettings();
  return settings.shortenerEnabled !== false;
}
