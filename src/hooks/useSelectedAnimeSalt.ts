import { useEffect, useState } from "react";
import type { AnimeItem } from "@/data/animeData";
import { db, ref, onValue } from "@/lib/firebase";
import { animeSaltApi } from "@/lib/animeSaltApi";

// AN cards are now admin-curated. The user panel reads ONLY from
// `animesaltSelected/{slug}` in Firebase. Video URLs are NEVER stored —
// they are resolved live from the AnimeSalt API at click time.

const SELECTED_PATH = "animesaltSelected";
const CACHE_KEY = "rs_cache_animesalt_selected_v1";
const API_CACHE_KEY = "rs_cache_animesalt_api_cards_v3";
const API_CACHE_TTL = 30 * 60 * 1000;
const CARTOON_BLOCK_RE = /\b(?:ben\s*10|alien\s*swarm|omniverse|ultimate\s*alien|generator\s*rex|teen\s*titans|justice\s*league|batman|superman|spider\s*man|avengers|tom\s*(?:and|&)\s*jerry|looney\s*tunes|scooby\s*doo|powerpuff|regular\s*show|adventure\s*time|gumball|samurai\s*jack|kung\s*fu\s*panda|madagascar|minions|despicable\s*me|cars|toy\s*story|frozen|shrek|ice\s*age|hotel\s*transylvania|cartoon\s*network|nickelodeon|disney|pixar|tintin|tin\s*tin|avatar\s*the\s*last\s*airbender|sponge\s*bob|jurassic\s*world|sausage\s*party|maya\s*and\s*the\s*three|hazbin\s*hotel|captain\s*laserhawk|invincible|zig\s*and\s*sharko|twilight\s*of\s*the\s*gods|arcane|jentry\s*chau|vox\s*machina|dragon\s*prince|castlevania)\b/i;
const ANIME_ALLOW_RE = /\b(?:pokemon|pokémon|doraemon|shin\s*chan|crayon\s*shin|naruto|boruto|one\s*piece|dragon\s*ball|bleach|demon\s*slayer|jujutsu\s*kaisen|attack\s*on\s*titan|detective\s*conan)\b/i;

type SavedItem = {
  slug: string;
  title: string;
  poster: string;
  year?: string;
  type?: "series" | "movies";
  tmdbId?: number;
  rating?: string;
  overview?: string;
  backdrop?: string;
  genres?: string[];
  directors?: string[];
  cast?: { name: string; character?: string; photo?: string }[] | Record<string, { name: string; character?: string; photo?: string }>;
  category?: string;
  savedAt?: number;
};

const readCache = (): AnimeItem[] | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return null;
};

const writeCache = (items: AnimeItem[]) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(items));
  } catch {}
};

const readApiCache = (): AnimeItem[] | null => {
  try {
    const raw = localStorage.getItem(API_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.ts && Date.now() - Number(parsed.ts) < API_CACHE_TTL && Array.isArray(parsed.items)) return parsed.items;
  } catch {}
  return null;
};

const writeApiCache = (items: AnimeItem[]) => {
  try { localStorage.setItem(API_CACHE_KEY, JSON.stringify({ ts: Date.now(), items })); } catch {}
};

const mergeBySlug = (...groups: AnimeItem[][]) => {
  const map = new Map<string, AnimeItem>();
  groups.flat().forEach((item) => {
    if (!item?.id) return;
    const slug = String(item.anSlug || item.animeSaltSlug || item.slug || item.id).toLowerCase();
    const key = `${item.type}:${slug}`;
    const prev = map.get(key);
    // Curated Firebase rows win when they have richer metadata, API rows keep AN visible everywhere.
    if (!prev || Number(item.updatedAt || item.createdAt || 0) >= Number(prev.updatedAt || prev.createdAt || 0)) map.set(key, item);
  });
  return Array.from(map.values()).sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
};

