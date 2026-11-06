import { describe, expect, it } from "vitest";
import { matchesEpisode } from "@/lib/episodeSearch";
describe("All episode search", () => {
  it("finds the exact stored episode number, not the list position", () => {
    expect(matchesEpisode({ number: 41, title: "Arrival" }, "41")).toBe(true);
    expect(matchesEpisode({ number: 141 }, "41")).toBe(false);
  });
  it("finds episode titles case insensitively", () => {
    expect(matchesEpisode({ number: 41, title: "Arrival" }, "arrival")).toBe(true);
    expect(matchesEpisode({ number: 41, title: "Arrival" }, "departure")).toBe(false);
  });
  it("finds a number inside a combo entry", () => {
    expect(matchesEpisode({ number: 41, label: "41–44", combo: true }, "43")).toBe(true);
    expect(matchesEpisode({ number: 41, label: "41–44", combo: true }, "45")).toBe(false);
  });
});