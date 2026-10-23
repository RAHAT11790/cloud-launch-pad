import { describe, expect, it } from "vitest";
import { downloadWaitRemaining, normalizeDownloadFlowSettings, selectDownloadEpisode, freeDownloadQuality, downloadNeedsAdFlow, sponsorWaitComplete } from "@/lib/downloadFlow";
describe("Download controller rules", () => {
  it("only free users take advertising steps, never premium or unresolved accounts", () => {
    expect(downloadNeedsAdFlow(false)).toBe(true);
    expect(downloadNeedsAdFlow(true)).toBe(false);
    expect(downloadNeedsAdFlow(null)).toBe(false);
  });
  it("admits all three free resolutions and excludes 4K", () => {
    expect(["480P", "720P", "1080P"].map(freeDownloadQuality)).toEqual(["480p", "720p", "1080p"]);
    expect(freeDownloadQuality("4K")).toBe("");
    expect(freeDownloadQuality("2160p")).toBe("");
  });
  it("does not invent a resolution for an unspecified original file", () => {
    expect(freeDownloadQuality("Default")).toBe("Original file");
  });
  it("early sponsor return cannot clear a five second step", () => {
    expect(sponsorWaitComplete(5, 4999)).toBe(false);
    expect(sponsorWaitComplete(5, 5000)).toBe(true);
  });
  it("initially allows two episodes", () => {
    const { maxEpisodes } = normalizeDownloadFlowSettings();
    expect(maxEpisodes).toBe(2);
    expect(selectDownloadEpisode([1, 2], 3, maxEpisodes)).toEqual([1, 2]);
  });
  it("enforces the administrator's configured limit", () => {
    expect(normalizeDownloadFlowSettings({ maxEpisodes: 3 }).maxEpisodes).toBe(3);
    expect(selectDownloadEpisode([1, 2, 3], 4, 3)).toEqual([1, 2, 3]);
  });
  it("uses each admin-supplied step wait", () => {
    expect(normalizeDownloadFlowSettings({ adSteps: [5, 10, 5] }).adSteps).toEqual([5, 10, 5]);
    expect(downloadWaitRemaining(10, 5000)).toBe(5);
    expect(downloadWaitRemaining(10, 10000)).toBe(0);
  });
  it("retains exactly the admin step count", () => {
    expect(normalizeDownloadFlowSettings({ adSteps: [5] }).adSteps).toHaveLength(1);
    expect(normalizeDownloadFlowSettings({ adSteps: [5, 5] }).adSteps).toHaveLength(2);
    expect(normalizeDownloadFlowSettings({ adSteps: [] }).adSteps).toHaveLength(0);
  });
});