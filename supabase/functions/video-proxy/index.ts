import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

// 🆕 NEW v8 (2026-07-24) — HTTPS BUFFER-KILLER + opt-in faststart. REDEPLOY REQUIRED.
// After deploy, paste this URL back into Admin → EGD Router.
// ============================================================
// video-proxy — Universal HLS/video proxy (no scripts, no protection)
// ============================================================
// Use: /functions/v1/video-proxy?url=<ENCODED_VIDEO_URL>
// - Accepts http:// and https:// upstream URLs.
// - Rewrites HLS playlists so variants/segments also travel through this proxy.
// - v8 HTTPS OPT: 16MB range window (was 8MB) → half the round-trips per file,
//   noticeably smoother RS HTTPS playback with the same total bandwidth.
// - Fast-path streaming: `res.body` piped straight to the client, no
//   `arrayBuffer()` buffering on the edge → tiny TTFB.
// - Opt-in `?faststart=1` moov-rewriter only kicks in when the player asks
//   for it (moov-at-end MP4 recovery), never blocks the happy path.
// ============================================================

const cors: Record<string, string> = {
  ...corsHeaders,
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type, etag, last-modified, cache-control, x-rs-proxy-fallback, x-rs-proxy-error, x-rs-proxy-range, x-rs-window",
  "Access-Control-Max-Age": "86400",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"];
// v9 (Supabase/Deno edge): ADAPTIVE range windows instead of one fixed 16MB block.
// A 16MB window on a slow HTTP mirror means the browser waits for a huge upstream
// response before the first frame can decode → "video never loads". Small first
// window = instant start; bigger later windows = fewer round-trips while playing.
const WINDOW_START_BYTES = 1 * 1024 * 1024;   // first bytes / seek → decode ASAP
const WINDOW_STEADY_BYTES = 6 * 1024 * 1024;  // steady playback
const WINDOW_HTTPS_BYTES = 12 * 1024 * 1024;  // https mirrors are faster, fewer hops
// Hard timeouts: without these, a dead mirror keeps the edge socket open until the
// platform kills the invocation, which is exactly why the proxy looked "down".
const HEADER_TIMEOUT_MS = 7000;
const FASTSTART_WINDOW_BYTES = 8 * 1024 * 1024;
const FASTSTART_HEAD_BYTES = 2 * 1024 * 1024;
const FASTSTART_TAIL_BYTES = 16 * 1024 * 1024;

// Fetch that gives up on *headers* quickly but never truncates a healthy body:
// the timeout is cleared as soon as the response head arrives.
async function fetchHead(url: string, init: RequestInit, outerSignal: AbortSignal) {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  outerSignal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), HEADER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener("abort", onAbort);
  }
}



const isM3u8 = (url: string, contentType: string | null) => /mpegurl|m3u8/i.test(contentType || "") || /\.m3u8(?:[?#]|$)/i.test(url);
const isDirectMp4Like = (url: URL) => /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(url.pathname + url.search);

function clampInvalidContentRange(headers: Headers) {
  const raw = headers.get("content-range") || "";
  const match = raw.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  if (!match) return;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(total) || total <= 0) return;
  const maxEnd = total - 1;
  if (end <= maxEnd) return;
  const safeLength = Math.max(0, total - start);
  headers.set("content-range", `bytes ${start}-${maxEnd}/${total}`);
  headers.set("content-length", String(safeLength));
}

function fallbackResponse(message: string, detail = "", upstreamStatus?: number) {
  return new Response(JSON.stringify({
    error: "VIDEO_SOURCE_UNAVAILABLE",
    fallback: true,
    message,
    detail,
    upstreamStatus: upstreamStatus || null,
  }), {
    // Keep this 200 so the browser/runtime does not report the edge call itself
    // as a fatal 502/5xx. The player reads x-rs-proxy-fallback/json and moves
    // to the next configured route/server instead of leaving a blank screen.
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "x-rs-proxy-fallback": "1",
      "x-rs-proxy-error": message,
    },
  });
}

