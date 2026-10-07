// ============================================================
// Matroska demuxer (header, cues, cluster block stream)
// ============================================================
// Pure parsing — no DOM, no MSE — so the exact same code is used by the
// in-browser engine and by our Node/Bun verification scripts against the real
// RS files.

import {
  EBML_IDS,
  eachChild,
  readElementHeader,
  readFloatBytes,
  readSignedVint,
  readStringBytes,
  readUintBytes,
  readUtf8Bytes,
  readVint,
} from "./ebml";

export type TrackKind = "video" | "audio" | "subtitle";
/** How a track reaches the browser: fMP4, WebM, parsed text or not at all. */
export type TrackRoute = "mp4" | "webm" | "text" | null;

export interface MkvTrack {
  number: number;
  kind: TrackKind;
  codecId: string;
  codec: string; // short human codec name
  language: string;
  name: string;
  label: string;
  isDefault: boolean;
  isForced: boolean;
  route: TrackRoute;
  channels?: number;
  sampleRate?: number;
  bitDepth?: number;
  width?: number;
  height?: number;
  codecPrivate?: Uint8Array;
  defaultDurationNs?: number;
  codecDelayNs?: number;
  seekPreRollNs?: number;
  /** Header-stripping compression prefix (prepended to every frame). */
  stripPrefix?: Uint8Array;
  /** Frames are zlib-compressed (only accepted for subtitle tracks). */
  zlib?: boolean;
}

export interface MkvHeader {
  timecodeScale: number;
  durationMs: number;
  segmentStart: number;
  firstClusterPos: number;
  cuesPos: number;
  video: MkvTrack | null;
  audio: MkvTrack[];
  subtitles: MkvTrack[];
}

export interface MkvCue { timeTicks: number; pos: number }

export interface RangeSource {
  read(start: number, length: number): Promise<Uint8Array>;
}

const LANGUAGE_NAMES: Record<string, string> = {
  hin: "Hindi", hi: "Hindi", eng: "English", en: "English", jpn: "Japanese", ja: "Japanese", jp: "Japanese",
  ben: "Bengali", bn: "Bengali", tam: "Tamil", ta: "Tamil", tel: "Telugu", te: "Telugu", mal: "Malayalam", ml: "Malayalam",
  kan: "Kannada", kn: "Kannada", mar: "Marathi", mr: "Marathi", urd: "Urdu", ur: "Urdu", spa: "Spanish", es: "Spanish",
  fre: "French", fra: "French", fr: "French", ger: "German", deu: "German", de: "German", por: "Portuguese", pt: "Portuguese",
  kor: "Korean", ko: "Korean", chi: "Chinese", zho: "Chinese", zh: "Chinese", ara: "Arabic", ar: "Arabic", rus: "Russian", ru: "Russian",
  ita: "Italian", it: "Italian", ind: "Indonesian", id: "Indonesian", tha: "Thai", th: "Thai", vie: "Vietnamese", vi: "Vietnamese",
  tur: "Turkish", tr: "Turkish", pol: "Polish", pl: "Polish", may: "Malay", msa: "Malay", ms: "Malay", fil: "Filipino", tgl: "Tagalog",
};

export const languageName = (code: string): string => {
  const raw = String(code || "").toLowerCase();
  return LANGUAGE_NAMES[raw] || LANGUAGE_NAMES[raw.split(/[-_]/)[0]] || "";
};

const CODEC_NAMES: Array<[RegExp, string]> = [
  [/^V_MPEG4\/ISO\/AVC/i, "H.264"], [/^V_MPEGH\/ISO\/HEVC/i, "HEVC"], [/^V_VP9/i, "VP9"], [/^V_AV1/i, "AV1"],
  [/^A_AAC/i, "AAC"], [/^A_OPUS/i, "Opus"], [/^A_VORBIS/i, "Vorbis"], [/^A_EAC3/i, "E-AC3"], [/^A_AC3/i, "AC3"],
  [/^A_DTS/i, "DTS"], [/^A_TRUEHD/i, "TrueHD"], [/^A_FLAC/i, "FLAC"], [/^A_MPEG\/L3/i, "MP3"],
  [/^S_TEXT\/ASS|^S_ASS/i, "ASS"], [/^S_TEXT\/SSA|^S_SSA/i, "SSA"], [/^S_TEXT\/UTF8/i, "SRT"], [/^S_TEXT\/WEBVTT/i, "VTT"],
  [/^S_HDMV\/PGS/i, "PGS"], [/^S_VOBSUB/i, "VobSub"],
];
const codecName = (id: string) => CODEC_NAMES.find(([re]) => re.test(id))?.[1] || id.replace(/^[AVS]_/, "");

