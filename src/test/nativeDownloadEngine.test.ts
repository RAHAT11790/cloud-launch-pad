import { describe, expect, it, vi, beforeEach } from "vitest";

const saved: any[] = [];
vi.mock("@/lib/downloadStore", () => ({
  saveVideo: async (record: any) => { saved.push(record); },
}));
vi.mock("@/lib/nativeRuntime", () => ({ isNativeApp: () => false }));

import { nativeDownloads, isHlsSource } from "@/lib/nativeDownloadEngine";

const streamOf = (bytes: number) => new Response(new Uint8Array(bytes), {
  headers: { "content-length": String(bytes) },
});

const waitFor = async (check: () => boolean, ms = 4000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("native download engine", () => {
  beforeEach(() => {
    saved.length = 0;
    nativeDownloads.clearFinished();
  });

  it("detects HLS sources", () => {
    expect(isHlsSource("http://x/y/master.m3u8")).toBe(true);
    expect(isHlsSource("http://x/y/ep1.mp4")).toBe(false);
  });

  it("downloads direct sources one by one, in queue order", async () => {
    const order: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      order.push(String(url));
      return streamOf(1024);
    }));

    nativeDownloads.enqueueBatch([
      { id: "a1", url: "http://cdn.test/one.mp4", title: "Anime X", episodeLabel: "Episode 1", episodeNumber: 1, quality: "720p" },
      { id: "a2", url: "http://cdn.test/two.mp4", title: "Anime X", episodeLabel: "Episode 2", episodeNumber: 2, quality: "720p" },
    ]);

    await waitFor(() => saved.length === 2);
    expect(order).toEqual(["http://cdn.test/one.mp4", "http://cdn.test/two.mp4"]);
    // Direct source, no proxy in the URL that was fetched.
    expect(order.every((url) => !url.includes("video-download"))).toBe(true);
    expect(saved[0].fileName).toBe("Anime X - Episode 1 - 720p.mp4");
    expect(nativeDownloads.getState().completed).toBe(2);
  });

  it("merges HLS segments and keeps every audio track", async () => {
    const master = [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Hindi",LANGUAGE="hi",URI="audio_hi.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",LANGUAGE="ja",URI="audio_ja.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="aud"',
      "v720.m3u8",
    ].join("\n");
    const media = ["#EXTM3U", "#EXTINF:4,", "seg1.ts", "#EXTINF:4,", "seg2.ts"].join("\n");

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const value = String(url);
      if (value.endsWith("master.m3u8")) return new Response(master);
      if (value.endsWith(".m3u8")) return new Response(media);
      return new Response(new Uint8Array(512));
    }));

    nativeDownloads.enqueue({
      id: "an1",
      url: "https://an.test/hls/master.m3u8",
      title: "AN Anime",
      episodeLabel: "Episode 5",
      quality: "Auto",
    });

    await waitFor(() => saved.length === 1);
    const record = saved[0];
    expect(record.kind).toBe("an");
    expect(record.fileName).toBe("AN Anime - Episode 5.ts");
    expect(record.audioTracks.map((track: any) => track.label)).toEqual(["Hindi", "Japanese"]);
    expect(record.blob.size).toBe(1024);
  });
});
