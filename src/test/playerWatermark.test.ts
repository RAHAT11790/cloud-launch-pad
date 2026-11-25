import { describe, it, expect } from "vitest";
import { showPlayerWatermark } from "@/lib/playerWatermark";

describe("player watermark", () => {
  it("shows for free users", () => expect(showPlayerWatermark(false)).toBe(true));
  it("never shows for premium users", () => expect(showPlayerWatermark(true)).toBe(false));
  it("stays hidden while premium status loads", () => expect(showPlayerWatermark(null)).toBe(false));
});
