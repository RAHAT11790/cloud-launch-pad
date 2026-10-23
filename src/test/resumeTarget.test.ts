import { describe, expect, it } from "vitest";
import { resolveResumeTarget } from "@/lib/resumeTarget";
import type { Season } from "@/data/animeData";
describe("Resume uses current episode metadata", () => {
  it("finds episode 12 at its new position after range edits", () => {
    const seasons = [{ name: "Season 1", episodes: [{ episodeNumber: 11 }, { episodeNumber: 12 }] }] as Season[];
    expect(resolveResumeTarget(seasons, { seasonIdx: 0, epIdx: 11, episodeNumber: 12 })).toEqual({ seasonIdx: 0, epIdx: 1 });
  });
  it("finds episode 12 after it moves to another season", () => {
    const seasons = [{ name: "Season 1", episodes: [{ episodeNumber: 1 }] }, { name: "Season 2", episodes: [{ episodeNumber: 12 }] }] as Season[];
    expect(resolveResumeTarget(seasons, { seasonIdx: 0, epIdx: 11, episodeNumber: 12 })).toEqual({ seasonIdx: 1, epIdx: 0 });
  });
  it("does not play another episode if saved episode 12 was deleted", () => {
    const seasons = [{ name: "Season 1", episodes: [{ episodeNumber: 1 }] }] as Season[];
    expect(resolveResumeTarget(seasons, { episodeNumber: 12 })).toBeNull();
  });
});