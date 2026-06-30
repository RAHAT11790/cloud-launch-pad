import { useEffect, useState } from "react";
import type { AnimeItem } from "@/data/animeData";
import { db, ref, onValue } from "@/lib/firebase";

// AN cards are now admin-curated. The user panel reads ONLY from
// `animesaltSelected/{slug}` in Firebase. Video URLs are NEVER stored —
// they are resolved live from the AnimeSalt API at click time.

const SELECTED_PATH = "animesaltSelected";
const CACHE_KEY = "rs_cache_animesalt_selected_v1";

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

const mapSaved = (row: SavedItem): AnimeItem | null => {
  const slug = String(row?.slug || "").trim();
  const title = String(row?.title || "").trim();
  if (!slug || !title) return null;
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

export function useSelectedAnimeSalt() {
  const initial = readCache();
  const [items, setItems] = useState<AnimeItem[]>(initial || []);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    const unsub = onValue(ref(db, SELECTED_PATH), (snap) => {
      const val = (snap.val() as Record<string, SavedItem>) || {};
      const list = Object.values(val)
        .map(mapSaved)
        .filter(Boolean) as AnimeItem[];
      // Newest first
      list.sort((a, b) => (Number(b.createdAt || 0) - Number(a.createdAt || 0)));
      setItems(list);
      writeCache(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return { items, loading };
}
