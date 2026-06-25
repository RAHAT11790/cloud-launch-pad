// Returns the project's LOVABLE_API_KEY for admin tooling that needs to embed
// it in deployed EGD functions. Requires a Supabase service-role JWT in the
// Authorization header so only privileged callers (admin panel using service
// role) can retrieve the value.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function requireServiceRole(req: Request): { ok: boolean; reason?: string } {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "missing-bearer" };
  const expected = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!expected) return { ok: false, reason: "service-role-not-configured" };
  if (token.length !== expected.length) return { ok: false, reason: "invalid" };
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, reason: "invalid" };
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const gate = requireServiceRole(req);
  if (!gate.ok) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized", reason: gate.reason }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const key = Deno.env.get("LOVABLE_API_KEY") || "";
  return new Response(
    JSON.stringify({ ok: !!key, key, hint: key ? "ok" : "LOVABLE_API_KEY not configured" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
