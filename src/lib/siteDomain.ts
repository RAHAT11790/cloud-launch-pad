/**
 * Live site domain — one place decides which web address the site lives on.
 *
 * The email server (`site-domain` action) checks every domain the owner
 * controls (Firebase Auth authorized domains + where the old Lovable address
 * redirects) and saves the result in Firebase `settings/siteDomain`, which only
 * the server may write. Everything that prints the site's address (share links,
 * Telegram posts, invite links, canonical tags, install links) reads it here.
 *
 * This module must not import Firebase: it runs before the app boots.
 */

export const DEFAULT_SITE_ORIGIN = "https://rsanime03.lovable.app";
export const FIREBASE_DB = "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app";
export const SITE_DOMAIN_PATH = "settings/siteDomain";
const CACHE_KEY = "rs_site_domain_v1";
/** A saved check older than this is never used to move visitors. */
export const STATE_MAX_AGE_MS = 24 * 3600_000;
/** Visitors ask the server to re-check when the saved check is older than this. */
export const STATE_REFRESH_MS = 30 * 60_000;

export type SiteHostState = { host: string; serving: boolean; redirect?: string; checkedAt?: number; /** Google sign-in can finish on this address itself (server-checked). */ google?: boolean };
export type SiteDomainState = { live: string; hosts: Record<string, SiteHostState>; checkedAt: number };

/** Hosts that are never "the site": previews, local dev and Firebase's own pages. */
export function isPreviewHost(host: string): boolean {
  const h = String(host || "").toLowerCase();
  return !h || h === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.endsWith(".lovableproject.com")
    || h.endsWith(".lovableproject-dev.com") || h.endsWith(".lovable.dev") || h.endsWith(".firebaseapp.com")
    || h.endsWith(".web.app") || (h.endsWith(".lovable.app") && h.includes("--"));
}

const cleanOrigin = (v: unknown): string => {
  try {
    const u = new URL(String(v || ""));
    return u.protocol === "https:" && !isPreviewHost(u.hostname) ? u.origin : "";
  } catch { return ""; }
};

/** Validate a stored/fetched state; anything malformed is ignored. */
export function parseSiteDomainState(raw: unknown): SiteDomainState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const live = cleanOrigin(r.live);
  const checkedAt = Number(r.checkedAt) || 0;
  if (!live || !checkedAt) return null;
  const hosts: Record<string, SiteHostState> = {};
  if (r.hosts && typeof r.hosts === "object") {
    for (const [k, v] of Object.entries(r.hosts as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const h = v as Record<string, unknown>;
      const host = String(h.host || "").toLowerCase();
      if (!host) continue;
      hosts[k] = { host, serving: h.serving === true, redirect: typeof h.redirect === "string" ? h.redirect : undefined, checkedAt: Number(h.checkedAt) || 0, ...(h.google === true ? { google: true } : {}) };
    }
  }
  return { live, hosts, checkedAt };
}

export function readCachedSiteDomain(): SiteDomainState | null {
  try { return parseSiteDomainState(JSON.parse(localStorage.getItem(CACHE_KEY) || "null")); } catch { return null; }
}
export function writeCachedSiteDomain(state: SiteDomainState | null) {
  try { if (state) localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch { /* storage full */ }
}

/** True when this saved check may be used to send visitors to `live`. */
export function stateTrusted(state: SiteDomainState | null, now = Date.now()): state is SiteDomainState {
  if (!state || now - state.checkedAt > STATE_MAX_AGE_MS) return false;
  const liveHost = new URL(state.live).hostname;
  return Object.values(state.hosts).some((h) => h.host === liveHost && h.serving);
}

/**
 * The site's public address. On the real site this is simply the address the
 * visitor is on; on previews/local dev it is the last checked live domain.
 */
export function liveSiteOrigin(): string {
  if (typeof window === "undefined") return DEFAULT_SITE_ORIGIN;
  const here = window.location;
  if (here.protocol === "https:" && !isPreviewHost(here.hostname)) {
    const st = readCachedSiteDomain();
    // On an old address that is about to move, links already point to the live one.
    return stateTrusted(st) && st.live !== here.origin ? st.live : here.origin;
  }
  const st = readCachedSiteDomain();
  return st?.live || DEFAULT_SITE_ORIGIN;
}

export function liveSiteHost(): string {
  try { return new URL(liveSiteOrigin()).hostname; } catch { return "rsanime03.lovable.app"; }
}

/** Read the saved check from Firebase over REST (public read, server-only write). */
export async function fetchSiteDomainState(timeoutMs = 2500): Promise<SiteDomainState | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${FIREBASE_DB}/${SITE_DOMAIN_PATH}.json`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!r.ok) return null;
    const st = parseSiteDomainState(await r.json());
    if (st) writeCachedSiteDomain(st);
    return st;
  } catch { return null; }
}

/**
 * Ask the email server to re-check the domains (it throttles itself) when the
 * saved check is getting old. Loaded lazily so the router/Firebase stay out of boot.
 */
export async function refreshSiteDomain(force = false): Promise<SiteDomainState | null> {
  const cur = readCachedSiteDomain();
  if (!force && cur && Date.now() - cur.checkedAt < STATE_REFRESH_MS) return cur;
  try {
    const { getEdgeFunctionUrl } = await import("@/lib/edgeFunctionRouter");
    const base = (await getEdgeFunctionUrl("email-service")).replace(/\/+$/, "");
    if (!base) return cur;
    const r = await fetch(`${base}/site-domain${force ? "?force=1" : ""}`, { cache: "no-store" });
    const body = r.ok ? await r.json() : null;
    const st = parseSiteDomainState(body?.state);
    if (st) writeCachedSiteDomain(st);
    return st || cur;
  } catch { return cur; }
}
