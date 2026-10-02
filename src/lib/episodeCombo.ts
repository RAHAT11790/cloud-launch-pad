/**
 * Combo episodes: one stored link that contains several real episodes
 * (e.g. Episode 2 = episodes 2–4). Stored as `episodeNumber` (first) +
 * `episodeEnd` (last). Single episodes have no `episodeEnd`.
 */

export const getEpisodeEnd = (ep: any): number => {
  const start = Math.trunc(Number(ep?.episodeNumber || 0)) || 0;
  const end = Math.trunc(Number(ep?.episodeEnd || 0)) || 0;
  return end > start ? end : start;
};

export const getComboSpan = (ep: any): number => {
  const start = Math.trunc(Number(ep?.episodeNumber || 0)) || 0;
  return Math.max(1, getEpisodeEnd(ep) - start + 1);
};

export const isComboEpisode = (ep: any): boolean => getComboSpan(ep) > 1;

const pad = (n: number, width = 2) => String(Math.max(0, n)).padStart(width, "0");

/** "05" or "02-04" — for compact chips. */
export const formatEpisodeChip = (ep: any, fallbackNumber?: number): string => {
  const start = Math.trunc(Number(ep?.episodeNumber || fallbackNumber || 0)) || 0;
  const end = getEpisodeEnd({ ...ep, episodeNumber: start });
  return end > start ? `${pad(start)}-${pad(end)}` : pad(start);
};

/** "Episode 5" or "Episode 2-4". */
export const formatEpisodeLabel = (ep: any, fallbackNumber?: number): string => {
  const start = Math.trunc(Number(ep?.episodeNumber || fallbackNumber || 0)) || 0;
  const end = getEpisodeEnd({ ...ep, episodeNumber: start });
  return end > start ? `Episode ${start}-${end}` : `Episode ${start}`;
};

/** True when a title is just an auto label like "Episode 7" / "Episode 2-4". */
export const isAutoEpisodeTitle = (title: unknown): boolean =>
  /^\s*episode\s*\d+(\s*[-–]\s*\d+)?\s*$/i.test(String(title || ""));

/**
 * Re-number a season in real-episode order. Array order is kept; numbering
 * follows the current episodeNumber order so reversed lists stay correct.
 * Every combo keeps its span, everything after it shifts automatically.
 * Auto titles ("Episode N") are refreshed; custom titles are kept.
 */
export const renumberEpisodes = <T extends Record<string, any>>(episodes: T[]): T[] => {
  const list = Array.isArray(episodes) ? episodes : [];
  const order = list
    .map((ep, idx) => ({ ep, idx }))
    .sort((a, b) => (Number(a.ep?.episodeNumber || 0) - Number(b.ep?.episodeNumber || 0)) || (a.idx - b.idx));
  const result = list.slice();
  let next = 1;
  order.forEach(({ ep, idx }) => {
    const span = getComboSpan(ep);
    const start = next;
    const end = start + span - 1;
    next = end + 1;
    const updated: any = { ...ep, episodeNumber: start };
    if (span > 1) updated.episodeEnd = end; else delete updated.episodeEnd;
    if (!ep?.title || isAutoEpisodeTitle(ep.title)) {
      updated.title = span > 1 ? `Episode ${start}-${end}` : `Episode ${start}`;
    }
    result[idx] = updated;
  });
  return result;
};

/** Set how many real episodes one entry contains, then renumber the season. */
export const applyComboSpan = <T extends Record<string, any>>(episodes: T[], index: number, span: number, renumber = true): T[] => {
  const list = Array.isArray(episodes) ? episodes.slice() : [];
  const ep: any = list[index];
  if (!ep) return list;
  const safeSpan = Math.max(1, Math.min(50, Math.trunc(Number(span) || 1)));
  const start = Math.trunc(Number(ep.episodeNumber || index + 1)) || index + 1;
  const updated: any = { ...ep };
  if (safeSpan > 1) updated.episodeEnd = start + safeSpan - 1; else delete updated.episodeEnd;
  list[index] = updated;
  return renumber ? renumberEpisodes(list) : list;
};

/** Total real episodes inside a season (combos counted fully). */
export const countRealEpisodes = (episodes: any[]): number =>
  (Array.isArray(episodes) ? episodes : []).reduce((sum, ep) => sum + getComboSpan(ep), 0);
