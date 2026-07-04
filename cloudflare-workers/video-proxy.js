// 🆕 NEW v5 (2026-07-04) — RS TRUE-RANGE: exact browser range pass-through. REDEPLOY REQUIRED.
// After deploy, paste this URL back into Admin → EGD Router → video-proxy.
// ============================================================
// Cloudflare Worker — video-proxy (CF-native port)
// ============================================================
// Deploy as a Module Worker. Usage:
//   https://<worker>.<sub>.workers.dev/?url=<ENCODED_VIDEO_URL>
// Same behavior as Supabase video-proxy: HLS playlist rewriting,
// exact range streaming, http+https upstream, safe headers.
// No env vars required.
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified, cache-control, x-rs-proxy-fallback, x-rs-proxy-error",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"];
const MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;

const isM3u8 = (url, ct) => /mpegurl|m3u8/i.test(ct || "") || /\.m3u8(?:[?#]|$)/i.test(url);
const isDirectMp4Like = (u) => /\.(?:mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(u.pathname + u.search);

const toOpaqueUrlToken = (value) => {
  try {
    return btoa(unescape(encodeURIComponent(String(value || "")))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch {
    return "";
  }
};

const fromOpaqueUrlToken = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return "";
  }
};

function clampInvalidContentRange(headers) {
  const raw = headers.get("content-range") || "";
  const match = raw.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  if (!match) return;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(total) || total <= 0) return;
  const maxEnd = total - 1;
  if (end <= maxEnd) return;
  headers.set("content-range", `bytes ${start}-${maxEnd}/${total}`);
  headers.set("content-length", String(Math.max(0, total - start)));
}

function fallbackResponse(message, detail = "", upstreamStatus) {
  return new Response(JSON.stringify({
    error: "VIDEO_SOURCE_UNAVAILABLE",
    fallback: true,
    message,
    detail,
    upstreamStatus: upstreamStatus || null,
  }), {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "x-rs-proxy-fallback": "1",
      "x-rs-proxy-error": message,
    },
  });
}

function alignMediaRange(range, upstreamUrl) {
  if (!range || !isDirectMp4Like(upstreamUrl)) return { range, windowStart: null };
  const m = String(range).trim().match(/^bytes=(\d+)-$/i);
  if (!m) return { range, windowStart: null };
  const start = Number(m[1]);
  if (!Number.isFinite(start) || start < 0) return { range, windowStart: null };
  return { range: `bytes=${start}-${start + MEDIA_CHUNK_BYTES - 1}`, windowStart: start };
}

function requestedOpenEndedRange(range) {
  return /^bytes=\d+-$/i.test(String(range || "").trim());
}

function browserRangeResponseHeaders(headers, originalRange) {
  if (!requestedOpenEndedRange(originalRange)) return;
  if (!headers.has("content-range")) headers.delete("content-length");
}

function parseContentRange(value) {
  const m = String(value || "").match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const total = m[3] === "*" ? NaN : Number(m[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end, total };
}

async function drainReader(reader, controller) {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value && value.byteLength) controller.enqueue(value);
  }
}

