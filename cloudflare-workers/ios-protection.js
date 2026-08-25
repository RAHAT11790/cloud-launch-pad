// ============================================================
// Cloudflare Worker — ios-protection (v1)
// ============================================================
// Deploy as a Module Worker, then paste the Worker URL into
// Admin -> EGD Router -> ios-protection.
//
// Same gateway as the Supabase build, tuned for Cloudflare:
//   * corrects the media MIME type Safari needs (Safari never sniffs)
//   * detects ".mkv" files whose real container is MP4 (ftyp) and serves them
//     as video/mp4 so iPhone plays them natively
//   * full byte-range pass-through (Safari opens with `Range: bytes=0-1`)
//   * real Matroska (EBML) answers 415 so the player fails over instantly
//   * HLS playlists rewritten so segments stay inside the gateway
//   * CF edge cache for media so the 2nd viewer is served from the PoP
// No secrets required.
//
// Usage: https://<worker>.workers.dev/?url=<ENCODED_MEDIA_URL>
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified, cache-control, x-rs-container, x-rs-mime, x-rs-ios",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const EXT_MIME = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mkv: "video/x-matroska", ts: "video/mp2t", m4s: "video/iso.segment",
  aac: "audio/aac", m4a: "audio/mp4", mp3: "audio/mpeg",
};

const HEADER_TIMEOUT_MS = 9000;

const decodeToken = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch { return ""; }
};

const extOf = (target) => {
  try {
    const m = new URL(target).pathname.toLowerCase().match(/\.([a-z0-9]{2,4})(?:$|[?#])/);
    return m ? m[1] : "";
  } catch { return ""; }
};

const isUselessContentType = (ct) => {
  const v = String(ct || "").toLowerCase();
  return !v || v.includes("octet-stream") || v.startsWith("text/") || v.includes("application/binary")
    || v.includes("application/download") || v.includes("force-download") || v === "application/json";
};

async function fetchUpstream(target, referer, extra = {}, cf) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS);
  try {
    return await fetch(target, {
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        ...(referer ? { Referer: referer } : {}),
        ...extra,
      },
      redirect: "follow",
      signal: controller.signal,
      ...(cf ? { cf } : {}),
    });
  } finally { clearTimeout(timer); }
}

async function detectContainer(target, referer) {
  try {
    const res = await fetchUpstream(target, referer, { Range: "bytes=0-63" });
    if (!res.ok && res.status !== 206) return "unknown";
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 8) return "unknown";
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return "mp4";
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      const head = new TextDecoder().decode(buf.slice(0, 48)).toLowerCase();
      return head.includes("webm") ? "webm" : "matroska";
    }
    return "unknown";
  } catch { return "unknown"; }
}

function rewritePlaylist(body, target, base) {
  const wrap = (line) => {
    let abs = line;
    try { abs = new URL(line, target).toString(); } catch { return line; }
    return `${base}?url=${encodeURIComponent(abs)}`;
  };
  return body.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) return t.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${wrap(uri)}"`);
    return wrap(t);
  }).join("\n");
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: cors });

    const url = new URL(request.url);
    const target = decodeToken(url.searchParams.get("url") || url.searchParams.get("src") || "");
    const referer = url.searchParams.get("referer") || url.searchParams.get("origin") || "";
    const base = `${url.origin}${url.pathname}`;

    if (!target) {
      return new Response(JSON.stringify({ ok: true, service: "ios-protection", usage: "?url=<encoded media url>" }),
        { headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (!/^https?:\/\//i.test(target)) {
      return new Response(JSON.stringify({ error: "Invalid url" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const ext = extOf(target);
    const range = request.headers.get("range") || "";

    try {
      if (/\.m3u8(?:[?#]|$)/i.test(target)) {
        const res = await fetchUpstream(target, referer);
        const text = await res.text();
        return new Response(rewritePlaylist(text, target, base), {
          status: res.status,
          headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store", "X-RS-Container": "hls", "X-RS-Ios": "1" },
        });
      }

      let container = "unknown";
      if (ext === "mkv" || ext === "webm" || !EXT_MIME[ext]) {
        container = await detectContainer(target, referer);
      }

      if (container === "matroska") {
        return new Response(JSON.stringify({ error: "matroska-unsupported", container: "matroska" }),
          { status: 415, headers: { ...cors, "Content-Type": "application/json", "X-RS-Container": "matroska" } });
      }

      const upstream = await fetchUpstream(target, referer, range ? { Range: range } : {}, {
        cacheEverything: true,
        cacheTtl: 60 * 60 * 24 * 7,
      });

      const upstreamCt = upstream.headers.get("content-type") || "";
      let mime = "";
      if (container === "mp4") mime = "video/mp4";
      else if (container === "webm") mime = "video/webm";
      else if (isUselessContentType(upstreamCt)) mime = EXT_MIME[ext] || "video/mp4";
      else mime = upstreamCt;
      if (/matroska/i.test(mime) && container === "mp4") mime = "video/mp4";

      const headers = new Headers(cors);
      headers.set("Content-Type", mime);
      headers.set("Accept-Ranges", "bytes");
      headers.set("X-RS-Container", container);
      headers.set("X-RS-Mime", mime);
      headers.set("X-RS-Ios", "1");
      for (const key of ["content-length", "content-range", "etag", "last-modified"]) {
        const v = upstream.headers.get(key);
        if (v) headers.set(key, v);
      }
      headers.set("Cache-Control", "public, max-age=86400");

      if (request.method === "HEAD") return new Response(null, { status: upstream.status, headers });
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: String((err && err.message) || err) }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }
  },
};
