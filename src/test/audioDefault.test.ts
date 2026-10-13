import { describe, it, expect } from "vitest";
import { pickDefaultAudio } from "@/lib/mkv/audioDefault";

const t = (number: number, language: string, label: string, playable = true) =>
  ({ number, kind: "audio" as const, language, label, codec: "aac", isDefault: false, playable });

describe("default audio is Hindi", () => {
  const tracks = { nativeAudio: 1, audio: [t(1, "tam", "Tamil"), t(2, "hin", "Hindi"), t(3, "eng", "English")] };
  it("switches a Tamil-first file to Hindi", () => {
    expect(pickDefaultAudio(tracks)).toBe(2);
  });
  it("Hindi beats the last language picked on another file", () => {
    expect(pickDefaultAudio(tracks, undefined, "tam")).toBe(2);
  });
  it("a choice made on this file wins", () => {
    expect(pickDefaultAudio(tracks, "eng")).toBe(3);
    expect(pickDefaultAudio(tracks, "native")).toBeNull();
  });
  it("stays native when Hindi is already the file's own audio", () => {
    expect(pickDefaultAudio({ nativeAudio: 2, audio: tracks.audio })).toBeNull();
  });
});