const CHANNEL_LABEL = (n?: number) => (!n ? "" : n === 1 ? "Mono" : n === 2 ? "Stereo" : n === 6 ? "5.1" : n === 8 ? "7.1" : `${n}ch`);

/** Clean up release-group noise in track names ("BluRay~Toonworld4all.me"). */
export const cleanTrackName = (name: string): string => {
  const cleaned = String(name || "")
    .replace(/[~|]?\s*(?:www\.)?[a-z0-9-]+\.(?:me|com|net|org|in|xyz|to|cc|io|site|online|co)\b/gi, "")
    .replace(/@\w+/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s~|\-–_.,]+|[\s~|\-–_.,]+$/g, "")
    .trim();
  return cleaned;
};

const NAME_HINTS: Array<[RegExp, string]> = [
  [/hindi|हिन्दी|हिंदी|\bhin\b/i, "Hindi"], [/english|\beng\b/i, "English"], [/japanese|日本語|\bjpn?\b/i, "Japanese"],
  [/bengali|bangla|বাংলা/i, "Bengali"], [/tamil/i, "Tamil"], [/telugu/i, "Telugu"], [/malayalam/i, "Malayalam"],
  [/kannada/i, "Kannada"], [/marathi/i, "Marathi"], [/urdu/i, "Urdu"], [/spanish|español/i, "Spanish"],
  [/french/i, "French"], [/german/i, "German"], [/portug/i, "Portuguese"], [/korean/i, "Korean"],
  [/chinese|mandarin/i, "Chinese"], [/arabic/i, "Arabic"], [/russian/i, "Russian"], [/indonesian/i, "Indonesian"],
];

/** Display name = language only. Release/group metadata in the track title is never shown. */
export function buildTrackLabel(kind: TrackKind, language: string, name: string, index: number): string {
  const lang = languageName(language) || NAME_HINTS.find(([re]) => re.test(String(name || "")))?.[1] || "";
  return lang || (kind === "audio" ? `Audio ${index + 1}` : `Subtitle ${index + 1}`);
}

const routeFor = (kind: TrackKind, codecId: string, hasCompression: boolean): TrackRoute => {
  if (kind === "video") return /^V_MPEG4\/ISO\/AVC$/i.test(codecId) || /^V_MPEGH\/ISO\/HEVC$/i.test(codecId) ? "mp4" : null;
  if (kind === "audio") {
    if (/^A_AAC/i.test(codecId) || /^A_MPEG\/L3$/i.test(codecId)) return "mp4";
    if ((/^A_OPUS$/i.test(codecId) || /^A_VORBIS$/i.test(codecId)) && !hasCompression) return "webm";
    return null;
  }
  if (/^S_HDMV\/PGS$/i.test(codecId)) return "text"; // rendered as bitmaps by the PGS decoder
  return /^S_TEXT\/(UTF8|ASS|SSA|WEBVTT)$/i.test(codecId) || /^S_(ASS|SSA)$/i.test(codecId) ? "text" : null;
};

