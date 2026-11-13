import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  firstAdGapMs, gapRangeFromMinutes, nextAdGapMs, recordAdReturn, videoLockRemaining, isAutoAdPath,
  EMPTY_PENALTY, MINUTE, type PenaltyState,
} from "@/lib/adTiming";

// Deterministic random numbers so every run checks the same thousands of draws.
const seeded = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

describe("random ad gaps", () => {
  it("every gap is between 2 and 10 minutes — one ad always comes within 10 minutes", () => {
    const rand = seeded(7);
    let prev = 0;
    for (let i = 0; i < 20000; i++) {
      const g = nextAdGapMs(undefined, prev, rand);
      expect(g).toBeGreaterThanOrEqual(2 * MINUTE);
      expect(g).toBeLessThanOrEqual(10 * MINUTE);
      prev = g;
    }
  });

  it("two gaps in a row are never almost the same (no fixed rhythm)", () => {
    const rand = seeded(11);
    let prev = nextAdGapMs(undefined, 0, rand);
    let close = 0;
    for (let i = 0; i < 5000; i++) {
      const g = nextAdGapMs(undefined, prev, rand);
      if (Math.abs(g - prev) < 45_000) close++;
      prev = g;
    }
    expect(close / 5000).toBeLessThan(0.01);
  });

  it("gaps spread over the whole range (short and long ones both happen)", () => {
    const rand = seeded(3);
    const buckets = new Set<number>();
    for (let i = 0; i < 3000; i++) buckets.add(Math.floor(nextAdGapMs(undefined, 0, rand) / MINUTE));
    [2, 3, 4, 5, 6, 7, 8, 9].forEach((m) => expect(buckets.has(m)).toBe(true));
  });

  it("a 24-minute episode gets about 2 to 4 ads on average", () => {
    const rand = seeded(5);
    let total = 0;
    const runs = 2000;
    for (let r = 0; r < runs; r++) {
      let t = firstAdGapMs(undefined, rand);
      let prev = 0;
      while (t <= 24 * MINUTE) { total++; prev = nextAdGapMs(undefined, prev, rand); t += prev; }
    }
    const avg = total / runs;
    expect(avg).toBeGreaterThanOrEqual(2);
    expect(avg).toBeLessThanOrEqual(4);
  });

  it("a 3-hour visit keeps getting ads until the end", () => {
    const rand = seeded(9);
    let t = firstAdGapMs(undefined, rand);
    let prev = 0; let count = 0; let last = 0;
    while (t <= 180 * MINUTE) { count++; last = t; prev = nextAdGapMs(undefined, prev, rand); t += prev; }
    expect(count).toBeGreaterThanOrEqual(18);
    expect(180 * MINUTE - last).toBeLessThanOrEqual(10 * MINUTE);
  });

  it("the first ad of a visit comes after 1 to 3 minutes", () => {
    const rand = seeded(13);
    for (let i = 0; i < 2000; i++) {
      const g = firstAdGapMs(undefined, rand);
      expect(g).toBeGreaterThanOrEqual(1 * MINUTE);
      expect(g).toBeLessThanOrEqual(3 * MINUTE);
    }
  });

  it("admin range can never go above 10 minutes", () => {
    expect(gapRangeFromMinutes(3, 25)).toEqual({ minMs: 3 * MINUTE, maxMs: 10 * MINUTE });
    expect(gapRangeFromMinutes(8, 4)).toEqual({ minMs: 4 * MINUTE, maxMs: 8 * MINUTE });
    expect(gapRangeFromMinutes(undefined, undefined)).toEqual({ minMs: 2 * MINUTE, maxMs: 10 * MINUTE });
  });
});

