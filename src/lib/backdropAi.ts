// Shared Backdrop / Logo AI client.
// Used by the standalone admin tab AND by the inline generator embedded in the
// Series / Movie editors, so both always behave identically.
import { supabase } from "@/integrations/supabase/client";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

export type BackdropMode = "backdrop" | "logo";

export const DEFAULT_BACKDROP_PROMPT = `Create a PROFESSIONAL 16:9 cinematic anime promotional poster/banner in ultra detailed 4K quality.

Style Requirements:
- Modern anime thumbnail/poster design
- Dark cinematic atmosphere with glowing effects
- Ultra high detail anime illustration
- Sharp focus, vibrant lighting, dramatic shadows
- Dynamic composition with depth and motion
- Professional typography and clean layout
- Eye-catching YouTube/Telegram style anime banner
- Highly detailed background matching the anime theme
- Add energy effects, particles, glow, sparks, speed lines, cinematic lighting
- Make the entire design feel PREMIUM and VIRAL

Character Design:
- Use the main anime characters in the most iconic pose
- Characters should look powerful, emotional, stylish, and dynamic
- Anime art must look modern, polished, and studio-quality
- Match the color grading with the anime's theme
- Use detailed anime eyes, hair glow, dramatic expressions

Typography:
- BIG bold stylized anime title text
- Title should feel aggressive, modern, and cinematic
- Use brush-stroke / neon / sharp-edge typography style
- Add a small stylish subtitle for anime aesthetic
- Make the text blend naturally with the effects and background

Branding Layout:
- Top-right corner: small elegant "RS ANIME 03" logo with a crown icon, minimal and premium
- Bottom-left: Telegram logo + text "TG :- @CARTOONFUNNY03"
- Below it: website icon + text "WEBSITE :- RS ANIME 03"
- Use glowing UI bars/shapes around the social links
- Keep branding small but stylish and professional

Color & Theme:
- Match the anime's original mood and genre
- Use cinematic contrast and vibrant colors
- Add blue/red/purple/orange glow depending on the anime vibe
- Use high contrast lighting and realistic anime shading

Quality:
- Ultra detailed, 4K, HDR, professional anime poster
- Trending anime thumbnail style, clean edges, no blur, no watermark

Composition:
- Left side = title and text elements
- Right side = main anime characters/artwork
- Balanced cinematic framing, depth and layered visual effects

Extra Instructions:
- Automatically use the correct original anime release year
- Design must look UNIQUE for every anime, avoid generic layouts
- Official anime key visual mixed with premium YouTube thumbnail design

LANGUAGE LOCK: ENGLISH TEXT ONLY in the artwork — no Japanese, Hindi or Bengali characters.`;

export const DEFAULT_LOGO_PROMPT = `Official anime TITLE LOGO for "{title}", square 1:1. Title "{title}" rendered in the canonical official logo treatment of the real anime (matching font, colors, glow, ornaments). Deep black radial gradient background. High resolution, perfect kerning, no foreground characters, no extra text. ENGLISH TEXT ONLY.`;


/** Different deployments answer with different shapes — normalise to a URL. */
export const pickImageUrl = (json: any): string => {
  if (!json) return "";
  const direct =
    json.url || json.imageUrl || json.image_url || json.backdrop || json.logo ||
    json.output || json.result?.url || json.data?.url;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const arr = Array.isArray(json.data) ? json.data : Array.isArray(json.images) ? json.images : [];
  for (const it of arr) {
    if (typeof it === "string" && it.trim()) return it.trim();
    const u = it?.url || it?.image_url?.url || it?.imageUrl;
    if (typeof u === "string" && u.trim()) return u.trim();
    if (it?.b64_json) return `data:image/png;base64,${it.b64_json}`;
  }
  if (json.b64_json) return `data:image/png;base64,${json.b64_json}`;
  return "";
};

export const getRoutedBackdropUrl = async (): Promise<string> =>
  (await getEdgeFunctionUrl("lovable-backdrop").catch(() => "")) || "";

