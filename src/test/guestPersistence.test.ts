import { beforeEach, describe, expect, it } from "vitest";
import { isGuestRecord, isLegacyGuestCleanupCandidate, localGuestPath, guestCleanupBatches, writeGuestPath, readGuestPath } from "@/lib/guestPersistence";
describe("Guest-only persistence", () => {
  beforeEach(() => localStorage.clear());
  it("keeps guest personal and device coin data on device", () => {
    expect(localGuestPath("users/guest_abc/watchHistory/naruto", "guest_abc")).toBe(true);
    expect(localGuestPath("coinDeviceDaily/dev_a/2026-10-23", "guest_abc")).toBe(true);
    expect(localGuestPath("users/real_uid/coinWallet", "guest_abc")).toBe(false);
    expect(localGuestPath("guestRegistry/guest_abc", null)).toBe(false);
    expect(localGuestPath("users/guest_abc/watchHistory/naruto", null)).toBe(true);
    writeGuestPath("users/guest_abc/coinWallet", { coins: 5 });
    expect(readGuestPath("users/guest_abc/coinWallet")).toEqual({ coins: 5 });
  });
  it("protects real email accounts even if named Guest or missing other fields", () => {
    expect(isGuestRecord("real_uid", { email: "real@example.com", guest: true })).toBe(false);
    expect(isGuestRecord("real_uid", {})).toBe(false);
    expect(isGuestRecord("guest_abc", { email: "guest@rsanime.com" })).toBe(true);
  });
  it("cleans 101 guests in sequential batches of at most 50", () => {
    expect(guestCleanupBatches(Array.from({ length: 101 }, (_, i) => i)).map(batch => batch.length)).toEqual([50, 50, 1]);
  });
  it("never deletes ambiguous missing-email accounts or real email accounts", () => {
    expect(isLegacyGuestCleanupCandidate("user_123", {})).toBe(false);
    expect(isLegacyGuestCleanupCandidate("real_uid", { guest: true })).toBe(false);
    expect(isLegacyGuestCleanupCandidate("guest_123", { email: "real@example.com", guest: true })).toBe(false);
    expect(isLegacyGuestCleanupCandidate("guest_123", { guest: true })).toBe(true);
  });
});