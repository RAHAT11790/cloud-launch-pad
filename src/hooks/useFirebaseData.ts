import { useState, useEffect, useMemo } from "react";
import { db, ref, onValue, query, orderByChild, limitToLast } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";
import { mapFirebaseMovieItem, mapFirebaseWebseriesItem } from "@/lib/firebaseAnimeMapper";

const LS_WS = "rs_cache_webseries_v1";
const LS_MOV = "rs_cache_movies_v1";
const LS_CATS = "rs_cache_categories_v1";
const PUBLIC_BATCH_LIMIT = 160;
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

const mergeById = (cached: AnimeItem[], fresh: AnimeItem[]) => {
  const map = new Map<string, AnimeItem>();
  cached.forEach((item) => { if (item?.id) map.set(item.id, item); });
  fresh.forEach((item) => { if (item?.id) map.set(item.id, item); });
  return Array.from(map.values()).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
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
    const wsRef = query(ref(db, "webseries"), orderByChild("updatedAt"), limitToLast(PUBLIC_BATCH_LIMIT));
    const unsubWs = onValue(wsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const publicItems: AnimeItem[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        if (item.visibility === "private") return; // skip private content
        publicItems.push(mapFirebaseWebseriesItem(id, item, { full: false }));
      });
      publicItems.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      setWebseries((prev) => {
        const merged = mergeById(prev, publicItems);
        writeCache(LS_WS, merged);
        return merged;
      });
      checkLoaded();
    });

    // Load movies in the same lightweight, cache-first way.
    const movRef = query(ref(db, "movies"), orderByChild("updatedAt"), limitToLast(PUBLIC_BATCH_LIMIT));
    const unsubMov = onValue(movRef, (snapshot) => {
      const data = snapshot.val() || {};
      const publicItems: AnimeItem[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        if (item.visibility === "private") return; // skip private content
        publicItems.push(mapFirebaseMovieItem(id, item, { full: false }));
      });
      publicItems.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      setMovies((prev) => {
        const merged = mergeById(prev, publicItems);
        writeCache(LS_MOV, merged);
        return merged;
      });
      checkLoaded();
    });

    return () => {
      unsubCats();
      unsubWs();
      unsubMov();
    };
  }, []);

  const allAnime = useMemo(() => {
    const combined = [...webseries, ...movies];
    combined.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return combined;
  }, [webseries, movies]);

  return { webseries, movies, categories, allAnime, loading };
}
