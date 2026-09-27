// ============================================================
// In-browser MKV engine — multi audio track playback
// ============================================================
// Why this exists:
//   Browsers can play a Matroska (.mkv) file through <video src>, but they
//   only ever decode the FIRST audio track and expose no switching API. Our RS
//   mirrors serve thousands of .mkv episodes that carry Hindi / English /
//   Japanese audio in one file (MX Player can switch, the browser cannot).
//
// What it does:
//   * Range-reads the file in small chunks (works through video-proxy, which
//     already exposes content-range + CORS).
//   * Demuxes Matroska: video track + the SELECTED audio track + text subs.
//   * Remuxes both to fragmented MP4 and feeds Media Source Extensions with
//     one SourceBuffer per track, so audio can be swapped on demand.
//   * Any failure (unsupported codec, CORS, parse error) reports back so the
//     player falls straight back to normal native playback — never a black
//     screen.

import {
  EBML_IDS,
  eachChild,
  readElementHeader,
  readFloatBytes,
  readSignedVint,
  readUintBytes,
  readUtf8Bytes,
  readStringBytes,
  readVint,
} from "./ebml";
import { buildFragment, buildInitSegment, type AudioTrackConfig, type Mp4Sample, type VideoTrackConfig } from "./mp4Writer";

export interface MkvTrackInfo {
  number: number;
  kind: "video" | "audio" | "subtitle";
  codecId: string;
  language: string;
  label: string;
  isDefault: boolean;
  supported: boolean;
  channels?: number;
  sampleRate?: number;
  width?: number;
  height?: number;
  codecPrivate?: Uint8Array;
  defaultDurationNs?: number;
}

export interface MkvProbeResult {
  ok: boolean;
  reason?: string;
  audio: MkvTrackInfo[];
  subtitles: MkvTrackInfo[];
  video: MkvTrackInfo | null;
  durationMs: number;
}

export interface MkvSubtitleCue {
  trackNumber: number;
  startMs: number;
  endMs: number;
  text: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  hin: "Hindi", hi: "Hindi",
  eng: "English", en: "English",
  jpn: "Japanese", ja: "Japanese", jp: "Japanese",
  ben: "Bengali", bn: "Bengali",
  tam: "Tamil", ta: "Tamil",
  tel: "Telugu", te: "Telugu",
  mal: "Malayalam", ml: "Malayalam",
  kan: "Kannada", kn: "Kannada",
  mar: "Marathi", mr: "Marathi",
  urd: "Urdu", ur: "Urdu",
  spa: "Spanish", es: "Spanish",
  fre: "French", fra: "French", fr: "French",
  ger: "German", deu: "German", de: "German",
  por: "Portuguese", pt: "Portuguese",
  kor: "Korean", ko: "Korean",
  chi: "Chinese", zho: "Chinese", zh: "Chinese",
  ara: "Arabic", ar: "Arabic",
  rus: "Russian", ru: "Russian",
  ind: "Indonesian", id: "Indonesian",
  tha: "Thai", th: "Thai",
  vie: "Vietnamese", vi: "Vietnamese",
  mul: "Multi Audio",
  und: "Audio",
};

export const languageLabel = (code: string, fallback: string): string => {
  const key = String(code || "").toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_NAMES[key] || LANGUAGE_NAMES[String(code || "").toLowerCase()] || fallback;
};

/** Matroska files (direct or wrapped in a proxy `?url=` parameter). */
export const isLikelyMatroskaUrl = (url: string): boolean => {
  const raw = String(url || "");
  if (!raw) return false;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* keep raw */ }
  return /\.mkv(?:$|[?#&])/i.test(decoded) || /\.mkv/i.test(decoded);
};

export const canRunMkvEngine = (): boolean => {
  if (typeof window === "undefined") return false;
  const MS: any = (window as any).MediaSource;
  if (!MS || typeof MS.isTypeSupported !== "function") return false;
  return MS.isTypeSupported('video/mp4; codecs="avc1.640029"');
};

const AAC_CODECS = /^A_AAC/i;
const AVC_CODEC = /^V_MPEG4\/ISO\/AVC$/i;
const HEVC_CODEC = /^V_MPEGH\/ISO\/HEVC$/i;
const TEXT_SUB = /^S_TEXT\/(UTF8|ASS|SSA)$/i;

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

const buildAudioSpecificConfig = (sampleRate: number, channels: number): Uint8Array => {
  const rateIndex = Math.max(0, AAC_RATES.indexOf(Math.round(sampleRate)));
  const chan = Math.min(7, Math.max(1, channels || 2));
  const objectType = 2; // AAC-LC
  const byte0 = (objectType << 3) | ((rateIndex >> 1) & 0x07);
  const byte1 = ((rateIndex & 0x01) << 7) | ((chan & 0x0f) << 3);
  return new Uint8Array([byte0, byte1]);
};

const audioCodecString = (asc?: Uint8Array): string => {
  if (!asc || asc.length < 1) return "mp4a.40.2";
  const objectType = (asc[0] >> 3) & 0x1f;
  return `mp4a.40.${objectType || 2}`;
};

const videoCodecString = (codecId: string, priv?: Uint8Array): string => {
  if (HEVC_CODEC.test(codecId)) return "hvc1.1.6.L93.B0";
  if (!priv || priv.length < 4) return "avc1.640029";
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `avc1.${hex(priv[1])}${hex(priv[2])}${hex(priv[3])}`;
};

const stripAssText = (raw: string): string => {
  const parts = raw.split(",");
  const body = parts.length > 8 ? parts.slice(8).join(",") : raw;
  return body
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\N|\\n/gi, "\n")
    .replace(/\\h/gi, " ")
    .trim();
};