const toOpaqueUrlToken = (value: string) => {
  try {
    return btoa(unescape(encodeURIComponent(String(value || ""))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  } catch { return ""; }
};

const fromOpaqueUrlToken = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch { return ""; }
};

// NOTE: cross-mirror auto-swap removed. Previously this proxy silently rewrote
// requests between rahat1102-video-hosting-bot.hf.space, fi3.bot-hosting.net,
// rs-stream-bot-*.onrender.com when one origin was down. That masked outages
// and — after any admin URL change — kept probing dead origins for seconds
// before falling back, which made the URL Changer feel "slow" and download/
// playback appear broken. Now the proxy fetches exactly the URL saved by
// admin in Firebase. Failover between origins is the admin's job (URL Changer)
// or the per-server switch in VideoPlayer.tsx (see strict-server-isolation memory).

function buildUpstreamCandidates(target: URL): URL[] {
  return [target];
}


function pickWindowBytes(start: number, upstreamUrl: URL) {
  if (start === 0) return WINDOW_START_BYTES;
  return upstreamUrl.protocol === "https:" ? WINDOW_HTTPS_BYTES : WINDOW_STEADY_BYTES;
}

function alignMediaRange(range: string | null, upstreamUrl: URL): { range: string | null; windowStart: number | null } {
  if (!range || !isDirectMp4Like(upstreamUrl)) return { range, windowStart: null };
  const m = range.trim().match(/^bytes=(\d+)-$/i);
  if (!m) return { range, windowStart: null };
  const start = Number(m[1]);
  if (!Number.isFinite(start) || start < 0) return { range, windowStart: null };
  return { range: `bytes=${start}-${start + pickWindowBytes(start, upstreamUrl) - 1}`, windowStart: start };
}


function requestedOpenEndedRange(range: string | null) {
  return /^bytes=\d+-$/i.test(String(range || "").trim());
}

function browserRangeResponseHeaders(headers: Headers, originalRange: string | null) {
  if (!requestedOpenEndedRange(originalRange)) return;
  if (!headers.has("content-range")) headers.delete("content-length");
}

function parseContentRange(value: string | null) {
  const m = String(value || "").match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const total = m[3] === "*" ? NaN : Number(m[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end, total };
}

function readUint64(view: DataView, offset: number) {
  const hi = view.getUint32(offset);
  const lo = view.getUint32(offset + 4);
  return hi * 2 ** 32 + lo;
}

function atomAt(buf: Uint8Array, offset: number) {
  if (offset + 8 > buf.byteLength) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let size = view.getUint32(offset);
  const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]);
  let header = 8;
  if (size === 1) {
    if (offset + 16 > buf.byteLength) return null;
    size = readUint64(view, offset + 8);
    header = 16;
  }
  if (!size || size < header || offset + size > buf.byteLength) return null;
  return { size, type, header };
}

const MP4_CONTAINER_ATOMS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta", "meta", "ilst", "mvex", "moof", "traf"]);

function patchChunkOffsets(buf: Uint8Array, delta: number, start = 0, end = buf.byteLength) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = start;
  while (offset + 8 <= end) {
    const atom = atomAt(buf, offset);
    if (!atom || offset + atom.size > end) break;
    const payload = offset + atom.header;
    if (atom.type === "stco" && payload + 8 <= offset + atom.size) {
      const count = view.getUint32(payload + 4);
      let p = payload + 8;
      for (let i = 0; i < count && p + 4 <= offset + atom.size; i += 1, p += 4) {
        view.setUint32(p, (view.getUint32(p) + delta) >>> 0);
      }
    } else if (atom.type === "co64" && payload + 8 <= offset + atom.size) {
      const count = view.getUint32(payload + 4);
      let p = payload + 8;
      for (let i = 0; i < count && p + 8 <= offset + atom.size; i += 1, p += 8) {
        const next = BigInt(Math.round(readUint64(view, p) + delta));
        view.setBigUint64(p, next);
      }
    } else if (MP4_CONTAINER_ATOMS.has(atom.type)) {
      patchChunkOffsets(buf, delta, atom.type === "meta" ? payload + 4 : payload, offset + atom.size);
    }
    offset += atom.size;
  }
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) { out.set(part, cursor); cursor += part.byteLength; }
  return out;
}

