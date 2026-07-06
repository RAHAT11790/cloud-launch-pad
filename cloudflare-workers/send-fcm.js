// ============================================================
// send-fcm — Firebase Cloud Messaging (HTTP v1 API) — Cloudflare Worker
// ============================================================
// Rocket-fast push notifications backed by the Firebase Admin service
// account (JSON key stored in env.FIREBASE_SERVICE_ACCOUNT_KEY).
//
// Routes
//   POST /register     { userId, token, ua? }   → stores under fcmTokens/{userId}/{hash}
//   POST /unregister   { userId, token }        → removes a single token
//   POST /send         { title, body, image, deepLink, contentId, contentType,
//                        seasonNumber?, episodeNumber?, userIds?[] }
//                                              → FCM v1 send, 500-parallel batches,
//                                                 auto-purge invalid tokens.
//                                                 Returns { total, sent, failed, invalidRemoved, batches }
//   POST /cleanup      no body                 → deletes tokens older than TTL (24h)
//   GET  /health                               → { ok:true, project }
//
// Env (Worker secrets)
//   FIREBASE_SERVICE_ACCOUNT_KEY   Full service-account JSON (paste as one line)
//   FIREBASE_DB_URL                https://<project>-default-rtdb.firebaseio.com
//   ALLOWED_ORIGINS   (optional)   Comma-separated, wildcards ok (*.lovable.app)
//   TOKEN_TTL_HOURS   (optional)   Defaults to 24
//
// Cron: bind a Cron Trigger to run /cleanup (see wrangler.toml example
// below) so expired tokens are auto-purged.
// ============================================================

const DEFAULT_TTL_HOURS = 24;
const FCM_BATCH_SIZE = 500;
const DEFAULT_FIREBASE_DB_URL = "https://rs-anime-default-rtdb.firebaseio.com";

// ---------- CORS ----------
function corsHeaders(origin, env) {
  const allow = matchAllowedOrigin(origin, env);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-requested-with",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function matchAllowedOrigin(origin, env) {
  const list = String(env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim()).filter(Boolean);
  if (list.includes("*") || !origin) return list.includes("*") ? "*" : (list[0] || "*");
  for (const rule of list) {
    if (rule === origin) return origin;
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1);
      try {
        const host = new URL(origin).host;
        if (host.endsWith(suffix.slice(1))) return origin;
      } catch {}
    }
  }
  return list[0] || "*";
}
const json = (body, status, extra) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...(extra || {}) },
  });

// ---------- Service account + OAuth token cache ----------
let _tokenCache = { token: "", exp: 0, projectId: "" };
async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.exp - 60 > now) return _tokenCache;

  const raw = env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not configured");
  let sa;
  try { sa = JSON.parse(raw); }
  catch { throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON"); }
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error("Service account JSON is missing client_email / private_key / project_id");
  }

  const iat = now, exp = now + 3600;
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat, exp,
  };
  const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc(header)}.${enc(claim)}`;

  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error(`OAuth token exchange failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  _tokenCache = { token: data.access_token, exp: iat + Number(data.expires_in || 3600), projectId: sa.project_id };
  return _tokenCache;
}
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function importPrivateKey(pem) {
  const clean = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const der = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8", der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
}

// ---------- Firebase RTDB REST helpers ----------
async function rtdbPut(env, path, body) {
  const { token } = await getAccessToken(env);
  const dbUrl = String(env.FIREBASE_DB_URL || DEFAULT_FIREBASE_DB_URL).trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(dbUrl)) throw new Error("Firebase database URL is invalid");
  const url = `${dbUrl}${path}.json?access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { method: "PUT", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`RTDB PUT ${path} failed: ${r.status} ${await r.text().catch(() => "")}`);
}
async function rtdbPatch(env, path, body) {
  const { token } = await getAccessToken(env);
  const dbUrl = String(env.FIREBASE_DB_URL || DEFAULT_FIREBASE_DB_URL).trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(dbUrl)) throw new Error("Firebase database URL is invalid");
  const url = `${dbUrl}${path}.json?access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { method: "PATCH", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`RTDB PATCH ${path} failed: ${r.status} ${await r.text().catch(() => "")}`);
}
async function rtdbDelete(env, path) {
  const { token } = await getAccessToken(env);
  const dbUrl = String(env.FIREBASE_DB_URL || DEFAULT_FIREBASE_DB_URL).trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(dbUrl)) throw new Error("Firebase database URL is invalid");
  const url = `${dbUrl}${path}.json?access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { method: "DELETE" });
  if (!r.ok) throw new Error(`RTDB DELETE ${path} failed: ${r.status} ${await r.text().catch(() => "")}`);
}
async function rtdbGet(env, path, query = "") {
  const { token } = await getAccessToken(env);
  const dbUrl = String(env.FIREBASE_DB_URL || DEFAULT_FIREBASE_DB_URL).trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(dbUrl)) throw new Error("Firebase database URL is invalid");
  const url = `${dbUrl}${path}.json?access_token=${encodeURIComponent(token)}${query ? `&${query}` : ""}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`RTDB GET ${path} failed: ${r.status}`);
  return r.json();
}

