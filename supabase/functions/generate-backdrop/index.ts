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

═══════════ ABSOLUTE STYLE LOCK — READ FIRST ═══════════
THIS IS A JAPANESE ANIME KEY VISUAL. NOT A WESTERN CARTOON. NOT A KIDS SHOW.
STRICTLY FORBIDDEN STYLES (DO NOT PRODUCE ANY OF THESE UNDER ANY CIRCUMSTANCE):
- ❌ NO Western cartoon style (no Disney, no Pixar, no DreamWorks, no Cartoon Network, no Nickelodeon, no Adventure Time, no Steven Universe, no Family Guy, no Simpsons look).
- ❌ NO 3D Pixar/CGI rendering, NO toy-like plastic shading, NO chibi, NO super-deformed, NO cute mascot, NO baby/kiddie style.
- ❌ NO rubber-hose limbs, NO oversized round heads on tiny bodies, NO flat vector cartoon look, NO sticker-art, NO comic-book Marvel/DC American style.
- ❌ NO childish coloring-book outlines, NO crayon shading, NO simplified preschool art.
IF THE OUTPUT LOOKS LIKE A CARTOON IN ANY WAY, IT IS WRONG. REGENERATE AS PROPER ANIME.

MANDATORY STYLE — JAPANESE ANIME ONLY:
- ✅ Authentic Japanese anime art (in the style of ufotable, MAPPA, Wit Studio, Bones, A-1 Pictures, Madhouse, Kyoto Animation, Shaft).
- ✅ Sharp anime linework, detailed cel-shading, realistic anime proportions, expressive anime eyes, sharp facial features.
- ✅ Cinematic anime lighting, HDR color grading, depth of field, atmospheric particles.
- ✅ Mature, cinematic, cool/serious tone — NOT childish, NOT silly, NOT goofy.
- ✅ Looks like an official anime Blu-ray cover or theatrical poster.

CHARACTERS:
- Use the ORIGINAL OFFICIAL ANIME CHARACTERS from "${title}" — exact canonical hair, eyes, outfit, weapons, aura, age, proportions.
- DO NOT redesign, DO NOT cartoonify, DO NOT chibi-fy.
- Anime fans must instantly recognize the characters from the real show.
- Main protagonist front-and-center / right; supporting characters layered with cinematic depth.

LAYOUT (16:9 widescreen, like the reference "CAPTAIN TSUBASA" / "SCUM OF THE BRAVE" banners):
- LEFT SIDE: large stylized anime title "${title}" in bold brushstroke / sharp-edged anime logo typography. Small Japanese kanji subtitle below. Optional one-line tagline.
- RIGHT SIDE: hero anime character artwork in a dynamic cinematic pose, supporting characters behind.
- Background matches the anime's true genre mood (action → energy/sparks/destruction; romance → soft bokeh; dark/horror → shadow/neon; sports → stadium lights/motion; fantasy → magic particles).

BRANDING (small, premium, never childish):
- TOP-RIGHT: small "RS ANIME" badge with a minimal crown icon.
- BOTTOM-LEFT: clean glass chips — Telegram icon + "TG :- @CARTOONFUNNY03"  and  Globe icon + "WEBSITE :- RS ANIME".
- All branding text must be crisp, perfectly legible English. No garbled letters.

COLOR & FINISH:
- Rich cinematic anime palette, deep blacks, vibrant highlights, glow, lens flares, particles, motion lines where appropriate.
- 4K ultra-detailed, sharp focus, no blur on faces, no extra fingers, no deformed anatomy, no watermarks, no random text.

STRICT:
- DO NOT include any year, date, or version number anywhere in the artwork.
- DO NOT add any cartoon mascots, emojis, or kiddie decorations.
- The final image MUST look like a real official Japanese anime promotional key visual — indistinguishable from one made by an actual anime studio's marketing team.

FINAL CHECK BEFORE OUTPUT: If the image looks like a Western cartoon, a kids' show, Pixar 3D, chibi, or anything childish — IT IS WRONG. Output ONLY professional Japanese anime key-visual style.`;
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

═══════ STYLE ═══════
- Ultra-detailed official anime key visual, 4K HDR, sharp linework, clean anatomy.
- Cinematic genre-matched lighting and atmosphere.
- Rich cinematic colors, deep blacks, vibrant highlights, anime-accurate palette.

═══════ STRICT NO-GO ═══════
- NO year / release date numbers anywhere.
- NO deformed faces, extra fingers, blurry textures.
- NO generic stock AI typography — title must look like an official anime logo treatment.
- DO NOT replicate the reference image's layout or background — only borrow the characters.

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
