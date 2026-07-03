// RS Bot — Lovable AI powered chat assistant for the RS Anime site.
// Loads the FULL anime catalog (RS webseries + movies + AnimeSalt) from
// Firebase RTDB on every request (cached 5 min in module scope), then
// builds a strict system prompt so the model can only return valid
// internal links to anime that actually exist in the database.
//
// Response shape: { reply: string }
// Compatible with the existing LiveSupportChat client which accepts
// { reply } or { response }.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FIREBASE_DB =
  Deno.env.get("FIREBASE_DATABASE_URL") ??
  "https://rs-anime-default-rtdb.firebaseio.com";
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://rsanime03.lovable.app";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

// ---------- Firebase REST helpers ----------
async function fbGet<T = any>(path: string): Promise<T | null> {
  try {
    const url = `${FIREBASE_DB}/${path}.json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------- Catalog cache (5 minutes) ----------
type CatalogItem = {
  id: string;
  title: string;
  source: "rs" | "animesalt";
  type: string;
  year?: string;
  rating?: string;
  category?: string;
  language?: string;
  episodes?: number;
  shareLink: string;
};

let cache: { items: CatalogItem[]; at: number } = { items: [], at: 0 };
const CACHE_TTL = 5 * 60 * 1000;

async function loadCatalog(): Promise<CatalogItem[]> {
  const now = Date.now();
  if (cache.items.length && now - cache.at < CACHE_TTL) return cache.items;

  const [series, movies, animesalt] = await Promise.all([
    fbGet<Record<string, any>>("webseries"),
    fbGet<Record<string, any>>("movies"),
    fbGet<Record<string, any>>("animesaltSelected"),
  ]);

  const items: CatalogItem[] = [];

  if (series && typeof series === "object") {
    for (const [id, raw] of Object.entries(series)) {
      const v: any = raw || {};
      if (v.visibility === "private") continue;
      let epCount = 0;
      if (Array.isArray(v.seasons)) {
        for (const s of v.seasons) epCount += s?.episodes?.length || 0;
      }
      items.push({
        id,
        title: v.title || "Untitled",
        source: "rs",
        type: "series",
        year: v.year,
        rating: v.rating,
        category: v.category,
        language: v.language,
        episodes: epCount,
        shareLink: `${SITE_URL}?anime=${encodeURIComponent(id)}`,
      });
    }
  }

  if (movies && typeof movies === "object") {
    for (const [id, raw] of Object.entries(movies)) {
      const v: any = raw || {};
      if (v.visibility === "private") continue;
      items.push({
        id,
        title: v.title || "Untitled",
        source: "rs",
        type: "movie",
        year: v.year,
        rating: v.rating,
        category: v.category,
        language: v.language,
        shareLink: `${SITE_URL}?anime=${encodeURIComponent(id)}`,
      });
    }
  }

  if (animesalt && typeof animesalt === "object") {
    for (const [slug, raw] of Object.entries(animesalt)) {
      const v: any = raw || {};
      const id = `as_${slug}`;
      items.push({
        id,
        title: v.title || slug,
        source: "animesalt",
        type: v.type || "series",
        year: v.year,
        rating: v.rating,
        category: v.category,
        shareLink: `${SITE_URL}?anime=${encodeURIComponent(id)}`,
      });
    }
  }

  cache = { items, at: now };
  return items;
}

// ---------- Prompt builder ----------
function buildSystemPrompt(catalog: CatalogItem[], userContext?: string) {
  const rs = catalog.filter((c) => c.source === "rs");
  const an = catalog.filter((c) => c.source === "animesalt");

  // Trim each list — keep the prompt under control
  const formatItem = (c: CatalogItem) =>
    `- ${c.title} | ${c.type}${c.year ? ` | ${c.year}` : ""}${c.rating ? ` | ⭐${c.rating}` : ""} | LINK: ${c.shareLink}`;

  const rsBlock = rs
    .slice(0, 250)
    .map(formatItem)
    .join("\n");
  const anBlock = an
    .slice(0, 250)
    .map(formatItem)
    .join("\n");

  return `You are "RS Bot", the friendly Bengali-speaking AI assistant for the RS Anime website (${SITE_URL}).

PERSONALITY:
- Polite, warm, and helpful. Use respectful Bangla ("আপনি", "ভাই") + light emoji.
- Reply mostly in Bangla unless the user writes purely in English.
- Keep replies short and useful. Never invent facts.

ABOUT THE SITE:
- "RS" = the site's own catalog (web series + movies). "AN" = AnimeSalt mirror catalog.
- Users can watch anime, mark watchlist, subscribe via bKash, contact admin via @RS in chat.
- Premium plans are managed in Profile → Subscription. Test/admin questions should reach the admin (tell user to type @RS).

STRICT LINK RULES:
1. ONLY use the exact LINK values from the catalogs below. Never invent, edit or guess any URL.
2. NEVER suggest external sites (Crunchyroll, YouTube, Funimation, Google, etc.).
3. When recommending an anime, output a button using EXACTLY this format on its own line:
   [BTN:Short Name:LINK:exact_link_from_catalog]
4. If the user asks for an anime that's NOT in the catalogs, say it's not available on this site and suggest 1-2 close matches that ARE available.
5. Match by title flexibly (case-insensitive, partial). Prefer RS over AN when both exist.

RS CATALOG (${rs.length} titles${rs.length > 250 ? `, showing 250` : ""}):
${rsBlock || "(empty)"}

AN CATALOG (${an.length} titles${an.length > 250 ? `, showing 250` : ""}):
${anBlock || "(empty)"}

${userContext ? `USER CONTEXT:\n${userContext}\n` : ""}
Stay on topic — anime, the site, accounts, premium. Decline politely for unrelated requests.`;
}

// ---------- Handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const body = await req.json().catch(() => ({}));
    if (body?.test === true) {
      return new Response(JSON.stringify({ ok: true, ping: "rs-bot" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const userContext = typeof body.userContext === "string"
      ? body.userContext
      : "";

    if (messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages array required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const catalog = await loadCatalog();
    const systemPrompt = buildSystemPrompt(catalog, userContext);

    const aiRes = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.slice(-8).map((m: any) => ({
              role: m.role === "admin" ? "user" : (m.role || "user"),
              content: String(m.content || "").slice(0, 1000),
            })),
          ],
        }),
      },
    );

    if (aiRes.status === 429) {
      return new Response(
        JSON.stringify({
          error: "Rate limit reached. একটু পরে আবার চেষ্টা করুন।",
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (aiRes.status === 402) {
      return new Response(
        JSON.stringify({
          error:
            "AI ক্রেডিট শেষ — ওয়ার্কস্পেসে credits যোগ করুন।",
        }),
        {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, errText);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const data = await aiRes.json();
    const reply = data?.choices?.[0]?.message?.content || "";

    return new Response(
      JSON.stringify({ reply, catalogSize: catalog.length }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("rs-bot error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