// ---------- Token hashing (short, stable) ----------
async function tokenHash(token) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < 12; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

// ---------- FCM v1 send (one message per token) ----------
async function sendOneMessage(env, accessToken, projectId, token, payload) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const message = {
    token,
    notification: {
      title: payload.title,
      body: payload.body,
      ...(payload.image ? { image: payload.image } : {}),
    },
    data: sanitizeData({
      deepLink: payload.deepLink || "/",
      contentId: payload.contentId || "",
      contentType: payload.contentType || "",
      seasonNumber: payload.seasonNumber != null ? String(payload.seasonNumber) : "",
      episodeNumber: payload.episodeNumber != null ? String(payload.episodeNumber) : "",
      image: payload.image || "",
      title: payload.title || "",
      body: payload.body || "",
      sentAt: String(Date.now()),
    }),
    webpush: {
      headers: { Urgency: "high", TTL: "86400" },
      notification: {
        title: payload.title,
        body: payload.body,
        icon: payload.icon || "/icon-192.png",
        badge: payload.badge || "/icon-192.png",
        image: payload.image || undefined,
        requireInteraction: false,
        tag: payload.tag || (payload.contentId || "rsanime"),
        renotify: true,
      },
      fcm_options: { link: payload.deepLink || "/" },
    },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}
function sanitizeData(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = String(v == null ? "" : v);
  return out;
}
function isInvalidTokenError(status, body) {
  if (status === 404 || status === 400) {
    const code = body?.error?.details?.[0]?.errorCode || body?.error?.status;
    if (code === "UNREGISTERED" || code === "INVALID_ARGUMENT") return true;
  }
  return false;
}

// ---------- Route: /register ----------
async function handleRegister(req, env) {
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  const token = String(body.token || "").trim();
  if (!userId || !token) return json({ ok: false, error: "userId and token required" }, 400);
  const hash = await tokenHash(token);
  const now = Date.now();
  await rtdbPut(env, `/fcmTokens/${encodeURIComponent(userId)}/${hash}`, {
    token,
    createdAt: now,
    updatedAt: now,
    ua: String(body.ua || "").slice(0, 200),
  });
  return json({ ok: true, hash });
}

// ---------- Route: /unregister ----------
async function handleUnregister(req, env) {
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  const token = String(body.token || "").trim();
  if (!userId || !token) return json({ ok: false, error: "userId and token required" }, 400);
  const hash = await tokenHash(token);
  await rtdbDelete(env, `/fcmTokens/${encodeURIComponent(userId)}/${hash}`);
  return json({ ok: true });
}

