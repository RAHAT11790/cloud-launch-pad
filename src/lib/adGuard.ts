// ============================================================
// RS Anime — Ad-Block / Ad-DNS Guard (v4, 2026-08-22)
// ------------------------------------------------------------
// Detects and hard-blocks users who suppress ads via:
//   • Extensions (uBlock Origin, AdBlock/Plus, Ghostery, AdGuard ext…)
//   • Ad-blocking browsers (Brave shields, Opera, Kiwi + uBO)
//   • DNS filters (NextDNS, AdGuard DNS, Pi-hole, ControlD, hosts files)
//   • Network-level blocking (ISP/router filters)
//
// v4 additions
//   1. Ad Shield relay (Cloudflare `ad-shield` worker) — ad scripts are
//      served from YOUR OWN domain, so blockers have nothing to match.
//      When a blocker is detected we STILL execute the ad payload through
//      the shield: the ad runs anyway.
//   2. Multi-signal scoring (DOM bait, script-element load, network probes,
//      Brave detection, live Adsterra state) with a first-party control
//      probe so real network outages never false-positive.
//   3. Tamper-proof overlay: re-attaches itself if removed from the DOM,
//      re-applies styles, freezes scrolling and force-pauses every video.
// ============================================================

import {
  getShieldBase,
  shieldProbe,
  shieldReady,
  shieldExecute,
  shieldUrl,
} from "@/lib/adShield";

let guardActive = false;
let siteMode = false;
let overlayEl: HTMLDivElement | null = null;
let baitEl: HTMLDivElement | null = null;
let pauseEnforceTimer: number | null = null;
let onPlayHandler: ((e: Event) => void) | null = null;
let recheckTimer: number | null = null;
let checkInFlight = false;
let overlayWatcher: MutationObserver | null = null;
let bypassTried = false;

// Classes/ids every mainstream filter list hides.
const BAIT_HTML = `
  <ins class="adsbygoogle adsbygoogle-noablate" style="display:block;width:120px;height:60px;"></ins>
  <div class="adsbox ad-banner ad-placement ad-container adsterra-banner banner_ad"
       style="width:120px;height:60px;display:block;">&nbsp;</div>
  <div id="ads" class="ads sponsored" style="width:120px;height:60px;display:block;">&nbsp;</div>
  <div class="pub_300x250 text-ad textAd text_ad ad-text sponsored-content"
       style="width:120px;height:60px;display:block;">&nbsp;</div>
  <div id="AdContainer" class="popads adcash trafficjunky doubleclick-ad"
       style="width:120px;height:60px;display:block;">&nbsp;</div>
`;

// Endpoints present on every public blocklist. All failing = strong signal.
const AD_NET_PROBES = [
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
  "https://static.doubleclick.net/instream/ad_status.js",
  "https://www.googletagservices.com/tag/js/gpt.js",
  "https://www.highperformanceformat.com/",
];

// Script-element probe — catches extensions that let fetch() through but
// still kill real <script> loads.
const SCRIPT_PROBE = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

const CONTROL_PROBE = "/favicon.ico";

function ensureBait(): HTMLDivElement {
  if (baitEl && baitEl.isConnected) return baitEl;
  baitEl = document.createElement("div");
  baitEl.setAttribute("aria-hidden", "true");
  baitEl.setAttribute("data-rs-bait", "1");
  baitEl.style.cssText =
    "position:absolute!important;left:-9999px!important;top:-9999px!important;" +
    "width:120px!important;height:60px!important;pointer-events:none!important;";
  baitEl.innerHTML = BAIT_HTML;
  document.body.appendChild(baitEl);
  return baitEl;
}

function baitHidden(): boolean {
  const root = ensureBait();
  void root.offsetHeight;
  const children = Array.from(root.children) as HTMLElement[];
  if (children.length === 0) return false;
  let hiddenCount = 0;
  for (const el of children) {
    const cs = window.getComputedStyle(el);
    const isHidden =
      cs.display === "none" ||
      cs.visibility === "hidden" ||
      cs.opacity === "0" ||
      el.offsetParent === null ||
      el.offsetHeight === 0 ||
      el.offsetWidth === 0 ||
      el.clientHeight === 0;
    if (isHidden) hiddenCount++;
  }
  return hiddenCount >= Math.ceil(children.length / 2);
}

