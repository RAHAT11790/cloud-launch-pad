import { useState, useEffect, useMemo, useCallback } from "react";
import { db, ref, onValue, get } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";

const LS_WS = "rs_cache_webseries_v2";
const LS_MOV = "rs_cache_movies_v2";
const LS_CATS = "rs_cache_categories_v1";

const readCache = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
};
const writeCache = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

// Count episodes for display badge ("12 EP", "2S · 24 EP") without keeping
// the full episode payload in memory — that payload alone can be hundreds of
// MB across the AN catalog and crashes mobile browsers when loaded into the
// React tree.
const countEpisodesShallow = (seasonsObj: any): { seasons: number; episodes: number } => {
  if (!seasonsObj || typeof seasonsObj !== "object") return { seasons: 0, episodes: 0 };
  const seasons = Object.values(seasonsObj);
  let episodes = 0;
  for (const s of seasons as any[]) {
    if (s?.episodes && typeof s.episodes === "object") {
      episodes += Object.keys(s.episodes).length;
    }
  }
  return { seasons: seasons.length, episodes };
};

const collectLanguagesShallow = (item: any): string[] | undefined => {
  const set = new Set<string>();
  if (Array.isArray(item.availableLanguages)) item.availableLanguages.forEach((l: string) => l && set.add(l));
  if (item.audioTracks && typeof item.audioTracks === "object") {
    Object.values(item.audioTracks).forEach((at: any) => at?.language && set.add(at.language));
  }
  if (item.seasonsByLanguage && typeof item.seasonsByLanguage === "object") {
    Object.keys(item.seasonsByLanguage).forEach((l) => l && set.add(l));
  }
  return set.size > 0 ? Array.from(set) : undefined;
};

// LITE mapper: keeps only what AnimeCard / list views / filters need.
// Heavy payloads (seasons, seasonsByLanguage, audioTracks, cast, storyline)
// are fetched on-demand via hydrateAnime() when the user opens an item.
const mapWebseriesLite = (id: string, item: any): AnimeItem => {
  const isAn = Boolean(item.anSlug || item.animeSaltSlug || item.sourceName === "AnimeSalt");
  const displayAs = String(item.displayAs || (isAn ? "an" : "rs")).toLowerCase();
  const cardSource: AnimeItem["source"] = displayAs === "an" ? "animesalt" : "firebase";
  const counts = countEpisodesShallow(item.seasons);
  return {
    id,
    source: cardSource,
    sourceName: item.sourceName || (isAn ? "AnimeSalt" : undefined),
    anSlug: item.anSlug || item.animeSaltSlug || undefined,
    animeSaltSlug: item.animeSaltSlug || item.anSlug || undefined,
    displayAs: item.displayAs || undefined,
    slug: item.slug || item.anSlug || item.animeSaltSlug || undefined,
    title: item.title || "",
    poster: item.poster || "",
    backdrop: item.backdrop || "",
    year: item.year || "",
    rating: item.rating || "",
    language: item.language || "",
    baseLanguage: item.baseLanguage || item.language || "",
    availableLanguages: collectLanguagesShallow(item),
    category: item.category || "",
    type: "webseries",
    storyline: "",
    dubType: item.dubType || "official",
    trailer: undefined,
    movieLink: undefined,
    createdAt: item.createdAt || 0,
    updatedAt: item.updatedAt || 0,
    // Lightweight hints used by AnimeCard's episode badge.
    ...(counts.episodes > 0 ? { episodeCount: counts.episodes, seasonsCount: counts.seasons } as any : {}),
  };
};

