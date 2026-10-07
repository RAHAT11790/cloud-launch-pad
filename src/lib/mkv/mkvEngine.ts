// ============================================================
// MkvEngine — Media Source playback of one Matroska file with a
// user-selected audio track and live embedded subtitles.
// ============================================================
// Native <video> playback of an .mkv only ever decodes ONE audio track. When
// the viewer picks another language (or an embedded subtitle) the player hands
// the element to this engine at the current position:
//   * video  → fragmented MP4 (H.264 / HEVC, samples copied, no re-encode)
//   * audio  → fMP4 (AAC / MP3) or WebM (Opus / Vorbis), samples copied
//   * text subtitles → cue callbacks, PGS → bitmap cue callbacks
// Switching language again keeps the video buffer and only swaps the audio
// SourceBuffer (changeType), so the picture never goes black.

import { isPgsTrack, loadMkvCues, MkvBlockStream, parseMkvHeader, subtitleBlockText, unpackFrame, type MkvBlock, type MkvCue, type MkvHeader, type MkvTrack, type RangeSource } from "./mkvDemux";
import { AudioFragmenter, VideoFragmenter, audioInit, audioMime, videoInit, videoMime } from "./mkvRemux";
import { PgsDecoder, type PgsBitmapCue } from "./pgs";

export interface TextCue { start: number; end: number; text: string }

export interface MkvEngineCallbacks {
  onTextCue?: (trackNumber: number, cue: TextCue) => void;
  onBitmapCue?: (trackNumber: number, cue: PgsBitmapCue) => void;
  onFatal?: (error: Error) => void;
  onBuffering?: (buffering: boolean) => void;
}

// ------------------------------------------------------------------
// HTTP range source with retries + one-chunk sequential prefetch
// ------------------------------------------------------------------
export class HttpRangeSource implements RangeSource {
  total = -1;
  private controllers = new Set<AbortController>();
  private prefetch: { start: number; length: number; promise: Promise<Uint8Array> } | null = null;
  private dead = false;
  constructor(readonly url: string) {}

  abort() {
    this.dead = true;
    this.controllers.forEach((c) => { try { c.abort(); } catch { /* ignore */ } });
    this.controllers.clear();
    this.prefetch = null;
  }

  /** Cancel in-flight reads but keep the source usable (used on seek). */
  cancelPending() {
    this.controllers.forEach((c) => { try { c.abort(); } catch { /* ignore */ } });
    this.controllers.clear();
    this.prefetch = null;
  }

  private async fetchRange(start: number, length: number): Promise<Uint8Array> {
    if (this.dead) throw new Error("aborted");
    if (this.total >= 0 && start >= this.total) return new Uint8Array(0);
    const end = this.total >= 0 ? Math.min(this.total - 1, start + length - 1) : start + length - 1;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      this.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(this.url, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal });
        if (res.status === 416) { this.total = start; return new Uint8Array(0); }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (res.headers.get("x-rs-proxy-fallback") === "1") throw new Error("proxy fallback");
        const cr = (res.headers.get("content-range") || "").match(/bytes\s+(\d+)-\d+\/(\d+)/i);
        if (cr) {
          this.total = Number(cr[2]);
          if (Number(cr[1]) !== start) throw new Error("range mismatch");
        } else if (res.status === 200 && start > 0) {
          throw new Error("server ignored range");
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        return res.status === 200 && buf.length > length ? buf.subarray(0, length) : buf;
      } catch (error) {
        lastError = error;
        if (this.dead) throw new Error("aborted");
        if ((error as any)?.name === "AbortError" && !this.controllers.has(controller)) throw new Error("aborted");
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
        this.controllers.delete(controller);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async read(start: number, length: number): Promise<Uint8Array> {
    const p = this.prefetch;
    let data: Uint8Array;
    if (p && p.start === start && p.length >= length) {
      this.prefetch = null;
      data = await p.promise;
    } else {
      this.prefetch = null;
      data = await this.fetchRange(start, length);
    }
    // Large sequential reads (cluster streaming) prefetch the next window.
    if (length >= 512 * 1024 && data.length === length && !this.dead) {
      const nextStart = start + data.length;
      const promise = this.fetchRange(nextStart, length);
      promise.catch(() => undefined);
      this.prefetch = { start: nextStart, length, promise };
    }
    return data;
  }
}

// ------------------------------------------------------------------
// Serialized SourceBuffer writer
// ------------------------------------------------------------------
class SbWriter {
  private chain: Promise<void> = Promise.resolve();
  constructor(readonly sb: SourceBuffer, private readonly owner: { video: HTMLVideoElement | null }) {}

