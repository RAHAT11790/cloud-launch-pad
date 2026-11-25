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

  it("always prioritizes the healthy popunder, including the third and sixth eligible turns", async () => {
    const mod = await load();
    const openDirect = vi.fn();
    window.__adsterraOpenOriginal = openDirect;
    window.__adsterraPopunderMounted = true;
    window.__adsterraScriptOk = true;
    const releases = [];
    for (let i = 0; i < 6; i++) releases.push(await mod.releaseAd());
    expect(releases).toEqual(["tag", "tag", "tag", "tag", "tag", "tag"]);
    expect(openDirect).not.toHaveBeenCalled();
  });

  it("uses the alternative only when the popunder script is blocked", async () => {
    const mod = await load();
    const openDirect = vi.fn();
    window.__adsterraOpenOriginal = openDirect;
    window.__adsterraPopunderMounted = true;
    window.__adsterraScriptOk = false;
    expect(await mod.releaseAd()).toBe("direct");
    expect(openDirect).toHaveBeenCalledWith("https://direct.example/sponsor", "_blank", "noopener,noreferrer");
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
