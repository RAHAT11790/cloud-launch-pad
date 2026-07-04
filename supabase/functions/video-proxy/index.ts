// 🆕 NEW v3 (2026-07-04) — Ultra playback: 16MB chunks + long-cache segments. REDEPLOY REQUIRED.
// After deploy, paste this URL back into Admin → EGD Router.
// ============================================================
// video-proxy — Universal HLS/video proxy (no scripts, no protection)
// ============================================================
// Use: /functions/v1/video-proxy?url=<ENCODED_VIDEO_URL>
// - Accepts http:// and https:// upstream URLs.
// - Rewrites HLS playlists so variants/segments also travel through this proxy.
// - For known RS mirrors, tries sibling mirrors with the same path when one host
//   is blocked/down, while preserving normal per-server direct playback first.
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
const MEDIA_CHUNK_BYTES = 16 * 1024 * 1024;

const isM3u8 = (url: string, contentType: string | null) => /mpegurl|m3u8/i.test(contentType || "") || /\.m3u8(?:[?#]|$)/i.test(url);
const isDirectMp4Like = (url: URL) => /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(url.pathname + url.search);

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

// NOTE: cross-mirror auto-swap removed. Previously this proxy silently rewrote
// requests between rahat1102-video-hosting-bot.hf.space, fi3.bot-hosting.net,
// rs-stream-bot-*.onrender.com when one origin was down. That masked outages
// and — after any admin URL change — kept probing dead origins for seconds
// before falling back, which made the URL Changer feel "slow" and download/
// playback appear broken. Now the proxy fetches exactly the URL saved by
// admin in Firebase. Failover between origins is the admin's job (URL Changer)
// or the per-server switch in VideoPlayer.tsx (see strict-server-isolation memory).

function buildUpstreamCandidates(target: URL): URL[] {
  return [target];
}


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
  return `${base}?src=${encodeURIComponent(toOpaqueUrlToken(target))}`;
}

function resolveHttpUrl(value: string, baseUrl: string) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("#")) return raw;
  try {
    return new URL(raw, baseUrl).toString();
  } catch { return raw; }
}

function rewritePlaylist(text: string, targetUrl: string, reqUrl: URL) {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        const abs = resolveHttpUrl(uri, targetUrl);
        return /^https?:\/\//i.test(abs) ? `URI="${proxyUrl(reqUrl, abs)}"` : `URI="${uri}"`;
      });
    }
    const abs = resolveHttpUrl(trimmed, targetUrl);
    return /^https?:\/\//i.test(abs) ? proxyUrl(reqUrl, abs) : line;
  }).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: cors });

  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("url") || fromOpaqueUrlToken(reqUrl.searchParams.get("src") || "");
  if (!target) return new Response("Missing ?url=", { status: 400, headers: cors });

  let upstreamUrl: URL;
  try { upstreamUrl = new URL(target); } catch { return new Response("Invalid url", { status: 400, headers: cors }); }
  if (upstreamUrl.protocol !== "http:" && upstreamUrl.protocol !== "https:") return new Response("Only http/https supported", { status: 400, headers: cors });

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
  let effectiveUrl = upstreamUrl;
  for (const candidate of buildUpstreamCandidates(upstreamUrl)) {
    const origin = `${candidate.protocol}//${candidate.host}`;
    const candidateBaseHeaders = { ...baseHeaders };
    const rawRange = req.headers.get("range");
    if (rawRange) candidateBaseHeaders.range = capLargeMediaRange(rawRange, candidate) || rawRange;
    // IMPORTANT: never forward the browser's own Referer (rsanime03.lovable.app)
    // to upstream — some HTTP mirrors (bot-hosting/render/etc.) reject requests
    // whose Referer is a public site domain, which is what broke Server 2 / the
    // HTTP proxy path. We only synthesize a Referer/Origin that matches the
    // upstream host so it looks like a same-origin fetch.
    const attempts: Record<string, string>[] = [
      candidateBaseHeaders,
      { ...candidateBaseHeaders, Referer: `${origin}/` },
      { ...candidateBaseHeaders, Referer: `${origin}/`, Origin: origin },
    ];
    for (const headers of attempts) {
      try {
        up = await fetch(candidate.toString(), { method: req.method, headers, redirect: "follow", signal: ac.signal });
        if (up.ok || up.status === 206 || up.status === 304) {
          effectiveUrl = candidate;
          break;
        }
        lastError = `HTTP ${up.status}`;
        try { await up.body?.cancel(); } catch {}
      } catch (e) {
        lastError = (e as Error).message;
        up = null;
      }
    }
    if (up && (up.ok || up.status === 206 || up.status === 304)) break;
  }

  if (!up) return new Response(`Upstream failed: ${lastError || "network error"}`, { status: 502, headers: cors });

  const out = new Headers(cors);
  for (const k of PASS) { const v = up.headers.get(k); if (v) out.set(k, v); }
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
  out.set("content-disposition", "inline");
  out.set("Cross-Origin-Resource-Policy", "cross-origin");
  out.set("Timing-Allow-Origin", "*");
  if (baseHeaders.range && baseHeaders.range !== req.headers.get("range")) out.set("x-rs-proxy-range", baseHeaders.range);

  if (req.method !== "HEAD" && up.ok && isM3u8(effectiveUrl.toString(), up.headers.get("content-type"))) {
    const body = rewritePlaylist(await up.text(), effectiveUrl.toString(), reqUrl);
    out.delete("content-length");
    out.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    out.set("cache-control", "no-store");
    return new Response(body, { status: up.status, statusText: up.statusText, headers: out });
  }

  return new Response(req.method === "HEAD" ? null : up.body, { status: up.status, statusText: up.statusText, headers: out });
});
