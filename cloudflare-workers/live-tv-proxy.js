// ============================================================
// Cloudflare Worker — live-tv-proxy (CF-native)
// Same behavior as video-proxy but dedicated to Live TV channels
// so bandwidth/quota is isolated.
// Usage: /?url=<ENCODED_HLS_URL>
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified, cache-control",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"];

const isM3u8 = (url, ct) => /mpegurl|m3u8/i.test(ct || "") || /\.m3u8(?:[?#]|$)/i.test(url);

const proxyUrl = (r, t) => `${r.protocol}//${r.host}${r.pathname}?url=${encodeURIComponent(t)}`;

function resolveUrl(v, base) {
  const raw = String(v || "").trim();
  if (!raw || raw.startsWith("#")) return raw;
  try { return new URL(raw, base).toString(); } catch { return raw; }
}

function rewritePlaylist(text, targetUrl, reqUrl) {
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

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const reqUrl = new URL(req.url);
    const target = reqUrl.searchParams.get("url") || "";
    if (!target) return new Response("Missing ?url=", { status: 400, headers: cors });
    let up;
    try { up = new URL(target); } catch { return new Response("Invalid url", { status: 400, headers: cors }); }

    const headers = { "User-Agent": UA, Accept: "*/*", "Accept-Encoding": "identity" };
    for (const k of ["range", "if-range", "if-none-match", "if-modified-since"]) {
      const v = req.headers.get(k); if (v) headers[k] = v;
    }
    const origin = `${up.protocol}//${up.host}`;
    const attempts = [headers, { ...headers, Referer: `${origin}/`, Origin: origin }];
    let res = null, err = "";
    for (const h of attempts) {
      try {
        res = await fetch(up.toString(), { method: req.method, headers: h, redirect: "follow" });
        if (res.ok || res.status === 206) break;
        err = `HTTP ${res.status}`;
      } catch (e) { err = e?.message || String(e); res = null; }
    }
    if (!res) return new Response(`Upstream failed: ${err}`, { status: 502, headers: cors });

    const out = new Headers(cors);
    for (const k of PASS) { const v = res.headers.get(k); if (v) out.set(k, v); }
    if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
    out.set("Cross-Origin-Resource-Policy", "cross-origin");

    if (req.method !== "HEAD" && res.ok && isM3u8(up.toString(), res.headers.get("content-type"))) {
      const body = rewritePlaylist(await res.text(), up.toString(), reqUrl);
      out.delete("content-length");
      out.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
      out.set("cache-control", "no-store");
      return new Response(body, { status: res.status, headers: out });
    }
    return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
  },
};
