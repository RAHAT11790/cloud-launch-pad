// Generate ULTRA-PROFESSIONAL anime backdrop OR logo via Lovable AI Gateway (Nano Banana).
// Mode: "backdrop" (16:9 cinematic banner) | "logo" (1:1 square brand mark)
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const IMGBB_KEYS = ["d5c0bce7c98c54d813bf285ffe453689"];

interface Body {
  animeId: string;
  title: string;
  type?: "webseries" | "movies";
  year?: string | number;
  mode?: "backdrop" | "logo";
  customPrompt?: string;
}

function backdropPrompt(title: string, year?: string | number, custom?: string): string {
  if (custom && custom.trim()) return custom.trim().replace(/\{title\}/gi, title);
  const yr = year ? String(year) : "";
  const upper = title.toUpperCase();

  return `Create a 16:9 widescreen ULTRA-PROFESSIONAL official-quality anime promotional key-visual banner for the anime titled "${title}". This must look like a REAL Crunchyroll / Netflix / Aniplex official key visual — NOT AI-generic, NOT cartoon-style, NOT random characters.

CRITICAL — REAL CHARACTERS:
- Identify the ACTUAL MAIN HERO (and main heroine if the anime has one) of "${title}" from the real anime. Render them with their EXACT canonical appearance: correct hair color, hair style, eye color, signature outfit, signature weapon/accessory, signature expression. They must be instantly recognizable to any fan of "${title}".
- Place the main HERO and main HEROINE together in the right 55% of the frame in a dynamic cinematic hero pose from a famous scene of the anime. If the anime has only one protagonist, render that single character with maximum impact. NEVER invent generic anime characters.
- Faces sharp, eyes vivid and emotive, hair flowing with motion, clean professional anime line-art, official-anime production quality (Ufotable / MAPPA / WIT / Bones level).

ENVIRONMENT:
- Atmospheric background that matches the anime's actual world and tone (e.g. Demon Slayer = moonlit forest with red mist + Nichirin sword sparks; Dr. Stone = ruined civilization with lightning + science glow; Naruto = ninja village rooftops; Attack on Titan = broken walls + steam). Volumetric god-rays, cinematic particles, embers, debris, motion streaks, rich depth-of-field. Color grade matches the anime's signature palette.

LEFT 45% — TITLE BLOCK:
- Tiny tagline at top: "— ${yr || "2024"}  ANIME SERIES  •••" in thin tracked-out uppercase.
- A short brushstroke ribbon below it carrying a punchy English tagline phrase that fits the anime's theme (one short sentence, all-caps).
- HUGE BOLD display title "${upper}" — typography style must match the anime's genre (cracked-stone for Dr. Stone, brush-ink for samurai/shounen, sharp blade-cut serif for Demon Slayer, neon-cyber for sci-fi). Multi-line if long. Painterly texture, subtle glow, perfect kerning.
- Below the title: the official Japanese kanji/katakana subtitle of the anime, small and elegant, with thin horizontal lines on each side.
- Below that: a short atmospheric Japanese phrase (1-2 lines of kanji) acting as poetic subtitle.

TOP-RIGHT — RS ANIME LOGO BADGE:
- A compact rounded-square emblem with a small crown icon on top, the bold letters "RS" inside (white-to-cyan gradient), and the word "ANIME" beneath in clean uppercase. Subtle dotted divider under it. Glassy dark background with thin accent stroke matching the anime's color theme.

BOTTOM-LEFT — TWO STACKED PILL BADGES:
- Pill 1: round Telegram paper-plane icon + text "TG :- @CARTOONFUNNY03"
- Pill 2: round globe icon + text "WEBSITE :- RS ANIME"
- Both pills: dark glassy fill, thin accent-color stroke, soft glow, subtle corner notches/brackets like a HUD frame.

QUALITY:
- 4K crisp, dramatic backlight, cinematic lens flares, painterly highlights, perfect 16:9 composition. NO watermarks, NO duplicate logos, NO random extra text, NO blurry edges, NO mutated faces, NO extra fingers. Every element pixel-perfect, professional poster grade. Final result must be indistinguishable from an official key visual for "${title}".`;
}

function logoPrompt(title: string, custom?: string): string {
  if (custom && custom.trim()) return custom.trim().replace(/\{title\}/gi, title);
  const upper = title.toUpperCase();
  return `Create a 1:1 square ULTRA-PROFESSIONAL official-style anime LOGO / title-mark for the anime "${title}". This is the title-art only, NOT a poster.

- Render the title "${upper}" using the EXACT canonical official-style logo treatment of the real anime "${title}" (matching font character, color, texture, stroke, ornaments). If the real anime has an iconic logo style — replicate that signature treatment with master craftsmanship.
- Below the English title: the official Japanese kanji/katakana of the anime in smaller elegant type.
- Pure transparent-feel dark background (deep black or theme-colored gradient that fits the anime), centered composition, dramatic glow / particles / signature visual motif of the anime subtly behind the logo (e.g. flame for Demon Slayer, lightning for Dr. Stone, leaf for Naruto).
- Tiny "RS ANIME" crown badge in the bottom-right corner — small, unobtrusive, elegant.
- 4K crisp, perfect kerning, painterly texture, no extra text, no watermarks, no characters, no clutter. Logo-art only — magazine cover quality.`;
}

async function genWithLovable(prompt: string): Promise<Uint8Array> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (res.status === 402) throw new Error("PAYMENT_REQUIRED");
    throw new Error(`Lovable AI ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const url: string | undefined = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url || !url.startsWith("data:")) throw new Error("Lovable AI: no image returned");
  const b64 = url.split(",", 2)[1];
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function uploadToImgbb(bytes: Uint8Array, name: string): Promise<string> {
  let lastErr: unknown;
  for (const key of IMGBB_KEYS) {
    try {
      const fd = new FormData();
      const blob = new Blob([bytes], { type: "image/jpeg" });
      fd.append("image", blob, `${name}.jpg`);
      fd.append("key", key);
      const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`ImgBB ${res.status}`);
      const j = await res.json();
      const url = j?.data?.display_url || j?.data?.url;
      if (!url) throw new Error("ImgBB: no url");
      return url;
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error("ImgBB failed");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json()) as Body;
    if (!body?.title || !body?.animeId) {
      return new Response(JSON.stringify({ error: "title and animeId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mode = body.mode === "logo" ? "logo" : "backdrop";
    const prompt = mode === "logo"
      ? logoPrompt(body.title, body.customPrompt)
      : backdropPrompt(body.title, body.year, body.customPrompt);
    const bytes = await genWithLovable(prompt);

    const safe = body.animeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const url = await uploadToImgbb(bytes, `${mode}_${safe}_${Date.now()}`);

    return new Response(JSON.stringify({ ok: true, url, mode, engine: "lovable" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error("[generate-backdrop] error:", msg);
    const status = msg === "RATE_LIMIT" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
