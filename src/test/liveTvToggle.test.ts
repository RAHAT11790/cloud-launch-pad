import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/firebase", () => ({ db: {}, ref: vi.fn(), onValue: vi.fn(() => () => {}), set: vi.fn() }));
import { mainPagesFor } from "@/lib/liveTvToggle";

describe("Live TV switch", () => {
  it("Live TV off removes the Live TV page, keeps Home, Series, Movies", () => {
    expect(mainPagesFor(false)).toEqual(["home", "series", "movies"]);
  });
  it("Live TV on brings the page back between Series and Movies", () => {
    expect(mainPagesFor(true)).toEqual(["home", "series", "livetv", "movies"]);
  });
});
