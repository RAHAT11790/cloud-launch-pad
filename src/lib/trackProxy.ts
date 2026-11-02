// ============================================================
// Audio-track proxy (EGD Router → `video-proxy`)
// ============================================================
// Switching audio/subtitles has to READ the video file's bytes. Some video
// servers (trycloudflare tunnels, bot-hosting mirrors) let the <video> tag
// play but refuse byte reads from the site (no CORS header). For those hosts
// the reads go through the admin's `video-proxy` worker instead.
//
// Everything here is synchronous after the first Firebase answer:
//   * the proxy URL is mirrored in localStorage (instant on the next open)
//   * hosts that refused a direct read are remembered, so the next switch
//     goes straight to the proxy with zero wasted round-trips.
// The video itself never plays through this proxy.

import { db, ref, onValue } from "@/lib/firebase";
import { normalizeFunctionEndpointUrl } from "@/lib/edgeFunctionRouter";
import { checkRouteAlive, isRouteKnownDead } from "@/lib/routeHealth";

const PROXY_KEY = "rs_track_proxy_v1";
const CORS_KEY = "rs_cors_hosts_v1";
/** How long a host's "direct read works / refused" verdict is trusted. */
export const CORS_VERDICT_TTL = 6 * 60 * 60 * 1000;

let base = "";
let loaded = false;
let subscribed = false;
const waiters: Array<() => void> = [];

try {
  if (typeof localStorage !== "undefined") base = localStorage.getItem(PROXY_KEY) || "";
} catch { /* private mode */ }

const settle = () => { loaded = true; while (waiters.length) waiters.shift()?.(); };

function subscribe() {
  if (subscribed || typeof window === "undefined") return;
  subscribed = true;
  try {
    onValue(ref(db, "settings/functionOverrides/video-proxy"), (snap) => {
      const v = snap.val() || {};
      const url = normalizeFunctionEndpointUrl("video-proxy", String(v.customUrl || v.url || "").trim());
      base = /^https?:\/\//i.test(url) && v.enabled !== false ? url : "";
      try { if (base) localStorage.setItem(PROXY_KEY, base); else localStorage.removeItem(PROXY_KEY); } catch { /* ignore */ }
      if (base) { void checkRouteAlive(base); preconnect(base); }
      settle();
    }, () => settle());
  } catch { settle(); }
}

function preconnect(url: string) {
  try {
    const origin = new URL(url).origin;
    if (document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  } catch { /* ignore */ }
}

/** Current proxy base (empty when not set up or its server is dead). */
export function trackProxyBase(): string {
  subscribe();
  return base && !isRouteKnownDead(base) ? base : "";
}

/** Like trackProxyBase, but waits briefly for the very first Firebase answer. */
export function waitTrackProxyBase(timeoutMs = 1500): Promise<string> {
  subscribe();
  if (loaded || base) return Promise.resolve(trackProxyBase());
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(trackProxyBase()), timeoutMs);
    waiters.push(() => { clearTimeout(t); resolve(trackProxyBase()); });
  });
}

/** Warm the proxy connection early (call when a player opens). */
export function warmTrackProxy() {
  const b = trackProxyBase();
  if (b) preconnect(b);
}

// ---- per-host CORS verdicts ----
type Verdicts = Record<string, { ok: boolean; at: number }>;
const hostOf = (url: string) => { try { return new URL(url).host.toLowerCase(); } catch { return ""; } };
const readVerdicts = (): Verdicts => {
  try { return JSON.parse(localStorage.getItem(CORS_KEY) || "{}") || {}; } catch { return {}; }
};

/** True when this host recently refused a direct byte read from the site. */
export function hostRefusesDirectRead(url: string, now = Date.now()): boolean {
  const v = readVerdicts()[hostOf(url)];
  return !!v && v.ok === false && now - v.at < CORS_VERDICT_TTL;
}

/** True when this device already knows whether the host allows direct reads. */
export function hasDirectReadVerdict(url: string, now = Date.now()): boolean {
  const v = readVerdicts()[hostOf(url)];
  return !!v && now - v.at < CORS_VERDICT_TTL;
}

export function rememberDirectRead(url: string, ok: boolean, now = Date.now()) {
  const host = hostOf(url);
  if (!host) return;
  const all = readVerdicts();
  all[host] = { ok, at: now };
  try { localStorage.setItem(CORS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

/**
 * Order the byte-read URLs for one file. Direct first (cheapest) unless the
 * host is known to refuse it — then the proxies go first and direct is last.
 */
export function orderReadCandidates(direct: string[], proxies: string[], refusesDirect: boolean): string[] {
  const list = refusesDirect && proxies.length ? [...proxies, ...direct] : [...direct, ...proxies];
  return Array.from(new Set(list.filter(Boolean)));
}
