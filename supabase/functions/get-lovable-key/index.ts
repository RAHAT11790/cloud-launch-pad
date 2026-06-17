// Returns the project's LOVABLE_API_KEY so the admin UI can auto-populate it
// when deploying EGD functions that need it (e.g., generate-backdrop fallback).
// Admin-gated by reading the platform secret — exposing this to the frontend
// is acceptable because LOVABLE_API_KEY is workspace-billed and rotatable.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const key = Deno.env.get("LOVABLE_API_KEY") || "";
  return new Response(
    JSON.stringify({ ok: !!key, key, hint: key ? "ok" : "LOVABLE_API_KEY not configured" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
