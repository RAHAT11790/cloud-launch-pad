import { describe, it, expect } from "vitest";
import { summarizeEmailStats, clampEmailSettings, lastDayKeys } from "@/lib/emailStats";

describe("admin email statistics", () => {
  it("adds up days and computes delivery, verify rate and Gmail speed", () => {
    const s = summarizeEmailStats([
      { sent: 8, failed: 2, verified_otp: 4, verified_link: 2, sent_register: 6, sent_reset: 2, gmail_ms: 4000, gmail_n: 8 },
      { sent: 2, verified_otp: 1, gmail_ms: 1000, gmail_n: 2 },
    ]);
    expect(s.sent).toBe(10);
    expect(s.verified).toBe(7);
    expect(s.deliveryRate).toBe(83.3); // 10 of 12 attempts
    expect(s.verifyRate).toBe(70);
    expect(s.avgMs).toBe(500);
  });
  it("shows no rate when nothing was sent", () => {
    expect(summarizeEmailStats([{}]).deliveryRate).toBeNull();
  });
  it("keeps admin rules inside the worker's limits", () => {
    expect(clampEmailSettings({ otpMinutes: 99, cooldownSeconds: 1, maxAttempts: null as any })).toMatchObject({ otpMinutes: 30, cooldownSeconds: 20, maxAttempts: 5 });
    expect(clampEmailSettings(null).otpMinutes).toBe(10);
  });
  it("lists the last 7 Bangladesh days ending today", () => {
    const keys = lastDayKeys(7, Date.UTC(2026, 10, 8, 20, 0)); // 02:00 on 9 Nov in Dhaka
    expect(keys[6]).toBe("2026-11-09");
    expect(keys[0]).toBe("2026-11-03");
  });
});
