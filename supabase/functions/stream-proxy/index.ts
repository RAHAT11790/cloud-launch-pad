// Ultra-fast HTTP→HTTPS streaming proxy for video playback.
// - Forwards Range requests (critical for seeking & fast start)
// - Streams chunks with zero buffering
// - Preserves status codes (206 Partial Content, etc.)
// - Tight CORS for browser <video> element

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "range, content-type, authorization, apikey, x-client-info",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified",
};

// Allowlist — only these origins/hosts can be proxied (security).
// Add more here if needed.
const ALLOWED_HOSTS = [
  "bot-hosting.net",
  "fi3.bot-hosting.net",
  "fi1.bot-hosting.net",
  "fi2.bot-hosting.net",
  "fi4.bot-hosting.net",
  "fi5.bot-hosting.net",
];

function isHostAllowed(hostname: string): boolean {
  return ALLOWED_HOSTS.some(
    (h) => hostname === h || hostname.endsWith("." + h),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

  if (!isHostAllowed(targetUrl.hostname)) {
    return new Response(`Host not allowed: ${targetUrl.hostname}`, {
      status: 403,
      headers: corsHeaders,
    });
  }

  // Forward only the headers that matter for streaming
  const fwdHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "*/*",
  };
  const range = req.headers.get("range");
  if (range) fwdHeaders["Range"] = range;
  const ifRange = req.headers.get("if-range");
  if (ifRange) fwdHeaders["If-Range"] = ifRange;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: fwdHeaders,
      redirect: "follow",
    });
  } catch (e) {
    return new Response(`Upstream fetch failed: ${(e as Error).message}`, {
      status: 502,
      headers: corsHeaders,
    });
  }

  // Stream straight back — no buffering on our side
  const respHeaders = new Headers(corsHeaders);
  const passthrough = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
    "cache-control",
  ];
  for (const h of passthrough) {
    const v = upstream.headers.get(h);
    if (v) respHeaders.set(h, v);
  }
  // Long browser cache so seeking re-uses already-downloaded chunks
  if (!respHeaders.has("cache-control")) {
    respHeaders.set("cache-control", "public, max-age=3600");
  }
  if (!respHeaders.has("accept-ranges")) {
    respHeaders.set("accept-ranges", "bytes");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
});