// ------------------------------------------------------------------
// Byte source — Range reads with a tiny read-ahead cache
// ------------------------------------------------------------------

class ByteSource {
  total = -1;
  private aborted = false;
  private controllers = new Set<AbortController>();

  constructor(private readonly url: string) {}

  abort(): void {
    this.aborted = true;
    for (const controller of this.controllers) {
      try { controller.abort(); } catch { /* ignore */ }
    }
    this.controllers.clear();
  }

  async read(start: number, length: number): Promise<Uint8Array> {
    if (this.aborted) throw new Error("aborted");
    if (this.total >= 0 && start >= this.total) return new Uint8Array(0);
    const end = this.total >= 0 ? Math.min(this.total - 1, start + length - 1) : start + length - 1;
    if (end < start) return new Uint8Array(0);
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const res = await fetch(this.url, {
        headers: { Range: `bytes=${start}-${end}` },
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 416) {
        this.total = start;
        return new Uint8Array(0);
      }
      if (!res.ok) throw new Error(`range ${start}-${end} failed (${res.status})`);
      if (res.headers.get("x-rs-proxy-fallback") === "1") throw new Error("proxy fallback");
      const contentRange = res.headers.get("content-range") || "";
      const match = contentRange.match(/\/(\d+)\s*$/);
      if (match) this.total = Number(match[1]);
      else if (res.status === 200) this.total = Number(res.headers.get("content-length") || -1);
      const buffer = await res.arrayBuffer();
      return new Uint8Array(buffer);
    } finally {
      this.controllers.delete(controller);
    }
  }
}

// Sliding window reader over the byte source.
class WindowReader {
  private buf = new Uint8Array(0);
  private bufStart = 0;
  pos = 0;
  eof = false;

  constructor(private readonly source: ByteSource, startPos: number, private readonly chunkSize = 1 << 20) {
    this.pos = startPos;
    this.bufStart = startPos;
  }

  get available(): number {
    return this.bufStart + this.buf.length - this.pos;
  }

  private trim(): void {
    const consumed = this.pos - this.bufStart;
    if (consumed > 4 << 20) {
      this.buf = this.buf.subarray(consumed);
      this.bufStart = this.pos;
    }
  }

  async ensure(bytes: number): Promise<boolean> {
    while (this.available < bytes) {
      if (this.eof) return false;
      const nextStart = this.bufStart + this.buf.length;
      const wanted = Math.max(this.chunkSize, bytes - this.available);
      const chunk = await this.source.read(nextStart, wanted);
      if (!chunk.length) {
        this.eof = true;
        return this.available >= bytes;
      }
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf, 0);
      merged.set(chunk, this.buf.length);
      this.buf = merged;
    }
    this.trim();
    return true;
  }

  /** View starting at the current cursor (only valid up to `available`). */
  view(): { buf: Uint8Array; offset: number } {
    return { buf: this.buf, offset: this.pos - this.bufStart };
  }

  skip(bytes: number): void {
    this.pos += bytes;
    this.trim();
  }

  async takeBytes(bytes: number): Promise<Uint8Array | null> {
    if (!(await this.ensure(bytes))) return null;
    const { buf, offset } = this.view();
    const out = buf.slice(offset, offset + bytes);
    this.skip(bytes);
    return out;
  }
}

// ------------------------------------------------------------------
// Append queue — one serialized writer per SourceBuffer
// ------------------------------------------------------------------

class BufferWriter {
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly sb: SourceBuffer, private readonly onFatal: (error: unknown) => void) {}

  private wait(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.sb.updating) { resolve(); return; }
      const done = () => {
        this.sb.removeEventListener("updateend", done);
        this.sb.removeEventListener("error", done);
        resolve();
      };
      this.sb.addEventListener("updateend", done);
      this.sb.addEventListener("error", done);
    });
  }

  append(data: Uint8Array, evict?: () => { start: number; end: number } | null): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        await this.wait();
        try {
          this.sb.appendBuffer(data as unknown as BufferSource);
        } catch (error: any) {
          if (error?.name === "QuotaExceededError" && evict) {
            const range = evict();
            if (range && range.end > range.start) {
              try { this.sb.remove(range.start, range.end); } catch { /* ignore */ }
              await this.wait();
            }
            try {
              this.sb.appendBuffer(data as unknown as BufferSource);
            } catch (inner) {
              this.onFatal(inner);
              return;
            }
          } else {
            this.onFatal(error);
            return;
          }
        }
        await this.wait();
      })
      .catch((error) => { this.onFatal(error); });
    return this.queue;
  }

  async clear(): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        await this.wait();
        try { if (this.sb.buffered.length) this.sb.remove(0, Infinity); } catch { /* ignore */ }
        await this.wait();
      })
      .catch(() => undefined);
    return this.queue;
  }
}