function parseRequestedRange(range: string | null, total: number) {
  const raw = String(range || "").trim();
  const m = raw.match(/^bytes=(\d+)-(\d*)$/i);
  if (!m) return { start: 0, end: Math.min(total - 1, FASTSTART_WINDOW_BYTES - 1) };
  const start = Math.max(0, Number(m[1]));
  const explicitEnd = m[2] ? Number(m[2]) : NaN;
  const end = Number.isFinite(explicitEnd)
    ? Math.min(total - 1, explicitEnd)
    : Math.min(total - 1, start + FASTSTART_WINDOW_BYTES - 1);
  return { start, end: Math.max(start, end) };
}

async function fetchRangeBytes(target: URL, range: string, baseHeaders: Record<string, string>, signal: AbortSignal) {
  const origin = `${target.protocol}//${target.host}`;
  const attempts = [
    { ...baseHeaders, range },
    { ...baseHeaders, range, Referer: `${origin}/` },
    { ...baseHeaders, range, Referer: `${origin}/`, Origin: origin },
  ];
  let lastError = "";
  for (const headers of attempts) {
    try {
      const res = await fetch(target.toString(), { method: "GET", headers, redirect: "follow", signal });
      if (res.ok || res.status === 206) return new Uint8Array(await res.arrayBuffer());
      lastError = `HTTP ${res.status}`;
      try { await res.body?.cancel(); } catch {}
    } catch (e) { lastError = (e as Error)?.message || String(e); }
  }
  throw new Error(lastError || "range fetch failed");
}

async function probeTotalSize(target: URL, baseHeaders: Record<string, string>, signal: AbortSignal) {
  const origin = `${target.protocol}//${target.host}`;
  const attempts = [
    { ...baseHeaders, range: "bytes=0-0" },
    { ...baseHeaders, range: "bytes=0-0", Referer: `${origin}/` },
    { ...baseHeaders, range: "bytes=0-0", Referer: `${origin}/`, Origin: origin },
  ];
  for (const headers of attempts) {
    const res = await fetch(target.toString(), { method: "GET", headers, redirect: "follow", signal });
    const cr = parseContentRange(res.headers.get("content-range"));
    const len = Number(res.headers.get("content-length") || 0);
    try { await res.body?.cancel(); } catch {}
    if (cr && Number.isFinite(cr.total) && cr.total > 0) return cr.total;
    if (len > 0 && res.status === 200) return len;
  }
  return 0;
}

function findMoovInTail(tail: Uint8Array, tailStart: number) {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let i = 0; i + 8 <= tail.byteLength; i += 1) {
    if (tail[i + 4] !== 0x6d || tail[i + 5] !== 0x6f || tail[i + 6] !== 0x6f || tail[i + 7] !== 0x76) continue;
    let size = view.getUint32(i);
    let header = 8;
    if (size === 1 && i + 16 <= tail.byteLength) { size = readUint64(view, i + 8); header = 16; }
    if (size >= header && tailStart + i + size <= tailStart + tail.byteLength) return { start: tailStart + i, size };
  }
  return null;
}

