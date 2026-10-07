// ============================================================
// Matroska → MSE remux helpers (pure, testable in Node)
// ============================================================
import type { MkvBlock, MkvHeader, MkvTrack } from "./mkvDemux";
import { buildFragment, buildInitSegment, type Mp4Sample } from "./mp4Writer";
import { buildWebmCluster, buildWebmInit, type WebmBlock } from "./webmWriter";

export const VIDEO_TIMESCALE = 90_000;

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export const buildAudioSpecificConfig = (sampleRate: number, channels: number): Uint8Array => {
  const idx = Math.max(0, AAC_RATES.indexOf(Math.round(sampleRate)));
  const ch = Math.min(7, Math.max(1, channels || 2));
  return new Uint8Array([(2 << 3) | ((idx >> 1) & 0x07), ((idx & 1) << 7) | (ch << 3)]);
};

const hex2 = (v: number) => v.toString(16).padStart(2, "0");

export function videoMime(track: MkvTrack): string {
  if (/HEVC/i.test(track.codecId)) {
    // hvcC: profile_space/tier/profile_idc at byte 1, level at byte 12.
    const p = track.codecPrivate;
    if (p && p.length > 12) {
      const profile = p[1] & 0x1f;
      const tier = (p[1] >> 5) & 0x01 ? "H" : "L";
      return `video/mp4; codecs="hvc1.${profile || 1}.6.${tier}${p[12] || 93}.B0"`;
    }
    return 'video/mp4; codecs="hvc1.1.6.L93.B0"';
  }
  const p = track.codecPrivate;
  const codec = p && p.length >= 4 ? `avc1.${hex2(p[1])}${hex2(p[2])}${hex2(p[3])}` : "avc1.640029";
  return `video/mp4; codecs="${codec}"`;
}

export const isMp3Track = (track: MkvTrack) => /^A_MPEG\/L3$/i.test(track.codecId);
const mp3FrameSamples = (track: MkvTrack) => ((track.sampleRate || 48000) >= 32000 ? 1152 : 576);

export function audioMime(track: MkvTrack): string {
  if (isMp3Track(track)) return 'audio/mp4; codecs="mp4a.6b"';
  if (track.route === "webm") return `audio/webm; codecs="${/OPUS/i.test(track.codecId) ? "opus" : "vorbis"}"`;
  const asc = track.codecPrivate?.length ? track.codecPrivate : undefined;
  const objectType = asc ? (asc[0] >> 3) & 0x1f : 2;
  return `audio/mp4; codecs="mp4a.40.${objectType === 5 || objectType === 29 ? 2 : objectType || 2}"`;
}

export function videoInit(header: MkvHeader, track: MkvTrack): Uint8Array {
  return buildInitSegment({
    kind: "video",
    timescale: VIDEO_TIMESCALE,
    width: track.width || 1280,
    height: track.height || 720,
    codecPrivate: track.codecPrivate || new Uint8Array(0),
    codecBox: /HEVC/i.test(track.codecId) ? "hvc1" : "avc1",
  });
}

export function audioInit(header: MkvHeader, track: MkvTrack): Uint8Array {
  if (track.route === "webm") {
    return buildWebmInit({
      codecId: track.codecId,
      codecPrivate: track.codecPrivate,
      sampleRate: track.sampleRate || 48000,
      channels: track.channels || 2,
      bitDepth: track.bitDepth,
      codecDelayNs: track.codecDelayNs,
      seekPreRollNs: track.seekPreRollNs,
      timecodeScale: header.timecodeScale,
      durationMs: header.durationMs,
    });
  }
  const rate = Math.round(track.sampleRate || 48000);
  const mp3 = isMp3Track(track);
  return buildInitSegment({
    kind: "audio",
    timescale: rate,
    channels: track.channels || 2,
    sampleRate: rate,
    sampleSize: 16,
    objectType: mp3 ? 0x6b : 0x40,
    codecPrivate: mp3 ? new Uint8Array(0) : track.codecPrivate?.length ? track.codecPrivate : buildAudioSpecificConfig(rate, track.channels || 2),
  });
}

const withPrefix = (prefix: Uint8Array | undefined, frame: Uint8Array) => {
  if (!prefix?.length) return frame;
  const out = new Uint8Array(prefix.length + frame.length);
  out.set(prefix, 0);
  out.set(frame, prefix.length);
  return out;
};

/** Collects video blocks into keyframe-aligned fMP4 fragments. */
export class VideoFragmenter {
  private pending: Array<{ data: Uint8Array; pts: number; isKey: boolean }> = [];
  private seq = 1;
  private lastDtsEnd = -1;
  constructor(private readonly header: MkvHeader, private readonly track: MkvTrack) {}

  private toUnits(ticks: number) {
    return Math.round((ticks * this.header.timecodeScale * VIDEO_TIMESCALE) / 1_000_000_000);
  }
  private get frameUnits() {
    const ns = this.track.defaultDurationNs || 41_708_333;
    return Math.max(1, Math.round((ns * VIDEO_TIMESCALE) / 1_000_000_000));
  }
  reset() { this.pending = []; this.lastDtsEnd = -1; }
  get pendingCount() { return this.pending.length; }
  firstPendingSeconds() { return this.pending.length ? this.pending[0].pts / VIDEO_TIMESCALE : -1; }

