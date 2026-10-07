import { describe, expect, it } from "vitest";
import { isMp4Magic, parseMoov } from "@/lib/mkv/mp4Probe";
import { isProbeCandidate, peekEmbeddedTracks } from "@/lib/mkv/trackProbe";

const box = (type: string, ...children: Uint8Array[]) => {
  const body = children.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(8 + body);
  new DataView(out.buffer).setUint32(0, 8 + body);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  let o = 8;
  for (const c of children) { out.set(c, o); o += c.length; }
  return out;
};
const raw = (...bytes: number[]) => new Uint8Array(bytes);
const lang = (code: string) => {
  const v = ((code.charCodeAt(0) - 0x60) << 10) | ((code.charCodeAt(1) - 0x60) << 5) | (code.charCodeAt(2) - 0x60);
  return [v >> 8, v & 255];
};
const trak = (id: number, handler: string, fmt: string, language: string) => box("trak",
  box("tkhd", raw(0, 0, 0, 0, ...new Array(8).fill(0), 0, 0, 0, id, ...new Array(68).fill(0))),
  box("mdia",
    box("mdhd", raw(0, 0, 0, 0, ...new Array(16).fill(0), ...lang(language), 0, 0)),
    box("hdlr", raw(0, 0, 0, 0, 0, 0, 0, 0, ...Array.from(handler).map((c) => c.charCodeAt(0)), ...new Array(12).fill(0), 0)),
    box("minf", box("stbl", box("stsd", raw(0, 0, 0, 0, 0, 0, 0, 1), box(fmt, raw(...new Array(28).fill(0))))))));

describe("track probe", () => {
  it("probes any direct video file, whatever its extension says", () => {
    expect(isProbeCandidate("http://fi5.bot-hosting.net:22134/1/Ep+01+1080p.mp4?hash=Ab")).toBe(true);
    expect(isProbeCandidate("http://fi5.bot-hosting.net:22134/1/1.mkv?hash=Ab")).toBe(true);
    expect(isProbeCandidate("https://cdn.example.com/stream/master.m3u8")).toBe(false);
    expect(isProbeCandidate("https://cdn.example.com/poster.jpg")).toBe(false);
    expect(isProbeCandidate("blob:https://x/1")).toBe(false);
  });

  it("recognises MP4 by its bytes and reads every track language", () => {
    const moov = box("moov", trak(1, "vide", "avc1", "und"), trak(2, "soun", "mp4a", "hin"), trak(3, "soun", "mp4a", "eng"), trak(4, "text", "text", "eng"));
    const file = new Uint8Array([...box("ftyp", raw(0x69, 0x73, 0x6f, 0x6d)), ...moov]);
    expect(isMp4Magic(file)).toBe(true);
    const tracks = parseMoov(moov);
    expect(tracks.filter((t) => t.kind === "audio").map((t) => [t.id, t.language, t.codec])).toEqual([[2, "hin", "AAC"], [3, "eng", "AAC"]]);
    // QuickTime chapter text is never offered as a subtitle.
    expect(tracks.some((t) => t.kind === "subtitle")).toBe(false);
  });

  it("orders dialogue subtitles before signs-only tracks", () => {
    localStorage.setItem("rs_mkv_tracks_v3", JSON.stringify({
      "/x.mkv|h": { at: Date.now(), list: {
        container: "mkv", nativeAudio: 1, videoMime: "", audio: [],
        subtitles: [
          { number: 5, kind: "subtitle", label: "Signs / Songs", rawName: "Signs / Songs", language: "eng", codec: "PGS", isDefault: false, playable: true, forced: true },
          { number: 6, kind: "subtitle", label: "Dialogue", rawName: "Dialogue", language: "eng", codec: "PGS", isDefault: false, playable: true },
        ],
      } },
    }));
    const list = peekEmbeddedTracks("http://h/x.mkv?hash=h");
    expect(list?.subtitles.map((s) => [s.number, s.label])).toEqual([[6, "English"], [5, "English (Signs)"]]);
  });
});
