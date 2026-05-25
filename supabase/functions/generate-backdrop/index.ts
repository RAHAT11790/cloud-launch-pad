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

const QUALITY_PREFIX = `ULTRA HIGH-RESOLUTION 8K MASTERPIECE — render at maximum native resolution, razor-sharp focus, photoreal lighting fidelity, zero compression artifacts, zero blur, zero pixelation. Treat this as a high-end commercial print campaign / IMAX-grade key visual produced by a top Tokyo design studio. Every pixel must be intentional, every line crisp, every gradient smooth, every color hyper-saturated yet elegant.`;

const COLOR_PREFIX = `COLOR & LIGHTING — Cinematic HDR color grade with deep rich blacks, luminous mid-tones, glowing rim-light highlights. Hyper-saturated SIGNATURE PALETTE drawn from the anime's actual visual identity (e.g. Demon Slayer = obsidian black + crimson red + emerald green; Dr. Stone = electric cyan + science green + storm grey; Jujutsu Kaisen = cursed purple + neon teal; Attack on Titan = blood red + steel blue). Volumetric god-rays cutting through atmosphere, anamorphic lens flares, bokeh particles, embers, dust motes, refracted prism light, chromatic aberration on edges. Look as colorful as a Wit Studio promotional poster but as moody as a Ufotable cinematic frame.`;

function backdropPrompt(title: string, year?: string | number, custom?: string): string {
  if (custom && custom.trim()) return custom.trim().replace(/\{title\}/gi, title);
  const yr = year ? String(year) : "";
  const upper = title.toUpperCase();

  return `${QUALITY_PREFIX}

Create a 16:9 widescreen ULTRA-PROFESSIONAL OFFICIAL-QUALITY anime promotional KEY-VISUAL banner for the anime titled "${title}". The result must surpass official Crunchyroll / Netflix / Aniplex key visuals — magazine-cover, billboard-grade, framed-print quality. NEVER AI-generic, NEVER cartoon-style, NEVER random characters, NEVER muddy or washed-out.

═══ REAL CHARACTERS — NON-NEGOTIABLE ═══
- Identify the ACTUAL MAIN HERO (and main HEROINE if the anime has one) of "${title}" from the real anime/manga. Render them with their EXACT canonical appearance: correct hair color & style, exact eye color, signature outfit, signature weapon/accessory, signature expression and aura. A real fan of "${title}" must instantly recognize them in under one second.
- Compose the main HERO + main HEROINE together in the RIGHT 55% of the frame in a dynamic cinematic hero pose lifted from a famous scene of the anime — battle stance, signature attack mid-cast, dramatic backlight silhouette, or emotional close-up. If the anime has only one protagonist, render that one character with maximum heroic impact. NEVER invent generic anime characters, NEVER use placeholder faces.
- Anatomy flawless, hands correct (5 fingers each), eyes glossy and emotive with detailed iris reflections, hair strands individually rendered with motion blur, skin highlights painterly, outfits with fabric texture and stitching detail. Production quality of Ufotable / MAPPA / WIT / Bones / CloverWorks at peak budget.

═══ ENVIRONMENT ═══
${COLOR_PREFIX}
The background must be the anime's actual signature world — instantly recognizable. Demon Slayer = moonlit haunted forest with red mist + falling sakura + Nichirin sword sparks; Dr. Stone = lightning-cracked ruined civilization with overgrown statues + science formulas glowing in the air; Naruto = Hidden Leaf rooftops at sunset; Attack on Titan = broken walls with steam + 3D maneuver gear smoke; Jujutsu Kaisen = cursed purple void + collapsing buildings; My Hero Academia = neon city skyline. Massive depth of field, layered parallax, atmospheric haze, motion streaks, embers, debris.

═══ LEFT 45% — TITLE BLOCK (PRECISION TYPOGRAPHY) ═══
- Top label: "— ${yr || "2024"}  ANIME SERIES  •••" in thin tracked-out uppercase, micro-letterspacing, glowing accent color of the anime.
- Brushstroke ribbon below it carrying a short PUNCHY ENGLISH TAGLINE (one all-caps sentence, max 6 words) thematically perfect for the anime.
- The HUGE display title "${upper}" — custom hand-crafted typography matching the anime's genre DNA: cracked-stone chiseled for Dr. Stone, ink-brush katana-slash for samurai/shounen, blade-cut serif with red bleeds for Demon Slayer, neon-glitch cyber for sci-fi, gothic for dark fantasy. Multi-line if long. Painterly texture, subtle inner glow, micro stroke detail, perfect optical kerning, drop shadow with depth. The title is the visual hero — must dominate the left half.
- Directly under the title: the OFFICIAL Japanese kanji/katakana subtitle of the anime, small and elegant, flanked by thin horizontal hairlines.
- Below that: a short atmospheric Japanese phrase (1–2 short kanji lines) acting as a poetic subtitle, glowing softly.

═══ TOP-RIGHT — RS ANIME LOGO BADGE ═══
A compact rounded-square emblem: tiny crown icon at the top, then bold letters "RS" in a white-to-cyan metallic gradient, then the word "ANIME" beneath in clean tracked uppercase. A four-dot decorative divider underneath. Glassy translucent dark background with thin accent-color stroke matching the anime's signature palette. Soft rim glow.

═══ BOTTOM-LEFT — TWO STACKED PILL BADGES ═══
- Pill 1: round Telegram paper-plane icon + text "TG :- @CARTOONFUNNY03"
- Pill 2: round globe icon + text "WEBSITE :- RS ANIME"
- Pills: dark glassy translucent fill, thin neon accent stroke (matching anime's signature color), soft outer glow, micro corner notches/brackets like a sci-fi HUD frame, small dot indicators.

═══ QUALITY GATE — STRICT ═══
- Render at native 8K. Sharpness: maximum. Color depth: 10-bit cinematic. Composition: rule-of-thirds perfect. Lighting: cinematic three-point with dramatic key + fill + rim.
- ABSOLUTELY NO: watermarks, duplicate logos, random extra English/Japanese text outside the specified blocks, blurry edges, low-res patches, mutated faces, extra fingers, deformed anatomy, inconsistent lighting, AI-generic look, washed-out colors, generic anime placeholders.
- Every element pixel-perfect. Final image must be indistinguishable from a Tokyo studio's hand-crafted official key visual for "${title}" — better than Pinterest's top result for the title.`;
}

