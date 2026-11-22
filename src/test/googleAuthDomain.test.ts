import { describe, expect, it } from "vitest";
import { googleReturnsHere, googleSignInMode, prefersFullPageSignIn, FIREBASE_AUTH_HOST } from "@/lib/googleAuthDomain";
import type { SiteDomainState } from "@/lib/siteDomain";

const state = (google: boolean): SiteDomainState => ({
  live: "https://rsanime03.online", checkedAt: Date.now(),
  hosts: {
    "rsanime03,online": { host: "rsanime03.online", serving: true, google },
    "rsanime03,lovable,app": { host: "rsanime03.lovable.app", serving: true },
  },
});
const PHONE = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36";
const PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

describe("where Google sign-in finishes", () => {
  it("uses the site's own address only after the server confirmed it", () => {
    expect(googleReturnsHere("rsanime03.online", state(true))).toBe(true);
    expect(googleReturnsHere("rsanime03.online", state(false))).toBe(false);
    expect(googleReturnsHere("rsanime03.lovable.app", state(true))).toBe(false);
    expect(googleReturnsHere("localhost", state(true))).toBe(false);
    expect(googleReturnsHere("rsanime03.online", null)).toBe(false);
  });

  it("phones and the installed app sign in on the full page; computers keep the small window", () => {
    expect(prefersFullPageSignIn(PHONE, false)).toBe(true);
    expect(prefersFullPageSignIn(PC, true)).toBe(true);
    expect(prefersFullPageSignIn(PC, false)).toBe(false);
    const base = { host: "rsanime03.online", authDomain: "rsanime03.online", state: state(true), standalone: false };
    expect(googleSignInMode({ ...base, ua: PHONE })).toBe("redirect");
    expect(googleSignInMode({ ...base, ua: PC })).toBe("popup");
  });

  it("keeps the old Google window until the address is ready, and reloads once when it just became ready", () => {
    expect(googleSignInMode({ host: "rsanime03.online", authDomain: FIREBASE_AUTH_HOST, state: state(false), ua: PHONE, standalone: false })).toBe("popup");
    expect(googleSignInMode({ host: "rsanime03.online", authDomain: FIREBASE_AUTH_HOST, state: state(true), ua: PHONE, standalone: false })).toBe("reload");
  });
});
