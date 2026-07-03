import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ANIMESALT_BASE = "https://animesalt.ac";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const cleanSlug = (value: unknown) =>
  String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("?")[0]
    .split("#")[0];

function buildTargetUrl(body: any): string {
  if (body?.url) {
    const target = new URL(String(body.url));
    if (!/^https?:$/i.test(target.protocol)) throw new Error("Invalid URL protocol");
    return target.toString();
  }

  const action = String(body?.action || "").toLowerCase();
  const slug = cleanSlug(body?.slug);
  const page = Math.max(1, Number(body?.page || 1));
  const type = String(body?.type || "series").toLowerCase() === "movies" ? "movies" : "series";

  if (action === "browse") {
    return page > 1 ? `${ANIMESALT_BASE}/${type}/page/${page}/` : `${ANIMESALT_BASE}/${type}/`;
  }
  if (action === "series" && slug) return `${ANIMESALT_BASE}/series/${slug}/`;
  if ((action === "movie" || action === "movies") && slug) return `${ANIMESALT_BASE}/movies/${slug}/`;
  if (action === "episode" && slug) return `${ANIMESALT_BASE}/episode/${slug}/`;

  throw new Error("Invalid AnimeSalt request");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method === "GET") return json({ success: true, name: "animesalt" });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  let targetUrl = "";
  try {
    targetUrl = buildTargetUrl(body);
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 400);
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${ANIMESALT_BASE}/`,
      },
      redirect: "follow",
    });

    const html = await upstream.text();
    if (!upstream.ok) {
      return json({ success: false, status: upstream.status, error: "AnimeSalt upstream failed", html }, 502);
    }

    return json({ success: true, url: targetUrl, html });
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 502);
  }
});