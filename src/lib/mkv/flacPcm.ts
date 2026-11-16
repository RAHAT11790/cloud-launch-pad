// ============================================================
// PCM → FLAC frames (lossless, compressed) for Media Source
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

// ---- lossless compression -------------------------------------------------
// Phones keep only ~2–5 MB of audio per Media Source buffer (Chrome on Android
// "low-end"/"medium" memory limits). Raw 16-bit stereo is 192 KB per second,
// which filled that in ~10 s and made the decoded Dolby language stop. Fixed
// predictors + Rice coding (+ mid/side stereo) usually halve it, losslessly.

class BitWriter {
  buf: Uint8Array;
  pos = 0;
  private acc = 0;
  private bits = 0;
  constructor(size: number) { this.buf = new Uint8Array(size); }
  /** Write the low `n` (≤ 24) bits of `v`. */
  put(v: number, n: number) {
    if (n <= 0) return;
    this.acc = (this.acc << n) | (v & ((1 << n) - 1));
    this.bits += n;
    while (this.bits >= 8) {
      this.bits -= 8;
      this.buf[this.pos++] = (this.acc >>> this.bits) & 0xff;
    }
    this.acc &= (1 << this.bits) - 1;
  }
  /** `q` zero bits followed by a one. */
  unary(q: number) {
    while (q >= 16) { this.put(0, 16); q -= 16; }
    this.put(1, q + 1);
  }
  align() { if (this.bits > 0) this.put(0, 8 - this.bits); }
}

/** Residuals of FLAC's fixed predictor of `order` (samples before `order` are warm-up). */
function fixedResidual(x: Int32Array, n: number, order: number, out: Int32Array) {
  for (let i = order; i < n; i += 1) {
    switch (order) {
      case 0: out[i] = x[i]; break;
      case 1: out[i] = x[i] - x[i - 1]; break;
      case 2: out[i] = x[i] - 2 * x[i - 1] + x[i - 2]; break;
      case 3: out[i] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; break;
      default: out[i] = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4]; break;
    }
  }
}

const zigzag = (r: number) => (r >= 0 ? r * 2 : -r * 2 - 1);
const MAX_RICE = 14;

interface RicePlan { order: number; partOrder: number; params: number[]; bits: number }

/** Best partition order + Rice parameter per partition (exact bit count). */
function planRice(res: Int32Array, n: number, order: number): RicePlan | null {
  let best: RicePlan | null = null;
  for (let po = 0; po <= 6; po += 1) {
    const parts = 1 << po;
    if (n % parts !== 0 || (n >> po) <= order) break;
    const size = n >> po;
    const params: number[] = [];
    let bits = 2 + 4;
    let ok = true;
    for (let p = 0; p < parts; p += 1) {
      const from = p === 0 ? order : p * size;
      const to = (p + 1) * size;
      const count = to - from;
      let sum = 0;
      for (let i = from; i < to; i += 1) sum += zigzag(res[i]);
      let k0 = 0;
      const mean = count > 0 ? sum / count : 0;
      while (k0 < MAX_RICE && (1 << (k0 + 1)) <= mean) k0 += 1;
      let bestK = -1; let bestBits = Infinity;
      for (let k = Math.max(0, k0 - 1); k <= Math.min(MAX_RICE, k0 + 1); k += 1) {
        let b = count * (k + 1);
        for (let i = from; i < to && b < bestBits; i += 1) b += zigzag(res[i]) >>> k;
        if (b < bestBits) { bestBits = b; bestK = k; }
      }
      if (bestK < 0) { ok = false; break; }
      params.push(bestK);
      bits += 4 + bestBits;
    }
    if (ok && (!best || bits < best.bits)) best = { order, partOrder: po, params, bits };
  }
  return best;
}

interface SubPlan { kind: "constant" | "verbatim" | "fixed"; bits: number; rice?: RicePlan }

const scratch = { res: new Int32Array(0) };
const residualBuf = (n: number) => (scratch.res.length >= n ? scratch.res : (scratch.res = new Int32Array(Math.max(n, 4096))));

/** Cheapest way to store one channel (`bps` bits per sample). */
function planSubframe(x: Int32Array, n: number, bps: number): SubPlan {
  let constant = true;
  for (let i = 1; i < n; i += 1) if (x[i] !== x[0]) { constant = false; break; }
  if (constant) return { kind: "constant", bits: 8 + bps };
  const verbatim: SubPlan = { kind: "verbatim", bits: 8 + n * bps };
  if (n <= 4) return verbatim;
  const res = residualBuf(n);
  // Pick the predictor with the smallest residual energy, then Rice-code it.
  let bestOrder = 0; let bestSum = Infinity;
  for (let order = 0; order <= 4; order += 1) {
    fixedResidual(x, n, order, res);
    let sum = 0;
    for (let i = order; i < n; i += 1) sum += res[i] < 0 ? -res[i] : res[i];
    if (sum < bestSum) { bestSum = sum; bestOrder = order; }
  }
  fixedResidual(x, n, bestOrder, res);
  const rice = planRice(res, n, bestOrder);
  if (!rice) return verbatim;
  const bits = 8 + bestOrder * bps + rice.bits;
  return bits < verbatim.bits ? { kind: "fixed", bits, rice } : verbatim;
}

