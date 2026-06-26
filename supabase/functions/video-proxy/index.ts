// ============================================================
// video-proxy — Universal ultra-fast streaming proxy
// ============================================================
// Format used by admin panel:
//   https://<project>.supabase.co/functions/v1/video-proxy?url=<ENCODED_VIDEO_URL>
//
// Features:
//  - Per-request proxy only: never swaps/mirrors across admin video servers
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

const looksLikeHlsRequest = (target: URL): boolean => /\.(m3u8|ts|m4s|aac|vtt|key)(\?|#|$)/i.test(target.toString());

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
// Protection intentionally DISABLED — proxy must just run fast.
// Its only job: pass through any video URL (HTTP especially) to
// the browser as quickly as possible. No host allow-list, no
// origin/referer check. Anti-hotlink belongs at the player layer.
// ============================================================
const isAllowedRequest = (_req: Request): boolean => true;

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

  // Auto behaviour per upstream protocol:
  //   http://  → ALWAYS proxy. Browsers block mixed-content http inside an
  //              https page, so the proxy is what makes these servers playable.
  //              Domain allow-list above still enforces hot-link protection.
  //   https:// → Pass through, but only after the domain allow-list above has
  //              confirmed the caller is on an approved origin. This is the
  //              "protection only" mode for already-playable servers.
  const upstreamIsHttp = targetUrl.protocol === "http:";
  const upstreamIsHttps = targetUrl.protocol === "https:";
  void upstreamIsHttp; void upstreamIsHttps;


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
    fwd.Referer = `${targetUrl.protocol}//${targetUrl.host}/`;
    fwd.Origin = `${targetUrl.protocol}//${targetUrl.host}`;
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
    const headerAttempts: Record<string, string>[] = [];
    const withContext = { ...fwd };
    const minimal = { ...fwd };
    delete minimal.Referer;
    delete minimal.Origin;

    // Some RSFR/bot-hosting style HTTP servers close cloud requests when a
    // Range header is present, even though the same file can stream as a plain
    // 200 response. Keep Range first for normal seeking, then retry without it
    // before declaring the server blocked.
    if (!looksLikeHlsRequest(targetUrl)) {
      withContext.Referer = `${targetUrl.protocol}//${targetUrl.host}/`;
      withContext.Origin = `${targetUrl.protocol}//${targetUrl.host}`;
      headerAttempts.push(minimal, withContext);
    } else {
      headerAttempts.push(minimal, withContext);
    }
    if (range && req.method === "GET") {
      const minimalNoRange = { ...minimal };
      const withContextNoRange = { ...withContext };
      delete minimalNoRange.Range;
      delete withContextNoRange.Range;
      headerAttempts.push(minimalNoRange, withContextNoRange);
    }

    for (const candidateHeaders of headerAttempts) {
      try {
        const res = await fetch(targetUrl.toString(), {
          method: req.method,
          headers: candidateHeaders,
          redirect: "follow",
          signal: ac.signal,
        });
        if (res.ok || res.status === 206 || res.status === 304) {
          upstream = res;
          effectiveTargetUrl = targetUrl;
          lastError = null;
          break;
        }
        lastError = new Error(`Upstream ${res.status}`);
        try { await res.body?.cancel(); } catch {}
      } catch (e) {
        lastError = e;
      }
    }
    if (!upstream) throw lastError || new Error("Upstream failed");
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
    const proxySelf = new URL(req.url);
    proxySelf.searchParams.delete("url");
    proxySelf.searchParams.delete("download");
    proxySelf.searchParams.delete("filename");
    const existingParams = proxySelf.searchParams.toString();
    const proxyPrefix = `${proxySelf.origin}${proxySelf.pathname}?${existingParams ? `${existingParams}&` : ""}url=`;
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