  private idle(): Promise<void> {
    if (!this.sb.updating) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { this.sb.removeEventListener("updateend", done); resolve(); };
      this.sb.addEventListener("updateend", done);
    });
  }

  run(task: () => void): Promise<void> {
    this.chain = this.chain.then(async () => {
      await this.idle();
      task();
      await this.idle();
    });
    return this.chain;
  }

  append(data: Uint8Array): Promise<void> {
    this.chain = this.chain.then(async () => {
      await this.idle();
      try {
        this.sb.appendBuffer(data as unknown as BufferSource);
      } catch (error: any) {
        if (error?.name !== "QuotaExceededError") throw error;
        const t = this.owner.video?.currentTime || 0;
        if (t > 10) { this.sb.remove(0, t - 8); await this.idle(); }
        this.sb.appendBuffer(data as unknown as BufferSource);
      }
      await this.idle();
    });
    return this.chain;
  }

  ranges(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    try { for (let i = 0; i < this.sb.buffered.length; i += 1) out.push([this.sb.buffered.start(i), this.sb.buffered.end(i)]); } catch { /* removed */ }
    return out;
  }
}

const rangeEndAt = (ranges: Array<[number, number]>, t: number) => {
  for (const [s, e] of ranges) if (t >= s - 0.25 && t < e) return e;
  return -1;
};

export const mseAvailable = () => typeof window !== "undefined" && typeof (window as any).MediaSource?.isTypeSupported === "function";

export function canPlayTrackCombo(video: MkvTrack | null, audio: MkvTrack | null): boolean {
  if (!mseAvailable() || !video?.route || !audio?.route) return false;
  const MS = (window as any).MediaSource;
  return MS.isTypeSupported(videoMime(video)) && MS.isTypeSupported(audioMime(audio));
}

export async function openMkv(src: RangeSource): Promise<{ header: MkvHeader; cues: MkvCue[] }> {
  const header = await parseMkvHeader(src);
  const cues = await loadMkvCues(src, header).catch(() => [] as MkvCue[]);
  return { header, cues };
}

// ------------------------------------------------------------------
// Engine
// ------------------------------------------------------------------
export class MkvEngine {
  private source: HttpRangeSource;
  private ms: MediaSource | null = null;
  private objectUrl = "";
  private owner: { video: HTMLVideoElement | null } = { video: null };
  private vw: SbWriter | null = null;
  private aw: SbWriter | null = null;
  private audio: MkvTrack;
  private generation = 0;
  private running = false;
  private destroyed = false;
  private failed = false;
  private eofReached = false;
  private videoSkipUntil = -1;
  private textTracks: MkvTrack[];
  private pgsTracks: MkvTrack[];
  private pgs = new Map<number, PgsDecoder>();
  private seenCues = new Set<string>();
  private wakeTimer: ReturnType<typeof setInterval> | null = null;
  private readAhead = 45;

  constructor(
    url: string,
    private readonly header: MkvHeader,
    private readonly cues: MkvCue[],
    audioNumber: number,
    private readonly cb: MkvEngineCallbacks = {},
  ) {
    this.source = new HttpRangeSource(url);
    this.audio = header.audio.find((a) => a.number === audioNumber) || header.audio[0];
    this.textTracks = header.subtitles.filter((s) => s.route === "text" && !isPgsTrack(s));
    this.pgsTracks = header.subtitles.filter((s) => s.route === "text" && isPgsTrack(s));
    this.pgsTracks.forEach((t) => this.pgs.set(t.number, new PgsDecoder()));
  }

  get audioNumber() { return this.audio.number; }
  get isDestroyed() { return this.destroyed; }

  private fatal(error: unknown) {
    if (this.failed || this.destroyed) return;
    this.failed = true;
    this.cb.onFatal?.(error instanceof Error ? error : new Error(String(error)));
  }

  private tickSeconds(ticks: number) { return (ticks * this.header.timecodeScale) / 1_000_000_000; }

  private cueFor(seconds: number): number {
    if (!this.cues.length) return this.header.firstClusterPos;
    const target = (Math.max(0, seconds) * 1_000_000_000) / this.header.timecodeScale;
    let pos = this.cues[0].pos;
    for (const cue of this.cues) { if (cue.timeTicks <= target) pos = cue.pos; else break; }
    return pos;
  }

