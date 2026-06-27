// ============================================================
// video-proxy — Ultra-minimal HTTP-only streaming proxy
// ============================================================
// Single job: stream HTTP video URLs to the browser as fast as
// possible. No protection, no host allow-list, no HLS rewriting,
// no scripts — just a zero-copy passthrough.
//
// Use:  /functions/v1/video-proxy?url=<ENCODED_HTTP_URL>
//
// HTTPS URLs are rejected — browsers can play them directly.
// ============================================================

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers":
    "range, content-type, accept, accept-encoding, if-range, if-none-match, if-modified-since, cache-control",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  const target = new URL(req.url).searchParams.get("url");
  if (!target) return new Response("Missing ?url=", { status: 400, headers: cors });

  let t: URL;
  try { t = new URL(target); } catch { return new Response("Invalid url", { status: 400, headers: cors }); }
  if (t.protocol !== "http:") {
    return new Response("Only http:// supported — HTTPS plays directly.", { status: 400, headers: cors });
  }

  const fwd: Record<string, string> = {
    "User-Agent": UA,
    Accept: req.headers.get("accept") || "*/*",
    "Accept-Encoding": "identity",
    Referer: `${t.protocol}//${t.host}/`,
    Origin: `${t.protocol}//${t.host}`,
  };
  const range = req.headers.get("range"); if (range) fwd.Range = range;
  const ifr = req.headers.get("if-range"); if (ifr) fwd["If-Range"] = ifr;
  const inm = req.headers.get("if-none-match"); if (inm) fwd["If-None-Match"] = inm;
  const ims = req.headers.get("if-modified-since"); if (ims) fwd["If-Modified-Since"] = ims;

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  let up: Response;
  try {
    up = await fetch(t.toString(), { method: req.method, headers: fwd, redirect: "follow", signal: ac.signal });
  } catch (e) {
    return new Response(`Upstream failed: ${(e as Error).message}`, { status: 502, headers: cors });
  }

  const h = new Headers(cors);
  for (const k of PASS) { const v = up.headers.get(k); if (v) h.set(k, v); }
  if (!h.has("accept-ranges")) h.set("accept-ranges", "bytes");
  h.set("cache-control", "public, max-age=3600");
  h.set("content-disposition", "inline");

  return new Response(up.body, { status: up.status, statusText: up.statusText, headers: h });
});
