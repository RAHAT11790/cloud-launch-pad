import { useState, useEffect, useMemo } from "react";
import { db, ref, onValue, get } from "@/lib/firebase";
import type { AnimeItem, AudioLanguage, Season } from "@/data/animeData";

type FirebaseDataCache = {
  webseries: AnimeItem[];
  movies: AnimeItem[];
  categories: string[];
  byId: Record<string, AnimeItem>;
  loaded: boolean;
};

const firebaseDataCache: FirebaseDataCache = {
  webseries: [],
  movies: [],
  categories: [],
  byId: {},
  loaded: false,
};

const normalizeSeasons = (raw: any): Season[] | undefined => {
  if (!raw) return undefined;
  const seasons = (Array.isArray(raw) ? raw : Object.values(raw)).map((s: any) => ({
    name: s?.name || "",
    seasonNumber: s?.seasonNumber,
    episodes: s?.episodes
      ? (Array.isArray(s.episodes) ? s.episodes : Object.values(s.episodes)).map((ep: any) => ({
          episodeNumber: ep?.episodeNumber || 0,
          title: ep?.title || "",
          link: ep?.link || "",
          link480: ep?.link480 || undefined,
          link720: ep?.link720 || undefined,
          link1080: ep?.link1080 || undefined,
          link4k: ep?.link4k || undefined,
          audioTracks: ep?.audioTracks ? Object.values(ep.audioTracks).map((at: any) => ({
            language: at?.language || "",
            label: at?.label || "",
            link: at?.link || "",
            link480: at?.link480 || undefined,
            link720: at?.link720 || undefined,
            link1080: at?.link1080 || undefined,
            link4k: at?.link4k || undefined,
          })) : undefined,
        }))
      : [],
  }));
  return seasons;
};

const normalizeAudioLanguages = (raw: any): AudioLanguage[] | undefined => {
  if (!raw) return undefined;
  const languages = (Array.isArray(raw) ? raw : Object.values(raw)).map((l: any, index: number) => ({
    id: l?.id || `lang_${index}`,
    name: l?.name || l?.language || "Language",
    isDefault: l?.isDefault === true,
    dubType: l?.dubType === "fandub" ? "fandub" as const : "official" as const,
    seasons: normalizeSeasons(l?.seasons) || [],
    movieLink: l?.movieLink || undefined,
    movieLink480: l?.movieLink480 || undefined,
    movieLink720: l?.movieLink720 || undefined,
    movieLink1080: l?.movieLink1080 || undefined,
    movieLink4k: l?.movieLink4k || undefined,
    createdAt: l?.createdAt || 0,
    order: typeof l?.order === "number" ? l.order : index,
  }));
  languages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return languages.length ? languages : undefined;
};

export const mapFirebaseWebseries = (id: string, item: any): AnimeItem => ({
  id,
  source: "firebase" as const,
  title: item?.title || "",
  poster: item?.poster || "",
  backdrop: item?.backdrop || "",
  year: item?.year || "",
  rating: item?.rating || "",
  language: item?.language || "",
  category: item?.category || "",
  type: "webseries",
  storyline: item?.storyline || "",
  dubType: item?.dubType || "official",
  seasons: normalizeSeasons(item?.seasons),
  audioLanguages: normalizeAudioLanguages(item?.audioLanguages),
  trailer: item?.trailer || undefined,
  movieLink: undefined,
  createdAt: item?.createdAt || 0,
  updatedAt: item?.updatedAt || 0,
});

export const mapFirebaseMovie = (id: string, item: any): AnimeItem => ({
  id,
  source: "firebase" as const,
  title: item?.title || "",
  poster: item?.poster || "",
  backdrop: item?.backdrop || "",
  year: item?.year || "",
  rating: item?.rating || "",
  language: item?.language || "",
  category: item?.category || "",
  type: "movie",
  storyline: item?.storyline || "",
  dubType: item?.dubType || "official",
  movieLink: item?.movieLink || "",
  movieLink480: item?.movieLink480 || undefined,
  movieLink720: item?.movieLink720 || undefined,
  movieLink1080: item?.movieLink1080 || undefined,
  movieLink4k: item?.movieLink4k || undefined,
  audioLanguages: normalizeAudioLanguages(item?.audioLanguages),
  trailer: item?.trailer || undefined,
  seasons: undefined,
  createdAt: item?.createdAt || 0,
  updatedAt: item?.updatedAt || 0,
});

export async function loadFirebaseAnimeById(id: string): Promise<AnimeItem | null> {
  if (firebaseDataCache.byId[id]) return firebaseDataCache.byId[id];

  const [webSnap, movieSnap] = await Promise.all([
    get(ref(db, `webseries/${id}`)),
    get(ref(db, `movies/${id}`)),
  ]);

  const webItem = webSnap.val();
  if (webItem && webItem.visibility !== "private") {
    const mapped = mapFirebaseWebseries(id, webItem);
    firebaseDataCache.byId[id] = mapped;
    return mapped;
  }

  const movieItem = movieSnap.val();
  if (movieItem && movieItem.visibility !== "private") {
    const mapped = mapFirebaseMovie(id, movieItem);
    firebaseDataCache.byId[id] = mapped;
    return mapped;
  }

  return null;
}

export function useFirebaseData() {
  const [webseries, setWebseries] = useState<AnimeItem[]>(() => firebaseDataCache.webseries);
  const [movies, setMovies] = useState<AnimeItem[]>(() => firebaseDataCache.movies);
  const [categories, setCategories] = useState<string[]>(() => firebaseDataCache.categories);
  const [loading, setLoading] = useState(() => !firebaseDataCache.loaded);

  useEffect(() => {
    if (firebaseDataCache.loaded) {
      setLoading(false);
      return;
    }

    const loadedFlags = { categories: false, webseries: false, movies: false };
    const checkLoaded = (key: keyof typeof loadedFlags) => {
      loadedFlags[key] = true;
      if (loadedFlags.categories && loadedFlags.webseries && loadedFlags.movies) {
        firebaseDataCache.loaded = true;
        setLoading(false);
      }
    };

    // Load categories
    const catsRef = ref(db, "categories");
    const unsubCats = onValue(catsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const cats: string[] = [];
      Object.values(data).forEach((cat: any) => {
        if (cat.name) cats.push(cat.name);
      });
      firebaseDataCache.categories = cats;
      setCategories(cats);
      checkLoaded("categories");
    });

    // Load webseries
    const wsRef = ref(db, "webseries");
    const unsubWs = onValue(wsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const publicItems: AnimeItem[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        if (item.visibility === "private") return; // skip private content
        const mappedItem = mapFirebaseWebseries(id, item);
        publicItems.push(mappedItem);
        firebaseDataCache.byId[id] = mappedItem;
      });
      publicItems.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      firebaseDataCache.webseries = publicItems;
      setWebseries(publicItems);
      checkLoaded("webseries");
    });

    // Load movies
    const movRef = ref(db, "movies");
    const unsubMov = onValue(movRef, (snapshot) => {
      const data = snapshot.val() || {};
      const publicItems: AnimeItem[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        if (item.visibility === "private") return; // skip private content
        const mappedItem = mapFirebaseMovie(id, item);
        publicItems.push(mappedItem);
        firebaseDataCache.byId[id] = mappedItem;
      });
      publicItems.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      firebaseDataCache.movies = publicItems;
      setMovies(publicItems);
      checkLoaded("movies");
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