async function timedFetch(url: string, timeoutMs = 3500): Promise<boolean> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    await fetch(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now(), {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      signal: ac.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** First-party control: shield worker first (never on a blocklist), then favicon. */
async function controlReachable(): Promise<boolean> {
  if (shieldReady() && (await shieldProbe(3000))) return true;
  if (await timedFetch(CONTROL_PROBE, 2500)) return true;
  return timedFetch(CONTROL_PROBE, 2500);
}

async function anyAdNetworkReachable(): Promise<boolean> {
  const results = await Promise.all(AD_NET_PROBES.map((u) => timedFetch(u, 3500)));
  return results.some(Boolean);
}

/** A real <script> tag pointed at an ad host. Extensions kill this outright. */
function scriptProbeBlocked(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (blocked: boolean) => {
      if (settled) return;
      settled = true;
      try { s.remove(); } catch {}
      resolve(blocked);
    };
    const s = document.createElement("script");
    s.src = SCRIPT_PROBE + "?_=" + Date.now();
    s.async = true;
    s.addEventListener("load", () => done(false), { once: true });
    s.addEventListener("error", () => done(true), { once: true });
    document.head.appendChild(s);
    window.setTimeout(() => done(true), 5000);
  });
}

async function braveShieldsOn(): Promise<boolean> {
  try {
    const brave = (navigator as any)?.brave;
    if (brave?.isBrave) return Boolean(await brave.isBrave());
  } catch {}
  return false;
}

/**
 * Last line of monetisation: run the ad payload through the shield relay so
 * the ad executes even for a blocked user.
 */
async function attemptShieldBypass(): Promise<void> {
  if (bypassTried) return;
  bypassTried = true;
  await getShieldBase();
  if (!shieldReady()) return;
  try {
    await shieldExecute(SCRIPT_PROBE);
    const pending = (window as any).__adsterraPendingSrc as string | undefined;
    if (pending) await shieldExecute(shieldUrl(pending));
  } catch {}
}

function buildOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-rs-adguard", "1");
  el.style.cssText = [
    "position:fixed", "inset:0", "z-index:2147483647",
    "background:radial-gradient(ellipse at center,rgba(20,6,10,0.985),rgba(2,2,6,0.998))",
    "backdrop-filter:blur(14px)",
    "-webkit-backdrop-filter:blur(14px)",
    "display:flex", "align-items:center", "justify-content:center",
    "padding:20px", "color:#fff",
    "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
    "animation:rsAdGuardIn .25s ease-out",
  ].join(";");
  el.innerHTML = `
    <style>
      @keyframes rsAdGuardIn { from { opacity:0; transform:scale(.97); } to { opacity:1; transform:scale(1); } }
      @keyframes rsAdGuardPulse { 0%,100% { box-shadow:0 0 0 0 rgba(255,90,90,.55); } 50% { box-shadow:0 0 0 14px rgba(255,90,90,0); } }
      [data-rs-adguard] .rs-ag-card { animation: rsAdGuardIn .3s ease-out; }
      [data-rs-adguard] .rs-ag-icon { animation: rsAdGuardPulse 1.6s ease-in-out infinite; }
      [data-rs-adguard] .rs-ag-btn:hover { transform:translateY(-1px); filter:brightness(1.08); }
      [data-rs-adguard] .rs-ag-btn:active { transform:translateY(0); }
    </style>
    <div class="rs-ag-card" style="max-width:480px;width:100%;text-align:center;
      background:linear-gradient(160deg,#1c0a14 0%,#0d0710 100%);
      border:1px solid rgba(255,90,90,.35);border-radius:20px;padding:30px 24px 26px;
      box-shadow:0 30px 80px rgba(255,40,40,.28), 0 0 0 1px rgba(255,255,255,.03) inset;">
      <div class="rs-ag-icon" style="width:72px;height:72px;margin:0 auto 16px;border-radius:50%;
        background:linear-gradient(135deg,#ff4d4d,#ff7a3d);display:flex;align-items:center;justify-content:center;
        font-size:36px;">🛡️</div>
      <div style="font-size:19px;font-weight:800;color:#ff8a8a;letter-spacing:.2px;margin-bottom:6px;">
        Ad-Blocker Detected
      </div>
      <div style="font-size:12px;font-weight:600;color:#ffb84d;letter-spacing:.4px;text-transform:uppercase;margin-bottom:16px;">
        Extension · AdBlock Browser · DNS Filter
      </div>
      <div style="font-size:13.5px;line-height:1.6;color:rgba(255,255,255,.82);margin-bottom:20px;">
        RS Anime is <strong style="color:#fff;">100% free</strong> — ads keep the servers running.
        Please <strong style="color:#fff;">disable your ad-blocker, ad-blocking browser (Brave / Opera shields),
        or DNS filter</strong> (NextDNS, AdGuard DNS, Pi-hole) for this site, then retry.
      </div>
      <div style="background:rgba(255,180,60,.10);border:1px solid rgba(255,180,60,.30);border-radius:12px;
        padding:11px 14px;margin-bottom:20px;font-size:12.5px;color:#ffcf8a;line-height:1.5;">
        💡 <strong>Tip:</strong> Use this app only on <strong style="color:#fff;">Chrome browser</strong> for the best experience.
      </div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="rs-ag-btn" data-rs-retry style="background:linear-gradient(135deg,#ff4d4d,#ff7a59);
          color:#fff;font-weight:700;font-size:14px;border:0;border-radius:12px;padding:12px 26px;
          cursor:pointer;box-shadow:0 8px 22px rgba(255,90,90,.45);transition:transform .15s,filter .15s;">
          🔄 Retry
        </button>
        <button class="rs-ag-btn" data-rs-premium style="background:linear-gradient(135deg,#ffb84d,#ff9500);
          color:#1a0a00;font-weight:800;font-size:14px;border:0;border-radius:12px;padding:12px 22px;
          cursor:pointer;box-shadow:0 8px 22px rgba(255,180,60,.35);transition:transform .15s,filter .15s;">
          ⭐ Get Premium
        </button>
      </div>
      <div style="margin-top:16px;font-size:11px;color:rgba(255,255,255,.4);">
        Premium users never see ads or this notice.
      </div>
    </div>
  `;
  el.querySelector<HTMLButtonElement>("[data-rs-retry]")?.addEventListener("click", () => {
    void runCheck(true);
  });
  el.querySelector<HTMLButtonElement>("[data-rs-premium]")?.addEventListener("click", () => {
    try { window.location.assign("/premium"); } catch {}
  });
  return el;
}

function forcePauseAllVideos() {
  try {
    document.querySelectorAll("video").forEach((v) => {
      try {
        const el = v as HTMLVideoElement;
        if (!el.paused) el.pause();
      } catch {}
    });
  } catch {}
}

/** Keep the overlay alive even if the user deletes it from devtools. */
function armOverlayWatcher() {
  if (overlayWatcher) return;
  overlayWatcher = new MutationObserver(() => {
    if (!overlayEl) return;
    if (!overlayEl.isConnected) {
      try { document.body.appendChild(overlayEl); } catch {}
    }
    const cs = overlayEl.style;
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") {
      cs.display = "flex";
      cs.visibility = "visible";
      cs.opacity = "1";
    }
  });
  try {
    overlayWatcher.observe(document.body, { childList: true, subtree: true, attributes: true });
  } catch {}
}

