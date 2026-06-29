import { useState, useEffect, useMemo } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";
import { mapFirebaseMovieItem, mapFirebaseWebseriesItem } from "@/lib/firebaseAnimeMapper";
import { firebaseRestGet, firebaseRestShallowKeys } from "@/lib/firebaseRest";

const LS_WS = "rs_cache_webseries_v1";
const LS_MOV = "rs_cache_movies_v1";
const LS_CATS = "rs_cache_categories_v1";
const BACKFILL_PAGE_SIZE = 8;
const BACKFILL_CACHE_LIMIT = 120;
const MAX_CACHE_BYTES = 2_500_000;

const readCache = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    if (raw.length > MAX_CACHE_BYTES) {
      localStorage.removeItem(key);
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch { return fallback; }
};
const writeCache = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

const scheduleIdle = (callback: () => void) => {
  const idle = (window as any).requestIdleCallback;
  if (typeof idle === "function") {
    const id = idle(callback, { timeout: 2500 });
    return () => { try { (window as any).cancelIdleCallback?.(id); } catch {} };
  }
  const id = window.setTimeout(callback, 650);
  return () => window.clearTimeout(id);
};

const newestFirst = (a: AnimeItem, b: AnimeItem) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);

const mergeById = (cached: AnimeItem[], fresh: AnimeItem[]) => {
  const map = new Map<string, AnimeItem>();
  cached.forEach((item) => { if (item?.id) map.set(item.id, item); });
  fresh.forEach((item) => { if (item?.id) map.set(item.id, item); });
  return Array.from(map.values()).sort(newestFirst).slice(0, BACKFILL_CACHE_LIMIT);
};

const loadBackfillCards = async (
  path: "webseries" | "movies",
  currentIds: Set<string>,
  mapper: (id: string, item: any, opts?: { full?: boolean }) => AnimeItem,
  apply: (items: AnimeItem[]) => void,
  cancelled: () => boolean,
) => {
  try {
    const keys = await firebaseRestShallowKeys(path);
    if (cancelled()) return;
    const missing = keys.filter((id) => !currentIds.has(id)).slice(-BACKFILL_CACHE_LIMIT).reverse();
    for (let i = 0; i < missing.length && !cancelled(); i += BACKFILL_PAGE_SIZE) {
      const chunk = missing.slice(i, i + BACKFILL_PAGE_SIZE);
      const rows = await Promise.all(chunk.map(async (id) => {
        try {
          const item = await firebaseRestGet<any>(`${path}/${id}`);
          if (!item || item.visibility === "private") return null;
          return mapper(id, item, { full: false });
        } catch { return null; }
      }));
      const mapped = rows.filter(Boolean) as AnimeItem[];
      if (mapped.length && !cancelled()) apply(mapped);
      await new Promise((resolve) => window.setTimeout(resolve, 320));
    }
  } catch {}
};

export function useFirebaseData() {
  const [webseries, setWebseries] = useState<AnimeItem[]>(() => readCache<AnimeItem[]>(LS_WS, []));
  const [movies, setMovies] = useState<AnimeItem[]>(() => readCache<AnimeItem[]>(LS_MOV, []));
  const [categories, setCategories] = useState<string[]>(() => readCache<string[]>(LS_CATS, []));
  const [loading, setLoading] = useState(() => {
    // If we already have cached data, treat as ready immediately for zero-latency UI
    return !(readCache<AnimeItem[]>(LS_WS, []).length || readCache<AnimeItem[]>(LS_MOV, []).length);
  });

  useEffect(() => {
    let loadedCount = 0;
    const checkLoaded = () => {
      loadedCount++;
      if (loadedCount >= 3) setLoading(false);
    };

    // Load categories
    const catsRef = ref(db, "categories");
    const unsubCats = onValue(catsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const cats: string[] = [];
      Object.values(data).forEach((cat: any) => {
        if (cat.name) cats.push(cat.name);
      });
      setCategories(cats);
      writeCache(LS_CATS, cats);
      checkLoaded();
    });

    // Load only the latest lightweight card rows first. Full episode/audio data
    // is fetched on play, so AN/Ad series cannot crash the homepage by sending
    // every season/episode/audio URL at once.
    // IMPORTANT: do not use onValue(query(webseries/movies)) here. RTDB sends
    // the full child payload (all seasons/audio URLs), so even a limited query
    // can crash the browser. We read keys shallow, then hydrate cards in small
    // chunks and cache them permanently in localStorage.

    let cancelled = false;
    const cancelIdle = scheduleIdle(async () => {
      checkLoaded();
      checkLoaded();
      await loadBackfillCards(
        "webseries",
        new Set(readCache<AnimeItem[]>(LS_WS, []).map((item) => item.id)),
        mapFirebaseWebseriesItem,
        (items) => setWebseries((prev) => {
          const merged = mergeById(prev, items);
          writeCache(LS_WS, merged);
          return merged;
        }),
        () => cancelled,
      );
      if (cancelled) return;
      await loadBackfillCards(
        "movies",
        new Set(readCache<AnimeItem[]>(LS_MOV, []).map((item) => item.id)),
        mapFirebaseMovieItem,
        (items) => setMovies((prev) => {
          const merged = mergeById(prev, items);
          writeCache(LS_MOV, merged);
          return merged;
        }),
        () => cancelled,
      );
    });

    return () => {
      cancelled = true;
      cancelIdle();
      unsubCats();
    };
  }, []);

  const allAnime = useMemo(() => {
    const combined = [...webseries, ...movies];
    combined.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return combined;
  }, [webseries, movies]);

  return { webseries, movies, categories, allAnime, loading };
}
