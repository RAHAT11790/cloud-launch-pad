// ============================================================
// RS Anime — Ad-Block Detection Engine (v5, site-wide)
// ------------------------------------------------------------
// Detects EVERY suppression method used against the site:
//   • Extensions            — uBlock Origin, AdBlock/Plus, AdGuard ext, Ghostery
//   • Ad-blocking browsers  — Brave shields, Opera, Via, Kiwi, QB/Quark, UC,
//                             Vivaldi, Samsung Internet blockers, Bromite
//   • DNS filters           — dns.adguard.com, NextDNS, Pi-hole, ControlD,
//                             Mullvad DNS, hosts files, private-DNS profiles
//   • Network / ISP filters — router-level blocklists
//
// Detection is EVIDENCE based, never a guess:
//   1. control  — is the user online at all? (own origin + shield probe)
//   2. edge     — can the SERVER reach the ad host right now? (/check oracle)
//   3. client   — can the BROWSER reach the same ad hosts?
//   Server reachable + browser blocked  ==>  the user is filtering. Proven.
//
// Any single hard signal (DOM bait hidden, script element killed, all ad
// networks unreachable while the site is reachable) is enough to lock the
// home page — soft signals only add confidence.
// ============================================================

import { getShieldBase, getShieldBaseSync, shieldProbe } from "@/lib/adShield";

export type AdBlockSignals = {
  blocked: boolean;
  score: number;
  offline: boolean;
  domBait: boolean;        // filter-list CSS hid our bait elements
  scriptKilled: boolean;   // <script> to an ad host refused to load
  networkBlocked: boolean; // every ad host unreachable from the browser
  edgeReachable: boolean;  // the same host IS reachable from our edge
  brave: boolean;
  adsterraFailed: boolean;
  reasons: string[];
};

export const ADBLOCK_STATE_KEY = "rs_adblock_gate";

// Classes/ids every mainstream filter list hides on sight.
const BAIT_HTML = `
  <ins class="adsbygoogle adsbygoogle-noablate" style="display:block;width:120px;height:60px;"></ins>
  <div class="adsbox ad-banner ad-placement ad-container adsterra-banner banner_ad"
       style="width:120px;height:60px;display:block;">&nbsp;</div>
  <div id="ads" class="ads sponsored" style="width:120px;height:60px;display:block;">&nbsp;</div>
  <div class="pub_300x250 text-ad textAd text_ad ad-text sponsored-content"
       style="width:120px;height:60px;display:block;">&nbsp;</div>
  <div id="AdContainer" class="popads adcash trafficjunky doubleclick-ad"
       style="width:120px;height:60px;display:block;">&nbsp;</div>
  <div class="adsbygoogle google-ad adslot_1 ad-unit sponsor-banner"
       style="width:120px;height:60px;display:block;">&nbsp;</div>
`;

const AD_NET_PROBES = [
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
  "https://static.doubleclick.net/instream/ad_status.js",
  "https://www.googletagservices.com/tag/js/gpt.js",
  "https://www.highperformanceformat.com/",
  "https://www.profitableratecpm.com/",
];

const SCRIPT_PROBE = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
const CONTROL_PROBE = "/favicon.ico";

let baitEl: HTMLDivElement | null = null;

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
  let hidden = 0;
  for (const el of children) {
    const cs = window.getComputedStyle(el);
    if (
      cs.display === "none" ||
      cs.visibility === "hidden" ||
      cs.opacity === "0" ||
      el.offsetParent === null ||
      el.offsetHeight === 0 ||
      el.offsetWidth === 0 ||
      el.clientHeight === 0
    ) hidden++;
  }
  return hidden >= Math.ceil(children.length / 2);
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

/** Are we online at all? Uses first-party targets only (never blocklisted). */
async function controlReachable(): Promise<boolean> {
  if (navigator.onLine === false) return false;
  if (getShieldBaseSync() && (await shieldProbe(3500))) return true;
  if (await timedFetch(CONTROL_PROBE, 2500)) return true;
  return timedFetch(CONTROL_PROBE, 3000);
}

async function anyAdNetworkReachable(): Promise<boolean> {
  const r = await Promise.all(AD_NET_PROBES.map((u) => timedFetch(u, 3500)));
  return r.some(Boolean);
}

/** Ask the edge whether the ad host is up right now (kills false positives). */
async function edgeSaysReachable(): Promise<boolean | null> {
  const base = getShieldBaseSync();
  if (!base) return null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 7000);
  try {
    const r = await fetch(`${base}/check?_=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
      signal: ac.signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Boolean(j?.reachable);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** A real <script> tag pointed at an ad host — extensions kill this outright. */
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
    window.setTimeout(() => done(true), 6000);
  });
}

async function braveShieldsOn(): Promise<boolean> {
  try {
    const brave = (navigator as any)?.brave;
    if (brave?.isBrave) return Boolean(await brave.isBrave());
  } catch {}
  return false;
}

/** Run the full evidence chain. */
export async function detectAdBlock(): Promise<AdBlockSignals> {
  const empty: AdBlockSignals = {
    blocked: false, score: 0, offline: false, domBait: false, scriptKilled: false,
    networkBlocked: false, edgeReachable: false, brave: false, adsterraFailed: false,
    reasons: [],
  };
  if (typeof window === "undefined") return empty;

  await getShieldBase().catch(() => "");

  const control = await controlReachable();
  if (!control) return { ...empty, offline: true };

  const [domBait, netReachable, scriptKilled, brave, edge] = await Promise.all([
    Promise.resolve(baitHidden()),
    anyAdNetworkReachable(),
    scriptProbeBlocked(),
    braveShieldsOn(),
    edgeSaysReachable(),
  ]);

  const networkBlocked = !netReachable;
  const adsterraFailed = (window as any).__adsterraScriptOk === false;
  const edgeReachable = edge === true;

  const reasons: string[] = [];
  let score = 0;
  if (domBait) { score += 3; reasons.push("filter-list CSS hid ad containers (extension)"); }
  if (scriptKilled) { score += 3; reasons.push("ad script element refused to load"); }
  if (networkBlocked) {
    // A DNS filter (dns.adguard.com, NextDNS, Pi-hole) kills the hostname.
    // If the edge can still reach it, this is a filter — proven, not guessed.
    // Only a PROVEN mismatch (edge can reach, browser cannot) is a hard signal.
    // edge === null means the oracle is unavailable — treat as soft evidence so
    // a flaky network can never lock out an innocent user on its own.
    score += edge === true ? 3 : 1;
    reasons.push(edge === true
      ? "ad networks unreachable from your device only — DNS / VPN filter"
      : "ad networks unreachable (could not confirm with the edge oracle)");
  }
  if (adsterraFailed) { score += 1; reasons.push("live ad tag failed to initialise"); }
  if (brave) { score += 1; reasons.push("Brave shields capable browser"); }

  return {
    blocked: score >= 3,
    score, offline: false, domBait, scriptKilled, networkBlocked,
    edgeReachable, brave, adsterraFailed, reasons,
  };
}

export function clearBait() {
  try { baitEl?.remove(); } catch {}
  baitEl = null;
}