interface PendingSample {
  data: Uint8Array;
  ptsTicks: number;
  isKey: boolean;
}

export interface MkvEngineOptions {
  onError?: (error: Error) => void;
  onSubtitleCue?: (cue: MkvSubtitleCue) => void;
  onStateChange?: (state: "loading" | "ready" | "buffering" | "ended") => void;
  /** Seconds of media kept ahead of playback before the reader pauses. */
  readAheadSeconds?: number;
}

export class MkvMultiAudioEngine {
  private source: ByteSource;
  private mediaSource: MediaSource | null = null;
  private objectUrl = "";
  private video: HTMLVideoElement | null = null;
  private videoWriter: BufferWriter | null = null;
  private audioWriter: BufferWriter | null = null;
  private generation = 0;
  private destroyed = false;
  private timecodeScale = 1_000_000;
  private segmentStart = 0;
  private firstClusterPos = 0;
  private cues: Array<{ timeTicks: number; pos: number }> = [];
  private videoTrack: MkvTrackInfo | null = null;
  private audioTracks: MkvTrackInfo[] = [];
  private subtitleTracks: MkvTrackInfo[] = [];
  private selectedAudio = 0;
  private durationMs = 0;
  private fragmentSeq = 1;
  private readerRunning = false;
  private failed = false;

  constructor(private readonly url: string, private readonly opts: MkvEngineOptions = {}) {
    this.source = new ByteSource(url);
  }

  get tracks(): { video: MkvTrackInfo | null; audio: MkvTrackInfo[]; subtitles: MkvTrackInfo[] } {
    return { video: this.videoTrack, audio: this.audioTracks, subtitles: this.subtitleTracks };
  }

  get selectedAudioNumber(): number {
    return this.selectedAudio;
  }

  private get timescale(): number {
    return Math.round(1_000_000_000 / this.timecodeScale) || 1000;
  }

  private ticksToSeconds(ticks: number): number {
    return (ticks * this.timecodeScale) / 1_000_000_000;
  }

  private fail(message: string): void {
    if (this.failed) return;
    this.failed = true;
    this.opts.onError?.(new Error(message));
  }

  // ----------------------------------------------------------------
  // Header parsing
  // ----------------------------------------------------------------

