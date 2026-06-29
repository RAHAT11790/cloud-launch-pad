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
//   /functions/v1/video-download?url=<encoded>&filename=<encoded>
// ============================================================

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers":
    "range, content-type, authorization, apikey, x-client-info, accept, accept-encoding",
  "Access-Control-Expose-Headers":
    "content-length, content-type, content-disposition, accept-ranges",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 600;

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
const isAllowedRequest = (req: Request) => {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!origin && !referer) return true;
  return matchesAllowedHost(origin) || matchesAllowedHost(referer);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (!isAllowedRequest(req)) {
    return new Response(
      JSON.stringify({ error: "Access denied", message: "Download only available from the official RS Anime site." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  const filename = sanitizeFilename(url.searchParams.get("filename") || "video.mp4");
  if (!target) {
    return new Response(
      JSON.stringify({ error: "Missing ?url= parameter" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let targetUrl: URL;
  try { targetUrl = new URL(target); } catch {
    return new Response(JSON.stringify({ error: "Invalid url" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return new Response(JSON.stringify({ error: "Only http/https supported" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  let upstream: Response;
  try {
    upstream = await fetchWithRetry(targetUrl, req.method as "GET" | "HEAD", req.headers.get("range"), ac.signal);
    if (req.method === "HEAD" && !upstream.ok && upstream.status !== 206) {
      try { await upstream.body?.cancel(); } catch {}
      upstream = await fetchWithRetry(targetUrl, "GET", "bytes=0-0", ac.signal);
    }
  } catch (e) {
    const msg = (e as Error)?.message || "Upstream unreachable";
    // Some HTTP file hosts (notably bot-hosting/RSFR style servers) accept
    // HEAD/probe requests but close cloud/Supabase GET streams before sending
    // bytes. In that case the only working route is the user's own browser/IP.
    // For real download clicks, redirect to the original URL instead of ending
    // on a dead JSON error page. Client code also prefers direct HTTP first.
    if (req.method === "GET") {
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: targetUrl.toString(),
          "Cache-Control": "no-store",
          "X-RS-Fallback": "direct-browser",
          "X-RS-Upstream-Error": msg.slice(0, 180),
        },
      });
    }
    return new Response(
      JSON.stringify({ error: "Download source not responding", detail: msg }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Any non-OK final upstream → return JSON, never broken bytes.
  if (!upstream.ok && upstream.status !== 206) {
    try { await upstream.body?.cancel(); } catch {}
    if (req.method === "GET") {
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: targetUrl.toString(),
          "Cache-Control": "no-store",
          "X-RS-Fallback": "direct-browser-status",
          "X-RS-Upstream-Status": String(upstream.status),
        },
      });
    }
    return new Response(
      JSON.stringify({
        error: "Download source error",
        upstreamStatus: upstream.status,
        upstreamStatusText: upstream.statusText,
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Build a clean response. Forward only safe headers.
  const out = new Headers(corsHeaders);
  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  out.set("Content-Type", ct);
  const cl = upstream.headers.get("content-length");
  if (cl) out.set("Content-Length", cl);
  const cr = upstream.headers.get("content-range");
  if (cr) out.set("Content-Range", cr);
  out.set("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");
  out.set("Cache-Control", "no-store");

  // Force attachment with custom filename (UTF-8 safe).
  const asciiFilename = filename.replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim() || "video.mp4";
  out.set(
    "Content-Disposition",
    `attachment; filename="${asciiFilename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );

  return new Response(req.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText || "OK",
    headers: out,
  });
});