function parseTracks(buf: Uint8Array, start: number, end: number): { video: MkvTrack | null; audio: MkvTrack[]; subtitles: MkvTrack[] } {
  let video: MkvTrack | null = null;
  const audio: MkvTrack[] = [];
  const subtitles: MkvTrack[] = [];
  eachChild(buf, start, end, (entry) => {
    if (entry.id !== EBML_IDS.TrackEntry) return;
    const t: Partial<MkvTrack> & { type?: number; bcp47?: string; compAlgo?: number; encrypted?: boolean; enabled?: boolean } = {
      isDefault: true, isForced: false, language: "eng", name: "", channels: 2, sampleRate: 8000, enabled: true,
    };
    eachChild(buf, entry.dataStart, entry.dataStart + entry.size, (c) => {
      const u = () => readUintBytes(buf, c.dataStart, c.size);
      switch (c.id) {
        case EBML_IDS.TrackNumber: t.number = u(); break;
        case EBML_IDS.TrackType: t.type = u(); break;
        case EBML_IDS.CodecID: t.codecId = readStringBytes(buf, c.dataStart, c.size); break;
        case EBML_IDS.CodecPrivate: t.codecPrivate = buf.slice(c.dataStart, c.dataStart + c.size); break;
        case EBML_IDS.Language: t.language = readStringBytes(buf, c.dataStart, c.size) || "eng"; break;
        case EBML_IDS.LanguageBCP47: t.bcp47 = readStringBytes(buf, c.dataStart, c.size); break;
        case EBML_IDS.Name: t.name = readUtf8Bytes(buf, c.dataStart, c.size); break;
        case EBML_IDS.FlagDefault: t.isDefault = u() === 1; break;
        case EBML_IDS.FlagForced: t.isForced = u() === 1; break;
        case EBML_IDS.FlagEnabled: t.enabled = u() !== 0; break;
        case EBML_IDS.DefaultDuration: t.defaultDurationNs = u(); break;
        case EBML_IDS.CodecDelay: t.codecDelayNs = u(); break;
        case EBML_IDS.SeekPreRoll: t.seekPreRollNs = u(); break;
        case EBML_IDS.Audio:
          eachChild(buf, c.dataStart, c.dataStart + c.size, (a) => {
            if (a.id === EBML_IDS.SamplingFrequency) t.sampleRate = readFloatBytes(buf, a.dataStart, a.size) || t.sampleRate;
            if (a.id === EBML_IDS.Channels) t.channels = readUintBytes(buf, a.dataStart, a.size) || t.channels;
            if (a.id === EBML_IDS.BitDepth) t.bitDepth = readUintBytes(buf, a.dataStart, a.size);
          });
          break;
        case EBML_IDS.Video:
          eachChild(buf, c.dataStart, c.dataStart + c.size, (v) => {
            if (v.id === EBML_IDS.PixelWidth) t.width = readUintBytes(buf, v.dataStart, v.size);
            if (v.id === EBML_IDS.PixelHeight) t.height = readUintBytes(buf, v.dataStart, v.size);
          });
          break;
        case EBML_IDS.ContentEncodings:
          eachChild(buf, c.dataStart, c.dataStart + c.size, (enc) => {
            if (enc.id !== EBML_IDS.ContentEncoding) return;
            eachChild(buf, enc.dataStart, enc.dataStart + enc.size, (x) => {
              if (x.id === EBML_IDS.ContentEncryption) t.encrypted = true;
              if (x.id !== EBML_IDS.ContentCompression) return;
              t.compAlgo = 0; // spec default = zlib
              eachChild(buf, x.dataStart, x.dataStart + x.size, (cc) => {
                if (cc.id === EBML_IDS.ContentCompAlgo) t.compAlgo = readUintBytes(buf, cc.dataStart, cc.size);
                if (cc.id === EBML_IDS.ContentCompSettings) t.stripPrefix = buf.slice(cc.dataStart, cc.dataStart + cc.size);
              });
            });
          });
          break;
        default: break;
      }
    });
    if (!t.number || !t.codecId || t.enabled === false) return;
    const kind: TrackKind | null = t.type === 1 ? "video" : t.type === 2 ? "audio" : t.type === 17 ? "subtitle" : null;
    if (!kind) return;
    const language = t.bcp47 || t.language || "und";
    const hasCompression = t.compAlgo !== undefined;
    const zlib = hasCompression && t.compAlgo === 0;
    const unusableCompression = t.encrypted || (hasCompression && t.compAlgo !== 3 && !(zlib && kind === "subtitle"));
    if (t.compAlgo !== 3) t.stripPrefix = undefined;
    const route = unusableCompression ? null : routeFor(kind, t.codecId, hasCompression && !zlib);
    const index = kind === "audio" ? audio.length : subtitles.length;
    const track: MkvTrack = {
      number: t.number, kind, codecId: t.codecId, codec: codecName(t.codecId), language, name: t.name || "",
      label: buildTrackLabel(kind, language, t.name || "", index), // display = language only
      isDefault: !!t.isDefault, isForced: !!t.isForced, route,
      channels: t.channels, sampleRate: t.sampleRate, bitDepth: t.bitDepth, width: t.width, height: t.height,
      codecPrivate: t.codecPrivate, defaultDurationNs: t.defaultDurationNs, codecDelayNs: t.codecDelayNs,
      seekPreRollNs: t.seekPreRollNs, stripPrefix: t.stripPrefix, zlib: zlib || undefined,
    };
    if (kind === "video") { if (!video || (!video.route && route)) video = track; }
    else if (kind === "audio") audio.push(track);
    else subtitles.push(track);
  });
  // Make duplicate labels distinguishable ("English", "English · 5.1").
  const dedupe = (list: MkvTrack[]) => {
    const seen = new Map<string, number>();
    list.forEach((track) => {
      const n = (seen.get(track.label) || 0) + 1;
      seen.set(track.label, n);
      if (n > 1) {
        track.label = `${track.label} ${n}`;
      }
    });
  };
  dedupe(audio);
  dedupe(subtitles);
  return { video, audio, subtitles };
}