/** Probe a routed URL for life without assuming any specific API contract. */
export const probeRoutedUrl = async (url: string): Promise<{ ok: boolean; message: string }> => {
  const attempt = async (init: RequestInit): Promise<boolean | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { ...init, signal: ctrl.signal });
      if ((r as any).type === "opaque") return true;
      return r.status < 500;
    } catch { return null; }
    finally { clearTimeout(t); }
  };
  let ok = await attempt({ method: "OPTIONS" });
  if (ok === null) ok = await attempt({ method: "GET" });
  if (ok === null) ok = await attempt({ method: "GET", mode: "no-cors" });
  return ok === true
    ? { ok: true, message: "Custom route reachable" }
    : { ok: false, message: "Custom route unreachable" };
};

const callLovableCloud = async (body: Record<string, any>) => {
  const { data, error } = await supabase.functions.invoke("lovable-backdrop", { body });
  if (error) {
    const err = new Error(error.message || "Lovable AI call failed") as any;
    err.status = (error as any)?.context?.status;
    throw err;
  }
  if (data?.error) {
    const err = new Error(data.error) as any;
    err.status = data.status;
    throw err;
  }
  const url = pickImageUrl(data) || data?.url;
  if (!url) throw new Error("Lovable AI returned no image");
  return { ...(data || {}), url, provider: "lovable" };
};

/**
 * Generate an image. Custom routed URL wins when it works; if it fails for ANY
 * reason (bad deploy, 4xx/5xx, no image in the body) we transparently fall back
 * to the Lovable Cloud function instead of surfacing a dead-end error — the old
 * behaviour was "route pings Online but generation fails".
 */
export const callGenerateBackdrop = async (body: Record<string, any>) => {
  const routed = await getRoutedBackdropUrl();
  if (routed) {
    try {
      const res = await fetch(routed, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.text().catch(() => "");
      let json: any = null;
      try { json = raw ? JSON.parse(raw) : null; } catch {}
      if (!res.ok || json?.error) {
        throw new Error(json?.error || `Backdrop route failed (${res.status})${raw ? ` — ${raw.slice(0, 160)}` : ""}`);
      }
      const url = pickImageUrl(json);
      if (!url) throw new Error("Custom route returned no image");
      return { ...(json || {}), url, provider: "custom-route" };
    } catch (routeErr: any) {
      if (body?.action === "check-lovable") throw routeErr;
      try {
        const fb = await callLovableCloud(body);
        return { ...fb, fallbackFrom: routeErr?.message || String(routeErr) };
      } catch (cloudErr: any) {
        const err = new Error(
          `Custom route: ${routeErr?.message || routeErr} · Lovable: ${cloudErr?.message || cloudErr}`,
        ) as any;
        err.status = cloudErr?.status;
        throw err;
      }
    }
  }
  return callLovableCloud(body);
};

export const buildBackdropPayload = (opts: {
  title: string;
  mode: BackdropMode;
  year?: string | number;
  genres?: string[];
  overview?: string;
  animeId?: string;
  type?: string;
  customPrompt?: string;
  /** Existing TMDB/IMDB backdrop — PERMANENT reference for official characters. */
  referenceImageUrl?: string;
}) => {
  const payload: any = {
    animeId: opts.animeId,
    title: opts.title,
    type: opts.type,
    year: opts.year,
    mode: opts.mode,
    provider: "lovable",
    quality: "medium",
    count: 1,
    // Title + existing backdrop are permanent values — always sent.
    referenceImageUrl: opts.referenceImageUrl || undefined,
    useReference: Boolean(opts.referenceImageUrl),
    genres: opts.genres,
    overview: opts.overview,
  };

  if (opts.customPrompt?.trim()) {
    payload.customPrompt = opts.customPrompt
      .replace(/\{title\}/gi, opts.title)
      .replace(/\[WRITE ANIME NAME HERE\]/gi, opts.title);
  }
  return payload;
};
