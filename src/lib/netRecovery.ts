// ============================================================
// Network recovery — one place decides how playback reads survive a
// dropped / flaky mobile connection.
// ============================================================
// A phone losing signal for a few seconds is NOT a broken file or a broken
// audio track. Reads keep retrying (with growing waits) for up to
// NET_RETRY_WINDOW_MS, and the native player waits for the connection to come
// back and then resumes the same video at the same second instead of burning
// through every server and showing "Link expired".

/** How long range reads keep retrying network / server errors before giving up. */
export const NET_RETRY_WINDOW_MS = 120_000;
/** Longest single wait between two retries. */
export const NET_RETRY_MAX_DELAY_MS = 4_000;
/** Client errors (404, 403 …) are real: give up after this many attempts. */
export const CLIENT_ERROR_ATTEMPTS = 2;
/** Range-shape problems (server ignored range …) are retried this many times. */
export const RANGE_ERROR_ATTEMPTS = 3;

export type ReadFailure = "network" | "server" | "client" | "range";

/** Classify one failed range read. */
export function classifyReadFailure(error: unknown, status = 0): ReadFailure {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "server";
  if (status >= 400) return "client";
  const msg = String((error as any)?.message || error || "");
  if (/^HTTP (\d+)/.test(msg)) return classifyReadFailure(null, Number(msg.slice(5, 8)));
  if (/range mismatch|ignored range|proxy fallback/i.test(msg)) return "range";
  return "network"; // TypeError "Failed to fetch", timeouts, proxy fallback, resets
}

/**
 * Wait before the next retry (ms), or -1 to give up.
 * `attempt` is the number of attempts already made (1 after the first failure).
 */
export function readRetryDelay(kind: ReadFailure, attempt: number, elapsedMs: number): number {
  if (kind === "client" && attempt >= CLIENT_ERROR_ATTEMPTS) return -1;
  if (kind === "range" && attempt >= RANGE_ERROR_ATTEMPTS) return -1;
  if (elapsedMs >= NET_RETRY_WINDOW_MS) return -1;
  const delay = Math.min(NET_RETRY_MAX_DELAY_MS, 400 * 2 ** Math.max(0, attempt - 1));
  return Math.min(delay, Math.max(0, NET_RETRY_WINDOW_MS - elapsedMs));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait until the browser says it is online again (or `maxMs` passes). */
export function whenOnline(maxMs: number): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); window.removeEventListener("online", done); resolve(); };
    const t = setTimeout(done, maxMs);
    window.addEventListener("online", done, { once: true });
  });
}

/** Is the internet reachable right now? (same-origin tiny request, never cached) */
export async function networkReachable(timeoutMs = 4000): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (typeof fetch !== "function" || typeof location === "undefined") return true;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${location.origin}/robots.txt?rsnet=${Date.now()}`, { cache: "no-store", signal: ctrl.signal });
    return res.ok || res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves true once the network is back, false when `maxMs` passed or `isCancelled()` says stop. */
export async function waitForNetwork(maxMs = 10 * 60_000, isCancelled: () => boolean = () => false): Promise<boolean> {
  const started = Date.now();
  let step = 0;
  while (Date.now() - started < maxMs) {
    if (isCancelled()) return false;
    if (await networkReachable()) return true;
    step += 1;
    await Promise.race([whenOnline(5000), sleep(Math.min(5000, 1000 * step))]);
  }
  return false;
}