function showOverlay() {
  if (overlayEl && overlayEl.isConnected) { forcePauseAllVideos(); return; }
  overlayEl = buildOverlay();
  document.body.appendChild(overlayEl);
  try { document.documentElement.style.overflow = "hidden"; } catch {}
  forcePauseAllVideos();
  onPlayHandler = (e: Event) => { try { (e.target as HTMLVideoElement)?.pause(); } catch {} };
  document.addEventListener("play", onPlayHandler, true);
  if (pauseEnforceTimer !== null) window.clearInterval(pauseEnforceTimer);
  pauseEnforceTimer = window.setInterval(() => {
    forcePauseAllVideos();
    if (overlayEl && !overlayEl.isConnected) { try { document.body.appendChild(overlayEl); } catch {} }
  }, 600);
  armOverlayWatcher();
  // Ads must still earn: relay the payload through the shield.
  void attemptShieldBypass();
}

function hideOverlay() {
  try { overlayEl?.remove(); } catch {}
  overlayEl = null;
  try { document.documentElement.style.overflow = ""; } catch {}
  if (pauseEnforceTimer !== null) { window.clearInterval(pauseEnforceTimer); pauseEnforceTimer = null; }
  if (onPlayHandler) { document.removeEventListener("play", onPlayHandler, true); onPlayHandler = null; }
  if (overlayWatcher) { try { overlayWatcher.disconnect(); } catch {} overlayWatcher = null; }
}

async function runCheck(isRetry = false): Promise<void> {
  if (!guardActive) return;
  if (checkInFlight) return;
  checkInFlight = true;
  try {
    // Control first — a dead network must never trigger the overlay.
    const control = await controlReachable();
    if (!control) {
      if (isRetry) hideOverlay();
      return;
    }

    const [domHit, netReachable, scriptBlocked, brave] = await Promise.all([
      Promise.resolve(baitHidden()),
      anyAdNetworkReachable(),
      scriptProbeBlocked(),
      braveShieldsOn(),
    ]);

    const netHit = !netReachable;                       // DNS / hosts / ISP filter
    const adsterraHit = (window as any).__adsterraScriptOk === false;

    let score = 0;
    if (domHit) score += 2;        // extension-level CSS injection
    if (netHit) score += 2;        // DNS-level block
    if (scriptBlocked) score += 2; // script element killed
    if (adsterraHit) score += 1;   // live tag failed to load
    if (brave) score += 1;         // shields-capable browser

    // Two independent signals required — no single-signal lockouts.
    const confirmed = score >= 3;

    if (confirmed) {
      showOverlay();
    } else if (isRetry || overlayEl) {
      hideOverlay();
    }
  } finally {
    checkInFlight = false;
  }
}

/**
 * Arm the guard for a video session (hard block: playback is frozen).
 */
export function startAdGuard(opts: { isPremium?: boolean } = {}) {
  if (typeof window === "undefined") return;
  if (opts.isPremium) { stopAdGuard(); return; }
  if (guardActive) return;
  guardActive = true;
  void getShieldBase();
  window.setTimeout(() => { void runCheck(false); }, 1200);
  if (recheckTimer !== null) window.clearInterval(recheckTimer);
  recheckTimer = window.setInterval(() => { void runCheck(false); }, 25_000);
}

/**
 * Site-wide guard — armed on app boot so a blocked user is caught before
 * they ever reach the player. Uses a slower cadence to stay cheap.
 */
export function startSiteAdGuard(opts: { isPremium?: boolean } = {}) {
  if (typeof window === "undefined") return;
  if (opts.isPremium) { stopAdGuard(); return; }
  siteMode = true;
  if (guardActive) return;
  guardActive = true;
  void getShieldBase();
  window.setTimeout(() => { void runCheck(false); }, 2500);
  if (recheckTimer !== null) window.clearInterval(recheckTimer);
  recheckTimer = window.setInterval(() => { void runCheck(false); }, 45_000);
}

export function stopAdGuard() {
  if (siteMode) {
    // A player screen unmounting must not disarm the site-wide guard.
    hideOverlayIfClean();
    return;
  }
  guardActive = false;
  if (recheckTimer !== null) { window.clearInterval(recheckTimer); recheckTimer = null; }
  try { baitEl?.remove(); } catch {}
  baitEl = null;
  hideOverlay();
}

function hideOverlayIfClean() {
  /* site mode keeps the overlay until a retry clears it */
}
