// aiworld-api — AI World (anime-streamer replit) proxy, AN-style endpoints.
// Endpoints:
//   GET /                → info
//   GET /search?q=...    → [{id,title,poster,year,type,slug}]
//   GET /anime?id=...    → {title,poster,storyline,seasons:[{name,episodes:[{number,title,slug}]}], episodeCount}
//   GET /episode?slug=animeId:epId  → {slug,title,pageUrl,sources:[{embed,master,streams,audio}]}
//
// Auth: uses AIWORLD_USERNAME / AIWORLD_PASSWORD secrets to keep a login cookie
// cached in-memory. Public endpoints (featured/recent) still work without creds.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const BASE = "https://anime-streamer--sakshamranjan56.replit.app";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: jsonHeaders });

// -------- cookie / session cache --------
let sessionCookie = "";
let lastLoginAt = 0;
const LOGIN_TTL = 25 * 60 * 1000;

async function login(): Promise<string> {
  const u = Deno.env.get("AIWORLD_USERNAME") || "";
  const p = Deno.env.get("AIWORLD_PASSWORD") || "";
  if (!u || !p) return "";
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, "Origin": BASE, "Referer": `${BASE}/` },
    body: JSON.stringify({ username: u, password: p }),
  });
  const setCookies: string[] = [];
  // Deno supports getSetCookie()
  const anyH = r.headers as any;
  if (typeof anyH.getSetCookie === "function") setCookies.push(...anyH.getSetCookie());
  else {
    const raw = r.headers.get("set-cookie");
    if (raw) setCookies.push(raw);
  }
  const cookie = setCookies
    .map(c => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
  await r.text().catch(() => "");
  if (!r.ok || !cookie) return "";
  sessionCookie = cookie;
  lastLoginAt = Date.now();
  return cookie;
}

async function apiFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  if (!sessionCookie || Date.now() - lastLoginAt > LOGIN_TTL) {
    await login().catch(() => {});
  }
  const headers = new Headers(init.headers || {});
  headers.set("User-Agent", UA);
  headers.set("Accept", "application/json, text/plain, */*");
  headers.set("Referer", `${BASE}/`);
  headers.set("Origin", BASE);
  if (sessionCookie) headers.set("Cookie", sessionCookie);
  const r = await fetch(`${BASE}${path}`, { ...init, headers });
  if (r.status === 401 && retry) {
    sessionCookie = "";
    await r.text().catch(() => {});
    await login().catch(() => {});
    return apiFetch(path, init, false);
  }
  return r;
}

// -------- normalizers --------
function coverToPoster(cover: string): string {
  if (!cover) return "";
  if (cover.startsWith("http")) return cover;
  if (cover.startsWith("/")) return `${BASE}${cover}`;
  return cover;
}

function toSearchItem(a: any) {
  return {
    id: String(a.id || a._id || ""),
    slug: String(a.id || a._id || ""),
    type: (a.episodeCount && a.episodeCount > 1) ? "series" : (a.status ? "series" : "series"),
    title: String(a.title || ""),
    poster: coverToPoster(a.coverImage || a.poster || ""),
    year: String(a.releaseYear || a.year || ""),
  };
}

