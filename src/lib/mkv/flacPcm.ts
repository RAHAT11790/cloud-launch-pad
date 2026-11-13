// ============================================================
// PCM → FLAC frames (verbatim subframes) for Media Source
// ============================================================
// Browsers cannot decode Dolby (AC3/E-AC3), DTS or TrueHD, but every MSE
// browser plays FLAC in MP4. The WASM decoder turns those tracks into PCM and
// this writer wraps the PCM losslessly as FLAC frames, so the existing audio
// sidecar (an <audio> element following the video clock) plays them.

export const DECODED_RATE = 48000;
export const DECODED_CHANNELS = 2;
export const FLAC_BLOCK = 2048;

const CRC8 = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) { let c = i; for (let k = 0; k < 8; k += 1) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; t[i] = c; }
  return t;
})();
const CRC16 = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i += 1) { let c = i << 8; for (let k = 0; k < 8; k += 1) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; t[i] = c; }
  return t;
})();
export const crc8 = (b: Uint8Array, end = b.length) => { let c = 0; for (let i = 0; i < end; i += 1) c = CRC8[c ^ b[i]]; return c; };
export const crc16 = (b: Uint8Array, end = b.length) => { let c = 0; for (let i = 0; i < end; i += 1) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]]; return c; };

/** FLAC "UTF-8" coded number (up to 36 bits) used for the frame's first sample. */
export function codedNumber(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  let len = n < 0x800 ? 2 : n < 0x10000 ? 3 : n < 0x200000 ? 4 : n < 0x4000000 ? 5 : n < 0x80000000 ? 6 : 7;
  let v = n;
  for (let i = len - 1; i > 0; i -= 1) { bytes.unshift(0x80 | (v % 64)); v = Math.floor(v / 64); }
  const lead = len === 7 ? 0xfe : (0xff00 >> len) & 0xff;
  bytes.unshift(lead | v);
  return bytes;
}

/** STREAMINFO block (34 bytes) for 48 kHz stereo 16-bit, variable block sizes. */
export function flacStreamInfo(maxBlock = FLAC_BLOCK * 2): Uint8Array {
  const b = new Uint8Array(34);
  b[0] = 0; b[1] = 16; // min block size 16
  b[2] = (maxBlock >> 8) & 0xff; b[3] = maxBlock & 0xff;
  // min/max frame size unknown (0); sample rate 20 bits | channels-1 3 bits | bps-1 5 bits | total 36 bits
  const rate = DECODED_RATE;
  b[10] = (rate >> 12) & 0xff;
  b[11] = (rate >> 4) & 0xff;
  b[12] = ((rate & 0x0f) << 4) | ((DECODED_CHANNELS - 1) << 1) | ((16 - 1) >> 4);
  b[13] = ((16 - 1) & 0x0f) << 4;
  return b;
}

const toInt16 = (v: number) => {
  const s = Math.round(v * 32767);
  return s > 32767 ? 32767 : s < -32768 ? -32768 : s;
};

/**
 * One FLAC frame from interleaved stereo float PCM.
 * `firstSample` is the absolute sample position (variable-blocksize stream).
 */
export function encodeFlacFrame(pcm: Float32Array, offsetFrames: number, frames: number, firstSample: number): Uint8Array {
  const n = Math.max(1, Math.min(65536, frames));
  const head = [0xff, 0xf9, 0x7a, 0x18, ...codedNumber(Math.max(0, Math.round(firstSample))), ((n - 1) >> 8) & 0xff, (n - 1) & 0xff];
  const size = head.length + 1 + DECODED_CHANNELS * (1 + n * 2) + 2;
  const out = new Uint8Array(size);
  out.set(head, 0);
  let p = head.length;
  out[p] = crc8(out, p); p += 1;
  for (let ch = 0; ch < DECODED_CHANNELS; ch += 1) {
    out[p++] = 0x02; // verbatim subframe, no wasted bits
    for (let i = 0; i < n; i += 1) {
      const s = toInt16(pcm[(offsetFrames + i) * DECODED_CHANNELS + ch] || 0);
      out[p++] = (s >> 8) & 0xff;
      out[p++] = s & 0xff;
    }
  }
  const c = crc16(out, p);
  out[p++] = (c >> 8) & 0xff;
  out[p++] = c & 0xff;
  return out;
}

/** MSE type of the decoded audio stream. */
export const DECODED_AUDIO_MIME = 'audio/mp4; codecs="flac"';

/** Matroska codec name → decoder id inside the WASM module (0 = not decodable). */
export function decoderIdFor(codec: string, bitDepth?: number): number {
  const c = String(codec || "").toUpperCase().replace(/^A_/, "");
  if (c === "AC3") return 1;
  if (c === "E-AC3" || c === "EAC3") return 2;
  if (c === "DTS" || c.startsWith("DTS")) return 3;
  if (c === "TRUEHD") return 4;
  if (c === "MLP") return 5;
  if (c === "FLAC") return 6;
  if (c === "MPEG/L2") return 8;
  if (c === "PCM/INT/LIT") return bitDepth === 24 ? 12 : bitDepth === 32 ? 13 : 11;
  if (c === "PCM/FLOAT/IEEE") return 14;
  if (c === "PCM/INT/BIG") return bitDepth === 24 ? 16 : 15;
  return 0;
}
