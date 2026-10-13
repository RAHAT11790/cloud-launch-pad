import type { EmbeddedTrackList } from "@/lib/mkv/trackProbe";

type AudioLike = EmbeddedTrackList["audio"][number];

const langOf = (t?: { language?: string } | null) => String(t?.language || "").toLowerCase().split(/[-_]/)[0];

export const isHindiTrack = (t?: AudioLike | null): boolean => {
  if (!t) return false;
  const lang = langOf(t);
  if (lang === "hi" || lang === "hin" || lang === "hindi") return true;
  return /hindi|हिन्दी|हिंदी/i.test(`${t.label || ""} ${(t as { rawName?: string }).rawName || ""}`);
};

/**
 * Which in-file audio to switch to once an episode is playing.
 * Returns a track number, or null to stay on the file's own (native) audio.
 *  1. The viewer's own choice for this exact file wins ("native" = stay).
 *  2. Otherwise Hindi, whenever the file carries it.
 *  3. Otherwise the last language the viewer picked anywhere.
 */
export function pickDefaultAudio(
  tracks: Pick<EmbeddedTrackList, "audio" | "nativeAudio">,
  mediaPref?: string,
  globalPref?: string,
): number | null {
  const native = tracks.nativeAudio;
  const usable = (t: AudioLike) => t.playable && t.number !== native;
  const byLang = (lang: string) => tracks.audio.find((t) => usable(t) && langOf(t) === lang);
  if (mediaPref === "native") return null;
  if (mediaPref) return byLang(mediaPref)?.number ?? null;
  const hindi = tracks.audio.find(isHindiTrack);
  if (hindi) return hindi.number === native || !hindi.playable ? null : hindi.number;
  if (globalPref) return byLang(globalPref)?.number ?? null;
  return null;
}