// -------- endpoints --------
async function handleSearch(q: string) {
  // Try authenticated /api/anime?search=
  let list: any[] = [];
  try {
    const r = await apiFetch(`/api/anime?search=${encodeURIComponent(q)}&limit=100`);
    if (r.ok) {
      const d = await r.json();
      list = Array.isArray(d) ? d : (d.items || d.data || []);
    } else {
      await r.text().catch(() => {});
    }
  } catch {}
  // Fallback: merge public featured + recent, filter client-side
  if (!list.length) {
    const [fR, rR] = await Promise.all([
      fetch(`${BASE}/api/anime/featured`, { headers: { "User-Agent": UA } }).then(r => r.json()).catch(() => []),
      fetch(`${BASE}/api/anime/recent`, { headers: { "User-Agent": UA } }).then(r => r.json()).catch(() => []),
    ]);
    const merged: any[] = [...(Array.isArray(fR) ? fR : []), ...(Array.isArray(rR) ? rR : [])];
    const seen = new Set<string>();
    const dedup = merged.filter(x => {
      const id = String(x.id || x._id || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const needle = q.trim().toLowerCase();
    list = needle ? dedup.filter(x => String(x.title || "").toLowerCase().includes(needle)) : dedup;
  }
  return json(list.map(toSearchItem));
}

async function handleAnime(id: string) {
  const r = await apiFetch(`/api/anime/${encodeURIComponent(id)}`);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return json({ error: `anime fetch failed (${r.status}): ${t.slice(0, 160)}` }, r.status || 500);
  }
  const d = await r.json();
  const eps: any[] = Array.isArray(d.episodes) ? d.episodes : [];
  // Group by season
  const seasonMap = new Map<string, any[]>();
  for (const e of eps) {
    const sName = e.seasonNumber != null ? `Season ${e.seasonNumber}` : (e.season || "Season 1");
    if (!seasonMap.has(sName)) seasonMap.set(sName, []);
    seasonMap.get(sName)!.push({
      number: Number(e.episodeNumber ?? e.number ?? seasonMap.get(sName)!.length + 1),
      title: String(e.title || `Episode ${e.episodeNumber ?? ""}`),
      slug: `${id}:${e.id || e._id || e.episodeNumber}`,
    });
  }
  const seasons = [...seasonMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({ name, episodes: list.sort((a, b) => a.number - b.number) }));
  return json({
    title: String(d.title || ""),
    poster: coverToPoster(d.coverImage || ""),
    storyline: String(d.description || d.storyline || ""),
    seasons,
    episodeCount: eps.length || Number(d.episodeCount || 0),
  });
}

async function handleEpisode(slug: string) {
  const [animeId, epId] = slug.split(":");
  if (!animeId || !epId) return json({ error: "bad slug (expected animeId:episodeId)" }, 400);
  const r = await apiFetch(`/api/anime/${encodeURIComponent(animeId)}/episodes/${encodeURIComponent(epId)}/stream`);
  const text = await r.text();
  if (!r.ok) return json({ error: `stream fetch failed (${r.status}): ${text.slice(0, 200)}` }, r.status || 500);
  let data: any = {};
  try { data = JSON.parse(text); } catch {}
  // Build a source list from whatever fields the API returns.
  const sources: any[] = [];
  const pushSrc = (obj: any) => {
    if (!obj) return;
    const master = obj.master || obj.hls || obj.m3u8 || obj.url || obj.streamUrl || obj.playUrl || "";
    const streams = Array.isArray(obj.streams) ? obj.streams : [];
    const audio = Array.isArray(obj.audio) ? obj.audio : [];
    const embed = obj.embed || obj.embedUrl || obj.iframe || "";
    if (master || streams.length || audio.length || embed) {
      sources.push({ embed, master, streams, audio });
    }
  };
  if (Array.isArray(data.sources)) data.sources.forEach(pushSrc);
  else if (Array.isArray(data.servers)) data.servers.forEach(pushSrc);
  else pushSrc(data);

  return json({
    slug,
    title: String(data.title || `Episode ${epId}`),
    pageUrl: `${BASE}/watch/${animeId}/${epId}`,
    sources,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  // Strip supabase function prefix
  const path = url.pathname.replace(/^\/aiworld-api/, "") || "/";
  try {
    if (path === "/" || path === "") {
      return json({
        name: "aiworld-api",
        endpoints: ["/search?q=", "/anime?id=", "/episode?slug=animeId:epId"],
        authed: !!(Deno.env.get("AIWORLD_USERNAME") && Deno.env.get("AIWORLD_PASSWORD")),
      });
    }
    if (path === "/search") return await handleSearch(url.searchParams.get("q") || "");
    if (path === "/anime") return await handleAnime(url.searchParams.get("id") || url.searchParams.get("slug") || "");
    if (path === "/episode") return await handleEpisode(url.searchParams.get("slug") || "");
    return json({ error: "not found", path }, 404);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
