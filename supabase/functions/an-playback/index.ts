// 🆕 NEW v3 (2026-07-04) — Ultra playback: long-cache segments + fast playlist SWR. REDEPLOY REQUIRED.
// After deploy, paste this URL back into Admin → EGD Router.
// an-playback — playback-only AN HLS proxy.
//
// The fetch/extract API (`an-api`) gathers metadata, seasons, streams and audio.
// This function does only one job: proxy HLS playlists/segments with stable CORS
// and CDN-safe headers so video playback load is separated from extraction load.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type, etag, last-modified",
  "Access-Control-Max-Age": "86400",
};

const decode = (value: string) =>
  String(value || "")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\u003f/g, "?")
    .replace(/&amp;/g, "&")
    .trim();

const deepDecodeUrl = (value: string) => {
  let out = decode(value || "");
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(out); i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = decode(next);
    } catch { break; }
  }
  return out;
};

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

const resolveUrl = (value: string, baseUrl: string) => {
  const raw = decode(value);
  if (!raw) return "";
  try { return new URL(raw, baseUrl).toString(); } catch { return raw; }
};

function getSafeOrigin(value?: string | null) {
  const raw = decode(value || "");
  if (!raw) return "";
  try { return new URL(deepDecodeUrl(raw)).origin; } catch { return ""; }
}

function wrapHlsUrl(raw: string, baseUrl: string, proxyPrefix: string, parentOrigin = "") {
  const value = decode(raw || "");
  if (!value || value.startsWith("data:")) return value;
  let abs = /^https?:\/\//i.test(value) ? value : resolveUrl(value, baseUrl);
  try {
    const existing = new URL(abs);
    if (/\/(?:an-playback|an-api|hls)(?:\/hls)?$/i.test(existing.pathname) || /\/functions\/v1\/(?:an-playback|an-api|hls)(?:\/hls)?$/i.test(existing.pathname)) {
      abs = existing.searchParams.get("url") || fromOpaqueUrlToken(existing.searchParams.get("src") || "") || abs;
    }
  } catch {}
  const params = new URLSearchParams({ src: toOpaqueUrlToken(abs) });
  const inheritedOrigin = getSafeOrigin(parentOrigin) || getSafeOrigin(baseUrl);
  if (inheritedOrigin) params.set("origin", inheritedOrigin);
  return `${proxyPrefix}?${params.toString()}`;
}

function rewriteM3U8(body: string, baseUrl: string, proxyPrefix: string, parentOrigin = "") {
  const playlistOrigin = getSafeOrigin(parentOrigin) || getSafeOrigin(baseUrl);
  const rewriteUriAttr = (line: string) => line.replace(/URI="([^"]+)"/gi, (_m, uri) => `URI="${wrapHlsUrl(uri, baseUrl, proxyPrefix, playlistOrigin)}"`);
  return body.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line) return raw;
    if (line.startsWith("#")) return /URI="/i.test(line) ? rewriteUriAttr(raw) : raw;
    return wrapHlsUrl(line, baseUrl, proxyPrefix, playlistOrigin);
  }).join("\n");
}

function getPublicFunctionOrigin(reqUrl: URL) {
  const protocol = /(?:^|\.)supabase\.co$/i.test(reqUrl.hostname) ? "https:" : reqUrl.protocol;
  return `${protocol}//${reqUrl.host}`;
}

