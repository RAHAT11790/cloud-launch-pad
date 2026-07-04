// Lovable AI Gateway-backed backdrop/logo generator.
// Auto-deployed by Lovable. Uses LOVABLE_API_KEY (auto-provisioned).
// Called directly from BackdropAiReplacer via supabase.functions.invoke("lovable-backdrop", ...).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/images/generations";
const DEFAULT_MODEL = "google/gemini-3.1-flash-image-preview";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
          messages: [{ role: "user", content: "ping" }],
          modalities: ["image", "text"],
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

    // Build Gemini-style messages with optional reference image
    const content: any[] = [{ type: "text", text: prompt }];
    if (mode === "backdrop" && body.useReference && body.referenceImageUrl) {
      const { b64, mime } = await fetchAsBase64(body.referenceImageUrl);
      content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
    }

    const upstream = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
      }),
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      return new Response(JSON.stringify({
        error: `Lovable AI ${upstream.status}: ${raw.slice(0, 300)}`,
      }), { status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
