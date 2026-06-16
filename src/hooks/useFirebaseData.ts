import { useState, useEffect, useMemo, useRef } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";

const LS_WS = "rs_cache_webseries_v1";
const LS_MOV = "rs_cache_movies_v1";
const LS_CATS = "rs_cache_categories_v1";

const readCache = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
};
const writeCache = (key: string, value: unknown) => {
  const run = () => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  try {
    const idle = (window as any).requestIdleCallback;
    if (typeof idle === "function") idle(run, { timeout: 1500 });
    else window.setTimeout(run, 0);
  } catch { run(); }
};

const listSignature = (items: AnimeItem[]) =>
  items.map((item) => `${item.id}:${item.updatedAt || item.createdAt || 0}:${item.poster || ""}:${item.title || ""}`).join("|");

export function useFirebaseData() {
  const [webseries, setWebseries] = useState<AnimeItem[]>(() => readCache<AnimeItem[]>(LS_WS, []));
  const [movies, setMovies] = useState<AnimeItem[]>(() => readCache<AnimeItem[]>(LS_MOV, []));
  const [categories, setCategories] = useState<string[]>(() => readCache<string[]>(LS_CATS, []));
  const webseriesSigRef = useRef(listSignature(webseries));
  const moviesSigRef = useRef(listSignature(movies));
  const categoriesSigRef = useRef(categories.join("|"));
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
      const sig = cats.join("|");
      if (sig !== categoriesSigRef.current) {
        categoriesSigRef.current = sig;
        setCategories(cats);
        writeCache(LS_CATS, cats);
      }
      checkLoaded();
    });

    // Load webseries
    const wsRef = ref(db, "webseries");
    const unsubWs = onValue(wsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const publicItems: AnimeItem[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        if (item.visibility === "private") return; // skip private content
        const mappedItem: AnimeItem = {
          id,
          source: "firebase" as const,
          title: item.title || "",
          poster: item.poster || "",
          backdrop: item.backdrop || "",
          year: item.year || "",
          rating: item.rating || "",
          language: item.language || "",
          baseLanguage: item.baseLanguage || item.language || "",
          availableLanguages: Array.isArray(item.availableLanguages) ? item.availableLanguages : undefined,
          seasonsByLanguage: item.seasonsByLanguage && typeof item.seasonsByLanguage === "object"
            ? Object.fromEntries(
                Object.entries(item.seasonsByLanguage).map(([lang, seasons]: [string, any]) => [
                  lang,
                  Array.isArray(seasons)
                    ? seasons.map((s: any) => ({
                        name: s.name || "",
                        episodes: s.episodes
                          ? Object.values(s.episodes).map((ep: any) => ({
                              episodeNumber: ep.episodeNumber || 0,
                              title: ep.title || "",
                              link: ep.link || "",
                              link480: ep.link480 || undefined,
                              link720: ep.link720 || undefined,
                              link1080: ep.link1080 || undefined,
                              link4k: ep.link4k || undefined,
                              audioTracks: ep.audioTracks ? Object.values(ep.audioTracks).map((at: any) => ({
                                language: at.language || "",
                                label: at.label || "",
                                link: at.link || "",
                                link480: at.link480 || undefined,
                                link720: at.link720 || undefined,
                                link1080: at.link1080 || undefined,
                                link4k: at.link4k || undefined,
                              })) : undefined,
                            }))
                          : [],
                      }))
                    : [],
                ]),
              )
            : undefined,
          category: item.category || "",
          type: "webseries",
          storyline: item.storyline || "",
          cast: Array.isArray(item.cast) ? item.cast : item.cast ? Object.values(item.cast) : undefined,
          audioTracks: item.audioTracks ? Object.values(item.audioTracks).map((at: any) => ({
            language: at.language || "",
            label: at.label || at.language || "",
            link: at.link || "",
            link480: at.link480 || undefined,
            link720: at.link720 || undefined,
            link1080: at.link1080 || undefined,
            link4k: at.link4k || undefined,
          })) : undefined,
          dubType: item.dubType || "official",
          seasons: item.seasons
            ? Object.values(item.seasons).map((s: any) => ({
                name: s.name || "",
                episodes: s.episodes
                  ? Object.values(s.episodes).map((ep: any) => ({
                      episodeNumber: ep.episodeNumber || 0,
                      title: ep.title || "",
                      link: ep.link || "",
                      link480: ep.link480 || undefined,
                      link720: ep.link720 || undefined,
                      link1080: ep.link1080 || undefined,
                      link4k: ep.link4k || undefined,
                      audioTracks: ep.audioTracks ? Object.values(ep.audioTracks).map((at: any) => ({
                        language: at.language || "",
                        label: at.label || "",
                        link: at.link || "",
                        link480: at.link480 || undefined,
                        link720: at.link720 || undefined,
                        link1080: at.link1080 || undefined,
                        link4k: at.link4k || undefined,
                      })) : undefined,
                    }))
                  : [],
              }))
            : undefined,
          trailer: item.trailer || undefined,
          movieLink: undefined,
          createdAt: item.createdAt || 0,
          updatedAt: item.updatedAt || 0,
        };
        publicItems.push(mappedItem);
      });
      publicItems.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      const sig = listSignature(publicItems);
      if (sig !== webseriesSigRef.current) {
        webseriesSigRef.current = sig;
        setWebseries(publicItems);
        writeCache(LS_WS, publicItems);
      }
      checkLoaded();
    });

    // Load movies
    const movRef = ref(db, "movies");
    const unsubMov = onValue(movRef, (snapshot) => {
      const data = snapshot.val() || {};
      const publicItems: AnimeItem[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        if (item.visibility === "private") return; // skip private content
        const mappedItem: AnimeItem = {
          id,
          source: "firebase" as const,
          title: item.title || "",
          poster: item.poster || "",
          backdrop: item.backdrop || "",
          year: item.year || "",
          rating: item.rating || "",
          language: item.language || "",
          baseLanguage: item.baseLanguage || item.language || "",
          availableLanguages: Array.isArray(item.availableLanguages) ? item.availableLanguages : undefined,
          category: item.category || "",
          type: "movie",
          storyline: item.storyline || "",
          cast: Array.isArray(item.cast) ? item.cast : item.cast ? Object.values(item.cast) : undefined,
          audioTracks: item.audioTracks ? Object.values(item.audioTracks).map((at: any) => ({
            language: at.language || "",
            label: at.label || at.language || "",
            link: at.link || "",
            link480: at.link480 || undefined,
            link720: at.link720 || undefined,
            link1080: at.link1080 || undefined,
            link4k: at.link4k || undefined,
          })) : undefined,
          dubType: item.dubType || "official",
          movieLink: item.movieLink || "",
          movieLink480: item.movieLink480 || undefined,
          movieLink720: item.movieLink720 || undefined,
          movieLink1080: item.movieLink1080 || undefined,
          movieLink4k: item.movieLink4k || undefined,
          trailer: item.trailer || undefined,
          seasons: undefined,
          createdAt: item.createdAt || 0,
          updatedAt: item.updatedAt || 0,
        };
        publicItems.push(mappedItem);
      });
      publicItems.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      const sig = listSignature(publicItems);
      if (sig !== moviesSigRef.current) {
        moviesSigRef.current = sig;
        setMovies(publicItems);
        writeCache(LS_MOV, publicItems);
      }
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
