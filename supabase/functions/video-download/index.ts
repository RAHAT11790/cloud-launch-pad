// 🆕 NEW v5 (2026-09-02) — SINGLE-STREAM pass-through. REDEPLOY REQUIRED.
// ============================================================
// video-download — Dedicated, hardened download proxy
// ------------------------------------------------------------
// WHY v5:
//   v3/v4 rebuilt the file from 2MB Range slabs. Every slab is an extra
//   upstream request; edge runtimes cap those per invocation, so large files
//   stalled around 50-100MB ("half downloaded then stops"). v5 opens ONE
//   upstream connection and pipes it straight to the browser — no size
//   ceiling, no reassembly, throughput limited only by the source.
//
//   Pause/resume still works because we advertise Accept-Ranges and forward
//   the browser's own Range header untouched.
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

const fromOpaqueUrlToken = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch { return ""; }
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
  return values.slice(0, 4);
};

const sanitizeFilename = (raw: string) => {
  const cleaned = String(raw || "video.mp4")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "video.mp4";
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
};

const buildUpstreamHeaders = (target: URL, range: string | null, withContext: boolean): Record<string, string> => {
  const h: Record<string, string> = {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Encoding": "identity",
  };
  if (withContext) {
    h.Referer = `${target.protocol}//${target.hostname}/`;
    h.Origin = `${target.protocol}//${target.hostname}`;
  }
  if (range) h["Range"] = range;
  return h;
};

const openUpstream = async (
  target: URL,
  method: "GET" | "HEAD",
  range: string | null,
  signal: AbortSignal,
): Promise<Response | null> => {
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
    } catch { /* try next header shape */ }
  }
  return null;
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
  // Downloads are handed to the browser's native download manager, which
  // re-requests the URL WITHOUT Origin/Referer (and does so again on resume).
  // Blocking header-less requests therefore killed real downloads midway, so
  // we only reject requests that positively come from a foreign site.
  if (!origin && !referer) return true;
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

  const clientRange = req.headers.get("range");
  let upstream: Response | null = null;
  for (const target of targets) {
    let candidateUrl: URL;
    try { candidateUrl = new URL(target); } catch { continue; }
    if (candidateUrl.protocol !== "http:" && candidateUrl.protocol !== "https:") continue;
    upstream = await openUpstream(candidateUrl, req.method as "GET" | "HEAD", clientRange, ac.signal);
    if (upstream) break;
  }

  if (!upstream) {
    return new Response(
      JSON.stringify({ error: "Download source error", fallbackTried: targets.length }),
      { status: 502, headers: { ...downloadCorsHeaders, "Content-Type": "application/json" } },
    );
  }

  const out = new Headers(downloadCorsHeaders);
  out.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
  out.set("Accept-Ranges", "bytes");
  out.set("Cache-Control", "no-store");

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
});