// ---------- Route: /send ----------
async function handleSend(req, env) {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  const msg = String(body.body || "").trim();
  if (!title || !msg) return json({ ok: false, error: "title and body required" }, 400);

  const { token: accessToken, projectId } = await getAccessToken(env);

  // Collect tokens
  const targets = []; // [{ userId, hash, token }]
  const allTokens = (await rtdbGet(env, "/fcmTokens").catch(() => null)) || {};
  const ttlMs = Math.max(1, Number(env.TOKEN_TTL_HOURS || DEFAULT_TTL_HOURS)) * 3600 * 1000;
  const cutoff = Date.now() - ttlMs;
  const userFilter = Array.isArray(body.userIds) && body.userIds.length
    ? new Set(body.userIds.map(String))
    : null;

  for (const [uid, tokMap] of Object.entries(allTokens || {})) {
    if (userFilter && !userFilter.has(uid)) continue;
    for (const [hash, row] of Object.entries(tokMap || {})) {
      if (!row?.token) continue;
      if (Number(row.createdAt || 0) < cutoff) continue; // skip expired
      targets.push({ userId: uid, hash, token: row.token });
    }
  }

  const total = targets.length;
  let sent = 0, failed = 0, invalidRemoved = 0;
  const invalidDeletes = {};
  const errors = [];

  // Parallel batches of 500 for lightspeed dispatch
  for (let i = 0; i < targets.length; i += FCM_BATCH_SIZE) {
    const chunk = targets.slice(i, i + FCM_BATCH_SIZE);
    const results = await Promise.all(chunk.map(t =>
      sendOneMessage(env, accessToken, projectId, t.token, body).catch(err => ({ ok: false, status: 0, body: { error: String(err) } }))
    ));
    for (let j = 0; j < results.length; j++) {
      const r = results[j], t = chunk[j];
      if (r.ok) { sent++; continue; }
      failed++;
      if (isInvalidTokenError(r.status, r.body)) {
        invalidDeletes[`fcmTokens/${t.userId}/${t.hash}`] = null;
        invalidRemoved++;
      } else if (errors.length < 5) {
        errors.push({ status: r.status, error: r.body?.error?.message || r.body?.error || String(r.body).slice(0, 200) });
      }
    }
  }
  if (invalidRemoved > 0) {
    try { await rtdbPatch(env, "/", invalidDeletes); } catch {}
  }
  return json({
    ok: true, total, sent, failed, invalidRemoved,
    batches: Math.ceil(total / FCM_BATCH_SIZE),
    errors,
  });
}

// ---------- Route: /cleanup ----------
async function handleCleanup(env) {
  const ttlMs = Math.max(1, Number(env.TOKEN_TTL_HOURS || DEFAULT_TTL_HOURS)) * 3600 * 1000;
  const cutoff = Date.now() - ttlMs;
  const all = (await rtdbGet(env, "/fcmTokens").catch(() => null)) || {};
  const deletes = {};
  let removed = 0, kept = 0;
  for (const [uid, tokMap] of Object.entries(all || {})) {
    for (const [hash, row] of Object.entries(tokMap || {})) {
      if (Number(row?.createdAt || 0) < cutoff) {
        deletes[`fcmTokens/${uid}/${hash}`] = null;
        removed++;
      } else kept++;
    }
  }
  if (removed > 0) {
    try { await rtdbPatch(env, "/", deletes); } catch (e) { return json({ ok: false, error: String(e) }, 500); }
  }
  return json({ ok: true, removed, kept, ttlHours: Number(env.TOKEN_TTL_HOURS || DEFAULT_TTL_HOURS) });
}

// ---------- Fetch router ----------
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const path = url.pathname.replace(/^\/+/, "").split("/").pop() || "";
      let resp;
      if (path === "health") {
        resp = json({ ok: true, service: "send-fcm", project: (await getAccessToken(env).catch(() => ({ projectId: null }))).projectId });
      } else if (path === "register" && req.method === "POST") {
        resp = await handleRegister(req, env);
      } else if (path === "unregister" && req.method === "POST") {
        resp = await handleUnregister(req, env);
      } else if (path === "send" && req.method === "POST") {
        resp = await handleSend(req, env);
      } else if (path === "cleanup" && (req.method === "POST" || req.method === "GET")) {
        resp = await handleCleanup(env);
      } else {
        resp = json({ ok: false, error: "Not found", hint: "Use /send /register /unregister /cleanup /health" }, 404);
      }
      const merged = new Headers(resp.headers);
      for (const [k, v] of Object.entries(cors)) merged.set(k, v);
      return new Response(resp.body, { status: resp.status, headers: merged });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
        status: 500,
        headers: { "content-type": "application/json", ...cors },
      });
    }
  },
  // Cron Trigger — bind in wrangler.toml:
  //   [triggers] crons = ["0 */6 * * *"]   # every 6 hours
  async scheduled(_event, env, _ctx) {
    try { await handleCleanup(env); } catch (e) { console.warn("scheduled cleanup failed", e); }
  },
};
