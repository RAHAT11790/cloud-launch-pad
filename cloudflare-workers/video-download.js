// 🆕 NEW v4 (2026-07-04) — Chunked assembly + opaque src token + multi-download safe.
// REDEPLOY REQUIRED. After deploy, paste this URL into Admin → EGD Router
// (video-download override). Router path stays "/" so pasting the base
// workers.dev URL alone is enough.
// ============================================================
// Cloudflare Worker — video-download (CF-native, latest)
// Hardened, browser-native download proxy. Mirrors the Supabase
// edge function so behaviour is identical between fallbacks.
//
// Usage:
//   https://<worker>/?src=<OPAQUE_URL_TOKEN>&filename=<ENCODED_NAME>
//   https://<worker>/?url=<RAW_HTTP_URL>&filename=<ENCODED_NAME>
//
// Multi-download support:
//   Every response returns Content-Disposition: attachment + permissive CORS,
//   so the browser hands the response straight to its native downloader.
//   Because each request is stateless the client can trigger many downloads
//   in parallel (via hidden iframes) without the worker holding state.
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers":
    "range, content-type, authorization, apikey, x-client-info, accept, accept-encoding",
  "Access-Control-Expose-Headers":
    "content-length, content-type, content-disposition, content-range, accept-ranges",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 600;
const CHUNK_BYTES = 2 * 1024 * 1024; // 2MB per upstream slab

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fromOpaqueUrlToken = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch { return ""; }
};

