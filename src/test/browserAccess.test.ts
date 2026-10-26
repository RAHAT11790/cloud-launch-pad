import { describe, expect, it } from "vitest";
import { browserGateBlocks, parseGateConfig, isValidIp } from "@/lib/browserAccess";
const cfg = parseGateConfig({ allowIps: { a: { ip: "103.25.120.14", addedAt: 1 } } });
describe("browser access", () => {
  it("blocks non-Chrome on unknown IP", () => { expect(browserGateBlocks(false, cfg, "1.2.3.4")).toBe(true); });
  it("lets any browser in from an allowed IP", () => { expect(browserGateBlocks(false, cfg, "103.25.120.14")).toBe(false); });
  it("switch off lets every browser in", () => { expect(browserGateBlocks(false, parseGateConfig({ enabled: false }), null)).toBe(false); });
  it("missing switch means on", () => { expect(parseGateConfig(null).enabled).toBe(true); });
  it("Chrome always passes", () => { expect(browserGateBlocks(true, cfg, null)).toBe(false); });
  it("validates IPs", () => { expect(isValidIp("103.25.120.14")).toBe(true); expect(isValidIp("999.1.1.1")).toBe(false); expect(isValidIp("2001:db8::1")).toBe(true); });
});
