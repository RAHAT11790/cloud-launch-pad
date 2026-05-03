// ============================================
// ALL-IN-ONE EDGE ROUTER
// ============================================
// Single entry point that proxies requests to all other edge functions in this
// project. Lets the admin panel point at ONE URL and access every backend
// feature: telegram bots, mini-app, stream proxy, email OTP, APK download, etc.
//
// Routing:
//   - URL path:    /all-in-one/<target>/<rest>   →   /<target>/<rest>
//   - URL path:    /all-in-one?target=<name>     →   /<name>
//   - JSON body:   { target: "<name>", ... }     →   /<name>  (body forwarded as-is)
//
// Special endpoints:
//   GET  /all-in-one/health        → health check + list of registered functions
//   POST /all-in-one/ping          → ping every function and return per-function status
//   GET  /all-in-one               → service info / usage instructions

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// All functions registered in this project. Keep in sync with /supabase/functions/.
const REGISTERED = [
  "access-bot",
  "apk-download",
  "link-share-bot",
  "mini-app",
  "process-email-queue",
  "rs-bot",
  "send-otp-email",
  "stream-proxy",
  "telegram-post",
] as const;

type FnName = typeof REGISTERED[number];
const REGISTERED_SET = new Set<string>(REGISTERED);

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ||
  `https://${Deno.env.get("SUPABASE_PROJECT_ID") || ""}.supabase.co`;

const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

function buildTargetUrl(target: string, rest: string, search: string): string {
  const cleanRest = rest.replace(/^\/+/, "");
  const path = cleanRest ? `${target}/${cleanRest}` : target;
  return `${SUPABASE_URL}/functions/v1/${path}${search || ""}`;
}

async function forward(target: string, rest: string, req: Request): Promise<Response> {
  if (!REGISTERED_SET.has(target)) {
    return json(
      {
        ok: false,
        error: "unknown_target",
        target,
        registered: REGISTERED,
      },
      404,
    );
  }

  const url = new URL(req.url);
  const targetUrl = buildTargetUrl(target, rest, url.search);

  // Build forwarded headers — strip hop-by-hop and CORS-controlled ones,
  // keep body/auth/content-type intact.
  const fwdHeaders = new Headers();
  for (const [k, v] of req.headers.entries()) {
    const lower = k.toLowerCase();
    if (
      lower === "host" ||
      lower === "content-length" ||
      lower === "connection" ||
      lower === "accept-encoding" ||
      lower === "transfer-encoding" ||
      lower.startsWith("cf-") ||
      lower.startsWith("x-forwarded-")
    ) continue;
    fwdHeaders.set(k, v);
  }

  // Internal calls between edge functions must include an Authorization
  // header, otherwise Supabase will reject them with 401.
  if (!fwdHeaders.has("authorization") && (SERVICE_ROLE || ANON_KEY)) {
    fwdHeaders.set("authorization", `Bearer ${SERVICE_ROLE || ANON_KEY}`);
  }
  if (!fwdHeaders.has("apikey") && (SERVICE_ROLE || ANON_KEY)) {
    fwdHeaders.set("apikey", SERVICE_ROLE || ANON_KEY);
  }

  // For methods that may carry a body, read it as a buffer so we can re-send.
  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers: fwdHeaders,
    body,
  });

  // Stream upstream body back; merge CORS headers so browsers can read.
  const respHeaders = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(cors)) respHeaders.set(k, v);
  // Don't leak hop-by-hop headers from upstream
  respHeaders.delete("transfer-encoding");
  respHeaders.delete("content-length");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

async function pingAll(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Allow caller to override timeout (?timeout=ms, default 6000)
  const timeoutMs = Math.max(
    1000,
    Math.min(15000, Number(url.searchParams.get("timeout")) || 6000),
  );

  const checks = await Promise.all(
    REGISTERED.map(async (name) => {
      const t0 = Date.now();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        // Use OPTIONS for a cheap health probe — every function handles it for CORS.
        const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
          method: "OPTIONS",
          signal: ctrl.signal,
          headers: SERVICE_ROLE
            ? { authorization: `Bearer ${SERVICE_ROLE}` }
            : ANON_KEY
            ? { authorization: `Bearer ${ANON_KEY}` }
            : {},
        });
        clearTimeout(timer);
        const ms = Date.now() - t0;
        return {
          name,
          ok: r.ok || r.status === 204 || r.status === 200,
          status: r.status,
          ms,
        };
      } catch (e: any) {
        return {
          name,
          ok: false,
          status: 0,
          ms: Date.now() - t0,
          error: e?.name === "AbortError" ? "timeout" : (e?.message || "error"),
        };
      }
    }),
  );

  const summary = {
    ok: true,
    checkedAt: new Date().toISOString(),
    timeoutMs,
    total: checks.length,
    healthy: checks.filter((c) => c.ok).length,
    down: checks.filter((c) => !c.ok).length,
    functions: checks,
  };
  return json(summary);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = new URL(req.url);
  // Path is something like /all-in-one or /all-in-one/<target>/<rest>
  const segments = url.pathname.split("/").filter(Boolean);
  // Drop the function name itself ("all-in-one") if present
  const idx = segments.indexOf("all-in-one");
  const tail = idx >= 0 ? segments.slice(idx + 1) : segments;

  const firstSeg = tail[0] || "";
  const restSegs = tail.slice(1);
  const restPath = restSegs.join("/");

  // ---- Service info ----
  if (!firstSeg) {
    // No body: explain. With body: try to read `target` from body for POST.
    if (req.method === "POST") {
      try {
        const cloned = req.clone();
        const body = await cloned.json().catch(() => null);
        if (body && typeof body.target === "string" && body.target) {
          // Re-create request with cleaned body so target isn't double-handled
          return await forward(body.target, "", req);
        }
      } catch {}
    }
    // Allow ?target=<name> as another routing style
    const qTarget = url.searchParams.get("target");
    if (qTarget) return await forward(qTarget, "", req);

    return json({
      ok: true,
      service: "all-in-one",
      version: "1.0.0",
      registered: REGISTERED,
      usage: {
        path: "POST /all-in-one/<target>/<rest>",
        query: "POST /all-in-one?target=<name>",
        body: 'POST /all-in-one  {"target": "<name>", ...}',
        health: "GET  /all-in-one/health",
        ping:   "POST /all-in-one/ping",
      },
    });
  }

  // ---- Built-in endpoints ----
  if (firstSeg === "health") {
    return json({
      ok: true,
      service: "all-in-one",
      registered: REGISTERED,
      checkedAt: new Date().toISOString(),
    });
  }
  if (firstSeg === "ping") {
    return await pingAll(req);
  }

  // ---- Forward to a registered function ----
  return await forward(firstSeg, restPath, req);
});
