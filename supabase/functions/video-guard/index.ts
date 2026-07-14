// ============================================================
// Supabase Edge Function — video-guard (SINGLE-USE URL PROTECTION)
// ============================================================
// Mirror of cloudflare-workers/video-guard.js. Protection layer — signs a
// real video URL into a token, then streams bytes through /play?t=... without
// redirecting the browser to the real URL.
//
// Required secret:  SIGNING_SECRET  (any long random string)
//
// Routes:
//   GET  /health
//   POST /sign            body: { url, ttl? }
//   GET  /sign?url=…&ttl=
//   GET  /play?t=<token>  → streamed media, no real URL redirect
//   GET  /resolve?t=<t>   → { url } once, then 410
// ============================================================

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const DEFAULT_TTL_SEC = 6 * 60 * 60;
const MAX_TTL_SEC = 24 * 60 * 60;
const MIN_TTL_SEC = 30;

const cors = {
  ...corsHeaders,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, range, if-range, if-none-match, if-modified-since, accept",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type, etag, last-modified",
};

const b64uEncode = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const b64uDecode = (str: string): Uint8Array => {
  const pad = "===".slice((str.length + 3) % 4);
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const enc = new TextEncoder();
const dec = new TextDecoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64uEncode(new Uint8Array(sig));
}

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function mintToken(realUrl: string, ttlSec: number, secret: string) {
  const ttl = Math.max(MIN_TTL_SEC, Math.min(MAX_TTL_SEC, Number(ttlSec) || DEFAULT_TTL_SEC));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const jti = b64uEncode(crypto.getRandomValues(new Uint8Array(12)));
  const payload = { u: realUrl, exp, jti };
  const payloadB64 = b64uEncode(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(secret, payloadB64);
  return { token: `${payloadB64}.${sig}`, exp, jti };
}

async function verifyToken(token: string, secret: string) {
  const raw = String(token || "").trim();
  if (!raw.includes(".")) return { ok: false as const, reason: "malformed" };
  const [payloadB64, sig] = raw.split(".");
  if (!payloadB64 || !sig) return { ok: false as const, reason: "malformed" };
  const expected = await hmac(secret, payloadB64);
  if (!safeEq(sig, expected)) return { ok: false as const, reason: "bad-signature" };
  let payload: any;
  try { payload = JSON.parse(dec.decode(b64uDecode(payloadB64))); }
  catch { return { ok: false as const, reason: "bad-payload" }; }
  const now = Math.floor(Date.now() / 1000);
  if (!payload?.exp || payload.exp < now) return { ok: false as const, reason: "expired" };
  if (!payload?.u || !/^https?:\/\//i.test(payload.u)) return { ok: false as const, reason: "bad-url" };
  if (!payload?.jti) return { ok: false as const, reason: "bad-jti" };
  return { ok: true as const, payload };
}

type PlaybackClaim = { fpHash: string; firstAt: number; lastAt: number; hits: number; exp: number };

// In-memory playback claim store (per-instance fallback). A token can serve the
// browser's normal Range requests for ONE client fingerprint only; replay from
// another browser/device gets 410.
const playbackClaims = new Map<string, PlaybackClaim>();

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientFingerprint(req: Request): string {
  return `${req.headers.get("x-forwarded-for") || ""}|${req.headers.get("user-agent") || ""}`;
}

function isLikelyMediaRequest(req: Request): boolean {
  if (req.method === "HEAD") return true;
  const dest = (req.headers.get("sec-fetch-dest") || "").toLowerCase();
  if (["video", "audio", "media"].includes(dest)) return true;
  if (req.headers.has("range")) return true;
  const accept = (req.headers.get("accept") || "").toLowerCase();
  return accept.includes("video/") || accept.includes("audio/") || accept.includes("*/*");
}

async function claimPlaybackOrReject(req: Request, payload: any) {
  const now = Math.floor(Date.now() / 1000);
  if (!isLikelyMediaRequest(req)) return { ok: false as const, reason: "media-only" };
  if (playbackClaims.size > 5000) {
    for (const [k, claim] of playbackClaims) if (claim.exp < now) playbackClaims.delete(k);
  }
  const fpHash = await sha256Hex(clientFingerprint(req));
  const existing = playbackClaims.get(payload.jti);
  if (existing) {
    if (existing.fpHash !== fpHash) return { ok: false as const, reason: "link expired" };
    existing.lastAt = Date.now();
    existing.hits = Math.min(9999, existing.hits + 1);
    return { ok: true as const };
  }
  playbackClaims.set(payload.jti, { fpHash, firstAt: Date.now(), lastAt: Date.now(), hits: 1, exp: payload.exp });
  return { ok: true as const };
}

function buildUpstreamHeaders(req: Request): Headers {
  const headers = new Headers();
  ["range", "if-range", "if-none-match", "if-modified-since", "accept", "accept-language"].forEach((name) => {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  });
  const ua = req.headers.get("user-agent");
  if (ua) headers.set("user-agent", ua);
  return headers;
}

function buildProxyResponse(upstream: Response, method: string): Response {
  const headers = new Headers(cors);
  ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"].forEach((name) => {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  });
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  // Strip Supabase's /functions/v1/video-guard prefix if present.
  let path = url.pathname.replace(/^\/functions\/v1\/video-guard/, "") || "/";
  path = path.replace(/\/+$/, "") || "/";

  const secret = String(Deno.env.get("SIGNING_SECRET") || "").trim();

  if (path === "/" || path === "/health") {
    return json({ ok: true, name: "video-guard", purpose: "single-use protection", hasSecret: !!secret });
  }
  if (!secret) return json({ error: "SIGNING_SECRET not configured" }, 500);

  if (path === "/sign") {
    let realUrl = "";
    let ttlSec = DEFAULT_TTL_SEC;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        realUrl = String(body?.url || "").trim();
        if (body?.ttl) ttlSec = Number(body.ttl);
      } catch { return json({ error: "invalid json body" }, 400); }
    } else {
      realUrl = String(url.searchParams.get("url") || "").trim();
      const t = url.searchParams.get("ttl");
      if (t) ttlSec = Number(t);
    }
    if (!/^https?:\/\//i.test(realUrl)) return json({ error: "url must be http(s)" }, 400);

    const { token, exp, jti } = await mintToken(realUrl, ttlSec, secret);
    const base = `${url.protocol}//${url.host}${url.pathname.replace(/\/(sign|play|resolve|health)?$/, "")}`;
    return json({
      guarded: `${base}/play?t=${token}`,
      resolveUrl: `${base}/resolve?t=${token}`,
      token, jti,
      expiresAt: exp * 1000,
    });
  }

  if (path === "/play") {
    const token = url.searchParams.get("t") || "";
    const v = await verifyToken(token, secret);
    if (!v.ok) return text(`link ${v.reason}`, 410);
    const claim = await claimPlaybackOrReject(req, v.payload);
    if (!claim.ok) return text(claim.reason, 410);
    const upstream = await fetch(v.payload.u, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: buildUpstreamHeaders(req),
      redirect: "follow",
    });
    return buildProxyResponse(upstream, req.method);
  }

  if (path === "/resolve") {
    const token = url.searchParams.get("t") || "";
    const v = await verifyToken(token, secret);
    if (!v.ok) return json({ error: v.reason }, 410);
    const claim = await claimPlaybackOrReject(req, v.payload);
    if (!claim.ok) return json({ error: claim.reason }, 410);
    return json({ url: v.payload.u, expiresAt: v.payload.exp * 1000 });
  }

  return json({ error: "not found", path }, 404);
});
