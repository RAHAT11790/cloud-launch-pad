import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ db: {}, onValue: vi.fn(), ref: vi.fn(), remove: vi.fn(), runTransaction: vi.fn(), update: vi.fn() }));

import { DEFAULT_FRAME_EFFECTS, normalizeItem } from "@/lib/profileShop";

describe("profile shop items", () => {
  it("frames saved before animations existed come alive with the default effects", () => {
    expect(normalizeItem("old", { name: "Old", imageUrl: "https://i.ibb.co/x.png" }).effects).toEqual(DEFAULT_FRAME_EFFECTS);
  });

  it("a frame saved with no effects stays still", () => {
    expect(normalizeItem("still", { effects: "none" }).effects).toEqual([]);
  });

  it("keeps only known effects from the stored list", () => {
    expect(normalizeItem("f", { effects: "aura,bogus,embers" }).effects).toEqual(["aura", "embers"]);
  });

  it("a backdrop with a video URL plays as a looping video", () => {
    const item = normalizeItem("b", { mediaType: "video", videoUrl: "https://cdn.example.com/a.mp4", imageUrl: "https://i.ibb.co/p.jpg" });
    expect(item.mediaType).toBe("video");
    expect(item.videoUrl).toBe("https://cdn.example.com/a.mp4");
    expect(item.imageUrl).toBe("https://i.ibb.co/p.jpg");
  });

  it("a video link pasted into the image field is treated as a video backdrop", () => {
    const item = normalizeItem("b", { imageUrl: "https://cdn.example.com/loop.webm?x=1" });
    expect(item.mediaType).toBe("video");
    expect(item.videoUrl).toBe("https://cdn.example.com/loop.webm?x=1");
    expect(item.imageUrl).toBe("");
  });

  it("effect speed is clamped between 0.5x and 2x", () => {
    expect(normalizeItem("f", { fxSpeed: 9 }).fxSpeed).toBe(2);
    expect(normalizeItem("f", { fxSpeed: 0.1 }).fxSpeed).toBe(0.5);
  });
});
