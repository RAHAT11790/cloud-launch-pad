// episode — legacy-compatible AN playback extractor.
//
// Older cached builds called `/functions/v1/episode?slug=...`. Keep that URL
// alive by proxying to the fetch/extract API instead of letting the runtime
// throw a blank-screen function error.

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });

const CARTOON_BLOCK_RE = /\b(?:ben\s*10|alien\s*swarm|omniverse|ultimate\s*alien|generator\s*rex|teen\s*titans|justice\s*league|batman|superman|spider\s*man|avengers|tom\s*(?:and|&)\s*jerry|looney\s*tunes|scooby\s*doo|powerpuff|regular\s*show|adventure\s*time|gumball|samurai\s*jack|kung\s*fu\s*panda|madagascar|minions|despicable\s*me|cars|toy\s*story|frozen|shrek|ice\s*age|hotel\s*transylvania|cartoon\s*network|nickelodeon|disney|pixar|tintin|tin\s*tin)\b/i;
const ANIME_ALLOW_RE = /\b(?:pokemon|pokémon|doraemon|shin\s*chan|crayon\s*shin|naruto|boruto|one\s*piece|dragon\s*ball|bleach|demon\s*slayer|jujutsu\s*kaisen|attack\s*on\s*titan|detective\s*conan|solo\s*leveling)\b/i;
const blockedCartoonSlug = (slug: string) => CARTOON_BLOCK_RE.test(String(slug || "").replace(/[-_]+/g, " ").toLowerCase()) && !ANIME_ALLOW_RE.test(slug);
const withCorsJson = (data: unknown, status = 200) => json({ success: false, legacyEpisodeProxy: true, ...((data && typeof data === "object") ? data as Record<string, unknown> : { error: String(data || "unknown") }) }, status);

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "POST") return json({ success: false, error: "method not allowed" }, 200);

    const url = new URL(req.url);
    const requestedSlug = url.searchParams.get("slug") || "";
    if (blockedCartoonSlug(requestedSlug)) {
      return json({ success: false, blocked: true, animeOnly: true, error: "Blocked non-anime/cartoon slug" }, 200);
    }
    const target = new URL(`${url.origin}/functions/v1/an-api/episode`);
    for (const [k, v] of url.searchParams) target.searchParams.set(k, v);

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      Object.entries(body || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null) target.searchParams.set(k, String(v));
      });
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12_000);
    const upstream = await fetch(target.toString(), {
      method: "GET",
      headers: { Accept: "application/json,*/*" },
      redirect: "follow",
      signal: ac.signal,
    }).finally(() => clearTimeout(timer));
    if (!upstream.ok) {
      let body: any = null;
      try { body = await upstream.json(); } catch {}
      return withCorsJson({ retryable: true, status: upstream.status, error: body?.error || `AN API upstream ${upstream.status}` }, 200);
    }
    const headers = new Headers(cors);
    headers.set("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  } catch (e) {
    return withCorsJson({ retryable: true, fallback: true, error: (e as Error)?.name === "AbortError" ? "AN API timeout" : ((e as Error)?.message || String(e)) }, 200);
  }
});