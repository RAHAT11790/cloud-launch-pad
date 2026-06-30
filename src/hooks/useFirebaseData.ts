import { useState, useEffect, useMemo } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";
import { mapFirebaseMovieItem, mapFirebaseWebseriesItem } from "@/lib/firebaseAnimeMapper";
import { firebaseRestGet, firebaseRestShallowKeys } from "@/lib/firebaseRest";
import { isLegacyAnEntry, stripLegacyAnItems } from "@/lib/legacyAn";

const LS_WS = "rs_cache_webseries_v1";
const LS_MOV = "rs_cache_movies_v1";
const LS_CATS = "rs_cache_categories_v1";
const BACKFILL_PAGE_SIZE = 4;
const BACKFILL_CACHE_LIMIT = 500;
const MAX_CACHE_BYTES = 2_500_000;

// AN (AnimeSalt) now runs 100% via live API. Any legacy AN entry that lingers in
// Firebase or localStorage cache must be stripped at the source so it can never
// leak into the user UI, regardless of which render path consumes it.
const stripLegacy = <T,>(arr: T[] | undefined | null): T[] =>
  stripLegacyAnItems(arr);

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
  cached.forEach((item) => { if (item?.id && !isLegacyAnEntry(item)) map.set(item.id, item); });
  fresh.forEach((item) => { if (item?.id && !isLegacyAnEntry(item)) map.set(item.id, item); });
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
    const reversed = keys.slice(-BACKFILL_CACHE_LIMIT).reverse();
    const refresh = currentIds.size ? reversed.filter((id) => currentIds.has(id)).slice(0, 4) : [];
    const missing = reversed.filter((id) => !currentIds.has(id));
    const workKeys = Array.from(new Set([...refresh, ...missing]));
    for (let i = 0; i < workKeys.length && !cancelled(); i += BACKFILL_PAGE_SIZE) {
      const chunk = workKeys.slice(i, i + BACKFILL_PAGE_SIZE);
      const rows = await Promise.all(chunk.map(async (id) => {
        try {
          const item = await firebaseRestGet<any>(`${path}/${id}`);
          if (!item || item.visibility === "private") return null;
          return mapper(id, item, { full: false });
        } catch { return null; }
      }));
      const mapped = rows.filter(Boolean) as AnimeItem[];
      if (mapped.length && !cancelled()) apply(mapped);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    }
  } catch {}
};

export function useFirebaseData() {
  const [webseries, setWebseries] = useState<AnimeItem[]>(() => stripLegacy(readCache<AnimeItem[]>(LS_WS, [])));
  const [movies, setMovies] = useState<AnimeItem[]>(() => stripLegacy(readCache<AnimeItem[]>(LS_MOV, [])));
  const [categories, setCategories] = useState<string[]>(() => readCache<string[]>(LS_CATS, []));
  const [loading, setLoading] = useState(() => {
    return !(readCache<AnimeItem[]>(LS_WS, []).length || readCache<AnimeItem[]>(LS_MOV, []).length);
  });


  useEffect(() => {
    let loadedCount = 0;
    const checkLoaded = () => {
      loadedCount++;
      if (loadedCount >= 3) setLoading(false);
    };

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

    let cancelled = false;
    const cancelIdle = scheduleIdle(async () => {
      // 1. Try to load index first (Fast path for all cards)
      try {
        const [idxWs, idxMov] = await Promise.all([
          firebaseRestGet<Record<string, any>>("adminContentIndex/webseries"),
          firebaseRestGet<Record<string, any>>("adminContentIndex/movies")
        ]);
        if (!cancelled) {
          if (idxWs) {
            const items = Object.entries(idxWs).map(([id, item]: [string, any]) => ({ ...item, id }));
            setWebseries(prev => {
              const merged = mergeById(prev, items as any[]);
              writeCache(LS_WS, merged);
              return merged;
            });
          }
          if (idxMov) {
            const items = Object.entries(idxMov).map(([id, item]: [string, any]) => ({ ...item, id }));
            setMovies(prev => {
              const merged = mergeById(prev, items as any[]);
              writeCache(LS_MOV, merged);
              return merged;
            });
          }
        }
      } catch { /* cached cards/backfill keep the UI usable when the index endpoint is temporarily blocked */ }

      checkLoaded();
      checkLoaded();

      // 2. Do the backfill to get fresh full cards for the latest few
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
