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
const MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;

const isM3u8 = (url: string, contentType: string | null) => /mpegurl|m3u8/i.test(contentType || "") || /\.m3u8(?:[?#]|$)/i.test(url);
const isDirectMp4Like = (url: URL) => /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(url.pathname + url.search);

function capLargeMediaRange(range: string | null, upstreamUrl: URL) {
  if (!range || !isDirectMp4Like(upstreamUrl)) return range;
  const match = range.match(/^bytes=(\d+)-(\d*)$/i);
  if (!match) return range;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : Number.NaN;
  if (!Number.isFinite(start) || start < 0) return range;

  const hasExplicitEnd = Boolean(match[2]);
  const cappedEnd = start + MEDIA_CHUNK_BYTES - 1;
  // Chrome often asks an HTTP proxy for `bytes=0-<whole file>`. Passing that
  // through makes Supabase/Cloudflare stream the whole MP4 before the player has
  // metadata, which looks like a block/stall. Return small byte windows instead;
  // the browser already knows how to request the next/tail ranges for seeking.
  // Keep tail/seek requests intact (Chrome uses an open-ended tail range to find
  // the MP4 moov atom), but cap early open-ended media reads so playback starts
  // immediately instead of dragging the entire file through the edge function.
  if (!hasExplicitEnd && start > 8 * 1024 * 1024) return range;
  if (!Number.isFinite(requestedEnd) || requestedEnd - start + 1 > MEDIA_CHUNK_BYTES) {
    return `bytes=${start}-${cappedEnd}`;
  }
  return range;
}

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
    if (value) baseHeaders[key] = key === "range" ? capLargeMediaRange(value, upstreamUrl) || value : value;
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
  out.set("Cross-Origin-Resource-Policy", "cross-origin");
  out.set("Timing-Allow-Origin", "*");
  if (baseHeaders.range && baseHeaders.range !== req.headers.get("range")) out.set("x-rs-proxy-range", baseHeaders.range);

  if (req.method !== "HEAD" && up.ok && isM3u8(upstreamUrl.toString(), up.headers.get("content-type"))) {
    const body = rewritePlaylist(await up.text(), upstreamUrl.toString(), reqUrl);
    out.delete("content-length");
    out.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    out.set("cache-control", "no-store");
    return new Response(body, { status: up.status, statusText: up.statusText, headers: out });
  }

  return new Response(req.method === "HEAD" ? null : up.body, { status: up.status, statusText: up.statusText, headers: out });
});
