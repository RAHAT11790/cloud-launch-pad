// ============================================================
// RS ANIME — ADSTERRA STATS (Cloudflare build) · v1
// ------------------------------------------------------------
// Reads your Adsterra Publisher API (impressions, clicks, CPM,
// revenue by date / placement / country / domain) for the admin
// panel → Ad Manager → Adsterra Analytics page.
//
// Deploy from Cloudflare Manager, set the secret ADSTERRA_API_KEY
// (Adsterra → Publisher → API → token), then paste the Worker URL
// into Admin → EGD Router → `adsterra-stats` and Save.
//
// Same request/response shape as the Lovable copy, so the admin
// page works with either URL.
//   POST { action: "overview", start, finish }
//   POST { action: "stats", start, finish, group_by: ["date"] }
//   POST { action: "meta" }
//   GET  (no body)  → health JSON
// ============================================================

const API_BASE = "https://api3.adsterratools.com/publisher";
const ALLOWED_GROUPS = new Set(["date", "placement", "country", "domain"]);
const CACHE_SECONDS = 120; // Adsterra updates stats every few minutes

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", "x-rs-edge": "adsterra-stats-cf-v1", ...extra },
  });

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function call(path, key, qs, ctx) {
  const target = `${API_BASE}/${path}${qs ? `?${qs}` : ""}`;
  // Short edge cache keyed by the URL only (the key never leaves the worker).
  const cacheKey = new Request(`https://adsterra-stats.cache/${path}?${qs || ""}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit.json();
    } catch {}
  }
  const res = await fetch(target, { headers: { "X-API-Key": key, Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Adsterra ${path} ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Adsterra ${path}: invalid JSON`); }
  if (cache && ctx) {
    try {
      ctx.waitUntil(cache.put(cacheKey, new Response(text, {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
      })));
    } catch {}
  }
  return data;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const key = env.ADSTERRA_API_KEY;
    const url = new URL(req.url);

    let body = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }
    const action = String(body.action ?? url.searchParams.get("action") ?? (req.method === "GET" ? "health" : "overview"));

    if (action === "health" || action === "ping") {
      return json({ ok: true, service: "adsterra-stats", edge: "cf-v1", keyConfigured: !!key });
    }
    if (!key) return json({ error: "ADSTERRA_API_KEY is not configured in this Worker" }, 500);

    try {
      if (action === "meta") {
        const [domains, placements] = await Promise.all([
          call("domains.json", key, "", ctx),
          call("placements.json", key, "", ctx),
        ]);
        return json({ domains: domains.items ?? [], placements: placements.items ?? [] });
      }

      const start = isDate(body.start) ? body.start : url.searchParams.get("start");
      const finish = isDate(body.finish) ? body.finish : url.searchParams.get("finish");
      if (!isDate(start) || !isDate(finish)) {
        return json({ error: "start and finish must be YYYY-MM-DD" }, 400);
      }

      const build = (groups) => {
        const qs = new URLSearchParams({ start_date: start, finish_date: finish });
        groups.forEach((g) => qs.append("group_by[]", g));
        return call("stats.json", key, qs.toString(), ctx);
      };

      if (action === "stats") {
        const groups = Array.isArray(body.group_by)
          ? body.group_by.filter((g) => typeof g === "string" && ALLOWED_GROUPS.has(g))
          : ["date"];
        const data = await build(groups.length ? groups : ["date"]);
        return json({ items: data.items ?? [], lastUpdate: data.dbLastUpdateTime ?? null });
      }

      if (action === "overview") {
        const [byDate, byPlacement, byCountry, byDomain, meta, placements] = await Promise.all([
          build(["date", "placement"]),
          build(["placement"]),
          build(["country", "placement"]),
          build(["domain"]),
          call("domains.json", key, "", ctx),
          call("placements.json", key, "", ctx),
        ]);
        return json({
          byDate: byDate.items ?? [],
          byPlacement: byPlacement.items ?? [],
          byCountry: byCountry.items ?? [],
          byDomain: byDomain.items ?? [],
          domains: meta.items ?? [],
          placements: placements.items ?? [],
          lastUpdate: byDate.dbLastUpdateTime ?? null,
        });
      }

      return json({ error: `Unknown action: ${action}` }, 400);
    } catch (e) {
      const status = e && e.status === 401 || e && e.status === 403 ? 401 : 502;
      return json({ error: e instanceof Error ? e.message : "Unknown error" }, status);
    }
  },
};