const mapMovieLite = (id: string, item: any): AnimeItem => {
  const isAn = Boolean(item.anSlug || item.animeSaltSlug || item.sourceName === "AnimeSalt" || item.source === "animesalt");
  const displayAs = String(item.displayAs || (isAn ? "an" : "rs")).toLowerCase();
  const cardSource: AnimeItem["source"] = displayAs === "an" ? "animesalt" : "firebase";
  return {
    id,
    source: cardSource,
    sourceName: item.sourceName || (isAn ? "AnimeSalt" : undefined),
    anSlug: item.anSlug || item.animeSaltSlug || undefined,
    animeSaltSlug: item.animeSaltSlug || item.anSlug || undefined,
    displayAs: item.displayAs || undefined,
    slug: item.slug || item.anSlug || item.animeSaltSlug || undefined,
    title: item.title || "",
    poster: item.poster || "",
    backdrop: item.backdrop || "",
    year: item.year || "",
    rating: item.rating || "",
    language: item.language || "",
    baseLanguage: item.baseLanguage || item.language || "",
    availableLanguages: collectLanguagesShallow(item),
    category: item.category || "",
    type: "movie",
    storyline: "",
    dubType: item.dubType || "official",
    // Movie links are tiny strings — safe to keep in list so home/hero plays directly.
    movieLink: item.movieLink || "",
    movieLink480: item.movieLink480 || undefined,
    movieLink720: item.movieLink720 || undefined,
    movieLink1080: item.movieLink1080 || undefined,
    movieLink4k: item.movieLink4k || undefined,
    trailer: undefined,
    seasons: undefined,
    createdAt: item.createdAt || 0,
    updatedAt: item.updatedAt || 0,
  };
};

// Full mapper — only used by hydrateAnime() for a single item on click.
const mapEpisode = (ep: any) => ({
  episodeNumber: ep.episodeNumber || 0,
  title: ep.title || "",
  link: ep.link || "",
  link480: ep.link480 || undefined,
  link720: ep.link720 || undefined,
  link1080: ep.link1080 || undefined,
  link4k: ep.link4k || undefined,
  subtitleTracks: ep.subtitleTracks ? Object.values(ep.subtitleTracks).map((st: any) => ({
    language: st.language || undefined,
    label: st.label || st.language || "Subtitle",
    url: st.url || st.link || "",
  })).filter((st: any) => st.url) : undefined,
  audioTracks: ep.audioTracks ? Object.values(ep.audioTracks).map((at: any) => ({
    language: at.language || "",
    label: at.label || at.language || "",
    link: at.link || at.audioUrl || at.rawAudioUrl || "",
    audioUrl: at.audioUrl || at.link || at.rawAudioUrl || undefined,
    rawAudioUrl: at.rawAudioUrl || at.audioUrl || at.link || undefined,
    isDefault: at.isDefault === true,
    link480: at.link480 || undefined,
    link720: at.link720 || undefined,
    link1080: at.link1080 || undefined,
    link4k: at.link4k || undefined,
  })) : undefined,
});

const mapWebseriesFull = (id: string, item: any): AnimeItem => {
  const base = mapWebseriesLite(id, item);
  return {
    ...base,
    storyline: item.storyline || "",
    cast: Array.isArray(item.cast) ? item.cast : item.cast ? Object.values(item.cast) : undefined,
    audioTracks: item.audioTracks ? Object.values(item.audioTracks).map((at: any) => ({
      language: at.language || "",
      label: at.label || at.language || "",
      link: at.link || at.audioUrl || at.rawAudioUrl || "",
      audioUrl: at.audioUrl || at.link || at.rawAudioUrl || undefined,
      rawAudioUrl: at.rawAudioUrl || at.audioUrl || at.link || undefined,
      isDefault: at.isDefault === true,
      link480: at.link480 || undefined,
      link720: at.link720 || undefined,
      link1080: at.link1080 || undefined,
      link4k: at.link4k || undefined,
    })) : undefined,
    trailer: item.trailer || undefined,
    seasonsByLanguage: item.seasonsByLanguage && typeof item.seasonsByLanguage === "object"
      ? Object.fromEntries(
          Object.entries(item.seasonsByLanguage).map(([lang, seasons]: [string, any]) => [
            lang,
            Array.isArray(seasons)
              ? seasons.map((s: any) => ({
                  name: s.name || "",
                  episodes: s.episodes ? Object.values(s.episodes).map(mapEpisode) : [],
                }))
              : [],
          ]),
        )
      : undefined,
    seasons: item.seasons
      ? Object.values(item.seasons).map((s: any) => ({
          name: s.name || "",
          episodes: s.episodes ? Object.values(s.episodes).map(mapEpisode) : [],
        }))
      : undefined,
  };
};

