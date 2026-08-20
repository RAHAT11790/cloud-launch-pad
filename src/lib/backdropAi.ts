// Shared Backdrop / Logo AI client.
// Used by the standalone admin tab AND by the inline generator embedded in the
// Series / Movie editors, so both always behave identically.
import { supabase } from "@/integrations/supabase/client";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

export type BackdropMode = "backdrop" | "logo";

export const DEFAULT_BACKDROP_PROMPT = `CREATE A PROFESSIONAL 16:9 CINEMATIC ANIME PROMOTIONAL BANNER FOR "{title}" IN ULTRA DETAILED 4K HDR QUALITY.

Use ONLY the OFFICIAL canonical main characters of "{title}" — exact signature hairstyle, eye design, outfit, weapons. Characters must be instantly recognizable. Hero protagonist on the right 55% of frame; supporting cast in official hierarchy.

Style: Netflix / Crunchyroll promotional banner quality, sharp focus, perfect anatomy, no deformed faces, no watermarks. Ultra detailed, 4K, HDR.`;

export const DEFAULT_LOGO_PROMPT = `Official anime TITLE LOGO for "{title}", square 1:1. Title "{title}" rendered in the canonical official logo treatment of the real anime (matching font, colors, glow, ornaments). Japanese kanji of the title below in small elegant typography. Deep black radial gradient background. High resolution, perfect kerning, no foreground characters, no extra text.`;

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
    useReference: false,
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