const mapSaved = (row: SavedItem): AnimeItem | null => {
  const slug = String(row?.slug || "").trim();
  const title = String(row?.title || "").trim();
  if (!slug || !title) return null;
  const blob = `${title} ${slug}`.replace(/[-_]+/g, " ").toLowerCase();
  if (CARTOON_BLOCK_RE.test(blob) && !ANIME_ALLOW_RE.test(blob)) return null;
  const isMovie = String(row?.type || "").toLowerCase().includes("movie");
  const id = isMovie ? `an_mv_${slug}` : `an_${slug}`;
  const poster = String(row?.poster || "").trim();
  return {
    id,
    title,
    poster,
    backdrop: String(row?.backdrop || poster || "").trim(),
    year: String(row?.year || "").trim(),
    rating: String(row?.rating || "").trim(),
    language: "Hindi",
    category: String(row?.category || "Anime").trim() || "Anime",
    type: isMovie ? "movie" : "webseries",
    storyline: String(row?.overview || "").trim(),
    tmdbId: row?.tmdbId,
    genres: Array.isArray(row?.genres) ? row.genres : undefined,
    directors: Array.isArray(row?.directors) ? row.directors : undefined,
    cast: Array.isArray(row?.cast) ? row.cast : row?.cast ? Object.values(row.cast) : undefined,
    source: "animesalt",
    sourceName: "AnimeSalt",
    anSlug: slug,
    animeSaltSlug: slug,
    slug,
    seasons: [],
    createdAt: Number(row?.savedAt || Date.now()),
    updatedAt: Number(row?.savedAt || Date.now()),
  } as AnimeItem;
};

const mapApiItem = (row: any): AnimeItem | null => {
  const slug = String(row?.slug || row?.id || "").trim();
  const title = String(row?.title || row?.name || "").trim();
  if (!slug || !title) return null;
  const blob = `${title} ${slug}`.replace(/[-_]+/g, " ").toLowerCase();
  if (CARTOON_BLOCK_RE.test(blob) && !ANIME_ALLOW_RE.test(blob)) return null;
  const rawType = String(row?.type || row?.contentType || "series").toLowerCase();
  const isMovie = rawType.includes("movie");
  const poster = String(row?.poster || row?.image || row?.thumb || "").trim();
  if (!poster) return null;
  const now = Date.now();
  return {
    id: isMovie ? `an_mv_${slug}` : `an_${slug}`,
    title,
    poster,
    backdrop: String(row?.backdrop || row?.poster || poster || "").trim(),
    year: String(row?.year || "").trim(),
    rating: String(row?.rating || row?.vote || "").trim(),
    language: "Hindi",
    category: String(row?.category || "Anime").trim() || "Anime",
    type: isMovie ? "movie" : "webseries",
    storyline: String(row?.overview || row?.storyline || row?.description || "").trim(),
    source: "animesalt",
    sourceName: "AnimeSalt",
    anSlug: slug,
    animeSaltSlug: slug,
    slug,
    seasons: [],
    episodeCount: typeof row?.episodeCount === "number" ? row.episodeCount : undefined,
    createdAt: Number(row?.savedAt || row?.updatedAt || now),
    updatedAt: Number(row?.savedAt || row?.updatedAt || now),
  } as AnimeItem;
};

export function useSelectedAnimeSalt() {
  const initial = mergeBySlug(readApiCache() || [], readCache() || []);
  const [items, setItems] = useState<AnimeItem[]>(initial || []);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    let cancelled = false;
    let selectedList: AnimeItem[] = readCache() || [];
    const cachedApi = readApiCache() || [];
    if (cachedApi.length || selectedList.length) {
      setItems(mergeBySlug(cachedApi, selectedList));
      setLoading(false);
    }

    const loadApiCards = async (force = false) => {
      if (!force && readApiCache()?.length) return;
      try {
        const result: any = await animeSaltApi.browseAll(24);
        const apiItems = ((result?.items || []) as any[]).map(mapApiItem).filter(Boolean) as AnimeItem[];
        if (!apiItems.length || cancelled) return;
        writeApiCache(apiItems);
        setItems(mergeBySlug(apiItems, selectedList));
      } catch {
        // Keep Firebase/local cached cards visible if API refresh fails.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const unsub = onValue(ref(db, SELECTED_PATH), (snap) => {
      const val = (snap.val() as Record<string, SavedItem>) || {};
      selectedList = Object.values(val)
        .map(mapSaved)
        .filter(Boolean) as AnimeItem[];
      // Newest first
      selectedList.sort((a, b) => (Number(b.createdAt || 0) - Number(a.createdAt || 0)));
      const apiItems = readApiCache() || [];
      setItems(mergeBySlug(apiItems, selectedList));
      writeCache(selectedList);
      setLoading(false);
      void loadApiCards(false);
    });

    void loadApiCards(false);
    return () => { cancelled = true; unsub(); };
  }, []);

  return { items, loading };
}
