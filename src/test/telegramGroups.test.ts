import { describe, it, expect } from "vitest";
import { groupTelegramSelections } from "@/lib/telegramQuality";
import { applyComboSpan, renumberEpisodes, formatEpisodeChip } from "@/lib/episodeCombo";

describe("groupTelegramSelections", () => {
  it("splits episodes by their real qualities", () => {
    const g = groupTelegramSelections([
      { episode: 1, qualities: ["1080P"] },
      { episode: 2, qualities: ["1080P"] },
      { episode: 11, qualities: ["480P", "1080P"] },
      { episode: 12, qualities: ["1080P", "480P"] },
    ]);
    expect(g).toEqual([
      { episodes: [1, 2], qualities: ["1080P"] },
      { episodes: [11, 12], qualities: ["480P", "1080P"] },
    ]);
  });
});

describe("combo episodes", () => {
  const eps = Array.from({ length: 5 }, (_, i) => ({ episodeNumber: i + 1, title: `Episode ${i + 1}` }));
  it("renumbers following episodes", () => {
    const out = applyComboSpan(eps, 0, 3);
    expect(out.map(formatEpisodeChip)).toEqual(["01-03", "04", "05", "06", "07"]);
    expect(out[1].title).toBe("Episode 4");
  });
  it("works on reversed arrays", () => {
    const rev = eps.slice().reverse();
    const out = applyComboSpan(rev, 3, 3); // episode 2
    expect(out.map(formatEpisodeChip)).toEqual(["07", "06", "05", "02-04", "01"]);
  });
  it("removing combo shifts back", () => {
    const out = applyComboSpan(applyComboSpan(eps, 0, 3), 0, 1);
    expect(out.map(formatEpisodeChip)).toEqual(["01", "02", "03", "04", "05"]);
    expect(renumberEpisodes(out)).toEqual(out);
  });
});