const mapMovieFull = (id: string, item: any): AnimeItem => {
  const base = mapMovieLite(id, item);
  return {
    ...base,
    storyline: item.storyline || "",
    cast: Array.isArray(item.cast) ? item.cast : item.cast ? Object.values(item.cast) : undefined,
    audioTracks: item.audioTracks ? Object.values(item.audioTracks).map((at: any) => ({
      language: at.language || "",
      label: at.label || at.language || "",
      link: at.link || at.audioUrl || at.rawAudioUrl || "",
      audioUrl: at.audioUrl || at.link || at.rawAudioUrl || undefined,
      rawAudioUrl: at.rawAudioUrl || at.audioUrl || at.link || undefined,
      isDefault: at.isDefault === true,
      link480: at.link480 || undefined,
      link720: at.link720 || undefined,
      link1080: at.link1080 || undefined,
      link4k: at.link4k || undefined,
    })) : undefined,
    trailer: item.trailer || undefined,
  };
};

// Single-item full hydration — called when the user opens a card.
// Reads the full payload (with seasons / audioTracks) for ONE item only.
export async function hydrateAnime(lite: AnimeItem): Promise<AnimeItem> {
  try {
    const path = lite.type === "movie" ? `movies/${lite.id}` : `webseries/${lite.id}`;
    const snap = await get(ref(db, path));
    const raw = snap.val();
    if (!raw) return lite;
    return lite.type === "movie" ? mapMovieFull(lite.id, raw) : mapWebseriesFull(lite.id, raw);
  } catch {
    return lite;
  }
}

// Cheap signature so we skip setState on byte-identical snapshots without
// running JSON.stringify on the entire (100MB) payload.
const fingerprint = (items: AnimeItem[]) => {
  let s = `${items.length}`;
  for (const it of items) s += `|${it.id}:${it.updatedAt || 0}`;
  return s;
};

export function useFirebaseData() {
  const [webseries, setWebseries] = useState<AnimeItem[]>(() => readCache<AnimeItem[]>(LS_WS, []));
  const [movies, setMovies] = useState<AnimeItem[]>(() => readCache<AnimeItem[]>(LS_MOV, []));
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

    let lastCatsSig = "";
    let lastWsSig = "";
    let lastMovSig = "";

    const catsRef = ref(db, "categories");
    const unsubCats = onValue(catsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const cats: string[] = [];
      Object.values(data).forEach((cat: any) => { if (cat.name) cats.push(cat.name); });
      const sig = cats.join("|");
      if (sig !== lastCatsSig) {
        lastCatsSig = sig;
        setCategories(cats);
        writeCache(LS_CATS, cats);
      }
      checkLoaded();
    });

    const wsRef = ref(db, "webseries");
    const unsubWs = onValue(wsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const publicItems: AnimeItem[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        if (item?.visibility === "private") return;
        publicItems.push(mapWebseriesLite(id, item));
      });
      publicItems.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      const sig = fingerprint(publicItems);
      if (sig !== lastWsSig) {
        lastWsSig = sig;
        setWebseries(publicItems);
        writeCache(LS_WS, publicItems);
      }
      checkLoaded();
    });

    const movRef = ref(db, "movies");
    const unsubMov = onValue(movRef, (snapshot) => {
      const data = snapshot.val() || {};
      const publicItems: AnimeItem[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        if (item?.visibility === "private") return;
        publicItems.push(mapMovieLite(id, item));
      });
      publicItems.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      const sig = fingerprint(publicItems);
      if (sig !== lastMovSig) {
        lastMovSig = sig;
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

  const hydrate = useCallback((item: AnimeItem) => hydrateAnime(item), []);

  return { webseries, movies, categories, allAnime, loading, hydrate };
}
