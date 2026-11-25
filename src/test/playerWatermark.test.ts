import { describe, it, expect } from "vitest";
import { showPlayerWatermark, normalizeWatermark } from "@/lib/playerWatermark";

describe("player watermark", () => {
  it("shows for free users", () => expect(showPlayerWatermark(false)).toBe(true));
  it("never shows for premium users", () => expect(showPlayerWatermark(true)).toBe(false));
  it("stays hidden while premium status loads", () => expect(showPlayerWatermark(null)).toBe(false));
  it("admin switch off hides it for free users too", () => expect(showPlayerWatermark(false, false)).toBe(false));
  it("missing settings keep it on with the site logo", () => {
    const s = normalizeWatermark(null);
    expect(s.enabled).toBe(true);
    expect(s.logoUrl).toBe("");
    expect(s.text).toBe("RS ANIME03");
  });
  it("size, visibility and brightness stay in safe ranges", () => {
    const s = normalizeWatermark({ size: 500, opacity: 0, brightness: 9 });
    expect(s.size).toBe(80);
    expect(s.opacity).toBe(0.05);
    expect(s.brightness).toBe(2);
  });
});
