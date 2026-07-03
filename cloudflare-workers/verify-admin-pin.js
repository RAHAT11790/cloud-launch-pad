// ============================================================
// Cloudflare Worker port of Supabase Edge Function: verify-admin-pin
// Ported automatically — replace CF_URL in EGD/Cloudflare Manager
// ============================================================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
var stdin_default = { async fetch(req, env, ctx) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.test === true) {
      return new Response(JSON.stringify({ ok: true, ping: "verify-admin-pin" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const pin = String(body?.pin ?? "").trim();
    const expected = (env.ADMIN_PIN || "").trim();
    if (!expected) {
      return new Response(JSON.stringify({ ok: false, error: "ADMIN_PIN not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (!pin || pin.length < 4 || pin.length > 32) {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const ok = timingSafeEqual(pin, expected);
    return new Response(JSON.stringify({ ok }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
} };
export {
  stdin_default as default
};