  /** Push a block; returns a finished fragment when a new GOP begins. */
  push(block: MkvBlock): Uint8Array | null {
    let out: Uint8Array | null = null;
    if (block.isKey && this.pending.length > 0) out = this.flush();
    else if (this.pending.length >= 480) out = this.flush();
    const base = this.toUnits(block.ptsTicks);
    block.frames.forEach((frame, i) => {
      this.pending.push({ data: withPrefix(this.track.stripPrefix, frame), pts: base + i * this.frameUnits, isKey: block.isKey && i === 0 });
    });
    return out;
  }

  /** Discard everything until the next keyframe (used after a seek). */
  dropUntilKey(block: MkvBlock): boolean { return !block.isKey && this.pending.length === 0; }

  flush(): Uint8Array | null {
    if (!this.pending.length) return null;
    const samples = this.pending;
    this.pending = [];
    const sorted = samples.map((s) => s.pts).sort((a, b) => a - b);
    let dts = sorted;
    // Keep decode time monotonic across fragments.
    if (this.lastDtsEnd >= 0 && dts[0] < this.lastDtsEnd && this.lastDtsEnd - dts[0] < this.frameUnits * 4) {
      const shift = this.lastDtsEnd - dts[0];
      dts = dts.map((d) => d + shift);
    }
    const mp4: Mp4Sample[] = samples.map((s, i) => ({
      data: s.data,
      duration: i + 1 < dts.length ? Math.max(1, dts[i + 1] - dts[i]) : this.frameUnits,
      cto: s.pts - dts[i],
      isKey: s.isKey,
    }));
    const total = mp4.reduce((a, s) => a + s.duration, 0);
    this.lastDtsEnd = dts[0] + total;
    return buildFragment(this.seq++, Math.max(0, dts[0]), mp4, 1);
  }
}

/** Collects audio blocks into fMP4 (AAC) or WebM (Opus/Vorbis) chunks. */
export class AudioFragmenter {
  private mp4Pending: Array<{ data: Uint8Array; pts: number }> = [];
  private webmPending: MkvBlock[] = [];
  private seq = 1;
  private readonly rate: number;
  private readonly frameSamples: number;
  constructor(private readonly header: MkvHeader, readonly track: MkvTrack, private readonly maxBlocks = 60) {
    this.rate = Math.round(track.sampleRate || 48000);
    this.frameSamples = isMp3Track(track) ? mp3FrameSamples(track) : 1024;
  }
  reset() { this.mp4Pending = []; this.webmPending = []; }

  private msToTicks(ms: number) { return (ms * 1_000_000) / this.header.timecodeScale; }

  /** Opus packet duration from its TOC byte (RFC 6716 §3.1). */
  private opusTicks(frame: Uint8Array): number {
    if (!frame.length) return 0;
    const toc = frame[0];
    const config = toc >> 3;
    const ms = config < 12 ? [10, 20, 40, 60][config & 3] : config < 16 ? [10, 20][config & 1] : [2.5, 5, 10, 20][config & 3];
    const code = toc & 3;
    const count = code === 0 ? 1 : code < 3 ? 2 : (frame[1] || 0) & 0x3f;
    return this.msToTicks(ms * Math.max(1, count));
  }

  /**
   * Chrome's WebM parser rejects laced blocks, so every laced frame becomes
   * its own SimpleBlock. Opus timing comes from the packet TOC; other codecs
   * split the block span evenly (needs the next block, so one may carry over).
   */
  private flushWebm(final: boolean): Uint8Array | null {
    const list = this.webmPending;
    if (!list.length) return null;
    const isOpus = /OPUS/i.test(this.track.codecId);
    const out: WebmBlock[] = [];
    let carry: MkvBlock | null = null;
    list.forEach((block, idx) => {
      if (block.frames.length <= 1) {
        out.push({ ptsTicks: block.ptsTicks, flags: block.flags & ~0x06, payload: block.frames[0] || block.payload });
        return;
      }
      const next = list[idx + 1];
      let each = 0;
      if (!isOpus) {
        const span = block.durationTicks > 0 ? block.durationTicks : next ? next.ptsTicks - block.ptsTicks : 0;
        if (span <= 0 && !final) { carry = block; return; }
        each = span > 0 ? span / block.frames.length : this.msToTicks(20);
      }
      let t = block.ptsTicks;
      block.frames.forEach((frame) => {
        out.push({ ptsTicks: Math.round(t), flags: block.flags & ~0x06, payload: frame });
        t += isOpus ? this.opusTicks(frame) : each;
      });
    });
    this.webmPending = carry ? [carry] : [];
    return out.length ? buildWebmCluster(out) : null;
  }

  push(block: MkvBlock): Uint8Array | null {
    if (this.track.route === "webm") {
      this.webmPending.push(block);
      return this.webmPending.length >= this.maxBlocks ? this.flush() : null;
    }
    const base = Math.round((block.ptsTicks * this.header.timecodeScale * this.rate) / 1_000_000_000);
    block.frames.forEach((frame, i) => {
      this.mp4Pending.push({ data: withPrefix(this.track.stripPrefix, frame), pts: base + i * this.frameSamples });
    });
    return this.mp4Pending.length >= this.maxBlocks ? this.flush() : null;
  }

  flush(final = false): Uint8Array | null {
    if (this.track.route === "webm") return this.flushWebm(final);
    if (!this.mp4Pending.length) return null;
    const list = this.mp4Pending;
    this.mp4Pending = [];
    const samples: Mp4Sample[] = list.map((s, i) => ({
      data: s.data,
      duration: i + 1 < list.length ? Math.max(1, list[i + 1].pts - s.pts) : this.frameSamples,
      cto: 0,
      isKey: true,
    }));
    return buildFragment(this.seq++, Math.max(0, list[0].pts), samples, 1);
  }
}
