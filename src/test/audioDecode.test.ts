import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import createRsAudio from "@/lib/mkv/wasm/rsaudio.mjs";
import { PcmFeeder } from "@/lib/mkv/pcmFeeder";
import { codedNumber, crc8, decoderIdFor, encodeFlacFrame, flacStreamInfo } from "@/lib/mkv/flacPcm";
import { decodedAudioInit } from "@/lib/mkv/audioDecode";

const root = resolve(__dirname, "../..");
/** Split a raw E-AC3 stream into its sync frames. */
const eac3Frames = (buf: Uint8Array) => {
  const out: Uint8Array[] = [];
  let off = 0;
  while (off + 4 < buf.length) {
    if (buf[off] !== 0x0b || buf[off + 1] !== 0x77) { off += 1; continue; }
    const size = ((((buf[off + 2] & 7) << 8) | buf[off + 3]) + 1) * 2;
    out.push(buf.slice(off, off + size));
    off += size;
  }
  return out;
};

describe("Dolby audio decoding", () => {
  it("E-AC3, AC3 and DTS tracks have a software decoder; AAC does not need one", () => {
    expect(decoderIdFor("E-AC3")).toBe(2);
    expect(decoderIdFor("AC3")).toBe(1);
    expect(decoderIdFor("DTS")).toBe(3);
    expect(decoderIdFor("AAC")).toBe(0);
  });

  it("an E-AC3 5.1 track decodes to audible stereo sound at the right time", async () => {
    const m = await createRsAudio({ wasmBinary: readFileSync(resolve(root, "src/lib/mkv/wasm/rsaudio.wasm")) });
    const feeder = new PcmFeeder(m);
    expect(feeder.open({ id: 2, rate: 48000, channels: 6 })).toBe(true);
    const frames = eac3Frames(new Uint8Array(readFileSync(resolve(root, "src/test/fixtures/sine-5ch.eac3"))));
    const start = 10 * 48000; // the track starts 10 s into the episode
    const out = feeder.push(frames.map((data, i) => ({ data, pts: i === 0 ? start : -1 })), true);
    expect(out.length).toBeGreaterThan(0);
    const bytes = out.reduce((n, f) => n + f.length, 0);
    // 0.5 s of 48 kHz stereo 16-bit is 96 KB raw; compressed FLAC must be well under it
    expect(bytes).toBeGreaterThan(1_000);
    expect(bytes).toBeLessThan(96_000 * 0.7);
    // tfdt (first decode time) is the episode time, in 48 kHz units
    const frag = out[0];
    const tfdt = frag.findIndex((_, i) => frag[i] === 0x74 && frag[i + 1] === 0x66 && frag[i + 2] === 0x64 && frag[i + 3] === 0x74);
    const view = new DataView(frag.buffer, frag.byteOffset + tfdt + 8, 8);
    expect(Number(view.getBigUint64(0))).toBe(start);
    if (process.env.RS_DUMP_FLAC) writeFileSync(process.env.RS_DUMP_FLAC, Buffer.concat([Buffer.from(decodedAudioInit()), ...out.map((f) => Buffer.from(f))]));
    feeder.close();
  });

  it("FLAC frame headers carry a valid checksum and sample position", () => {
    const pcm = new Float32Array(32).fill(0.25);
    const frame = encodeFlacFrame(pcm, 0, 16, 48000);
    const coded = codedNumber(48000);
    const headerEnd = 4 + coded.length + 2;
    expect(frame[0]).toBe(0xff);
    expect(frame[1]).toBe(0xf9);
    expect(frame[headerEnd]).toBe(crc8(frame, headerEnd));
    expect(codedNumber(0x7f)).toEqual([0x7f]);
    expect(codedNumber(0x80)).toEqual([0xc2, 0x80]);
  });

  it("compressed FLAC frames decode back to exactly the same samples", async () => {
    const m = await createRsAudio({ wasmBinary: readFileSync(resolve(root, "src/lib/mkv/wasm/rsaudio.wasm")) });
    const info = flacStreamInfo();
    const ptr = m._rs_alloc(info.length);
    m.HEAPU8.set(info, ptr);
    expect(m._rs_open(6, ptr, info.length, 48000, 2, 16)).toBe(0);
    m._rs_free(ptr);
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    // speech-like tone, wide-band noise, silence, clipping, opposite channels
    const shapes: Array<(i: number, ch: number) => number> = [
      (i, ch) => 0.6 * Math.sin((i * (ch ? 523 : 440) * 2 * Math.PI) / 48000),
      () => rnd() * 2 - 1,
      () => 0,
      (i) => (i % 200 < 100 ? 1.5 : -1.5),
      (i, ch) => (ch ? -1 : 1) * 0.4 * Math.sin(i / 9),
    ];
    let at = 0;
    for (const [k, shape] of shapes.entries()) {
      for (const n of [2048, 777, 3]) {
        const pcm = new Float32Array(n * 2);
        for (let i = 0; i < n; i += 1) for (let ch = 0; ch < 2; ch += 1) pcm[i * 2 + ch] = shape(i + k * 9999, ch);
        const frame = encodeFlacFrame(pcm, 0, n, at);
        if (k === 0 && n === 2048) expect(frame.length).toBeLessThan(n * 4 * 0.6); // tone: much smaller than raw
        expect(frame.length).toBeLessThanOrEqual(n * 4 + 40); // never bigger than raw + headers
        const p = m._rs_alloc(frame.length);
        m.HEAPU8.set(frame, p);
        const got = m._rs_decode(p, frame.length);
        m._rs_free(p);
        expect(got).toBe(n);
        const outPtr = m._rs_out() >> 2;
        for (let i = 0; i < n * 2; i += 1) {
          const want = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))) | 0;
          expect(Math.round(m.HEAPF32[outPtr + i] * 32768) | 0).toBe(want);
        }
        at += n;
      }
    }
    m._rs_close();
  });
});