async function tryFaststartMp4(
  req: Request,
  target: URL,
  rawRange: string | null,
  baseHeaders: Record<string, string>,
  signal: AbortSignal,
) {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  if (!isDirectMp4Like(target)) return null;
  const total = await probeTotalSize(target, baseHeaders, signal);
  if (!total || total < 1024 * 1024) return null;
  const headEnd = Math.min(total - 1, FASTSTART_HEAD_BYTES - 1);
  const head = await fetchRangeBytes(target, `bytes=0-${headEnd}`, baseHeaders, signal);
  const ftyp = atomAt(head, 0);
  if (!ftyp || ftyp.type !== "ftyp") return null;
  const second = atomAt(head, ftyp.size);
  if (second?.type === "moov") return null;
  const tailStart = Math.max(0, total - FASTSTART_TAIL_BYTES);
  const tail = await fetchRangeBytes(target, `bytes=${tailStart}-${total - 1}`, baseHeaders, signal);
  const moovMeta = findMoovInTail(tail, tailStart);
  if (!moovMeta || moovMeta.start < ftyp.size || moovMeta.start + moovMeta.size > total) return null;
  const moov = moovMeta.start >= tailStart && moovMeta.start + moovMeta.size <= total
    ? tail.slice(moovMeta.start - tailStart, moovMeta.start - tailStart + moovMeta.size)
    : await fetchRangeBytes(target, `bytes=${moovMeta.start}-${moovMeta.start + moovMeta.size - 1}`, baseHeaders, signal);
  const patchedMoov = new Uint8Array(moov);
  patchChunkOffsets(patchedMoov, moovMeta.size);

  const { start, end } = parseRequestedRange(rawRange, total);
  const headers = new Headers(cors);
  headers.set("content-type", "video/mp4");
  headers.set("accept-ranges", "bytes");
  headers.set("content-range", `bytes ${start}-${end}/${total}`);
  headers.set("content-length", String(end - start + 1));
  headers.set("cache-control", "public, max-age=604800, immutable");
  headers.set("content-disposition", "inline");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Timing-Allow-Origin", "*");
  headers.set("x-rs-faststart", "1");
  if (req.method === "HEAD") return new Response(null, { status: 206, headers });

  const ftypBytes = head.slice(0, ftyp.size);
  const parts: Uint8Array[] = [];
  const pushVirtual = async (from: number, to: number) => {
    if (to < from) return;
    const ftypEnd = ftypBytes.byteLength - 1;
    const moovStart = ftypBytes.byteLength;
    const moovEnd = moovStart + patchedMoov.byteLength - 1;
    if (from <= ftypEnd) parts.push(ftypBytes.slice(from, Math.min(to, ftypEnd) + 1));
    if (to >= moovStart && from <= moovEnd) parts.push(patchedMoov.slice(Math.max(from, moovStart) - moovStart, Math.min(to, moovEnd) - moovStart + 1));
    const mediaStart = moovEnd + 1;
    if (to >= mediaStart) {
      const virtualFrom = Math.max(from, mediaStart);
      const virtualTo = to;
      const originalFrom = virtualFrom - patchedMoov.byteLength;
      const originalTo = Math.min(moovMeta.start - 1, virtualTo - patchedMoov.byteLength);
      if (originalTo >= originalFrom) parts.push(await fetchRangeBytes(target, `bytes=${originalFrom}-${originalTo}`, baseHeaders, signal));
    }
  };
  await pushVirtual(start, end);
  return new Response(concatBytes(parts), { status: 206, headers });
}

async function drainReader(reader: ReadableStreamDefaultReader<Uint8Array>, controller: ReadableStreamDefaultController<Uint8Array>) {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value && value.byteLength) controller.enqueue(value);
  }
}

function streamOpenEndedRange(target: URL, method: string, firstResponse: Response, out: Headers, rawRange: string | null, headers: Record<string, string>, signal: AbortSignal) {
  if (method === "HEAD" || !requestedOpenEndedRange(rawRange)) return null;
  const firstRange = parseContentRange(firstResponse.headers.get("content-range"));
  const requestedStart = Number(String(rawRange || "").match(/^bytes=(\d+)-$/i)?.[1] || NaN);
  if (!firstRange || !Number.isFinite(firstRange.total) || firstRange.total <= 0 || firstRange.start !== requestedStart) return null;

  out.set("content-range", `bytes ${firstRange.start}-${firstRange.total - 1}/${firstRange.total}`);
  out.set("content-length", String(firstRange.total - firstRange.start));

  return new ReadableStream<Uint8Array>({
    start(controller) {
      (async () => {
      let cursor = firstRange.start;
      try {
        const firstReader = firstResponse.body?.getReader();
        if (firstReader) {
          await drainReader(firstReader, controller);
          cursor = firstRange.end + 1;
        }
        while (cursor < firstRange.total) {
          const chunkEnd = Math.min(cursor + WINDOW_STEADY_BYTES - 1, firstRange.total - 1);
          const nextHeaders = { ...headers, range: `bytes=${cursor}-${chunkEnd}` };
          const res = await fetch(target.toString(), { method: "GET", headers: nextHeaders, redirect: "follow", signal });
          if (!(res.ok || res.status === 206)) {
            try { await res.body?.cancel(); } catch {}
            throw new Error(`Upstream chunk ${cursor}-${chunkEnd} failed: ${res.status}`);
          }
          const reader = res.body?.getReader();
          if (!reader) throw new Error("Upstream chunk body missing");
          await drainReader(reader, controller);
          cursor = chunkEnd + 1;
        }
        controller.close();
      } catch (e) {
        try { controller.error(e); } catch {}
      }
      })();
    },
    cancel() {
      try { firstResponse.body?.cancel(); } catch {}
    },
  });
}

