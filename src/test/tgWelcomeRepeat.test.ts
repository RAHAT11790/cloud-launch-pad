import { describe, it, expect } from "vitest";
import { tgWelcomeDue } from "@/components/TelegramWelcomeModal";

const DAY = 86_400_000;
describe("Telegram welcome repeat timer", () => {
  it("opens for a user who never closed it", () => {
    expect(tgWelcomeDue(null, 0, 1000)).toBe(true);
  });
  it("shows only once when no repeat is set", () => {
    expect(tgWelcomeDue(1000, 0, 1000 + 30 * DAY)).toBe(false);
  });
  it("shows again after 3 days, not before", () => {
    const seen = 10 * DAY;
    expect(tgWelcomeDue(seen, 3 * 86400, seen + 2 * DAY)).toBe(false);
    expect(tgWelcomeDue(seen, 3 * 86400, seen + 3 * DAY)).toBe(true);
  });
  it("30 seconds repeat", () => {
    expect(tgWelcomeDue(0 + 5000, 30, 5000 + 29_000)).toBe(false);
    expect(tgWelcomeDue(5000, 30, 5000 + 30_000)).toBe(true);
  });
});
