// ============================================================
// AudioSidecar — play ANOTHER in-file audio language while the picture keeps
// playing natively.
// ============================================================
// The full MkvEngine re-muxes video too, which some phones cannot decode
// through Media Source (HEVC files → black screen, or the track list greyed
// out). The sidecar never touches the <video>: the browser keeps decoding the
// picture exactly like a direct open, the video is muted, and only the chosen
// audio track is streamed into a hidden <audio> element that follows the
// video clock (play / pause / seek / speed / volume).

import { MkvBlockStream, type MkvCue, type MkvHeader, type MkvTrack } from "./mkvDemux";
import { HttpRangeSource, mseAvailable } from "./mkvEngine";
import { AudioFragmenter, audioInit, audioMime } from "./mkvRemux";

/** Can this browser stream `track` on its own (no video re-mux needed)? */
export const canPlayAudioOnly = (track?: Pick<MkvTrack, "route"> | null, mime?: string): boolean => {
  if (!mseAvailable() || !mime) return false;
  if (track && !track.route) return false;
  try { return (window as any).MediaSource.isTypeSupported(mime); } catch { return false; }
};

const rangeEnd = (b: TimeRanges | undefined, t: number) => {
  if (!b) return -1;
  for (let i = 0; i < b.length; i += 1) if (t >= b.start(i) - 0.25 && t < b.end(i)) return b.end(i);
  return -1;
};

export class AudioSidecar {
  private source: HttpRangeSource;
  private audioEl: HTMLAudioElement | null = null;
  private ms: MediaSource | null = null;
  private sb: SourceBuffer | null = null;
  private objectUrl = "";
  private video: HTMLVideoElement | null = null;
  private track: MkvTrack;
  private gen = 0;
  private running = false;
  private destroyed = false;
  private eof = false;
  private reader: MkvBlockStream | null = null;
  private frag: AudioFragmenter | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chain: Promise<void> = Promise.resolve();
  /** What the player itself asked for (the video is force-muted while we run). */
  private wantMuted = false;
  private selfMuting = false;

  constructor(url: string, private readonly header: MkvHeader, private readonly cues: MkvCue[], audioNumber: number, private readonly onFatal?: (e: Error) => void) {
    this.source = new HttpRangeSource(url);
    this.track = header.audio.find((a) => a.number === audioNumber) || header.audio[0];
  }

  get audioNumber() { return this.track.number; }
  get isDestroyed() { return this.destroyed; }

  private fail(e: unknown) {
    if (this.destroyed) return;
    this.onFatal?.(e instanceof Error ? e : new Error(String(e)));
  }

  private cueFor(seconds: number) {
    if (!this.cues.length) return this.header.firstClusterPos;
    const target = (Math.max(0, seconds) * 1e9) / this.header.timecodeScale;
    let pos = this.cues[0].pos;
    for (const c of this.cues) { if (c.timeTicks <= target) pos = c.pos; else break; }
    return pos;
  }

  private idle(): Promise<void> {
    const sb = this.sb;
    if (!sb || !sb.updating) return Promise.resolve();
    return new Promise((r) => sb.addEventListener("updateend", () => r(), { once: true }));
  }

  private append(data: Uint8Array) {
    this.chain = this.chain.then(async () => {
      if (!this.sb || this.destroyed) return;
      await this.idle();
      try { this.sb.appendBuffer(data as unknown as BufferSource); }
      catch (e: any) {
        if (e?.name !== "QuotaExceededError") throw e;
        const t = this.audioEl?.currentTime || 0;
        if (t > 10) { this.sb.remove(0, t - 8); await this.idle(); }
        this.sb.appendBuffer(data as unknown as BufferSource);
      }
      await this.idle();
    });
    return this.chain;
  }

  private run(task: () => void) {
    this.chain = this.chain.then(async () => { if (!this.sb) return; await this.idle(); task(); await this.idle(); });
    return this.chain;
  }

  /** Start the chosen language at the video's current time. Resolves once audio is buffered. */
  async attach(video: HTMLVideoElement): Promise<void> {
    const mime = audioMime(this.track);
    if (!canPlayAudioOnly(this.track, mime)) throw new Error("audio codec not supported by this browser");
    this.video = video;
    const el = document.createElement("audio");
    el.preload = "auto";
    el.setAttribute("data-rs-sidecar", "1");
    this.audioEl = el;
    const MS = (window as any).MediaSource;
    const ms: MediaSource = new MS();
    this.ms = ms;
    this.objectUrl = URL.createObjectURL(ms);
    const opened = new Promise<void>((resolve, reject) => {
      ms.addEventListener("sourceopen", () => resolve(), { once: true });
      setTimeout(() => reject(new Error("media source did not open")), 8000);
    });
    el.src = this.objectUrl;
    await opened;
    if (this.destroyed) throw new Error("aborted");
    if (this.header.durationMs > 0) ms.duration = this.header.durationMs / 1000;
    this.sb = ms.addSourceBuffer(mime);
    await this.append(audioInit(this.header, this.track));
    const t = video.currentTime || 0;
    this.startReader(t);
    await this.waitFor(t);
    if (this.destroyed) throw new Error("aborted");
    // Take over the sound only now, so a failure never leaves the episode silent.
    this.wantMuted = video.muted;
    this.muteVideo();
    this.syncVolume();
    el.playbackRate = video.playbackRate || 1;
    try { el.currentTime = video.currentTime; } catch { /* ignore */ }
    video.addEventListener("play", this.onPlay);
    video.addEventListener("playing", this.onPlay);
    video.addEventListener("pause", this.onPause);
    video.addEventListener("waiting", this.onPause);
    video.addEventListener("seeking", this.onSeeking);
    video.addEventListener("ratechange", this.onRate);
    video.addEventListener("volumechange", this.onVolume);
    video.addEventListener("ended", this.onPause);
    this.timer = setInterval(this.tick, 400);
    if (!video.paused) await el.play().catch(() => undefined);
  }