function logoPrompt(title: string, custom?: string): string {
  if (custom && custom.trim()) return custom.trim().replace(/\{title\}/gi, title);
  const upper = title.toUpperCase();
  return `${QUALITY_PREFIX}

Create a 1:1 square ULTRA-PROFESSIONAL OFFICIAL-STYLE anime LOGO / title-mark for the anime "${title}". This is title-art ONLY, NOT a poster — no characters in the foreground.

- Render the title "${upper}" using the EXACT canonical official-style logo treatment of the real anime "${title}" — matching the actual font character, exact colors, real texture, real stroke style, real ornaments and flourishes. Replicate the iconic signature logo treatment with absolute master-craftsman precision; if the official logo has cracks, ink splatters, blade slashes, glow effects, or 3D bevels — reproduce them faithfully.
- Below the English title: the official Japanese kanji/katakana of the anime, smaller, elegant, perfectly kerned.
- Background: deep black or a theme-colored radial gradient that fits the anime's identity. Behind the logo: subtle signature visual motif of the anime — flame embers for Demon Slayer, lightning + chemistry symbols for Dr. Stone, cursed purple smoke for Jujutsu Kaisen, leaf swirl for Naruto. Cinematic atmospheric particles, soft volumetric glow, 8K-clean.
- Tiny "RS ANIME" crown badge tucked into the bottom-right corner — small, elegant, unobtrusive.
- 8K resolution, perfect optical kerning, painterly micro-texture, hyper-clean edges, no extra text, no watermarks, no foreground characters, no clutter. Logo-art only — IMAX print-grade.`;
}

async function genWithLovable(prompt: string): Promise<Uint8Array> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-pro-image-preview",
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