describe("ad closed too fast", () => {
  const now = 1_800_000_000_000;

  it("staying 5 seconds or more is fine", () => {
    const r = recordAdReturn(EMPTY_PENALTY, 5000, now);
    expect(r.outcome).toBe("ok");
    expect(r.state.strikes).toHaveLength(0);
  });

  it("coming back in under 5 seconds is a warning", () => {
    const r = recordAdReturn(EMPTY_PENALTY, 1500, now);
    expect(r.outcome).toBe("warning");
    expect(r.strikes).toBe(1);
  });

  it("the 6th fast close locks every video for exactly 5 minutes, then warnings start over", () => {
    let s: PenaltyState = EMPTY_PENALTY;
    const outcomes: string[] = [];
    for (let i = 0; i < 6; i++) { const r = recordAdReturn(s, 1000, now + i * 60_000); s = r.state; outcomes.push(r.outcome); }
    expect(outcomes).toEqual(["warning", "warning", "warning", "warning", "warning", "locked"]);
    const lockedAt = now + 5 * 60_000;
    expect(videoLockRemaining(s, lockedAt)).toBe(5 * MINUTE);
    expect(videoLockRemaining(s, lockedAt + 5 * MINUTE)).toBe(0);
    expect(s.strikes).toHaveLength(0);
  });

  it("5 fast closes are still only warnings", () => {
    let s: PenaltyState = EMPTY_PENALTY;
    for (let i = 0; i < 5; i++) s = recordAdReturn(s, 2000, now + i * 1000).state;
    expect(videoLockRemaining(s, now + 5000)).toBe(0);
    expect(s.strikes).toHaveLength(5);
  });
});

describe("where automatic ads run", () => {
  it("everywhere on the site except admin, download, payment and task pages", () => {
    ["/", "/series", "/movies", "/live-tv", "/profile", "/watch/abc", "/anime/x", "/search"].forEach((p) => expect(isAutoAdPath(p)).toBe(true));
    ["/admin", "/admin/ads", "/download", "/premium-buy", "/daily-tasks", "/adblocker-detected", "/unlock-required"].forEach((p) => expect(isAutoAdPath(p)).toBe(false));
  });
});

// ---- saved per ID: a lock survives closing and reopening the site ----
const remote = new Map<string, unknown>();
vi.mock("@/lib/firebase", () => ({
  db: {},
  ref: (_db: unknown, path: string) => ({ path }),
  get: (r: { path: string }) => Promise.resolve({ val: () => remote.get(r.path) ?? null }),
  set: (r: { path: string }, v: unknown) => { remote.set(r.path, v); return Promise.resolve(); },
  onValue: () => () => {},
  runTransaction: () => Promise.resolve(),
}));
vi.mock("@/lib/premiumAccess", () => ({ ensureGuestUser: () => JSON.parse(localStorage.getItem("rsanime_user") || "{}").id }));

describe("video lock is saved per guest / account ID", () => {
  beforeEach(() => { localStorage.clear(); remote.clear(); vi.resetModules(); });

  it("6 fast closes lock this ID, survive a reload, and do not touch another ID", async () => {
    localStorage.setItem("rsanime_user", JSON.stringify({ id: "guest_A", email: "guest@rsanime.com" }));
    let mod = await import("@/lib/adPenalty");
    mod.syncPenaltyUser();
    for (let i = 0; i < 6; i++) mod.applyAdReturn(800);
    expect(mod.videosLockedMs()).toBeGreaterThan(4.9 * MINUTE);

    vi.resetModules(); // the site is closed and opened again
    mod = await import("@/lib/adPenalty");
    mod.syncPenaltyUser();
    expect(mod.videosLockedMs()).toBeGreaterThan(4.9 * MINUTE);

    localStorage.setItem("rsanime_user", JSON.stringify({ id: "user_real_B", email: "b@gmail.com" }));
    mod.syncPenaltyUser();
    expect(mod.videosLockedMs()).toBe(0);
  });

  it("a real account's lock is stored on its own record and read back on a new device", async () => {
    localStorage.setItem("rsanime_user", JSON.stringify({ id: "user_real_C", email: "c@gmail.com" }));
    let mod = await import("@/lib/adPenalty");
    mod.syncPenaltyUser();
    for (let i = 0; i < 6; i++) mod.applyAdReturn(1000);
    expect((remote.get("users/user_real_C/adPenalty") as any)?.lockedUntil).toBeGreaterThan(Date.now());

    localStorage.removeItem("rs_ad_penalty_v1:user_real_C"); // new device: nothing local
    vi.resetModules();
    mod = await import("@/lib/adPenalty");
    mod.syncPenaltyUser();
    await new Promise((r) => setTimeout(r, 10));
    expect(mod.videosLockedMs()).toBeGreaterThan(4.9 * MINUTE);
  });
});
