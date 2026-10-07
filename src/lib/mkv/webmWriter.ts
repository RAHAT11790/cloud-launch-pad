// ============================================================
// Minimal WebM writer for MSE audio SourceBuffers
// ============================================================
// Opus / Vorbis audio inside our RS .mkv files can be handed to Media Source
// Extensions as WebM without touching a single audio sample: WebM is a strict
// subset of Matroska, so we only rebuild a tiny header and re-wrap the original
// blocks into short clusters. One track per SourceBuffer, track number 1.

const concat = (parts: Uint8Array[]): Uint8Array => {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};

const idBytes = (id: number): Uint8Array => {
  const bytes: number[] = [];
  let value = id;
  while (value > 0) { bytes.unshift(value & 0xff); value = Math.floor(value / 256); }
  return new Uint8Array(bytes);
};

/** EBML size vint (always 8 bytes when `unknown`). */
const sizeBytes = (size: number, unknown = false): Uint8Array => {
  if (unknown) return new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  for (let length = 1; length <= 8; length += 1) {
    const max = 2 ** (7 * length) - 2;
    if (size <= max) {
      const out = new Uint8Array(length);
      let value = size;
      for (let i = length - 1; i >= 0; i -= 1) { out[i] = value & 0xff; value = Math.floor(value / 256); }
      out[0] |= 0x80 >> (length - 1);
      return out;
    }
  }
  throw new Error("ebml size too large");
};

const el = (id: number, ...payload: Uint8Array[]): Uint8Array => {
  const body = concat(payload);
  return concat([idBytes(id), sizeBytes(body.length), body]);
};

const uint = (id: number, value: number): Uint8Array => {
  const bytes: number[] = [];
  let v = Math.max(0, Math.floor(value));
  do { bytes.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
  return el(id, new Uint8Array(bytes));
};

const float64 = (id: number, value: number): Uint8Array => {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setFloat64(0, value);
  return el(id, buf);
};

const str = (id: number, value: string): Uint8Array => {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i) & 0x7f;
  return el(id, out);
};

export interface WebmAudioConfig {
  codecId: string; // A_OPUS | A_VORBIS
  codecPrivate?: Uint8Array;
  sampleRate: number;
  channels: number;
  bitDepth?: number;
  codecDelayNs?: number;
  seekPreRollNs?: number;
  timecodeScale: number;
  durationMs?: number;
}

export function buildWebmInit(cfg: WebmAudioConfig): Uint8Array {
  const ebmlHeader = el(
    0x1a45dfa3,
    uint(0x4286, 1), // EBMLVersion
    uint(0x42f7, 1), // EBMLReadVersion
    uint(0x42f2, 4), // EBMLMaxIDLength
    uint(0x42f3, 8), // EBMLMaxSizeLength
    str(0x4282, "webm"),
    uint(0x4287, 4),
    uint(0x4285, 2),
  );
  const infoParts = [uint(0x2ad7b1, cfg.timecodeScale || 1_000_000)];
  if (cfg.durationMs && cfg.durationMs > 0) {
    infoParts.push(float64(0x4489, (cfg.durationMs * 1_000_000) / (cfg.timecodeScale || 1_000_000)));
  }
  const info = el(0x1549a966, ...infoParts);
  const audioParts = [float64(0xb5, cfg.sampleRate || 48000), uint(0x9f, cfg.channels || 2)];
  if (cfg.bitDepth) audioParts.push(uint(0x6264, cfg.bitDepth));
  const entryParts = [
    uint(0xd7, 1), // TrackNumber
    uint(0x73c5, 1), // TrackUID
    uint(0x83, 2), // TrackType audio
    str(0x86, cfg.codecId),
  ];
  if (cfg.codecPrivate?.length) entryParts.push(el(0x63a2, cfg.codecPrivate));
  if (cfg.codecDelayNs) entryParts.push(uint(0x56aa, cfg.codecDelayNs));
  if (cfg.seekPreRollNs) entryParts.push(uint(0x56bb, cfg.seekPreRollNs));
  entryParts.push(el(0xe1, ...audioParts));
  const tracks = el(0x1654ae6b, el(0xae, ...entryParts));
  const segmentHeader = concat([idBytes(0x18538067), sizeBytes(0, true)]);
  return concat([ebmlHeader, segmentHeader, info, tracks]);
}

export interface WebmBlock {
  /** Absolute timestamp in Matroska ticks (TimecodeScale units). */
  ptsTicks: number;
  /** Original block flags byte (lacing bits preserved). */
  flags: number;
  /** Bytes after the flags byte: lace header + frame data, copied verbatim. */
  payload: Uint8Array;
}

/** One cluster holding `blocks` (all must lie within ±32 s of the first). */
export function buildWebmCluster(blocks: WebmBlock[]): Uint8Array {
  if (!blocks.length) return new Uint8Array(0);
  const base = blocks[0].ptsTicks;
  const parts: Uint8Array[] = [uint(0xe7, base)];
  for (const block of blocks) {
    const rel = Math.max(-32768, Math.min(32767, Math.round(block.ptsTicks - base)));
    const head = new Uint8Array(4);
    head[0] = 0x81; // track number 1
    head[1] = (rel >> 8) & 0xff;
    head[2] = rel & 0xff;
    head[3] = (block.flags & 0x0f) | 0x80; // audio blocks are always keyframes
    parts.push(el(0xa3, head, block.payload));
  }
  return el(0x1f43b675, ...parts);
}

export const webmInternals = { sizeBytes, idBytes };
