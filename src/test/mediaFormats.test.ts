import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import createRsAudio from "@/lib/mkv/wasm/rsaudio.mjs";
import createRsVideo from "@/lib/mkv/wasm/rsvideo.mjs";
import { PcmFeeder } from "@/lib/mkv/pcmFeeder";
import { VideoFeeder } from "@/lib/mkv/videoFeeder";
import { decoderIdFor } from "@/lib/mkv/flacPcm";
import { MkvBlockStream, clusterNear, loadMkvCues, parseMkvHeader, type RangeSource } from "@/lib/mkv/mkvDemux";
import { AudioFragmenter } from "@/lib/mkv/mkvRemux";
import { hevcBitDepth, hevcCodecString, videoFamily } from "@/lib/mkv/videoCodec";

const root = resolve(__dirname, "../..");
const fileSource = (name: string): RangeSource & { bytesRead: number } => {
  const buf = new Uint8Array(readFileSync(resolve(root, "src/test/fixtures", name)));
  const src = { bytesRead: 0, read: async (s: number, l: number) => { const out = buf.subarray(s, Math.min(buf.length, s + l)); src.bytesRead += out.length; return out; } };
  return src;
};
const allBlocks = async (src: RangeSource, start: number, track: number) => {
  const s = new MkvBlockStream(src, start, new Set([track]));
  const out = [];
  for (let b = await s.next(); b; b = await s.next()) out.push(b);
  return out;
};

describe("every audio format in an .mkv has a working path", () => {
  it("AAC / MP3 go to the browser as MP4, Opus / Vorbis as WebM", async () => {
    const src = fileSource("audio-formats.mka");
    const h = await parseMkvHeader(src);
    const by = (codec: string) => h.audio.find((a) => a.codec === codec)!;
    expect(by("AAC").route).toBe("mp4");
    expect(by("MP3").route).toBe("mp4");
    expect(by("Opus").route).toBe("webm");
    expect(by("Vorbis").route).toBe("webm");
    for (const codec of ["AAC", "MP3", "Opus", "Vorbis"]) {
      const t = by(codec);
      const frag = new AudioFragmenter(h, t, 1000);
      const blocks = await allBlocks(src, h.firstClusterPos, t.number);
      expect(blocks.length).toBeGreaterThan(10);
      blocks.forEach((b) => frag.push(b));
      const out = frag.flush(true);
      expect(out && out.length).toBeGreaterThan(1000);
    }
  });

  it("FLAC, AC3, E-AC3, DTS, TrueHD, PCM and MP2 decode to real sound (about 1 second each)", async () => {
    const m = await createRsAudio({ wasmBinary: readFileSync(resolve(root, "src/lib/mkv/wasm/rsaudio.wasm")) });
    const src = fileSource("audio-formats.mka");
    const h = await parseMkvHeader(src);
    const decoded = h.audio.filter((a) => !a.route);
    expect(decoded.map((a) => a.codec).sort()).toEqual(["AC3", "DTS", "E-AC3", "FLAC", "MPEG/L2", "PCM/INT/LIT", "TrueHD"].sort());
    for (const t of decoded) {
      const id = decoderIdFor(t.codec, t.bitDepth);
      expect(id, t.codec).toBeGreaterThan(0);
      const feeder = new PcmFeeder(m);
      expect(feeder.open({ id, extra: t.codecPrivate, rate: t.sampleRate, channels: t.channels, bits: t.bitDepth }), t.codec).toBe(true);
      const blocks = await allBlocks(src, h.firstClusterPos, t.number);
      const frames = blocks.flatMap((b) => b.frames.map((data, i) => ({ data: data.slice(), pts: i === 0 ? Math.round((b.ptsTicks * h.timecodeScale * 48000) / 1e9) : -1 })));
      const out = feeder.push(frames, true);
      const bytes = out.reduce((n, f) => n + f.length, 0);
      // ~1 s of 48 kHz stereo as lossless FLAC frames (a sine compresses, so stay generous)
      expect(bytes, t.codec).toBeGreaterThan(20_000);
      feeder.close();
    }
  });
});

describe("H.265 / HEVC picture (black-screen fix)", () => {
  it("codec string + bit depth come from the file's own HEVC settings", async () => {
    const h = await parseMkvHeader(fileSource("hevc10-small.mkv"));
    expect(h.video?.codec).toBe("HEVC");
    expect(hevcCodecString(h.video!.codecPrivate)).toMatch(/^hvc1\.2\.4\.L\d+\.[0-9A-F]+/);
    expect(hevcBitDepth(h.video!.codecPrivate)).toBe(10);
  });

  it("the built-in decoder turns every 10-bit HEVC frame into a real picture, in order", async () => {
    const m = await createRsVideo({ wasmBinary: readFileSync(resolve(root, "src/lib/mkv/wasm/rsvideo.wasm")) });
    const src = fileSource("hevc10-small.mkv");
    const h = await parseMkvHeader(src);
    const f = new VideoFeeder(m);
    expect(f.open("hevc", h.video!.codecPrivate || null)).toBe(true);
    const pts: number[] = []; let bright = 0;
    const take = (p: { width: number; height: number; pts: number; data: Uint8Array }) => {
      expect([p.width, p.height]).toEqual([192, 108]);
      pts.push(p.pts);
      if (pts.length === 10) for (let i = 0; i < p.width * p.height; i += 1) bright += p.data[i];
    };
    for (const b of await allBlocks(src, h.firstClusterPos, h.video!.number)) {
      f.decode(b.frames[0], Math.round((b.ptsTicks * h.timecodeScale) / 1000), take);
    }
    f.drain(take);
    expect(pts.length).toBe(36); // 3 s at 12 fps
    expect(pts).toEqual([...pts].sort((a, b) => a - b));
    expect(bright / (192 * 108)).toBeGreaterThan(30); // not a black frame
    f.close();
  });

  it("only HEVC and 10-bit/4:2:2/4:4:4 H.264 count as 'may be black'", () => {
    expect(videoFamily('video/mp4; codecs="hvc1.1.6.L93.B0"')).toBe("hevc");
    expect(videoFamily('video/mp4; codecs="avc1.6e0028"')).toBe("avc-6e");
    expect(videoFamily('video/mp4; codecs="avc1.640029"')).toBe("");
    expect(videoFamily("")).toBe("");
  });
});

describe("a chosen language starts close to the playhead", () => {
  it("reads from the cluster just before the playhead, not from the far keyframe", async () => {
    const src = fileSource("sparse-cues.mkv");
    const h = await parseMkvHeader(src);
    const cues = await loadMkvCues(src, h);
    expect(cues.length).toBeGreaterThanOrEqual(2);
    const pos = await clusterNear(src, h, cues, 2.2, 0);
    expect(pos).toBeGreaterThan(cues[0].pos);
    const first = await new MkvBlockStream(src, pos, new Set([h.audio[0].number])).next();
    const sec = (first!.ptsTicks * h.timecodeScale) / 1e9;
    expect(sec).toBeLessThanOrEqual(2.2);
    expect(sec).toBeGreaterThan(1.4);
  });
});
