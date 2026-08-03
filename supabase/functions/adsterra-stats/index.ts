import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const API_BASE = "https://api3.adsterratools.com/publisher";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function call(path: string, key: string, qs = "") {
  const res = await fetch(`${API_BASE}/${path}${qs ? `?${qs}` : ""}`, {
    headers: { "X-API-Key": key, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Adsterra ${path} ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Adsterra ${path}: invalid JSON`);
  }
}

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const ALLOWED_GROUPS = new Set(["date", "placement", "country", "domain"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const key = Deno.env.get("ADSTERRA_API_KEY");
  if (!key) return json({ error: "ADSTERRA_API_KEY is not configured" }, 500);

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);
    const action = String(body.action ?? url.searchParams.get("action") ?? "overview");

    if (action === "meta") {
      const [domains, placements] = await Promise.all([
        call("domains.json", key),
        call("placements.json", key),
      ]);
      return json({ domains: domains.items ?? [], placements: placements.items ?? [] });
    }

    const start = isDate(body.start) ? body.start : url.searchParams.get("start");
    const finish = isDate(body.finish) ? body.finish : url.searchParams.get("finish");
    if (!isDate(start) || !isDate(finish)) {
      return json({ error: "start and finish must be YYYY-MM-DD" }, 400);
    }

    if (action === "stats") {
      const groups: string[] = Array.isArray(body.group_by)
        ? body.group_by.filter((g: unknown) => typeof g === "string" && ALLOWED_GROUPS.has(g))
        : ["date"];
      const qs = new URLSearchParams({ start_date: start, finish_date: finish });
      (groups.length ? groups : ["date"]).forEach((g) => qs.append("group_by[]", g));
      const data = await call("stats.json", key, qs.toString());
      return json({ items: data.items ?? [], lastUpdate: data.dbLastUpdateTime ?? null });
    }

    if (action === "overview") {
      const build = (groups: string[]) => {
        const qs = new URLSearchParams({ start_date: start, finish_date: finish });
        groups.forEach((g) => qs.append("group_by[]", g));
        return call("stats.json", key, qs.toString());
      };
      const [byDate, byPlacement, byCountry, byDomain, meta, placements] = await Promise.all([
        build(["date", "placement"]),
        build(["placement"]),
        build(["country", "placement"]),
        build(["domain"]),
        call("domains.json", key),
        call("placements.json", key),
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
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 502);
  }
});
