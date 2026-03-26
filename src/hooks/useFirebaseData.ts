import { useState, useEffect, useMemo } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";

export function useFirebaseData() {
  const [webseries, setWebseries] = useState<AnimeItem[]>([]);
  const [movies, setMovies] = useState<AnimeItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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
      checkLoaded();
    });

    // Load webseries
    const wsRef = ref(db, "webseries");
    const unsubWs = onValue(wsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const items: AnimeItem[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        items.push({
          id,
          source: "firebase" as const,
          title: item.title || "",
          poster: item.poster || "",
          backdrop: item.backdrop || "",
          year: item.year || "",
          rating: item.rating || "",
          language: item.language || "",
          category: item.category || "",
          type: "webseries",
          storyline: item.storyline || "",
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
                    }))
                  : [],
              }))
            : undefined,
          trailer: item.trailer || undefined,
          movieLink: undefined,
          createdAt: item.createdAt || 0,
          updatedAt: item.updatedAt || 0,
        });
      });
      items.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      setWebseries(items);
      checkLoaded();
    });

    // Load movies
    const movRef = ref(db, "movies");
    const unsubMov = onValue(movRef, (snapshot) => {
      const data = snapshot.val() || {};
      const items: AnimeItem[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        items.push({
          id,
          source: "firebase" as const,
          title: item.title || "",
          poster: item.poster || "",
          backdrop: item.backdrop || "",
          year: item.year || "",
          rating: item.rating || "",
          language: item.language || "",
          category: item.category || "",
          type: "movie",
          storyline: item.storyline || "",
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
        });
      });
      items.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      setMovies(items);
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
