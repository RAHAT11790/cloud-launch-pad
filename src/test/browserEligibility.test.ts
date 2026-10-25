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
});import { browserGateApplies } from "@/lib/browserEligibility";
describe("Chrome-only by browser brand", () => {
  const android = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
  it("accepts real Chrome brands", () => { expect(detectBrowser(android, { brands: ["Google Chrome", "Chromium", "Not.A/Brand"] }).supported).toBe(true); });
  it("blocks a Chromium fork that copies Chrome's user agent (Booyah)", () => { expect(detectBrowser(android, { brands: ["Chromium", "Not.A/Brand"] }).supported).toBe(false); });
  it("blocks a Chrome-looking browser with no brand data", () => { expect(detectBrowser(android, { brands: null }).supported).toBe(false); });
  it("keeps Chrome on iPhone allowed", () => { expect(detectBrowser("Mozilla/5.0 (iPhone) CriOS/137.0 Mobile Safari/604.1", { brands: null }).supported).toBe(true); });
  it("never gates the admin panel", () => {
    expect(browserGateApplies("/admin")).toBe(false);
    expect(browserGateApplies("/admin/series")).toBe(false);
    expect(browserGateApplies("/watch/naruto")).toBe(true);
  });
});
