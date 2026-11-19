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

  it("nobody can download the user lists (users.json / appUsers.json) without an admin session", () => {
    for (const node of ["users", "appUsers"]) {
      expect(rules[node][".read"]).not.toBe(true);
      expect(String(rules[node][".read"])).toContain("secure/adminSessions");
      expect(String(rules[node][".read"])).toContain("> now");
      expect(rules[node][".write"]).not.toBe(true);
    }
  });

  it("the site still reads and saves one account at a time, but can never store a password there", () => {
    for (const node of ["users", "appUsers"]) {
      expect(rules[node].$key[".read"]).toBe(true);
      expect(rules[node].$key[".write"]).toBe(true);
      expect(rules[node].$key.password[".validate"]).toBe("false");
      expect(rules[node][".indexOn"]).toEqual(["name", "email"]);
    }
  });
});