  /** Take over `video`, start at `startAt`; resolves once playable data is buffered. */
  async attach(video: HTMLVideoElement, startAt: number): Promise<void> {
    const v = this.header.video;
    if (!v || !canPlayTrackCombo(v, this.audio)) throw new Error("codec not supported by this browser");
    const MS = (window as any).MediaSource;
    const ms: MediaSource = new MS();
    this.ms = ms;
    this.owner.video = video;
    this.objectUrl = URL.createObjectURL(ms);
    const opened = new Promise<void>((resolve, reject) => {
      ms.addEventListener("sourceopen", () => resolve(), { once: true });
      setTimeout(() => reject(new Error("media source did not open")), 8000);
    });
    video.src = this.objectUrl;
    await opened;
    if (this.destroyed) throw new Error("aborted");
    if (this.header.durationMs > 0) ms.duration = this.header.durationMs / 1000;
    this.vw = new SbWriter(ms.addSourceBuffer(videoMime(v)), this.owner);
    this.aw = new SbWriter(ms.addSourceBuffer(audioMime(this.audio)), this.owner);
    await Promise.all([this.vw.append(videoInit(this.header, v)), this.aw.append(audioInit(this.header, this.audio))]);
    video.addEventListener("seeking", this.onSeeking);
    video.addEventListener("error", this.onVideoError);
    this.wakeTimer = setInterval(this.wake, 700);
    const ready = this.waitForData(startAt);
    this.startReader(startAt);
    try { video.currentTime = startAt; } catch { /* ignore */ }
    await ready;
  }

  private onVideoError = () => {
    const err = this.owner.video?.error;
    if (this.owner.video?.src === this.objectUrl && err) this.fatal(new Error(`media error ${err.code}: ${err.message || ""}`));
  };

