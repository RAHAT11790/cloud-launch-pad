// ============================================================
// 🚀 video-boost — Alpha Professional Playback Proxy (CF Worker)
// ============================================================
// One universal proxy that sits in front of EVERY video URL
// (RS Server 1/2/3, direct MP4, HLS, Telegram-hosted mirrors).
//
// FEATURES:
//   ⚡ Lightspeed playback — aligned 8MB cache windows + background
//      prefetch of the next window (skip = 0-latency edge HIT).
//   🔒 Anti-theft — Referer/Origin domain lock. Set env var
//      ALLOWED_ORIGINS (comma-separated hostnames, wildcards
//      supported: `*.lovable.app`). Empty = allow all (default).
//   🎬 HLS + MP4 + Telegram-mirror support with playlist rewrite
//      and multi-attempt referrer/origin fallback.
//   🕵️ Opaque `?src=` token — raw upstream URL never appears in
//      browser network logs.
//
// DEPLOY: paste into a Cloudflare Module Worker, then put the
// worker URL in Admin → EGD Router → `video-boost`.
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified, cache-control, x-edge-cache",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];
const MEDIA_CHUNK_BYTES = 8 * 1024 * 1024; // 8MB aligned windows

const isM3u8 = (url, ct) => /mpegurl|m3u8/i.test(ct || "") || /\.m3u8(?:[?#]|$)/i.test(url);
const isDirectMp4Like = (u) => /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(u.pathname + u.search);
const isSegmentLike = (u) => /\.(?:ts|m4s|aac|mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(u.pathname);

const toOpaqueUrlToken = (v) => {
  try { return btoa(unescape(encodeURIComponent(String(v || "")))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
  catch { return ""; }
};
const fromOpaqueUrlToken = (v) => {
  const raw = String(v || "").trim();
  if (!raw) return "";
  try { return decodeURIComponent(escape(atob(raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4)))); }
  catch { return ""; }
};

// ---------- 🔒 Domain lock ----------
function matchOrigin(host, pattern) {
  const h = host.toLowerCase(), p = pattern.toLowerCase().trim();
  if (!p) return false;
  if (p === h) return true;
  if (p.startsWith("*.")) return h === p.slice(2) || h.endsWith(p.slice(1));
  return false;
}
function isAllowedOrigin(req, env) {
  const raw = String(env?.ALLOWED_ORIGINS || "").trim();
  if (!raw) return true; // no lock configured = open
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const candidates = [req.headers.get("origin"), req.headers.get("referer")].filter(Boolean);
  if (candidates.length === 0) return false; // no referer = block (curl/wget/hotlink)
  for (const c of candidates) {
    try { const host = new URL(c).hostname; if (list.some((p) => matchOrigin(host, p))) return true; } catch {}
  }
  return false;
}

// ---------- ⚡ Aligned window range ----------
function alignRange(range, u) {
  if (!range || !isDirectMp4Like(u)) return { range, windowStart: null };
  const m = range.match(/^bytes=(\d+)-(\d*)$/i);
  if (!m) return { range, windowStart: null };
  const start = Number(m[1]);
  if (!Number.isFinite(start) || start < 0) return { range, windowStart: null };
  const ws = Math.floor(start / MEDIA_CHUNK_BYTES) * MEDIA_CHUNK_BYTES;
  return { range: `bytes=${ws}-${ws + MEDIA_CHUNK_BYTES - 1}`, windowStart: ws };
}

// ---------- HLS playlist rewrite ----------
const resolveUrl = (v, base) => {
  const raw = String(v || "").trim();
  if (!raw || raw.startsWith("#")) return raw;
  try { return new URL(raw, base).toString(); } catch { return raw; }
};
function proxyUrl(reqUrl, target) {
  return `${reqUrl.protocol}//${reqUrl.host}${reqUrl.pathname}?src=${encodeURIComponent(toOpaqueUrlToken(target))}`;
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

// ---------- Background prefetch ----------
async function prefetchWindow(cache, up, origin, reqUrl, nextStart) {
  const key = new Request(reqUrl.toString() + `|w=${nextStart}`, { method: "GET" });
  if (await cache.match(key)) return;
  try {
    const r = await fetch(up.toString(), {
      headers: { "User-Agent": UA, Range: `bytes=${nextStart}-${nextStart + MEDIA_CHUNK_BYTES - 1}`, Referer: `${origin}/` },
    });
    if (r.ok || r.status === 206) {
      const hh = new Headers();
      for (const k of PASS) { const v = r.headers.get(k); if (v) hh.set(k, v); }
      hh.set("cache-control", "public, max-age=604800, immutable");
      await cache.put(key, new Response(await r.arrayBuffer(), { status: r.status, headers: hh }));
    } else { try { await r.body?.cancel(); } catch {} }
  } catch {}
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "HEAD")
      return new Response("Method not allowed", { status: 405, headers: cors });

    // 🔒 Domain lock (only applies if ALLOWED_ORIGINS is set)
    if (!isAllowedOrigin(req, env)) {
      return new Response("Forbidden: origin not allowed", { status: 403, headers: cors });
    }

    const reqUrl = new URL(req.url);
    const target = fromOpaqueUrlToken(reqUrl.searchParams.get("src") || "") || reqUrl.searchParams.get("url");
    if (!target) return new Response("Missing ?src=", { status: 400, headers: cors });

    let up;
    try { up = new URL(target); } catch { return new Response("Invalid url", { status: 400, headers: cors }); }
    if (up.protocol !== "http:" && up.protocol !== "https:")
      return new Response("Only http/https supported", { status: 400, headers: cors });

    const cache = caches.default;
    const rawRange = req.headers.get("range");
    const aligned = alignRange(rawRange, up);
    const isCacheable = req.method === "GET" && isSegmentLike(up);
    const cacheKey = new Request(
      reqUrl.toString() + (aligned.windowStart !== null ? `|w=${aligned.windowStart}` : `|r=${rawRange || ""}`),
      { method: "GET" }
    );

    // Cache HIT — serve instantly and warm next window in background.
    if (isCacheable) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const h = new Headers(cached.headers);
        h.set("x-edge-cache", "HIT");
        for (const [k, v] of Object.entries(cors)) h.set(k, v);
        if (aligned.windowStart !== null) {
          ctx?.waitUntil?.(prefetchWindow(cache, up, `${up.protocol}//${up.host}`, reqUrl, aligned.windowStart + MEDIA_CHUNK_BYTES));
        }
        return new Response(cached.body, { status: cached.status, headers: h });
      }
    }

    // Upstream fetch (multi-attempt referrer/origin fallback for Telegram/HF/Render).
    const headers = { "User-Agent": UA, Accept: req.headers.get("accept") || "*/*", "Accept-Encoding": "identity" };
    for (const k of ["range", "if-range", "if-none-match", "if-modified-since", "cache-control"]) {
      const v = req.headers.get(k);
      if (v) headers[k] = k === "range" ? (aligned.range || v) : v;
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

    // HLS playlist — rewrite so segments also route through this worker.
    if (req.method !== "HEAD" && res.ok && isM3u8(up.toString(), res.headers.get("content-type"))) {
      const body = rewritePlaylist(await res.text(), up.toString(), reqUrl);
      out.delete("content-length");
      out.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
      out.set("cache-control", "public, max-age=6, stale-while-revalidate=30");
      return new Response(body, { status: res.status, headers: out });
    }

    // Media chunk — cache the window and prefetch the next.
    if (isCacheable && (res.status === 200 || res.status === 206)) {
      out.set("cache-control", "public, max-age=604800, immutable");
      out.set("x-edge-cache", "MISS");
      const buf = await res.arrayBuffer();
      if (aligned.windowStart !== null) {
        ctx?.waitUntil?.(prefetchWindow(cache, up, origin, reqUrl, aligned.windowStart + MEDIA_CHUNK_BYTES));
      }
      ctx?.waitUntil?.(cache.put(cacheKey, new Response(buf, { status: res.status, headers: new Headers(out) })));
      return new Response(req.method === "HEAD" ? null : buf, { status: res.status, headers: out });
    }

    return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
  },
};
