import { useState, useEffect } from 'react';
import { animeSaltApi } from '@/lib/animeSaltApi';
import type { AnimeItem } from '@/data/animeData';

const CACHE_KEY = 'animesalt_all_v3';
// Background refresh interval. The cache itself is PERMANENT — we always show
// cached AN cards immediately on mount even if they're older than this, so the
// user sees a fully-populated homepage regardless of Firebase / network state.
const REFRESH_AFTER_MS = 60 * 60 * 1000; // 1 hour

const readCache = (): AnimeItem[] => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch { return []; }
};

const readCacheAge = (): number => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return Infinity;
    const parsed = JSON.parse(raw);
    return Date.now() - Number(parsed?._ts || 0);
  } catch { return Infinity; }
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
  // Hydrate synchronously from localStorage so cards render immediately even
  // when the network / Firebase is down.
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
      } catch (err) {
        // Never clear the cache on network failure — AN stays visible.
        console.warn('AnimeSalt refresh failed (using cache):', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Only hit network if cache is stale or empty. Otherwise defer.
    if (readCacheAge() > REFRESH_AFTER_MS || readCache().length === 0) {
      void refresh();
    } else {
      setLoading(false);
      // Silent background refresh after idle so cards stay fresh.
      const idle = (window as any).requestIdleCallback;
      const id = typeof idle === 'function'
        ? idle(() => void refresh(), { timeout: 5000 })
        : window.setTimeout(() => void refresh(), 2500);
      return () => {
        cancelled = true;
        try { (window as any).cancelIdleCallback?.(id); } catch {}
        clearTimeout(id as any);
      };
    }

    return () => { cancelled = true; };
  }, []);

  return { items, loading };
}
