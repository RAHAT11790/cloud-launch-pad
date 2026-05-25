// Generate ULTRA-PROFESSIONAL cinematic 16:9 anime backdrop and upload to ImgBB.
// Engine: Lovable AI Gateway — google/gemini-2.5-flash-image (Nano Banana).
// No daily caps, metered via workspace credits — can generate thousands.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const IMGBB_KEYS = ["d5c0bce7c98c54d813bf285ffe453689"];

interface Body {
  animeId: string;
  title: string;
  type?: "webseries" | "movies";
  year?: string | number;
  customPrompt?: string;
}

function buildPrompt(title: string, year?: string | number, custom?: string): string {
  if (custom && custom.trim()) return custom.trim().replace(/\{title\}/gi, title);
  const yr = year ? String(year) : "";
  const upper = title.toUpperCase();

  return [
    `Create an ULTRA-PROFESSIONAL 16:9 widescreen cinematic anime promotional banner / key-visual backdrop for the anime titled "${title}". The image must be of MAGAZINE-COVER, OFFICIAL-POSTER quality — the kind that makes viewers instantly fall in love with the show.`,

    `1. SUBJECT — Identify the most iconic main character(s) of "${title}" and render them in the most powerful, dramatic, fan-favorite signature pose / hero scene from the actual anime (e.g. their signature attack, signature stance, or most memorable scene). Faces sharp, eyes vivid, clean anime line-art, dynamic motion, intricate detail, highly polished official-anime production quality. Full body or upper-body composition that fills the right 55% of the frame.`,

    `2. ENVIRONMENT — Atmospheric, mood-setting background that fits the anime's actual world (battlefield, sci-fi lab, sports stadium, fantasy realm, post-apocalyptic landscape, etc.). Volumetric light rays, particles, debris, motion streaks, deep depth of field, cinematic teal/orange or signature color grading matching the anime's tone. Subtle decorative manga-panel collage or supporting characters tastefully blended in the right edge.`,

    `3. TITLE TYPOGRAPHY — On the LEFT 45% of the frame, render the anime title "${upper}" in a HUGE, BOLD, modern display font that matches the anime's genre vibe (e.g. distressed grunge for thriller, brush-stroke for sports/shounen, sharp serif for psychological, sci-fi sans for futuristic). The title must be the visual hero — clean, perfectly legible, multi-line if long, with subtle glow/stroke/shadow. Above the title, a small tagline label like "${yr ? yr + " " : ""}ANIME SERIES" or "NEW ANIME" in thin uppercase tracking. Below the title, an elegant tagline phrase (in Japanese kanji + English subtitle if it fits the style) — short, punchy, atmospheric.`,

    `4. BRAND BADGES — TOP-RIGHT corner: a clean "RS ANIME" wordmark badge with a small crown icon above the "RS" letters (the official RS Anime logo). BOTTOM-LEFT: two small modern pill-shaped info badges stacked — first badge with a Telegram paper-plane icon and the text "TG :- @CARTOONFUNNY03", second badge with a globe icon and the text "WEBSITE :- RS ANIME". Pills have subtle glassy / dark translucent background with a thin colored stroke matching the accent color of the design.`,

    `5. STYLE & QUALITY — Award-winning anime key-visual aesthetic, 4K crisp, dramatic backlight, lens flares, cinematic colour grading, painterly highlights, professional poster composition with strict 16:9 ratio. NO watermarks, NO extra logos, NO random text, NO duplicated UI, NO blurry edges. Every element pixel-perfect, balanced, and polished. The final result must look like an OFFICIAL Netflix / Crunchyroll / Aniplex promotional key-visual for "${title}".`,
  ].join("\n\n");
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
    const prompt = buildPrompt(body.title, body.year, body.customPrompt);
    const bytes = await genWithLovable(prompt);

    const safe = body.animeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const url = await uploadToImgbb(bytes, `bd_${safe}_${Date.now()}`);

    return new Response(JSON.stringify({ ok: true, url, engine: "lovable" }), {
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
