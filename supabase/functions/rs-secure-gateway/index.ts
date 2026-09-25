// @ts-nocheck
// RS Secure Gateway — Admin writes to Firebase RTDB via service account.
// Deploy on YOUR OWN Cloudflare / Supabase (never Lovable Cloud).
// Secrets: FIREBASE_SERVICE_ACCOUNT_KEY (JSON), FIREBASE_API_KEY, FIREBASE_DB_URL,
//          ADMIN_EMAILS (comma list), ADMIN_PIN, ALLOWED_ORIGINS (comma list)
// POST {action:"adminWrite", op:"set"|"update"|"remove", path, value, pin}
//      header Authorization: Bearer <Firebase ID token>
const hits = new Map();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const enc = (s) => new TextEncoder().encode(s);
let tokCache = { t: "", exp: 0 };
async function accessToken(sa) {
  if (tokCache.exp > Date.now() + 60000) return tokCache.t;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(enc(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64u(enc(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc(`${head}.${claim}`)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${head}.${claim}.${sig}` });
  const j = await r.json();
  if (!j.access_token) throw new Error("service account auth failed");
  tokCache = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokCache.t;
}
function safeEq(a, b) { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; }
async function handle(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const okOrigin = allowed.includes(origin);
  const cors = { "access-control-allow-origin": okOrigin ? origin : "null", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS", "vary": "origin" };
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
  if (!okOrigin) return json({ error: "origin" }, 403);
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "x";
  const h = hits.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - h.t > 60000) { h.n = 0; h.t = Date.now(); }
  if (++h.n > 60) return json({ error: "rate limited" }, 429);
  hits.set(ip, h);
  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) return json({ error: "login required" }, 401);
  const lk = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  const user = (await lk.json()).users?.[0];
  if (!user) return json({ error: "invalid session" }, 401);
  let body; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (body?.action !== "adminWrite") return json({ error: "unknown action" }, 400);
  const admins = String(env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim());
  if (!user.emailVerified && !user.providerUserInfo?.length) return json({ error: "email not verified" }, 403);
  if (!admins.includes(String(user.email || "").toLowerCase())) return json({ error: "not admin" }, 403);
  if (!env.ADMIN_PIN || !safeEq(body.pin || "", env.ADMIN_PIN)) return json({ error: "bad pin" }, 403);
  const path = String(body.path || "");
  if (!/^[A-Za-z0-9_\-\/]{1,300}$/.test(path) || path.includes("..")) return json({ error: "bad path" }, 400);
  const op = body.op; const method = op === "set" ? "PUT" : op === "update" ? "PATCH" : op === "remove" ? "DELETE" : "";
  if (!method) return json({ error: "bad op" }, 400);
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
  const at = await accessToken(sa);
  const db = String(env.FIREBASE_DB_URL).replace(/\/+$/, "");
  const r = await fetch(`${db}/${path}.json`, { method, headers: { authorization: `Bearer ${at}`, "content-type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(body.value ?? null) });
  await fetch(`${db}/securityLogs/adminWrites.json`, { method: "POST", headers: { authorization: `Bearer ${at}` }, body: JSON.stringify({ email: user.email, op, path, ip, at: Date.now() }) }).catch(() => {});
  return json({ ok: r.ok }, r.ok ? 200 : 502);
}
const keys=["FIREBASE_SERVICE_ACCOUNT_KEY","FIREBASE_API_KEY","FIREBASE_DB_URL","ADMIN_EMAILS","ADMIN_PIN","ALLOWED_ORIGINS"];
Deno.serve((req) => handle(req, Object.fromEntries(keys.map((k) => [k, Deno.env.get(k) || ""]))));
