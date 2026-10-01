// ============================================================
// Abyss link support — resolves an Abyss player link into direct,
// Range-seekable MP4 qualities that play inside OUR VideoPlayer.
// The resolver runs server-side (EGD Router row `abyss`, falling back to
// the built-in backend function), so the Abyss iframe/ads never load.
// ============================================================
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

export interface AbyssSource { label: string; url: string; size: number }
export interface AbyssResolved { ok: boolean; slug: string; title?: string; sources: AbyssSource[]; embed: string; error?: string }

export function getAbyssSlug(input: string | undefined | null): string {
  const v = String(input || "").trim();
  if (!v) return "";
  const m = v.match(/abyss(?:player|cdn)?\.(?:com|to)\/(?:[^?#]*[?&]v=)?([A-Za-z0-9_-]{6,})/i);
  return m ? m[1] : "";
}

export const isAbyssLink = (input: string | undefined | null) => Boolean(getAbyssSlug(input));

/** Normalise anything the admin pastes (URL, <iframe> code) into a clean link. */
export function normalizeAbyssInput(input: string): string {
  const raw = String(input || "").trim();
  const src = raw.match(/src=["']([^"']+)["']/i)?.[1] || raw;
  const slug = getAbyssSlug(src);
  return slug ? `https://player.abyssplayer.com/${slug}` : raw;
}

// EGD Router row `abyss` is the ONLY source of the server URL (Default button
// pastes the Lovable-hosted copy; admin may paste a Cloudflare/own URL).
async function getBase(): Promise<string> {
  try {
    const u = await getEdgeFunctionUrl("abyss");
    return u ? u.replace(/\/+$/, "") : "";
  } catch { return ""; }
}

const cache = new Map<string, { at: number; p: Promise<AbyssResolved> }>();
const TTL = 20 * 60_000;

export function invalidateAbyss(link: string) {
  const slug = getAbyssSlug(link);
  if (slug) cache.delete(slug);
}

export function resolveAbyss(link: string, opts: { fresh?: boolean } = {}): Promise<AbyssResolved> {
  const slug = getAbyssSlug(link);
  const embed = slug ? `https://player.abyssplayer.com/${slug}` : "";
  if (!slug) return Promise.resolve({ ok: false, slug: "", sources: [], embed, error: "invalid link" });
  if (opts.fresh) cache.delete(slug);
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = (async () => {
    try {
      const base = await getBase();
      if (!base) throw new Error("Abyss server not set (Admin → EGD Router → abyss)");
      const r = await fetch(`${base}/resolve?id=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) cache.delete(slug);
      return { ok: !!j?.ok && Array.isArray(j.sources) && j.sources.length > 0, slug, title: j?.title, sources: j?.sources || [], embed, error: j?.error } as AbyssResolved;
    } catch (e) {
      cache.delete(slug);
      return { ok: false, slug, sources: [], embed, error: String((e as Error)?.message || e) };
    }
  })();
  cache.set(slug, { at: Date.now(), p });
  return p;
}
