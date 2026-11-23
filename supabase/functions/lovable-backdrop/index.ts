// Lovable AI Gateway-backed backdrop/logo generator.
// Default model: openai/gpt-image-2 (best quality text + character rendering).
//
// PERMANENT VALUES (never overridable, always injected first):
//   1. the anime TITLE of the item being edited
//   2. the EXISTING backdrop image (TMDB/IMDB key art) — analysed by a vision
//      model so the generated art uses the REAL official characters
// Any custom prompt is applied AFTER those two permanent values.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/images/generations";
const CHAT_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-image-2";
const VISION_MODEL = "google/gemini-3-flash";
const IMGBB_KEY = "d5c0bce7c98c54d813bf285ffe453689";

interface Body {
  title?: string;
  mode?: "backdrop" | "logo";
  referenceImageUrl?: string;
  useReference?: boolean;
  customPrompt?: string;
  genres?: string[];
  overview?: string;
  year?: string | number;
  action?: "check-lovable";
  model?: string;
  quality?: "low" | "medium" | "high";
}

/** The master house style — supplied by the site owner. */
const HOUSE_PROMPT = `Create a PROFESSIONAL 16:9 cinematic anime promotional poster/banner in ultra detailed 4K quality.

Style Requirements:
- Modern anime thumbnail/poster design
- Dark cinematic atmosphere with glowing effects
- Ultra high detail anime illustration
- Sharp focus, vibrant lighting, dramatic shadows
- Dynamic composition with depth and motion
- Professional typography and clean layout
- Eye-catching YouTube/Telegram style anime banner
- Highly detailed background matching the anime theme
- Add energy effects, particles, glow, sparks, speed lines, cinematic lighting
- Make the entire design feel PREMIUM and VIRAL

Character Design:
- Use the main anime characters in the most iconic pose
- Characters should look powerful, emotional, stylish, and dynamic
- Anime art must look modern, polished, and studio-quality
- Match the color grading with the anime's theme
- Use detailed anime eyes, hair glow, dramatic expressions

Typography:
- BIG bold stylized anime title text
- Title should feel aggressive, modern, and cinematic
- Use brush-stroke / neon / sharp-edge typography style
- Add a small stylish subtitle for anime aesthetic
- Make the text blend naturally with the effects and background

Branding Layout:
- Top-right corner: small elegant "RS ANIME 03" logo with a crown icon, minimal and premium
- Bottom-left: Telegram logo + text "TG :- @CARTOONFUNNY03"
- Below it: website icon + text "WEBSITE :- RS ANIME 03"
- Use glowing UI bars/shapes around the social links
- Keep branding small but stylish and professional

Color & Theme:
- Match the anime's original mood and genre
- Use cinematic contrast and vibrant colors
- Add blue/red/purple/orange glow depending on the anime vibe
- Use high contrast lighting and realistic anime shading

Quality:
- Ultra detailed, 4K, HDR, professional anime poster
- Trending anime thumbnail style, clean edges, no blur, no watermark
- Sharp anime rendering, high quality texture details

Composition:
- Left side = title and text elements
- Right side = main anime characters/artwork
- Balanced cinematic framing, depth and layered visual effects
- Make the poster feel alive and immersive

Extra Instructions:
- Design must look UNIQUE for this anime, avoid generic layouts
- Official anime promotional key visual mixed with premium YouTube thumbnail design
- Highly attractive and click-worthy professional anime marketing artwork

LANGUAGE LOCK: every visible letter in the image MUST be ENGLISH ONLY. No Japanese, no Kanji, no Hindi, no Bengali, no invented glyphs anywhere in the artwork.`;

/**
 * Vision pass — read the existing TMDB/IMDB backdrop and describe the REAL
 * official characters so the image model cannot invent random people.
 * Falls back silently (empty string) if the vision call fails.
 */
async function describeOfficialCharacters(
  key: string,
  title: string,
  imageUrl: string,
): Promise<string> {
  try {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text:
`This is the OFFICIAL key art of the anime "${title}" (the same artwork Crunchyroll / IMDb / TMDB use).

Identify the anime and its canonical main characters. Using both this image and your knowledge of the official Crunchyroll and IMDb pages for "${title}", write a precise CHARACTER SHEET an illustrator could draw from without ever seeing the anime.

For each main character (max 4, hero first) give on one line:
NAME — hair (colour, length, style) | eyes (colour, shape) | outfit (exact colours, armour/uniform details) | signature weapon or power | typical expression.

Then one line: SETTING — the canonical world/environment.
Then one line: PALETTE — the show's signature colours.

Be factual and specific. No prose, no markdown, no invented characters.`,
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        }],
      }),
    });
    if (!res.ok) return "";
    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content;
    return typeof txt === "string" ? txt.trim().slice(0, 2000) : "";
  } catch {
    return "";
  }
}

