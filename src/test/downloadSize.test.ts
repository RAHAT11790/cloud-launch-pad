import { afterEach, describe, expect, it, vi } from "vitest";
import { sizeFromHeaders, sizeProbeRequests, probeDownloadSizes, canRetrySize, SIZE_RETRY_MS } from "@/lib/downloadSize";

vi.mock("@/lib/filenameRelay", () => ({
  getFilenameRelayBase: async () => "https://relay.example/",
  filenameRelayCandidates: (base: string, source: string) => [{ href: `${base}?url=${encodeURIComponent(source)}`, target: source, viaActiveServer: false }],
}));
vi.mock("@/lib/downloadManagerSettings", () => ({ applyActiveDownloadServer: (u: string) => u, stripWatchSegment: (u: string) => u }));
vi.mock("@/lib/videoDownload", () => ({ unwrapManagedVideoUrl: (u: string) => u }));

const h = (o: Record<string, string>) => new Headers(o);
afterEach(() => vi.unstubAllGlobals());

describe("download file size", () => {
  it("reads the total from Content-Range, not the 2-byte part", () => {
    expect(sizeFromHeaders(h({ "content-range": "bytes 0-1/525658827", "content-length": "2" }), 206)).toBe(525658827);
  });
  it("reads Content-Length from a full HEAD answer", () => {
    expect(sizeFromHeaders(h({ "content-length": "240479837", "content-type": "video/x-matroska" }), 200)).toBe(240479837);
  });
  it("never treats an error page or a partial body as the file size", () => {
    expect(sizeFromHeaders(h({ "content-length": "900000", "content-type": "text/html" }), 200)).toBe(0);
    expect(sizeFromHeaders(h({ "content-length": "900000" }), 206)).toBe(0);
  });
  it("asks the download relay first and never sends a zero-length range", async () => {
    const fetch = vi.fn(async (_u: string, init: RequestInit) => {
      expect((init.headers as Record<string, string> | undefined)?.Range).not.toBe("bytes=0-0");
      return new Response(null, { status: 200, headers: { "content-length": "525658827" } });
    });
    vi.stubGlobal("fetch", fetch);
    const reqs = sizeProbeRequests("https://relay.example/", "http://51.83.6.5:20090/67081/a.mkv");
    expect(reqs[0].href.startsWith("https://relay.example/")).toBe(true);
    const got: Array<[string, number]> = [];
    await probeDownloadSizes(["http://51.83.6.5:20090/67081/a.mkv"], (u, n) => got.push([u, n]));
    expect(got).toEqual([["http://51.83.6.5:20090/67081/a.mkv", 525658827]]);
  });
  it("a failed check is retried after a short wait, not shown as unknown forever", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const url = "https://dead.example/f.mkv";
    const got: number[] = [];
    await probeDownloadSizes([url], (_u, n) => got.push(n));
    expect(got).toEqual([-1]);
    expect(canRetrySize(url)).toBe(false);
    expect(canRetrySize(url, Date.now() + SIZE_RETRY_MS + 1)).toBe(true);
  });
});
