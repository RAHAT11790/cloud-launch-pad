import { describe, it, expect } from "vitest";
import { resumeDownloadTimer, downloadWaitRemaining } from "@/lib/downloadFlow";

describe("download step timer survives leaving the page", () => {
  it("keeps the running countdown when the same step of the same download is reopened", () => {
    const saved = { flow: "f1", step: 1, startedAt: 1000 };
    const resumed = resumeDownloadTimer(saved, "f1", 1, 4000);
    expect(resumed.startedAt).toBe(1000);
    // 10 second step, 3 seconds already passed while away -> 7 left, not 10.
    expect(downloadWaitRemaining(10, 4000 - resumed.startedAt)).toBe(7);
  });
  it("starts fresh for a different step", () => {
    expect(resumeDownloadTimer({ flow: "f1", step: 0, startedAt: 1000 }, "f1", 1, 5000).startedAt).toBe(5000);
  });
  it("starts fresh for a new download selection", () => {
    expect(resumeDownloadTimer({ flow: "old", step: 0, startedAt: 1000 }, "new", 0, 5000).startedAt).toBe(5000);
  });
});
