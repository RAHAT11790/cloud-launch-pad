import { describe, expect, it } from "vitest";
import { buildWebmCluster, buildWebmInit } from "@/lib/mkv/webmWriter";
import { buildInitSegment } from "@/lib/mkv/mp4Writer";
import { assToText, buildTrackLabel } from "@/lib/mkv/mkvDemux";
import { mediaKey, isLikelyMatroska } from "@/lib/mkv/trackProbe";

describe("mkv engine helpers", () => {
  it("writes a tkhd box of the correct size (92 bytes)", () => {
    const init = buildInitSegment({ kind: "video", timescale: 90000, width: 854, height: 480, codecPrivate: new Uint8Array([1, 0x64, 0, 0x28]), codecBox: "avc1" });
    const s = String.fromCharCode(...init);
    const at = s.indexOf("tkhd") - 4;
    expect(new DataView(init.buffer).getUint32(at)).toBe(92);
  });
  it("builds webm init + unlaced cluster", () => {
    const init = buildWebmInit({ codecId: "A_OPUS", sampleRate: 48000, channels: 2, timecodeScale: 1_000_000 });
    expect(Array.from(init.slice(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    const cl = buildWebmCluster([{ ptsTicks: 1000, flags: 0x80, payload: new Uint8Array([1, 2]) }]);
    expect(Array.from(cl.slice(0, 4))).toEqual([0x1f, 0x43, 0xb6, 0x75]);
  });
  it("cleans ASS text and labels", () => {
    expect(assToText("0,0,Default,,0,0,0,,{\\b1}Hello\\NWorld")).toBe("Hello\nWorld");
    expect(buildTrackLabel("audio", "hin", "AnimeTimes Dub~Toonworld4all.me", 0)).toBe("Hindi");
  });
  it("keys files independent of mirror host", () => {
    const a = mediaKey("https://a.trycloudflare.com/451/x.mkv?hash=Ab");
    expect(a).toBe(mediaKey("http://fi5.bot-hosting.net:22134/watch/451/x.mkv?hash=Ab"));
    expect(isLikelyMatroska("https://h/451/x.mkv?hash=1")).toBe(true);
  });
});

import { filterExistingHistory } from "@/lib/historyFilter";
describe("clean names + history", () => {
  it("shows only language names", () => {
    expect(buildTrackLabel("subtitle", "und", "English Subs [Anime Time]", 0)).toBe("English");
    expect(buildTrackLabel("audio", "jpn", "Japanese 2.0 @AnimeTime", 0)).toBe("Japanese");
    expect(buildTrackLabel("audio", "und", "AnimeTime", 1)).toBe("Audio 2");
  });
  it("drops removed anime from history", () => {
    const out = filterExistingHistory([{ id: "a" }, { id: "gone" }, { id: "an_1" }], [{ id: "a" }], true);
    expect(out.map((x) => x.id)).toEqual(["a", "an_1"]);
  });
});
