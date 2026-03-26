import { useState, useEffect } from 'react';
import { animeSaltApi } from '@/lib/animeSaltApi';
import type { AnimeItem } from '@/data/animeData';

const CACHE_KEY = 'animesalt_all_v3';
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

export function useAnimeSaltData() {
  const [items, setItems] = useState<AnimeItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try cache first
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.items?.length > 0 && Date.now() - (parsed._ts || 0) < CACHE_DURATION) {
          setItems(parsed.items);
          setLoading(false);
          return; // Use cache
        }
      }
    } catch {}

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
              language: '',
              category: 'AnimeSalt',
              type: item.type === 'movies' ? 'movie' as const : 'webseries' as const,
              storyline: '',
              source: 'animesalt' as const,
              slug: item.slug,
            }));

          setItems(converted);
          // Use localStorage for longer cache (survives page reload)
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ items: converted, _ts: Date.now() }));
          } catch {} // Ignore quota errors
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
