// ============================================================
// video-proxy — HTTP-only HLS/video proxy (no scripts, no protection)
// ============================================================
// Use: /functions/v1/video-proxy?url=<ENCODED_HTTP_URL>
// - Accepts ONLY http:// upstream URLs.
// - HTTPS videos are rejected because they must play directly in <video>.
// - Rewrites HTTP HLS playlists so variants/segments also travel through
//   this proxy and never get blocked as mixed content.
// ============================================================

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type, etag, last-modified, cache-control",
  "Access-Control-Max-Age": "86400",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"];

const isM3u8 = (url: string, contentType: string | null) => /mpegurl|m3u8/i.test(contentType || "") || /\.m3u8(?:[?#]|$)/i.test(url);

function proxyUrl(reqUrl: URL, target: string) {
  const base = `${reqUrl.protocol}//${reqUrl.host}${reqUrl.pathname}`;
  return `${base}?url=${encodeURIComponent(target)}`;
}

function resolveHttpUrl(value: string, baseUrl: string) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("#")) return raw;
  try {
    const abs = new URL(raw, baseUrl).toString();
    return abs.startsWith("http://") ? abs : raw;
  } catch { return raw; }
}

function rewritePlaylist(text: string, targetUrl: string, reqUrl: URL) {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        const abs = resolveHttpUrl(uri, targetUrl);
        return abs.startsWith("http://") ? `URI="${proxyUrl(reqUrl, abs)}"` : `URI="${uri}"`;
      });
    }
    const abs = resolveHttpUrl(trimmed, targetUrl);
    return abs.startsWith("http://") ? proxyUrl(reqUrl, abs) : line;
  }).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: cors });

  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("url") || "";
  if (!target) return new Response("Missing ?url=", { status: 400, headers: cors });

  let upstreamUrl: URL;
  try { upstreamUrl = new URL(target); } catch { return new Response("Invalid url", { status: 400, headers: cors }); }
  if (upstreamUrl.protocol !== "http:") return new Response("Only http:// supported. HTTPS must play direct.", { status: 400, headers: cors });

  const baseHeaders: Record<string, string> = {
    "User-Agent": UA,
    Accept: req.headers.get("accept") || "*/*",
    "Accept-Encoding": "identity",
  };
  for (const key of ["range", "if-range", "if-none-match", "if-modified-since", "cache-control"]) {
    const value = req.headers.get(key);
    if (value) baseHeaders[key] = value;
  }

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  let up: Response | null = null;
  let lastError = "";
  const origin = `${upstreamUrl.protocol}//${upstreamUrl.host}`;
  const attempts: Record<string, string>[] = [
    baseHeaders,
    { ...baseHeaders, Referer: `${origin}/` },
    { ...baseHeaders, Referer: `${origin}/`, Origin: origin },
    { ...baseHeaders, Referer: req.headers.get("referer") || `${origin}/` },
  ];

  for (const headers of attempts) {
    try {
      up = await fetch(upstreamUrl.toString(), { method: req.method, headers, redirect: "follow", signal: ac.signal });
      if (up.ok || up.status === 206 || up.status === 304) break;
      lastError = `HTTP ${up.status}`;
      try { await up.body?.cancel(); } catch {}
    } catch (e) {
      lastError = (e as Error).message;
      up = null;
    }
  }

  if (!up) return new Response(`Upstream failed: ${lastError || "network error"}`, { status: 502, headers: cors });

  const out = new Headers(cors);
  for (const k of PASS) { const v = up.headers.get(k); if (v) out.set(k, v); }
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
  out.set("content-disposition", "inline");

  if (req.method !== "HEAD" && up.ok && isM3u8(upstreamUrl.toString(), up.headers.get("content-type"))) {
    const body = rewritePlaylist(await up.text(), upstreamUrl.toString(), reqUrl);
    out.delete("content-length");
    out.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    out.set("cache-control", "no-store");
    return new Response(body, { status: up.status, statusText: up.statusText, headers: out });
  }

  return new Response(req.method === "HEAD" ? null : up.body, { status: up.status, statusText: up.statusText, headers: out });
});
