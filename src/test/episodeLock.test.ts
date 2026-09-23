import { describe, expect, it } from "vitest";
import { isTimeLockedTarget, targetLockRemainingMs, hasActiveTimeLock } from "@/lib/contentGating";
import { buildEpisodeLockIndex } from "@/lib/firebaseAnimeMapper";

const DAY = 24 * 60 * 60 * 1000;

describe("timed Episode Lock", () => {
  it("locks the exact episode admin locked, leaves siblings free", () => {
    const anime: any = {
      id: "ws1",
      type: "webseries",
      episodeLocks: { s0e1: Date.now() + 2 * DAY },
    };
    expect(isTimeLockedTarget(anime, 0, 1)).toBe(true);
    expect(isTimeLockedTarget(anime, 0, 0)).toBe(false);
    expect(targetLockRemainingMs(anime, 0, 1)).toBeGreaterThan(DAY);
  });

  it("auto-unlocks once the window passes", () => {
    const anime: any = { id: "ws2", type: "webseries", episodeLocks: { s0e1: Date.now() - 1000 } };
    expect(isTimeLockedTarget(anime, 0, 1)).toBe(false);
    expect(hasActiveTimeLock(anime)).toBe(false);
  });

  it("builds the lock index from stored season episodes", () => {
    const until = Date.now() + 3 * DAY;
    const index = buildEpisodeLockIndex({
      seasons: [{ episodes: [{ episodeNumber: 1 }, { episodeNumber: 2, lockUntil: until }] }],
    });
    expect(index?.s0e1).toBe(until);
    expect(index?.s0e0).toBeUndefined();
  });

  it("locks movies via the movie key", () => {
    const movie: any = { id: "an_mv_x", type: "movie", episodeLocks: { movie: Date.now() + DAY } };
    expect(isTimeLockedTarget(movie, 0, 0)).toBe(true);
  });
});
