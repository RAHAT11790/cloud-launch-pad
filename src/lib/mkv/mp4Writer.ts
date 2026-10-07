// ============================================================
// Fragmented MP4 writer (init segment + moof/mdat fragments)
// ============================================================
// Small, dependency-free ISO-BMFF writer used to feed Media Source Extensions
// with the tracks demuxed from a Matroska file. One SourceBuffer per track, so
// swapping the audio language never disturbs the video pipeline.

const enc = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const u8 = (...values: number[]): Uint8Array => new Uint8Array(values);

const u16 = (value: number): Uint8Array => u8((value >> 8) & 0xff, value & 0xff);

const u32 = (value: number): Uint8Array =>
  u8((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);

const i32 = (value: number): Uint8Array => u32(value < 0 ? value + 0x100000000 : value);

const u64 = (value: number): Uint8Array => {
  const high = Math.floor(value / 0x100000000);
  const low = value - high * 0x100000000;
  return concat([u32(high), u32(low)]);
};

const box = (type: string, ...payload: Uint8Array[]): Uint8Array => {
  const body = concat(payload);
  return concat([u32(body.length + 8), enc(type), body]);
};

const fullBox = (type: string, version: number, flags: number, ...payload: Uint8Array[]): Uint8Array =>
  box(type, u8(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff), ...payload);

const ZERO = (count: number): Uint8Array => new Uint8Array(count);

const UNITY_MATRIX = concat([
  u32(0x00010000), u32(0), u32(0),
  u32(0), u32(0x00010000), u32(0),
  u32(0), u32(0), u32(0x40000000),
]);

export interface VideoTrackConfig {
  kind: "video";
  timescale: number;
  width: number;
  height: number;
  /** Raw avcC / hvcC payload from Matroska CodecPrivate. */
  codecPrivate: Uint8Array;
  codecBox: "avc1" | "hvc1";
}

export interface AudioTrackConfig {
  kind: "audio";
  timescale: number;
  channels: number;
  sampleRate: number;
  sampleSize: number;
  /** AudioSpecificConfig from Matroska CodecPrivate (AAC). Empty for MP3. */
  codecPrivate: Uint8Array;
  /** esds objectTypeIndication: 0x40 = AAC (default), 0x6b = MP3. */
  objectType?: number;
}

export type TrackConfig = VideoTrackConfig | AudioTrackConfig;

export interface Mp4Sample {
  data: Uint8Array;
  duration: number;
  /** Composition time offset (pts - dts), signed. */
  cto: number;
  isKey: boolean;
}

// --- descriptor helpers (esds) ---------------------------------------------

const descriptorLength = (length: number): Uint8Array => {
  const bytes: number[] = [];
  let value = length;
  do {
    bytes.unshift(value & 0x7f);
    value >>= 7;
  } while (value > 0);
  for (let i = 0; i < bytes.length - 1; i += 1) bytes[i] |= 0x80;
  return new Uint8Array(bytes);
};

const descriptor = (tag: number, ...payload: Uint8Array[]): Uint8Array => {
  const body = concat(payload);
  return concat([u8(tag), descriptorLength(body.length), body]);
};

const esds = (asc: Uint8Array, oti = 0x40): Uint8Array =>
  fullBox(
    "esds",
    0,
    0,
    descriptor(
      0x03,
      u16(1),
      u8(0),
      descriptor(
        0x04,
        u8(oti), // 0x40 MPEG-4 audio, 0x6b MPEG-1 audio (MP3)
        u8(0x15), // streamType audio + upStream 0 + reserved 1
        u8(0x00, 0x00, 0x00), // bufferSizeDB
        u32(0), // maxBitrate
        u32(0), // avgBitrate
        ...(asc.length ? [descriptor(0x05, asc)] : []),
      ),
      descriptor(0x06, u8(0x02)),
    ),
  );

// --- init segment ----------------------------------------------------------

const stsdVideo = (cfg: VideoTrackConfig): Uint8Array => {
  const compressorName = new Uint8Array(32);
  return fullBox(
    "stsd",
    0,
    0,
    u32(1),
    box(
      cfg.codecBox,
      ZERO(6),
      u16(1), // data reference index
      ZERO(16),
      u16(cfg.width),
      u16(cfg.height),
      u32(0x00480000), // 72 dpi
      u32(0x00480000),
      u32(0),
      u16(1), // frame count
      compressorName,
      u16(0x0018), // depth
      u16(0xffff), // pre_defined = -1
      box(cfg.codecBox === "hvc1" ? "hvcC" : "avcC", cfg.codecPrivate),
    ),
  );
};

const stsdAudio = (cfg: AudioTrackConfig): Uint8Array =>
  fullBox(
    "stsd",
    0,
    0,
    u32(1),
    box(
      "mp4a",
      ZERO(6),
      u16(1),
      ZERO(8),
      u16(cfg.channels || 2),
      u16(cfg.sampleSize || 16),
      ZERO(4),
      u32(Math.round(cfg.sampleRate) * 0x10000 > 0x7fffffff ? 0 : Math.round(cfg.sampleRate) * 0x10000),
      esds(cfg.codecPrivate, cfg.objectType || 0x40),
    ),
  );

const emptyStbl = (cfg: TrackConfig): Uint8Array =>
  box(
    "stbl",
    cfg.kind === "video" ? stsdVideo(cfg) : stsdAudio(cfg),
    fullBox("stts", 0, 0, u32(0)),
    fullBox("stsc", 0, 0, u32(0)),
    fullBox("stsz", 0, 0, u32(0), u32(0)),
    fullBox("stco", 0, 0, u32(0)),
  );

export function buildInitSegment(cfg: TrackConfig, trackId = 1): Uint8Array {
  const ftyp = box("ftyp", enc("isom"), u32(0x200), enc("isom"), enc("iso2"), enc("avc1"), enc("mp41"));
  const mvhd = fullBox(
    "mvhd",
    0,
    0,
    u32(0), u32(0),
    u32(1000), // movie timescale
    u32(0), // duration (fragmented)
    u32(0x00010000), // rate
    u16(0x0100), // volume
    ZERO(10),
    UNITY_MATRIX,
    ZERO(24),
    u32(trackId + 1),
  );
  const tkhd = fullBox(
    "tkhd",
    0,
    3,
    u32(0), u32(0),
    u32(trackId),
    u32(0), // reserved
    u32(0), // duration (fragmented)
    ZERO(8),
    u16(0), // layer
    u16(0), // alternate group
    u16(cfg.kind === "audio" ? 0x0100 : 0),
    ZERO(2),
    UNITY_MATRIX,
    u32(cfg.kind === "video" ? cfg.width * 0x10000 : 0),
    u32(cfg.kind === "video" ? cfg.height * 0x10000 : 0),
  );
  const mdhd = fullBox("mdhd", 0, 0, u32(0), u32(0), u32(cfg.timescale), u32(0), u16(0x55c4), u16(0));
  const hdlr = fullBox(
    "hdlr",
    0,
    0,
    u32(0),
    enc(cfg.kind === "video" ? "vide" : "soun"),
    ZERO(12),
    enc(cfg.kind === "video" ? "VideoHandler\0" : "SoundHandler\0"),
  );
  const minf = box(
    "minf",
    cfg.kind === "video" ? box("vmhd", u8(0, 0, 0, 1), ZERO(8)) : fullBox("smhd", 0, 0, u16(0), u16(0)),
    box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))),
    emptyStbl(cfg),
  );
  const trak = box("trak", tkhd, box("mdia", mdhd, hdlr, minf));
  const mvex = box("mvex", fullBox("trex", 0, 0, u32(trackId), u32(1), u32(0), u32(0), u32(0)));
  return concat([ftyp, box("moov", mvhd, trak, mvex)]);
}

