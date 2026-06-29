import { useEffect, useState } from "react";
import type { AnimeItem } from "@/data/animeData";
import { mapAnimeSaltSelectedItem } from "@/lib/firebaseAnimeMapper";
import { firebaseRestGet, firebaseRestShallowKeys } from "@/lib/firebaseRest";

const CACHE_KEY = "rs_cache_animesalt_selected_cards_v1";
const SELECTED_CARD_PAGE_SIZE = 4;
const SELECTED_CACHE_LIMIT = 500;

const readCache = (): AnimeItem[] => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const writeCache = (items: AnimeItem[]) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(items.slice(0, SELECTED_CACHE_LIMIT))); } catch {}
};

const mergeCards = (cached: AnimeItem[], fresh: AnimeItem[]) => {
  const map = new Map<string, AnimeItem>();
  cached.forEach((item) => { if (item?.id) map.set(item.id, item); });
  fresh.forEach((item) => { if (item?.id) map.set(item.id, item); });
  return Array.from(map.values())
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, SELECTED_CACHE_LIMIT);
};

const scheduleIdle = (callback: () => void) => {
  const idle = (window as any).requestIdleCallback;
  if (typeof idle === "function") {
    const id = idle(callback, { timeout: 1800 });
    return () => { try { (window as any).cancelIdleCallback?.(id); } catch {} };
  }
  const id = window.setTimeout(callback, 500);
  return () => window.clearTimeout(id);
};

export function useSelectedAnimeSalt() {
  const [items, setItems] = useState<AnimeItem[]>(() => readCache());
  const [loading, setLoading] = useState(() => readCache().length === 0);

  useEffect(() => {
    let cancelled = false;
    const cancelIdle = scheduleIdle(async () => {
      try {
        const [selectedKeys, wsIndex, movIndex] = await Promise.all([
          firebaseRestShallowKeys("animesaltSelected"),
          firebaseRestGet<Record<string, any>>("adminContentIndex/webseries").catch(() => null),
          firebaseRestGet<Record<string, any>>("adminContentIndex/movies").catch(() => null),
        ]);
        const keys = selectedKeys.reverse().slice(0, SELECTED_CACHE_LIMIT);
        const generatedSlugSet = new Set<string>();
        Object.values(wsIndex || {}).forEach((item: any) => {
          const slug = String(item?.anSlug || item?.animeSaltSlug || "").trim();
          if (slug) generatedSlugSet.add(slug);
        });
        Object.values(movIndex || {}).forEach((item: any) => {
          const slug = String(item?.anSlug || item?.animeSaltSlug || "").trim();
          if (slug) generatedSlugSet.add(slug);
        });
        const liveSet = new Set(keys);
        
        setItems((prev) => {
          const next = prev.filter((item) => liveSet.has(item.anSlug || item.animeSaltSlug || item.slug || ""));
          if (next.length !== prev.length) writeCache(next);
          return next;
        });

        const cachedSlugs = new Set(readCache().map((item) => item.anSlug || item.animeSaltSlug || item.slug).filter(Boolean));
        const refreshKeys = keys.slice(0, cachedSlugs.size ? 4 : SELECTED_CARD_PAGE_SIZE);
        const missingKeys = keys.filter((slug) => !cachedSlugs.has(slug));
        const workKeys = Array.from(new Set([...refreshKeys, ...missingKeys]));
        
        if (!workKeys.length) setLoading(false);

        for (let i = 0; i < workKeys.length && !cancelled; i += SELECTED_CARD_PAGE_SIZE) {
          const chunk = workKeys.slice(i, i + SELECTED_CARD_PAGE_SIZE);
          const rows = await Promise.all(chunk.map(async (slug) => {
            try {
              const row = await firebaseRestGet<any>(`animesaltSelected/${slug}`);
              if (!row) return null;
              
              const seasons = row.customSeasons;
              const seasonList = Array.isArray(seasons)
                ? seasons
                : seasons && typeof seasons === "object" ? Object.values(seasons) : [];
              
              const hasGeneratedFirebaseCard = generatedSlugSet.has(slug);
              const hasPlayableEpisode = seasonList.some((season: any) => {
                const eps = Array.isArray(season?.episodes)
                  ? season.episodes
                  : season?.episodes && typeof season.episodes === "object" ? Object.values(season.episodes) : [];
                return eps.some((ep: any) =>
                  String(ep?.link || ep?.link1080 || ep?.link720 || ep?.link480 || ep?.link4k || "").trim().length > 0,
                );
              });

              if (!hasGeneratedFirebaseCard && !hasPlayableEpisode) return null;
              return mapAnimeSaltSelectedItem(slug, row);
            } catch { return null; }
          }));

          const mapped = (rows.filter(Boolean) as AnimeItem[]).filter((item) => item.title && item.poster);
          if (mapped.length && !cancelled) {
            setItems((prev) => {
              const merged = mergeCards(prev, mapped);
              writeCache(merged);
              return merged;
            });
          }
          setLoading(false);
          await new Promise((resolve) => window.setTimeout(resolve, 650));
        }
      } catch {
        setLoading(false);
      }
    });
    return () => { cancelled = true; cancelIdle(); };
  }, []);

  return { items, loading };
}
