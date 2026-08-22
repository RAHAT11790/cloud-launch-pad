// ============================================================
// RS Anime — Ad Shield client
// ------------------------------------------------------------
// Talks to the `ad-shield` Cloudflare Worker (Admin → EGD Router).
// Everything degrades gracefully: when the row is empty or disabled the
// helpers simply return the original URL and the guard falls back to
// direct probing.
// ============================================================

import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

let baseCache: string | null = null;
let basePromise: Promise<string> | null = null;

/** Known ad-network hosts we relay through the shield. */
export const AD_HOSTS = [
  "highperformanceformat.com",
  "profitabledisplaynetwork.com",
  "profitableratecpm.com",
  "adsterranet.com",
  "adsterra.com",
  "displaycontentnetwork.com",
  "effectivegatecpm.com",
  "pl-monetization.com",
  "googlesyndication.com",
  "doubleclick.net",
  "googletagservices.com",
  "adnxs.com",
  "propellerads.com",
  "onclickalgo.com",
];

export const isAdHost = (host: string): boolean =>
  AD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

const b64url = (s: string) => {
  try {
    return btoa(unescape(encodeURIComponent(s)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  } catch {
    return encodeURIComponent(s);
  }
};

/** Resolve (and cache) the deployed shield base URL. Empty when not set up. */
export async function getShieldBase(): Promise<string> {
  if (baseCache !== null) return baseCache;
  if (!basePromise) {
    basePromise = getEdgeFunctionUrl("ad-shield")
      .then((u) => {
        baseCache = String(u || "").trim().replace(/\/+$/, "");
        return baseCache;
      })
      .catch(() => {
        baseCache = "";
        return "";
      });
  }
  return basePromise;
}

export const getShieldBaseSync = (): string => baseCache || "";

export const shieldReady = (): boolean => Boolean(baseCache);

/** Rewrite an ad-network URL so it is fetched through the shield worker. */
export function shieldUrl(raw: string): string {
  const base = getShieldBaseSync();
  if (!base || !raw) return raw;
  try {
    const u = new URL(raw, window.location.href);
    if (!isAdHost(u.hostname)) return raw;
    return `${base}/s?u=${b64url(u.toString())}`;
  } catch {
    return raw;
  }
}

/** Trampoline a pop-under / direct link through the shield. */
export function shieldNavUrl(raw: string): string {
  const base = getShieldBaseSync();
  if (!base || !raw) return raw;
  try {
    const u = new URL(raw, window.location.href);
    if (!isAdHost(u.hostname)) return raw;
    return `${base}/t?u=${b64url(u.toString())}`;
  } catch {
    return raw;
  }
}

/** First-party control probe — proves the user actually has network. */
export async function shieldProbe(timeoutMs = 4000): Promise<boolean> {
  const base = getShieldBaseSync();
  if (!base) return false;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/probe?_=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
      signal: ac.signal,
    });
    return r.ok || r.status === 204;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch an ad asset THROUGH the shield and execute it, so ads keep running
 * even when the user has a blocker installed.
 */
export async function shieldExecute(scriptUrl: string): Promise<boolean> {
  const base = getShieldBaseSync();
  if (!base) return false;
  try {
    const res = await fetch(shieldUrl(scriptUrl), { cache: "no-store", credentials: "omit" });
    if (!res.ok) return false;
    const code = await res.text();
    if (!code.trim()) return false;
    const blob = new Blob([code], { type: "application/javascript" });
    const objUrl = URL.createObjectURL(blob);
    const s = document.createElement("script");
    s.src = objUrl;
    s.async = true;
    s.setAttribute("data-rs-shield", "1");
    document.head.appendChild(s);
    window.setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch {} }, 30_000);
    return true;
  } catch {
    return false;
  }
}

/** Warm the base URL as early as possible. */
export function initAdShield(): void {
  void getShieldBase();
}

export function resetAdShieldCache(): void {
  baseCache = null;
  basePromise = null;
}
