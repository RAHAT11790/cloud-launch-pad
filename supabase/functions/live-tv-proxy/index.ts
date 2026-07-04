// live-tv-proxy — Dedicated HLS proxy for Live TV channels (clone of video-proxy).
// video-proxy — Universal ultra-fast streaming proxy
// ============================================================
// Format used by admin panel:
//   https://<project>.supabase.co/functions/v1/video-proxy?url=<ENCODED_VIDEO_URL>
//
// Features:
//  - No allowlist (universal — proxies ANY http/https video URL)
//  - Native Range request forwarding → instant seeking / skipping
//  - Zero-copy streaming (passes upstream body straight to client)
//  - Fast HEAD/GET; preserves 200/206/302 semantics
//  - Long browser cache so seek-back uses already-downloaded chunks
//  - Strips hop-by-hop headers; forwards Referer/Origin from upstream host
//  - Survives high concurrency (Deno isolate handles many requests)
// ============================================================

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers":
    "range, content-type, authorization, apikey, x-client-info, accept, accept-encoding, accept-language, cache-control, pragma, referer, origin, if-range, if-modified-since, if-none-match",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified, cache-control, content-disposition",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PASSTHROUGH_RESP = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
];

const VIDEO_MIRROR_ORIGINS = [
  "https://rahat1102-video-hosting-bot.hf.space",
  "http://fi3.bot-hosting.net:22854",
  "https://rs-stream-bot-1.onrender.com",
];

const isKnownMirrorHost = (target: URL) => {
  const host = target.host.toLowerCase();
  return host === "rs-stream-bot-1.onrender.com" ||
    host === "rahat1102-video-hosting-bot.hf.space" ||
    host === "fi3.bot-hosting.net:22854";
};

