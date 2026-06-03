import { useState, useEffect } from 'react';
import { db, ref, onValue } from '@/lib/firebase';
import type { AnimeItem } from '@/data/animeData';

const normalizeUrl = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const selectedAnimeSaltCache: { items: AnimeItem[]; loaded: boolean } = { items: [], loaded: false };

export const mapSelectedAnimeSaltItem = (slug: string, item: any): AnimeItem => {
  const poster = normalizeUrl(item?.poster || item?.tmdbPoster || item?.posterUrl);
  const backdrop = normalizeUrl(item?.backdrop || item?.tmdbBackdrop || item?.backdropUrl) || poster;
  const createdAt = Number(item?.addedAt || item?.createdAt || 0);

  return {
    id: `as_${slug}`,
    title: item?.title || slug,
    poster,
    backdrop,
    year: item?.year || '',
    rating: item?.rating || '',
    language: item?.language || '',
    category: item?.category || 'Imported',
    type: item?.type === 'movies' ? 'movie' as const : 'webseries' as const,
    storyline: item?.storyline || '',
    source: 'animesalt' as const,
    slug,
    createdAt,
  };
};

export function useSelectedAnimeSalt() {
  const [items, setItems] = useState<AnimeItem[]>(() => selectedAnimeSaltCache.items);
  const [loading, setLoading] = useState(() => !selectedAnimeSaltCache.loaded);

  useEffect(() => {
    if (selectedAnimeSaltCache.loaded) {
      setLoading(false);
      return;
    }

    const unsub = onValue(ref(db, 'animesaltSelected'), (snap) => {
      const data = snap.val() || {};

      const converted = Object.entries(data).map(([slug, item]: [string, any]) => {
        const createdAt = Number(item.addedAt || item.createdAt || 0);
        const imageUpdatedAt = Number(item.imageUpdatedAt || item.updatedAt || 0);
        const anime = mapSelectedAnimeSaltItem(slug, item);

        return { anime, sortAt: Math.max(createdAt, imageUpdatedAt) };
      });

      converted.sort((a, b) => b.sortAt - a.sortAt);
      const nextItems = converted.map((entry) => entry.anime);
      selectedAnimeSaltCache.items = nextItems;
      selectedAnimeSaltCache.loaded = true;
      setItems(nextItems);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  return { items, loading };
}