/** Read the Matroska header (EBML → Segment → SeekHead/Info/Tracks). */
export async function parseMkvHeader(src: RangeSource): Promise<MkvHeader> {
  let head = await src.read(0, 256 * 1024);
  const ebml = readElementHeader(head, 0);
  if (!ebml || ebml.id !== EBML_IDS.EBML) throw new Error("not a matroska file");
  const segment = readElementHeader(head, ebml.dataStart + ebml.size);
  if (!segment || segment.id !== EBML_IDS.Segment) throw new Error("segment missing");
  const segmentStart = segment.dataStart;

  let tracksRange: { buf: Uint8Array; start: number; end: number } | null = null;
  let infoRange: { buf: Uint8Array; start: number; end: number } | null = null;
  let cuesPos = -1;
  let tracksPos = -1;
  let infoPos = -1;
  let firstCluster = -1;

  const scan = (buf: Uint8Array, offset: number, from: number) => {
    let cursor = from - offset;
    while (cursor < buf.length) {
      const el = readElementHeader(buf, cursor);
      if (!el) break;
      if (el.id === EBML_IDS.Cluster) { if (firstCluster < 0) firstCluster = cursor + offset; break; }
      const dataEnd = el.dataStart + el.size;
      if (el.unknownSize || dataEnd > buf.length) {
        if (el.id === EBML_IDS.Tracks && tracksPos < 0) tracksPos = cursor + offset;
        if (el.id === EBML_IDS.Info && infoPos < 0) infoPos = cursor + offset;
        break;
      }
      if (el.id === EBML_IDS.Tracks) tracksRange = { buf, start: el.dataStart, end: dataEnd };
      else if (el.id === EBML_IDS.Info) infoRange = { buf, start: el.dataStart, end: dataEnd };
      else if (el.id === EBML_IDS.SeekHead) {
        eachChild(buf, el.dataStart, dataEnd, (seek) => {
          if (seek.id !== EBML_IDS.Seek) return;
          let id = 0; let pos = -1;
          eachChild(buf, seek.dataStart, seek.dataStart + seek.size, (c) => {
            if (c.id === EBML_IDS.SeekID) id = readUintBytes(buf, c.dataStart, c.size);
            if (c.id === EBML_IDS.SeekPosition) pos = readUintBytes(buf, c.dataStart, c.size);
          });
          if (pos < 0) return;
          if (id === EBML_IDS.Cues) cuesPos = segmentStart + pos;
          if (id === EBML_IDS.Tracks && tracksPos < 0) tracksPos = segmentStart + pos;
          if (id === EBML_IDS.Info && infoPos < 0) infoPos = segmentStart + pos;
        });
      }
      cursor = dataEnd;
    }
  };
  scan(head, 0, segmentStart);

  const readElementAt = async (pos: number) => {
    const probe = await src.read(pos, 64);
    const el = readElementHeader(probe, 0);
    if (!el || el.unknownSize) return null;
    const total = el.headerSize + el.size;
    const body = total <= probe.length ? probe : await src.read(pos, total);
    return { buf: body, start: el.headerSize, end: Math.min(body.length, total), id: el.id };
  };
  if (!tracksRange && tracksPos >= 0) {
    const r = await readElementAt(tracksPos);
    if (r?.id === EBML_IDS.Tracks) tracksRange = r;
  }
  if (!infoRange && infoPos >= 0) {
    const r = await readElementAt(infoPos);
    if (r?.id === EBML_IDS.Info) infoRange = r;
  }
  if (!tracksRange) {
    head = await src.read(0, 4 * 1024 * 1024);
    scan(head, 0, segmentStart);
  }
  if (!tracksRange) throw new Error("tracks not found");

  let timecodeScale = 1_000_000;
  let durationMs = 0;
  if (infoRange) {
    const { buf, start, end } = infoRange as { buf: Uint8Array; start: number; end: number };
    let rawDuration = 0;
    eachChild(buf, start, end, (c) => {
      if (c.id === EBML_IDS.TimecodeScale) timecodeScale = readUintBytes(buf, c.dataStart, c.size) || 1_000_000;
      if (c.id === EBML_IDS.Duration) rawDuration = readFloatBytes(buf, c.dataStart, c.size);
    });
    durationMs = (rawDuration * timecodeScale) / 1_000_000;
  }
  const { buf, start, end } = tracksRange as { buf: Uint8Array; start: number; end: number };
  const tracks = parseTracks(buf, start, end);
  return {
    timecodeScale, durationMs, segmentStart,
    firstClusterPos: firstCluster >= 0 ? firstCluster : -1,
    cuesPos, ...tracks,
  };
}

