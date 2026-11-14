import { describe, expect, it } from "vitest";
import { decoderThreads, MT_MAX_THREADS } from "@/lib/mkv/wasm/rsvideo-mt-config";

describe("decoderThreads", () => {
  it("uses one thread per core on an 8-core phone", () => expect(decoderThreads(8)).toBe(8));
  it("never exceeds the decoder's thread pool", () => expect(decoderThreads(16)).toBe(MT_MAX_THREADS));
  it("falls back to one thread when the core count is unknown", () => expect(decoderThreads(0)).toBe(1));
});
