import { useState, useEffect } from 'react';
import { db, ref, onValue, get } from '@/lib/firebase';
import type { AnimeItem } from '@/data/animeData';

const normalizeUrl = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function useSelectedAnimeSalt() {
  const [items, setItems] = useState<AnimeItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Watch BOTH animesaltSelected (admin curated catalog) AND anSeries (fetched Firebase data).
    // A card is only emitted to the user panel when BOTH exist — i.e. admin has run "Fetch"
    // via the new AN Series tab. This blocks unfetched API-only items so they don't leak.
    let latestSelected: Record<string, any> = {};
    let latestFetched: Record<string, any> = {};
    let bothReady = { sel: false, fetched: false };

    const compute = () => {
      const converted = Object.entries(latestSelected).map(([slug, item]: [string, any]) => {
        const fetchedMeta = latestFetched[slug]?.meta;
        const poster = normalizeUrl(item.poster || item.tmdbPoster || item.posterUrl || fetchedMeta?.poster);
        const backdrop = normalizeUrl(item.backdrop || item.tmdbBackdrop || item.backdropUrl) || poster;
        const createdAt = Number(item.addedAt || item.createdAt || 0);
        const imageUpdatedAt = Number(item.imageUpdatedAt || item.updatedAt || 0);
        const isFetched = !!fetchedMeta;

        const anime: AnimeItem = {
          id: `as_${slug}`,
          title: item.title || fetchedMeta?.title || slug,
          poster,
          backdrop,
          year: item.year || '',
          rating: item.rating || '',
          language: item.language || '',
          category: item.category || 'Imported',
          type: item.type === 'movies' ? 'movie' as const : 'webseries' as const,
          storyline: item.storyline || fetchedMeta?.storyline || '',
          source: 'animesalt' as const,
          slug,
          createdAt,
        };

        return { anime, sortAt: Math.max(createdAt, imageUpdatedAt), isFetched };
      });

      // GATE: only emit series the admin has fetched into Firebase via AN Series tab.
      const visible = converted.filter((entry) => entry.isFetched);
      visible.sort((a, b) => b.sortAt - a.sortAt);
      setItems(visible.map((entry) => entry.anime));
      if (bothReady.sel && bothReady.fetched) setLoading(false);
    };

    const unsubSel = onValue(ref(db, 'animesaltSelected'), (snap) => {
      latestSelected = snap.val() || {};
      bothReady.sel = true;
      compute();
    });
    const unsubFetched = onValue(ref(db, 'anSeries'), (snap) => {
      latestFetched = snap.val() || {};
      bothReady.fetched = true;
      compute();
    });

    return () => { unsubSel(); unsubFetched(); };
  }, []);

  return { items, loading };
}
