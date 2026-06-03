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
      setWebseries(publicItems);
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
        };
        publicItems.push(mappedItem);
      });
      publicItems.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      setMovies(publicItems);
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
