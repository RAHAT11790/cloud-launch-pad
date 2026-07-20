// 🆕 NEW v3 (2026-07-04) — Opaque src token + no stale fallback. REDEPLOY REQUIRED.
// After deploy, paste this URL back into Admin → EGD Router.
// ============================================================
// video-download — Dedicated, hardened download proxy
// ============================================================
// Purpose:
//   Browser-friendly file download proxy that NEVER surfaces raw
//   upstream protocol errors (ERR_INVALID_RESPONSE etc.) to the user.
//
// Why a separate function from video-proxy?
//   - video-proxy is tuned for streaming playback (Range, low latency,
//     instant seek). Browsers tolerate occasional bad chunks while playing.
//   - Downloads need a clean, single, attachment-style response with a
//     guaranteed-good Content-Disposition. A flaky upstream that returns
//     malformed headers / broken chunked encoding will surface as
//     "ERR_INVALID_RESPONSE" in the browser. This function probes upstream,
//     retries on transient failures, strips problematic headers, and
//     re-emits a clean response.
//
// URL format:
//   /functions/v1/video-download?src=<opaque-token>&filename=<encoded>
// ============================================================

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const downloadCorsHeaders: Record<string, string> = {
  ...corsHeaders,
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

const pickTargetFromParams = (params: URLSearchParams) => {
  for (const key of ["url", "source", "target", "u"]) {
    const value = String(params.get(key) || "").trim();
    if (/^https?:\/\//i.test(value)) return value;
  }
  const src = String(params.get("src") || "").trim();
  if (!src) return "";
  const decoded = fromOpaqueUrlToken(src);
  if (/^https?:\/\//i.test(decoded)) return decoded;
  return /^https?:\/\//i.test(src) ? src : "";
};

const pickTargetsFromParams = (params: URLSearchParams) => {
  const values: string[] = [];
  const push = (value: string | null) => {
    const raw = String(value || "").trim();
    if (/^https?:\/\//i.test(raw) && !values.includes(raw)) values.push(raw);
  };
  const pushToken = (value: string | null) => {
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
};

const sanitizeFilename = (raw: string) => {
  const cleaned = String(raw || "video.mp4")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "video.mp4";
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
};

const buildUpstreamHeaders = (target: URL, range: string | null, withContext = true): Record<string, string> => {
  const h: Record<string, string> = {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Encoding": "identity",
    Connection: "keep-alive",
  };
  if (withContext) {
    h.Referer = `${target.protocol}//${target.hostname}/`;
    h.Origin = `${target.protocol}//${target.hostname}`;
  }
  if (range) h["Range"] = range;
  return h;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fetchWithRetry = async (
  target: URL,
  method: "GET" | "HEAD",
  range: string | null,
  signal: AbortSignal,
): Promise<Response> => {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const headerPlans: Array<{ range: string | null; withContext: boolean }> = [
      { range, withContext: false },
      { range, withContext: true },
    ];
    if (range && method === "GET") {
      headerPlans.push({ range: null, withContext: false }, { range: null, withContext: true });
    }
    for (const plan of headerPlans) {
      try {
        const res = await fetch(target.toString(), {
          method,
          headers: buildUpstreamHeaders(target, plan.range, plan.withContext),
          redirect: "follow",
          signal,
        });
        // 5xx → try next header shape / retry. 4xx → return immediately.
        if (res.status >= 500 && res.status < 600) {
          lastErr = new Error(`Upstream ${res.status}`);
          try { await res.body?.cancel(); } catch {}
          continue;
        }
        return res;
      } catch (e) {
        lastErr = e;
      }
    }
    if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * (attempt + 1));
  }
  throw lastErr ?? new Error("Upstream fetch failed");
};

// Domain allowlist — block embed/scrape from non-RS sites.
const ALLOWED_HOST_RX = [
  /\.lovable\.app$/i,
  /\.lovableproject\.com$/i,
  /^lovable\.app$/i,
  /^lovableproject\.com$/i,
  /^rsanime03\.lovable\.app$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/i,
];
const matchesAllowedHost = (urlStr: string | null): boolean => {
  if (!urlStr) return false;
  try { return ALLOWED_HOST_RX.some((rx) => rx.test(new URL(urlStr).host)); } catch { return false; }
};
const isAllowedRequest = (req: Request): boolean => {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  // Require caller to identify itself; block anonymous curl/SSRF probes.
  if (!origin && !referer) return false;
  return matchesAllowedHost(origin) || matchesAllowedHost(referer);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: downloadCorsHeaders });
  }
  if (!isAllowedRequest(req)) {
    return new Response(
      JSON.stringify({ error: "Access denied", message: "Download only available from the official RS Anime site." }),
      { status: 403, headers: { ...downloadCorsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: downloadCorsHeaders });
  }

  const url = new URL(req.url);
  const targets = pickTargetsFromParams(url.searchParams);
  const filename = sanitizeFilename(url.searchParams.get("filename") || "video.mp4");
  if (!targets.length) {
    return new Response(
      JSON.stringify({ error: "Missing ?url= or ?src= parameter" }),
      { status: 400, headers: { ...downloadCorsHeaders, "Content-Type": "application/json" } },
    );
  }

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  let upstream: Response | null = null;
  let targetUrl: URL | null = null;
  const clientRange = req.headers.get("range");
  try {
    const bootstrapRange = req.method === "GET" && !clientRange ? "bytes=0-0" : clientRange;
    let lastBad: Response | null = null;
    for (const target of targets) {
      let candidateUrl: URL;
      try { candidateUrl = new URL(target); } catch { continue; }
      if (candidateUrl.protocol !== "http:" && candidateUrl.protocol !== "https:") continue;
      let candidate: Response;
      try {
        candidate = await fetchWithRetry(candidateUrl, req.method as "GET" | "HEAD", bootstrapRange, ac.signal);
      } catch {
        continue;
      }
      if (candidate.ok || candidate.status === 206) {
        upstream = candidate;
        targetUrl = candidateUrl;
        break;
      }
      if (req.method === "HEAD") {
        try { await candidate.body?.cancel(); } catch {}
        let getProbe: Response;
        try {
          getProbe = await fetchWithRetry(candidateUrl, "GET", "bytes=0-0", ac.signal);
        } catch {
          continue;
        }
        if (getProbe.ok || getProbe.status === 206) {
          upstream = getProbe;
          targetUrl = candidateUrl;
          break;
        }
        try { await getProbe.body?.cancel(); } catch {}
      }
      lastBad = candidate;
      try { await candidate.body?.cancel(); } catch {}
    }
    if (!targetUrl) {
      if (lastBad) {
        return new Response(
          JSON.stringify({
            error: "Download source error",
            upstreamStatus: lastBad.status,
            upstreamStatusText: lastBad.statusText,
            fallbackTried: targets.length,
          }),
          { status: 502, headers: { ...downloadCorsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "Invalid url" }), {
        status: 400,
        headers: { ...downloadCorsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    const msg = (e as Error)?.message || "Upstream unreachable";
    return new Response(
      JSON.stringify({ error: "Download source not responding", detail: msg }),
      { status: 502, headers: { ...downloadCorsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Any non-OK final upstream → return JSON, never broken bytes.
  if (!upstream || (!upstream.ok && upstream.status !== 206)) {
    try { await upstream?.body?.cancel(); } catch {}
    return new Response(
      JSON.stringify({
        error: "Download source error",
        upstreamStatus: upstream?.status || 502,
        upstreamStatusText: upstream?.statusText || "Bad Gateway",
      }),
      { status: 502, headers: { ...downloadCorsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Build a clean response. Forward only safe headers.
  const out = new Headers(downloadCorsHeaders);
  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  out.set("Content-Type", ct);
  const cr = upstream.headers.get("content-range");
  const acceptRanges = (upstream.headers.get("accept-ranges") || "bytes").toLowerCase();
  out.set("Accept-Ranges", acceptRanges || "bytes");
  out.set("Cache-Control", "no-store");

  // Force attachment with custom filename (UTF-8 safe).
  const asciiFilename = filename.replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim() || "video.mp4";
  out.set(
    "Content-Disposition",
    `attachment; filename="${asciiFilename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );

  // Figure out total size + start offset (for resumable-style chunked assembly).
  const clHeader = upstream.headers.get("content-length");
  let totalSize = clHeader ? Number(clHeader) : NaN;
  let startOffset = 0;
  let endOffset = Number.isFinite(totalSize) && totalSize > 0 ? totalSize - 1 : -1;
  if (cr) {
    // e.g. "bytes 0-1048575/12345678"
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

  // HEAD: return headers only.
  if (req.method === "HEAD") {
    if (Number.isFinite(totalSize) && totalSize > 0) out.set("Content-Length", String(totalSize));
    try { await upstream.body?.cancel(); } catch {}
    return new Response(null, { status, statusText, headers: out });
  }

  // If upstream doesn't advertise range support OR we don't know the total size,
  // fall back to a single-shot pipe (best-effort).
  const canChunk =
    acceptRanges === "bytes" &&
    Number.isFinite(totalSize) && totalSize > 0 &&
    endOffset >= startOffset;

  if (!canChunk) {
    if (Number.isFinite(totalSize) && totalSize > 0) out.set("Content-Length", String(totalSize));
    return new Response(upstream.body, { status, statusText, headers: out });
  }

  // Chunked assembly: consume the first upstream response we already opened,
  // then keep requesting successive Range windows so a single upstream drop
  // never kills the whole download. Each window is retried independently.
  const CHUNK_BYTES = 2 * 1024 * 1024; // 2MB per upstream slab
  const finalLength = endOffset - startOffset + 1;
  out.set("Content-Length", String(finalLength));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = startOffset;
      let currentReader: ReadableStreamDefaultReader<Uint8Array> | null =
        upstream.body ? upstream.body.getReader() : null;
      let currentEnd = endOffset; // upstream may have returned the full remainder

      const drainReader = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
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
          try {
            await drainReader(currentReader);
          } catch {
            try { currentReader.cancel(); } catch {}
          }
          currentReader = null;
        }

        while (cursor <= endOffset) {
          const chunkEnd = Math.min(cursor + CHUNK_BYTES - 1, endOffset);
          let ok = false;
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              const res = await fetchWithRetry(
                targetUrl!,
                "GET",
                `bytes=${cursor}-${chunkEnd}`,
                ac.signal,
              );
              if (!res.ok && res.status !== 206) {
                try { await res.body?.cancel(); } catch {}
                if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * (attempt + 1)); continue; }
                throw new Error(`Chunk ${cursor}-${chunkEnd} upstream ${res.status}`);
              }
              const reader = res.body!.getReader();
              try {
                await drainReader(reader);
                ok = true;
                break;
              } catch (e) {
                try { reader.cancel(); } catch {}
                // partial chunk — cursor already advanced; retry the rest.
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
    cancel() {
      try { ac.abort(); } catch {}
    },
  });

  return new Response(stream, { status, statusText, headers: out });
});
