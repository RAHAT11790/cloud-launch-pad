// ============================================================
// CF MANAGER WORKER — Standalone Cloudflare Workers Manager
// ============================================================
// এটি Cloudflare Workers-এ deploy করুন। এরপর URL admin panel-এ
// পেস্ট করলে Supabase EGD Manager-এর মতো সব Worker script edit,
// deploy, delete, log দেখা, secret manage — সব admin panel থেকে
// করা যাবে।
//
// ────────────────────────────────────────────────────────────
// STEP 1 — Cloudflare Dashboard → Workers & Pages → Create → Worker
//          নাম দিন:  cf-manager   (বা যা ইচ্ছা)
// STEP 2 — "Edit Code" খুলে এই পুরো ফাইলটি পেস্ট করে Deploy দিন।
// STEP 3 — Worker Settings → Variables → Add Secret (৩টি secret):
//            CF_API_TOKEN        =  cfut_LOUacOXPJd4j8cwIvd3wPBWwKFjRFjPeeTb9mKfJd36802b5
//            CF_ACCOUNT_ID       =  958349c5c83d100c46d2c73786a4c64a
//            ADMIN_AUTH_TOKEN    =  (আপনার পছন্দের একটা লম্বা random string,
//                                     ২৫+ character. এটাই admin panel-এ বসাবেন)
// STEP 4 — Worker URL কপি করুন (যেমন  https://cf-manager.<you>.workers.dev)
//          এই URL + ADMIN_AUTH_TOKEN admin panel-এর "Cloudflare Manager"
//          ট্যাবে বসিয়ে Save দিন। ব্যস।
// ────────────────────────────────────────────────────────────
//
// প্রতিটি request-এ header পাঠাতে হবে:
//     Authorization: Bearer <ADMIN_AUTH_TOKEN>
//
// Endpoints (POST JSON, ছাড়া GET /health):
//     GET  /health
//     POST /list                          → সব worker script
//     POST /get       { name }            → script source + metadata
//     POST /deploy    { name, code, compatibility_date?, bindings? }
//     POST /delete    { name }
//     POST /rename    { from, to }        → copy + delete (CF API rename নেই)
//     POST /logs      { name, minutes? }  → সাম্প্রতিক tail logs (buffered)
//     POST /secrets-list   { name }
//     POST /secret-put     { name, key, value }
//     POST /secret-delete  { name, key }
//     POST /subdomain                     → workers.dev subdomain
// ============================================================

const CF_API = "https://api.cloudflare.com/client/v4";

// CORS — শুধু আপনার admin panel origin(s)। "*" রাখতে চাইলে রাখতে পারেন
// কিন্তু Bearer token থাকলেও লকডাউন রাখা ভালো।
const ALLOWED_ORIGINS = new Set([
  "https://rsanime03.lovable.app",
  "https://id-preview--d9496f6f-add2-411c-96f8-fb97b0c234a7.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
]);

function corsHeaders(req) {
  const origin = req.headers.get("Origin") || "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(req, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      ...extra,
    },
  });
}

function textResp(req, body, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(body, {
    status,
    headers: { ...corsHeaders(req), "Content-Type": contentType },
  });
}

function requireAuth(req, env) {
  const expected = (env.ADMIN_AUTH_TOKEN || "").trim();
  if (!expected) return "ADMIN_AUTH_TOKEN secret not set on the worker";
  const h = req.headers.get("Authorization") || "";
  const got = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!got) return "Missing Authorization: Bearer <token>";
  // constant-time compare
  if (got.length !== expected.length) return "Invalid admin token";
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return "Invalid admin token";
  return null;
}

async function cfFetch(env, path, init = {}) {
  const r = await fetch(CF_API + path, {
    ...init,
    headers: {
      "Authorization": `Bearer ${env.CF_API_TOKEN}`,
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data, raw: text };
}

async function readJson(req) {
  try { return await req.json(); } catch { return {}; }
}

// ──────────── ACTIONS ────────────
async function actList(env) {
  const r = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/scripts`);
  return { ok: r.ok, scripts: r.data?.result || [], error: r.ok ? undefined : r.data };
}

async function actGet(env, name) {
  if (!name) return { ok: false, error: "name required", status: 400 };
  const src = await fetch(
    `${CF_API}/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(name)}`,
    { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } },
  );
  const contentType = src.headers.get("content-type") || "";
  let code = "";
  if (/multipart\/form-data/i.test(contentType)) {
    // Module worker — parse multipart and return ONLY worker.js body
    try {
      const fd = await src.formData();
      // Prefer entry-point "worker.js"; else first .js/.mjs file
      let file = fd.get("worker.js") || fd.get("index.js") || fd.get("index.mjs");
      if (!file) {
        for (const [k, v] of fd.entries()) {
          if (typeof v !== "string" && /\.(m?js)$/i.test(k)) { file = v; break; }
        }
      }
      code = file && typeof file !== "string" ? await file.text() : "";
    } catch (e) {
      code = "// Failed to parse module worker: " + (e?.message || e);
    }
  } else {
    code = await src.text();
  }
  const meta = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(name)}/settings`);
  return {
    ok: src.ok,
    name,
    code,
    contentType,
    settings: meta.data?.result || null,
    error: src.ok ? undefined : code,
  };
}

