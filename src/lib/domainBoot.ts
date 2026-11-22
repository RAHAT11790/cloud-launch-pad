/**
 * Domain move with login hand-over.
 *
 * Browsers keep each web address's saved data (login, guest coins, settings)
 * separately, so a plain redirect to a new domain signs everyone out. The old
 * address therefore moves visitors itself: it packs this device's saved data
 * into the link's #fragment (never sent to any server) and the live domain
 * unpacks it synchronously here — imported first in `main.tsx`, before Firebase
 * or any app module reads storage — then removes it from the address bar.
 */
import {
  DEFAULT_SITE_ORIGIN, STATE_REFRESH_MS, fetchSiteDomainState, isPreviewHost, readCachedSiteDomain, stateTrusted,
} from "@/lib/siteDomain";

export const HANDOFF_PARAM = "rs_handoff";
const IN_KEY = "rs_handoff_in_v1";
const MOVES_KEY = "rs_domain_moves";
const USER_KEY = "rsanime_user";
const AUTH_PREFIX = "firebase:authUser:";
/** Never carried: per-address bookkeeping. */
const SKIP = new Set([IN_KEY, "rs_site_domain_v1", MOVES_KEY]);
/** Carried first, whatever their size. */
const FIRST = [USER_KEY, "rs_device_id", "rs_admin_session"];
export const PER_KEY_MAX = 200_000;
export const TOTAL_MAX = 900_000;

export type HandoffPayload = { v: 1; at: number; e: Record<string, string>; h?: string };

const b64urlEncode = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlDecode = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

export function encodeHandoff(p: HandoffPayload): string { return b64urlEncode(JSON.stringify(p)); }
export function decodeHandoff(s: string): HandoffPayload | null {
  try {
    const p = JSON.parse(b64urlDecode(s));
    if (!p || p.v !== 1 || typeof p.e !== "object" || !p.e) return null;
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.e)) if (typeof v === "string" && k.length < 200) e[k] = v;
    return { v: 1, at: Number(p.at) || 0, e, h: typeof p.h === "string" ? p.h.slice(0, 500) : undefined };
  } catch { return null; }
}

/** Choose what to carry: login + device identity first, then the smallest items until the size cap. */
export function pickEntries(all: Array<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  let total = 0;
  const firstRank = (k: string) => (FIRST.includes(k) || k.startsWith(AUTH_PREFIX) ? 0 : 1);
  const list = all.filter(([k, v]) => !SKIP.has(k) && typeof v === "string")
    .sort((a, b) => firstRank(a[0]) - firstRank(b[0]) || a[1].length - b[1].length);
  for (const [k, v] of list) {
    const size = k.length + v.length;
    if (firstRank(k) === 1 && (v.length > PER_KEY_MAX || total + size > TOTAL_MAX)) continue;
    out[k] = v;
    total += size;
  }
  return out;
}

/**
 * Write carried data into this address's storage. Only once per address and
 * only when nobody is signed in here yet — a login made on the new address wins.
 */
export function applyEntries(storage: Storage, p: HandoffPayload): boolean {
  if (storage.getItem(IN_KEY) || storage.getItem(USER_KEY)) return false;
  for (const [k, v] of Object.entries(p.e)) { try { storage.setItem(k, v); } catch { /* full */ } }
  try { storage.setItem(IN_KEY, String(Date.now())); } catch { /* full */ }
  return true;
}

/** The hand-over must come from one of the site's own addresses (blocks crafted links). */
export function trustedReferrer(referrer: string, hereHost: string, knownHosts: string[]): boolean {
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (!host || host === hereHost) return false;
    if (isPreviewHost(hereHost)) return isPreviewHost(host);
    return host === new URL(DEFAULT_SITE_ORIGIN).hostname || knownHosts.includes(host);
  } catch { return false; }
}

let arrived = false;

