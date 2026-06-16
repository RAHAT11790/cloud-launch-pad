import { useState, useEffect, useRef } from 'react';
import { db, ref, onValue } from '@/lib/firebase';
import type { AnimeItem } from '@/data/animeData';

const normalizeUrl = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const CACHE_KEY = 'rs_cache_animesalt_selected_v1';

const readCache = (): AnimeItem[] => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); } catch { return []; }
};

const writeCache = (items: AnimeItem[]) => {
  const run = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)); } catch {} };
  try {
    const idle = (window as any).requestIdleCallback;
    if (typeof idle === 'function') idle(run, { timeout: 1500 });
    else window.setTimeout(run, 0);
  } catch { run(); }
};

const signature = (items: AnimeItem[]) =>
  items.map((item) => `${item.id}:${item.createdAt || 0}:${item.poster || ''}:${item.backdrop || ''}:${item.title || ''}`).join('|');

export function useSelectedAnimeSalt() {
  const [items, setItems] = useState<AnimeItem[]>(() => readCache());
  const [loading, setLoading] = useState(() => readCache().length === 0);
  const sigRef = useRef(signature(items));

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
      const nextItems = converted.map((entry) => entry.anime);
      const sig = signature(nextItems);
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setItems(nextItems);
        writeCache(nextItems);
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  return { items, loading };
}