const isVideoFileRequest = (target: URL): boolean => /\.(mp4|mkv|webm|mov)(\?|#|$)/i.test(target.toString());

const buildUpstreamCandidates = (target: URL): URL[] => {
  const out: URL[] = [target];
  if (!isKnownMirrorHost(target) || !isVideoFileRequest(target)) return out;

  for (const origin of VIDEO_MIRROR_ORIGINS) {
    try {
      const candidate = new URL(`${origin}${target.pathname}${target.search}${target.hash}`);
      if (!out.some((u) => u.toString() === candidate.toString())) out.push(candidate);
    } catch { /* skip bad mirror */ }
  }
  return out;
};

const looksLikeHlsRequest = (target: URL): boolean => /\.(m3u8|ts|m4s|mp4|aac|vtt|key)(\?|#|$)/i.test(target.toString());

const rewriteM3U8 = (text: string, baseUrl: string, proxyPrefix: string): string => {
  const base = new URL(baseUrl);
  const toAbsolute = (value: string) => {
    try { return new URL(value, base).toString(); } catch { return value; }
  };
  const wrap = (value: string) => `${proxyPrefix}${encodeURIComponent(toAbsolute(value))}`;
  return text.split(/\r?\n/).map((line) => {
    if (!line.trim()) return line;
    if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${wrap(uri)}"`);
    return wrap(line.trim());
  }).join("\n");
};

// ============================================================
// Domain allowlist — block embed theft / API scraping
// ============================================================
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
  if (!origin && !referer) return true;
  return matchesAllowedHost(origin) || matchesAllowedHost(referer);
};

Deno.serve(async (req) => {
  // CORS preflight — answer instantly
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!isAllowedRequest(req)) {
    return new Response(
      JSON.stringify({ error: "Access denied", message: "This stream can only be played on the official RS Anime site." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  const forceDownload = url.searchParams.get("download") === "1";
  const requestedFileName = String(url.searchParams.get("filename") || "video.mp4").trim();
  if (!target) {
    return new Response("Missing ?url= parameter", {
      status: 400,
      headers: corsHeaders,
    });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400, headers: corsHeaders });
  }

  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return new Response("Only http/https supported", {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Build upstream headers — forward ONLY what matters.
  const fwd: Record<string, string> = {
    "User-Agent": UA,
    Accept: req.headers.get("accept") || "*/*",
    "Accept-Encoding": "identity", // disable gzip → proper Range support
    Connection: "keep-alive",
  };

  // Some live TV / CDN HLS origins reject synthetic Origin/Referer headers.
  // Use minimal headers for HLS manifests/segments; keep referer/origin only
  // for normal file servers that require basic hotlink context.
  if (!looksLikeHlsRequest(targetUrl)) {
    fwd.Referer = `${targetUrl.protocol}//${targetUrl.hostname}/`;
    fwd.Origin = `${targetUrl.protocol}//${targetUrl.hostname}`;
  }

  const range = req.headers.get("range");
  if (range) fwd["Range"] = range;

  const ifRange = req.headers.get("if-range");
  if (ifRange) fwd["If-Range"] = ifRange;

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch) fwd["If-None-Match"] = ifNoneMatch;

  const ifModifiedSince = req.headers.get("if-modified-since");
  if (ifModifiedSince) fwd["If-Modified-Since"] = ifModifiedSince;

  // Upstream fetch with abort tied to client disconnection
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  let upstream: Response | null = null;
  let effectiveTargetUrl = targetUrl;
  try {
    let lastError: unknown = null;
    for (const candidate of buildUpstreamCandidates(targetUrl)) {
      const candidateHeaders = { ...fwd };
      if (!looksLikeHlsRequest(candidate)) {
        candidateHeaders.Referer = `${candidate.protocol}//${candidate.hostname}/`;
        candidateHeaders.Origin = `${candidate.protocol}//${candidate.hostname}`;
      } else {
        delete candidateHeaders.Referer;
        delete candidateHeaders.Origin;
      }
      try {
        const res = await fetch(candidate.toString(), {
          method: req.method,
          headers: candidateHeaders,
          redirect: "follow",
          signal: ac.signal,
        });
        if (res.ok || res.status === 206 || res.status === 304) {
          upstream = res;
          effectiveTargetUrl = candidate;
          lastError = null;
          break;
        }
        lastError = new Error(`Upstream ${res.status}`);
        try { await res.body?.cancel(); } catch {}
      } catch (e) {
        lastError = e;
      }
    }
    if (!upstream) throw lastError || new Error("All upstream mirrors failed");
  } catch (e) {
    return new Response(
      `Upstream fetch failed: ${(e as Error).message}`,
      { status: 502, headers: corsHeaders },
    );
  }

  if (!upstream) {
    return new Response("Upstream fetch failed: all mirrors failed", { status: 502, headers: corsHeaders });
  }

  const respHeaders = new Headers(corsHeaders);
  for (const h of PASSTHROUGH_RESP) {
    const v = upstream.headers.get(h);
    if (v) respHeaders.set(h, v);
  }

  const upstreamType = (upstream.headers.get("content-type") || "").toLowerCase();
  const isM3u8 = /mpegurl|m3u8/.test(upstreamType) || /\.m3u8(\?|#|$)/i.test(effectiveTargetUrl.toString());
  if (isM3u8 && req.method !== "HEAD") {
    const text = await upstream.text();
    const proxyPrefix = `https://${url.host}/functions/v1/video-proxy?url=`;
    respHeaders.delete("content-length");
    respHeaders.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    respHeaders.set("cache-control", "no-store");
    respHeaders.set("content-disposition", "inline");
    return new Response(rewriteM3U8(text, effectiveTargetUrl.toString(), proxyPrefix), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  }

  if (!respHeaders.has("accept-ranges")) {
    respHeaders.set("accept-ranges", "bytes");
  }
  if (!respHeaders.has("cache-control")) {
    respHeaders.set("cache-control", "public, max-age=3600");
  }
  // Force browser-managed background download when requested, otherwise inline playback.
  if (forceDownload) {
    const safeFileName = requestedFileName
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "video.mp4";
    const asciiFileName = safeFileName.replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim() || "video.mp4";
    respHeaders.set(
      "content-disposition",
      `attachment; filename="${asciiFileName.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`,
    );
  } else {
    respHeaders.set("content-disposition", "inline");
  }

  // Stream body straight back — zero buffering on our side
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
});
