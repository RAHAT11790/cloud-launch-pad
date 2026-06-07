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
  return `Create a ULTRA PROFESSIONAL 16:9 anime promotional banner in TRUE ANIME KEY VISUAL style with cinematic thumbnail composition.

Anime Name: ${title}

IMPORTANT:
- DO NOT invent new characters.
- DO NOT redesign the anime characters.
- Use the ORIGINAL OFFICIAL ANIME CHARACTERS from "${title}".
- Characters must look exactly like their original anime/manga appearance.
- Keep original hairstyle, eyes, clothes, face shape, personality, aura, powers, and proportions.
- The characters should instantly be recognizable to anime fans.
- This is NOT fanart redesign. This is an OFFICIAL-STYLE ANIME PROMOTIONAL POSTER.

VISUAL STYLE:
- Modern cinematic anime banner, official key visual mixed with premium YouTube thumbnail style
- High contrast anime lighting, ultra detailed anime rendering, HDR, 4K quality
- Sharp anime linework, dynamic composition, professional color grading, beautiful glow
- Premium typography, anime studio quality, clean polished details
- No blurry faces, no distorted anatomy, no extra fingers, no low quality textures

LAYOUT (16:9 widescreen):
- LEFT SIDE: Large stylized anime title text, Japanese subtitle text, tagline/slogan, social branding section
- RIGHT SIDE: Main anime character artwork, supporting characters layered behind, cinematic action scene, anime-themed background

CHARACTER POSITIONING:
- Main protagonist center/right focus
- Secondary characters layered in background, cinematic depth, motion and energy, anime-accurate expressions

BACKGROUND (match original anime mood):
- Action → explosions, energy, destruction, speed effects
- Romance → soft lighting, emotional atmosphere
- Dark → shadows, neon, cinematic contrast
- Sports → stadium lights, motion blur, action effects
- Fantasy → magic particles, glowing skies, epic scenery

TEXT DESIGN:
- BIG bold anime title "${title}" in aggressive modern typography (brushstroke / neon / sharp-edge style fonts)
- Text integrated naturally into composition
- Japanese typography under the title
- Make title look official and cinematic

BRANDING:
- TOP RIGHT: small premium "RS ANIME" logo with crown, minimal and elegant
- BOTTOM LEFT: Telegram icon + "TG :- @CARTOONFUNNY03", Website icon + "WEBSITE :- RS ANIME"
- Use glowing UI bars/shapes around branding — stylish but not distracting

COLOR:
- Match original anime mood, rich cinematic colors, deep blacks, strong highlights, anime-accurate palette, vibrant glow

EXTRA EFFECTS:
- Particles, energy aura, rain/smoke/fire/lightning depending on anime, depth of field, motion blur, floating debris, cinematic atmosphere

STRICT — DO NOT include any year, release date, or numerical date anywhere in the artwork.

FINAL RESULT:
- Must look like an official Netflix/Crunchyroll anime promotional banner
- Highly click-worthy viral anime thumbnail quality
- Professional anime marketing artwork
- Anime fans should instantly recognize the anime
- Preserve original anime identity completely
- Visual style should match the reference "CAPTAIN TSUBASA" banner layout (big brushstroke title left, hero character right, RS ANIME crown logo top-right, TG + WEBSITE chips bottom-left)`;
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
  return `You are editing/remastering a PROMOTIONAL ANIME BANNER based on the REFERENCE IMAGE provided.

ANIME TITLE: "${b.title}"${b.year ? ` (${b.year})` : ""}
OFFICIAL GENRE(S): ${genreLine}
OVERVIEW: ${overview || "(none provided)"}

CRITICAL RULES — do not violate:
1. PRESERVE THE EXACT CHARACTERS from the reference image. Same hair color, hair style, eye color, face shape, body proportions, outfit, weapons, accessories, age, gender. Do NOT invent new characters. Do NOT replace them with generic anime faces.
2. PRESERVE THE GENRE MOOD. Genre is ${genreLine}. Do NOT turn romance/slice-of-life into action. Do NOT add explosions, weapons, or aggressive poses unless the genre is Action/Shounen/Battle.
3. ASPECT RATIO: 16:9 cinematic widescreen, full bleed, no letterboxing.
4. STYLE: ultra-detailed official anime key visual / Crunchyroll-Netflix promotional banner. 4K HDR. Sharp linework. Clean anatomy. Cinematic lighting matching the genre mood.
5. COMPOSITION: keep the same main character(s) as the reference, re-pose / re-light / re-frame them into a premium banner. Add atmospheric background that matches the genre (soft pastel + petals for romance; magic particles for fantasy; neon for sci-fi; battle aura ONLY for action).
6. NO text, NO watermarks, NO logos in the output image.

OUTPUT: a single remastered 16:9 anime promotional banner faithful to the reference characters and the stated genre.`;
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

    if (provider === "flux") {
      url = await genWithFlux(prompt, mode);
    } else {
      const bytes = await genWithLovable(prompt, mode, body.model);
      url = await uploadToImgbb(bytes, `${mode}_${safe}_${Date.now()}`);
    }

    return new Response(JSON.stringify({ ok: true, url, mode, engine: provider }), {
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
