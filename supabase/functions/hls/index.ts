// hls — legacy-compatible AN HLS proxy.
//
// Older builds generated `/functions/v1/hls?url=...` links. This function now
// proxies directly (not 302) so HLS.js, CORS preflight, range requests and stale
// cached links all behave the same as `/functions/v1/an-api/hls`.

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

const resolveUrl = (value: string, baseUrl: string) => {
  const raw = decode(value);
  if (!raw) return "";
  try { return new URL(raw, baseUrl).toString(); } catch { return raw; }
};

function wrapHlsUrl(raw: string, baseUrl: string, proxyPrefix: string) {
  const value = decode(raw || "");
  if (!value || value.startsWith("data:")) return value;
  if (/\/functions\/v1\/hls\?url=/i.test(value) || /\/an-api\/hls\?url=/i.test(value)) return value;
  const abs = /^https?:\/\//i.test(value) ? value : resolveUrl(value, baseUrl);
  return `${proxyPrefix}?url=${encodeURIComponent(abs)}`;
}

function rewriteM3U8(body: string, baseUrl: string, proxyPrefix: string) {
  const rewriteUriAttr = (line: string) => line.replace(/URI="([^"]+)"/gi, (_m, uri) => `URI="${wrapHlsUrl(uri, baseUrl, proxyPrefix)}"`);
  return body.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line) return raw;
    if (line.startsWith("#")) return /URI="/i.test(line) ? rewriteUriAttr(raw) : raw;
    return wrapHlsUrl(line, baseUrl, proxyPrefix);
  }).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: cors });

  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("url") || "";
  if (!target) {
    return new Response(JSON.stringify({ error: "missing ?url=" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let targetUrl: URL;
  try { targetUrl = new URL(decode(target)); } catch { return new Response("bad url", { status: 400, headers: cors }); }
  if (!/^https?:$/i.test(targetUrl.protocol)) return new Response("blocked protocol", { status: 400, headers: cors });

  const upstreamHeaders: Record<string, string> = {
    "User-Agent": UA,
    Accept: targetUrl.pathname.toLowerCase().includes(".m3u8") ? "application/vnd.apple.mpegurl,*/*" : "*/*",
    Referer: `${targetUrl.origin}/`,
    Origin: targetUrl.origin,
  };
  const range = req.headers.get("range");
  if (range) upstreamHeaders.Range = range;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: upstreamHeaders,
      signal: ac.signal,
      redirect: "follow",
    });
  } catch {
    clearTimeout(timer);
    return new Response("AN upstream fetch failed: network", { status: 502, headers: cors });
  }
  clearTimeout(timer);

  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
    try { await upstream.body?.cancel(); } catch {}
    return new Response(`AN upstream fetch failed: ${upstream.status}`, { status: 502, headers: cors });
  }

  const h = new Headers(cors);
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {
    const v = upstream.headers.get(k);
    if (v) h.set(k, v);
  }

  const ct = (upstream.headers.get("content-type") || "").toLowerCase();
  const isM3u8 = /mpegurl|m3u8/.test(ct) || /\.m3u8(?:\?|$)/i.test(targetUrl.pathname);
  if (isM3u8) {
    h.delete("content-length");
    h.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    h.set("cache-control", "no-store");
    if (req.method === "HEAD") return new Response(null, { status: upstream.status, headers: h });
    return new Response(rewriteM3U8(await upstream.text(), targetUrl.toString(), `${reqUrl.origin}/functions/v1/hls`), {
      status: upstream.status,
      headers: h,
    });
  }

  if (/\.(?:ts|m4s|js)(?:$|\?)/i.test(targetUrl.pathname) || /\/p\//i.test(targetUrl.pathname) || /javascript|text\/plain/i.test(ct)) {
    h.set("content-type", /\.m4s/i.test(targetUrl.pathname) ? "video/iso.segment" : "video/mp2t");
    h.set("content-disposition", "inline");
  }
  if (!h.has("accept-ranges")) h.set("accept-ranges", "bytes");
  if (req.method === "HEAD") return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers: h });
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: h });
});