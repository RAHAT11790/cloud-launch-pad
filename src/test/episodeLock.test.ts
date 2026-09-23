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

  it("indexes a non-sequential episode by both list position and episode number", () => {
    const until = Date.now() + DAY;
    const index = buildEpisodeLockIndex({
      seasons: [{ episodes: [{ episodeNumber: 2, lockUntil: until }] }],
    });
    expect(index?.s0e0).toBe(until);
    expect(index?.s0e1).toBe(until);
  });

  it("locks movies via the movie key", () => {
    const movie: any = { id: "an_mv_x", type: "movie", episodeLocks: { movie: Date.now() + DAY } };
    expect(isTimeLockedTarget(movie, 0, 0)).toBe(true);
  });
});

describe("full series lock", () => {
  it("blocks every episode when the series root lock is active", async () => {
    const { isSeriesTimeLocked, isTimeLockedTarget, isPermanentLockValue, PERMANENT_LOCK_UNTIL } = await import("@/lib/contentGating");
    const series: any = {
      type: "webseries",
      lockUntil: Date.now() + 86_400_000,
      seasons: [{ name: "Season 1", episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }] }],
    };
    expect(isSeriesTimeLocked(series)).toBe(true);
    expect(isTimeLockedTarget(series, 0, 0)).toBe(true);
    expect(isTimeLockedTarget(series, 0, 1)).toBe(true);
    expect(isSeriesTimeLocked({ ...series, lockUntil: Date.now() - 1000 })).toBe(false);
    expect(isPermanentLockValue(PERMANENT_LOCK_UNTIL)).toBe(true);
  });

  it("treats a series lock carried on the card index as locked", async () => {
    const { isTimeLockedTarget } = await import("@/lib/contentGating");
    const card: any = { type: "webseries", episodeLocks: { series: Date.now() + 60_000 } };
    expect(isTimeLockedTarget(card, 3, 7)).toBe(true);
  });
});
