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
}

function defaultBackdropPrompt(title: string, year?: string | number): string {
  const yr = year ? String(year) : "";
  return `CREATE A PROFESSIONAL 16:9 CINEMATIC ANIME PROMOTIONAL BANNER FOR "${title}" (${yr}) IN ULTRA DETAILED 4K HDR QUALITY.

Use ONLY the OFFICIAL canonical main characters of "${title}" — exact signature hairstyle, eye design, official outfit, accessories, weapons. Characters must be instantly recognizable to anime fans. Do NOT invent characters or use generic anime faces. Hero protagonist on the right 55% of frame; supporting cast in official hierarchy.

Background inspired by official key visuals of "${title}": signature environment, atmospheric particles, HDR rim lighting, cinematic fog, dynamic motion effects. Match the anime's signature color palette and mood (action: red/blue/orange; fantasy: gold/purple; sci-fi: cyan/neon; dark: red/black/purple).

Style: Netflix / Crunchyroll / official anime promotional banner quality, magazine cover composition, sharp focus, perfect hand anatomy, glossy expressive eyes, no deformed faces, no watermarks, no random text. Ultra detailed, 4K resolution, HDR, premium finish.

The final result must look like an OFFICIAL anime poster remastered into a premium cinematic banner.`;
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

async function genWithFlux(prompt: string, mode: "backdrop" | "logo"): Promise<string> {
  const ar = mode === "logo" ? "1:1" : "16:9";
  const url = `https://r-gengpt-api.vercel.app/api/image?prompt=${encodeURIComponent(prompt)}&style=realistic&ar=${ar}`;
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
