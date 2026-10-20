import { describe, expect, it } from "vitest";
import { applySeasonRanges, currentRanges, evenRanges, totalRealEpisodes, validateRanges } from "@/lib/seasonRanges";

const one = [{ name: "Season 1", episodes: Array.from({ length: 200 }, (_, i) => ({ episodeNumber: i + 1, title: `Episode ${i + 1}`, link: `L${i + 1}` })) }];

describe("season ranges", () => {
  it("counts 200 episodes and splits evenly into 4 x 50", () => {
    expect(totalRealEpisodes(one)).toBe(200);
    expect(evenRanges(200, 4).map((r) => [r.start, r.end])).toEqual([[1, 50], [51, 100], [101, 150], [151, 200]]);
  });
  it("season mode: season 2 counts 1-50 and holds link 51", () => {
    const out = applySeasonRanges(one, evenRanges(200, 4), "season");
    expect(out[1].episodes[0].episodeNumber).toBe(1);
    expect(out[1].episodes[49].episodeNumber).toBe(50);
    expect(out[1].episodes[0].link).toBe("L51");
  });
  it("continuous mode: season 2 shows 51-100", () => {
    const out = applySeasonRanges(one, evenRanges(200, 4), "continuous");
    expect(out[1].episodes[0].episodeNumber).toBe(51);
    expect(out[1].episodes[49].episodeNumber).toBe(100);
    expect(out[1].episodeStart).toBe(51);
    expect(currentRanges(out).map((r) => r.end)).toEqual([50, 100, 150, 200]);
  });
  it("uneven ranges 1-20 / 21-200 keep all links in order", () => {
    const out = applySeasonRanges(one, [{ name: "A", start: 1, end: 20 }, { name: "B", start: 21, end: 200 }], "season");
    expect(out.map((s) => s.episodes.length)).toEqual([20, 180]);
    expect(out[1].episodes[0].link).toBe("L21");
  });
  it("rejects gaps and incomplete coverage", () => {
    expect(validateRanges([{ name: "A", start: 1, end: 50 }, { name: "B", start: 52, end: 200 }], 200)).toMatch(/start at 51/);
    expect(validateRanges([{ name: "A", start: 1, end: 150 }], 200)).toMatch(/150 of 200/);
    expect(validateRanges(evenRanges(200, 4), 200)).toBeNull();
  });
  it("re-splitting already split seasons back into one keeps 1-200", () => {
    const split = applySeasonRanges(one, evenRanges(200, 4), "continuous");
    const back = applySeasonRanges(split, [{ name: "Season 1", start: 1, end: 200 }], "season");
    expect(back[0].episodes.map((e: any) => e.link)).toEqual(one[0].episodes.map((e) => e.link));
  });
});