  private waitFor(t: number, timeoutMs = 25000): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (this.destroyed) return reject(new Error("aborted"));
        if (rangeEnd(this.sb?.buffered, t) > t + 0.4 || this.eof) return resolve();
        if (Date.now() - started > timeoutMs) return reject(new Error("timed out waiting for audio"));
        setTimeout(check, 60);
      };
      check();
    });
  }

  private muteVideo() {
    const v = this.video;
    if (!v || v.muted) return;
    this.selfMuting = true; // swallow the volumechange our own mute fires
    v.muted = true;
  }

  private syncVolume() {
    const v = this.video; const a = this.audioEl;
    if (!v || !a) return;
    a.volume = v.volume;
    a.muted = this.wantMuted;
  }

  private onVolume = () => {
    const v = this.video;
    if (!v) return;
    if (this.selfMuting && v.muted) { this.selfMuting = false; return; }
    this.selfMuting = false;
    // The player unmuted → it wants sound: keep the video silent, sound from us.
    if (!v.muted) { this.wantMuted = false; this.muteVideo(); }
    else this.wantMuted = true;
    this.syncVolume();
  };

  private onPlay = () => {
    const v = this.video; const a = this.audioEl;
    if (!v || !a || v.paused) return;
    if (Math.abs(a.currentTime - v.currentTime) > 0.2) { try { a.currentTime = v.currentTime; } catch { /* ignore */ } }
    a.play().catch(() => undefined);
  };

  private onPause = () => { this.audioEl?.pause(); };
  private onRate = () => { if (this.audioEl && this.video) this.audioEl.playbackRate = this.video.playbackRate || 1; };

  private onSeeking = () => {
    const v = this.video; const a = this.audioEl;
    if (!v || !a) return;
    const t = v.currentTime;
    a.pause();
    try { a.currentTime = t; } catch { /* ignore */ }
    if (rangeEnd(this.sb?.buffered, t) > t + 0.5) return;
    this.startReader(t);
  };

  private tick = () => {
    const v = this.video; const a = this.audioEl;
    if (!v || !a || this.destroyed) return;
    if (!v.muted) { this.wantMuted = false; this.muteVideo(); this.syncVolume(); }
    const t = v.currentTime;
    // Trim old audio so long episodes stay inside the buffer quota.
    if (t > 120 && this.sb && !this.sb.updating) {
      const b = this.sb.buffered;
      if (b.length && b.start(0) < t - 90) void this.run(() => { try { this.sb?.remove(0, t - 60); } catch { /* ignore */ } }).catch(() => undefined);
    }
    const playing = !v.paused && !v.seeking && v.readyState >= 3;
    const ahead = rangeEnd(this.sb?.buffered, t) - t;
    if (playing) {
      if (ahead > 0.3) {
        if (Math.abs(a.currentTime - t) > 0.3) { try { a.currentTime = t; } catch { /* ignore */ } }
        if (a.paused) a.play().catch(() => undefined);
      } else if (!a.paused) a.pause();
    } else if (!a.paused) a.pause();
    if (!this.running && !this.eof && ahead < 40) void this.pump(this.gen);
  };

  private startReader(seconds: number) {
    this.gen += 1;
    this.source.cancelPending();
    this.eof = false;
    this.reader = new MkvBlockStream(this.source, this.cueFor(seconds), new Set([this.track.number]), 1024 * 1024);
    this.frag = new AudioFragmenter(this.header, this.track);
    this.running = false;
    void this.pump(this.gen);
  }

  private async pump(gen: number) {
    if (this.running || this.destroyed) return;
    const reader = this.reader; const frag = this.frag;
    if (!reader || !frag) return;
    this.running = true;
    try {
      while (gen === this.gen && !this.destroyed) {
        const t = this.video?.currentTime || 0;
        if (rangeEnd(this.sb?.buffered, t) - t > 45) break;
        const block = await reader.next();
        if (gen !== this.gen || this.destroyed) return;
        if (!block) {
          const last = frag.flush(true); if (last) await this.append(last);
          this.eof = true;
          break;
        }
        if (block.track !== this.track.number) continue;
        const out = frag.push(block);
        if (out) await this.append(out);
      }
    } catch (e: any) {
      if (gen === this.gen && !this.destroyed && String(e?.message) !== "aborted") this.fail(e);
    } finally {
      if (gen === this.gen) this.running = false;
    }
  }

  /** Stop and give the sound back to the video. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gen += 1;
    this.source.abort();
    if (this.timer) clearInterval(this.timer);
    const v = this.video;
    if (v) {
      v.removeEventListener("play", this.onPlay);
      v.removeEventListener("playing", this.onPlay);
      v.removeEventListener("pause", this.onPause);
      v.removeEventListener("waiting", this.onPause);
      v.removeEventListener("seeking", this.onSeeking);
      v.removeEventListener("ratechange", this.onRate);
      v.removeEventListener("volumechange", this.onVolume);
      v.removeEventListener("ended", this.onPause);
      if (this.sb) v.muted = this.wantMuted;
    }
    const a = this.audioEl;
    if (a) { try { a.pause(); a.removeAttribute("src"); a.load(); } catch { /* ignore */ } }
    if (this.objectUrl) { try { URL.revokeObjectURL(this.objectUrl); } catch { /* ignore */ } }
    this.audioEl = null; this.ms = null; this.sb = null; this.video = null; this.reader = null;
  }
}