function pickTarget(params) {
  for (const key of ["url", "source", "target", "u"]) {
    const value = String(params.get(key) || "").trim();
    if (/^https?:\/\//i.test(value)) return value;
  }
  const src = String(params.get("src") || "").trim();
  if (!src) return "";
  const decoded = fromOpaqueUrlToken(src);
  if (/^https?:\/\//i.test(decoded)) return decoded;
  return /^https?:\/\//i.test(src) ? src : "";
}

function pickTargets(params) {
  const values = [];
  const push = (value) => {
    const raw = String(value || "").trim();
    if (/^https?:\/\//i.test(raw) && !values.includes(raw)) values.push(raw);
  };
  const pushToken = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    const decoded = fromOpaqueUrlToken(raw);
    push(decoded || raw);
  };

  ["url", "source", "target", "u"].forEach((key) => push(params.get(key)));
  pushToken(params.get("src"));
  ["alt", "fallback", "mirror"].forEach((key) => params.getAll(key).forEach(push));
  ["altSrc", "fallbackSrc", "mirrorSrc"].forEach((key) => params.getAll(key).forEach(pushToken));
  for (let i = 2; i <= 10; i += 1) {
    push(params.get(`url${i}`));
    pushToken(params.get(`src${i}`));
  }
  return values;
}

function sanitizeFilename(raw) {
  const cleaned = String(raw || "video.mp4")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "video.mp4";
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
}

function buildUpstreamHeaders(target, range, withContext) {
  const h = {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Encoding": "identity",
    Connection: "keep-alive",
  };
  if (withContext) {
    h.Referer = `${target.protocol}//${target.hostname}/`;
    h.Origin = `${target.protocol}//${target.hostname}`;
  }
  if (range) h.Range = range;
  return h;
}

async function fetchWithRetry(target, method, range, signal) {
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const plans = [
      { range, withContext: false },
      { range, withContext: true },
    ];
    if (range && method === "GET") {
      plans.push({ range: null, withContext: false }, { range: null, withContext: true });
    }
    for (const plan of plans) {
      try {
        const res = await fetch(target.toString(), {
          method,
          headers: buildUpstreamHeaders(target, plan.range, plan.withContext),
          redirect: "follow",
          signal,
        });
        if (res.status >= 500 && res.status < 600) {
          lastErr = new Error(`Upstream ${res.status}`);
          try { await res.body?.cancel(); } catch {}
          continue;
        }
        return res;
      } catch (e) { lastErr = e; }
    }
    if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * (attempt + 1));
  }
  throw lastErr ?? new Error("Upstream fetch failed");
}

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    const u = new URL(req.url);
    const targets = pickTargets(u.searchParams);
    const filename = sanitizeFilename(u.searchParams.get("filename") || "video.mp4");
    if (!targets.length) {
      return new Response(JSON.stringify({ error: "Missing ?url= or ?src= parameter" }), {
        status: 400,
        headers: { ...cors, "content-type": "application/json" },
      });
    }

    const ac = new AbortController();
    req.signal.addEventListener("abort", () => ac.abort(), { once: true });

    let upstream;
    let up;
    const clientRange = req.headers.get("range");
    try {
      const bootstrapRange = req.method === "GET" && !clientRange ? "bytes=0-0" : clientRange;
      let lastBad = null;
      for (const target of targets) {
        let candidateUrl;
        try { candidateUrl = new URL(target); } catch { continue; }
        if (candidateUrl.protocol !== "http:" && candidateUrl.protocol !== "https:") continue;
        let candidate;
        try { candidate = await fetchWithRetry(candidateUrl, req.method, bootstrapRange, ac.signal); }
        catch { continue; }
        if (candidate.ok || candidate.status === 206) {
          upstream = candidate;
          up = candidateUrl;
          break;
        }
        if (req.method === "HEAD") {
          try { await candidate.body?.cancel(); } catch {}
          let getProbe;
          try { getProbe = await fetchWithRetry(candidateUrl, "GET", "bytes=0-0", ac.signal); }
          catch { continue; }
          if (getProbe.ok || getProbe.status === 206) {
            upstream = getProbe;
            up = candidateUrl;
            break;
          }
          try { await getProbe.body?.cancel(); } catch {}
        }
        lastBad = candidate;
        try { await candidate.body?.cancel(); } catch {}
      }
      if (!up) {
        if (lastBad) {
          return new Response(JSON.stringify({ error: "Download source error", upstreamStatus: lastBad.status, upstreamStatusText: lastBad.statusText, fallbackTried: targets.length }), {
            status: 502, headers: { ...cors, "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "Invalid url" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: "Download source not responding", detail: String(e?.message || e) }), {
        status: 502, headers: { ...cors, "content-type": "application/json" },
      });
    }

    if (!upstream || (!upstream.ok && upstream.status !== 206)) {
      try { await upstream?.body?.cancel(); } catch {}
      return new Response(JSON.stringify({ error: "Download source error", upstreamStatus: upstream?.status || 502, upstreamStatusText: upstream?.statusText || "Bad Gateway" }), {
        status: 502, headers: { ...cors, "content-type": "application/json" },
      });
    }

    const out = new Headers(cors);
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    out.set("Content-Type", ct);
    const cr = upstream.headers.get("content-range");
    const acceptRanges = (upstream.headers.get("accept-ranges") || "bytes").toLowerCase();
    out.set("Accept-Ranges", acceptRanges || "bytes");
    out.set("Cache-Control", "no-store");
    out.set("Cross-Origin-Resource-Policy", "cross-origin");

    const asciiFilename = filename.replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim() || "video.mp4";
    out.set(
      "Content-Disposition",
      `attachment; filename="${asciiFilename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );

    const clHeader = upstream.headers.get("content-length");
    let totalSize = clHeader ? Number(clHeader) : NaN;
    let startOffset = 0;
    let endOffset = Number.isFinite(totalSize) && totalSize > 0 ? totalSize - 1 : -1;
    if (cr) {
      const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(cr);
      if (m) {
        startOffset = Number(m[1]);
        endOffset = Number(m[2]);
        if (m[3] !== "*") totalSize = Number(m[3]);
        out.set("Content-Range", `bytes ${startOffset}-${endOffset}/${m[3]}`);
      }
    }

    if (!clientRange && Number.isFinite(totalSize) && totalSize > 0) {
      startOffset = 0;
      endOffset = totalSize - 1;
      out.delete("Content-Range");
    }

    const status = clientRange ? upstream.status : 200;
    const statusText = upstream.statusText || "OK";

    if (req.method === "HEAD") {
      if (Number.isFinite(totalSize) && totalSize > 0) out.set("Content-Length", String(totalSize));
      try { await upstream.body?.cancel(); } catch {}
      return new Response(null, { status, statusText, headers: out });
    }

    const canChunk =
      acceptRanges === "bytes" &&
      Number.isFinite(totalSize) && totalSize > 0 &&
      endOffset >= startOffset;

    if (!canChunk) {
      if (Number.isFinite(totalSize) && totalSize > 0) out.set("Content-Length", String(totalSize));
      return new Response(upstream.body, { status, statusText, headers: out });
    }

    const finalLength = endOffset - startOffset + 1;
    out.set("Content-Length", String(finalLength));

    const stream = new ReadableStream({
      async start(controller) {
        let cursor = startOffset;
        let currentReader = upstream.body ? upstream.body.getReader() : null;

        const drainReader = async (reader) => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value && value.byteLength) {
              controller.enqueue(value);
              cursor += value.byteLength;
            }
          }
        };

        try {
          if (currentReader) {
            try { await drainReader(currentReader); }
            catch { try { currentReader.cancel(); } catch {} }
            currentReader = null;
          }

          while (cursor <= endOffset) {
            const chunkEnd = Math.min(cursor + CHUNK_BYTES - 1, endOffset);
            let ok = false;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
              try {
                const res = await fetchWithRetry(up, "GET", `bytes=${cursor}-${chunkEnd}`, ac.signal);
                if (!res.ok && res.status !== 206) {
                  try { await res.body?.cancel(); } catch {}
                  if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * (attempt + 1)); continue; }
                  throw new Error(`Chunk ${cursor}-${chunkEnd} upstream ${res.status}`);
                }
                const reader = res.body.getReader();
                try {
                  await drainReader(reader);
                  ok = true;
                  break;
                } catch (e) {
                  try { reader.cancel(); } catch {}
                  if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * (attempt + 1)); continue; }
                  throw e;
                }
              } catch (e) {
                if (attempt >= MAX_RETRIES) throw e;
                await sleep(RETRY_DELAY_MS * (attempt + 1));
              }
            }
            if (!ok && cursor <= endOffset) throw new Error("Chunk assembly failed");
          }
          controller.close();
        } catch (err) {
          try { controller.error(err); } catch {}
        }
      },
      cancel() { try { ac.abort(); } catch {} },
    });

    return new Response(stream, { status, statusText, headers: out });
  },
};