function streamOpenEndedRange(target, method, firstResponse, out, rawRange, headers) {
  if (method === "HEAD" || !requestedOpenEndedRange(rawRange)) return null;
  const firstRange = parseContentRange(firstResponse.headers.get("content-range"));
  const requestedStart = Number(String(rawRange || "").match(/^bytes=(\d+)-$/i)?.[1] || NaN);
  if (!firstRange || !Number.isFinite(firstRange.total) || firstRange.total <= 0 || firstRange.start !== requestedStart) return null;

  out.set("content-range", `bytes ${firstRange.start}-${firstRange.total - 1}/${firstRange.total}`);
  out.set("content-length", String(firstRange.total - firstRange.start));

  return new ReadableStream({
    start(controller) {
      (async () => {
      let cursor = firstRange.start;
      try {
        const firstReader = firstResponse.body?.getReader();
        if (firstReader) {
          await drainReader(firstReader, controller);
          cursor = firstRange.end + 1;
        }
        while (cursor < firstRange.total) {
          const chunkEnd = Math.min(cursor + MEDIA_CHUNK_BYTES - 1, firstRange.total - 1);
          const res = await fetch(target.toString(), {
            method: "GET",
            headers: { ...headers, range: `bytes=${cursor}-${chunkEnd}` },
            redirect: "follow",
          });
          if (!(res.ok || res.status === 206)) {
            try { await res.body?.cancel(); } catch {}
            throw new Error(`Upstream chunk ${cursor}-${chunkEnd} failed: ${res.status}`);
          }
          const reader = res.body?.getReader();
          if (!reader) throw new Error("Upstream chunk body missing");
          await drainReader(reader, controller);
          cursor = chunkEnd + 1;
        }
        controller.close();
      } catch (e) {
        try { controller.error(e); } catch {}
      }
      })();
    },
    cancel() {
      try { firstResponse.body?.cancel(); } catch {}
    },
  });
}

function proxyUrl(reqUrl, target) {
  return `${reqUrl.protocol}//${reqUrl.host}${reqUrl.pathname}?src=${encodeURIComponent(toOpaqueUrlToken(target))}`;
}

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
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "HEAD")
      return new Response("Method not allowed", { status: 405, headers: cors });

    const reqUrl = new URL(req.url);
    const target = reqUrl.searchParams.get("url") || fromOpaqueUrlToken(reqUrl.searchParams.get("src") || "");
    if (!target) return new Response("Missing ?url=", { status: 400, headers: cors });

    let up;
    try { up = new URL(target); } catch { return new Response("Invalid url", { status: 400, headers: cors }); }
    if (up.protocol !== "http:" && up.protocol !== "https:")
      return new Response("Only http/https supported", { status: 400, headers: cors });

    const rawRange = req.headers.get("range");
    const aligned = alignMediaRange(rawRange, up);
    const headers = {
      "User-Agent": UA,
      Accept: req.headers.get("accept") || "*/*",
      "Accept-Encoding": "identity",
      "Accept-Language": req.headers.get("accept-language") || "en-US,en;q=0.9",
    };
    for (const k of ["range", "if-range", "if-none-match", "if-modified-since", "cache-control"]) {
      const v = req.headers.get(k);
      if (v) headers[k] = k === "range" ? (aligned.range || v) : v;
    }
    const origin = `${up.protocol}//${up.host}`;
    const attempts = [
      headers,
      { ...headers, Referer: `${origin}/` },
      { ...headers, Referer: `${origin}/`, Origin: origin },
    ];

    let res = null, lastErr = "", effectiveHeaders = headers;
    for (const h of attempts) {
      try {
        res = await fetch(up.toString(), { method: req.method, headers: h, redirect: "follow" });
        if (res.ok || res.status === 206 || res.status === 304) { effectiveHeaders = h; break; }
        lastErr = `HTTP ${res.status}`;
        try { await res.body?.cancel(); } catch {}
      } catch (e) { lastErr = e?.message || String(e); res = null; }
    }
    if (!res) return fallbackResponse("Upstream failed", lastErr || "network error");
    if (!(res.ok || res.status === 206 || res.status === 304)) {
      try { await res.body?.cancel(); } catch {}
      return fallbackResponse("Upstream returned an error", lastErr || `HTTP ${res.status}`, res.status);
    }

    const out = new Headers(cors);
    for (const k of PASS) { const v = res.headers.get(k); if (v) out.set(k, v); }
    clampInvalidContentRange(out);
    browserRangeResponseHeaders(out, rawRange);
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

    if (isDirectMp4Like(up) && (res.status === 200 || res.status === 206)) {
      out.set("cache-control", "public, max-age=604800, immutable");
    }
    const assembledOpenRange = streamOpenEndedRange(up, req.method, res, out, rawRange, effectiveHeaders);
    if (assembledOpenRange) {
      return new Response(assembledOpenRange, { status: res.status, headers: out });
    }
    return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
  },
};