function proxyUrl(reqUrl: URL, target: string) {
  // v9 MIXED-CONTENT FIX: inside the edge runtime the incoming URL is often
  // http://<host>/video-proxy (gateway-internal). Emitting that inside an HLS
  // playlist made the browser block every segment on an https page — the page
  // then showed "video not loading" even though the proxy was healthy.
  // Always emit https + the public /functions/v1/<name> path.
  const path = reqUrl.pathname.startsWith("/functions/v1/") ? reqUrl.pathname : `/functions/v1${reqUrl.pathname}`;
  const base = `https://${reqUrl.host}${path}`;
  return `${base}?src=${encodeURIComponent(toOpaqueUrlToken(target))}`;
}


function resolveHttpUrl(value: string, baseUrl: string) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("#")) return raw;
  try {
    return new URL(raw, baseUrl).toString();
  } catch { return raw; }
}

function rewritePlaylist(text: string, targetUrl: string, reqUrl: URL) {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        const abs = resolveHttpUrl(uri, targetUrl);
        return /^https?:\/\//i.test(abs) ? `URI="${proxyUrl(reqUrl, abs)}"` : `URI="${uri}"`;
      });
    }
    const abs = resolveHttpUrl(trimmed, targetUrl);
    return /^https?:\/\//i.test(abs) ? proxyUrl(reqUrl, abs) : line;
  }).join("\n");
}

