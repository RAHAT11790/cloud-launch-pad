// 🆕 NEW v3 (2026-07-04) — Ultra playback: CF edge cache + 16MB chunks. REDEPLOY REQUIRED.
// After deploy, paste this URL back into Admin → EGD Router.
// ============================================================
// Cloudflare Worker — video-proxy (CF-native port)
// ============================================================
// Deploy as a Module Worker. Usage:
//   https://<worker>.<sub>.workers.dev/?url=<ENCODED_VIDEO_URL>
// Same behavior as Supabase video-proxy: HLS playlist rewriting,
// range streaming, http+https upstream, safe headers.
// No env vars required.
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified, cache-control",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"];
const MEDIA_CHUNK_BYTES = 16 * 1024 * 1024;

const isM3u8 = (url, ct) => /mpegurl|m3u8/i.test(ct || "") || /\.m3u8(?:[?#]|$)/i.test(url);
const isDirectMp4Like = (u) => /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(u.pathname + u.search);

const toOpaqueUrlToken = (value) => {
  try {
    return btoa(unescape(encodeURIComponent(String(value || "")))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch {
    return "";
  }
};

const fromOpaqueUrlToken = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return "";
  }
};

function capRange(range, u) {
  if (!range || !isDirectMp4Like(u)) return range;
  const m = range.match(/^bytes=(\d+)-(\d*)$/i);
  if (!m) return range;
  const start = Number(m[1]);
  const reqEnd = m[2] ? Number(m[2]) : NaN;
  if (!Number.isFinite(start) || start < 0) return range;
  const hasEnd = Boolean(m[2]);
  const capEnd = start + MEDIA_CHUNK_BYTES - 1;
  if (!hasEnd && start > 8 * 1024 * 1024) return range;
  if (!Number.isFinite(reqEnd) || reqEnd - start + 1 > MEDIA_CHUNK_BYTES) return `bytes=${start}-${capEnd}`;
  return range;
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

const isSegmentLike = (u) => /\.(?:ts|m4s|aac|mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(u.pathname);

export default {
  async fetch(req, env, ctx) {
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

    // ⚡ CF edge cache: repeat/skip playback lands on the edge instead of upstream.
    const cache = caches.default;
    const cacheKey = new Request(reqUrl.toString() + "|" + (req.headers.get("range") || ""), { method: "GET" });
    const isCacheable = req.method === "GET" && isSegmentLike(up);
    if (isCacheable) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const h = new Headers(cached.headers);
        h.set("x-edge-cache", "HIT");
        return new Response(cached.body, { status: cached.status, headers: h });
      }
    }

    const headers = {
      "User-Agent": UA,
      Accept: req.headers.get("accept") || "*/*",
      "Accept-Encoding": "identity",
    };
    for (const k of ["range", "if-range", "if-none-match", "if-modified-since", "cache-control"]) {
      const v = req.headers.get(k);
      if (v) headers[k] = k === "range" ? (capRange(v, up) || v) : v;
    }
    const origin = `${up.protocol}//${up.host}`;
    const attempts = [
      headers,
      { ...headers, Referer: `${origin}/` },
      { ...headers, Referer: `${origin}/`, Origin: origin },
    ];

    let res = null, lastErr = "";
    for (const h of attempts) {
      try {
        res = await fetch(up.toString(), { method: req.method, headers: h, redirect: "follow" });
        if (res.ok || res.status === 206 || res.status === 304) break;
        lastErr = `HTTP ${res.status}`;
        try { await res.body?.cancel(); } catch {}
      } catch (e) { lastErr = e?.message || String(e); res = null; }
    }
    if (!res) return new Response(`Upstream failed: ${lastErr}`, { status: 502, headers: cors });

    const out = new Headers(cors);
    for (const k of PASS) { const v = res.headers.get(k); if (v) out.set(k, v); }
    if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
    out.set("content-disposition", "inline");
    out.set("Cross-Origin-Resource-Policy", "cross-origin");
    out.set("Timing-Allow-Origin", "*");

    if (req.method !== "HEAD" && res.ok && isM3u8(up.toString(), res.headers.get("content-type"))) {
      const body = rewritePlaylist(await res.text(), up.toString(), reqUrl);
      out.delete("content-length");
      out.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
      out.set("cache-control", "public, max-age=6, stale-while-revalidate=30");
      return new Response(body, { status: res.status, headers: out });
    }

    // Store immutable media chunks in CF edge cache for near-instant re-serve.
    if (isCacheable && (res.status === 200 || res.status === 206)) {
      out.set("cache-control", "public, max-age=604800, immutable");
      out.set("x-edge-cache", "MISS");
      const [a, b] = res.body.tee();
      const responseForClient = new Response(req.method === "HEAD" ? null : a, { status: res.status, headers: out });
      const responseForCache = new Response(b, { status: res.status, headers: out });
      ctx?.waitUntil?.(cache.put(cacheKey, responseForCache));
      return responseForClient;
    }
    return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
  },
};
