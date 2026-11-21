import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  db: {}, ref: () => ({}), update: () => Promise.resolve(), runTransaction: () => Promise.resolve(),
}));

describe("first player ad slot", () => {
  beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("tells how long until the first slot so the tag can be mounted before it", async () => {
    vi.resetModules();
    const p = await import("@/lib/adPacing");
    const wait = p.msUntilAdSlot();
    // Warm-up of the first ad is at most 20 s and is not open yet.
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(20_000);
    expect(p.adSlotReady()).toBe(false);
  });

  it("is 0 once the slot is open", async () => {
    vi.resetModules();
    localStorage.setItem("rs_ad_slots_v2", JSON.stringify({ ts: [], nextAt: 1 }));
    const p = await import("@/lib/adPacing");
    expect(p.msUntilAdSlot()).toBe(0);
  });
});