// --- media fragment --------------------------------------------------------

const SYNC_FLAGS = 0x02000000;
const NON_SYNC_FLAGS = 0x01010000;

export function buildFragment(
  sequence: number,
  baseMediaDecodeTime: number,
  samples: Mp4Sample[],
  trackId = 1,
): Uint8Array {
  const trunFlags = 0x000001 | 0x000100 | 0x000200 | 0x000400 | 0x000800;
  const sampleRows: Uint8Array[] = samples.map((sample) =>
    concat([
      u32(sample.duration),
      u32(sample.data.length),
      u32(sample.isKey ? SYNC_FLAGS : NON_SYNC_FLAGS),
      i32(sample.cto),
    ]),
  );
  const mdatSize = samples.reduce((total, sample) => total + sample.data.length, 0) + 8;
  const buildMoof = (dataOffset: number) =>
    box(
      "moof",
      fullBox("mfhd", 0, 0, u32(sequence)),
      box(
        "traf",
        fullBox("tfhd", 0, 0x020000, u32(trackId)),
        fullBox("tfdt", 1, 0, u64(Math.max(0, Math.round(baseMediaDecodeTime)))),
        fullBox("trun", 1, trunFlags, u32(samples.length), i32(dataOffset), ...sampleRows),
      ),
    );
  const probe = buildMoof(0);
  const moof = buildMoof(probe.length + 8);
  const mdat = box("mdat", ...samples.map((sample) => sample.data));
  if (mdat.length !== mdatSize) {
    // defensive: keep sizes consistent even if a sample was mutated meanwhile
    return concat([moof, mdat]);
  }
  return concat([moof, mdat]);
}

export const mp4Internals = { box, fullBox, concat, u32, descriptorLength };