function backdropPrompt(b: Body, characterSheet: string): string {
  const t = b.title || "";
  const genres = b.genres?.length ? b.genres.join(", ") : "";
  const overview = (b.overview || "").trim().slice(0, 400);

  // ---- PERMANENT BLOCK (always first, never replaced by a custom prompt) ----
  const permanent =
`ANIME: "${t}"${b.year ? ` (${b.year})` : ""}
${genres ? `GENRES: ${genres}\n` : ""}${overview ? `SYNOPSIS: ${overview}\n` : ""}
TITLE LOCK: the big title text in the artwork must read exactly "${t}" — spelled correctly, in English letters.

CHARACTER LOCK: draw ONLY the real, official, canonical characters of "${t}" exactly as they appear in the official Crunchyroll / IMDb key art. Do NOT invent characters, do NOT substitute look-alikes, do NOT change hair colour, eye colour, outfit or weapon.
${characterSheet ? `\nOFFICIAL CHARACTER SHEET (extracted from the official key art — follow it strictly):\n${characterSheet}\n` : ""}
STYLE LOCK: Japanese anime illustration only (ufotable / MAPPA / Wit / Bones quality). No Western cartoon, no 3D Pixar look, no chibi.`;

  const custom = b.customPrompt?.trim()
    ? b.customPrompt
        .replace(/\{title\}/gi, t)
        .replace(/\[WRITE ANIME NAME HERE\]/gi, t)
    : "";

  return custom
    ? `${permanent}\n\n=== ART DIRECTION ===\n${custom}\n\nThe ANIME, TITLE LOCK and CHARACTER LOCK above override anything in the art direction. All visible text must be ENGLISH ONLY.`
    : `${permanent}\n\n=== ART DIRECTION ===\n${HOUSE_PROMPT}`;
}

function logoPrompt(b: Body, characterSheet: string): string {
  const t = b.title || "";
  const permanent =
`Official anime TITLE LOGO for "${t}", square 1:1.
TITLE LOCK: the logo text must read exactly "${t}" in ENGLISH letters, spelled correctly.
BRAND LOCK: match the canonical official logo treatment of the real anime "${t}" — its real font weight, colours, glow and ornaments.
${characterSheet ? `Show palette reference:\n${characterSheet}\n` : ""}`;

  const custom = b.customPrompt?.trim() ? b.customPrompt.replace(/\{title\}/gi, t) : "";
  if (custom) {
    return `${permanent}\n=== ART DIRECTION ===\n${custom}\n\nENGLISH TEXT ONLY. No Japanese, Hindi or Bengali characters.`;
  }
  return `${permanent}
Deep black radial gradient background with atmospheric particles and subtle glow. High resolution, perfect kerning, crisp edges, no foreground characters, no extra text, no watermark. ENGLISH TEXT ONLY.`;
}

async function uploadToImgBB(b64: string): Promise<string> {
  const form = new FormData();
  form.append("image", b64);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method: "POST", body: form });
  const j = await res.json();
  if (!j?.data?.url) throw new Error("ImgBB upload failed");
  return j.data.url as string;
}

// Domain allowlist — this endpoint is admin-only from the RS Anime panel.
const ALLOWED_HOST_RX = [
  /\.lovable\.app$/i,
  /\.lovableproject\.com$/i,
  /^rsanime03\.lovable\.app$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/i,
];
const matchesAllowedHost = (u: string | null) => {
  if (!u) return false;
  try { return ALLOWED_HOST_RX.some((rx) => rx.test(new URL(u).host)); } catch { return false; }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!matchesAllowedHost(origin) && !matchesAllowedHost(referer)) {
    return new Response(JSON.stringify({ error: "Access denied" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body = {};
  try { body = await req.json(); } catch {}

  // Health probe
  if (body.action === "check-lovable") {
    try {
      const probe = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model: DEFAULT_MODEL, prompt: "ping", size: "1024x1024", n: 1 }),
      });
      const ok = probe.status < 500 && probe.status !== 401 && probe.status !== 402;
      let msg = "Gateway reachable";
      if (probe.status === 402) msg = "Out of Lovable credits";
      else if (probe.status === 429) msg = "Rate-limited";
      else if (probe.status === 401) msg = "Invalid key";
      return new Response(JSON.stringify({
        lovable: { ok, model: DEFAULT_MODEL, message: msg, status: probe.status },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ lovable: { ok: false, error: String((e as Error).message) } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const mode = body.mode || "backdrop";
    const model = body.model || DEFAULT_MODEL;

    // PERMANENT STEP — always look at the existing backdrop first (when we have
    // one) so the official characters are reproduced instead of invented.
    let characterSheet = "";
    if (body.referenceImageUrl && body.title) {
      characterSheet = await describeOfficialCharacters(key, body.title, body.referenceImageUrl);
    }

    const prompt = mode === "logo" ? logoPrompt(body, characterSheet) : backdropPrompt(body, characterSheet);

    const payload: Record<string, unknown> = {
      model,
      prompt,
      size: mode === "logo" ? "1024x1024" : "1536x1024",
      n: 1,
    };

    const upstream = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify(payload),
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      let error = `Lovable AI ${upstream.status}: ${raw.slice(0, 300)}`;
      if (upstream.status === 402) error = "Out of Lovable AI credits — add credits in workspace billing to generate images.";
      else if (upstream.status === 429) error = "Rate limited by Lovable AI — try again in a moment.";
      return new Response(JSON.stringify({ error, model }), {
        status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = JSON.parse(raw);
    const chatImg = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url as string | undefined;
    const b64 = data?.data?.[0]?.b64_json || (chatImg?.includes(",") ? chatImg.split(",")[1] : undefined);
    if (!b64) {
      return new Response(JSON.stringify({ error: "No image returned", raw: data }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = await uploadToImgBB(b64);
    return new Response(JSON.stringify({
      url, model, provider: "lovable", usedReference: Boolean(characterSheet),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
