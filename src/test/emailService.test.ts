import { describe, it, expect } from "vitest";
import { isAllowedGmail, gmailCanonicalKey } from "@/lib/emailService";

describe("gmail-only sign-up", () => {
  it("accepts normal gmail addresses", () => {
    expect(isAllowedGmail("rahat.sarker224@gmail.com")).toBe(true);
    expect(isAllowedGmail("  User123456@Gmail.com ")).toBe(true);
  });
  it("rejects other domains and temp mail", () => {
    expect(isAllowedGmail("someone@yahoo.com")).toBe(false);
    expect(isAllowedGmail("abc123@tempmail.com")).toBe(false);
    expect(isAllowedGmail("abcdef@googlemail.com")).toBe(false);
    expect(isAllowedGmail("abcdef@gmail.com.fake.io")).toBe(false);
  });
  it("rejects plus aliases, double dots and too-short names", () => {
    expect(isAllowedGmail("abcdef+spam@gmail.com")).toBe(false);
    expect(isAllowedGmail("abc..def@gmail.com")).toBe(false);
    expect(isAllowedGmail("abc@gmail.com")).toBe(false);
  });
  it("treats dotted variants as the same inbox", () => {
    expect(gmailCanonicalKey("r.a.h.a.t99@gmail.com")).toBe(gmailCanonicalKey("rahat99@gmail.com"));
  });
});