  async probe(): Promise<MkvProbeResult> {
    const empty: MkvProbeResult = { ok: false, audio: [], subtitles: [], video: null, durationMs: 0 };
    try {
      let head = await this.source.read(0, 512 * 1024);
      if (head.length < 64) return { ...empty, reason: "empty response" };
      const ebml = readElementHeader(head, 0);
      if (!ebml || ebml.id !== EBML_IDS.EBML) return { ...empty, reason: "not a matroska file" };
      let pos = ebml.dataStart + ebml.size;
      const segment = readElementHeader(head, pos);
      if (!segment || segment.id !== EBML_IDS.Segment) return { ...empty, reason: "segment missing" };
      this.segmentStart = segment.dataStart;

      let tracksEl: { start: number; end: number } | null = null;
      let infoEl: { start: number; end: number } | null = null;
      let cuesPos = -1;
      let tracksSeekPos = -1;
      let firstCluster = -1;

      const scanTopLevel = (buf: Uint8Array) => {
        let cursor = this.segmentStart;
        while (cursor < buf.length) {
          const el = readElementHeader(buf, cursor);
          if (!el) break;
          const dataEnd = el.dataStart + el.size;
          if (el.id === EBML_IDS.Cluster) { if (firstCluster < 0) firstCluster = cursor; break; }
          if (dataEnd > buf.length) break;
          if (el.id === EBML_IDS.Tracks) tracksEl = { start: el.dataStart, end: dataEnd };
          if (el.id === EBML_IDS.Info) infoEl = { start: el.dataStart, end: dataEnd };
          if (el.id === EBML_IDS.SeekHead) {
            eachChild(buf, el.dataStart, dataEnd, (seek) => {
              if (seek.id !== EBML_IDS.Seek) return;
              let seekId = 0;
              let seekPos = -1;
              eachChild(buf, seek.dataStart, seek.dataStart + seek.size, (child) => {
                if (child.id === EBML_IDS.SeekID) seekId = readUintBytes(buf, child.dataStart, child.size);
                if (child.id === EBML_IDS.SeekPosition) seekPos = readUintBytes(buf, child.dataStart, child.size);
              });
              if (seekId === EBML_IDS.Cues && seekPos >= 0) cuesPos = this.segmentStart + seekPos;
              if (seekId === EBML_IDS.Tracks && seekPos >= 0) tracksSeekPos = this.segmentStart + seekPos;
            });
          }
          cursor = dataEnd;
        }
      };

      scanTopLevel(head);
      if (!tracksEl && tracksSeekPos >= 0) {
        const extra = await this.source.read(tracksSeekPos, 512 * 1024);
        const el = readElementHeader(extra, 0);
        if (el && el.id === EBML_IDS.Tracks && el.dataStart + el.size <= extra.length) {
          head = extra;
          tracksEl = { start: el.dataStart, end: el.dataStart + el.size };
        }
      }
      if (!tracksEl) {
        const bigger = await this.source.read(0, 4 * 1024 * 1024);
        if (bigger.length > head.length) { head = bigger; scanTopLevel(head); }
      }
      if (!tracksEl) return { ...empty, reason: "tracks element not found" };

      if (infoEl) {
        eachChild(head, infoEl.start, infoEl.end, (child) => {
          if (child.id === EBML_IDS.TimecodeScale) this.timecodeScale = readUintBytes(head, child.dataStart, child.size) || 1_000_000;
          if (child.id === EBML_IDS.Duration) {
            const value = readFloatBytes(head, child.dataStart, child.size);
            this.durationMs = (value * this.timecodeScale) / 1_000_000;
          }
        });
      }

      this.parseTracks(head, tracksEl.start, tracksEl.end);

      if (firstCluster < 0) {
        // Clusters start right after the header elements we already walked.
        let cursor = this.segmentStart;
        while (cursor < head.length) {
          const el = readElementHeader(head, cursor);
          if (!el) break;
          if (el.id === EBML_IDS.Cluster) { firstCluster = cursor; break; }
          cursor = el.dataStart + el.size;
          if (el.size <= 0) break;
        }
      }
      this.firstClusterPos = firstCluster >= 0 ? firstCluster : this.segmentStart;

      if (cuesPos >= 0) await this.loadCues(cuesPos);

      return {
        ok: !!this.videoTrack && this.audioTracks.length > 0,
        reason: this.videoTrack ? undefined : "no supported video track",
        audio: this.audioTracks,
        subtitles: this.subtitleTracks,
        video: this.videoTrack,
        durationMs: this.durationMs,
      };
    } catch (error: any) {
      return { ...empty, reason: String(error?.message || error) };
    }
  }

  private parseTracks(buf: Uint8Array, start: number, end: number): void {
    eachChild(buf, start, end, (entry) => {
      if (entry.id !== EBML_IDS.TrackEntry) return;
      let number = 0;
      let type = 0;
      let codecId = "";
      let language = "";
      let bcp47 = "";
      let name = "";
      let isDefault = false;
      let codecPrivate: Uint8Array | undefined;
      let defaultDurationNs: number | undefined;
      let channels = 2;
      let sampleRate = 48000;
      let width = 0;
      let height = 0;

      eachChild(buf, entry.dataStart, entry.dataStart + entry.size, (child) => {
        switch (child.id) {
          case EBML_IDS.TrackNumber: number = readUintBytes(buf, child.dataStart, child.size); break;
          case EBML_IDS.TrackType: type = readUintBytes(buf, child.dataStart, child.size); break;
          case EBML_IDS.CodecID: codecId = readStringBytes(buf, child.dataStart, child.size); break;
          case EBML_IDS.CodecPrivate: codecPrivate = buf.slice(child.dataStart, child.dataStart + child.size); break;
          case EBML_IDS.Language: language = readStringBytes(buf, child.dataStart, child.size); break;
          case EBML_IDS.LanguageBCP47: bcp47 = readStringBytes(buf, child.dataStart, child.size); break;
          case EBML_IDS.Name: name = readUtf8Bytes(buf, child.dataStart, child.size); break;
          case EBML_IDS.FlagDefault: isDefault = readUintBytes(buf, child.dataStart, child.size) === 1; break;
          case EBML_IDS.DefaultDuration: defaultDurationNs = readUintBytes(buf, child.dataStart, child.size); break;
          case EBML_IDS.Audio:
            eachChild(buf, child.dataStart, child.dataStart + child.size, (audio) => {
              if (audio.id === EBML_IDS.SamplingFrequency) sampleRate = readFloatBytes(buf, audio.dataStart, audio.size) || sampleRate;
              if (audio.id === EBML_IDS.OutputSamplingFrequency) sampleRate = readFloatBytes(buf, audio.dataStart, audio.size) || sampleRate;
              if (audio.id === EBML_IDS.Channels) channels = readUintBytes(buf, audio.dataStart, audio.size) || channels;
            });
            break;
          case EBML_IDS.Video:
            eachChild(buf, child.dataStart, child.dataStart + child.size, (vid) => {
              if (vid.id === EBML_IDS.PixelWidth) width = readUintBytes(buf, vid.dataStart, vid.size) || width;
              if (vid.id === EBML_IDS.PixelHeight) height = readUintBytes(buf, vid.dataStart, vid.size) || height;
            });
            break;
          default: break;
        }
      });

      const langCode = bcp47 || language || "und";
      const baseLabel = name || languageLabel(langCode, langCode === "und" ? "Audio" : langCode.toUpperCase());
      if (type === 1) {
        const supported = AVC_CODEC.test(codecId) || HEVC_CODEC.test(codecId);
        const info: MkvTrackInfo = {
          number, kind: "video", codecId, language: langCode, label: baseLabel, isDefault, supported,
          width, height, codecPrivate, defaultDurationNs,
        };
        if (supported && codecPrivate?.length && !this.videoTrack) this.videoTrack = info;
      } else if (type === 2) {
        const supported = AAC_CODECS.test(codecId);
        this.audioTracks.push({
          number, kind: "audio", codecId, language: langCode,
          label: name ? `${languageLabel(langCode, "")} ${name}`.trim() || name : baseLabel,
          isDefault, supported, channels, sampleRate, codecPrivate, defaultDurationNs,
        });
      } else if (type === 17 && TEXT_SUB.test(codecId)) {
        this.subtitleTracks.push({
          number, kind: "subtitle", codecId, language: langCode, label: baseLabel, isDefault, supported: true, codecPrivate,
        });
      }
    });
    this.audioTracks = this.audioTracks.filter((track) => track.supported);
  }

