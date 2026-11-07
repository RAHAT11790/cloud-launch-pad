import { describe, it, expect } from "vitest";
import { coinStoreOpen } from "@/lib/premiumAccess";
import { shouldReloadForPremium } from "@/lib/premiumReload";

describe("coin → Premium store switch", () => {
  it("is open when the admin never set it", () => {
    expect(coinStoreOpen(undefined)).toBe(true);
    expect(coinStoreOpen(null)).toBe(true);
  });
  it("is closed only when switched off", () => {
    expect(coinStoreOpen(false)).toBe(false);
    expect(coinStoreOpen(true)).toBe(true);
  });
});

describe("refresh after Premium activates", () => {
  it("reloads when Premium turns on during the visit", () => {
    expect(shouldReloadForPremium(false, true)).toBe(true);
  });
  it("does not reload for users who already had Premium or before the first read", () => {
    expect(shouldReloadForPremium(true, true)).toBe(false);
    expect(shouldReloadForPremium(null, true)).toBe(false);
    expect(shouldReloadForPremium(false, false)).toBe(false);
  });
});
