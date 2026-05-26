// Generate anime backdrop / logo via Hugging Face Inference API.
// Model: black-forest-labs/FLUX.1-schnell (free, high quality, fast).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const HF_API_KEY = Deno.env.get("HUGGINGFACE_API_KEY") || "";
const HF_MODELS = [
  "black-forest-labs/FLUX.1-schnell",
  "stabilityai/stable-diffusion-xl-base-1.0",
];
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
  return `Official Netflix / Crunchyroll style 16:9 cinematic anime KEY VISUAL banner for "${title}" (${yr}). The real canonical main protagonist of "${title}" rendered with exact signature hair, eye color, outfit, weapon and accessories — instantly recognizable to fans. Heroic dynamic pose pulled from a famous scene. Photorealistic anime shading, glossy expressive eyes, perfect hand anatomy, rim lighting, anamorphic lens flare, atmospheric particles, cinematic HDR color grade matching the anime's signature palette. Character on right 55% of frame, signature environment of the anime behind. Painterly yet razor sharp, magazine cover quality, studio-grade composition. No deformed faces, no extra fingers, no text watermarks, no generic AI faces.`;
}

function logoPrompt(title: string, custom?: string): string {
  if (custom && custom.trim()) return custom.trim().replace(/\{title\}/gi, title);
  const upper = title.toUpperCase();
  return `Official anime TITLE LOGO / title-mark for "${title}", square 1:1, the title "${upper}" rendered in the exact canonical official logo treatment of the real anime (matching font, colors, texture, ornaments, glow, slashes or effects as the real official logo). Japanese kanji of the title below in small elegant typography. Deep black or theme-colored radial gradient background with subtle signature motif and atmospheric particles. High resolution, perfect kerning, painterly micro-texture, crisp edges, no foreground characters, no clutter, no extra text.`;
}

async function genWithHuggingFace(prompt: string, mode: "backdrop" | "logo"): Promise<Uint8Array> {
  if (!HF_API_KEY) throw new Error("HUGGINGFACE_API_KEY missing");
  const params = mode === "logo"
    ? { width: 1024, height: 1024, num_inference_steps: 4, guidance_scale: 0.0 }
    : { width: 1344, height: 768, num_inference_steps: 4, guidance_scale: 0.0 };

  let lastErr: unknown;
  for (const model of HF_MODELS) {
    try {
      const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "image/png",
          "x-wait-for-model": "true",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: params,
          options: { wait_for_model: true },
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        if (res.status === 429) throw new Error("RATE_LIMIT");
        if (res.status === 402 || res.status === 403) throw new Error("HF quota exhausted — check your Hugging Face token");
        throw new Error(`HF ${model} ${res.status}: ${t.slice(0, 200)}`);
      }
      const ct = res.headers.get("content-type") || "";
      if (!ct.startsWith("image/")) {
        const t = await res.text().catch(() => "");
        throw new Error(`HF ${model}: unexpected content-type ${ct} ${t.slice(0, 150)}`);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength < 1000) throw new Error(`HF ${model}: image too small`);
      return buf;
    } catch (e) { lastErr = e; console.error(`[generate-backdrop] HF ${model} failed:`, (e as Error).message); }
  }
  throw lastErr instanceof Error ? lastErr : new Error("HF: all models failed");
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
    const bytes = await genWithHuggingFace(prompt, mode);

    const safe = body.animeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const url = await uploadToImgbb(bytes, `${mode}_${safe}_${Date.now()}`);

    return new Response(JSON.stringify({ ok: true, url, mode, engine: "huggingface" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error("[generate-backdrop] error:", msg);
    const status = msg === "RATE_LIMIT" ? 429 : msg.includes("quota") ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