  private async loadCues(cuesPos: number): Promise<void> {
    try {
      const head = await this.source.read(cuesPos, 64);
      const el = readElementHeader(head, 0);
      if (!el || el.id !== EBML_IDS.Cues || !el.size) return;
      const body = await this.source.read(cuesPos, el.headerSize + el.size);
      const cues: Array<{ timeTicks: number; pos: number }> = [];
      eachChild(body, el.headerSize, el.headerSize + el.size, (point) => {
        if (point.id !== EBML_IDS.CuePoint) return;
        let timeTicks = -1;
        let clusterPos = -1;
        eachChild(body, point.dataStart, point.dataStart + point.size, (child) => {
          if (child.id === EBML_IDS.CueTime) timeTicks = readUintBytes(body, child.dataStart, child.size);
          if (child.id === EBML_IDS.CueTrackPositions) {
            eachChild(body, child.dataStart, child.dataStart + child.size, (leaf) => {
              if (leaf.id === EBML_IDS.CueClusterPosition && clusterPos < 0) {
                clusterPos = readUintBytes(body, leaf.dataStart, leaf.size);
              }
            });
          }
        });
        if (timeTicks >= 0 && clusterPos >= 0) cues.push({ timeTicks, pos: this.segmentStart + clusterPos });
      });
      cues.sort((a, b) => a.timeTicks - b.timeTicks);
      this.cues = cues;
    } catch {
      this.cues = [];
    }
  }

  // ----------------------------------------------------------------
  // Attach / playback
  // ----------------------------------------------------------------

  async attach(video: HTMLVideoElement, preferredAudioNumber?: number): Promise<boolean> {
    if (!this.videoTrack || !this.audioTracks.length) return false;
    const audio = this.audioTracks.find((track) => track.number === preferredAudioNumber)
      || this.audioTracks.find((track) => track.isDefault)
      || this.audioTracks[0];
    this.selectedAudio = audio.number;

    const videoMime = `video/mp4; codecs="${videoCodecString(this.videoTrack.codecId, this.videoTrack.codecPrivate)}"`;
    const audioMime = `audio/mp4; codecs="${audioCodecString(audio.codecPrivate?.length ? audio.codecPrivate : undefined)}"`;
    const MS: any = (window as any).MediaSource;
    if (!MS?.isTypeSupported?.(videoMime) || !MS?.isTypeSupported?.(audioMime)) {
      this.fail(`unsupported codecs (${videoMime} / ${audioMime})`);
      return false;
    }

    this.video = video;
    const mediaSource: MediaSource = new MS();
    this.mediaSource = mediaSource;
    this.objectUrl = URL.createObjectURL(mediaSource);
    const opened = new Promise<void>((resolve) => {
      mediaSource.addEventListener("sourceopen", () => resolve(), { once: true });
    });
    video.src = this.objectUrl;
    await opened;
    if (this.destroyed) return false;

    try {
      if (this.durationMs > 0) mediaSource.duration = this.durationMs / 1000;
      const vsb = mediaSource.addSourceBuffer(videoMime);
      const asb = mediaSource.addSourceBuffer(audioMime);
      vsb.mode = "segments";
      asb.mode = "segments";
      this.videoWriter = new BufferWriter(vsb, (error) => this.fail(`video buffer error: ${String((error as any)?.message || error)}`));
      this.audioWriter = new BufferWriter(asb, (error) => this.fail(`audio buffer error: ${String((error as any)?.message || error)}`));
    } catch (error: any) {
      this.fail(`source buffer setup failed: ${String(error?.message || error)}`);
      return false;
    }

    video.addEventListener("seeking", this.onSeeking);
    video.addEventListener("timeupdate", this.onTimeUpdate);
    await this.restart(0, true);
    return true;
  }

