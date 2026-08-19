// 🆕 v9 (2026-08-01) — CLOUDFLARE-NATIVE FAST PATH. REDEPLOY REQUIRED.
// After deploy, paste this Worker URL back into Admin → EGD Router → video-proxy.
// ============================================================
// Cloudflare Worker — video-proxy (v9, tuned ONLY for Cloudflare)
// ============================================================
// Deploy as a Module Worker. Usage:
//   https://<worker>.<sub>.workers.dev/?url=<ENCODED_VIDEO_URL>
//
// WHY THIS IS DIFFERENT FROM THE SUPABASE VERSION
// The Supabase (Deno) edge sits far from most mirrors and has no shared cache,
// so it needs small adaptive range windows. Cloudflare is the opposite: 300+
// PoPs, Argo-style backbone routing, and a real edge cache. So here we:
//   1. PASS RANGES THROUGH UNTOUCHED for https upstreams — no re-windowing, no
//      extra round-trips. Re-windowing on CF was the reason a 22ms-ping proxy
//      still buffered: every seek paid an extra edge→origin hop.
//   2. Clamp only plain-http upstreams (8MB) because those mirrors are slow and
//      an unbounded tail request ties the socket up.
//   3. Use the CF edge cache (`cacheEverything`) for immutable media + HLS
//      segments, so the 2nd viewer of an episode is served from the PoP.
//   4. Hard 7s header timeout + same-origin-Referer-first attempts, so a dead
//      mirror fails over instantly instead of hanging (that is what made the
//      proxy look "down").
//   5. Streaming pass-through — the body is never buffered on the edge.
// No env vars required.
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified, cache-control, x-rs-proxy-fallback, x-rs-proxy-error, x-rs-edge",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"];

// Only plain-http mirrors get a bounded window on CF.
const HTTP_WINDOW_BYTES = 8 * 1024 * 1024;
const HEADER_TIMEOUT_MS = 7000;
const MEDIA_EDGE_TTL = 60 * 60 * 24 * 7;

