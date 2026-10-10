import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ db: {}, get: vi.fn(), onValue: vi.fn(), ref: vi.fn(), remove: vi.fn(), set: vi.fn(), runTransaction: vi.fn(), update: vi.fn() }));

import { pruneMediaCache, readPoster, savePoster } from "@/lib/profileMediaStore";
import { readCachedCustomization } from "@/lib/profileCustomization";

describe("profile instant paint caches", () => {
  beforeEach(() => localStorage.clear());

  it("returning to the profile paints the saved frame and backdrop on the first render", () => {
    localStorage.setItem("rs_profile_custom_cache_v1_u1", JSON.stringify({ frameId: "frame-hx5m", backgroundId: "background-lk2v" }));
    const c = readCachedCustomization("u1");
    expect(c.frameId).toBe("frame-hx5m");
    expect(c.backgroundId).toBe("background-lk2v");
  });

  it("a video's remembered first frame is kept while the video is in the shop", async () => {
    savePoster("rtdb:keep", "data:image/jpeg;base64,AAA");
    savePoster("rtdb:gone", "data:image/jpeg;base64,BBB");
    await pruneMediaCache(["rtdb:keep"]);
    expect(readPoster("rtdb:keep")).toBe("data:image/jpeg;base64,AAA");
    expect(readPoster("rtdb:gone")).toBe("");
  });
});
