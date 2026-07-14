// ============================================
// Professional player ad-block / DNS-block guard.
// Free users cannot play while ad scripts or known ad endpoints are blocked.
// Premium users are exempt through AdsterraAdManager.
// ============================================

let guardActive = false;
let overlayEl: HTMLDivElement | null = null;
let pollTimer: number | null = null;
let baitEl: HTMLDivElement | null = null;
let pausedVideoEl: HTMLVideoElement | null = null;
let pauseEnforceTimer: number | null = null;
let onPlayHandler: ((e: Event) => void) | null = null;
let lastBlocked = false;

const BAIT_CLASSES = [
  "ad", "ads", "adsbox", "ad-box", "adunit", "ad-unit",
  "ad-banner", "ad-placement", "adsbygoogle", "adsterra-banner",
  "doubleclick", "pub_300x250", "text-ad", "sponsor-ad",
].join(" ");

const PROBE_URLS = [
  "https://www.effectivecpmnetwork.com/favicon.ico",
  "https://highperformanceformat.com/favicon.ico",
  "https://pl29545318.effectivecpmnetwork.com/favicon.ico",
  "https://portalfluently.com/favicon.ico",
];

const SCRIPT_PROBES = [
  "https://pl29545318.effectivecpmnetwork.com/b5/74/7e/b5747e03c73558e2e6a43ca61723472e.js",
  "https://portalfluently.com/sfp.js",
];

function ensureBait() {
  if (baitEl && baitEl.isConnected) return baitEl;
  baitEl = document.createElement("div");
  baitEl.className = BAIT_CLASSES;
  baitEl.id = "google_ads_iframe_/21723458138/rsanime_guard_0";
  baitEl.setAttribute("aria-hidden", "true");
  baitEl.style.cssText = [
    "position:absolute", "left:-10000px", "top:-10000px",
    "width:300px", "height:250px", "min-width:300px", "min-height:250px",
    "display:block", "visibility:visible", "opacity:1", "pointer-events:none",
  ].join(";");
  baitEl.innerHTML = "&nbsp;";
  document.body.appendChild(baitEl);
  return baitEl;
}

function baitBlocked(): boolean {
  const b = ensureBait();
  const cs = window.getComputedStyle(b);
  const rect = b.getBoundingClientRect();
  return !b.isConnected
    || cs.display === "none"
    || cs.visibility === "hidden"
    || Number(cs.opacity) === 0
    || b.offsetHeight < 10
    || b.offsetWidth < 10
    || rect.height < 10
    || rect.width < 10;
}

async function fetchProbe(url: string, timeoutMs: number): Promise<boolean> {
  const ac = new AbortController();
  const t = window.setTimeout(() => ac.abort(), timeoutMs);
  try {
    await fetch(`${url}${url.includes("?") ? "&" : "?"}_rs_ad_probe=${Date.now()}`, {
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
    window.clearTimeout(t);
  }
}

function scriptProbe(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(t);
      try { s.remove(); } catch {}
      resolve(ok);
    };
    const t = window.setTimeout(() => finish(false), timeoutMs);
    s.async = true;
    s.src = `${url}${url.includes("?") ? "&" : "?"}_rs_ad_script_probe=${Date.now()}`;
    s.onload = () => finish(true);
    s.onerror = () => finish(false);
    document.head.appendChild(s);
  });
}

async function probeBlocked(): Promise<boolean> {
  const fetchResults = await Promise.all(PROBE_URLS.map((url) => fetchProbe(url, 3200)));
  if (fetchResults.some(Boolean)) return false;
  const scriptResults = await Promise.all(SCRIPT_PROBES.map((url) => scriptProbe(url, 4500)));
  return !scriptResults.some(Boolean);
}

function buildOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-adguard-overlay", "1");
  el.style.cssText = [
    "position:fixed", "inset:0", "z-index:2147483646",
    "background:rgba(2,4,10,0.97)", "backdrop-filter:blur(8px)", "-webkit-backdrop-filter:blur(8px)",
    "display:flex", "align-items:center", "justify-content:center", "padding:24px", "color:#fff",
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
  ].join(";");
  el.innerHTML = `
    <div style="max-width:460px;width:100%;text-align:center;background:linear-gradient(160deg,#1b1016,#08090d);border:1px solid rgba(255,80,80,0.45);border-radius:16px;padding:28px 22px;box-shadow:0 20px 60px rgba(255,40,40,0.28);">
      <div style="font-size:46px;margin-bottom:10px;">⚠️</div>
      <div style="font-size:18px;font-weight:800;color:#ff6b6b;letter-spacing:0;margin-bottom:8px;">Ad-Block / VPN / Custom DNS Detected</div>
      <div style="font-size:13.5px;line-height:1.55;opacity:0.86;margin-bottom:18px;">
        Free playback is blocked while an ad-blocker, VPN ad filter, private DNS, NextDNS, AdGuard DNS, Pi-hole, or hosts-file filter is active.
        <br/><br/>
        Disable it for this site, then press Retry. Premium users do not need ads.
      </div>
      <button data-adguard-retry style="background:linear-gradient(135deg,#ff4d4d,#ff7a59);color:#fff;font-weight:800;font-size:14px;border:0;border-radius:12px;padding:12px 28px;cursor:pointer;box-shadow:0 8px 22px rgba(255,90,90,0.45);">
        Retry
      </button>
    </div>
  `;
  el.querySelector<HTMLButtonElement>("[data-adguard-retry]")?.addEventListener("click", () => {
    runCheck(true).catch(() => showOverlay(pausedVideoEl));
  });
  return el;
}

function forcePauseAllVideos() {
  document.querySelectorAll("video").forEach((node) => {
    try {
      const v = node as HTMLVideoElement;
      if (!v.paused) v.pause();
      v.muted = true;
    } catch {}
  });
}

function showOverlay(videoEl: HTMLVideoElement | null) {
  pausedVideoEl = videoEl || pausedVideoEl;
  lastBlocked = true;
  forcePauseAllVideos();
  if (!overlayEl || !overlayEl.isConnected) {
    overlayEl = buildOverlay();
    document.body.appendChild(overlayEl);
  }
  if (!onPlayHandler) {
    onPlayHandler = (e: Event) => {
      try { (e.target as HTMLVideoElement)?.pause(); } catch {}
      forcePauseAllVideos();
    };
    document.addEventListener("play", onPlayHandler, true);
  }
  if (pauseEnforceTimer !== null) window.clearInterval(pauseEnforceTimer);
  pauseEnforceTimer = window.setInterval(forcePauseAllVideos, 350);
}

function hideOverlay() {
  lastBlocked = false;
  try { overlayEl?.remove(); } catch {}
  overlayEl = null;
  if (pauseEnforceTimer !== null) { window.clearInterval(pauseEnforceTimer); pauseEnforceTimer = null; }
  if (onPlayHandler) { document.removeEventListener("play", onPlayHandler, true); onPlayHandler = null; }
}

async function runCheck(isRetry = false) {
  if (!guardActive) return;
  const blocked = baitBlocked() || await probeBlocked();
  if (blocked) showOverlay(pausedVideoEl);
  else if (isRetry || lastBlocked) hideOverlay();
}

export function startAdGuard(videoEl: HTMLVideoElement | null) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  pausedVideoEl = videoEl;
  guardActive = true;
  ensureBait();
  runCheck().catch(() => showOverlay(videoEl));
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    runCheck().catch(() => showOverlay(pausedVideoEl));
  }, 5000);
}

export function stopAdGuard() {
  guardActive = false;
  if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null; }
  try { baitEl?.remove(); } catch {}
  baitEl = null;
  hideOverlay();
}