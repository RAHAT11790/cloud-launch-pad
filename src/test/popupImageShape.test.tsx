import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";

const rows: Record<string, any> = {
  announcements: { p1: { kind: "popup", title: "Big update", description: "New", image: "https://i.ibb.co/x/tall.jpg", imageRatio: "9:16", createdAt: Date.now(), expiresAt: Date.now() + 3600_000 } },
  newEpisodeReleases: {},
};
vi.mock("@/lib/firebase", () => ({
  db: {},
  ref: (_db: unknown, path: string) => path,
  onValue: (path: string, cb: (s: { val: () => unknown }) => void) => { cb({ val: () => rows[path] }); return () => {}; },
}));

describe("visitor popup uses the admin's image shape", () => {
  it("renders a 9:16 box for a 9:16 popup", async () => {
    vi.useFakeTimers();
    localStorage.clear();
    const { default: NotificationBell } = await import("@/components/NotificationBell");
    render(<NotificationBell />);
    await act(async () => { vi.advanceTimersByTime(2000); });
    const img = document.querySelector('[role="dialog"] img') as HTMLImageElement | null;
    expect(img?.getAttribute("src")).toBe("https://i.ibb.co/x/tall.jpg");
    expect(img?.className).toContain("aspect-[9/16]");
    vi.useRealTimers();
  });
});
