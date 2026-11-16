import { describe, expect, it } from "vitest";
import { classifyReadFailure, readRetryDelay, NET_RETRY_WINDOW_MS } from "@/lib/netRecovery";

describe("network recovery for playback reads", () => {
  it("a dropped connection keeps retrying for up to 2 minutes instead of stopping the audio track", () => {
    const kind = classifyReadFailure(new TypeError("Failed to fetch"));
    expect(kind).toBe("network");
    expect(readRetryDelay(kind, 3, 25_000)).toBeGreaterThan(0); // old code gave up after 3 tries
    expect(readRetryDelay(kind, 40, 119_000)).toBeGreaterThan(0);
    expect(NET_RETRY_WINDOW_MS).toBe(120_000);
    expect(readRetryDelay(kind, 41, 120_000)).toBe(-1);
  });

  it("busy servers (5xx / 429) are retried like a dropped connection", () => {
    expect(classifyReadFailure(new Error("HTTP 502"))).toBe("server");
    expect(classifyReadFailure(null, 429)).toBe("server");
    expect(readRetryDelay("server", 10, 30_000)).toBeGreaterThan(0);
  });

  it("a missing file (404) gives up after 2 attempts", () => {
    expect(classifyReadFailure(new Error("HTTP 404"))).toBe("client");
    expect(readRetryDelay("client", 1, 0)).toBeGreaterThan(0);
    expect(readRetryDelay("client", 2, 1000)).toBe(-1);
  });

  it("waits grow but never exceed 4 seconds", () => {
    expect(readRetryDelay("network", 1, 0)).toBe(400);
    expect(readRetryDelay("network", 2, 0)).toBe(800);
    expect(readRetryDelay("network", 10, 0)).toBe(4000);
  });
});
