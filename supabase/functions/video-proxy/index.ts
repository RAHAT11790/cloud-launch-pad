// ============================================================
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
  "content-disposition",
];

Deno.serve(async (req) => {
  // CORS preflight — answer instantly
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  const url = new URL(req.url);
  const target = url.searchParams.get("url");
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
    Referer: `${targetUrl.protocol}//${targetUrl.hostname}/`,
    Origin: `${targetUrl.protocol}//${targetUrl.hostname}`,
  };

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

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: fwd,
      redirect: "follow",
      signal: ac.signal,
    });
  } catch (e) {
    return new Response(
      `Upstream fetch failed: ${(e as Error).message}`,
      { status: 502, headers: corsHeaders },
    );
  }

  const respHeaders = new Headers(corsHeaders);
  for (const h of PASSTHROUGH_RESP) {
    const v = upstream.headers.get(h);
    if (v) respHeaders.set(h, v);
  }
  if (!respHeaders.has("accept-ranges")) {
    respHeaders.set("accept-ranges", "bytes");
  }
  if (!respHeaders.has("cache-control")) {
    // 1h browser/edge cache — speeds up seek-back & repeated playback
    respHeaders.set("cache-control", "public, max-age=3600");
  }

  // Stream body straight back — zero buffering on our side
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
});
