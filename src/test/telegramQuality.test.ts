import { describe, expect, it } from "vitest";
import { collectTelegramEpisodeQualities } from "@/lib/telegramQuality";

describe("Telegram release quality tracking", () => {
  it("reads only the selected new episode", () => {
    const oldEpisode = { link480: "old-480", link720: "old-720", link4k: "old-4k" };
    const newEpisode = { link1080: "new-1080" };
    expect(collectTelegramEpisodeQualities([newEpisode])).toEqual(["1080p"]);
    expect(collectTelegramEpisodeQualities([oldEpisode, newEpisode])).toEqual(["480p", "720p", "1080p", "4K"]);
  });

  it("orders selected episode qualities from low to high", () => {
    expect(collectTelegramEpisodeQualities([{ link4k: "4k", link480: "480", link1080: "1080", link720: "720" }]))
      .toEqual(["480p", "720p", "1080p", "4K"]);
  });

  it("ignores empty quality fields", () => {
    expect(collectTelegramEpisodeQualities([{ link480: " ", link720: "720" }])).toEqual(["720p"]);
  });
});