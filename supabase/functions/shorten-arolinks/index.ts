
// ---- Live site domain: `settings/siteDomain`, written only by the email-service domain checker ----
const RS_SITE_DB = "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app";
let rsSiteMemo: { live: string; hosts: string[]; exp: number } = { live: "", hosts: [], exp: 0 };
async function rsSiteDomain() {
  if (rsSiteMemo.exp > Date.now()) return rsSiteMemo;
  rsSiteMemo.exp = Date.now() + 60000;
  try {
    const r = await fetch(`${RS_SITE_DB}/settings/siteDomain.json`, { signal: AbortSignal.timeout(2500) });
    const d = r.ok ? await r.json() : null;
    const hosts = d && d.hosts && typeof d.hosts === "object" ? Object.values(d.hosts).filter((h: any) => h && h.serving && typeof h.host === "string").map((h: any) => String(h.host).toLowerCase()) : [];
    const live = d && typeof d.live === "string" && /^https:\/\/[a-z0-9.-]+$/i.test(d.live) ? d.live : "";
    rsSiteMemo = { live, hosts, exp: Date.now() + 300000 };
  } catch { /* keep the previous answer */ }
  return rsSiteMemo;
}
const rsSiteHostOk = (u: unknown): boolean => { try { const x = new URL(String(u)); return x.protocol === "https:" && rsSiteMemo.hosts.includes(x.hostname.toLowerCase()); } catch { return false; } };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_HOST_RX = [
  /\.lovable\.app$/i,
  /\.lovableproject\.com$/i,
  /^rsanime03\.lovable\.app$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/i,
];
const matchesAllowedHost = (u: string | null) => {
  if (!u) return false;
  try { return ALLOWED_HOST_RX.some((rx) => rx.test(new URL(u).host)) || rsSiteHostOk(u); } catch { return false; }
};

Deno.serve(async (req) => {
  await rsSiteDomain();
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!matchesAllowedHost(origin) && !matchesAllowedHost(referer)) {
    return new Response(JSON.stringify({ error: "Access denied" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = (Deno.env.get("AROLINKS_API_KEY") || "").trim();
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AROLINKS_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { url } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiUrl = `https://arolinks.com/api?api=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(url)}`;
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