export async function loadMkvCues(src: RangeSource, header: MkvHeader): Promise<MkvCue[]> {
  if (header.cuesPos < 0) return [];
  const probe = await src.read(header.cuesPos, 64);
  const el = readElementHeader(probe, 0);
  if (!el || el.id !== EBML_IDS.Cues || el.unknownSize || !el.size || el.size > 16 * 1024 * 1024) return [];
  const body = await src.read(header.cuesPos, el.headerSize + el.size);
  const videoNumber = header.video?.number;
  const cues: MkvCue[] = [];
  eachChild(body, el.headerSize, Math.min(body.length, el.headerSize + el.size), (point) => {
    if (point.id !== EBML_IDS.CuePoint) return;
    let time = -1; let pos = -1; let anyPos = -1;
    eachChild(body, point.dataStart, point.dataStart + point.size, (c) => {
      if (c.id === EBML_IDS.CueTime) time = readUintBytes(body, c.dataStart, c.size);
      if (c.id === EBML_IDS.CueTrackPositions) {
        let track = 0; let cluster = -1;
        eachChild(body, c.dataStart, c.dataStart + c.size, (leaf) => {
          if (leaf.id === EBML_IDS.CueTrack) track = readUintBytes(body, leaf.dataStart, leaf.size);
          if (leaf.id === EBML_IDS.CueClusterPosition) cluster = readUintBytes(body, leaf.dataStart, leaf.size);
        });
        if (cluster >= 0 && anyPos < 0) anyPos = cluster;
        if (cluster >= 0 && (!videoNumber || track === videoNumber)) pos = cluster;
      }
    });
    const finalPos = pos >= 0 ? pos : anyPos;
    if (time >= 0 && finalPos >= 0) cues.push({ timeTicks: time, pos: header.segmentStart + finalPos });
  });
  cues.sort((a, b) => a.timeTicks - b.timeTicks);
  return cues;
}

// ------------------------------------------------------------------
// Block stream
// ------------------------------------------------------------------

export interface MkvBlock {
  track: number;
  ptsTicks: number;
  durationTicks: number;
  isKey: boolean;
  /** Original flags byte (SimpleBlock flags, or lacing bits for Block). */
  flags: number;
  /** Bytes after the flags byte (lace header + frames), verbatim. */
  payload: Uint8Array;
  /** Individual frames (lacing resolved). */
  frames: Uint8Array[];
}

