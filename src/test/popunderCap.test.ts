import { describe, it, expect, beforeEach, vi } from "vitest";

const CONFIG = {
  enabled: true,
  popunder: '<script src="https://example.invalid/tag.js"></script>',
  directLink: "https://direct.example/sponsor",
  refreshIntervalSec: 30,
};

vi.mock("@/lib/firebase", () => ({
  db: {},
  ref: () => ({}),
  get: () => Promise.resolve({ val: () => CONFIG }),
  onValue: () => () => {},
}));

const load = async () => {
  vi.resetModules();
  return await import("@/lib/adsterraAds");
};

describe("pop-under keeps showing ads after the tag hits its own cap", () => {
  beforeEach(() => {
    localStorage.clear();
    const w = window as any;
    Object.keys(w).filter((k) => k.startsWith("__adsterra")).forEach((k) => delete w[k]);
  });

  it("a silent tag click is followed by the Direct Link on the next eligible tap", async () => {
    const mod = await load();
    const opened: string[] = [];
    (window as any).__adsterraOpenOriginal = (u: string) => { opened.push(String(u)); return null; };
    (window as any).__adsterraPopunderMounted = true;
    (window as any).__adsterraCycleCount = 0;

    // Cycle 1: handed to the tag, but the tag opens nothing (capped).
    const asked = Date.now();
    expect(await mod.releaseAd()).toBe("tag");
    expect(mod.tagOpenedSince(asked - 1000)).toBe(false);
    mod.markTagCapped();

    // Next tap: the Direct Link opens instead of another silent tag click.
    expect(await mod.releaseAd()).toBe("direct");
    expect(opened).toEqual(["https://direct.example/sponsor"]);
  });

  it("the tag is tried again once the 20-minute retry window has passed", async () => {
    const mod = await load();
    (window as any).__adsterraOpenOriginal = () => null;
    (window as any).__adsterraPopunderMounted = true;
    (window as any).__adsterraCycleCount = 0;
    mod.markTagCapped(Date.now() - mod.TAG_RETRY_MS - 1);
    expect(mod.TAG_RETRY_MS).toBe(20 * 60_000);
    expect(await mod.releaseAd()).toBe("tag");
  });
});
