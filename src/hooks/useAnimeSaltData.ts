import { useState, useEffect } from 'react';
import { animeSaltApi } from '@/lib/animeSaltApi';
import type { AnimeItem } from '@/data/animeData';
import { readPersistentCache, updateCachedState, writePersistentCache } from '@/lib/persistentCache';

const CACHE_KEY = 'animesalt_all_v3';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export function useAnimeSaltData() {
  const [items, setItems] = useState<AnimeItem[]>(() => readPersistentCache<{ items?: AnimeItem[] }>(CACHE_KEY, {})?.items || []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const parsed = readPersistentCache<{ items?: AnimeItem[]; _ts?: number }>(CACHE_KEY, {});
    const cachedItems = Array.isArray(parsed.items) ? parsed.items : [];
    if (cachedItems.length > 0 && Date.now() - (parsed._ts || 0) < CACHE_DURATION) {
      updateCachedState(setItems, CACHE_KEY, cachedItems);
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const result = await animeSaltApi.browseAll();

        if (result.success && result.items) {
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

          updateCachedState(setItems, CACHE_KEY, converted);
          // Use localStorage for longer cache (survives page reload)
          writePersistentCache(CACHE_KEY, { items: converted, _ts: Date.now() });
        }
      } catch (err) {
        console.error('AnimeSalt load failed:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return { items, loading };
}
