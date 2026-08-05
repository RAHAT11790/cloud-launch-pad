import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  db: {},
  ref: () => ({}),
  update: () => Promise.resolve(),
  runTransaction: () => Promise.resolve(),
}));

const load = async () => {
  vi.resetModules();
  return await import("@/lib/adPacing");
};

/** Simulate a watching session: a click every `clickEvery` seconds. */
async function simulate(minutes: number, clickEvery = 5, dwell = 12) {
  const mod = await load();
  mod.startAdSession();
  const stamps: number[] = [];
  const steps = (minutes * 60) / clickEvery;
  for (let i = 0; i < steps; i++) {
    vi.advanceTimersByTime(clickEvery * 1000);
    if (mod.adSlotReady()) {
      mod.noteAdShown();
      mod.noteAdDwell(dwell);
      stamps.push(Date.now());
    }
  }
  mod.stopAdSession();
  return { stamps, mod };
}

describe("ad pacing engine", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T10:00:00Z"));
  });

  it("never fires two ads closer than the hard floor", async () => {
    const { stamps, mod } = await simulate(180);
    for (let i = 1; i < stamps.length; i++) {
      expect((stamps[i] - stamps[i - 1]) / 1000).toBeGreaterThanOrEqual(mod.HARD_MIN_GAP_SEC);
    }
  });

  it("stays at or below the hourly cap in every rolling hour", async () => {
    const { stamps, mod } = await simulate(180);
    for (const s of stamps) {
      const inHour = stamps.filter((t) => t > s - 3_600_000 && t <= s).length;
      expect(inHour).toBeLessThanOrEqual(mod.HOURLY_CAP);
    }
  });

  it("keeps a 24 minute episode below one ad per minute", async () => {
    // Returning user profile: 90 min/day average, account older than 4 days.
    localStorage.setItem(
      "rs_ad_profile_v1",
      JSON.stringify({
        firstSeen: Date.now() - 30 * 86_400_000,
        days: { "2026-08-01": 5400, "2026-08-02": 5400 },
      }),
    );
    const { stamps } = await simulate(24, 5, 3);
    expect(stamps.length).toBeGreaterThanOrEqual(5);
    expect(stamps.length).toBeLessThanOrEqual(24);
  });

  it("gives brand-new users the lightest load", async () => {
    const { stamps } = await simulate(60, 5, 3);
    expect(stamps.length).toBeLessThanOrEqual(50);
  });

  it("keeps a 3 hour session under 50 ads/hour on average", async () => {
    const { stamps } = await simulate(180, 5, 3);
    expect(stamps.length / 3).toBeLessThanOrEqual(50);
    expect(stamps.length).toBeGreaterThan(5); // engine must not die mid-session
  });

  it("a page reload cannot reset the pacing brakes", async () => {
    const first = await simulate(40, 5, 3);
    const before = first.stamps.length;
    // "reload": fresh module instance, same localStorage
    const second = await simulate(10, 5, 3);
    const total = before + second.stamps.length;
    expect(total).toBeLessThanOrEqual(50); // still inside the rolling hour cap
  });
});
