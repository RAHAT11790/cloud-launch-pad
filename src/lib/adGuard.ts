// ============================================
// Anti-bypass / Adblock / VPN-DNS guard.
// Detects when Adsterra creatives have been blocked (extensions, NextDNS,
// AdGuard DNS, Pi-hole, hosts-file blockers, custom Cloudflare rules) and
// pauses the video + shows a full-screen warning overlay until the blocker
// is disabled.
// ============================================

let guardActive = false;
let overlayEl: HTMLDivElement | null = null;
let pollTimer: number | null = null;
let baitEl: HTMLDivElement | null = null;
let pausedVideoEl: HTMLVideoElement | null = null;

const BAIT_CLASSES = "ads ad adsbox adsbygoogle ad-banner ad-placement adsterra-banner";
const PROBE_HOSTS = [
  "https://www.effectivecpmnetwork.com/favicon.ico",
  "https://highperformanceformat.com/favicon.ico",
];

function ensureBait() {
  if (baitEl && baitEl.isConnected) return baitEl;
  baitEl = document.createElement("div");
  baitEl.className = BAIT_CLASSES;
  baitEl.setAttribute("aria-hidden", "true");
  baitEl.style.cssText =
    "position:absolute;left:-9999px;top:-9999px;width:120px;height:60px;pointer-events:none;";
  baitEl.innerHTML = "&nbsp;";
  document.body.appendChild(baitEl);
  return baitEl;
}

async function probeBlocked(): Promise<boolean> {
  // If any of the probe hosts ALL fail (DNS/network blocked), treat as blocked.
  let allFailed = true;
  for (const url of PROBE_HOSTS) {
    try {
      await fetch(url + "?_=" + Date.now(), { method: "GET", mode: "no-cors", cache: "no-store" });
      allFailed = false;
      break;
    } catch {
      // continue
    }
  }
  return allFailed;
}

function baitBlocked(): boolean {
  const b = ensureBait();
  // Adblock extensions usually hide elements with these classnames.
  const cs = window.getComputedStyle(b);
  if (b.offsetParent === null) return true;
  if (b.offsetHeight === 0 || b.offsetWidth === 0) return true;
  if (cs.display === "none" || cs.visibility === "hidden") return true;
  return false;
}

function buildOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-adguard-overlay", "1");
  el.style.cssText = [
    "position:fixed", "inset:0", "z-index:2147483646",
    "background:rgba(2,4,10,0.96)",
    "backdrop-filter:blur(8px)",
    "-webkit-backdrop-filter:blur(8px)",
    "display:flex", "align-items:center", "justify-content:center",
    "padding:24px", "color:#fff",
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
  ].join(";");
  el.innerHTML = `
    <div style="max-width:460px;width:100%;text-align:center;background:linear-gradient(160deg,#1a0e1f,#0f0a14);border:1px solid rgba(255,80,80,0.35);border-radius:18px;padding:28px 22px;box-shadow:0 20px 60px rgba(255,40,40,0.25);">
      <div style="font-size:46px;margin-bottom:10px;">⚠️</div>
      <div style="font-size:18px;font-weight:800;color:#ff6b6b;letter-spacing:0.3px;margin-bottom:8px;">Ad-Block / VPN / Custom DNS Detected</div>
      <div style="font-size:13.5px;line-height:1.55;opacity:0.85;margin-bottom:18px;">
        You are using a bypass system (ad-blocker, VPN, AdGuard DNS, NextDNS, Pi-hole, or a custom DNS that blocks ads).
        <br/><br/>
        Our service is free because of ads. Please <strong>disable your ad-blocker / VPN / custom DNS</strong> for this site, then click Retry.
        <br/><br/>
        Premium users never see ads — you can also subscribe to remove this notice.
      </div>
      <button data-adguard-retry style="background:linear-gradient(135deg,#ff4d4d,#ff7a59);color:#fff;font-weight:700;font-size:14px;border:0;border-radius:12px;padding:12px 26px;cursor:pointer;box-shadow:0 8px 22px rgba(255,90,90,0.45);">
        🔄 Retry
      </button>
    </div>
  `;
  el.querySelector<HTMLButtonElement>("[data-adguard-retry]")?.addEventListener("click", () => {
    runCheck(true);
  });
  return el;
}

let pauseEnforceTimer: number | null = null;
let onPlayHandler: ((e: Event) => void) | null = null;

function forcePauseAllVideos() {
  try {
    const vids = document.querySelectorAll("video");
    vids.forEach((v) => {
      try {
        const el = v as HTMLVideoElement;
        if (!el.paused) el.pause();
        el.muted = true;
      } catch {}
    });
  } catch {}
}

function showOverlay(videoEl: HTMLVideoElement | null) {
  if (overlayEl && overlayEl.isConnected) {
    forcePauseAllVideos();
    return;
  }
  pausedVideoEl = videoEl;
  forcePauseAllVideos();
  overlayEl = buildOverlay();
  document.body.appendChild(overlayEl);

  // Aggressively keep ALL videos paused while the overlay is visible —
  // re-pause on any play() attempt and poll as a safety net.
  onPlayHandler = (e: Event) => {
    try { (e.target as HTMLVideoElement)?.pause(); } catch {}
  };
  document.addEventListener("play", onPlayHandler, true);
  if (pauseEnforceTimer !== null) window.clearInterval(pauseEnforceTimer);
  pauseEnforceTimer = window.setInterval(forcePauseAllVideos, 500);
}

function hideOverlay() {
  try { overlayEl?.remove(); } catch {}
  overlayEl = null;
  if (pauseEnforceTimer !== null) { window.clearInterval(pauseEnforceTimer); pauseEnforceTimer = null; }
  if (onPlayHandler) { document.removeEventListener("play", onPlayHandler, true); onPlayHandler = null; }
  // Do NOT auto-resume — require an explicit user retry/refresh.
}

async function runCheck(isRetry = false) {
  if (!guardActive) return;
  const baitHit = baitBlocked();
  let dnsHit = false;
  if (baitHit) {
    // Confirm with a network probe — distinguishes extensions from CSS quirks.
    dnsHit = await probeBlocked();
  } else {
    // Even without bait, a full DNS-level block returns failures for ad probes.
    dnsHit = await probeBlocked();
  }
  if (baitHit || dnsHit) {
    showOverlay(pausedVideoEl);
  } else if (isRetry) {
    hideOverlay();
  }
}

export function startAdGuard(videoEl: HTMLVideoElement | null) {
  if (typeof window === "undefined") return;
  // Player ads are best-effort only. Do not block playback or show false
  // DNS/adblock warnings to normal users; cleanup any stale overlay instead.
  stopAdGuard();
  return;
}

export function stopAdGuard() {
  guardActive = false;
  if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null; }
  try { baitEl?.remove(); } catch {}
  baitEl = null;
  hideOverlay();
}
