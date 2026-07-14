// ============================================================
// Cloudflare Worker — video-guard (SINGLE-USE URL PROTECTION)
// ============================================================
// Purpose (ONLY): Protect video URLs so each guarded link plays
// exactly ONCE. If a hacker copies the guarded URL from the
// network tab and replays it, they get "link expired".
//
// This worker DOES NOT redirect to the real URL. It signs + gates + streams
// the media bytes itself so the browser network log only sees /play?t=...
//
// ------------------------------------------------------------
// Deploy as a Module Worker. Required secret:
//   SIGNING_SECRET   — any long random string (HMAC key)
// Optional bindings:
//   GUARD_KV         — KV namespace for global single-use tracking
//                      (falls back to Cache API per-colo if absent)
//
// ------------------------------------------------------------
// Routes:
//   GET  /health
//   POST /sign            body: { url, ttl? }          → { guarded, token, expiresAt }
//   GET  /sign?url=…&ttl= (convenience)                → same JSON
//   GET  /play?t=<token>  → 302 to real URL (once), then 410
//   GET  /resolve?t=<t>   → { url } (once), then 410
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, range, if-range, if-none-match, if-modified-since, accept",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type, etag, last-modified",
  "Access-Control-Max-Age": "86400",
};

const DEFAULT_TTL_SEC = 6 * 60 * 60;   // 6h — one playback session cap
const MAX_TTL_SEC     = 24 * 60 * 60;  // 24h hard cap
const MIN_TTL_SEC     = 30;

