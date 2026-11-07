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

import { isAllowedEmail, parseLoginAccess, normalizeDomain, emailCanonicalKey } from "@/lib/emailService";

describe("admin-allowed sign-up domains", () => {
  it("defaults to gmail.com only and guest on when nothing is saved", () => {
    expect(parseLoginAccess(null)).toEqual({ guestEnabled: true, allowedDomains: ["gmail.com"] });
  });
  it("guest switch off is read as off", () => {
    expect(parseLoginAccess({ guestEnabled: false }).guestEnabled).toBe(false);
  });
  it("only allows domains on the admin list", () => {
    expect(isAllowedEmail("someone@outlook.com", ["gmail.com"])).toBe(false);
    expect(isAllowedEmail("someone@outlook.com", ["gmail.com", "outlook.com"])).toBe(true);
    expect(isAllowedEmail("abc123@tempmail.com", ["gmail.com", "outlook.com"])).toBe(false);
  });
  it("keeps the strict gmail check when gmail.com is allowed", () => {
    expect(isAllowedEmail("abc@gmail.com", ["gmail.com"])).toBe(false);
    expect(isAllowedEmail("abcdef+x@gmail.com", ["gmail.com"])).toBe(false);
    expect(isAllowedEmail("rahat.sarker224@gmail.com", ["gmail.com"])).toBe(true);
  });
  it("cleans admin-typed domains", () => {
    expect(normalizeDomain(" @Outlook.COM ")).toBe("outlook.com");
    expect(normalizeDomain("not a domain")).toBe("");
    expect(parseLoginAccess({ allowedDomains: ["@Yahoo.com", "bad domain"] }).allowedDomains).toEqual(["yahoo.com"]);
  });
  it("non-gmail accounts keep dots in their unique key", () => {
    expect(emailCanonicalKey("a.b.c@gmail.com")).toBe("abc");
    expect(emailCanonicalKey("a.b@outlook.com")).not.toBe(emailCanonicalKey("ab@outlook.com"));
  });
});
