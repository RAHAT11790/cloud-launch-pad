import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/firebase", () => ({ db: {}, ref: vi.fn(), onValue: vi.fn(() => () => {}), runTransaction: vi.fn() }));
vi.mock("@/lib/edgeFunctionRouter", () => ({ getEdgeFunctionUrl: vi.fn(async () => "https://relay.example/") }));

const source = "https://files.example.com/dl/The_Remarried_Empress_S01E04.mkv";
const relayTarget = (href: string) => new URL(href).searchParams.get("url");

async function load(activeServerDomain: string) {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("rs_download_manager_config_v1", JSON.stringify({ activeServerDomain, activeServerKey: "", serverModes: {} }));
  const relay = await import("@/lib/filenameRelay");
  const health = await import("@/lib/routeHealth");
  return { relay, health };
}

describe("download server fallback", () => {
  beforeEach(() => localStorage.clear());
  it("tries the selected download server first, then the file's own server", async () => {
    const { relay } = await load("https://dead-tunnel.trycloudflare.com");
    const list = relay.filenameRelayCandidates("https://relay.example/", source, "ep4.mkv");
    expect(list.map((c) => relayTarget(c.href))).toEqual([
      "https://dead-tunnel.trycloudflare.com/dl/The_Remarried_Empress_S01E04.mkv",
      source,
    ]);
  });
  it("an offline download server is skipped: only the file's own server is used", async () => {
    const { relay, health } = await load("https://dead-tunnel.trycloudflare.com");
    health.markRouteDead("https://dead-tunnel.trycloudflare.com/");
    const list = relay.filenameRelayCandidates("https://relay.example/", source, "ep4.mkv");
    expect(list.map((c) => relayTarget(c.href))).toEqual([source]);
  });
  it("no download server selected: one link to the file's own server", async () => {
    const { relay } = await load("");
    expect(relay.filenameRelayCandidates("https://relay.example/", source, "ep4.mkv")).toHaveLength(1);
  });
  it("offline relay answer is explained, not shown as a generic error", async () => {
    const { relay } = await load("");
    expect(relay.relayFailureReason(530)).toBe("File server offline");
    expect(relay.relayFailureReason(404)).toBe("File not found on server");
    expect(relay.relayFailureReason(null)).toBe("Server not reachable");
  });
});
