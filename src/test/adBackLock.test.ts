import { describe, expect, it } from "vitest";
import { AD_BACK_LOCK_MS, adLockRemaining } from "@/lib/adBackLock";

describe("ad back-lock", () => {
  it("locks Back for 5 seconds after an ad call", () => {
    expect(AD_BACK_LOCK_MS).toBe(5000);
  });
  it("is still locked 4.9 seconds after the ad call", () => {
    expect(adLockRemaining(10_000, 14_900)).toBe(100);
  });
  it("unlocks exactly 5 seconds after the ad call", () => {
    expect(adLockRemaining(10_000, 15_000)).toBe(0);
    expect(adLockRemaining(10_000, 20_000)).toBe(0);
  });
  it("no ad call means no lock", () => {
    expect(adLockRemaining(0, 5_000)).toBe(0);
  });
});
