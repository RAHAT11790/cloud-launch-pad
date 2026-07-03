import { useState, useEffect } from 'react';
import { animeSaltApi } from '@/lib/animeSaltApi';
import type { AnimeItem } from '@/data/animeData';

const CACHE_KEY = 'animesalt_all_v3';
// AN cards are permanent in localStorage. We only revalidate against the
// upstream API once per hour (category refresh cadence). Refreshes never
// happen on every page mount / reload — that was the "preload storm" the
// user was seeing. RS uses Firebase realtime; AN uses this cached window.
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

type CacheShape = { items: AnimeItem[]; _ts: number };

const readCacheRaw = (): CacheShape | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.items)) return null;
    return { items: parsed.items, _ts: Number(parsed._ts) || 0 };
  } catch { return null; }
};

const readCache = (): AnimeItem[] => readCacheRaw()?.items || [];
const readCacheAge = (): number => {
  const c = readCacheRaw();
  return c ? Date.now() - c._ts : Infinity;
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

    // Only fetch on mount if:
    //  a) cache is empty, or
    //  b) cache is older than the 1-hour refresh window.
    // Otherwise the cards stay in localStorage — no network request per
    // refresh, matching RS's realtime-cached behavior.
    const age = readCacheAge();
    if (readCache().length === 0 || age >= REFRESH_INTERVAL_MS) {
      void refresh();
    } else {
      setLoading(false);
    }

    // Hourly background sync while the tab lives; also runs when the tab
    // returns to focus after >= 1 hour, or when connectivity comes back.
    const interval = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    const maybeRefresh = () => { if (readCacheAge() >= REFRESH_INTERVAL_MS) void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") maybeRefresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", maybeRefresh);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", maybeRefresh);
    };
  }, []);

  return { items, loading };
}
