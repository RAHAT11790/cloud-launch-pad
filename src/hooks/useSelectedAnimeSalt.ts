import { useState, useEffect } from 'react';
import { db, ref, onValue } from '@/lib/firebase';
import type { AnimeItem } from '@/data/animeData';
import { readPersistentCache, updateCachedState } from '@/lib/persistentCache';

const LS_ANIME_SALT_SELECTED = 'rs_cache_animesalt_selected_v1';

const normalizeUrl = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function useSelectedAnimeSalt() {
  const [items, setItems] = useState<AnimeItem[]>(() => readPersistentCache<AnimeItem[]>(LS_ANIME_SALT_SELECTED, []));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = onValue(ref(db, 'animesaltSelected'), (snap) => {
      const data = snap.val() || {};

      const converted = Object.entries(data).map(([slug, item]: [string, any]) => {
        const poster = normalizeUrl(item.poster || item.tmdbPoster || item.posterUrl);
        const backdrop = normalizeUrl(item.backdrop || item.tmdbBackdrop || item.backdropUrl) || poster;
        const createdAt = Number(item.addedAt || item.createdAt || 0);
        const imageUpdatedAt = Number(item.imageUpdatedAt || item.updatedAt || 0);

        const anime: AnimeItem = {
          id: `as_${slug}`,
          title: item.title || slug,
          poster,
          backdrop,
          year: item.year || '',
          rating: item.rating || '',
          language: item.language || '',
          category: item.category || 'Imported',
          type: item.type === 'movies' ? 'movie' as const : 'webseries' as const,
          storyline: item.storyline || '',
          source: 'animesalt' as const,
          slug,
          createdAt,
        };

        return { anime, sortAt: Math.max(createdAt, imageUpdatedAt) };
      });

      converted.sort((a, b) => b.sortAt - a.sortAt);
      updateCachedState(setItems, LS_ANIME_SALT_SELECTED, converted.map((entry) => entry.anime));
      setLoading(false);
    });

    return () => unsub();
  }, []);

  return { items, loading };
}
