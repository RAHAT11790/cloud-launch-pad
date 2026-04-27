// EGD MANAGER — deploys arbitrary edge functions to this Supabase project
// using the Supabase Management API (PAT-based). Also manages per-function secrets.
//
// Routes (POST JSON):
//   /egd-deployer/list                              -> list functions
//   /egd-deployer/get      { slug }                 -> get function + body
//   /egd-deployer/deploy   { slug, code, secrets }  -> deploy/update + set secrets
//   /egd-deployer/delete   { slug }                 -> delete function
//   /egd-deployer/secrets  { slug }                 -> list secret names (project-wide)
//
// CORS open for browser admin panel use.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const PAT = Deno.env.get("EGD_SUPABASE_PAT") || "";
const PROJECT_REF =
  Deno.env.get("SUPABASE_PROJECT_REF") ||
  (Deno.env.get("SUPABASE_URL") || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ||
  "";

const MGMT = "https://api.supabase.com/v1";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function mgmt(path: string, init: RequestInit = {}) {
  const r = await fetch(`${MGMT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${PAT}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

async function listFunctions() {
  return mgmt(`/projects/${PROJECT_REF}/functions`);
}

async function getFunction(slug: string) {
  const meta = await mgmt(`/projects/${PROJECT_REF}/functions/${slug}`);
  if (!meta.ok) return meta;
  // body
  const bodyR = await fetch(`${MGMT}/projects/${PROJECT_REF}/functions/${slug}/body`, {
    headers: { Authorization: `Bearer ${PAT}` },
  });
  const body = await bodyR.text();
  return { ok: true, status: 200, data: { ...meta.data, body } };
}

async function deployFunction(slug: string, code: string) {
  // Try PATCH first; if 404, POST. Use the "deploy" endpoint that accepts a single index.ts via multipart.
  const form = new FormData();
  form.append(
    "metadata",
    new Blob(
      [JSON.stringify({ name: slug, verify_jwt: false, entrypoint_path: "index.ts" })],
      { type: "application/json" },
    ),
  );
  form.append("file", new Blob([code], { type: "application/typescript" }), "index.ts");

  const r = await fetch(
    `${MGMT}/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${PAT}` },
      body: form,
    },
  );
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

async function deleteFunction(slug: string) {
  return mgmt(`/projects/${PROJECT_REF}/functions/${slug}`, { method: "DELETE" });
}

async function setSecrets(secrets: { name: string; value: string }[]) {
  if (!secrets || secrets.length === 0) return { ok: true, status: 200, data: { skipped: true } };
  // Reserved prefixes the platform refuses
  const reserved = /^(SUPABASE_|SB_)/i;
  const clean = secrets
    .filter((s) => s && s.name && s.value !== undefined)
    .filter((s) => !reserved.test(s.name));
  if (clean.length === 0) return { ok: true, status: 200, data: { skipped: true } };
  return mgmt(`/projects/${PROJECT_REF}/secrets`, {
    method: "POST",
    body: JSON.stringify(clean),
  });
}

async function listSecrets() {
  return mgmt(`/projects/${PROJECT_REF}/secrets`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!PAT) return json({ ok: false, error: "EGD_SUPABASE_PAT secret not set" }, 500);
    if (!PROJECT_REF) return json({ ok: false, error: "Cannot resolve project ref" }, 500);

    const url = new URL(req.url);
    const tail = url.pathname.replace(/^\/+/, "").split("/");
    // expected: ["egd-deployer", "<action>"]
    const action = (tail[1] || "list").toLowerCase();

    let body: any = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }

    if (action === "list") {
      const r = await listFunctions();
      return json({ ok: r.ok, functions: r.data, error: r.ok ? undefined : r.data });
    }

    if (action === "get") {
      const slug = String(body.slug || "").trim();
      if (!slug) return json({ ok: false, error: "slug required" }, 400);
      const r = await getFunction(slug);
      return json({ ok: r.ok, fn: r.data, error: r.ok ? undefined : r.data });
    }

    if (action === "secrets") {
      const r = await listSecrets();
      const names = Array.isArray(r.data) ? r.data.map((s: any) => s.name) : [];
      return json({ ok: r.ok, names, error: r.ok ? undefined : r.data });
    }

    if (action === "deploy") {
      const slug = String(body.slug || "").trim().toLowerCase();
      const code = String(body.code || "");
      const secrets = Array.isArray(body.secrets) ? body.secrets : [];
      if (!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(slug)) {
        return json({ ok: false, error: "Invalid slug. Use lowercase letters, numbers, _ or -" }, 400);
      }
      if (!code.trim()) return json({ ok: false, error: "Code is empty" }, 400);

      // 1) Set secrets first (so function can read them on cold start)
      const sec = await setSecrets(secrets);
      if (!sec.ok) {
        return json({ ok: false, stage: "secrets", error: sec.data }, 200);
      }

      // 2) Deploy code
      const dep = await deployFunction(slug, code);
      if (!dep.ok) {
        return json({ ok: false, stage: "deploy", error: dep.data, status: dep.status }, 200);
      }

      const supaUrl = Deno.env.get("SUPABASE_URL") || `https://${PROJECT_REF}.supabase.co`;
      const fnUrl = `${supaUrl}/functions/v1/${slug}`;
      return json({
        ok: true,
        slug,
        url: fnUrl,
        deployed: dep.data,
        secretsApplied: secrets.filter((s: any) => s?.name && !/^(SUPABASE_|SB_)/i.test(s.name)).map((s: any) => s.name),
      });
    }

    if (action === "delete") {
      const slug = String(body.slug || "").trim();
      if (!slug) return json({ ok: false, error: "slug required" }, 400);
      const r = await deleteFunction(slug);
      return json({ ok: r.ok, error: r.ok ? undefined : r.data });
    }

    return json({ ok: false, error: "Unknown action" }, 404);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
