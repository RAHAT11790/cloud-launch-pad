const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("VPLINK_API_KEY") || "ab26a97a3a3540c5be2ce837bd97526f8e76043d";
    const { url, alias } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiUrl = `https://vplink.in/api?api=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(url)}${alias ? `&alias=${encodeURIComponent(alias)}` : ""}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (data.status === "success" && data.shortenedUrl) {
      return new Response(JSON.stringify({ success: true, shortenedUrl: data.shortenedUrl }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Shortening failed", details: data }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
