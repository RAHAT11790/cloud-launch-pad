// Backdrop / Logo generator — dual provider:
//   provider="lovable" → Lovable AI Gateway (default: openai/gpt-image-2)
//   provider="flux"    → r-gengpt-api.vercel.app (Flux v1.0)
//
// Returns { ok, url, mode, engine } — caller decides whether to save to DB.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const IMGBB_KEYS = ["d5c0bce7c98c54d813bf285ffe453689"];

interface Body {
  animeId: string;
  title: string;
  type?: "webseries" | "movies";
  year?: string | number;
  mode?: "backdrop" | "logo";
  customPrompt?: string;
  provider?: "lovable" | "flux";
  model?: string;
  // NEW: image-to-image grounding (backdrop mode only)
  referenceImageUrl?: string;
  useReference?: boolean;          // default true if referenceImageUrl provided
  genres?: string[];               // e.g. ["Romance", "Slice of Life"]
  overview?: string;               // TMDB overview / storyline
}

function defaultBackdropPrompt(title: string, _year?: string | number): string {
  return `Create an ULTRA-PROFESSIONAL 16:9 ANIME promotional banner — official Crunchyroll / Netflix / Aniplex / Toho key visual quality — for the anime titled "${title}".

Create an ULTRA PROFESSIONAL 16:9 ANIME PROMOTIONAL BANNER in TRUE JAPANESE ANIME KEY VISUAL STYLE.
════════════════════════════════════
ABSOLUTE HIGHEST PRIORITY RULE
════════════════════════════════════

Before generating the image, carefully analyze the official anime posters, promotional visuals, character designs, trailers, key visuals, and official artwork related to.

Study the anime carefully.

Understand:

- Main protagonist
- Supporting characters
- Character relationships
- Character appearance
- Character personality
- Anime atmosphere
- Anime genre
- Anime world
- Anime visual identity

This image must preserve the original identity of the anime.

DO NOT create random characters.

DO NOT create generic AI anime characters.

DO NOT redesign the anime.

DO NOT create fan-made replacements.

Use only the official recognizable anime characters associated with "{{ANIME_NAME}}".

════════════════════════════════════
OFFICIAL CHARACTER PRESERVATION
════════════════════════════════════

Characters must look instantly recognizable to anime fans.

Preserve:

- Original hairstyle
- Original hair color
- Original eye color
- Original facial structure
- Original outfit design
- Original accessories
- Original weapons
- Original powers
- Original age appearance
- Original body proportions
- Original personality expression
- Original anime identity

Characters should feel like they came directly from official anime promotional material.

No redesigns.

No alternate versions.

No fanart interpretations.

No AI-generated replacement faces.

Maintain franchise accuracy.

════════════════════════════════════
STRICT ANTI-CARTOON LOCK
════════════════════════════════════

This is NOT a cartoon.

This is NOT western animation.

This is NOT Pixar.

This is NOT Disney.

This is NOT DreamWorks.

This is NOT Cartoon Network.

This is NOT Nickelodeon.

This is NOT Family Guy.

This is NOT Adventure Time.

This is NOT Steven Universe.

This is NOT comic-book style.

This is NOT mascot art.

This is NOT sticker art.

This is NOT toy art.

This is NOT chibi.

This is NOT super-deformed style.

This is NOT children's artwork.

This is NOT cute mascot artwork.

This is NOT simplified illustration.

If the image looks like a cartoon in any way, it is incorrect.

The image must look like premium Japanese anime promotional artwork.

════════════════════════════════════
VISUAL QUALITY
════════════════════════════════════

Official anime studio quality.

Anime marketing campaign quality.

Crunchyroll promotional quality.

Netflix anime banner quality.

Premium anime streaming platform quality.

Ultra detailed.

HDR lighting.

4K quality.

Professional composition.

Sharp anime lineart.

Premium cel shading.

Detailed anime eyes.

Detailed anime hair.

Detailed anime clothing.

Beautiful anime rendering.

Clean anatomy.

Correct proportions.

Professional cinematic presentation.

════════════════════════════════════
LAYOUT
════════════════════════════════════

16:9 widescreen cinematic composition.

LEFT SIDE:

Large anime title.

Stylized anime logo typography.

Japanese subtitle text.

Premium graphic elements.

Anime UI decorations.

Glow accents.

Professional title integration.

RIGHT SIDE:

Main protagonist.

Supporting characters.

Dynamic action pose.

Cinematic depth.

Professional anime composition.

Background integrated naturally.

════════════════════════════════════
BRANDING
════════════════════════════════════

TOP RIGHT:

Small premium RS ANIME logo.

Luxury crown icon.

Elegant and minimal.

BOTTOM LEFT:

Telegram logo icon.

TG :- @CARTOONFUNNY03

Website icon.

WEBSITE :- RS ANIME

Branding must be clean.

Branding must be readable.

Branding must look premium.

Branding must never overpower the anime artwork.

════════════════════════════════════
BACKGROUND DESIGN
════════════════════════════════════

Match the original anime world.

If fantasy:

- Magic effects
- Glowing skies
- Epic scenery

If action:

- Energy effects
- Explosions
- Motion streaks

If romance:

- Emotional atmosphere
- Soft cinematic lighting

If dark:

- Shadows
- Dramatic lighting
- Cinematic contrast

If sci-fi:

- Futuristic lighting
- Advanced technology effects

Everything should feel authentic to the anime.

════════════════════════════════════
EXTRA EFFECTS
════════════════════════════════════

Particles.

Energy aura.

Light rays.

Atmospheric depth.

Motion blur.

Cinematic smoke.

Volumetric lighting.

Lens effects.

Professional color grading.

Anime studio quality effects.

════════════════════════════════════
STRICT RULES
════════════════════════════════════

NO release year.

NO dates.

NO episode numbers.

NO season numbers.

NO random text.

NO watermarks.

NO distorted faces.

NO extra fingers.

NO blurry eyes.

NO low quality rendering.

NO cartoon style.

NO western animation influence.

NO generic AI characters.

════════════════════════════════════
FINAL RESULT
════════════════════════════════════

The final image must look like an official anime promotional banner created by a professional Japanese anime studio marketing team.

The anime should be instantly recognizable.

The characters should be recognizable.

The composition should feel premium.

The artwork should feel cinematic.

The banner should feel suitable for Crunchyroll, Netflix, Aniplex, Toho, MAPPA, A-1 Pictures, Madhouse, Bones, Wit Studio, or Ufotable level marketing presentation.

Ultra professional.

Ultra cinematic.

Ultra detailed.

Anime fans should instantly recognize the anime.`;
}


