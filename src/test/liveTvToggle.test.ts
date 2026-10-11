import { describe, it, expect } from "vitest";
import { parseLiveTvEnabled } from "@/lib/liveTvToggle";

describe("Live TV admin switch", () => {
  it("stays on when the admin never set it", () => {
    expect(parseLiveTvEnabled(null)).toBe(true);
    expect(parseLiveTvEnabled(undefined)).toBe(true);
  });
  it("turns off when the admin switches it off", () => {
    expect(parseLiveTvEnabled(false)).toBe(false);
    expect(parseLiveTvEnabled("false")).toBe(false);
  });
  it("comes back when the admin switches it on", () => {
    expect(parseLiveTvEnabled(true)).toBe(true);
  });
});
