import { describe, expect, it } from "vitest";
import {
  normalizeSpinSettings, pickPrizeIndex, prizeAtAngle, prizePercents, spinTargetAngle, spinWindow, type SpinPrize,
} from "@/lib/luckySpin";

const DAY = 86_400_000;
const prizes: SpinPrize[] = [
  { id: "a", label: "7 Days", days: 7, chance: 1 },
  { id: "b", label: "1 Day", days: 1, chance: 90 },
  { id: "c", label: "Try again", days: 0, chance: 10 },
];

describe("Lucky Spin", () => {
  it("is off until the admin turns it on", () => {
    expect(normalizeSpinSettings(null).enabled).toBe(false);
    expect(normalizeSpinSettings({ enabled: true, prizes }).enabled).toBe(true);
  });

  it("chances work like the admin's numbers: 1, 90 and 10 out of 101", () => {
    const pct = prizePercents(prizes);
    expect(pct[0]).toBeCloseTo(100 / 101, 5);
    expect(pct[1]).toBeCloseTo(9000 / 101, 5);
    expect(pct[2]).toBeCloseTo(1000 / 101, 5);
  });

  it("the weighted pick follows the chances", () => {
    expect(pickPrizeIndex(prizes, 0)).toBe(0); // first 1/101
    expect(pickPrizeIndex(prizes, 0.5)).toBe(1); // inside the 90
    expect(pickPrizeIndex(prizes, 0.995)).toBe(2); // last 10/101
    expect(pickPrizeIndex([{ ...prizes[0], chance: 0 }, prizes[1]], 0)).toBe(1); // 0 % never wins
  });

  it("3 spins every 7 days: the first spin starts the period, then it locks until 7 days later", () => {
    const s = { spinsPerPeriod: 3, periodDays: 7 };
    const t0 = Date.UTC(2026, 10, 18);
    expect(spinWindow(null, s, t0).left).toBe(3);
    expect(spinWindow({ start: t0, used: 2 }, s, t0 + DAY).left).toBe(1);
    const locked = spinWindow({ start: t0, used: 3 }, s, t0 + DAY);
    expect(locked.left).toBe(0);
    expect(locked.unlockAt).toBe(t0 + 7 * DAY);
    expect(spinWindow({ start: t0, used: 3 }, s, t0 + 7 * DAY).left).toBe(3);
  });

  it("10 days and 5 spins can be set too", () => {
    const n = normalizeSpinSettings({ enabled: true, spinsPerPeriod: 5, periodDays: 10, coinCost: 50, prizes });
    expect([n.spinsPerPeriod, n.periodDays, n.coinCost]).toEqual([5, 10, 50]);
  });

  it("the wheel stops with the won prize under the pointer", () => {
    for (const count of [3, 8, 12]) {
      for (let i = 0; i < count; i++) {
        const a = spinTargetAngle(137, i, count, 6, 0.3);
        expect(a).toBeGreaterThan(137 + 6 * 360 - 1);
        expect(prizeAtAngle(a, count)).toBe(i);
      }
    }
  });
});
