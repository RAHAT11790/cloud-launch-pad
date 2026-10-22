import { describe, expect, it } from "vitest";
import { downloadWaitRemaining, normalizeDownloadFlowSettings, selectDownloadEpisode } from "@/lib/downloadFlow";
describe("Download controller rules", () => {
  it("initially allows two episodes", () => {
    const { maxEpisodes } = normalizeDownloadFlowSettings();
    expect(maxEpisodes).toBe(2);
    expect(selectDownloadEpisode([1, 2], 3, maxEpisodes)).toEqual([1, 2]);
  });
  it("never allows more than three episodes", () => {
    expect(normalizeDownloadFlowSettings({ maxEpisodes: 99 }).maxEpisodes).toBe(3);
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