function writeSubframe(w: BitWriter, x: Int32Array, n: number, bps: number, plan: SubPlan) {
  if (plan.kind === "constant") { w.put(0x00, 8); w.put(x[0], bps); return; }
  if (plan.kind === "verbatim") { w.put(0x02, 8); for (let i = 0; i < n; i += 1) w.put(x[i], bps); return; }
  const rice = plan.rice!;
  const order = rice.order;
  w.put((0x08 | order) << 1, 8);
  for (let i = 0; i < order; i += 1) w.put(x[i], bps);
  const res = residualBuf(n);
  fixedResidual(x, n, order, res);
  w.put(0, 2); // Rice, 4-bit parameters
  w.put(rice.partOrder, 4);
  const size = n >> rice.partOrder;
  rice.params.forEach((k, p) => {
    w.put(k, 4);
    const from = p === 0 ? order : p * size;
    const to = (p + 1) * size;
    for (let i = from; i < to; i += 1) {
      const u = zigzag(res[i]);
      w.unary(u >>> k);
      if (k) w.put(u & ((1 << k) - 1), k);
    }
  });
}

const chanBufs = { l: new Int32Array(0), r: new Int32Array(0), m: new Int32Array(0), s: new Int32Array(0) };
const chanBuf = (key: keyof typeof chanBufs, n: number) => (chanBufs[key].length >= n ? chanBufs[key] : (chanBufs[key] = new Int32Array(Math.max(n, 4096))));

/**
 * One FLAC frame from interleaved stereo float PCM.
 * `firstSample` is the absolute sample position (variable-blocksize stream).
 * Lossless: fixed predictors, Rice coding, best of left/right, left/side,
 * right/side and mid/side per frame.
 */
export function encodeFlacFrame(pcm: Float32Array, offsetFrames: number, frames: number, firstSample: number): Uint8Array {
  const n = Math.max(1, Math.min(65536, frames));
  const L = chanBuf("l", n); const R = chanBuf("r", n); const M = chanBuf("m", n); const S = chanBuf("s", n);
  for (let i = 0; i < n; i += 1) {
    const a = toInt16(pcm[(offsetFrames + i) * DECODED_CHANNELS] || 0);
    const b = toInt16(pcm[(offsetFrames + i) * DECODED_CHANNELS + 1] || 0);
    L[i] = a; R[i] = b; M[i] = (a + b) >> 1; S[i] = a - b;
  }
  const pl = planSubframe(L, n, 16); const pr = planSubframe(R, n, 16);
  const pm = planSubframe(M, n, 16); const ps = planSubframe(S, n, 17);
  // FLAC channel assignment: 1 = L/R, 8 = left/side, 9 = side/right, 10 = mid/side.
  const options: Array<[number, number]> = [[1, pl.bits + pr.bits], [8, pl.bits + ps.bits], [9, ps.bits + pr.bits], [10, pm.bits + ps.bits]];
  let assign = 1; let cost = Infinity;
  for (const [a, c] of options) if (c < cost) { cost = c; assign = a; }
  const head = [0xff, 0xf9, 0x7a, (assign << 4) | 0x08, ...codedNumber(Math.max(0, Math.round(firstSample))), ((n - 1) >> 8) & 0xff, (n - 1) & 0xff];
  const w = new BitWriter(head.length + 1 + Math.ceil((cost + 16) / 8) + 8);
  w.buf.set(head, 0);
  w.pos = head.length;
  w.buf[w.pos] = crc8(w.buf, w.pos); w.pos += 1;
  if (assign === 1) { writeSubframe(w, L, n, 16, pl); writeSubframe(w, R, n, 16, pr); }
  else if (assign === 8) { writeSubframe(w, L, n, 16, pl); writeSubframe(w, S, n, 17, ps); }
  else if (assign === 9) { writeSubframe(w, S, n, 17, ps); writeSubframe(w, R, n, 16, pr); }
  else { writeSubframe(w, M, n, 16, pm); writeSubframe(w, S, n, 17, ps); }
  w.align();
  const c = crc16(w.buf, w.pos);
  w.buf[w.pos++] = (c >> 8) & 0xff;
  w.buf[w.pos++] = c & 0xff;
  return w.buf.slice(0, w.pos);
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
