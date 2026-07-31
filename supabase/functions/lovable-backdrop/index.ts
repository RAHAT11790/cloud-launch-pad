// Lovable AI Gateway-backed backdrop/logo generator.
// Default model: openai/gpt-image-2 (ChatGPT-quality). Falls back to Gemini
// only when a reference image is attached (gpt-image-2 has different edit shape).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/images/generations";
const DEFAULT_MODEL = "google/gemini-3.1-flash-image";
const GEMINI_FALLBACK_MODEL = "google/gemini-3.1-flash-image";
const IMGBB_KEY = "d5c0bce7c98c54d813bf285ffe453689";

interface Body {
  title?: string;
  mode?: "backdrop" | "logo";
  referenceImageUrl?: string;
  useReference?: boolean;
  customPrompt?: string;
  genres?: string[];
  overview?: string;
  year?: string | number;
  action?: "check-lovable";
  model?: string;
  quality?: "low" | "medium" | "high";
}

function backdropPrompt(b: Body): string {
  if (b.customPrompt?.trim()) {
    return b.customPrompt.replace(/\{title\}/gi, b.title || "").replace(/\[WRITE ANIME NAME HERE\]/gi, b.title || "");
  }
  const t = b.title || "";
  const genres = b.genres?.length ? b.genres.join(", ") : "";
  const overview = (b.overview || "").trim().slice(0, 500);
  return `Create an ULTRA-PROFESSIONAL 16:9 anime promotional banner — Crunchyroll / Netflix key-visual quality — for "${t}"${b.year ? ` (${b.year})` : ""}.
${genres ? `Genres: ${genres}.` : ""} ${overview ? `Overview: ${overview}.` : ""}

STYLE LOCK: Japanese anime ONLY (ufotable / MAPPA / Wit / Bones quality). Sharp cel-shaded linework, cinematic HDR lighting, atmospheric particles, deep cinematic palette. NO Western cartoon / 3D Pixar / chibi.

CHARACTERS: use the canonical official anime characters of "${t}" — exact hair, eyes, outfit, weapons. Hero front-and-center, supports layered behind with depth.

LAYOUT (16:9): Left — stylized anime title "${t}" in bold brushstroke logo typography + small kanji subtitle. Right — hero in dynamic cinematic pose.

BRANDING: top-right small "RS ANIME" badge with crown. Bottom-left small glass chips: "TG :- @CARTOONFUNNY03" and "WEBSITE :- RS ANIME".

4K ultra-detailed, sharp focus, perfect anatomy, no watermarks, no random text, no year numbers.`;
}

function logoPrompt(b: Body): string {
  if (b.customPrompt?.trim()) {
    return b.customPrompt.replace(/\{title\}/gi, b.title || "");
  }
  const t = b.title || "";
  return `Official anime TITLE LOGO for "${t}", square 1:1. Title "${t.toUpperCase()}" rendered in canonical official logo treatment of the real anime (matching font, colors, glow, ornaments). Japanese kanji of the title below in small elegant typography. Deep black radial gradient background with atmospheric particles. High resolution, perfect kerning, crisp edges, no foreground characters, no extra text.`;
}

async function uploadToImgBB(b64: string): Promise<string> {
  const form = new FormData();
  form.append("image", b64);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method: "POST", body: form });
  const j = await res.json();
  if (!j?.data?.url) throw new Error("ImgBB upload failed");
  return j.data.url as string;
}

async function fetchAsBase64(url: string): Promise<{ b64: string; mime: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Reference image fetch failed (${r.status})`);
  const mime = r.headers.get("Content-Type") || "image/jpeg";
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return { b64: btoa(bin), mime };
}

// Domain allowlist — this endpoint is admin-only from the RS Anime panel.
const ALLOWED_HOST_RX = [
  /\.lovable\.app$/i,
  /\.lovableproject\.com$/i,
  /^rsanime03\.lovable\.app$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/i,
];
const matchesAllowedHost = (u: string | null) => {
  if (!u) return false;
  try { return ALLOWED_HOST_RX.some((rx) => rx.test(new URL(u).host)); } catch { return false; }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!matchesAllowedHost(origin) && !matchesAllowedHost(referer)) {
    return new Response(JSON.stringify({ error: "Access denied" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body = {};
  try { body = await req.json(); } catch {}

  // Health probe
  if (body.action === "check-lovable") {
    try {
      const probe = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          prompt: "ping",
          size: "1024x1024",
          quality: "low",
          n: 1,
        }),
      });
      const ok = probe.status < 500 && probe.status !== 401 && probe.status !== 402;
      let msg = "Gateway reachable";
      if (probe.status === 402) msg = "Out of Lovable credits";
      else if (probe.status === 429) msg = "Rate-limited";
      else if (probe.status === 401) msg = "Invalid key";
      return new Response(JSON.stringify({
        lovable: { ok, model: DEFAULT_MODEL, message: msg, status: probe.status },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ lovable: { ok: false, error: String((e as Error).message) } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const mode = body.mode || "backdrop";
    const prompt = mode === "logo" ? logoPrompt(body) : backdropPrompt(body);
    const model = body.model || DEFAULT_MODEL;
    const useRef = mode === "backdrop" && body.useReference && !!body.referenceImageUrl;

    let endpoint = GATEWAY_URL;
    let payload: Record<string, unknown>;
    if (useRef) {
      // Reference-image editing uses the chat-completions image shape.
      endpoint = "https://ai.gateway.lovable.dev/v1/chat/completions";
      const { b64, mime } = await fetchAsBase64(body.referenceImageUrl!);
      payload = {
        model: GEMINI_FALLBACK_MODEL,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        }],
        modalities: ["image", "text"],
      };
    } else {
      payload = {
        model,
        prompt,
        size: mode === "logo" ? "1024x1024" : "1536x1024",
        n: 1,
      };
    }

    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify(payload),
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      let error = `Lovable AI ${upstream.status}: ${raw.slice(0, 300)}`;
      if (upstream.status === 402) error = "Out of Lovable AI credits — add credits in workspace billing to generate images.";
      else if (upstream.status === 429) error = "Rate limited by Lovable AI — try again in a moment.";
      return new Response(JSON.stringify({ error, model }), {
        status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const data = JSON.parse(raw);
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      return new Response(JSON.stringify({ error: "No image returned", raw: data }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = await uploadToImgBB(b64);
    return new Response(JSON.stringify({ url, model, provider: "lovable" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
