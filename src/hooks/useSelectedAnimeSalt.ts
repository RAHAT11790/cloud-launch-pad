import { useEffect, useState } from "react";
import type { AnimeItem } from "@/data/animeData";
import { animeSaltApi } from "@/lib/animeSaltApi";

// AN data is now 100% API-driven. No Firebase reads/writes for AN cards.
// Browse list is fetched from AnimeSalt via the an-api edge function and
// cached in localStorage for instant repeat loads.

const CACHE_KEY = "rs_cache_animesalt_api_cards_v2";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CARDS = 200;

type CacheShape = { ts: number; items: AnimeItem[] };

const readCache = (): CacheShape | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) return parsed;
  } catch {}
  return null;
};

const writeCache = (items: AnimeItem[]) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items: items.slice(0, MAX_CARDS) }));
  } catch {}
};

const mapBrowseItem = (raw: any): AnimeItem | null => {
  const slug = String(raw?.slug || "").trim();
  const title = String(raw?.title || "").trim();
  const poster = String(raw?.poster || "").trim();
  if (!slug || !title || !poster) return null;
  const isMovie = String(raw?.type || "").toLowerCase().includes("movie");
  const id = `an_${slug}`;
  return {
    id,
    title,
    poster,
    description: "",
    rating: 0,
    category: "Anime",
    type: isMovie ? "movie" : "webseries",
    year: String(raw?.year || ""),
    duration: "",
    seasons: [],
    movieLinks: [],
    animeSaltSlug: slug,
    anSlug: slug,
    source: "animesalt",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as AnimeItem;
};

export function useSelectedAnimeSalt() {
  const initial = readCache();
  const fresh = initial && Date.now() - initial.ts < CACHE_TTL_MS;
  const [items, setItems] = useState<AnimeItem[]>(initial?.items || []);
  const [loading, setLoading] = useState(!fresh);

  useEffect(() => {
    if (fresh) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await animeSaltApi.browseAll();
        if (cancelled) return;
        const mapped = (res?.items || [])
          .map(mapBrowseItem)
          .filter(Boolean) as AnimeItem[];
        if (mapped.length) {
          setItems(mapped);
          writeCache(mapped);
        }
      } catch {
        // Silent — keep cached items if available
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fresh]);

  return { items, loading };
}
