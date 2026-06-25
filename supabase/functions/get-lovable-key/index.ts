// Returns the project's LOVABLE_API_KEY for admin tooling that needs to embed
// it in deployed EGD functions. Gated by the ADMIN_PIN secret — callers must
// pass `x-admin-pin: <pin>` after authenticating against verify-admin-pin.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const ADMIN_HEADERS = "authorization, x-client-info, apikey, content-type, x-admin-pin";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Headers": ADMIN_HEADERS } });
  }
  const supplied = (req.headers.get("x-admin-pin") || "").trim();
  const expected = (Deno.env.get("ADMIN_PIN") || "").trim();
  if (!expected || !supplied || !timingSafeEqual(supplied, expected)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const key = Deno.env.get("LOVABLE_API_KEY") || "";
  return new Response(
    JSON.stringify({ ok: !!key, key, hint: key ? "ok" : "LOVABLE_API_KEY not configured" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
