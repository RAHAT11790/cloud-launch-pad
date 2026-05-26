// Generate professional anime backdrop OR logo via Lovable AI Gateway.
// Uses Nano Banana 2 (gemini-3.1-flash-image-preview) — pro-level quality, sane cost.
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

  return `Create a 16:9 cinematic ANIME KEY-VISUAL banner for the anime "${title}" — official Netflix / Crunchyroll / Aniplex promotional poster quality. Studio-grade, magazine-cover, ultra-clean.

CHARACTER (most important):
- Identify the REAL main protagonist of "${title}" from the actual anime (e.g. Demon Slayer → Tanjiro Kamado with green-and-black checkered haori, black-to-red gradient hair, scar over left eye, hanafuda earrings, Nichirin katana). If the anime has an iconic duo (hero + heroine like Tanjiro + Nezuko), include BOTH.
- Render them with 100% canonical likeness — exact hair color/style, exact eye color, exact signature outfit, signature weapon and accessories. A real fan must recognize them instantly. DO NOT invent generic anime faces.
- Give them a "human touch": photorealistic anime-style shading, soft skin highlights, individual hair strands, expressive glossy eyes with iris detail, perfect hand anatomy (5 fingers), confident heroic pose pulled from a famous scene of the anime. Stylish and clean — NEVER cartoonish, NEVER deformed.
- Place the character(s) on the RIGHT 55% of the frame in dynamic hero composition. Rim lighting behind them, soft cinematic fill in front, atmospheric depth behind.

BACKGROUND & MOOD:
- The anime's actual signature environment, instantly recognizable (Demon Slayer = moonlit forest with red mist + falling sakura + Nichirin sparks; Jujutsu Kaisen = cursed purple void; Naruto = Hidden Leaf rooftops at sunset; Dr. Stone = stone-statue ruins with lightning).
- Cinematic HDR color grade pulled from the anime's signature palette. Deep blacks, glowing rim lights, anamorphic lens flares, atmospheric haze, particle embers, soft bokeh. Painterly yet sharp.

LEFT 45% — TITLE BLOCK:
- Top: thin tracked uppercase line "— ${yr || "2024"}  ANIME SERIES  •••"
- A huge custom-typography title "${upper}" — typography style matching the anime's DNA (ink-brush katana-cut for shounen, cracked stone for hard sci-fi, gothic for dark fantasy, neon-glitch for cyberpunk). Multi-line if long. Painterly texture, subtle inner glow, crisp drop shadow.
- Directly below the title: the official Japanese kanji/katakana of the anime, small and elegant, with thin hairlines.
- Below that: a short atmospheric Japanese phrase (1 short kanji line) softly glowing.

TOP-RIGHT — RS ANIME BADGE:
A compact rounded-square emblem with a tiny crown icon, bold "RS" in white-to-cyan metallic gradient, then "ANIME" in clean tracked uppercase, four-dot divider underneath. Glassy translucent dark fill, thin accent stroke matching the anime's palette, soft rim glow.

BOTTOM-LEFT — TWO STACKED PILL BADGES:
- Pill 1: Telegram paper-plane icon + "TG :- @CARTOONFUNNY03"
- Pill 2: globe icon + "WEBSITE :- RS ANIME"
- Dark glassy fill, thin neon accent stroke, small corner notches like a sci-fi HUD frame.

QUALITY RULES — STRICT:
- High resolution, razor-sharp focus, clean compositing, rule-of-thirds composition, three-point cinematic lighting.
- NO watermarks, NO duplicate logos, NO random extra text outside the specified blocks, NO mutated faces, NO extra fingers, NO blurry patches, NO generic AI placeholder characters, NO washed-out colors.
- Final image must look indistinguishable from an official Tokyo-studio key visual hand-painted for "${title}".`;
}

function logoPrompt(title: string, custom?: string): string {
  if (custom && custom.trim()) return custom.trim().replace(/\{title\}/gi, title);
  const upper = title.toUpperCase();
  return `Create a 1:1 square OFFICIAL-STYLE anime LOGO / title-mark for the anime "${title}". This is title-art ONLY — no characters in the foreground.

- Render the title "${upper}" using the EXACT canonical official-style logo treatment of the real anime "${title}" — matching the actual font character, exact colors, real texture, real stroke style, real ornaments and flourishes. Replicate the iconic signature logo treatment with master-craftsman precision (cracks, ink splatters, blade slashes, glow effects, 3D bevels — whatever the official logo has).
- Below the English title: the official Japanese kanji/katakana, smaller, elegant, perfectly kerned.
- Background: deep black or theme-colored radial gradient fitting the anime's identity. Behind the logo: a subtle signature motif (flame embers for Demon Slayer, cursed purple smoke for Jujutsu Kaisen, leaf swirl for Naruto). Atmospheric particles, soft volumetric glow.
- A tiny "RS ANIME" crown badge tucked into the bottom-right corner — small and unobtrusive.
- High resolution, perfect optical kerning, painterly micro-texture, crisp clean edges, NO extra text, NO watermarks, NO foreground characters, NO clutter.`;
}

async function genWithLovable(prompt: string): Promise<Uint8Array> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-image-preview",
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
