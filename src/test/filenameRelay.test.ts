import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../cloudflare-workers/file-rename.js";
import { sourceDownloadFilename } from "@/lib/downloadFlow";
const source = "http://fi5.bot-hosting.net:22134/file.mkv";
const request = (url = source, headers: Record<string, string> = {}) => new Request(`https://relay.example/?url=${encodeURIComponent(url)}&filename=Naruto%20-%20Season%2001%20-%20Episode%2001.mkv`, { headers });
afterEach(() => vi.unstubAllGlobals());
describe("Filename relay", () => {
  it("keeps actual MKV extension for a movie or episode", () => {
    expect(sourceDownloadFilename("Naruto - Episode 1.mp4", source)).toBe("Naruto - Episode 1.mkv");
  });
  it("blocks private and unapproved hosts before fetching", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await worker.fetch(request("http://127.0.0.1/file"))).status).toBe(400);
    expect((await worker.fetch(request("https://attacker.example/file"))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("passes resume range and custom filename while streaming", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { "content-length": "3", "content-range": "bytes 0-2/100", "accept-ranges": "bytes" } }));
    vi.stubGlobal("fetch", fetch);
    const res = await worker.fetch(request(source, { Range: "bytes=0-2" }));
    expect(res.status).toBe(206);
    expect(fetch.mock.calls[0][1].headers.Range).toBe("bytes=0-2");
    expect(res.headers.get("content-range")).toBe("bytes 0-2/100");
    expect(res.headers.get("content-disposition")).toContain('filename="Naruto - Season 01 - Episode 01.mkv"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("validates redirect hosts", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://10.0.0.1/private" } }));
    vi.stubGlobal("fetch", fetch);
    expect((await worker.fetch(request())).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});