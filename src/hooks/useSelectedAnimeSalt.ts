import { useEffect, useState } from "react";
import type { AnimeItem } from "@/data/animeData";
import { mapAnimeSaltSelectedItem } from "@/lib/firebaseAnimeMapper";
import { firebaseRestGet, firebaseRestShallowKeys } from "@/lib/firebaseRest";

const CACHE_KEY = "rs_cache_animesalt_selected_cards_v1";
const SELECTED_CARD_PAGE_SIZE = 8;
const SELECTED_CACHE_LIMIT = 160;

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
    // Firebase-selected AN/Ad rows are real cards, but animesaltSelected may
    // contain large customSeasons/audio data. So do NOT subscribe to the whole
    // node. Read keys shallow, then hydrate small chunks into localStorage.
    const cancelIdle = scheduleIdle(async () => {
      try {
        const cachedSlugs = new Set(readCache().map((item) => item.anSlug || item.animeSaltSlug || item.slug).filter(Boolean));
        const keys = (await firebaseRestShallowKeys("animesaltSelected")).reverse().slice(0, SELECTED_CACHE_LIMIT);
        const refreshKeys = keys.slice(0, cachedSlugs.size ? 4 : SELECTED_CARD_PAGE_SIZE);
        const missingKeys = keys.filter((slug) => !cachedSlugs.has(slug));
        const workKeys = Array.from(new Set([...refreshKeys, ...missingKeys]));
        if (!workKeys.length) setLoading(false);
        for (let i = 0; i < workKeys.length && !cancelled; i += SELECTED_CARD_PAGE_SIZE) {
          const chunk = workKeys.slice(i, i + SELECTED_CARD_PAGE_SIZE);
          const rows = await Promise.all(chunk.map(async (slug) => {
            try {
              const row = await firebaseRestGet<any>(`animesaltSelected/${slug}`);
              return row ? mapAnimeSaltSelectedItem(slug, row) : null;
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
          await new Promise((resolve) => window.setTimeout(resolve, 320));
        }
      } catch {
        setLoading(false);
      }
    });
    return () => { cancelled = true; cancelIdle(); };
  }, []);

  return { items, loading };
}