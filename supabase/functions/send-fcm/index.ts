// send-fcm — Supabase Edge Function mirror (Deno). Same routes/behavior
// as cloudflare-workers/send-fcm.js. Deploy as an alternative when the
// admin prefers the Supabase edge runtime instead of Cloudflare.

const DEFAULT_TTL_HOURS = 2160;
const FCM_BATCH_SIZE = 500;
const DEFAULT_FIREBASE_DB_URL = "https://rs-anime-default-rtdb.firebaseio.com";

function corsHeaders(origin: string, env: Record<string, string>) {
  const allow = matchOrigin(origin, env);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-requested-with",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function matchOrigin(origin: string, env: Record<string, string>) {
  const list = String(env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes("*") || !origin) return list.includes("*") ? "*" : (list[0] || "*");
  for (const rule of list) {
    if (rule === origin) return origin;
    if (rule.startsWith("*.")) {
      try { if (new URL(origin).host.endsWith(rule.slice(2))) return origin; } catch { /* noop */ }
    }
  }
  return list[0] || "*";
}
const json = (b: unknown, s = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json; charset=utf-8", ...extra } });

let _cache = { token: "", exp: 0, projectId: "" };
async function getAccessToken(env: Record<string, string>) {
  const now = Math.floor(Date.now() / 1000);
  if (_cache.token && _cache.exp - 60 > now) return _cache;
  const raw = env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not configured");
  const sa = JSON.parse(raw);
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error("service account JSON incomplete");
  const iat = now, exp = now + 3600;
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp,
  };
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc(header)}.${enc(claim)}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(`OAuth exchange failed ${r.status}: ${JSON.stringify(d)}`);
  _cache = { token: d.access_token, exp: iat + Number(d.expires_in || 3600), projectId: sa.project_id };
  return _cache;
}
function b64url(bytes: Uint8Array) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function importPrivateKey(pem: string) {
  const clean = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const der = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function rtdb(env: Record<string, string>, method: string, path: string, body?: unknown) {
  const { token } = await getAccessToken(env);
  const dbUrl = String(env.FIREBASE_DB_URL || DEFAULT_FIREBASE_DB_URL).trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(dbUrl)) throw new Error("Firebase database URL is invalid");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${dbUrl}${cleanPath}.json?access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) throw new Error(`RTDB ${method} ${cleanPath} → ${r.status}: ${await r.text().catch(() => "")}`);
  return method === "GET" ? r.json() : null;
}
async function tokenHash(token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const bytes = new Uint8Array(buf);
  let hex = ""; for (let i = 0; i < 12; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
function sanitizeData(o: Record<string, unknown>) {
  const out: Record<string, string> = {}; for (const [k, v] of Object.entries(o)) out[k] = String(v ?? "");
  return out;
}
async function sendOne(env: Record<string, string>, at: string, projectId: string, token: string, p: any) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const message = {
    token,
    notification: { title: p.title, body: p.body, ...(p.image ? { image: p.image } : {}) },
    data: sanitizeData({
      deepLink: p.deepLink || "/", contentId: p.contentId || "", contentType: p.contentType || "",
      seasonNumber: p.seasonNumber != null ? String(p.seasonNumber) : "",
      episodeNumber: p.episodeNumber != null ? String(p.episodeNumber) : "",
      image: p.image || "", title: p.title || "", body: p.body || "", sentAt: String(Date.now()),
    }),
    webpush: {
      headers: { Urgency: "high", TTL: "86400" },
      notification: {
        title: p.title, body: p.body,
        icon: p.icon || "/icon-192.png", badge: p.badge || "/icon-192.png",
        image: p.image || undefined,
        tag: p.tag || (p.contentId || "rsanime"), renotify: true,
      },
      fcm_options: { link: p.deepLink || "/" },
    },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${at}`, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}
function invalidTokenErr(status: number, body: any) {
  if (status === 404 || status === 400) {
    const c = body?.error?.details?.[0]?.errorCode || body?.error?.status;
    if (c === "UNREGISTERED" || c === "INVALID_ARGUMENT") return true;
  }
  return false;
}

Deno.serve(async (req) => {
  const env = Deno.env.toObject();
  const url = new URL(req.url);
  const origin = req.headers.get("Origin") || "";
  const cors = corsHeaders(origin, env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const path = url.pathname.replace(/^\/+/, "").split("/").pop() || "";

  try {
    let resp: Response;
    if (path === "health") {
      resp = json({ ok: true, service: "send-fcm" });
    } else if (path === "register" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const userId = String(b.userId || "").trim(); const token = String(b.token || "").trim();
      if (!userId || !token) resp = json({ ok: false, error: "userId+token required" }, 400);
      else {
        const h = await tokenHash(token); const now = Date.now();
        await rtdb(env, "PUT", `/fcmTokens/${encodeURIComponent(userId)}/${h}`, {
          token, createdAt: now, updatedAt: now, ua: String(b.ua || "").slice(0, 200),
        });
        resp = json({ ok: true, hash: h });
      }
    } else if (path === "unregister" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const userId = String(b.userId || "").trim(); const token = String(b.token || "").trim();
      if (!userId || !token) resp = json({ ok: false, error: "userId+token required" }, 400);
      else { await rtdb(env, "DELETE", `/fcmTokens/${encodeURIComponent(userId)}/${await tokenHash(token)}`); resp = json({ ok: true }); }
    } else if (path === "send" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const title = String(body.title || "").trim(); const msg = String(body.body || "").trim();
      if (!title || !msg) { resp = json({ ok: false, error: "title+body required" }, 400); }
      else {
        const { token: at, projectId } = await getAccessToken(env);
        const all = (await rtdb(env, "GET", "/fcmTokens").catch(() => null)) || {};
        const ttlMs = Math.max(1, Number(env.TOKEN_TTL_HOURS || DEFAULT_TTL_HOURS)) * 3600 * 1000;
        const cutoff = Date.now() - ttlMs;
        const filter = Array.isArray(body.userIds) && body.userIds.length ? new Set(body.userIds.map(String)) : null;
        const targets: { userId: string; hash: string; token: string }[] = [];
        for (const [uid, tm] of Object.entries<any>(all)) {
          if (filter && !filter.has(uid)) continue;
          for (const [h, row] of Object.entries<any>(tm || {})) {
            if (!row?.token || Number(row.updatedAt || row.createdAt || 0) < cutoff) continue;
            targets.push({ userId: uid, hash: h, token: row.token });
          }
        }
        let sent = 0, failed = 0, invalidRemoved = 0;
        const del: Record<string, null> = {};
        const errors: any[] = [];
        for (let i = 0; i < targets.length; i += FCM_BATCH_SIZE) {
          const chunk = targets.slice(i, i + FCM_BATCH_SIZE);
          const rs = await Promise.all(chunk.map((t) =>
            sendOne(env, at, projectId, t.token, body).catch((e) => ({ ok: false, status: 0, body: { error: String(e) } }))));
          for (let j = 0; j < rs.length; j++) {
            const r = rs[j], t = chunk[j];
            if (r.ok) sent++;
            else {
              failed++;
              if (invalidTokenErr(r.status, r.body)) { del[`fcmTokens/${t.userId}/${t.hash}`] = null; invalidRemoved++; }
              else if (errors.length < 5) errors.push({ status: r.status, error: r.body?.error?.message || String(r.body).slice(0, 200) });
            }
          }
        }
        if (invalidRemoved > 0) { try { await rtdb(env, "PATCH", "/", del); } catch { /* noop */ } }
        resp = json({ ok: true, total: targets.length, sent, failed, invalidRemoved, batches: Math.ceil(targets.length / FCM_BATCH_SIZE), errors });
      }
    } else if (path === "cleanup") {
      const ttl = Math.max(1, Number(env.TOKEN_TTL_HOURS || DEFAULT_TTL_HOURS));
      const cutoff = Date.now() - ttl * 3600 * 1000;
      const all = (await rtdb(env, "GET", "/fcmTokens").catch(() => null)) || {};
      const del: Record<string, null> = {}; let removed = 0, kept = 0;
      for (const [uid, tm] of Object.entries<any>(all)) for (const [h, row] of Object.entries<any>(tm || {})) {
        if (Number(row?.updatedAt || row?.createdAt || 0) < cutoff) { del[`fcmTokens/${uid}/${h}`] = null; removed++; } else kept++;
      }
      if (removed > 0) await rtdb(env, "PATCH", "/", del);
      resp = json({ ok: true, removed, kept, ttlHours: ttl });
    } else {
      resp = json({ ok: false, error: "Not found", hint: "/send /register /unregister /cleanup /health" }, 404);
    }
    const h = new Headers(resp.headers); for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(resp.body, { status: resp.status, headers: h });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { "content-type": "application/json", ...cors },
    });
  }
});