/** Runs on import: unpack a hand-over in the address bar, then hide it. */
function consumeIncomingHandoff() {
  if (typeof window === "undefined") return;
  const hash = window.location.hash || "";
  const m = hash.match(new RegExp(`[#&]${HANDOFF_PARAM}=([A-Za-z0-9_-]+)`));
  if (!m) return;
  arrived = true;
  const payload = decodeHandoff(m[1]);
  const known = Object.values(readCachedSiteDomain()?.hosts || {}).map((h) => h.host);
  try {
    if (payload && trustedReferrer(document.referrer, window.location.hostname, known)) applyEntries(window.localStorage, payload);
  } catch { /* storage blocked */ }
  try {
    const keep = payload?.h && payload.h.startsWith("#") ? payload.h : "";
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + keep);
  } catch { /* ignore */ }
}
consumeIncomingHandoff();

/** Firebase keeps Google sign-ins in IndexedDB; read them without creating the database. */
function readFirebaseAuthRecords(): Promise<Array<[string, string]>> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: Array<[string, string]>) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish([]), 1500);
    try {
      const req = indexedDB.open("firebaseLocalStorageDb");
      req.onupgradeneeded = () => { try { req.transaction?.abort(); } catch { /* ignore */ } };
      req.onerror = () => finish([]);
      req.onsuccess = () => {
        const db = req.result;
        try {
          if (!db.objectStoreNames.contains("firebaseLocalStorage")) { db.close(); return finish([]); }
          const all = db.transaction("firebaseLocalStorage", "readonly").objectStore("firebaseLocalStorage").getAll();
          all.onsuccess = () => {
            const rows = (all.result || []) as Array<{ fbase_key?: string; value?: unknown }>;
            db.close();
            finish(rows.filter((r) => typeof r.fbase_key === "string" && r.fbase_key.startsWith(AUTH_PREFIX))
              .map((r) => [r.fbase_key as string, JSON.stringify(r.value)]));
          };
          all.onerror = () => { db.close(); finish([]); };
        } catch { finish([]); }
      };
    } catch { finish([]); }
  });
}

const isBot = () => /bot|crawl|spider|slurp|facebookexternalhit/i.test(navigator.userAgent || "");

function recentMoves(now: number): number[] {
  try { return (JSON.parse(sessionStorage.getItem(MOVES_KEY) || "[]") as number[]).filter((t) => now - t < 60_000); } catch { return []; }
}

/**
 * Build the live-domain link for this page with this device's data. It is sent
 * every time (the live domain takes it only once), so a failed first move never
 * loses the login.
 */
export async function buildMoveUrl(live: string): Promise<string> {
  const here = window.location;
  const target = new URL(here.pathname + here.search, live);
  const entries: Array<[string, string]> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) entries.push([k, localStorage.getItem(k) || ""]);
    }
  } catch { /* blocked */ }
  if (!entries.some(([k]) => k.startsWith(AUTH_PREFIX))) entries.push(...await readFirebaseAuthRecords());
  const payload: HandoffPayload = { v: 1, at: Date.now(), e: pickEntries(entries), h: here.hash || undefined };
  return `${target.toString()}#${HANDOFF_PARAM}=${encodeHandoff(payload)}`;
}

/**
 * Decide before the app renders whether this address must move to the live
 * domain. Resolves true when the page is leaving (do not render).
 */
export async function startDomainBoot(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const here = window.location;
  if (here.protocol !== "https:" || isPreviewHost(here.hostname) || arrived || /[?&]rs_stay=1\b/.test(here.search) || isBot()) {
    void fetchSiteDomainState();
    return false;
  }
  let st = readCachedSiteDomain();
  const cachedSaysStay = !!st && st.live === here.origin;
  if (cachedSaysStay) { void fetchSiteDomainState(); return false; }
  if (!st || Date.now() - st.checkedAt > STATE_REFRESH_MS) st = (await fetchSiteDomainState(2500)) || st;
  else void fetchSiteDomainState();
  if (!stateTrusted(st) || st.live === here.origin) return false;
  const now = Date.now();
  const moves = recentMoves(now);
  if (moves.length >= 2) return false;
  try { sessionStorage.setItem(MOVES_KEY, JSON.stringify([...moves, now])); } catch { /* ignore */ }
  window.location.replace(await buildMoveUrl(st.live));
  return true;
}