  private onSeeking = () => {
    const video = this.video;
    if (!video || this.destroyed) return;
    const time = video.currentTime;
    if (this.isBuffered(time)) return;
    void this.restart(time, true);
  };

  private onTimeUpdate = () => {
    if (!this.readerRunning) void this.pump();
  };

  private isBuffered(time: number): boolean {
    const sb = this.videoWriter?.sb;
    if (!sb) return false;
    for (let i = 0; i < sb.buffered.length; i += 1) {
      if (time >= sb.buffered.start(i) - 0.1 && time < sb.buffered.end(i) - 0.5) return true;
    }
    return false;
  }

  private bufferedAhead(time: number): number {
    const sb = this.videoWriter?.sb;
    if (!sb) return 0;
    for (let i = 0; i < sb.buffered.length; i += 1) {
      if (time >= sb.buffered.start(i) - 0.5 && time <= sb.buffered.end(i)) return sb.buffered.end(i) - time;
    }
    return 0;
  }

  private cuePosForTime(seconds: number): { pos: number; startTicks: number } {
    if (!this.cues.length) return { pos: this.firstClusterPos, startTicks: 0 };
    const targetTicks = (seconds * 1_000_000_000) / this.timecodeScale;
    let chosen = this.cues[0];
    for (const cue of this.cues) {
      if (cue.timeTicks <= targetTicks + 1) chosen = cue;
      else break;
    }
    return { pos: chosen.pos, startTicks: chosen.timeTicks };
  }

  private reader: WindowReader | null = null;
  private readerGeneration = 0;
  private baseSeekSeconds = 0;

  /** Restart demuxing at `seconds`, optionally wiping the existing buffers. */
  private async restart(seconds: number, clearBuffers: boolean): Promise<void> {
    if (this.destroyed || this.failed) return;
    this.generation += 1;
    const generation = this.generation;
    this.opts.onStateChange?.("buffering");
    if (clearBuffers) {
      await Promise.all([this.videoWriter?.clear(), this.audioWriter?.clear()]);
    }
    if (generation !== this.generation || this.destroyed) return;
    const { pos } = this.cuePosForTime(Math.max(0, seconds));
    this.baseSeekSeconds = seconds;
    this.reader = new WindowReader(this.source, pos);
    this.readerGeneration = generation;
    this.initAppended = false;
    await this.pump();
  }

  private initAppended = false;

  private async appendInitSegments(): Promise<void> {
    if (this.initAppended || !this.videoTrack) return;
    const audio = this.audioTracks.find((track) => track.number === this.selectedAudio) || this.audioTracks[0];
    const videoCfg: VideoTrackConfig = {
      kind: "video",
      timescale: this.timescale,
      width: this.videoTrack.width || 1920,
      height: this.videoTrack.height || 1080,
      codecPrivate: this.videoTrack.codecPrivate || new Uint8Array(0),
      codecBox: HEVC_CODEC.test(this.videoTrack.codecId) ? "hvc1" : "avc1",
    };
    const audioCfg: AudioTrackConfig = {
      kind: "audio",
      timescale: this.timescale,
      channels: audio?.channels || 2,
      sampleRate: audio?.sampleRate || 48000,
      sampleSize: 16,
      codecPrivate: audio?.codecPrivate?.length
        ? audio.codecPrivate
        : buildAudioSpecificConfig(audio?.sampleRate || 48000, audio?.channels || 2),
    };
    this.initAppended = true;
    await this.videoWriter?.append(buildInitSegment(videoCfg));
    await this.audioWriter?.append(buildInitSegment(audioCfg));
  }