/** Sliding window over a RangeSource with large sequential reads. */
export class WindowReader {
  private buf = new Uint8Array(0);
  private bufStart: number;
  pos: number;
  eof = false;
  constructor(private readonly src: RangeSource, start: number, private readonly chunk = 1 << 20) {
    this.pos = start;
    this.bufStart = start;
  }
  get available() { return this.bufStart + this.buf.length - this.pos; }
  async ensure(bytes: number): Promise<boolean> {
    while (this.available < bytes) {
      if (this.eof) return false;
      // Cursor jumped past the buffered window (skipped a large block):
      // restart the window there instead of downloading the gap.
      if (this.pos > this.bufStart + this.buf.length) { this.buf = new Uint8Array(0); this.bufStart = this.pos; }
      const kept = this.buf.subarray(this.pos - this.bufStart);
      const next = this.bufStart + this.buf.length;
      const data = await this.src.read(next, Math.max(this.chunk, bytes - this.available));
      if (!data.length) { this.eof = true; return this.available >= bytes; }
      const merged = new Uint8Array(kept.length + data.length);
      merged.set(kept, 0);
      merged.set(data, kept.length);
      this.buf = merged;
      this.bufStart = this.pos;
    }
    return true;
  }
  view() { return { buf: this.buf, offset: this.pos - this.bufStart }; }
  skip(n: number) { this.pos += n; }
}

const splitLaces = (buf: Uint8Array, pos: number, end: number, lacing: number): Uint8Array[] | null => {
  if (lacing === 0) return [buf.subarray(pos, end)];
  const count = buf[pos] + 1;
  pos += 1;
  const sizes: number[] = [];
  if (lacing === 2) {
    const each = Math.floor((end - pos) / count);
    for (let i = 0; i < count; i += 1) sizes.push(each);
  } else if (lacing === 1) {
    for (let i = 0; i < count - 1; i += 1) {
      let v = 0;
      while (pos < end) { const b = buf[pos++]; v += b; if (b !== 255) break; }
      sizes.push(v);
    }
  } else {
    const first = readVint(buf, pos);
    if (!first) return null;
    pos += first.length;
    sizes.push(first.value);
    for (let i = 1; i < count - 1; i += 1) {
      const d = readSignedVint(buf, pos);
      if (!d) return null;
      pos += d.length;
      sizes.push(sizes[sizes.length - 1] + d.value);
    }
  }
  if (lacing !== 2) {
    const used = sizes.reduce((a, b) => a + b, 0);
    sizes.push(end - pos - used);
  }
  const frames: Uint8Array[] = [];
  for (const size of sizes) {
    if (size < 0 || pos + size > end) return null;
    frames.push(buf.subarray(pos, pos + size));
    pos += size;
  }
  return frames;
};

const MASTER_INSIDE_CLUSTER = new Set<number>([EBML_IDS.Cluster]);

/**
 * Stream blocks from `startPos` (a cluster boundary). `wanted` filters tracks;
 * blocks of other tracks are skipped without copying.
 */
export class MkvBlockStream {
  private reader: WindowReader;
  private clusterTicks = 0;
  /** Optional soft stop: next() returns null with `paused` set once a cluster starts past this tick. */
  pauseAtTicks = -1;
  paused = false;
  constructor(src: RangeSource, startPos: number, private readonly wanted: Set<number>, chunk = 1 << 20) {
    this.reader = new WindowReader(src, startPos, chunk);
  }
  get position() { return this.reader.pos; }
  get currentClusterTicks() { return this.clusterTicks; }

