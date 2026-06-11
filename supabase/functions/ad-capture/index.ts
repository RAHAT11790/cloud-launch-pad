// ad-capture — lightweight click/fire capture endpoint for the Adsterra
// direct-link + push-notification scripts running on the client.
//
// The client calls this with { kind, url, cycle, userId? } the moment an
// ad's window.open() hook fires. We just validate + log + return
// { ok: true } so the client can start its cooldown timer. No DB writes
// are required — kept intentionally cheap so it never throttles ads.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, service: "ad-capture" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const body = await req.json().catch(() => ({} as any));
    const kind = String(body?.kind || "");
    if (kind !== "popunder" && kind !== "social") {
      return new Response(JSON.stringify({ ok: false, error: "bad kind" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Optional: log to console for observability.
    try {
      console.log("[ad-capture]", JSON.stringify({
        kind,
        url: String(body?.url || "").slice(0, 200),
        cycle: body?.cycle ?? null,
        userId: body?.userId ?? null,
        ts: Date.now(),
      }));
    } catch {}
    return new Response(JSON.stringify({ ok: true, kind, ts: Date.now() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