  /** Read + append until enough media is buffered ahead of playback. */
  private async pump(): Promise<void> {
    if (this.readerRunning || this.destroyed || this.failed) return;
    const reader = this.reader;
    if (!reader) return;
    const generation = this.readerGeneration;
    this.readerRunning = true;
    const readAhead = this.opts.readAheadSeconds ?? 40;

    const videoSamples: PendingSample[] = [];
    const audioSamples: PendingSample[] = [];
    let clusterTicks = 0;

    const flushVideo = async () => {
      if (!videoSamples.length) return;
      const fragment = this.makeFragment(videoSamples, true);
      videoSamples.length = 0;
      if (fragment) await this.videoWriter?.append(fragment, () => this.evictRange());
    };
    const flushAudio = async () => {
      if (!audioSamples.length) return;
      const fragment = this.makeFragment(audioSamples, false);
      audioSamples.length = 0;
      if (fragment) await this.audioWriter?.append(fragment, () => this.evictRange());
    };

    try {
      await this.appendInitSegments();
      while (!this.destroyed && !this.failed && generation === this.generation) {
        const time = this.video?.currentTime ?? this.baseSeekSeconds;
        const ahead = Math.max(this.bufferedAhead(time), this.bufferedAhead(this.baseSeekSeconds));
        if (ahead > readAhead) break;
        if (!(await reader.ensure(12))) {
          await flushVideo();
          await flushAudio();
          if (this.mediaSource?.readyState === "open" && !this.videoWriter?.sb.updating && !this.audioWriter?.sb.updating) {
            try { this.mediaSource.endOfStream(); } catch { /* ignore */ }
          }
          this.opts.onStateChange?.("ended");
          break;
        }
        const { buf, offset } = reader.view();
        const el = readElementHeader(buf, offset);
        if (!el) { reader.skip(1); continue; }

        if (el.id === EBML_IDS.Cluster) {
          reader.skip(el.headerSize);
          continue;
        }
        if (el.id === EBML_IDS.Timecode) {
          if (!(await reader.ensure(el.headerSize + el.size))) break;
          const view = reader.view();
          clusterTicks = readUintBytes(view.buf, view.offset + el.headerSize, el.size);
          reader.skip(el.headerSize + el.size);
          continue;
        }
        if (el.id === EBML_IDS.SimpleBlock || el.id === EBML_IDS.BlockGroup) {
          const total = el.headerSize + el.size;
          if (el.size > 32 * 1024 * 1024 || !(await reader.ensure(total))) { reader.skip(total); continue; }
          const view = reader.view();
          if (el.id === EBML_IDS.SimpleBlock) {
            this.readBlock(view.buf, view.offset + el.headerSize, el.size, clusterTicks, videoSamples, audioSamples, 0, true);
          } else {
            let blockStart = -1;
            let blockSize = 0;
            let blockDurationTicks = 0;
            eachChild(view.buf, view.offset + el.headerSize, view.offset + total, (child) => {
              if (child.id === EBML_IDS.Block) { blockStart = child.dataStart; blockSize = child.size; }
              if (child.id === EBML_IDS.BlockDuration) blockDurationTicks = readUintBytes(view.buf, child.dataStart, child.size);
            });
            if (blockStart >= 0) {
              this.readBlock(view.buf, blockStart, blockSize, clusterTicks, videoSamples, audioSamples, blockDurationTicks, false);
            }
          }
          reader.skip(total);
          if (videoSamples.length >= 90) await flushVideo();
          if (audioSamples.length >= 90) await flushAudio();
          continue;
        }
        // Any other element (Cues, Tags, Void, Chapters …) — skip its payload.
        const total = el.headerSize + (el.unknownSize ? 0 : el.size);
        reader.skip(Math.max(1, total));
      }
      if (generation === this.generation) {
        await flushVideo();
        await flushAudio();
        this.opts.onStateChange?.("ready");
      }
    } catch (error: any) {
      if (!this.destroyed && String(error?.message || "") !== "aborted") {
        this.fail(String(error?.message || error));
      }
    } finally {
      this.readerRunning = false;
    }
  }

  private evictRange(): { start: number; end: number } | null {
    const time = this.video?.currentTime ?? 0;
    const end = Math.max(0, time - 15);
    return end > 1 ? { start: 0, end } : null;
  }

  /** Decode one Block/SimpleBlock into pending samples of the tracks we keep. */
  private readBlock(
    buf: Uint8Array,
    start: number,
    size: number,
    clusterTicks: number,
    videoSamples: PendingSample[],
    audioSamples: PendingSample[],
    blockDurationTicks: number,
    simple: boolean,
  ): void {
    const trackVint = readVint(buf, start);
    if (!trackVint) return;
    let pos = start + trackVint.length;
    if (pos + 3 > start + size) return;
    const relative = ((buf[pos] << 8) | buf[pos + 1]) << 16 >> 16; // int16
    pos += 2;
    const flags = buf[pos];
    pos += 1;
    const trackNumber = trackVint.value;
    const isVideo = this.videoTrack && trackNumber === this.videoTrack.number;
    const isAudio = trackNumber === this.selectedAudio;
    const subtitle = this.subtitleTracks.find((track) => track.number === trackNumber);
    if (!isVideo && !isAudio && !subtitle) return;

    const ptsTicks = clusterTicks + relative;
    const lacing = (flags >> 1) & 0x03;
    const end = start + size;
    const frames: Array<{ start: number; length: number }> = [];

    if (lacing === 0) {
      frames.push({ start: pos, length: end - pos });
    } else {
      const frameCount = buf[pos] + 1;
      pos += 1;
      if (lacing === 2) {
        // fixed-size lacing
        const each = Math.floor((end - pos) / frameCount);
        for (let i = 0; i < frameCount; i += 1) frames.push({ start: pos + i * each, length: each });
      } else if (lacing === 1) {
        // Xiph lacing
        const sizes: number[] = [];
        for (let i = 0; i < frameCount - 1; i += 1) {
          let value = 0;
          while (pos < end) {
            const byte = buf[pos];
            pos += 1;
            value += byte;
            if (byte !== 255) break;
          }
          sizes.push(value);
        }
        let cursor = pos;
        for (const length of sizes) { frames.push({ start: cursor, length }); cursor += length; }
        frames.push({ start: cursor, length: end - cursor });
      } else {
        // EBML lacing
        const first = readVint(buf, pos);
        if (!first) return;
        pos += first.length;
        const sizes = [first.value];
        for (let i = 1; i < frameCount - 1; i += 1) {
          const delta = readSignedVint(buf, pos);
          if (!delta) return;
          pos += delta.length;
          sizes.push(sizes[sizes.length - 1] + delta.value);
        }
        let cursor = pos;
        for (const length of sizes) { frames.push({ start: cursor, length }); cursor += length; }
        frames.push({ start: cursor, length: end - cursor });
      }
    }

    if (subtitle) {
      const frame = frames[0];
      if (!frame || frame.length <= 0) return;
      const text = readUtf8Bytes(buf, frame.start, frame.length);
      const clean = /ASS|SSA/i.test(subtitle.codecId) ? stripAssText(text) : text.trim();
      if (!clean) return;
      const startMs = this.ticksToSeconds(ptsTicks) * 1000;
      const durMs = blockDurationTicks > 0 ? this.ticksToSeconds(blockDurationTicks) * 1000 : 3000;
      this.opts.onSubtitleCue?.({ trackNumber, startMs, endMs: startMs + durMs, text: clean });
      return;
    }

    const isKey = simple ? (flags & 0x80) !== 0 : true;
    const bucket = isVideo ? videoSamples : audioSamples;
    const frameTicks = frames.length > 1 && blockDurationTicks > 0 ? blockDurationTicks / frames.length : 0;
    frames.forEach((frame, index) => {
      if (frame.length <= 0 || frame.start + frame.length > end) return;
      bucket.push({
        data: buf.slice(frame.start, frame.start + frame.length),
        ptsTicks: ptsTicks + Math.round(frameTicks * index),
        isKey: isVideo ? isKey : true,
      });
    });
  }

