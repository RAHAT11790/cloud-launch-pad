import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OWNER_EMAILS } from "@/lib/securityGuard";

const rules = JSON.parse(readFileSync("security/firebase-rules.json", "utf8")).rules;

describe("Firebase database rules", () => {
  it("does not let anyone download the whole database from the root", () => {
    expect(rules[".read"]).not.toBe(true);
    expect(rules[".write"]).not.toBe(true);
    expect(String(rules[".read"])).toContain("auth != null");
  });

  it("opens the root only to the owner accounts", () => {
    for (const email of OWNER_EMAILS) expect(String(rules[".read"])).toContain(`'${email}'`);
  });

  it("keeps private areas closed to every visitor", () => {
    expect(rules.secure[".read"]).toBe(false);
    expect(rules.secure[".write"]).toBe(false);
    expect(rules.otpCodes[".read"]).toBe(false);
    expect(rules.emailAuth[".read"]).toBeUndefined();
    expect(rules.emailAuth.tickets).toBeUndefined();
  });
});