function defaultLogoPrompt(title: string): string {
  const upper = title.toUpperCase();
  return `Official anime TITLE LOGO for "${title}", square 1:1. Title "${upper}" rendered in the canonical official logo treatment of the real anime (matching font, colors, glow, ornaments). Japanese kanji of the title below in small elegant typography. Deep black radial gradient background with atmospheric particles. High resolution, perfect kerning, crisp edges, no foreground characters, no extra text.`;
}

function buildPrompt(body: Body): string {
  if (body.customPrompt && body.customPrompt.trim()) {
    return body.customPrompt
      .replace(/\{title\}/gi, body.title)
      .replace(/\[WRITE ANIME NAME HERE\]/gi, body.title);
  }
  return body.mode === "logo" ? defaultLogoPrompt(body.title) : defaultBackdropPrompt(body.title, body.year);
}

async function genWithLovable(prompt: string, mode: "backdrop" | "logo", model?: string): Promise<Uint8Array> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const chosen = model || "openai/gpt-image-2";

  let body: Record<string, unknown>;
  if (chosen.startsWith("google/")) {
    body = {
      model: chosen,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    };
  } else {
    body = {
      model: chosen,
      prompt,
      size: mode === "logo" ? "1024x1024" : "1536x1024",
      quality: "medium",
      n: 1,
    };
  }

  const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (res.status === 402) throw new Error("PAYMENT_REQUIRED — Lovable AI credits exhausted");
    throw new Error(`Lovable AI ${res.status}: ${t.slice(0, 220)}`);
  }
  const j = await res.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Lovable AI: no image data in response");
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bin.byteLength < 1000) throw new Error("Lovable AI: image too small");
  return bin;
}

// ---------------- Image-to-image (Gemini) using a TMDB/IMDB reference ----------------
async function fetchAsDataUrl(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`reference fetch ${r.status}`);
  const ct = r.headers.get("content-type") || "image/jpeg";
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return `data:${ct};base64,${btoa(bin)}`;
}