  private lastVideoEnd = 0;
  private lastAudioEnd = 0;

  /** Turn pending samples into one fMP4 fragment (DTS re-derived for B-frames). */
  private makeFragment(samples: PendingSample[], isVideo: boolean): Uint8Array | null {
    if (!samples.length) return null;
    const ordered = samples.slice();
    const sortedPts = ordered.map((sample) => sample.ptsTicks).sort((a, b) => a - b);
    const defaultTicks = isVideo
      ? Math.max(1, Math.round(((this.videoTrack?.defaultDurationNs || 41_708_333) / this.timecodeScale)))
      : Math.max(1, Math.round(sortedPts.length > 1 ? (sortedPts[sortedPts.length - 1] - sortedPts[0]) / (sortedPts.length - 1) : 21));
    const dts = sortedPts.slice();
    const mp4Samples: Mp4Sample[] = ordered.map((sample, index) => {
      const sampleDts = dts[index];
      const duration = index + 1 < dts.length ? Math.max(1, dts[index + 1] - sampleDts) : defaultTicks;
      return {
        data: sample.data,
        duration,
        cto: sample.ptsTicks - sampleDts,
        isKey: sample.isKey,
      };
    });
    let base = dts[0];
    const lastEnd = isVideo ? this.lastVideoEnd : this.lastAudioEnd;
    if (lastEnd && base < lastEnd && base + defaultTicks > lastEnd) base = lastEnd;
    const totalDuration = mp4Samples.reduce((sum, sample) => sum + sample.duration, 0);
    if (isVideo) this.lastVideoEnd = base + totalDuration;
    else this.lastAudioEnd = base + totalDuration;
    return buildFragment(this.fragmentSeq++, base, mp4Samples, 1);
  }

  /** Switch the active audio language; playback position is preserved. */
  async selectAudio(trackNumber: number): Promise<void> {
    if (this.selectedAudio === trackNumber) return;
    const track = this.audioTracks.find((entry) => entry.number === trackNumber);
    if (!track) return;
    this.selectedAudio = trackNumber;
    const time = this.video?.currentTime ?? 0;
    this.lastVideoEnd = 0;
    this.lastAudioEnd = 0;
    const wasPlaying = this.video ? !this.video.paused : false;
    await this.restart(time, true);
    if (this.video) {
      try { this.video.currentTime = time; } catch { /* ignore */ }
      if (wasPlaying) { try { await this.video.play(); } catch { /* ignore */ } }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.source.abort();
    if (this.video) {
      this.video.removeEventListener("seeking", this.onSeeking);
      this.video.removeEventListener("timeupdate", this.onTimeUpdate);
    }
    try {
      if (this.mediaSource?.readyState === "open") this.mediaSource.endOfStream();
    } catch { /* ignore */ }
    if (this.objectUrl) {
      try { URL.revokeObjectURL(this.objectUrl); } catch { /* ignore */ }
      this.objectUrl = "";
    }
    this.mediaSource = null;
    this.videoWriter = null;
    this.audioWriter = null;
    this.reader = null;
    this.video = null;
  }
}

export const mkvTestHooks = { buildAudioSpecificConfig, audioCodecString, videoCodecString, stripAssText };
