import { describe, expect, it } from "vitest";
import { downloadStepsFor, downloadSelectionLimit, normalizeDownloadFlowSettings } from "@/lib/downloadFlow";
const rules = normalizeDownloadFlowSettings({ maxEpisodes: 5, adSteps: [5, 5], adStepsByCount: { "2": [5, 5], "3": [5, 5], "5": [5, 5, 5], all: { 0: 5, 1: 5, 2: 5, 3: 5 } } });
describe("Ad steps per episode count", () => {
  it("2 episodes = 2 steps, 5 episodes = 3 steps", () => {
    expect(downloadStepsFor(rules, 2)).toHaveLength(2);
    expect(downloadStepsFor(rules, 5)).toHaveLength(3);
  });
  it("counts without their own box use the default steps", () => { expect(downloadStepsFor(rules, 4)).toEqual([5, 5]); });
  it("selections above the limit use the All episodes box", () => { expect(downloadStepsFor(rules, 12)).toHaveLength(4); });
  it("All episodes box lets free users select every episode; without it the limit holds", () => {
    expect(downloadSelectionLimit(rules, 24)).toBe(24);
    expect(downloadSelectionLimit(normalizeDownloadFlowSettings({ maxEpisodes: 2 }), 24)).toBe(2);
  });
});
