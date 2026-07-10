// 🆕 NEW v3 (2026-07-04) — Ultra playback: CF edge cache for segments. REDEPLOY REQUIRED.
// After deploy, paste this URL back into Admin → EGD Router.
// ============================================================
// Cloudflare Worker port of Supabase Edge Function: an-playback
// Ported automatically — replace CF_URL in EGD/Cloudflare Manager
// ============================================================
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type, etag, last-modified",
  "Access-Control-Max-Age": "86400"
};
const decode = (value) => String(value || "").replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/\\u003d/g, "=").replace(/\\u003f/g, "?").replace(/&amp;/g, "&").trim();
const deepDecodeUrl = (value) => {
  let out = decode(value || "");
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(out); i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = decode(next);
    } catch {
      break;
    }
  }
  return out;
};
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
const resolveUrl = (value, baseUrl) => {
  const raw = decode(value);
  if (!raw) return "";
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
};
function getSafeOrigin(value) {
  const raw = decode(value || "");
  if (!raw) return "";
  try {
    return new URL(deepDecodeUrl(raw)).origin;
  } catch {
    return "";
  }
}
function wrapHlsUrl(raw, baseUrl, proxyPrefix, parentOrigin = "") {
  const value = decode(raw || "");
  if (!value || value.startsWith("data:")) return value;
  let abs = /^https?:\/\//i.test(value) ? value : resolveUrl(value, baseUrl);
  try {
    const existing = new URL(abs);
    if (/\/(?:an-playback|an-api|hls)(?:\/hls)?$/i.test(existing.pathname) || /\/functions\/v1\/(?:an-playback|an-api|hls)(?:\/hls)?$/i.test(existing.pathname)) {
      abs = existing.searchParams.get("url") || fromOpaqueUrlToken(existing.searchParams.get("src") || "") || abs;
    }
  } catch {
  }
  const params = new URLSearchParams({ src: toOpaqueUrlToken(abs) });
  const inheritedOrigin = getSafeOrigin(parentOrigin) || getSafeOrigin(baseUrl);
  if (inheritedOrigin) params.set("origin", inheritedOrigin);
  return `${proxyPrefix}?${params.toString()}`;
}
function rewriteM3U8(body, baseUrl, proxyPrefix, parentOrigin = "") {
  const playlistOrigin = getSafeOrigin(parentOrigin) || getSafeOrigin(baseUrl);
  const rewriteUriAttr = (line) => line.replace(/URI="([^"]+)"/gi, (_m, uri) => `URI="${wrapHlsUrl(uri, baseUrl, proxyPrefix, playlistOrigin)}"`);
  return body.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line) return raw;
    if (line.startsWith("#")) return /URI="/i.test(line) ? rewriteUriAttr(raw) : raw;
    return wrapHlsUrl(line, baseUrl, proxyPrefix, playlistOrigin);
  }).join("\n");
}
function getPublicFunctionOrigin(reqUrl) {
  const protocol = /(?:^|\.)supabase\.co$/i.test(reqUrl.hostname) ? "https:" : reqUrl.protocol;
  return `${protocol}//${reqUrl.host}`;
}
function getPublicHlsPrefix(reqUrl) {
  const origin = getPublicFunctionOrigin(reqUrl);
  return /(?:^|\.)supabase\.co$/i.test(reqUrl.hostname)
    ? `${origin}/functions/v1/an-playback/hls`
    : `${origin}/hls`;
}
const isAnimeSaltIndexPlaylist = (url) => /\/hls\/[^?#]+\/index\.ts$/i.test(url.pathname);
const isLikelySegmentUrl = (url) => !isAnimeSaltIndexPlaylist(url) && (/\.(?:ts|m4s|js|mp4|aac)(?:$|\?)/i.test(url.pathname) || /\/p\//i.test(url.pathname));
const isLikelyPlaylistUrl = (url) => isAnimeSaltIndexPlaylist(url) || /\.m3u8(?:$|\?)/i.test(url.pathname) || !isLikelySegmentUrl(url);
async function fetchHlsUpstream(req, targetUrl, parentOrigin) {
  const range = req.headers.get("range");
  const playlist = isLikelyPlaylistUrl(targetUrl);
  const accept = playlist ? "application/vnd.apple.mpegurl,*/*" : "video/mp2t,video/*,*/*";
  const refererOrigin = getSafeOrigin(parentOrigin) || targetUrl.origin;
  const baseHeaders = {
    "User-Agent": UA,
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${refererOrigin}/`
  };
  if (range) baseHeaders.Range = range;
  const attempts = [
    baseHeaders,
    { ...baseHeaders, Referer: `${targetUrl.origin}/` },
    ...playlist ? [{ ...baseHeaders, Origin: refererOrigin }] : []
  ];
  let lastStatus = 0;
  for (const headers of attempts) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), playlist ? 12e3 : 45e3);
    try {
      const res = await fetch(targetUrl.toString(), {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers,
        signal: ac.signal,
        redirect: "follow"
      });
      lastStatus = res.status;
      if (res.ok || res.status === 206 || res.status === 304) return res;
      try {
        await res.body?.cancel();
      } catch {
      }
    } catch {
    } finally {
      clearTimeout(timer);
    }
  }
  return { errorStatus: lastStatus };
}
var stdin_default = { async fetch(req, env, ctx) {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: cors });
    const reqUrl = new URL(req.url);
    const path = reqUrl.pathname.includes("/an-playback") ? reqUrl.pathname.split("/an-playback")[1] || "/" : reqUrl.pathname;
    if (path !== "/" && path !== "/hls") return new Response(JSON.stringify({ ok: true, endpoint: "/hls?url=..." }), { headers: { ...cors, "Content-Type": "application/json" } });
    const target = reqUrl.searchParams.get("url") || fromOpaqueUrlToken(reqUrl.searchParams.get("src") || "");
    if (!target) return new Response(JSON.stringify({ error: "missing ?url=" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    let targetUrl;
    try {
      targetUrl = new URL(deepDecodeUrl(target));
    } catch {
      return new Response("bad url", { status: 400, headers: cors });
    }
    if (!/^https?:$/i.test(targetUrl.protocol)) return new Response("blocked protocol", { status: 400, headers: cors });
    const parentOrigin = getSafeOrigin(reqUrl.searchParams.get("origin") || reqUrl.searchParams.get("parent") || reqUrl.searchParams.get("ref")) || targetUrl.origin;

    // ⚡ CF edge cache for HLS segments — instant on skip/replay.
    const cache = caches.default;
    const isSegPath = isLikelySegmentUrl(targetUrl);
    const cacheKey = new Request(reqUrl.toString() + "|" + (req.headers.get("range") || ""), { method: "GET" });
    if (req.method === "GET" && isSegPath) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const h2 = new Headers(cached.headers);
        h2.set("x-edge-cache", "HIT");
        return new Response(cached.body, { status: cached.status, headers: h2 });
      }
    }

    const upstream = await fetchHlsUpstream(req, targetUrl, parentOrigin);
    if (!(upstream instanceof Response)) return new Response(`AN upstream fetch failed: ${upstream.errorStatus || "network"}`, { status: 502, headers: cors });
    const h = new Headers(cors);
    for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {
      const v = upstream.headers.get(k);
      if (v) h.set(k, v);
    }
    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    const isM3u8 = /mpegurl|m3u8/.test(ct) || /\.m3u8(?:\?|$)/i.test(targetUrl.pathname) || isAnimeSaltIndexPlaylist(targetUrl);
    if (isM3u8) {
      h.delete("content-length");
      h.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
      h.set("cache-control", "public, max-age=6, stale-while-revalidate=30");
      if (req.method === "HEAD") return new Response(null, { status: upstream.status, headers: h });
      return new Response(rewriteM3U8(await upstream.text(), targetUrl.toString(), getPublicHlsPrefix(reqUrl), parentOrigin), { status: upstream.status, headers: h });
    }
    const isSegment = /\.(?:ts|m4s|js|css|woff2?)(?:$|\?)/i.test(targetUrl.pathname) || /\/p\//i.test(targetUrl.pathname) || /javascript|text\/plain/i.test(ct);
    if (isSegment) {
      h.set("content-type", /\.m4s/i.test(targetUrl.pathname) ? "video/iso.segment" : "video/mp2t");
      h.set("content-disposition", "inline");
      h.set("cache-control", "public, max-age=604800, immutable");
    }
    if (!h.has("accept-ranges")) h.set("accept-ranges", "bytes");
    if (req.method === "HEAD") return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers: h });
    if (isSegment) {
      const buf = await upstream.arrayBuffer();
      const resp = new Response(buf, { status: upstream.status, statusText: upstream.statusText, headers: h });
      if (req.method === "GET" && isSegPath && (upstream.status === 200 || upstream.status === 206)) {
        const cacheHeaders = new Headers(h);
        cacheHeaders.set("x-edge-cache", "MISS");
        ctx?.waitUntil?.(cache.put(cacheKey, new Response(buf, { status: upstream.status, headers: cacheHeaders })));
      }
      return resp;
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: h });
  } catch (e) {
    return new Response(`AN playback proxy failed: ${e?.message || String(e)}`, { status: 502, headers: cors });
  }
} };
export {
  stdin_default as default
};
