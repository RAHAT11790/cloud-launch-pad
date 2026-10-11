import { describe, expect, it } from "vitest";
import { countRealEpisodes, episodeNumberAt, findEpisodeIndexByNumber, renumberEpisodes } from "@/lib/episodeCombo";

// Beyond Time's Gaze: entry 1 holds episodes 1-3, then 4..42 → 40 entries, 42 real episodes.
const season = renumberEpisodes([{ episodeNumber: 1, episodeEnd: 3 }, ...Array.from({ length: 39 }, (_, i) => ({ episodeNumber: i + 2 }))]);

describe("combo episode counting", () => {
  it("counts 42 real episodes for 40 stored entries", () => {
    expect(season.length).toBe(40);
    expect(countRealEpisodes(season)).toBe(42);
  });
  it("finds real episode 41 and 42 at the last two entries", () => {
    expect(findEpisodeIndexByNumber(season, 41)).toBe(38);
    expect(findEpisodeIndexByNumber(season, 42)).toBe(39);
  });
  it("maps episodes 1, 2 and 3 to the combo entry", () => {
    expect([1, 2, 3].map((n) => findEpisodeIndexByNumber(season, n))).toEqual([0, 0, 0]);
    expect(findEpisodeIndexByNumber(season, 4)).toBe(1);
  });
  it("returns -1 for an episode that does not exist", () => {
    expect(findEpisodeIndexByNumber(season, 43)).toBe(-1);
  });
  it("reports the real number of the last entry as 42", () => {
    expect(episodeNumberAt(season, 39)).toBe(42);
  });
});
