// ============================================================
// Route health — "is this function server still alive?"
// ------------------------------------------------------------
// Every routed function (EGD Router row) lives on SOME server: Lovable Cloud,
// an own backend project, or a Cloudflare Worker. When that server disappears
// (project paused, quota exhausted → 402, DNS gone) the site must keep working
// exactly as if the row were empty. This module decides that, once per server
// origin, and remembers the verdict on the device so later calls are instant.
//
// The probe never invokes a function: backend hosts are probed at their bare
// `/functions/v1/` gateway path (404 = alive, 402/5xx-gateway = dead), other
// hosts with a HEAD to the origin root in no-cors mode (network/DNS failure =
// dead). Nothing here blocks playback — callers treat "dead" as "not set up".
// ============================================================

const STORE_KEY = "rs_route_health_v1";
const DEAD_TTL_MS = 5 * 60_000;
const ALIVE_TTL_MS = 30 * 60_000;
const PROBE_TIMEOUT_MS = 3500;

type Verdict = { dead: boolean; at: number };

const memory = new Map<string, Verdict>();
const inflight = new Map<string, Promise<boolean>>();

const originOf = (url: string): string => {
  try {
    const u = new URL(String(url || "").trim());
    return /^https?:$/.test(u.protocol) ? u.origin.toLowerCase() : "";
  } catch {
    return "";
  }
};

const isBackendHost = (origin: string) => /\.supabase\.co$/i.test(origin.replace(/^https?:\/\//, ""));

/** HTTP statuses that mean the server exists but refuses every function call. */
export const isDeadStatus = (status: number): boolean =>
  status === 402 || status === 451 || status === 502 || status === 503 || status === 504 || status === 521 || status === 522 || status === 523 || status === 530;

const readStore = (): Record<string, Verdict> => {
  try {
    if (typeof localStorage === "undefined") return {};
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

const writeVerdict = (origin: string, dead: boolean, now = Date.now()) => {
  const v = { dead, at: now };
  memory.set(origin, v);
  try {
    if (typeof localStorage === "undefined") return;
    const all = readStore();
    all[origin] = v;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {}
};

const freshVerdict = (origin: string, now = Date.now()): Verdict | null => {
  const v = memory.get(origin) || readStore()[origin];
  if (!v) return null;
  const ttl = v.dead ? DEAD_TTL_MS : ALIVE_TTL_MS;
  if (now - Number(v.at || 0) > ttl) return null;
  memory.set(origin, v);
  return v;
};

/** Synchronous: true only when this server was recently proven dead. */
export const isRouteKnownDead = (url: string, now = Date.now()): boolean => {
  const origin = originOf(url);
  if (!origin) return false;
  return freshVerdict(origin, now)?.dead === true;
};

/** Record a failure seen by a real call (network error or dead status). */
export const markRouteDead = (url: string) => {
  const origin = originOf(url);
  if (origin) writeVerdict(origin, true);
};

const timed = async (input: string, init: RequestInit): Promise<Response> => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ctl.signal, cache: "no-store", credentials: "omit" });
  } finally {
    clearTimeout(t);
  }
};

async function probe(origin: string): Promise<boolean> {
  if (isBackendHost(origin)) {
    try {
      const r = await timed(`${origin}/functions/v1/`, { method: "GET" });
      return !isDeadStatus(r.status);
    } catch {
      // CORS-less answer or network failure — tell them apart with no-cors.
    }
  }
  try {
    await timed(`${origin}/`, { method: "HEAD", mode: "no-cors" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Async: resolves true when the server of `url` can serve requests.
 * One probe per origin at a time; verdicts are cached on the device.
 */
export function checkRouteAlive(url: string): Promise<boolean> {
  const origin = originOf(url);
  if (!origin) return Promise.resolve(false);
  if (typeof fetch === "undefined") return Promise.resolve(true);
  const cached = freshVerdict(origin);
  if (cached) return Promise.resolve(!cached.dead);
  const running = inflight.get(origin);
  if (running) return running;
  const p = probe(origin)
    .then((alive) => {
      writeVerdict(origin, !alive);
      return alive;
    })
    .finally(() => inflight.delete(origin));
  inflight.set(origin, p);
  return p;
}

/** Returns `url` when its server is alive, otherwise "" (= treat as not set up). */
export async function aliveOrEmpty(url: string): Promise<string> {
  const clean = String(url || "").trim();
  if (!clean) return "";
  return (await checkRouteAlive(clean)) ? clean : "";
}

/** Test helper. */
export const __resetRouteHealth = () => {
  memory.clear();
  inflight.clear();
  try { localStorage.removeItem(STORE_KEY); } catch {}
};
