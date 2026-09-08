import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("@/lib/firebase", () => ({
  db: {},
  ref: () => ({}),
  onValue: () => () => {},
}));

const BOT = "https://t.me/RS_ANIME_03_BOT";

import {
  buildTelegramDownloadUrl,
  buildTelegramEpisodeSegment,
  buildTelegramStartPayload,
  normalizeTelegramQuality,
  sha1Hex,
  sortTelegramQualities,
  telegramTitleHash,
} from "@/lib/telegramDownload";

const nodeHash = (title: string) =>
  createHash("sha1").update(title.trim().toLowerCase(), "utf8").digest("hex").slice(0, 8);

describe("telegram deep link", () => {
  it("matches node SHA1 exactly", () => {
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    ["Bottom-Tier Character Tomozaki", "  Naruto Shippuden ", "進撃の巨人", "One Piece"].forEach((t) => {
      expect(telegramTitleHash(t)).toBe(nodeHash(t));
    });
  });

  it("normalizes qualities", () => {
    expect(normalizeTelegramQuality("1080P")).toBe("1080p");
    expect(normalizeTelegramQuality("720")).toBe("720p");
    expect(normalizeTelegramQuality("4K")).toBe("4k");
    expect(sortTelegramQualities(["1080P", "480p", "720P"])).toEqual(["480p", "720p", "1080p"]);
    expect(sortTelegramQualities(["720p", "all"])).toEqual(["all"]);
  });

  it("builds compact episode specs", () => {
    expect(buildTelegramEpisodeSegment([5])).toBe("05");
    expect(buildTelegramEpisodeSegment([3, 1, 5, 2, 4])).toBe("1-5");
    expect(buildTelegramEpisodeSegment([2, 4, 5, 6, 9])).toBe("2,4-6,9");
  });

  it("builds a single episode url", () => {
    const h = nodeHash("Bottom-Tier Character Tomozaki");
    expect(buildTelegramDownloadUrl({
      botUrl: BOT,
      title: "Bottom-Tier Character Tomozaki",
      season: 1,
      episodes: [5],
      qualities: ["720P"],
    })).toBe(`${BOT}?start=ep_01_05_720p_${h}`);
  });

  it("builds a multi episode multi quality url", () => {
    const h = nodeHash("Bottom-Tier Character Tomozaki");
    expect(buildTelegramDownloadUrl({
      botUrl: BOT,
      title: "Bottom-Tier Character Tomozaki",
      season: 1,
      episodes: [1, 2, 3, 4, 5],
      qualities: ["1080P", "480P", "720P"],
    })).toBe(`${BOT}?start=ep_01_1-5_480p-720p-1080p_${h}`);
  });

  it("keeps every payload within Telegram limits", () => {
    const many = Array.from({ length: 40 }, (_, i) => i * 2 + 1); // sparse -> long comma list
    const payload = buildTelegramStartPayload({
      title: "A Very Long Anime Title That Would Never Fit In Sixty Four Characters",
      season: 3,
      episodes: many,
      qualities: ["480p", "720p", "1080p"],
    });
    expect(payload.length).toBeLessThanOrEqual(64);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload).toContain("1-79");
  });

  it("returns empty when data is missing", () => {
    expect(buildTelegramDownloadUrl({ botUrl: "", title: "X", season: 1, episodes: [1], qualities: ["720P"] })).toBe("");
    expect(buildTelegramDownloadUrl({ botUrl: BOT, title: "", season: 1, episodes: [1], qualities: ["720P"] })).toBe("");
    expect(buildTelegramDownloadUrl({ botUrl: BOT, title: "X", season: 1, episodes: [], qualities: ["720P"] })).toBe("");
    expect(buildTelegramDownloadUrl({ botUrl: BOT, title: "X", season: 1, episodes: [1], qualities: [] })).toBe("");
  });

  it("pads season and strips an existing query from the bot url", () => {
    const h = nodeHash("My Show");
    expect(buildTelegramDownloadUrl({
      botUrl: `${BOT}?start=old`,
      title: "My Show",
      season: 2,
      episodes: [12],
      qualities: ["480p"],
    })).toBe(`${BOT}?start=ep_02_12_480p_${h}`);
  });
});
