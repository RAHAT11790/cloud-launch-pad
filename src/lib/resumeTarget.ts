import { findEpisodeIndexByNumber } from "@/lib/episodeCombo";
import type { Season } from "@/data/animeData";
/** Saved positions are hints; episode numbers survive season range edits. */
export function resolveResumeTarget(seasons: Season[], info: { seasonIdx?: number; season?: number; epIdx?: number; episode?: number; episodeNumber?: number }) {
  let seasonIdx = Math.max(0, Math.trunc(info.seasonIdx ?? (info.season ?? 1) - 1));
  let epIdx = Math.max(0, Math.trunc(info.epIdx ?? (info.episode ?? 1) - 1));
  const number = Number(info.episodeNumber || 0);
  if (number > 0) {
    const local = findEpisodeIndexByNumber(seasons[seasonIdx]?.episodes || [], number);
    if (local >= 0) return { seasonIdx, epIdx: local };
    for (let i = 0; i < seasons.length; i++) {
      const index = findEpisodeIndexByNumber(seasons[i]?.episodes || [], number);
      if (index >= 0) return { seasonIdx: i, epIdx: index };
    }
    return null;
  }
  if (!seasons[seasonIdx]?.episodes?.length) seasonIdx = seasons.findIndex(s => s.episodes?.length);
  if (seasonIdx < 0) return null;
  epIdx = Math.min(epIdx, seasons[seasonIdx].episodes.length - 1);
  return { seasonIdx, epIdx };
}