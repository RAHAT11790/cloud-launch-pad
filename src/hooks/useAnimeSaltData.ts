import { useState, useEffect } from 'react';
import { animeSaltApi } from '@/lib/animeSaltApi';
import type { AnimeItem } from '@/data/animeData';

const CACHE_KEY = 'animesalt_all_v3';
// Silent background refresh cadence. The cache itself never expires — cards
// are always visible from localStorage the moment the app loads, even if the
// network is down. Fresh data merges in whenever the API responds.
const BACKGROUND_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

const readCache = (): AnimeItem[] => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch { return []; }
};

const writeCache = (items: AnimeItem[]) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ items, _ts: Date.now() })); } catch {}
};

const mergeById = (prev: AnimeItem[], next: AnimeItem[]): AnimeItem[] => {
  const map = new Map<string, AnimeItem>();
  prev.forEach((i) => { if (i?.id) map.set(i.id, i); });
  next.forEach((i) => { if (i?.id) map.set(i.id, { ...map.get(i.id), ...i }); });
  return Array.from(map.values());
};

export function useAnimeSaltData() {
  // Hydrate synchronously from localStorage so cards render on first paint,
  // regardless of network / Firebase state.
  const [items, setItems] = useState<AnimeItem[]>(() => readCache());
  const [loading, setLoading] = useState(() => readCache().length === 0);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const result = await animeSaltApi.browseAll();
        if (cancelled || !result?.success || !result.items) return;
        const converted: AnimeItem[] = result.items
          .filter((item: any) => item.poster)
          .map((item: any) => ({
            id: `as_${item.slug}`,
            title: item.title,
            poster: item.poster || '',
            backdrop: item.poster?.replace('/w342/', '/w1280/').replace('/w500/', '/w1280/') || '',
            year: item.year || '',
            rating: '',
            language: item.language || '',
            category: 'AnimeSalt',
            type: item.type === 'movies' ? 'movie' as const : 'webseries' as const,
            storyline: '',
            source: 'animesalt' as const,
            slug: item.slug,
            episodeCount: typeof item.episodeCount === 'number' ? item.episodeCount : undefined,
          }));
        setItems((prev) => {
          const merged = mergeById(prev, converted);
          writeCache(merged);
          return merged;
        });
      } catch {
        // Silent — cached cards remain visible. Never clear the cache.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // First refresh: immediately if empty, otherwise after idle so cached UI
    // paints without contention.
    if (readCache().length === 0) {
      void refresh();
    } else {
      const idle = (window as any).requestIdleCallback;
      if (typeof idle === "function") idle(() => void refresh(), { timeout: 3000 });
      else setTimeout(() => void refresh(), 1500);
    }

    // Silent periodic refresh keeps cards live-synced without ever hiding
    // the UI behind a loading state.
    const interval = window.setInterval(() => { void refresh(); }, BACKGROUND_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onOnline = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return { items, loading };
}
