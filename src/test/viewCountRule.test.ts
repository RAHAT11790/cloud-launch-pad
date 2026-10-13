import { describe, it, expect } from "vitest";
import { canCountView, hasWatchedEnough, VIEW_COOLDOWN_MS } from "@/lib/viewCountRule";

describe("view count rule", () => {
  it("counts after 20 seconds on the player", () => {
    expect(hasWatchedEnough(19)).toBe(false);
    expect(hasWatchedEnough(20)).toBe(true);
  });
  it("only once per device per series every 24h", () => {
    const now = 1_000_000_000_000;
    expect(canCountView(now - 1000, now)).toBe(false);
    expect(canCountView(now - VIEW_COOLDOWN_MS + 1, now)).toBe(false);
    expect(canCountView(now - VIEW_COOLDOWN_MS, now)).toBe(true);
    expect(canCountView(null, now)).toBe(true);
  });
});
