// verify-admin-pin — Server-side admin PIN verification.
// PIN is stored ONLY as the ADMIN_PIN Lovable Cloud secret; never in
// Firebase RTDB (which is world-readable to any authenticated user).
// Client posts { pin } and receives { ok: boolean }. Timing-safe compare.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const body = await req.json().catch(() => ({} as any));
    if (body?.test === true) {
      return new Response(JSON.stringify({ ok: true, ping: "verify-admin-pin" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const pin = String(body?.pin ?? "").trim();
    const expected = (Deno.env.get("ADMIN_PIN") || "").trim();
    if (!expected) {
      return new Response(JSON.stringify({ ok: false, error: "ADMIN_PIN not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!pin || pin.length < 4 || pin.length > 32) {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ok = timingSafeEqual(pin, expected);
    return new Response(JSON.stringify({ ok }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
