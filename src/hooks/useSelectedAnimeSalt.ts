import { useEffect, useState } from "react";
import type { AnimeItem } from "@/data/animeData";
import { db, ref, onValue } from "@/lib/firebase";
import {
  GENERIC_CATEGORIES,
  normalizeCastFrom,
  normalizeCategoryFrom,
  normalizeDirectorsFrom,
  normalizeGenresFrom,
  normalizeOverviewFrom,
  normalizeRatingFrom,
  normalizeYearFrom,
} from "@/lib/contentMetadata";

// AN cards are now admin-curated. The user panel reads ONLY from
// `animesaltSelected/{slug}` in Firebase. Video URLs are NEVER stored —
// they are resolved live from the AnimeSalt API at click time.

const SELECTED_PATH = "animesaltSelected";
const CACHE_KEY = "rs_cache_animesalt_selected_v2";
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
  storyline?: string;
  description?: string;
  backdrop?: string;
  genres?: string[];
  directors?: string[];
  cast?: { name: string; character?: string; photo?: string }[] | Record<string, { name: string; character?: string; photo?: string }>;
  category?: string;
  savedAt?: number;
  premium?: boolean;
  premiumEpisodes?: Record<string, boolean>;
};

// Card grid only needs these light fields — trimming cast/overview/genres keeps
// the payload well under localStorage's ~5MB quota so writeCache never silently
// fails. Full metadata is re-hydrated live on card click.
const CACHE_FIELDS: (keyof AnimeItem)[] = [
  "id", "title", "poster", "backdrop", "year", "rating", "language", "category",
  "type", "source", "sourceName", "anSlug", "animeSaltSlug", "slug", "tmdbId",
  "premium", "premiumEpisodes", "createdAt", "updatedAt",
] as any;

const slimForCache = (item: AnimeItem): AnimeItem => {
  const out: any = { seasons: [] };
  CACHE_FIELDS.forEach((k) => { if ((item as any)[k] !== undefined) out[k] = (item as any)[k]; });
  return out as AnimeItem;
};

const readCache = (): AnimeItem[] | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY) || sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return null;
};

const writeCache = (items: AnimeItem[]) => {
  try {
    const slim = items.map(slimForCache);
    const payload = JSON.stringify(slim);
    // Mirror to sessionStorage first — always succeeds even if localStorage is
    // full/quota-blocked — so the next page nav still hits cache instantly.
    try { sessionStorage.setItem(CACHE_KEY, payload); } catch {}
    localStorage.setItem(CACHE_KEY, payload);
  } catch {}
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
  const genres = normalizeGenresFrom(row);
  const category = normalizeCategoryFrom(row, genres, "Anime");
  const cast = normalizeCastFrom(row, 12);
  const directors = normalizeDirectorsFrom(row);
  return {
    id,
    title,
    poster,
    backdrop: String(row?.backdrop || poster || "").trim(),
    year: normalizeYearFrom(row),
    rating: normalizeRatingFrom(row),
    language: "Hindi",
    category,
    type: isMovie ? "movie" : "webseries",
    storyline: normalizeOverviewFrom(row),
    overview: normalizeOverviewFrom(row),
    description: row?.description || row?.overview || row?.storyline || "",
    tmdbId: row?.tmdbId,
    genres: genres.length ? genres : undefined,
    directors: directors.length ? directors : undefined,
    cast: cast.length ? cast : undefined,
    source: "animesalt",
    sourceName: "AnimeSalt",
    anSlug: slug,
    animeSaltSlug: slug,
    slug,
    seasons: [],
    premium: !!row?.premium,
    premiumEpisodes: row?.premiumEpisodes || {},
    createdAt: Number(row?.savedAt || Date.now()),
    updatedAt: Number(row?.savedAt || Date.now()),
  } as AnimeItem;
};

export function useSelectedAnimeSalt() {
  const initial = readCache() || [];
  const [items, setItems] = useState<AnimeItem[]>(initial || []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try { localStorage.removeItem("rs_cache_animesalt_selected_v1"); } catch {}
    let selectedList: AnimeItem[] = readCache() || [];
    if (selectedList.length) {
      setItems(selectedList);
      setLoading(false);
    }

    const unsub = onValue(ref(db, SELECTED_PATH), (snap) => {
      const val = (snap.val() as Record<string, SavedItem>) || {};
      selectedList = Object.values(val)
        .map(mapSaved)
        .filter(Boolean) as AnimeItem[];
      // Newest first
      selectedList.sort((a, b) => (Number(b.createdAt || 0) - Number(a.createdAt || 0)));
      setItems(selectedList);
      writeCache(selectedList);
      setLoading(false);
    });

    return () => { unsub(); };
  }, []);

  return { items, loading };
}
