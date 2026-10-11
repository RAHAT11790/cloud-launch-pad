// ============================================================
// One-time subtitle scan: real language + "signs only" detection
// ============================================================
// Many uploads tag every subtitle "English", and the extra Hindi / Tamil /
// Telugu tracks are often SIGNS-only (song + on-screen text, ~5 lines in two
// minutes). Picking those looked like "subtitles don't work". A short window
// from the middle of the episode is read once, each text track's language is
// detected from its lines and sparse tracks are labelled "(Signs)". The result
// is stored with the shared track cache so every later viewer gets it free.

import { isPgsTrack, MkvBlockStream, subtitleBlockText, unpackFrame, type MkvCue, type MkvHeader } from "./mkvDemux";
import { HttpRangeSource } from "./mkvEngine";
import { detectSubtitleLanguage } from "./subtitleLanguage";

export interface SubtitleScanTrack { lang: string; cues: number }
export type SubtitleScan = Record<number, SubtitleScanTrack>;

const LANG_CODE: Record<string, string> = {
  English: "en", Hindi: "hi", Bengali: "bn", Tamil: "ta", Telugu: "te", Kannada: "kn", Malayalam: "ml",
  Punjabi: "pa", Gujarati: "gu", Japanese: "ja", Korean: "ko", Chinese: "zh", Thai: "th", Russian: "ru",
  Arabic: "ar", Urdu: "ur",
};
export const languageCodeFor = (name: string) => LANG_CODE[name] || name.slice(0, 2).toLowerCase();

/** A track is "signs only" when it has far fewer lines than the busiest dialogue track. */
export const isSparseTrack = (cues: number, busiest: number) => busiest >= 8 && cues <= Math.max(2, Math.floor(busiest * 0.3));

const durationSeconds = (header: MkvHeader, cues: MkvCue[]) => {
  if (header.durationMs > 0) return header.durationMs / 1000;
  const last = cues[cues.length - 1];
  return last ? (last.timeTicks * header.timecodeScale) / 1e9 : 0;
};

/** Read `windowSec` of the episode from ~30% in and summarise every text subtitle. */
export async function scanSubtitleTracks(corsUrl: string, header: MkvHeader, cues: MkvCue[], windowSec = 50): Promise<SubtitleScan> {
  const text = header.subtitles.filter((s) => s.route === "text" && !isPgsTrack(s));
  if (!text.length) return {};
  const total = durationSeconds(header, cues);
  const start = total > 240 ? Math.max(90, total * 0.3) : Math.max(0, total * 0.2);
  const startTicks = (start * 1e9) / header.timecodeScale;
  let pos = cues[0]?.pos ?? header.firstClusterPos;
  for (const c of cues) { if (c.timeTicks <= startTicks) pos = c.pos; else break; }
  const source = new HttpRangeSource(corsUrl);
  const lines = new Map<number, string[]>(text.map((t) => [t.number, []]));
  try {
    const reader = new MkvBlockStream(source, pos, new Set(text.map((t) => t.number)), 512 * 1024);
    reader.pauseAtTicks = Math.floor(((start + windowSec) * 1e9) / header.timecodeScale);
    for (let guard = 0; guard < 20000; guard += 1) {
      const block = await reader.next();
      if (!block) break;
      const track = text.find((t) => t.number === block.track);
      if (!track) continue;
      for (const raw of block.frames) {
        const frame = await unpackFrame(track, raw).catch(() => null);
        const line = frame ? subtitleBlockText(track, frame) : "";
        if (line) lines.get(track.number)!.push(line);
      }
    }
  } finally {
    source.abort();
  }
  const out: SubtitleScan = {};
  lines.forEach((list, number) => { out[number] = { lang: detectSubtitleLanguage(list), cues: list.length }; });
  return out;
}
