import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  db: {},
  ref: () => ({}),
  onValue: () => () => {},
}));

const BOT = "https://t.me/RS_ANIME_03_BOT";

import {
  buildTelegramDownloadUrl,
  buildTelegramEpisodeSegment,
  normalizeTelegramQuality,
  sortTelegramQualities,
  toTelegramTitleSlug,
} from "@/lib/telegramDownload";

describe("telegram download url", () => {
  it("normalizes quality labels", () => {
    expect(normalizeTelegramQuality("1080P")).toBe("1080p");
    expect(normalizeTelegramQuality("720")).toBe("720p");
    expect(normalizeTelegramQuality("4K")).toBe("2160p");
  });

  it("sorts qualities ascending", () => {
    expect(sortTelegramQualities(["1080P", "480p", "720P"])).toEqual(["480p", "720p", "1080p"]);
  });

  it("slugifies titles", () => {
    expect(toTelegramTitleSlug("Bottom Tier Character Tomozaki!")).toBe("Bottom-Tier-Character-Tomozaki");
  });

  it("builds episode segments", () => {
    expect(buildTelegramEpisodeSegment([5])).toBe("05");
    expect(buildTelegramEpisodeSegment([3, 1, 5, 2, 4])).toBe("1-5");
  });

  it("builds single episode url", () => {
    expect(buildTelegramDownloadUrl({
      botUrl: BOT,
      title: "Bottom Tier Character Tomozaki",
      season: 1,
      episodes: [5],
      qualities: ["720P"],
    })).toBe("https://t.me/RS_ANIME_03_BOT?start=ep_01_05_720p_Bottom-Tier-Character-Tomozaki");
  });

  it("builds multi episode multi quality url", () => {
    expect(buildTelegramDownloadUrl({
      botUrl: BOT,
      title: "Bottom Tier Character Tomozaki",
      season: 1,
      episodes: [1, 2, 3, 4, 5],
      qualities: ["1080P", "480P", "720P"],
    })).toBe("https://t.me/RS_ANIME_03_BOT?start=ep_01_1-5_480p-720p-1080p_Bottom-Tier-Character-Tomozaki");
  });

  it("returns empty when data is missing", () => {
    expect(buildTelegramDownloadUrl({ botUrl: "", title: "X", season: 1, episodes: [1], qualities: ["720P"] })).toBe("");
    expect(buildTelegramDownloadUrl({ botUrl: BOT, title: "", season: 1, episodes: [1], qualities: ["720P"] })).toBe("");
    expect(buildTelegramDownloadUrl({ botUrl: BOT, title: "X", season: 1, episodes: [], qualities: ["720P"] })).toBe("");
    expect(buildTelegramDownloadUrl({ botUrl: BOT, title: "X", season: 1, episodes: [1], qualities: [] })).toBe("");
  });

  it("pads season and strips query from bot url", () => {
    expect(buildTelegramDownloadUrl({
      botUrl: `${BOT}?start=old`,
      title: "My Show",
      season: 2,
      episodes: [12],
      qualities: ["480p"],
    })).toBe("https://t.me/RS_ANIME_03_BOT?start=ep_02_12_480p_My-Show");
  });
});
