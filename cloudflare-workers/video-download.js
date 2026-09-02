// 🆕 NEW v5 (2026-09-02) — SINGLE-STREAM pass-through. REDEPLOY REQUIRED.
// ============================================================
// Cloudflare Worker — video-download
// ------------------------------------------------------------
// WHY v5:
//   v4 assembled the file from 2MB Range slabs. Every slab is a *subrequest*
//   and Cloudflare caps subrequests per request (50 on the free plan), so any
//   file bigger than ~100MB died halfway ("half downloaded, then stops").
//   v5 opens ONE upstream connection and pipes the body straight through, so
//   there is no size ceiling and throughput is upstream-limited (super fast).
//
//   Resume/pause still works: we advertise Accept-Ranges and forward the
//   browser's Range header untouched, so the native download manager can
//   restart from any offset if the connection drops.
//
// Usage:
//   https://<worker>/?src=<OPAQUE_URL_TOKEN>&filename=<ENCODED_NAME>
//   https://<worker>/?url=<RAW_HTTP_URL>&filename=<ENCODED_NAME>
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

const fromOpaqueUrlToken = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch { return ""; }
};

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
  // Keep the subrequest budget tiny: at most 4 candidates × 2 header shapes.
  return values.slice(0, 4);
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
    // identity so Content-Length stays truthful for the browser progress bar
    "Accept-Encoding": "identity",
  };
  if (withContext) {
    h.Referer = `${target.protocol}//${target.hostname}/`;
    h.Origin = `${target.protocol}//${target.hostname}`;
  }
  if (range) h.Range = range;
  return h;
}

async function openUpstream(target, method, range, signal) {
  // Two header shapes only (no context / with context). One connection wins.
  for (const withContext of [false, true]) {
    try {
      const res = await fetch(target.toString(), {
        method,
        headers: buildUpstreamHeaders(target, range, withContext),
        redirect: "follow",
        signal,
      });
      if (res.ok || res.status === 206) return res;
      try { await res.body?.cancel(); } catch {}
    } catch {}
  }
  return null;
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

    const clientRange = req.headers.get("range");
    let upstream = null;
    for (const target of targets) {
      let candidateUrl;
      try { candidateUrl = new URL(target); } catch { continue; }
      if (candidateUrl.protocol !== "http:" && candidateUrl.protocol !== "https:") continue;
      // IMPORTANT: forward the client's Range untouched, never a synthetic
      // bootstrap range — a single connection must carry the whole file.
      upstream = await openUpstream(candidateUrl, req.method, clientRange, ac.signal);
      if (upstream) break;
    }

    if (!upstream) {
      return new Response(JSON.stringify({ error: "Download source error", fallbackTried: targets.length }), {
        status: 502, headers: { ...cors, "content-type": "application/json" },
      });
    }

    const out = new Headers(cors);
    out.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    out.set("Accept-Ranges", "bytes");
    out.set("Cache-Control", "no-store");
    out.set("Cross-Origin-Resource-Policy", "cross-origin");

    const asciiFilename = filename.replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim() || "video.mp4";
    out.set(
      "Content-Disposition",
      `attachment; filename="${asciiFilename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );

    const len = upstream.headers.get("content-length");
    if (len && Number(len) > 0) out.set("Content-Length", len);
    const cr = upstream.headers.get("content-range");
    if (cr && clientRange) out.set("Content-Range", cr);

    const status = clientRange && upstream.status === 206 ? 206 : 200;

    if (req.method === "HEAD") {
      try { await upstream.body?.cancel(); } catch {}
      return new Response(null, { status, headers: out });
    }

    return new Response(upstream.body, { status, headers: out });
  },
};
