import { useEffect, useState } from "react";
import type { AnimeItem } from "@/data/animeData";
import { db, limitToLast, onValue, orderByChild, query, ref } from "@/lib/firebase";
import { mapAnimeSaltSelectedItem } from "@/lib/firebaseAnimeMapper";

const CACHE_KEY = "rs_cache_animesalt_selected_cards_v1";
const SELECTED_BATCH_LIMIT = 160;

const readCache = (): AnimeItem[] => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const writeCache = (items: AnimeItem[]) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)); } catch {}
};

export function useSelectedAnimeSalt() {
  const [items, setItems] = useState<AnimeItem[]>(() => readCache());
  const [loading, setLoading] = useState(() => readCache().length === 0);

  useEffect(() => {
    // Firebase-selected AN/Ad rows are real user-panel cards too, but load them
    // as tiny cached cards and only in batches. Never call the external AN API
    // from the public panel, and never pull every selected row at once.
    const selectedRef = query(ref(db, "animesaltSelected"), orderByChild("addedAt"), limitToLast(SELECTED_BATCH_LIMIT));
    const unsub = onValue(selectedRef, (snap) => {
      const data = snap.val() || {};
      const mapped = Object.entries(data)
        .map(([slug, item]: [string, any]) => mapAnimeSaltSelectedItem(slug, item))
        .filter((item) => item.title && item.poster);
      mapped.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      setItems(mapped);
      writeCache(mapped);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  return { items, loading };
}