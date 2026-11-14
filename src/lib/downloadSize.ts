import { getFilenameRelayBase, filenameRelayCandidates } from "@/lib/filenameRelay";
import { applyActiveDownloadServer, stripWatchSegment } from "@/lib/downloadManagerSettings";
import { unwrapManagedVideoUrl } from "@/lib/videoDownload";

/**
 * Real file size for the download sheet.
 *
 * Every size is read through the same `file-rename` relay that serves the
 * download itself (HEAD, then a 2-byte Range read), because most file servers
 * are plain HTTP or send no CORS headers, so the browser can never read their
 * headers directly. `Range: bytes=0-0` is never used: the Telegram stream
 * servers hang on a zero-length range.
 *
 * Found sizes are kept on the device; a failed check is only remembered for a
 * short time so a server that was briefly offline never shows "unknown"
 * forever.
 */

export const SIZE_CACHE_KEY = "rs_dl_size_cache_v2";
export const SIZE_RETRY_MS = 90_000;
const SIZE_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_REAL_BYTES = 128 * 1024;
const PROBE_TIMEOUT_MS = 8000;

/** Total file size from a response's headers, or 0 when unknown. */
export function sizeFromHeaders(headers: { get(name: string): string | null }, status: number): number {
  const range = headers.get("content-range") || "";
  const m = /\/(\d+)\s*$/.exec(range);
  if (m) {
    const total = Number(m[1]);
    return Number.isFinite(total) && total >= MIN_REAL_BYTES ? total : 0;
  }
  if (status === 206) return 0; // partial body length is not the file size
  const type = String(headers.get("content-type") || "").toLowerCase();
  if (/json|text\/html/.test(type)) return 0;
  const len = Number(headers.get("content-length") || 0);
  return Number.isFinite(len) && len >= MIN_REAL_BYTES ? len : 0;
}

/** Ordered size-check requests for one file: relay first, raw HTTPS last. */
export function sizeProbeRequests(relayBase: string, fileUrl: string): Array<{ href: string; method: "HEAD" | "GET" }> {
  const source = unwrapManagedVideoUrl(fileUrl) || fileUrl;
  if (!/^https?:\/\//i.test(source)) return [];
  const out: Array<{ href: string; method: "HEAD" | "GET" }> = [];
  for (const c of relayBase ? filenameRelayCandidates(relayBase, source, "size-check.bin") : []) {
    out.push({ href: c.href, method: "HEAD" }, { href: c.href, method: "GET" });
  }
  const served = stripWatchSegment(applyActiveDownloadServer(source));
  for (const direct of [served, stripWatchSegment(source)]) {
    if (/^https:\/\//i.test(direct) && !out.some((r) => r.href === direct)) out.push({ href: direct, method: "GET" });
  }
  return out;
}

type Stored = Record<string, { n: number; t: number }>;
const failedAt = new Map<string, number>();

export function readSizeCache(now = Date.now()): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SIZE_CACHE_KEY) || "{}") as Stored;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw || {})) {
      if (v && v.n >= MIN_REAL_BYTES && now - v.t < SIZE_CACHE_TTL_MS) out[k] = v.n;
    }
    return out;
  } catch { return {}; }
}

function saveSize(url: string, n: number) {
  try {
    const raw = JSON.parse(localStorage.getItem(SIZE_CACHE_KEY) || "{}") as Stored;
    raw[url] = { n, t: Date.now() };
    const keys = Object.keys(raw);
    if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach((k) => delete raw[k]);
    localStorage.setItem(SIZE_CACHE_KEY, JSON.stringify(raw));
  } catch {}
}

/** True when a failed check for this file may be tried again now. */
export function canRetrySize(url: string, now = Date.now()): boolean {
  const at = failedAt.get(url);
  return !at || now - at >= SIZE_RETRY_MS;
}

async function timedFetch(href: string, init: RequestInit, ms: number, outer?: AbortSignal) {
  const ac = new AbortController();
  const stop = () => ac.abort();
  outer?.addEventListener("abort", stop);
  const t = setTimeout(stop, ms);
  try { return await fetch(href, { ...init, signal: ac.signal, mode: "cors", credentials: "omit", cache: "no-store" }); }
  finally { clearTimeout(t); outer?.removeEventListener("abort", stop); }
}

/** Reads the real size of one file; 0 = unknown. */
export async function probeDownloadSize(fileUrl: string, signal?: AbortSignal): Promise<number> {
  const relay = await getFilenameRelayBase().catch(() => "");
  for (const req of sizeProbeRequests(relay || "", fileUrl)) {
    if (signal?.aborted) return 0;
    try {
      const r = await timedFetch(req.href, req.method === "GET" ? { method: "GET", headers: { Range: "bytes=0-1" } } : { method: "HEAD" }, PROBE_TIMEOUT_MS, signal);
      const n = r.ok || r.status === 206 ? sizeFromHeaders(r.headers, r.status) : 0;
      try { await r.body?.cancel(); } catch {}
      if (n > 0) return n;
      // A relay that answered "no" for this target: skip its GET twin.
    } catch {}
  }
  return 0;
}

/**
 * Checks many files, a few at a time, reporting each result as soon as it is
 * known (size > 0, or -1 when the size could not be read).
 */
export async function probeDownloadSizes(urls: string[], onResult: (url: string, bytes: number) => void, signal?: AbortSignal, concurrency = 8) {
  const queue = Array.from(new Set(urls.filter(Boolean)));
  const worker = async () => {
    while (queue.length && !signal?.aborted) {
      const url = queue.shift()!;
      const n = await probeDownloadSize(url, signal);
      if (signal?.aborted) return;
      if (n > 0) { failedAt.delete(url); saveSize(url, n); onResult(url, n); }
      else { failedAt.set(url, Date.now()); onResult(url, -1); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

export function formatDownloadSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}