// Domain allowlist — block open SSRF / bandwidth abuse from other sites.
const ALLOWED_HOST_RX_VP = [
  /\.lovable\.app$/i,
  /\.lovableproject\.com$/i,
  /^lovable\.app$/i,
  /^lovableproject\.com$/i,
  /^rsanime03\.lovable\.app$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/i,
];
const matchesAllowedHostVP = (urlStr: string | null): boolean => {
  if (!urlStr) return false;
  try { return ALLOWED_HOST_RX_VP.some((rx) => rx.test(new URL(urlStr).host)); } catch { return false; }
};
const isAllowedRequestVP = (req: Request): boolean => {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!origin && !referer) return false;
  return matchesAllowedHostVP(origin) || matchesAllowedHostVP(referer);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: cors });
  if (!isAllowedRequestVP(req)) {
    return new Response(
      JSON.stringify({ error: "Access denied", message: "This stream can only be played on the official RS Anime site." }),
      { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("url") || fromOpaqueUrlToken(reqUrl.searchParams.get("src") || "");
  if (!target) return new Response("Missing ?url=", { status: 400, headers: cors });

  let upstreamUrl: URL;
  try { upstreamUrl = new URL(target); } catch { return new Response("Invalid url", { status: 400, headers: cors }); }
  if (upstreamUrl.protocol !== "http:" && upstreamUrl.protocol !== "https:") return new Response("Only http/https supported", { status: 400, headers: cors });

  const rawRange = req.headers.get("range");
  const aligned = alignMediaRange(rawRange, upstreamUrl);
  const baseHeaders: Record<string, string> = {
    "User-Agent": UA,
    Accept: req.headers.get("accept") || "*/*",
    "Accept-Encoding": "identity",
    "Accept-Language": req.headers.get("accept-language") || "en-US,en;q=0.9",
  };
  for (const key of ["range", "if-range", "if-none-match", "if-modified-since", "cache-control"]) {
    const value = req.headers.get(key);
    if (value) baseHeaders[key] = key === "range" ? aligned.range || value : value;
  }

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  // FAST-PATH: skip the moov-at-end rewriter unless the client explicitly asks
  // for it with `?faststart=1`. The rewriter does 3+ blocking fetches (probe
  // size + head + tail) BEFORE any byte reaches the browser, which killed TTFB
  // on the HTTP RS server. Well-authored Telegram MP4s have moov at the front
  // and never need it; the client only opts in when direct playback stalls.
  const wantsFaststart = reqUrl.searchParams.get("faststart") === "1";
  if (wantsFaststart) {
    try {
      const faststart = await tryFaststartMp4(req, upstreamUrl, rawRange, baseHeaders, ac.signal);
      if (faststart) return faststart;
    } catch {
      // Fall through to the normal streaming proxy if fast-start rewriting cannot
      // be applied for this source. Playback must never fail only because the
      // optimization path could not parse a particular MP4 layout.
    }
  }


  let up: Response | null = null;
  let lastError = "";
  let effectiveUrl = upstreamUrl;
  let effectiveHeaders: Record<string, string> = { ...baseHeaders };
  for (const candidate of buildUpstreamCandidates(upstreamUrl)) {
    const origin = `${candidate.protocol}//${candidate.host}`;
    const candidateBaseHeaders = { ...baseHeaders };
    if (rawRange) candidateBaseHeaders.range = alignMediaRange(rawRange, candidate).range || rawRange;
    // v9: SAME-ORIGIN REFERER FIRST. Most RS/HTTP mirrors only answer requests
    // that look same-origin; starting bare meant every single segment paid one
    // failed round-trip before succeeding — that is what felt like "the proxy
    // is down". We never forward the browser's own Referer (public site host).
    const attempts: Record<string, string>[] = [
      { ...candidateBaseHeaders, Referer: `${origin}/` },
      { ...candidateBaseHeaders, Referer: `${origin}/`, Origin: origin },
      candidateBaseHeaders,
    ];
    for (const headers of attempts) {
      try {
        up = await fetchHead(candidate.toString(), { method: req.method, headers, redirect: "follow" }, ac.signal);
        if (up.ok || up.status === 206 || up.status === 304) {
          effectiveUrl = candidate;
          effectiveHeaders = headers;
          break;
        }
        lastError = `HTTP ${up.status}`;
        try { await up.body?.cancel(); } catch {}
        // 4xx from the mirror is a definitive answer; retrying header variants
        // only burns time. Only auth-ish/5xx codes are worth another attempt.
        if (up.status < 500 && up.status !== 403 && up.status !== 401 && up.status !== 429) { up = null; break; }
        up = null;
      } catch (e) {
        lastError = (e as Error).message;
        up = null;
      }
    }
    if (up && (up.ok || up.status === 206 || up.status === 304)) break;
  }



  if (!up) return fallbackResponse("Upstream failed", lastError || "network error");
  if (!(up.ok || up.status === 206 || up.status === 304)) {
    try { await up.body?.cancel(); } catch {}
    return fallbackResponse("Upstream returned an error", lastError || `HTTP ${up.status}`, up.status);
  }

  const out = new Headers(cors);
  for (const k of PASS) { const v = up.headers.get(k); if (v) out.set(k, v); }
  clampInvalidContentRange(out);
  browserRangeResponseHeaders(out, rawRange);
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
  out.set("content-disposition", "inline");
  out.set("Cross-Origin-Resource-Policy", "cross-origin");
  out.set("Timing-Allow-Origin", "*");
  if (baseHeaders.range && baseHeaders.range !== req.headers.get("range")) out.set("x-rs-proxy-range", baseHeaders.range);
  if (aligned.windowStart !== null) out.set("x-rs-window", String(aligned.windowStart));

  if (req.method !== "HEAD" && up.ok && isM3u8(effectiveUrl.toString(), up.headers.get("content-type"))) {
    const body = rewritePlaylist(await up.text(), effectiveUrl.toString(), reqUrl);
    out.delete("content-length");
    out.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    out.set("cache-control", "public, max-age=6, stale-while-revalidate=30");
    return new Response(body, { status: up.status, statusText: up.statusText, headers: out });
  }

  // Long cache for immutable media chunks — lets any downstream CDN/browser skip instantly.
  if (isDirectMp4Like(effectiveUrl) && (up.status === 200 || up.status === 206)) {
    out.set("cache-control", "public, max-age=604800, immutable");
  }

  // For RS direct files, keep the upstream response bounded to the small range
  // requested in alignMediaRange(). Do NOT re-assemble `bytes=N-` into a single
  // huge tail response; that was tying up slow mirrors and made seek/skip wait
  // until the edge had streamed a long body. Browsers handle short 206 chunks and
  // immediately ask for the next window, which feels much closer to native download.
  return new Response(req.method === "HEAD" ? null : up.body, { status: up.status, statusText: up.statusText, headers: out });
});
