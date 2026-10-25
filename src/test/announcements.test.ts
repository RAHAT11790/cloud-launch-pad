import { describe, it, expect } from "vitest";
import { activeAnnouncements, expiredAnnouncementIds, releaseNotices, nextPopup } from "@/lib/announcements";
import { countPresence, presenceKeyFor } from "@/lib/presence";

const NOW = 1_800_000_000_000;

describe("announcements", () => {
  const raw = {
    a: { kind: "popup", title: "New player", createdAt: NOW - 1000, expiresAt: NOW + 1000 },
    b: { kind: "normal", title: "Old", createdAt: NOW - 5000, expiresAt: NOW - 1 },
  };
  it("expired messages are hidden and listed for deletion", () => {
    expect(activeAnnouncements(raw, NOW).map(a => a.id)).toEqual(["a"]);
    expect(expiredAnnouncementIds(raw, NOW)).toEqual(["b"]);
  });
  it("a popup already seen on this device is not shown again", () => {
    const list = activeAnnouncements(raw, NOW);
    expect(nextPopup(list, new Set())?.id).toBe("a");
    expect(nextPopup(list, new Set(["a"]))).toBeNull();
  });
  it("deleted or inactive releases leave the bell; one notice per series", () => {
    const rel = {
      r1: { contentId: "naruto", title: "Naruto", timestamp: NOW - 2000, episodeInfo: { seasonName: "Season 1", episodeNumber: 3 } },
      r2: { contentId: "naruto", title: "Naruto", timestamp: NOW - 1000, episodeInfo: { seasonName: "Season 1", episodeNumber: 4, episodeNumberEnd: 5 } },
      r3: { contentId: "x", timestamp: NOW - 1000, active: false },
      r4: { contentId: "y", timestamp: NOW - 37 * 3600_000 },
    };
    const items = releaseNotices(rel, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].body).toBe("Season 1 · Episodes 4–5");
  });
});

describe("presence", () => {
  it("counts real and guest separately within the live window only", () => {
    expect(countPresence({ a: { k: "r", t: NOW - 10_000 }, b: { k: "g", t: NOW - 20_000 }, c: { k: "g", t: NOW - 200_000 } }, NOW)).toEqual({ real: 1, guest: 1 });
  });
  it("guests never use their account id as a presence key", () => {
    expect(presenceKeyFor({ id: "guest_123", email: "" }, "dev1")).toEqual({ key: "g_dev1", kind: "g" });
    expect(presenceKeyFor({ id: "u1", email: "a@b.com" }, "dev1")).toEqual({ key: "r_u1", kind: "r" });
  });
});