  private waitForData(t: number, timeoutMs = 25000): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (this.destroyed) return reject(new Error("aborted"));
        if (this.failed) return reject(new Error("engine failed"));
        const ve = rangeEndAt(this.vw?.ranges() || [], t);
        const ae = rangeEndAt(this.aw?.ranges() || [], t);
        if ((ve > t + 1 && ae > t + 1) || this.eofReached) return resolve();
        if (Date.now() - started > timeoutMs) return reject(new Error("timed out waiting for media"));
        setTimeout(check, 120);
      };
      check();
    });
  }

  private onSeeking = () => {
    const video = this.owner.video;
    if (!video || this.destroyed || this.failed) return;
    const t = video.currentTime;
    const ve = rangeEndAt(this.vw?.ranges() || [], t);
    const ae = rangeEndAt(this.aw?.ranges() || [], t);
    if (ve > t + 0.5 && ae > t + 0.5) { this.wake(); return; }
    this.videoSkipUntil = -1;
    this.startReader(t);
  };

  private wake = () => {
    if (this.destroyed || this.failed) return;
    const video = this.owner.video;
    if (!video) return;
    // Trim far-behind media so long episodes never hit the buffer quota.
    const t = video.currentTime;
    if (t > 90) {
      const cut = t - 60;
      for (const w of [this.vw, this.aw]) {
        if (!w) continue;
        const r = w.ranges();
        if (r.length && r[0][0] < cut - 5 && !w.sb.updating) void w.run(() => { try { w.sb.remove(0, cut); } catch { /* ignore */ } }).catch(() => undefined);
      }
    }
    if (!this.running && !this.eofReached) void this.pump(this.generation);
  };

  private reader: MkvBlockStream | null = null;
  private vf: VideoFragmenter | null = null;
  private af: AudioFragmenter | null = null;

  private startReader(seconds: number) {
    this.generation += 1;
    this.source.cancelPending();
    this.eofReached = false;
    const wanted = new Set<number>([this.header.video!.number, this.audio.number, ...this.textTracks.map((t) => t.number), ...this.pgsTracks.map((t) => t.number)]);
    this.reader = new MkvBlockStream(this.source, this.cueFor(seconds), wanted, 2 * 1024 * 1024);
    this.vf = new VideoFragmenter(this.header, this.header.video!);
    this.af = new AudioFragmenter(this.header, this.audio);
    // A seek jumps the PGS epoch: start fresh, cues already shown stay cached.
    this.pgs.forEach((d) => d.reset());
    this.seenCues.clear();
    this.running = false;
    void this.pump(this.generation);
  }

  private bufferedAhead(): number {
    const t = this.owner.video?.currentTime || 0;
    const ve = rangeEndAt(this.vw?.ranges() || [], t);
    const ae = rangeEndAt(this.aw?.ranges() || [], t);
    if (ve < 0 || ae < 0) return 0;
    return Math.min(ve, ae) - t;
  }

  private async pump(gen: number) {
    if (this.running || this.destroyed || this.failed) return;
    const reader = this.reader; const vf = this.vf; const af = this.af;
    if (!reader || !vf || !af || !this.vw || !this.aw) return;
    this.running = true;
    const vNum = this.header.video!.number;
    try {
      while (gen === this.generation && !this.destroyed) {
        if (this.bufferedAhead() > this.readAhead) break;
        const block = await reader.next();
        if (gen !== this.generation || this.destroyed) return;
        if (!block) {
          const fv = vf.flush(); if (fv) await this.vw.append(fv);
          const fa = af.flush(); if (fa) await this.aw.append(fa);
          this.eofReached = true;
          if (gen === this.generation) await this.endStream();
          break;
        }
        if (block.track === vNum) {
          if (this.videoSkipUntil >= 0) {
            const s = this.tickSeconds(block.ptsTicks);
            if (!block.isKey || s < this.videoSkipUntil) continue;
            this.videoSkipUntil = -1;
          }
          if (vf.dropUntilKey(block)) continue;
          const frag = vf.push(block);
          if (frag) await this.vw.append(frag);
        } else if (block.track === this.audio.number) {
          const frag = af.push(block);
          if (frag) await this.aw.append(frag);
        } else {
          this.emitSubtitle(block);
        }
      }
      // Push what we have so playback never waits on a half-built GOP for
      // longer than one fragment.
    } catch (error: any) {
      if (gen === this.generation && !this.destroyed && String(error?.message) !== "aborted") this.fatal(error);
    } finally {
      if (gen === this.generation) this.running = false;
    }
  }

  private async endStream() {
    const ms = this.ms;
    if (!ms || ms.readyState !== "open") return;
    await Promise.all([this.vw?.run(() => undefined), this.aw?.run(() => undefined)]);
    try { if (ms.readyState === "open") ms.endOfStream(); } catch { /* ignore */ }
  }

  private subChain: Promise<void> = Promise.resolve();

  /** Subtitles are decoded in arrival order on a side chain (zlib is async). */
  private emitSubtitle(block: MkvBlock) {
    const track = this.textTracks.find((t) => t.number === block.track) || this.pgsTracks.find((t) => t.number === block.track);
    if (!track) return;
    const key = `${block.track}:${block.ptsTicks}`;
    if (this.seenCues.has(key)) return;
    this.seenCues.add(key);
    const start = this.tickSeconds(block.ptsTicks);
    const duration = block.durationTicks > 0 ? this.tickSeconds(block.durationTicks) : 0;
    const frames = block.frames;
    this.subChain = this.subChain.then(async () => {
      if (this.destroyed) return;
      for (const raw of frames) {
        const frame = await unpackFrame(track, raw).catch(() => null);
        if (!frame) continue;
        if (isPgsTrack(track)) {
          const decoder = this.pgs.get(track.number);
          if (decoder) for (const cue of decoder.push(frame, start)) this.cb.onBitmapCue?.(track.number, cue);
        } else {
          const body = subtitleBlockText(track, frame);
          if (body) this.cb.onTextCue?.(track.number, { start, end: start + (duration || 3), text: body });
        }
      }
    }).catch(() => undefined);
  }

  /** Swap the audio language in place; video keeps playing from its buffer. */
  async switchAudio(number: number): Promise<void> {
    const next = this.header.audio.find((a) => a.number === number);
    if (!next || next.number === this.audio.number || !this.aw || !this.ms) return;
    if (!canPlayTrackCombo(this.header.video, next)) throw new Error("codec not supported by this browser");
    const video = this.owner.video!;
    const t = video.currentTime;
    const sb = this.aw.sb as SourceBuffer & { changeType?: (type: string) => void };
    const prevMime = audioMime(this.audio);
    const nextMime = audioMime(next);
    if (prevMime !== nextMime && typeof sb.changeType !== "function") throw new Error("changeType unsupported");
    this.generation += 1; // stop the reader
    this.source.cancelPending();
    this.audio = next;
    if (this.ms.readyState === "ended") {
      // Re-open by appending; spec allows append() on an ended MediaSource.
    }
    await this.aw.run(() => { try { sb.abort(); } catch { /* ignore */ } });
    await this.aw.run(() => { try { sb.remove(0, Infinity); } catch { /* ignore */ } });
    if (prevMime !== nextMime) await this.aw.run(() => sb.changeType!(nextMime));
    await this.aw.append(audioInit(this.header, next));
    const ve = rangeEndAt(this.vw?.ranges() || [], t);
    const ready = this.waitForData(t);
    this.startReader(t);
    this.videoSkipUntil = ve > t ? ve - 0.05 : -1;
    await ready;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.source.abort();
    if (this.wakeTimer) clearInterval(this.wakeTimer);
    const video = this.owner.video;
    if (video) {
      video.removeEventListener("seeking", this.onSeeking);
      video.removeEventListener("error", this.onVideoError);
    }
    if (this.objectUrl) { try { URL.revokeObjectURL(this.objectUrl); } catch { /* ignore */ } }
    this.ms = null; this.vw = null; this.aw = null; this.owner.video = null; this.reader = null;
  }

  ownsElement(video: HTMLVideoElement) {
    return !this.destroyed && !!this.objectUrl && video.src === this.objectUrl;
  }
}
