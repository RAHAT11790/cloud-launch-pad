import { describe, expect, it } from "vitest";
import { applySubtitleScan, type EmbeddedTrackList } from "@/lib/mkv/trackProbe";
import { isSparseTrack } from "@/lib/mkv/subtitleScan";

const sub = (number: number, language: string) => ({ number, kind: "subtitle" as const, label: "English", rawName: "@Hindi_Anime_Station", language, codec: "ASS", isDefault: false, playable: true, bitmap: false });
// Real counts read from The Ramparts of Ice S02E01 (120 s window).
const list: EmbeddedTrackList = { container: "mkv", nativeAudio: 1, audio: [], subtitles: [sub(7, "eng"), sub(8, "eng"), sub(9, "eng"), sub(10, "hin"), sub(11, "tam"), sub(12, "tel")] };
const scan = { 7: { lang: "English", cues: 36 }, 8: { lang: "English", cues: 5 }, 9: { lang: "English", cues: 44 }, 10: { lang: "Hindi", cues: 5 }, 11: { lang: "Tamil", cues: 5 }, 12: { lang: "Telugu", cues: 5 } };

describe("subtitle scan labels", () => {
  it("marks a track with 5 lines next to 44 as signs-only", () => {
    expect(isSparseTrack(5, 44)).toBe(true);
    expect(isSparseTrack(36, 44)).toBe(false);
  });
  it("labels the Ramparts of Ice tracks by real language and signs", () => {
    const labels = applySubtitleScan(list, scan).subtitles.map((t) => t.label);
    expect(labels).toEqual(["English", "English 2", "English (Signs)", "Hindi (Signs)", "Tamil (Signs)", "Telugu (Signs)"]);
  });
  it("renames tracks tagged English whose lines are Hindi", () => {
    const out = applySubtitleScan({ ...list, subtitles: [sub(3, "eng"), sub(4, "eng")] }, { 3: { lang: "English", cues: 30 }, 4: { lang: "Hindi", cues: 28 } });
    expect(out.subtitles.map((t) => t.label)).toEqual(["English", "Hindi"]);
  });
});
