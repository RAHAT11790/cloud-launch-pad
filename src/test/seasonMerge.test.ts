import { describe, expect, it } from "vitest";
import { applySeasonRanges, evenRanges, mergeSeasons } from "@/lib/seasonRanges";

const one = [{ name: "Season 1", episodes: Array.from({ length: 400 }, (_, i) => ({ episodeNumber: i + 1, title: `Episode ${i + 1}`, link: `L${i + 1}` })) }];

describe("season merge", () => {
  it("S1 (1-12) + S2 (1-12) merged shows one counter 1..24", () => {
    const s = [
      { name: "Season 1", episodes: Array.from({ length: 12 }, (_, i) => ({ episodeNumber: i + 1 })) },
      { name: "Season 2", episodes: Array.from({ length: 12 }, (_, i) => ({ episodeNumber: i + 1 })) },
    ];
    const out = mergeSeasons(s, [0, 1]);
    expect(out.length).toBe(1);
    expect(out[0].episodes.map((e: any) => e.episodeNumber)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });
  it("continuous-numbered seasons (51..100) do not double-count after merge", () => {
    const split = applySeasonRanges(one, evenRanges(400, 8), "continuous");
    const out = mergeSeasons(split, [0, 1]);
    expect(out[0].episodes.length).toBe(100);
    expect(out[0].episodes[99].episodeNumber).toBe(100);
    expect(out[0].episodes[99].link).toBe("L100");
  });
  it("split 400 into 8, merge all, split again keeps links in order", () => {
    let s = applySeasonRanges(one, evenRanges(400, 8), "season");
    for (let k = 0; k < 3; k += 1) {
      s = mergeSeasons(s, s.map((_: any, i: number) => i));
      expect(s.length).toBe(1);
      expect(s[0].episodes.map((e: any) => e.link)).toEqual(one[0].episodes.map((e) => e.link));
      expect(s[0].episodes[399].episodeNumber).toBe(400);
      s = applySeasonRanges(s, evenRanges(400, 8), "season");
    }
    expect(s[7].episodes[0].link).toBe("L351");
    expect(s[7].episodes[0].episodeNumber).toBe(1);
  });
  it("merging seasons 2 and 3 keeps season 1 untouched", () => {
    const s = applySeasonRanges(one, evenRanges(400, 4), "season");
    const out = mergeSeasons(s, [2, 1]);
    expect(out.length).toBe(3);
    expect(out[0].episodes.length).toBe(100);
    expect(out[1].episodes.length).toBe(200);
    expect(out[1].episodes[0].link).toBe("L101");
    expect(out[1].episodes[199].episodeNumber).toBe(200);
  });
});

describe("range split across per-season numbering", () => {
  it("two seasons both counting 1..12 split into 1-18 / 19-24 keep order", () => {
    const s = [
      { name: "Season 1", episodes: Array.from({ length: 12 }, (_, i) => ({ episodeNumber: i + 1, link: `A${i + 1}` })) },
      { name: "Season 2", episodes: Array.from({ length: 12 }, (_, i) => ({ episodeNumber: i + 1, link: `B${i + 1}` })) },
    ];
    const out = applySeasonRanges(s, [{ name: "S1", start: 1, end: 18 }, { name: "S2", start: 19, end: 24 }], "season");
    expect(out[0].episodes[12].link).toBe("B1");
    expect(out[0].episodes[12].episodeNumber).toBe(13);
    expect(out[1].episodes[0].link).toBe("B7");
    expect(out[1].episodes[0].episodeNumber).toBe(1);
  });
});
