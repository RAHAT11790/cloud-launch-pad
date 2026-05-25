// Generate cinematic 16:9 anime backdrop and upload to ImgBB.
// Primary engine: Lovable AI Gateway (google/gemini-2.5-flash-image — Nano Banana)
//   → uses LOVABLE_API_KEY, NO 10/day limit, metered via workspace credits.
// Fallback engine: innocent-ai.top (if user prefers external endpoint).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const INNOCENT_AI_API_KEY = Deno.env.get("INNOCENT_AI_API_KEY") || "";
const IMGBB_KEYS = ["d5c0bce7c98c54d813bf285ffe453689"];

interface Body {
  animeId: string;
  title: string;
  type?: "webseries" | "movies";
  engine?: "lovable" | "innocent";
  customPrompt?: string;
}

function buildPrompt(title: string, custom?: string): string {
  if (custom && custom.trim()) return custom.trim().replace(/\{title\}/gi, title);
  return [
    `Cinematic 16:9 ultra-wide anime key visual backdrop for "${title}".`,
    `Hero composition with the main character(s) prominent, dramatic backlight, volumetric atmosphere, lens flares, deep depth of field, vibrant cinematic color grading (teal-orange).`,
    `Bold title text "${title.toUpperCase()}" rendered with stylish anime display typography overlaid on the lower-left third — clean, legible, with subtle glow.`,
    `Top-right corner: small refined "RS ANIME" wordmark badge.`,
    `Bottom-left corner: tiny telegram tag "@rsanime03".`,
    `High detail, 4K, ultra sharp, official poster quality, no watermark, no extra logos, 16:9 widescreen.`,
  ].join(" ");
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

async function genWithInnocent(prompt: string): Promise<Uint8Array> {
  if (!INNOCENT_AI_API_KEY) throw new Error("INNOCENT_AI_API_KEY missing");
  // innocent-ai.top nano banana endpoint
  const res = await fetch("https://innocent-ai.top/api/nano2.php", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${INNOCENT_AI_API_KEY}` },
    body: JSON.stringify({ prompt, size: "1920x1080", api_key: INNOCENT_AI_API_KEY }),
  });
  if (!res.ok) throw new Error(`innocent-ai ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.startsWith("image/")) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf;
  }
  const data = await res.json();
  const imgUrl: string | undefined = data?.url || data?.image_url || data?.data?.[0]?.url;
  const b64: string | undefined = data?.b64_json || data?.image || data?.data?.[0]?.b64_json;
  if (b64) return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (imgUrl) {
    const r = await fetch(imgUrl);
    return new Uint8Array(await r.arrayBuffer());
  }
  throw new Error("innocent-ai: no image in response");
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
    const prompt = buildPrompt(body.title, body.customPrompt);
    const engine = body.engine || "lovable";

    let bytes: Uint8Array;
    let usedEngine = engine;
    try {
      bytes = engine === "innocent" ? await genWithInnocent(prompt) : await genWithLovable(prompt);
    } catch (e: any) {
      // auto-fallback
      const msg = String(e?.message || e);
      console.warn(`[generate-backdrop] ${engine} failed: ${msg} — trying fallback`);
      if (engine === "lovable" && INNOCENT_AI_API_KEY) {
        bytes = await genWithInnocent(prompt);
        usedEngine = "innocent";
      } else if (engine === "innocent" && LOVABLE_API_KEY) {
        bytes = await genWithLovable(prompt);
        usedEngine = "lovable";
      } else {
        throw e;
      }
    }

    const safe = body.animeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const url = await uploadToImgbb(bytes, `bd_${safe}_${Date.now()}`);

    return new Response(JSON.stringify({ ok: true, url, engine: usedEngine }), {
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
