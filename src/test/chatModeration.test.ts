import { describe, it, expect } from "vitest";
import { parseBanDuration, parseChatCommand, findBadWord, containsLink, DEFAULT_BAD_WORDS, slowModeWaitMs, banActive } from "@/lib/chatModeration";

describe("chat moderation", () => {
  it("parses ban times", () => {
    expect(parseBanDuration("30s")).toBe(30_000);
    expect(parseBanDuration("30m")).toBe(1_800_000);
    expect(parseBanDuration("3h")).toBe(10_800_000);
    expect(parseBanDuration("permanent")).toBe("permanent");
    expect(parseBanDuration("abc")).toBeNull();
  });
  it("parses commands with reply target or @ID", () => {
    expect(parseChatCommand("/ban 30m spam", "u1")).toEqual({ cmd: "ban", target: "u1", duration: 1_800_000, reason: "spam" });
    expect(parseChatCommand("/ban @u2 permanent")).toMatchObject({ cmd: "ban", target: "u2", duration: "permanent" });
    expect(parseChatCommand("/warning stop spamming", "u1")).toEqual({ cmd: "warning", target: "u1", text: "stop spamming" });
    expect(parseChatCommand("/ban 30m")?.cmd).toBe("invalid");
    expect(parseChatCommand("hello")).toBeNull();
  });
  it("filters Bangla and English abuse without false positives", () => {
    expect(findBadWord("you are a b1tch", DEFAULT_BAD_WORDS)).toBe("bitch");
    expect(findBadWord("তুই একটা খানকি", DEFAULT_BAD_WORDS)).toBe("খানকি");
    expect(findBadWord("nice class, football game", DEFAULT_BAD_WORDS)).toBe("");
  });
  it("detects links", () => {
    expect(containsLink("join t.me/abc")).toBe(true);
    expect(containsLink("visit example.com now")).toBe(true);
    expect(containsLink("episode 12 was great.")).toBe(false);
  });
  it("slow mode and ban timing", () => {
    expect(slowModeWaitMs(1000, 30, 11_000)).toBe(20_000);
    expect(slowModeWaitMs(1000, 0, 2000)).toBe(0);
    expect(banActive({ until: 0, reason: "", by: "", t: 0 })).toBe(true);
    expect(banActive({ until: 5, reason: "", by: "", t: 0 }, 10)).toBe(false);
  });
});