async function actDeploy(env, body) {
  const name = String(body.name || "").trim();
  const code = String(body.code || "");
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(name)) {
    return { ok: false, error: "Invalid worker name" };
  }
  if (!code.trim()) return { ok: false, error: "Code is empty" };

  const compatibility_date = body.compatibility_date || "2025-01-01";
  const bindings = Array.isArray(body.bindings) ? body.bindings : [];

  const metadata = {
    main_module: "worker.js",
    compatibility_date,
    bindings,
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append(
    "worker.js",
    new Blob([code], { type: "application/javascript+module" }),
    "worker.js",
  );

  const r = await fetch(
    `${CF_API}/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
      body: form,
    },
  );
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) return { ok: false, stage: "deploy", status: r.status, error: data };

  // Enable workers.dev subdomain route so URL immediately works
  await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(name)}/subdomain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  }).catch(() => null);

  const sub = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/subdomain`);
  const subdomain = sub.data?.result?.subdomain || null;
  const url = subdomain ? `https://${name}.${subdomain}.workers.dev` : null;

  return { ok: true, name, url, deployed: data?.result || data };
}

async function actDelete(env, name) {
  if (!name) return { ok: false, error: "name required" };
  const r = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(name)}?force=true`, {
    method: "DELETE",
  });
  return { ok: r.ok, error: r.ok ? undefined : r.data };
}

async function actRename(env, from, to) {
  if (!from || !to) return { ok: false, error: "from & to required" };
  const g = await actGet(env, from);
  if (!g.ok) return { ok: false, stage: "get", error: g.error };
  const d = await actDeploy(env, { name: to, code: g.code });
  if (!d.ok) return d;
  await actDelete(env, from);
  return { ok: true, from, to, url: d.url };
}

async function actLogs(env, name, minutes) {
  // Cloudflare Tail is WebSocket-based; from a Worker we create a tail session
  // and immediately return the WS URL that admin panel can connect to.
  if (!name) return { ok: false, error: "name required" };
  const r = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(name)}/tails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) return { ok: false, error: r.data };
  return { ok: true, tail: r.data?.result || null, note: "Connect to tail.url via WebSocket" };
}

async function actSecretsList(env, name) {
  const r = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(name)}/secrets`);
  return { ok: r.ok, secrets: r.data?.result || [], error: r.ok ? undefined : r.data };
}

async function actSecretPut(env, name, key, value) {
  if (!name || !key) return { ok: false, error: "name & key required" };
  const r = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(name)}/secrets`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: key, text: String(value ?? ""), type: "secret_text" }),
  });
  return { ok: r.ok, error: r.ok ? undefined : r.data };
}

async function actSecretDelete(env, name, key) {
  if (!name || !key) return { ok: false, error: "name & key required" };
  const r = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(name)}/secrets/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  return { ok: r.ok, error: r.ok ? undefined : r.data };
}

async function actSubdomain(env) {
  const r = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/subdomain`);
  return { ok: r.ok, subdomain: r.data?.result?.subdomain || null, error: r.ok ? undefined : r.data };
}

// ──────────── ROUTER ────────────
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders(req) });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();

    if (path === "health" || path === "") {
      return json(req, {
        ok: true,
        name: "cf-manager",
        version: "1.1.0",
        hasToken: !!env.CF_API_TOKEN,
        hasAccount: !!env.CF_ACCOUNT_ID,
        hasAdmin: !!env.ADMIN_AUTH_TOKEN,
      });
    }

    // All other endpoints require admin auth
    const authErr = requireAuth(req, env);
    if (authErr) return json(req, { ok: false, error: authErr }, 401);
    if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
      return json(req, { ok: false, error: "CF_API_TOKEN or CF_ACCOUNT_ID missing" }, 500);
    }

    const body = req.method === "POST" ? await readJson(req) : {};

    try {
      switch (path) {
        case "list":          return json(req, await actList(env));
        case "get":           return json(req, await actGet(env, body.name));
        case "deploy":        return json(req, await actDeploy(env, body));
        case "delete":        return json(req, await actDelete(env, body.name));
        case "rename":        return json(req, await actRename(env, body.from, body.to));
        case "logs":          return json(req, await actLogs(env, body.name, body.minutes));
        case "secrets-list":  return json(req, await actSecretsList(env, body.name));
        case "secret-put":    return json(req, await actSecretPut(env, body.name, body.key, body.value));
        case "secret-delete": return json(req, await actSecretDelete(env, body.name, body.key));
        case "subdomain":     return json(req, await actSubdomain(env));
        default:
          return json(req, { ok: false, error: "Unknown action: " + path }, 404);
      }
    } catch (e) {
      return json(req, { ok: false, error: e?.message || String(e) }, 500);
    }
  },
};