const isAnimeSaltIndexPlaylist = (url: URL) => /\/hls\/[^?#]+\/index\.ts$/i.test(url.pathname);
const isLikelySegmentUrl = (url: URL) => !isAnimeSaltIndexPlaylist(url) && (/\.(?:ts|m4s|js|mp4|aac)(?:$|\?)/i.test(url.pathname) || /\/p\//i.test(url.pathname));
const isLikelyPlaylistUrl = (url: URL) => isAnimeSaltIndexPlaylist(url) || /\.m3u8(?:$|\?)/i.test(url.pathname) || !isLikelySegmentUrl(url);

async function fetchHlsUpstream(req: Request, targetUrl: URL, parentOrigin: string) {
  const range = req.headers.get("range");
  const playlist = isLikelyPlaylistUrl(targetUrl);
  const accept = playlist ? "application/vnd.apple.mpegurl,*/*" : "video/mp2t,video/*,*/*";
  const refererOrigin = getSafeOrigin(parentOrigin) || targetUrl.origin;
  const baseHeaders: Record<string, string> = {
    "User-Agent": UA,
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${refererOrigin}/`,
  };
  if (range) baseHeaders.Range = range;
  const attempts: Record<string, string>[] = [
    baseHeaders,
    { ...baseHeaders, Referer: `${targetUrl.origin}/` },
    ...(playlist ? [{ ...baseHeaders, Origin: refererOrigin }] : []),
  ];
  let lastStatus = 0;
  for (const headers of attempts) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), playlist ? 12_000 : 45_000);
    try {
      const res = await fetch(targetUrl.toString(), {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers,
        signal: ac.signal,
        redirect: "follow",
      });
      lastStatus = res.status;
      if (res.ok || res.status === 206 || res.status === 304) return res;
      try { await res.body?.cancel(); } catch {}
    } catch {
      // Try next safe header profile.
    } finally {
      clearTimeout(timer);
    }
  }
  return { errorStatus: lastStatus } as const;
}

// Domain allowlist — block open SSRF / bandwidth abuse from other sites.
const ALLOWED_HOST_RX = [
  /\.lovable\.app$/i,
  /\.lovableproject\.com$/i,
  /^lovable\.app$/i,
  /^lovableproject\.com$/i,
  /^rsanime03\.lovable\.app$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/i,
];
const matchesAllowedHost = (urlStr: string | null): boolean => {
  if (!urlStr) return false;
  try { return ALLOWED_HOST_RX.some((rx) => rx.test(new URL(urlStr).host)); } catch { return false; }
};
const isAllowedRequest = (req: Request): boolean => {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!origin && !referer) return false;
  return matchesAllowedHost(origin) || matchesAllowedHost(referer);
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: cors });
    if (!isAllowedRequest(req)) {
      return new Response(JSON.stringify({ error: "Access denied", message: "Playback only available from the official RS Anime site." }), {
        status: 403, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const reqUrl = new URL(req.url);
    const path = reqUrl.pathname.includes("/an-playback") ? (reqUrl.pathname.split("/an-playback")[1] || "/") : reqUrl.pathname;
    if (path !== "/" && path !== "/hls") return new Response(JSON.stringify({ ok: true, endpoint: "/hls?url=..." }), { headers: { ...cors, "Content-Type": "application/json" } });
    const target = reqUrl.searchParams.get("url") || fromOpaqueUrlToken(reqUrl.searchParams.get("src") || "");
    if (!target) return new Response(JSON.stringify({ error: "missing ?url=" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    let targetUrl: URL;
    try { targetUrl = new URL(deepDecodeUrl(target)); } catch { return new Response("bad url", { status: 400, headers: cors }); }
    if (!/^https?:$/i.test(targetUrl.protocol)) return new Response("blocked protocol", { status: 400, headers: cors });

    const parentOrigin = getSafeOrigin(reqUrl.searchParams.get("origin") || reqUrl.searchParams.get("parent") || reqUrl.searchParams.get("ref")) || targetUrl.origin;
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
      return new Response(rewriteM3U8(await upstream.text(), targetUrl.toString(), `${getPublicFunctionOrigin(reqUrl)}/functions/v1/an-playback/hls`, parentOrigin), { status: upstream.status, headers: h });
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
      // Buffer short HLS fragments inside the edge before responding. Streaming
      // upstream.body directly logs noisy runtime errors whenever hls.js cancels
      // an in-flight fragment during seek/quality switch; fragments are small,
      // so buffering is safer and keeps preview free of false crash alerts.
      return new Response(await upstream.arrayBuffer(), { status: upstream.status, statusText: upstream.statusText, headers: h });
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: h });
  } catch (e) {
    return new Response(`AN playback proxy failed: ${(e as Error)?.message || String(e)}`, { status: 502, headers: cors });
  }
});