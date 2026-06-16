// This is the source code of the EGD Deployer edge function.
// User copies this from EGD MANAGER UI and deploys it manually to their own
// Supabase project. After deploy, they paste the resulting function URL into
// EGD MANAGER which will then use it to deploy further edge functions.
//
// Required secret in target project: EGD_SUPABASE_PAT
//   (a Supabase Personal Access Token from an account that owns the project)
// Required setting: Verify JWT = OFF
//
// Endpoints (POST JSON):
//   /list                              -> list functions
//   /get      { slug }                 -> get function metadata + body
//   /deploy   { slug, code, secrets }  -> deploy/update + set secrets
//   /delete   { slug }                 -> delete function
//   /secrets                           -> list project secret names
//   /secret-update { name, value }      -> update one project secret value
//   /secret-delete { names:[name] }     -> delete project secret values

export const EGD_DEPLOYER_CODE = String.raw`// EGD Deployer — deploys arbitrary edge functions to THIS Supabase project
// using the Supabase Management API.
//
// SETUP (in Supabase Dashboard):
//   1. Add secret: EGD_SUPABASE_PAT  (PAT from account that owns this project)
//   2. Deploy this function with Verify JWT = OFF
//
// Routes:
//   POST /list
//   POST /get      { slug }
//   POST /deploy   { slug, code, secrets:[{name,value}] }
//   POST /delete   { slug }
//   POST /secrets
//   POST /secret-update { name, value }
//   POST /secret-delete { names:[name] }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const PAT = Deno.env.get("EGD_SUPABASE_PAT") || "";
const PROJECT_REF =
  Deno.env.get("SUPABASE_PROJECT_REF") ||
  (Deno.env.get("SUPABASE_URL") || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ||
  "";

const MGMT = "https://api.supabase.com/v1";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function mgmt(path, init = {}) {
  const r = await fetch(MGMT + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + PAT,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

async function listFunctions() {
  return mgmt("/projects/" + PROJECT_REF + "/functions");
}

async function getFunction(slug) {
  const meta = await mgmt("/projects/" + PROJECT_REF + "/functions/" + slug);
  if (!meta.ok) return meta;
  const bodyR = await fetch(MGMT + "/projects/" + PROJECT_REF + "/functions/" + slug + "/body", {
    headers: { Authorization: "Bearer " + PAT },
  });
  const body = await bodyR.text();
  return {
    ok: true,
    status: 200,
    data: {
      ...meta.data,
      body,
      contentType: bodyR.headers.get("content-type") || "",
    },
  };
}

async function deployFunction(slug, code) {
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
    MGMT + "/projects/" + PROJECT_REF + "/functions/deploy?slug=" + encodeURIComponent(slug),
    { method: "POST", headers: { Authorization: "Bearer " + PAT }, body: form },
  );
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

async function deleteFunction(slug) {
  return mgmt("/projects/" + PROJECT_REF + "/functions/" + slug, { method: "DELETE" });
}

async function setSecrets(secrets) {
  if (!secrets || secrets.length === 0) return { ok: true, status: 200, data: { skipped: true } };
  const reserved = /^(SUPABASE_|SB_)/i;
  const clean = secrets
    .filter((s) => s && s.name && s.value !== undefined)
    .filter((s) => !reserved.test(s.name));
  if (clean.length === 0) return { ok: true, status: 200, data: { skipped: true } };
  return mgmt("/projects/" + PROJECT_REF + "/secrets", {
    method: "POST",
    body: JSON.stringify(clean),
  });
}

async function updateOneSecret(name, value) {
  return setSecrets([{ name, value }]);
}

async function deleteSecrets(names) {
  const clean = (Array.isArray(names) ? names : [names])
    .map((n) => String(n || "").trim())
    .filter((n) => n && !/^(SUPABASE_|SB_)/i.test(n));
  if (clean.length === 0) return { ok: false, status: 400, data: "secret name required" };
  return mgmt("/projects/" + PROJECT_REF + "/secrets", {
    method: "DELETE",
    body: JSON.stringify(clean),
  });
}

async function listSecrets() {
  return mgmt("/projects/" + PROJECT_REF + "/secrets");
}

async function queryLogs(slug, minutes, startAt, endAt) {
  const safeMinutes = Math.min(Math.max(Number(minutes) || 60, 1), 1440);
  const endCandidate = endAt ? new Date(endAt) : new Date();
  const end = Number.isNaN(endCandidate.getTime()) ? new Date() : endCandidate;
  const startCandidate = startAt ? new Date(startAt) : new Date(end.getTime() - safeMinutes * 60 * 1000);
  const start = Number.isNaN(startCandidate.getTime()) ? new Date(end.getTime() - safeMinutes * 60 * 1000) : startCandidate;
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const slugFilter = String(slug || "").trim();
  const escapedSlug = slugFilter.replace(/'/g, "\\'").replace(/%/g, "\\%").replace(/_/g, "\\_");

  const where = slugFilter
    ? "where to_json_string(metadata) like '%" + escapedSlug + "%' escape '\\'"
    : "";

  const sql = [
    "select timestamp, event_message, 'function_logs' as source",
    "from function_logs",
    where,
    "union all",
    "select timestamp, event_message, 'function_edge_logs' as source",
    "from function_edge_logs",
    where,
    "order by timestamp desc",
    "limit 200",
  ].filter(Boolean).join("\n");

  const params = new URLSearchParams({
    iso_timestamp_start: startIso,
    iso_timestamp_end: endIso,
    sql,
  });

  return mgmt("/projects/" + PROJECT_REF + "/analytics/endpoints/logs.all?" + params.toString());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!PAT) return json({ ok: false, error: "EGD_SUPABASE_PAT secret not set" }, 500);
    if (!PROJECT_REF) return json({ ok: false, error: "Cannot resolve project ref" }, 500);

    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    const action = (parts[parts.length - 1] || "list").toLowerCase();

    let body = {};
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
      const names = Array.isArray(r.data) ? r.data.map((s) => s.name) : [];
      return json({ ok: r.ok, names, error: r.ok ? undefined : r.data });
    }

    if (action === "secret-update") {
      const name = String(body.name || "").trim();
      const value = String(body.value || "");
      if (!name || !value) return json({ ok: false, error: "name and value required" }, 400);
      const r = await updateOneSecret(name, value);
      return json({ ok: r.ok, error: r.ok ? undefined : r.data, status: r.status });
    }

    if (action === "secret-delete") {
      const r = await deleteSecrets(body.names || body.name);
      return json({ ok: r.ok, error: r.ok ? undefined : r.data, status: r.status });
    }

    if (action === "logs") {
      const r = await queryLogs(body.slug, body.minutes, body.startAt, body.endAt);
      const rows = Array.isArray(r.data?.result) ? r.data.result : [];
      return json({ ok: r.ok, rows, error: r.ok ? undefined : r.data?.error || r.data });
    }

    if (action === "deploy") {
      const slug = String(body.slug || "").trim().toLowerCase();
      const code = String(body.code || "");
      const secrets = Array.isArray(body.secrets) ? body.secrets : [];
      if (!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(slug)) {
        return json({ ok: false, error: "Invalid slug. Use lowercase letters, numbers, _ or -" }, 400);
      }
      if (!code.trim()) return json({ ok: false, error: "Code is empty" }, 400);

      const sec = await setSecrets(secrets);
      if (!sec.ok) return json({ ok: false, stage: "secrets", error: sec.data }, 200);

      const dep = await deployFunction(slug, code);
      if (!dep.ok) return json({ ok: false, stage: "deploy", error: dep.data, status: dep.status }, 200);

      const supaUrl = Deno.env.get("SUPABASE_URL") || ("https://" + PROJECT_REF + ".supabase.co");
      return json({
        ok: true,
        slug,
        url: supaUrl + "/functions/v1/" + slug,
        deployed: dep.data,
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
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
});
`;
