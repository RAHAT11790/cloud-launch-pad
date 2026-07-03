// ============================================================
// Cloudflare Worker — shorten-arolinks (CF-native)
// Requires SECRET:  AROLINKS_API_KEY  (set in Worker → Settings → Variables)
// POST { url } → { success, shortenedUrl }
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    try {
      const key = (env.AROLINKS_API_KEY || "").trim();
      if (!key) return json({ error: "AROLINKS_API_KEY not configured" }, 500);
      const { url } = await req.json().catch(() => ({}));
      if (!url) return json({ error: "url is required" }, 400);
      const api = `https://arolinks.com/api?api=${encodeURIComponent(key)}&url=${encodeURIComponent(url)}`;
      const r = await fetch(api);
      const data = await r.json().catch(() => ({}));
      if (data.status === "success" && data.shortenedUrl) return json({ success: true, shortenedUrl: data.shortenedUrl });
      return json({ error: "Shortening failed", details: data }, 400);
    } catch (e) {
      return json({ error: e?.message || String(e) }, 500);
    }
  },
};
