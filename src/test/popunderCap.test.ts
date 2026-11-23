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

  it("Adsterra and Mondiad take turns; a silent Mondiad hands back to Adsterra", async () => {
    localStorage.setItem("rs_mondiad_cfg_v1", JSON.stringify({ enabled: true, popunder: '<script src="https://ss.mrmnd.com/popunder.js" data-mndpopid="7e036bc5-6a5a-4c60-92ba-f7d11d9ed144"></script>' }));
    localStorage.setItem("rs_ad_net_last_v1", "adsterra");
    const mod = await load();
    const w = window as any;
    w.__adsterraOpenOriginal = () => null;
    w.__adsterraPopunderMounted = true;
    w.__mondiadPopMounted = true;
    w.__adsterraCycleCount = 0;

    expect(await mod.releaseAd()).toBe("tag");
    expect(w.__adTurn).toBe("mondiad");
    mod.markTagCapped(); // Mondiad opened nothing

    expect(await mod.releaseAd()).toBe("tag");
    expect(w.__adTurn).toBe("adsterra");
    delete w.__mondiadPopMounted;
  });
});