  /** Next wanted block, or null at end of file. */
  async next(): Promise<MkvBlock | null> {
    const r = this.reader;
    this.paused = false;
    for (;;) {
      if (!(await r.ensure(12)) && r.available < 2) return null;
      const { buf, offset } = r.view();
      const el = readElementHeader(buf, offset);
      if (!el) { if (r.available < 12) return null; r.skip(1); continue; }
      if (MASTER_INSIDE_CLUSTER.has(el.id)) { r.skip(el.headerSize); continue; }
      if (el.id === EBML_IDS.Segment) { r.skip(el.headerSize); continue; }
      if (el.unknownSize) { r.skip(el.headerSize); continue; }
      const total = el.headerSize + el.size;
      if (el.id === EBML_IDS.Timecode) {
        if (!(await r.ensure(total))) return null;
        const v = r.view();
        this.clusterTicks = readUintBytes(v.buf, v.offset + el.headerSize, el.size);
        r.skip(total);
        if (this.pauseAtTicks >= 0 && this.clusterTicks > this.pauseAtTicks) { this.paused = true; return null; }
        continue;
      }
      if (el.id === EBML_IDS.SimpleBlock || el.id === EBML_IDS.BlockGroup) {
        if (el.size > 64 * 1024 * 1024) { r.skip(total); continue; }
        // Peek the track number before buffering the whole block.
        if (!(await r.ensure(el.headerSize + 9))) return null;
        let v = r.view();
        let blockStart = v.offset + el.headerSize;
        if (el.id === EBML_IDS.BlockGroup) {
          const inner = readElementHeader(v.buf, blockStart);
          if (inner && inner.id === EBML_IDS.Block) blockStart = inner.dataStart;
        }
        const trackPeek = readVint(v.buf, blockStart);
        if (!trackPeek || !this.wanted.has(trackPeek.value)) { r.skip(total); continue; }
        if (!(await r.ensure(total))) return null;
        v = r.view();
        const block = this.decode(v.buf, v.offset, el.id === EBML_IDS.SimpleBlock, el.headerSize, total);
        r.skip(total);
        if (block) return block;
        continue;
      }
      // Cues, Tags, Chapters, Void, CRC … — skip.
      r.skip(Math.max(1, total));
    }
  }

  private decode(buf: Uint8Array, at: number, simple: boolean, headerSize: number, total: number): MkvBlock | null {
    let start = at + headerSize;
    let size = total - headerSize;
    let durationTicks = 0;
    let hasReference = false;
    if (!simple) {
      let found = false;
      eachChild(buf, at + headerSize, at + total, (c) => {
        if (c.id === EBML_IDS.Block) { start = c.dataStart; size = c.size; found = true; }
        else if (c.id === EBML_IDS.BlockDuration) durationTicks = readUintBytes(buf, c.dataStart, c.size);
        else if (c.id === 0xfb) hasReference = true; // ReferenceBlock
      });
      if (!found) return null;
    }
    const track = readVint(buf, start);
    if (!track) return null;
    let pos = start + track.length;
    const end = start + size;
    if (pos + 3 > end) return null;
    const rel = (((buf[pos] << 8) | buf[pos + 1]) << 16) >> 16;
    const flags = buf[pos + 2];
    pos += 3;
    const frames = splitLaces(buf, pos, end, (flags >> 1) & 0x03);
    if (!frames) return null;
    return {
      track: track.value,
      ptsTicks: this.clusterTicks + rel,
      durationTicks,
      isKey: simple ? (flags & 0x80) !== 0 : !hasReference,
      flags,
      payload: buf.slice(pos, end),
      frames: frames.map((f) => f.slice()),
    };
  }
}

/** Strip ASS/SSA override tags and dialogue fields to plain caption text. */
export const assToText = (raw: string): string => {
  const parts = raw.split(",");
  // Matroska ASS block: ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
  const body = parts.length >= 9 ? parts.slice(8).join(",") : raw;
  return body
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\N/g, "\n").replace(/\\n/g, "\n").replace(/\\h/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
};

export const subtitleBlockText = (track: MkvTrack, frame: Uint8Array): string => {
  const raw = readUtf8Bytes(frame, 0, frame.length);
  if (/ASS|SSA/i.test(track.codecId)) {
    // Drawing commands (\p1) render as garbage text — drop them.
    if (/\\p[1-9]/.test(raw)) return "";
    return assToText(raw);
  }
  return raw.replace(/<[^>]+>/g, "").trim();
};

export const isMatroskaMagic = (bytes: Uint8Array) =>
  bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;

export const isPgsTrack = (track: MkvTrack) => /^S_HDMV\/PGS$/i.test(track.codecId);

/** Undo zlib (ContentCompAlgo 0) or header stripping for one frame. */
export async function unpackFrame(track: MkvTrack, frame: Uint8Array): Promise<Uint8Array> {
  if (track.stripPrefix?.length) {
    const out = new Uint8Array(track.stripPrefix.length + frame.length);
    out.set(track.stripPrefix, 0);
    out.set(frame, track.stripPrefix.length);
    return out;
  }
  if (!track.zlib) return frame;
  const DS = (globalThis as any).DecompressionStream;
  if (!DS) throw new Error("zlib not supported");
  const stream = new Blob([frame as unknown as BlobPart]).stream().pipeThrough(new DS("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
