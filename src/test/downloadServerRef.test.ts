import { describe, expect, it } from "vitest";
import { resolveActiveServer, videoServerRef } from "@/lib/downloadServerRef";

const list = (third: string) => [
  { name: "RS FR 01", domain: "https://a-one.trycloudflare.com" },
  { name: "RS FR 02", domain: "https://b-two.trycloudflare.com" },
  { name: "RS FR 03", domain: third },
];

describe("selected download server follows the video server's current address", () => {
  it("server #3 gets a new URL: downloads use the new URL", () => {
    const settings = { activeServerRef: videoServerRef(2, "RS FR 03"), activeServerDomain: "https://old-tunnel.trycloudflare.com", activeServerMode: "https" };
    const now = resolveActiveServer(settings, list("https://nikon-fever-tent-fascinating.trycloudflare.com"));
    expect(now?.domain).toBe("https://nikon-fever-tent-fascinating.trycloudflare.com");
    expect(now?.live).toBe(true);
  });
  it("the HTTP/HTTPS choice stays when the address changes", () => {
    const settings = { activeServerRef: videoServerRef(2, "RS FR 03"), activeServerDomain: "https://old.trycloudflare.com", activeServerMode: "https", serverModes: {} };
    expect(resolveActiveServer(settings, list("https://new.trycloudflare.com"))?.mode).toBe("https");
    const byName = { activeServerRef: videoServerRef(2, "RS FR 03"), serverModes: { name_rs_fr_03: "http" as const } };
    expect(resolveActiveServer(byName, list("https://new.trycloudflare.com"))?.mode).toBe("http");
  });
  it("servers re-ordered: the server is found by its name, not its old position", () => {
    const settings = { activeServerRef: videoServerRef(2, "RS FR 03") };
    const moved = [{ name: "RS FR 03", domain: "https://moved.trycloudflare.com" }, { name: "RS FR 01", domain: "https://a.trycloudflare.com" }];
    expect(resolveActiveServer(settings, moved)?.domain).toBe("https://moved.trycloudflare.com");
  });
  it("renamed server: falls back to the same position", () => {
    const settings = { activeServerRef: videoServerRef(2, "RS FR 03") };
    const renamed = [...list("https://x.trycloudflare.com").slice(0, 2), { name: "RS Fast 3", domain: "https://renamed.trycloudflare.com" }];
    expect(resolveActiveServer(settings, renamed)?.domain).toBe("https://renamed.trycloudflare.com");
  });
  it("no server selected: null (files download from their own server)", () => {
    expect(resolveActiveServer({}, list("https://c.trycloudflare.com"))).toBeNull();
  });
  it("custom server reference reads the custom server's address", () => {
    const settings = { activeServerRef: "custom:dl_example_com" };
    expect(resolveActiveServer(settings, [], { dl_example_com: { name: "DL", domain: "https://dl.example.com" } })?.domain).toBe("https://dl.example.com");
  });
});
