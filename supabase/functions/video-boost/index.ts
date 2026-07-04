// ============================================================
// 🚀 video-boost — Alpha Professional Playback Proxy (Supabase)
// ============================================================
// Universal proxy that sits in front of EVERY video URL (RS
// Server 1/2/3, direct MP4, HLS, Telegram-hosted mirrors).
//
// FEATURES:
//   ⚡ 8MB aligned range windows + long-cache immutable segments
//      so any CDN/browser cache hits skip requests instantly.
//   🔒 Anti-theft — Referer/Origin domain lock via optional
//      ALLOWED_ORIGINS secret (comma-separated, wildcards ok).
//      Empty = allow all (safe default).
//   🎬 HLS + MP4 + Telegram-mirror with playlist rewrite,
//      multi-attempt referrer/origin fallback.
//   🕵️ Opaque `?src=` token — raw upstream URL never surfaces.
//
// DEPLOY: functions/v1/video-boost — paste into Admin → EGD
// Router → `video-boost`.
// ============================================================

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified, cache-control",
  "Access-Control-Max-Age": "86400",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];
const MEDIA_CHUNK_BYTES = 8 * 1024 * 1024;

const isM3u8 = (url: string, ct: string | null) => /mpegurl|m3u8/i.test(ct || "") || /\.m3u8(?:[?#]|$)/i.test(url);
const isDirectMp4Like = (u: URL) => /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(u.pathname + u.search);
const isSegmentLike = (u: URL) => /\.(?:ts|m4s|aac|mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(u.pathname);

const toOpaqueUrlToken = (v: string) => {
  try { return btoa(unescape(encodeURIComponent(String(v || "")))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
  catch { return ""; }
};
const fromOpaqueUrlToken = (v: string) => {
  const raw = String(v || "").trim();
  if (!raw) return "";
  try { return decodeURIComponent(escape(atob(raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4)))); }
  catch { return ""; }
};

// 🔒 Domain lock
function matchOrigin(host: string, pattern: string): boolean {
  const h = host.toLowerCase(), p = pattern.toLowerCase().trim();
  if (!p) return false;
  if (p === h) return true;
  if (p.startsWith("*.")) return h === p.slice(2) || h.endsWith(p.slice(1));
  return false;
}
function isAllowedOrigin(req: Request): boolean {
  const raw = (Deno.env.get("ALLOWED_ORIGINS") ?? "").trim();
  if (!raw) return true;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const candidates = [req.headers.get("origin"), req.headers.get("referer")].filter(Boolean) as string[];
  if (candidates.length === 0) return false;
  for (const c of candidates) {
    try { const host = new URL(c).hostname; if (list.some((p) => matchOrigin(host, p))) return true; } catch {}
  }
  return false;
}

function alignRange(range: string | null, u: URL): { range: string | null; windowStart: number | null } {
  if (!range || !isDirectMp4Like(u)) return { range, windowStart: null };
  const m = range.match(/^bytes=(\d+)-(\d*)$/i);
  if (!m) return { range, windowStart: null };
  const start = Number(m[1]);
  if (!Number.isFinite(start) || start < 0) return { range, windowStart: null };
  const ws = Math.floor(start / MEDIA_CHUNK_BYTES) * MEDIA_CHUNK_BYTES;
  return { range: `bytes=${ws}-${ws + MEDIA_CHUNK_BYTES - 1}`, windowStart: ws };
}

const resolveUrl = (v: string, base: string) => {
  const raw = String(v || "").trim();
  if (!raw || raw.startsWith("#")) return raw;
  try { return new URL(raw, base).toString(); } catch { return raw; }
};
function proxyUrl(reqUrl: URL, target: string) {
  return `${reqUrl.protocol}//${reqUrl.host}${reqUrl.pathname}?src=${encodeURIComponent(toOpaqueUrlToken(target))}`;
}
function rewritePlaylist(text: string, targetUrl: string, reqUrl: URL) {
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        const abs = resolveUrl(uri, targetUrl);
        return /^https?:\/\//i.test(abs) ? `URI="${proxyUrl(reqUrl, abs)}"` : `URI="${uri}"`;
      });
    }
    const abs = resolveUrl(t, targetUrl);
    return /^https?:\/\//i.test(abs) ? proxyUrl(reqUrl, abs) : line;
  }).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: cors });

  if (!isAllowedOrigin(req)) return new Response("Forbidden: origin not allowed", { status: 403, headers: cors });

  const reqUrl = new URL(req.url);
  const target = fromOpaqueUrlToken(reqUrl.searchParams.get("src") || "") || reqUrl.searchParams.get("url");
  if (!target) return new Response("Missing ?src=", { status: 400, headers: cors });

  let up: URL;
  try { up = new URL(target); } catch { return new Response("Invalid url", { status: 400, headers: cors }); }
  if (up.protocol !== "http:" && up.protocol !== "https:") return new Response("Only http/https supported", { status: 400, headers: cors });

  const rawRange = req.headers.get("range");
  const aligned = alignRange(rawRange, up);

  const headers: Record<string, string> = { "User-Agent": UA, Accept: req.headers.get("accept") || "*/*", "Accept-Encoding": "identity" };
  for (const k of ["range", "if-range", "if-none-match", "if-modified-since", "cache-control"]) {
    const v = req.headers.get(k);
    if (v) headers[k] = k === "range" ? (aligned.range || v) : v;
  }
  const origin = `${up.protocol}//${up.host}`;
  const attempts: Record<string, string>[] = [
    headers,
    { ...headers, Referer: `${origin}/` },
    { ...headers, Referer: `${origin}/`, Origin: origin },
  ];

  let res: Response | null = null; let lastErr = "";
  for (const h of attempts) {
    try {
      res = await fetch(up.toString(), { method: req.method, headers: h, redirect: "follow" });
      if (res.ok || res.status === 206 || res.status === 304) break;
      lastErr = `HTTP ${res.status}`;
      try { await res.body?.cancel(); } catch {}
    } catch (e) { lastErr = (e as Error).message; res = null; }
  }
  if (!res) return new Response(`Upstream failed: ${lastErr}`, { status: 502, headers: cors });

  const out = new Headers(cors);
  for (const k of PASS) { const v = res.headers.get(k); if (v) out.set(k, v); }
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
  out.set("content-disposition", "inline");
  out.set("Cross-Origin-Resource-Policy", "cross-origin");
  out.set("Timing-Allow-Origin", "*");

  if (req.method !== "HEAD" && res.ok && isM3u8(up.toString(), res.headers.get("content-type"))) {
    const body = rewritePlaylist(await res.text(), up.toString(), reqUrl);
    out.delete("content-length");
    out.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    out.set("cache-control", "public, max-age=6, stale-while-revalidate=30");
    return new Response(body, { status: res.status, headers: out });
  }

  if (isSegmentLike(up) && (res.status === 200 || res.status === 206)) {
    out.set("cache-control", "public, max-age=604800, immutable");
  }
  return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, statusText: res.statusText, headers: out });
});
