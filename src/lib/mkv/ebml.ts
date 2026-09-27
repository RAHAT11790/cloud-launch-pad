// ============================================================
// Minimal EBML / Matroska primitives
// ============================================================
// Used by the in-browser MKV engine (src/lib/mkv/mkvMultiAudio.ts) so the
// player can expose EVERY embedded audio track of an .mkv file. Browsers only
// decode the first audio track of a Matroska file and give the page no way to
// switch, so we parse the container ourselves and remux to fragmented MP4.

export const EBML_IDS = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  FlagDefault: 0x88,
  FlagEnabled: 0xb9,
  DefaultDuration: 0x23e383,
  Name: 0x536e,
  Language: 0x22b59c,
  LanguageBCP47: 0x22b59d,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  DisplayWidth: 0x54b0,
  DisplayHeight: 0x54ba,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  OutputSamplingFrequency: 0x78b5,
  Channels: 0x9f,
  BitDepth: 0x6264,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Void: 0xec,
  CRC32: 0xbf,
} as const;

export interface VintResult {
  /** Value with the length marker removed. */
  value: number;
  /** Bytes consumed. */
  length: number;
  /** True when every data bit is 1 (unknown / streaming size). */
  unknown: boolean;
}

/** Read an EBML element ID (marker bits kept, matching the spec tables above). */
export function readId(buf: Uint8Array, pos: number): { id: number; length: number } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  if (first === 0) return null;
  let length = 1;
  for (let mask = 0x80; mask > 0; mask >>= 1) {
    if (first & mask) break;
    length += 1;
  }
  if (length > 4 || pos + length > buf.length) return null;
  let id = 0;
  for (let i = 0; i < length; i += 1) id = id * 256 + buf[pos + i];
  return { id, length };
}

/** Read an EBML variable size integer (marker stripped). */
export function readVint(buf: Uint8Array, pos: number): VintResult | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  if (first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (mask > 0 && !(first & mask)) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8 || pos + length > buf.length) return null;
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < length; i += 1) {
    const byte = buf[pos + i];
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }
  return { value, length, unknown: allOnes };
}

/** Signed vint, used by block lacing deltas. */
export function readSignedVint(buf: Uint8Array, pos: number): VintResult | null {
  const raw = readVint(buf, pos);
  if (!raw) return null;
  const bias = 2 ** (7 * raw.length - 1) - 1;
  return { ...raw, value: raw.value - bias };
}

export function readUintBytes(buf: Uint8Array, start: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i += 1) value = value * 256 + buf[start + i];
  return value;
}

export function readFloatBytes(buf: Uint8Array, start: number, size: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + start, size);
  if (size === 4) return view.getFloat32(0);
  if (size === 8) return view.getFloat64(0);
  return 0;
}

export function readStringBytes(buf: Uint8Array, start: number, size: number): string {
  let out = "";
  for (let i = 0; i < size; i += 1) {
    const byte = buf[start + i];
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

export function readUtf8Bytes(buf: Uint8Array, start: number, size: number): string {
  try {
    return new TextDecoder("utf-8").decode(buf.subarray(start, start + size)).replace(/\0+$/, "");
  } catch {
    return readStringBytes(buf, start, size);
  }
}

export interface EbmlHeader {
  id: number;
  size: number;
  unknownSize: boolean;
  headerSize: number;
  /** Offset of the first payload byte relative to `buf`. */
  dataStart: number;
}

/** Read one element header at `pos`; null when the buffer is too short. */
export function readElementHeader(buf: Uint8Array, pos: number): EbmlHeader | null {
  const id = readId(buf, pos);
  if (!id) return null;
  const size = readVint(buf, pos + id.length);
  if (!size) return null;
  const headerSize = id.length + size.length;
  return {
    id: id.id,
    size: size.unknown ? 0 : size.value,
    unknownSize: size.unknown,
    headerSize,
    dataStart: pos + headerSize,
  };
}

/** Walk the direct children of a fully buffered master element. */
export function eachChild(
  buf: Uint8Array,
  start: number,
  end: number,
  visit: (el: EbmlHeader) => void,
): void {
  let pos = start;
  while (pos < end) {
    const el = readElementHeader(buf, pos);
    if (!el) return;
    const stop = el.unknownSize ? end : Math.min(end, el.dataStart + el.size);
    visit({ ...el, size: stop - el.dataStart });
    if (stop <= pos) return;
    pos = stop;
  }
}

/** Find the first occurrence of an element ID inside a buffered range. */
export function findElement(buf: Uint8Array, start: number, end: number, id: number): EbmlHeader | null {
  let found: EbmlHeader | null = null;
  eachChild(buf, start, end, (el) => {
    if (!found && el.id === id) found = el;
  });
  return found;
}
