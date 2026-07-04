// 🆕 NEW v4 (2026-07-04) — RS LIGHTSPEED: aligned 8MB windows + background prefetch. REDEPLOY REQUIRED.
// After deploy, paste this URL back into Admin → EGD Router → video-proxy.
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
const MEDIA_CHUNK_BYTES = 8 * 1024 * 1024; // 8MB aligned window — fast first byte + high cache hit

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

// Align every browser range request to a fixed 8MB window boundary.
// Effect: seeking to 4:23 and 4:29 map to the SAME upstream fetch → CF cache hit.
function alignRange(range, u) {
  if (!range || !isDirectMp4Like(u)) return { range, windowStart: null };
  const m = range.match(/^bytes=(\d+)-(\d*)$/i);
  if (!m) return { range, windowStart: null };
  const start = Number(m[1]);
  if (!Number.isFinite(start) || start < 0) return { range, windowStart: null };
  const windowStart = Math.floor(start / MEDIA_CHUNK_BYTES) * MEDIA_CHUNK_BYTES;
  const windowEnd = windowStart + MEDIA_CHUNK_BYTES - 1;
  return { range: `bytes=${windowStart}-${windowEnd}`, windowStart };
}

function capRange(range, u) {
  const aligned = alignRange(range, u);
  return aligned.range;
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

    // ⚡ Aligned-window CF edge cache: every skip within the same 8MB window
    // becomes a cache HIT, and the next window is warmed in background so the
    // next sequential range request is already at the edge before the browser asks.
    const cache = caches.default;
    const rawRange = req.headers.get("range");
    const aligned = alignRange(rawRange, up);
    const isCacheable = req.method === "GET" && isSegmentLike(up);
    const windowKeyPart = aligned.windowStart !== null
      ? `|w=${aligned.windowStart}`
      : `|r=${rawRange || ""}`;
    const cacheKey = new Request(reqUrl.toString() + windowKeyPart, { method: "GET" });

    if (isCacheable) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const h = new Headers(cached.headers);
        h.set("x-edge-cache", "HIT");
        // Warm the NEXT window in the background so sequential playback stays hot.
        if (aligned.windowStart !== null) {
          const nextStart = aligned.windowStart + MEDIA_CHUNK_BYTES;
          const nextKey = new Request(reqUrl.toString() + `|w=${nextStart}`, { method: "GET" });
          ctx?.waitUntil?.((async () => {
            if (await cache.match(nextKey)) return;
            try {
              const r = await fetch(up.toString(), {
                headers: { "User-Agent": UA, Range: `bytes=${nextStart}-${nextStart + MEDIA_CHUNK_BYTES - 1}`, Referer: `${up.protocol}//${up.host}/` },
              });
              if (r.ok || r.status === 206) {
                const hh = new Headers();
                for (const k of PASS) { const v = r.headers.get(k); if (v) hh.set(k, v); }
                hh.set("cache-control", "public, max-age=604800, immutable");
                await cache.put(nextKey, new Response(await r.arrayBuffer(), { status: r.status, headers: hh }));
              } else { try { await r.body?.cancel(); } catch {} }
            } catch {}
          })());
        }
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

    if (req.method !== "HEAD" && res.ok && isM3u8(up.toString(), res.headers.get("content-type"))) {
      const body = rewritePlaylist(await res.text(), up.toString(), reqUrl);
      out.delete("content-length");
      out.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
      out.set("cache-control", "public, max-age=6, stale-while-revalidate=30");
      return new Response(body, { status: res.status, headers: out });
    }

    // Cache the aligned window + prefetch the NEXT one for zero-latency sequential playback.
    if (isCacheable && (res.status === 200 || res.status === 206)) {
      out.set("cache-control", "public, max-age=604800, immutable");
      out.set("x-edge-cache", "MISS");
      const buf = await res.arrayBuffer();
      if (aligned.windowStart !== null) {
        const nextStart = aligned.windowStart + MEDIA_CHUNK_BYTES;
        const nextKey = new Request(reqUrl.toString() + `|w=${nextStart}`, { method: "GET" });
        ctx?.waitUntil?.((async () => {
          if (await cache.match(nextKey)) return;
          try {
            const r = await fetch(up.toString(), {
              headers: { "User-Agent": UA, Range: `bytes=${nextStart}-${nextStart + MEDIA_CHUNK_BYTES - 1}`, Referer: `${origin}/` },
            });
            if (r.ok || r.status === 206) {
              const hh = new Headers();
              for (const k of PASS) { const v = r.headers.get(k); if (v) hh.set(k, v); }
              hh.set("cache-control", "public, max-age=604800, immutable");
              await cache.put(nextKey, new Response(await r.arrayBuffer(), { status: r.status, headers: hh }));
            } else { try { await r.body?.cancel(); } catch {} }
          } catch {}
        })());
      }
      const cacheHeaders = new Headers(out);
      ctx?.waitUntil?.(cache.put(cacheKey, new Response(buf, { status: res.status, headers: cacheHeaders })));
      return new Response(req.method === "HEAD" ? null : buf, { status: res.status, headers: out });
    }
    return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
  },
};