const isM3u8 = (url, ct) => /mpegurl|m3u8/i.test(ct || "") || /\.m3u8(?:[?#]|$)/i.test(url);
const isMediaSegment = (u) => /\.(?:ts|m4s|mp4|m4v|mov|webm|mkv|aac)(?:$|[?#])/i.test(u.pathname + u.search);
const isDirectMp4Like = (u) => /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(u.pathname + u.search);

// iOS/Safari FIX — Safari does NOT content-sniff media. If a mirror (Telegram
// file hosts, cheap RS mirrors) answers `application/octet-stream`, `text/html`
// or nothing at all, Safari refuses to decode the stream and the <video> tag
// stays black/blocked even though Chrome plays it fine. So we always force a
// correct media MIME type derived from the file extension.
const EXT_MIME = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mkv: "video/x-matroska", ts: "video/mp2t", m4s: "video/iso.segment",
  aac: "audio/aac", m4a: "audio/mp4", mp3: "audio/mpeg",
};
const extOf = (u) => {
  const m = String(u.pathname || "").toLowerCase().match(/\.([a-z0-9]{2,4})(?:$|[?#])/);
  return m ? m[1] : "";
};
const guessMediaMime = (u) => EXT_MIME[extOf(u)] || "";
const isUselessContentType = (ct) => {
  const v = String(ct || "").toLowerCase();
  return !v || v.includes("octet-stream") || v.includes("text/") || v.includes("application/binary")
    || v.includes("application/download") || v.includes("application/force-download") || v === "application/json";
};


const toOpaqueUrlToken = (value) => {
  try {
    return btoa(unescape(encodeURIComponent(String(value || "")))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch { return ""; }
};

const fromOpaqueUrlToken = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch { return ""; }
};

function clampInvalidContentRange(headers) {
  const raw = headers.get("content-range") || "";
  const match = raw.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  if (!match) return;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(total) || total <= 0) return;
  const maxEnd = total - 1;
  if (end <= maxEnd) return;
  headers.set("content-range", `bytes ${start}-${maxEnd}/${total}`);
  headers.set("content-length", String(Math.max(0, total - start)));
}

function fallbackResponse(message, detail = "", upstreamStatus) {
  return new Response(JSON.stringify({
    error: "VIDEO_SOURCE_UNAVAILABLE",
    fallback: true,
    message,
    detail,
    upstreamStatus: upstreamStatus || null,
  }), {
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

// v9: only http:// mirrors are re-windowed. https passes through untouched.
function alignMediaRange(range, upstreamUrl) {
  if (!range || upstreamUrl.protocol !== "http:" || !isDirectMp4Like(upstreamUrl)) return range;
  const m = String(range).trim().match(/^bytes=(\d+)-$/i);
  if (!m) return range;
  const start = Number(m[1]);
  if (!Number.isFinite(start) || start < 0) return range;
  return `bytes=${start}-${start + HTTP_WINDOW_BYTES - 1}`;
}

function requestedOpenEndedRange(range) {
  return /^bytes=\d+-$/i.test(String(range || "").trim());
}

function browserRangeResponseHeaders(headers, originalRange, status) {
  if (!requestedOpenEndedRange(originalRange)) return;
  // A 200 means the mirror ignored the Range and is sending the WHOLE file.
  // Safari needs the real content-length in that case, otherwise it aborts.
  if (status === 200) return;
  if (!headers.has("content-range")) headers.delete("content-length");
}


function proxyUrl(reqUrl, target) {
  return `${reqUrl.protocol}//${reqUrl.host}${reqUrl.pathname}?src=${encodeURIComponent(toOpaqueUrlToken(target))}`;
}

function resolveUrl(v, base) {
  const raw = String(v || "").trim();
  if (!raw || raw.startsWith("#")) return raw;
  try { return new URL(raw, base).toString(); } catch { return raw; }
}

function rewritePlaylist(text, targetUrl, reqUrl) {
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        const abs = resolveUrl(uri, targetUrl);
        return /^https?:\/\//i.test(abs) ? `URI="${proxyUrl(reqUrl, abs)}"` : `URI="${uri}"`;
      });
    }
    const abs = resolveUrl(t, targetUrl);
    return /^https?:\/\//i.test(abs) ? proxyUrl(reqUrl, abs) : line;
  }).join("\n");
}

// Header-timeout fetch: aborts a hung mirror fast, never truncates a good body.
async function fetchHead(url, init) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HEADER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "HEAD")
      return new Response("Method not allowed", { status: 405, headers: cors });

    const reqUrl = new URL(req.url);
    const target = reqUrl.searchParams.get("url") || fromOpaqueUrlToken(reqUrl.searchParams.get("src") || "");
    if (!target) return new Response("Missing ?url=", { status: 400, headers: cors });

    let up;
    try { up = new URL(target); } catch { return new Response("Invalid url", { status: 400, headers: cors }); }
    if (up.protocol !== "http:" && up.protocol !== "https:")
      return new Response("Only http/https supported", { status: 400, headers: cors });

    const rawRange = req.headers.get("range");
    const alignedRange = alignMediaRange(rawRange, up);
    const headers = {
      "User-Agent": UA,
      Accept: req.headers.get("accept") || "*/*",
      "Accept-Encoding": "identity",
      "Accept-Language": req.headers.get("accept-language") || "en-US,en;q=0.9",
    };
    for (const k of ["range", "if-range", "if-none-match", "if-modified-since"]) {
      const v = req.headers.get(k);
      if (v) headers[k] = k === "range" ? (alignedRange || v) : v;
    }

    // NEVER forward the browser's own Referer (public site host) — some mirrors
    // reject public-site referers. Synthesize a same-origin one, and try it
    // FIRST so the happy path costs exactly one round-trip.
    const origin = `${up.protocol}//${up.host}`;
    const attempts = [
      { ...headers, Referer: `${origin}/` },
      { ...headers, Referer: `${origin}/`, Origin: origin },
      headers,
    ];

    // CF edge cache: immutable media + segments are cached at the PoP, so the
    // second viewer never touches the origin at all.
    const cacheable = !rawRange && isMediaSegment(up);
    const cfOpts = cacheable
      ? { cacheEverything: true, cacheTtlByStatus: { "200-299": MEDIA_EDGE_TTL, "404": 5, "500-599": 0 } }
      : { cacheEverything: false };

    let res = null, lastErr = "";
    for (const h of attempts) {
      try {
        res = await fetchHead(up.toString(), { method: req.method, headers: h, redirect: "follow", cf: cfOpts });
        if (res.ok || res.status === 206 || res.status === 304) break;
        lastErr = `HTTP ${res.status}`;
        try { await res.body?.cancel(); } catch {}
        if (res.status < 500 && res.status !== 403 && res.status !== 401 && res.status !== 429) { res = null; break; }
        res = null;
      } catch (e) { lastErr = e?.message || String(e); res = null; }
    }
    if (!res) return fallbackResponse("Upstream failed", lastErr || "network error");

    const out = new Headers(cors);
    for (const k of PASS) { const v = res.headers.get(k); if (v) out.set(k, v); }
    clampInvalidContentRange(out);
    browserRangeResponseHeaders(out, rawRange, res.status);
    if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");

    // iOS/Safari MIME repair (see EXT_MIME above).
    const guessed = guessMediaMime(up);
    if (guessed && isUselessContentType(out.get("content-type")) && !isM3u8(up.toString(), res.headers.get("content-type"))) {
      out.set("content-type", guessed);
    }

    out.set("content-disposition", "inline");
    out.set("Cross-Origin-Resource-Policy", "cross-origin");
    out.set("Timing-Allow-Origin", "*");
    out.set("x-rs-edge", "cf-v10-ios");


    if (req.method !== "HEAD" && res.ok && isM3u8(up.toString(), res.headers.get("content-type"))) {
      const body = rewritePlaylist(await res.text(), up.toString(), reqUrl);
      out.delete("content-length");
      out.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
      out.set("cache-control", "public, max-age=6, stale-while-revalidate=30");
      return new Response(body, { status: res.status, headers: out });
    }

    if (isMediaSegment(up) && (res.status === 200 || res.status === 206)) {
      out.set("cache-control", "public, max-age=604800, immutable");
    }
    // Streaming pass-through — never buffer the upstream body on the edge.
    return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
  },
};