// ---------- base64url helpers ----------
const b64uEncode = (bytes) => {
  let s = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const b64uDecode = (str) => {
  const pad = "===".slice((String(str || "").length + 3) % 4);
  const b64 = String(str || "").replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const strToBytes = (s) => new TextEncoder().encode(s);
const bytesToStr = (b) => new TextDecoder().decode(b);

// ---------- HMAC-SHA256 ----------
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw", strToBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, strToBytes(data));
  return b64uEncode(new Uint8Array(sig));
}

// Constant-time compare
function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- token: <payloadB64>.<sig> where payload = {u, exp, jti} ----------
async function mintToken(realUrl, ttlSec, secret) {
  const ttl = Math.max(MIN_TTL_SEC, Math.min(MAX_TTL_SEC, Number(ttlSec) || DEFAULT_TTL_SEC));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const jti = b64uEncode(crypto.getRandomValues(new Uint8Array(12)));
  const payload = { u: realUrl, exp, jti };
  const payloadB64 = b64uEncode(strToBytes(JSON.stringify(payload)));
  const sig = await hmac(secret, payloadB64);
  return { token: `${payloadB64}.${sig}`, exp, jti };
}

async function verifyToken(token, secret) {
  const raw = String(token || "").trim();
  if (!raw || raw.indexOf(".") < 0) return { ok: false, reason: "malformed" };
  const [payloadB64, sig] = raw.split(".");
  if (!payloadB64 || !sig) return { ok: false, reason: "malformed" };
  const expected = await hmac(secret, payloadB64);
  if (!safeEq(sig, expected)) return { ok: false, reason: "bad-signature" };
  let payload;
  try { payload = JSON.parse(bytesToStr(b64uDecode(payloadB64))); }
  catch { return { ok: false, reason: "bad-payload" }; }
  const now = Math.floor(Date.now() / 1000);
  if (!payload?.exp || payload.exp < now) return { ok: false, reason: "expired" };
  if (!payload?.u || !/^https?:\/\//i.test(payload.u)) return { ok: false, reason: "bad-url" };
  if (!payload?.jti) return { ok: false, reason: "bad-jti" };
  return { ok: true, payload };
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", strToBytes(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getClientFingerprint(req) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "";
  const ua = req.headers.get("user-agent") || "";
  return `${ip}|${ua}`;
}

function isLikelyMediaRequest(req) {
  if (req.method === "HEAD") return true;
  const dest = (req.headers.get("sec-fetch-dest") || "").toLowerCase();
  if (dest === "document" || dest === "iframe") return false;
  if (dest === "video" || dest === "audio" || dest === "media") return true;
  if (req.headers.has("range")) return true;
  const accept = (req.headers.get("accept") || "").toLowerCase();
  return accept.includes("video/") || accept.includes("audio/");
}

async function readClaim(jti, env) {
  if (env?.GUARD_KV) {
    const existing = await env.GUARD_KV.get(`u:${jti}`);
    return existing ? JSON.parse(existing) : null;
  }
  const cache = caches.default;
  const hit = await cache.match(new Request(`https://guard.local/claim/${jti}`));
  return hit ? await hit.json().catch(() => null) : null;
}

async function writeClaim(jti, expUnix, env, claim) {
  const ttl = Math.max(30, expUnix - Math.floor(Date.now() / 1000));
  if (env?.GUARD_KV) {
    await env.GUARD_KV.put(`u:${jti}`, JSON.stringify(claim), { expirationTtl: ttl });
    return;
  }
  const cache = caches.default;
  const key = new Request(`https://guard.local/claim/${jti}`);
  const marker = new Response(JSON.stringify(claim), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
  });
  await cache.put(key, marker);
}

async function claimPlaybackOrReject(req, payload, env) {
  if (!isLikelyMediaRequest(req)) return { ok: false, reason: "media-only" };
  const fpHash = await sha256Hex(getClientFingerprint(req));
  const now = Date.now();
  const existing = await readClaim(payload.jti, env);
  if (existing) {
    if (existing.fpHash && existing.fpHash !== fpHash) return { ok: false, reason: "link expired" };
    existing.lastAt = now;
    existing.hits = Math.min(9999, Number(existing.hits || 0) + 1);
    await writeClaim(payload.jti, payload.exp, env, existing);
    return { ok: true };
  }
  await writeClaim(payload.jti, payload.exp, env, { fpHash, firstAt: now, lastAt: now, hits: 1 });
  return { ok: true };
}

function buildUpstreamHeaders(req) {
  const headers = new Headers();
  ["range", "if-range", "if-none-match", "if-modified-since", "accept", "accept-language"].forEach((name) => {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  });
  const ua = req.headers.get("user-agent");
  if (ua) headers.set("user-agent", ua);
  return headers;
}

function buildProxyResponse(upstream, method) {
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

// ---------- responses ----------
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const text = (body, status = 200) => new Response(body, {
  status, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
});

// ---------- handler ----------
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const secret = String(env?.SIGNING_SECRET || "").trim();

    if (path === "/" || path === "/health") {
      return json({
        ok: true, name: "video-guard",
        purpose: "single-use streaming protection for video URLs",
        mode: "stream-proxy",
        hasSecret: !!secret,
        store: env?.GUARD_KV ? "kv" : "cache",
      });
    }
    if (!secret) return json({ error: "SIGNING_SECRET not configured" }, 500);

    // -------- SIGN --------
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
      const base = `${url.protocol}//${url.host}`;
      return json({
        guarded: `${base}/play?t=${token}`,
        resolveUrl: `${base}/resolve?t=${token}`,
        token, jti,
        expiresAt: exp * 1000,
      });
    }

    // -------- PLAY (streaming guard proxy, no real URL redirect) --------
    if (path === "/play") {
      const token = url.searchParams.get("t") || "";
      const v = await verifyToken(token, secret);
      if (!v.ok) return text(`link ${v.reason}`, 410);
      const claim = await claimPlaybackOrReject(req, v.payload, env);
      if (!claim.ok) return text(claim.reason || "link expired", 410);
      const upstream = await fetch(v.payload.u, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers: buildUpstreamHeaders(req),
        redirect: "follow",
      });
      return buildProxyResponse(upstream, req.method);
    }

    // -------- RESOLVE (JSON, single-use) --------
    if (path === "/resolve") {
      const token = url.searchParams.get("t") || "";
      const v = await verifyToken(token, secret);
      if (!v.ok) return json({ error: v.reason }, 410);
      const fresh = await markUsedOrReject(v.payload.jti, v.payload.exp, env);
      if (!fresh) return json({ error: "expired" }, 410);
      return json({ url: v.payload.u, expiresAt: v.payload.exp * 1000 });
    }

    return json({ error: "not found", path }, 404);
  },
};
