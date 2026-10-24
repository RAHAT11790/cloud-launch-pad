import { describe, expect, it } from "vitest";
import { detectBrowser, chromeLaunchUrl } from "@/lib/browserEligibility";
const chrome = "Mozilla/5.0 Chrome/137.0.0.0 Safari/537.36";
describe("Chrome-only entry", () => {
  it("accepts Google Chrome and reports its exact version", () => {
    expect(detectBrowser(chrome)).toEqual({ name: "Google Chrome", version: "137.0.0.0", supported: true });
  });
  it.each(["Edg/137.0.0.0", "OPR/100.0.0.0", "SamsungBrowser/25.0", "Firefox/137.0", "Chromium/137.0"])("blocks other browsers: %s", suffix => {
    expect(detectBrowser(`${chrome} ${suffix}`).supported).toBe(false);
  });
  it("blocks Brave despite its Chrome user agent", () => { expect(detectBrowser(chrome, true).supported).toBe(false); });
  it("blocks embedded Android webviews", () => { expect(detectBrowser(`Mozilla/5.0 (Linux; Android 14; wv) ${chrome}`).supported).toBe(false); });
  it("opens the same Android URL in Chrome", () => { expect(chromeLaunchUrl("https://rsanime03.lovable.app/watch/naruto?ep=12", "Android")).toBe("intent://rsanime03.lovable.app/watch/naruto?ep=12#Intent;scheme=https;package=com.android.chrome;end"); });
});