function buildGroundedPrompt(b: Body): string {
  const genreLine = b.genres?.length ? b.genres.join(", ") : "(unknown — infer from reference image)";
  const overview = (b.overview || "").trim().slice(0, 600);
  const upperTitle = b.title.toUpperCase();
  return `You are designing an ULTRA-PROFESSIONAL 16:9 anime promotional banner for "${b.title}" — Crunchyroll / Netflix / official studio marketing quality.

ANIME TITLE: "${b.title}"${b.year ? ` (${b.year})` : ""}
OFFICIAL GENRE(S): ${genreLine}
OVERVIEW: ${overview || "(none provided)"}

═══════ ROLE OF THE REFERENCE IMAGE ═══════
The reference image is provided ONLY to identify the OFFICIAL CHARACTERS of this anime. You MUST:
- Preserve the EXACT characters from the reference: hair color & style, eye color, face shape, body proportions, outfit, weapons, accessories, age, gender.
- NOT copy the reference's composition, framing, background, lighting or layout.
- Re-design EVERYTHING ELSE from scratch with your own ultra-professional creative direction.

═══════ DESIGN FREEDOM ═══════
You are the art director. Compose the banner however looks most cinematic and click-worthy for this specific anime's mood and genre (${genreLine}). Choose your own:
- Composition, character poses, camera angle, depth, lighting, color grading
- Background scenery, particles, effects (genre-appropriate)
- Title typography style (must feel like an official anime logo, not generic AI text)
- Decorative UI elements, accent shapes, frames

Quality bar: must look like it was made by a top-tier anime marketing studio. NOT amateur, NOT generic AI banner, NOT fanart.

═══════ MANDATORY BRANDING (small, elegant, never overpowering) ═══════
- TOP-RIGHT CORNER: small premium "RS ANIME" badge with a minimal crown icon.
- BOTTOM-LEFT: two small clean chips on a subtle glass bar:
    • Telegram icon + "TG :- @CARTOONFUNNY03"
    • Globe icon + "WEBSITE :- RS ANIME"
- Branding text MUST be sharp, perfectly legible English. No garbled letters. No other random text/watermarks.

═══════ TITLE TEXT ═══════
- The anime title "${upperTitle}" must appear large and stylized, integrated naturally into the composition. Treat it like the official logo of the show — choose typography that fits the genre (brushstroke for action, elegant serif for romance, neon for sci-fi, etc.).
- Optional small Japanese kanji subtitle.

═══════ STYLE — JAPANESE ANIME ONLY (HARD LOCK) ═══════
- MUST be authentic Japanese anime key-visual art (ufotable / MAPPA / Wit Studio / A-1 / Madhouse / Bones quality).
- Ultra-detailed official anime key visual, 4K HDR, sharp linework, cel-shading, realistic anime proportions, expressive anime eyes.
- Cinematic genre-matched lighting, deep blacks, vibrant highlights, anime-accurate palette.

═══════ STRICT NO-GO — DO NOT VIOLATE ═══════
- ❌ ABSOLUTELY NO Western cartoon style (no Disney, Pixar, DreamWorks, Cartoon Network, Nickelodeon, Simpsons, Family Guy, Adventure Time, Steven Universe look).
- ❌ NO 3D Pixar/CGI, NO chibi, NO super-deformed, NO kiddie/preschool/baby cartoon style, NO mascot art, NO rubber-hose limbs, NO oversized round heads.
- ❌ NO flat vector cartoon, NO sticker art, NO coloring-book outlines, NO American comic-book style.
- ❌ NO childish, silly, goofy, or cute-baby tone — this is a mature cinematic anime banner.
- NO year / release date numbers anywhere.
- NO deformed faces, extra fingers, blurry textures.
- NO generic stock AI typography — title must look like an official anime logo treatment.
- DO NOT replicate the reference image's layout or background — only borrow the characters.
- IF THE OUTPUT LOOKS LIKE A CARTOON OR KIDS SHOW IN ANY WAY, IT IS WRONG — produce only true Japanese anime style.

OUTPUT: one ultra-professional 16:9 anime promotional banner, original art-directed composition, with the official characters from the reference preserved, genre-faithful mood, stylized "${upperTitle}" title, RS ANIME crown badge top-right, Telegram + Website chips bottom-left.`;
}

