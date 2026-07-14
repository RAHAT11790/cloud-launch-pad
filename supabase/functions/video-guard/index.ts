// ============================================================
// Supabase Edge Function — video-guard (SINGLE-USE URL PROTECTION)
// ============================================================
// Mirror of cloudflare-workers/video-guard.js. Pure protection —
// signs a real video URL into a token that plays exactly ONCE.
//
// Required secret:  SIGNING_SECRET  (any long random string)
//
// Routes:
//   GET  /health
//   POST /sign            body: { url, ttl? }
//   GET  /sign?url=…&ttl=
//   GET  /play?t=<token>  → 302 to real URL (once), then 410
//   GET  /resolve?t=<t>   → { url } once, then 410
// ============================================================

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const DEFAULT_TTL_SEC = 6 * 60 * 60;
const MAX_TTL_SEC = 24 * 60 * 60;
const MIN_TTL_SEC = 30;

const cors = {
  ...corsHeaders,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

// In-memory single-use store (per-instance). Good enough for pure protection;
// upgrade to Firebase/KV later if you need multi-instance strictness.
const usedJti = new Map<string, number>();
function markUsedOrReject(jti: string, expUnix: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  // Sweep expired entries occasionally
  if (usedJti.size > 5000) {
    for (const [k, exp] of usedJti) if (exp < now) usedJti.delete(k);
  }
  if (usedJti.has(jti)) return false;
  usedJti.set(jti, expUnix);
  return true;
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
    if (!markUsedOrReject(v.payload.jti, v.payload.exp)) return text("link expired", 410);
    return new Response(null, {
      status: 302,
      headers: { ...cors, Location: v.payload.u, "Cache-Control": "no-store" },
    });
  }

  if (path === "/resolve") {
    const token = url.searchParams.get("t") || "";
    const v = await verifyToken(token, secret);
    if (!v.ok) return json({ error: v.reason }, 410);
    if (!markUsedOrReject(v.payload.jti, v.payload.exp)) return json({ error: "expired" }, 410);
    return json({ url: v.payload.u, expiresAt: v.payload.exp * 1000 });
  }

  return json({ error: "not found", path }, 404);
});
