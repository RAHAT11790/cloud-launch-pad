import { getComboSpan, renumberEpisodes } from "@/lib/episodeCombo";

/**
 * Season range splitter: all episodes of a series (in season order) are
 * counted as one continuous list of real episodes, then cut into seasons by
 * ranges such as 1-50, 51-100. Combos stay whole (an entry goes to the range
 * holding its first episode).
 *
 * mode "season"     → every season counts 1..N
 * mode "continuous" → every season keeps the overall number (51..100) and
 *                     stores `episodeStart` so later edits keep that start.
 */
export type NumberingMode = "season" | "continuous";
export interface SeasonRange { name: string; start: number; end: number }

export const flattenSeasonEpisodes = (seasons: any[]): any[] =>
  (Array.isArray(seasons) ? seasons : []).flatMap((s) => {
    const eps = Array.isArray(s?.episodes) ? s.episodes.slice() : [];
    return eps
      .map((ep: any, idx: number) => ({ ep, idx }))
      .sort((a: any, b: any) => (Number(a.ep?.episodeNumber || 0) - Number(b.ep?.episodeNumber || 0)) || a.idx - b.idx)
      .map((x: any) => x.ep);
  });

export const totalRealEpisodes = (seasons: any[]): number =>
  flattenSeasonEpisodes(seasons).reduce((n, ep) => n + getComboSpan(ep), 0);

/** Current ranges of the existing seasons, counted across the whole series. */
export const currentRanges = (seasons: any[]): SeasonRange[] => {
  let next = 1;
  return (Array.isArray(seasons) ? seasons : []).map((s, i) => {
    const count = (Array.isArray(s?.episodes) ? s.episodes : []).reduce((n: number, ep: any) => n + getComboSpan(ep), 0);
    const start = next;
    next += count;
    return { name: String(s?.name || `Season ${i + 1}`), start, end: start + count - 1 };
  });
};

/** Equal split into `parts` seasons. */
export const evenRanges = (total: number, parts: number): SeasonRange[] => {
  const n = Math.max(1, Math.trunc(parts) || 1);
  const size = Math.ceil(Math.max(0, total) / n) || 1;
  const out: SeasonRange[] = [];
  for (let i = 0; i < n; i += 1) {
    const start = i * size + 1;
    if (start > total && i > 0) break;
    out.push({ name: `Season ${i + 1}`, start, end: Math.min(total, start + size - 1) });
  }
  return out;
};

/** Ranges must start at 1, be continuous, non-empty and cover every episode. */
export const validateRanges = (ranges: SeasonRange[], total: number): string | null => {
  if (!ranges.length) return "Add at least one season";
  let expect = 1;
  for (let i = 0; i < ranges.length; i += 1) {
    const r = ranges[i];
    const label = r.name || `Season ${i + 1}`;
    if (!Number.isFinite(r.start) || !Number.isFinite(r.end)) return `${label}: enter both numbers`;
    if (r.start !== expect) return `${label} must start at ${expect}`;
    if (r.end < r.start) return `${label}: end is before start`;
    expect = r.end + 1;
  }
  if (expect - 1 !== total) return `Ranges cover ${expect - 1} of ${total} episodes`;
  return null;
};

export const applySeasonRanges = (seasons: any[], ranges: SeasonRange[], mode: NumberingMode): any[] => {
  const flat = flattenSeasonEpisodes(seasons);
  const old = Array.isArray(seasons) ? seasons : [];
  const buckets: any[][] = ranges.map(() => []);
  let pos = 1;
  flat.forEach((ep) => {
    let k = ranges.findIndex((r) => pos >= r.start && pos <= r.end);
    if (k < 0) k = ranges.length - 1;
    const span = getComboSpan(ep);
    // Overall position as a temporary number keeps order across seasons that
    // each counted from 1 (renumbering sorts by number).
    const tmp: any = { ...ep, episodeNumber: pos };
    if (span > 1) tmp.episodeEnd = pos + span - 1; else delete tmp.episodeEnd;
    buckets[k].push(tmp);
    pos += span;
  });
  return ranges.map((r, i) => {
    const base = { ...(old[i] || {}) };
    delete base.episodeStart;
    const start = mode === "continuous" ? r.start : 1;
    const season: any = { ...base, name: r.name || `Season ${i + 1}`, seasonNumber: i + 1, episodes: renumberEpisodes(buckets[i], start) };
    if (mode === "continuous" && start > 1) season.episodeStart = start;
    return season;
  });
};

/**
 * Combine the selected seasons into the first selected one, in season order.
 * Episodes are renumbered as ONE continuous list from that season's start, so
 * the merged season shows a single counter (1..N) — no leftover numbers from
 * the seasons that were folded in. Combos keep their span.
 */
export const mergeSeasons = (seasons: any[], selected: number[]): any[] => {
  const list = Array.isArray(seasons) ? seasons : [];
  const picks = Array.from(new Set(selected)).filter((i) => i >= 0 && i < list.length).sort((a, b) => a - b);
  if (picks.length < 2) return list.slice();
  const base = list[picks[0]] || {};
  // Temporary strictly increasing numbers keep the flattened order when renumbering.
  const episodes = flattenSeasonEpisodes(picks.map((i) => list[i])).map((ep, idx) => ({ ...ep, episodeNumber: idx + 1, episodeEnd: undefined }));
  const start = Math.max(1, Math.trunc(Number(base?.episodeStart || 0)) || 1);
  const spans = flattenSeasonEpisodes(picks.map((i) => list[i])).map((ep) => getComboSpan(ep));
  let next = start;
  const ordered = episodes.map((ep: any, idx: number) => {
    const span = spans[idx];
    const out: any = { ...ep, episodeNumber: next };
    if (span > 1) out.episodeEnd = next + span - 1; else delete out.episodeEnd;
    if (!ep?.title || /^\s*episode\s*\d+(\s*[-–]\s*\d+)?\s*$/i.test(String(ep.title))) out.title = span > 1 ? `Episode ${next}-${next + span - 1}` : `Episode ${next}`;
    next += span;
    return out;
  });
  const merged: any = { ...base, episodes: ordered };
  const drop = new Set(picks.slice(1));
  return list
    .map((s, i) => (i === picks[0] ? merged : s))
    .filter((_, i) => !drop.has(i))
    .map((s, i) => ({ ...s, seasonNumber: i + 1 }));
};
