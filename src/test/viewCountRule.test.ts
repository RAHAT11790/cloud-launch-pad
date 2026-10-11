import { describe, it, expect } from "vitest";
import { canCountView, hasWatchedEnough, VIEW_COOLDOWN_MS } from "@/lib/viewCountRule";

describe("view count rule", () => {
  it("long video needs 5 minutes", () => {
    expect(hasWatchedEnough(299, 1440)).toBe(false);
    expect(hasWatchedEnough(300, 1440)).toBe(true);
  });
  it("short video needs 40%", () => {
    expect(hasWatchedEnough(239, 600)).toBe(false);
    expect(hasWatchedEnough(240, 600)).toBe(true);
  });
  it("only once per 24h", () => {
    const now = 1_000_000_000_000;
    expect(canCountView(now - 1000, now)).toBe(false);
    expect(canCountView(now - VIEW_COOLDOWN_MS, now)).toBe(true);
    expect(canCountView(null, now)).toBe(true);
  });
});
