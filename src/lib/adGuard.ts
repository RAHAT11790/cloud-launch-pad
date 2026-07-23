// ============================================================
// RS Anime — Ad-Block / Ad-DNS Guard (v3, 2026-07-24)
// ------------------------------------------------------------
// Detects users who block ads via:
//   • Browser extensions (uBlock Origin, AdBlock, AdBlock Plus, Ghostery…)
//   • Ad-block browsers (Brave shields, Opera built-in, Kiwi + uBO, etc.)
//   • DNS-level blockers (NextDNS, AdGuard DNS, Pi-hole, ControlD, custom
//     hosts files, Cloudflare Gateway ad rules)
//
// Design goals:
//   1. ZERO false positives — a real user without any blocker must never see
//      the overlay. We use a "control" probe first: if the control fails we
//      assume the user just has bad internet and stay silent.
//   2. HARD block for confirmed blockers — video is force-paused and cannot
//      resume until they retry with the blocker disabled.
//   3. Multi-signal confirmation — we require at least 2 independent signals
//      (bait DOM hide + network probe) before triggering.
//   4. Premium users are exempt.
// ============================================================

let guardActive = false;
let overlayEl: HTMLDivElement | null = null;
let baitEl: HTMLDivElement | null = null;
let pauseEnforceTimer: number | null = null;
let onPlayHandler: ((e: Event) => void) | null = null;
let recheckTimer: number | null = null;
let checkInFlight = false;

// Common ad-related class names blocked by nearly every filter list
// (EasyList, EasyPrivacy, AdGuard Base). If any of these get hidden by a
// stylesheet we didn't ship, an extension is on.
const BAIT_HTML = `
  <ins class="adsbygoogle adsbygoogle-noablate" style="display:block;width:120px;height:60px;"></ins>
  <div class="adsbox ad-banner ad-placement ad-container adsterra-banner banner_ad"
       style="width:120px;height:60px;display:block;">&nbsp;</div>
  <div id="ads" class="ads sponsored" style="width:120px;height:60px;display:block;">&nbsp;</div>
`;

// Known ad-network endpoints. All are blocked by EasyList + every mainstream
// public DNS blocklist. Success on any = user is NOT blocking. Failure on
// ALL = strong blocker signal.
const AD_NET_PROBES = [
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
  "https://static.doubleclick.net/instream/ad_status.js",
  "https://www.googletagservices.com/tag/js/gpt.js",
];

// Control endpoint — same-origin so it cannot be blocked by DNS/extension
// filter lists. If this fails, user has genuine network trouble, not a
// blocker, and we must NOT show the overlay.
const CONTROL_PROBE = "/favicon.ico";

function ensureBait(): HTMLDivElement {
  if (baitEl && baitEl.isConnected) return baitEl;
  baitEl = document.createElement("div");
  baitEl.setAttribute("aria-hidden", "true");
  baitEl.setAttribute("data-rs-bait", "1");
  // Off-screen but rendered — a plain user's stylesheet won't hide it, but
  // adblock filter lists will inject `display:none` / `visibility:hidden`.
  baitEl.style.cssText =
    "position:absolute!important;left:-9999px!important;top:-9999px!important;" +
    "width:120px!important;height:60px!important;pointer-events:none!important;";
  baitEl.innerHTML = BAIT_HTML;
  document.body.appendChild(baitEl);
  return baitEl;
}

function baitHidden(): boolean {
  const root = ensureBait();
  // Force a reflow so extensions had time to inject rules.
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
  // Require the MAJORITY of bait nodes to be hidden. A single miss (e.g. a
  // site-specific CSS quirk) is not enough.
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

async function controlReachable(): Promise<boolean> {
  // Two attempts — network can flake once.
  if (await timedFetch(CONTROL_PROBE, 2500)) return true;
  return timedFetch(CONTROL_PROBE, 2500);
}

async function anyAdNetworkReachable(): Promise<boolean> {
  // Fire in parallel — first success wins.
  const results = await Promise.all(AD_NET_PROBES.map((u) => timedFetch(u, 3500)));
  return results.some(Boolean);
}

function buildOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-rs-adguard", "1");
  el.style.cssText = [
    "position:fixed", "inset:0", "z-index:2147483646",
    "background:radial-gradient(ellipse at center,rgba(20,6,10,0.97),rgba(2,2,6,0.99))",
    "backdrop-filter:blur(10px)",
    "-webkit-backdrop-filter:blur(10px)",
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

function showOverlay() {
  if (overlayEl && overlayEl.isConnected) { forcePauseAllVideos(); return; }
  overlayEl = buildOverlay();
  document.body.appendChild(overlayEl);
  forcePauseAllVideos();
  // Trap every play() attempt while overlay is up.
  onPlayHandler = (e: Event) => { try { (e.target as HTMLVideoElement)?.pause(); } catch {} };
  document.addEventListener("play", onPlayHandler, true);
  if (pauseEnforceTimer !== null) window.clearInterval(pauseEnforceTimer);
  pauseEnforceTimer = window.setInterval(forcePauseAllVideos, 600);
}

function hideOverlay() {
  try { overlayEl?.remove(); } catch {}
  overlayEl = null;
  if (pauseEnforceTimer !== null) { window.clearInterval(pauseEnforceTimer); pauseEnforceTimer = null; }
  if (onPlayHandler) { document.removeEventListener("play", onPlayHandler, true); onPlayHandler = null; }
}

async function runCheck(isRetry = false): Promise<void> {
  if (!guardActive) return;
  if (checkInFlight) return;
  checkInFlight = true;
  try {
    // Signal 1 — DOM bait hidden by extensions.
    const domHit = baitHidden();

    // Signal 2 — ad-network endpoints blocked. But first make sure the user
    // actually has internet (control). If control fails, do NOT flag.
    const control = await controlReachable();
    if (!control) {
      // Genuine network trouble. Never show a false-positive block screen.
      if (isRetry) hideOverlay();
      return;
    }
    const netReachable = await anyAdNetworkReachable();
    const netHit = !netReachable;

    // Confirmation logic — need BOTH signals or an extension-level hit
    // combined with a DNS block. Single-signal is not enough to lock the
    // user out.
    const confirmed = (domHit && netHit) || (domHit && !netReachable);

    if (confirmed) {
      showOverlay();
    } else if (isRetry) {
      hideOverlay();
    }
  } finally {
    checkInFlight = false;
  }
}

/**
 * Arm the ad-blocker guard for a video session.
 * Skips silently for premium users. Runs an initial deferred check, then
 * re-checks every 25 s while playback is live.
 */
export function startAdGuard(opts: { isPremium?: boolean } = {}) {
  if (typeof window === "undefined") return;
  if (opts.isPremium) { stopAdGuard(); return; }
  if (guardActive) return;
  guardActive = true;
  // Delay initial run so extensions have time to inject their CSS after the
  // first render (uBO in particular waits for DOMContentLoaded + a tick).
  window.setTimeout(() => { void runCheck(false); }, 1200);
  if (recheckTimer !== null) window.clearInterval(recheckTimer);
  recheckTimer = window.setInterval(() => { void runCheck(false); }, 25_000);
}

export function stopAdGuard() {
  guardActive = false;
  if (recheckTimer !== null) { window.clearInterval(recheckTimer); recheckTimer = null; }
  try { baitEl?.remove(); } catch {}
  baitEl = null;
  hideOverlay();
}