async function genWithLovableEdit(prompt: string, referenceDataUrl: string, model?: string): Promise<Uint8Array> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const chosen = model || "google/gemini-3.1-flash-image-preview";
  const body = {
    model: chosen,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: referenceDataUrl } },
        { type: "text", text: prompt },
      ],
    }],
    modalities: ["image", "text"],
  };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (res.status === 402) throw new Error("PAYMENT_REQUIRED — Lovable AI credits exhausted");
    throw new Error(`Lovable AI edit ${res.status}: ${t.slice(0, 220)}`);
  }
  const j = await res.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Lovable AI edit: no image data in response");
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bin.byteLength < 1000) throw new Error("Lovable AI edit: image too small");
  return bin;
}

async function genWithFlux(prompt: string, mode: "backdrop" | "logo"): Promise<string> {
  const ar = mode === "logo" ? "1:1" : "16:9";
  // Aggressive aspect + style guard for Flux (weaker than Lovable AI on anatomy/composition).
  const guardedPrompt =
    mode === "logo"
      ? `${prompt}

STRICT REQUIREMENTS: square 1:1 frame, centered title text only, NO characters, NO faces, NO bodies. Deep black gradient background. Crisp logo typography only. Match the official anime title logo style exactly.`
      : `${prompt}

STRICT REQUIREMENTS: wide cinematic 16:9 landscape composition (NOT square, NOT portrait). Subject must fill the frame, no black bars, no letterboxing. Official anime characters of the show, exact canonical hair, eyes, outfit. No deformed anatomy. Professional Crunchyroll / Netflix promotional banner quality. Ultra detailed, 4K, HDR, no watermarks, no random text.`;
  const url = `https://r-gengpt-api.vercel.app/api/image?prompt=${encodeURIComponent(guardedPrompt)}&style=realistic&ar=${ar}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Flux API ${res.status}`);
  const j = await res.json();
  if (j?.status !== "success" || !j?.data?.url) {
    throw new Error(`Flux API: ${j?.message || "no url returned"}`);
  }
  return j.data.url as string;
}


async function uploadToImgbb(bytes: Uint8Array, name: string): Promise<string> {
  let lastErr: unknown;
  for (const key of IMGBB_KEYS) {
    try {
      const fd = new FormData();
      const blob = new Blob([bytes], { type: "image/png" });
      fd.append("image", blob, `${name}.png`);
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
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, service: "generate-backdrop", providers: ["lovable", "flux"] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const body = (await req.json()) as Body;
    if (!body?.title || !body?.animeId) {
      return new Response(JSON.stringify({ error: "title and animeId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mode = body.mode === "logo" ? "logo" : "backdrop";
    const provider = body.provider === "flux" ? "flux" : "lovable";
    const prompt = buildPrompt({ ...body, mode });

    const safe = body.animeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    let url: string;
    let engineLabel: string = provider;

    const useRef = mode === "backdrop"
      && provider === "lovable"
      && !!body.referenceImageUrl
      && body.useReference !== false;

    if (provider === "flux") {
      url = await genWithFlux(prompt, mode);
    } else if (useRef) {
      // IMAGE-TO-IMAGE: ground on TMDB/IMDB backdrop, preserve characters + genre.
      try {
        const refDataUrl = await fetchAsDataUrl(body.referenceImageUrl!);
        const groundedPrompt = (body.customPrompt && body.customPrompt.trim())
          ? body.customPrompt.replace(/\{title\}/gi, body.title)
          : buildGroundedPrompt(body);
        const bytes = await genWithLovableEdit(groundedPrompt, refDataUrl, body.model);
        url = await uploadToImgbb(bytes, `${mode}_ref_${safe}_${Date.now()}`);
        engineLabel = "lovable-edit";
      } catch (e: any) {
        console.warn("[generate-backdrop] image-to-image failed, falling back to text-to-image:", e?.message || e);
        const bytes = await genWithLovable(prompt, mode, body.model);
        url = await uploadToImgbb(bytes, `${mode}_${safe}_${Date.now()}`);
        engineLabel = "lovable-fallback";
      }
    } else {
      const bytes = await genWithLovable(prompt, mode, body.model);
      url = await uploadToImgbb(bytes, `${mode}_${safe}_${Date.now()}`);
    }

    return new Response(JSON.stringify({ ok: true, url, mode, engine: engineLabel }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error("[generate-backdrop]", msg);
    const status = msg === "RATE_LIMIT" ? 429 : msg.includes("PAYMENT_REQUIRED") ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
