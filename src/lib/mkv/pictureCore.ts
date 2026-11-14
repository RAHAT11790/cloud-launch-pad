// ============================================================
// PictureCore — the timing brain of the picture decoder.
// ============================================================
// Holds compressed packets and decoded pictures, shows the newest picture
// that is due on the sound's clock, and lowers the software decoder's
// quality step while the phone falls behind so picture and sound never
// drift apart. It runs either on the page (phone hardware decoder) or inside
// the software decoder's worker, painting on an OffscreenCanvas there — then
// a busy page never delays the picture.

export type Chunk = { data: Uint8Array; pts: number; key: boolean };

export interface CoreBackend {
  readonly kind: "hardware" | "software";
  pending(): number;
  decode(c: Chunk): void;
  reset(): void;
  setSkip(level: number): void;
}

export interface CoreClock {
  /** Playback position in µs right now. */
  now(): number;
  /** Is the sound actually moving (playing, not seeking or stalled)? */
  running(): boolean;
  /** Playback speed (1 = normal). */
  rate?(): number;
}

/** Anything with a presentation time that can be given back after use. */
export interface Pic { readonly timestamp: number; close(): void }

/** Software quality steps (see rv_set_skip in wasm/rsvideo.c). */
export const SKIP_NONREF = 2;
export const SKIP_KEYS = 3;

export type CoreStats = { drawn: number; dropped: number; resyncs: number; ticks: number; drawMs: number; arrived: number; syncMs: number; decodeMs: number };

export class PictureCore<P extends Pic = VideoFrame> {
  backend: CoreBackend | null = null;
  private queue: Chunk[] = [];
  private frames: P[] = [];
  /** After a reset: the picture to show first (µs) and whether it is on screen yet. */
  private target = 0;
  private primed = false;
  /** Seek: paint the first picture at once. Catch-up jump: wait for its time. */
  private paintAtOnce = true;
  private needKey = true;
  private lastDrawn = -1;
  private lastOut = -1;
  private skipLevel = 0;
  private calmSince = 0;
  private lastStep = 0;
  private closed = false;
  readonly stats: CoreStats = { drawn: 0, dropped: 0, resyncs: 0, ticks: 0, drawMs: 0, arrived: 0, syncMs: 0, decodeMs: 0 };

  constructor(
    private readonly frameUs: number,
    private readonly clock: CoreClock,
    /** Puts one picture on screen (must not keep it: it is given back right after). */
    private readonly paint: (p: P) => void,
    private readonly onReady: () => void,
  ) {}

  get ready() { return this.primed; }
  get shownSeconds() { return this.lastDrawn < 0 ? -1 : this.lastDrawn / 1e6; }
  get skip() { return this.skipLevel; }

  /** One compressed picture, in file order. */
  push(c: Chunk) {
    if (this.closed) return;
    if (this.needKey && !c.key) return;
    this.needKey = false;
    this.queue.push(c);
    this.feed();
  }

  /** Seek: forget everything and start again from the next keyframe. */
  reset(seconds: number) {
    this.queue = [];
    this.dropFrames();
    this.backend?.reset();
    this.target = Math.round(seconds * 1e6);
    this.primed = false;
    this.paintAtOnce = true;
    this.needKey = true;
    this.lastOut = -1;
    // Race to the wanted picture: references only, no deblocking, until it is on screen.
    this.backend?.setSkip(this.backend.kind === "software" ? Math.max(SKIP_NONREF, this.skipLevel) : 0);
  }

  // Software: a few pictures in reserve absorb slow keyframes without a
  // visible hitch. Hardware frames stay few (phone decoders own a small pool).
  private maxFrames() { return this.backend?.kind === "hardware" ? 3 : 8; }
  // Keep the decoder busy: a skipped packet gives no picture, so "done" refills too.
  // (the multi-core software decoder needs several packets in hand to keep every core busy)
  private maxInflight() { return this.backend?.kind === "hardware" ? 4 : 12; }

  feed() {
    const b = this.backend;
    if (!b || this.closed) return;
    while (this.queue.length && b.pending() < this.maxInflight() && this.frames.length < this.maxFrames()) {
      b.decode(this.queue.shift()!);
    }
  }

  onFrame(f: P) {
    if (this.closed) { f.close(); return; }
    this.stats.arrived += 1;
    this.lastOut = f.timestamp;
    const half = this.frameUs / 2;
    // Pictures before the seek target were only needed as references.
    if (!this.primed && f.timestamp < this.target - half) { f.close(); this.feed(); return; }
    let i = this.frames.length;
    while (i > 0 && this.frames[i - 1].timestamp > f.timestamp) i -= 1;
    this.frames.splice(i, 0, f);
    if (!this.primed) {
      if (this.paintAtOnce) this.draw(this.frames.shift()!);
      this.primed = true;
      this.backend?.setSkip(this.skipLevel); // back to the quality step this phone keeps up with
      this.onReady();
    }
    this.feed();
  }

  private draw(f: P) {
    try {
      const t0 = performance.now();
      this.paint(f);
      this.stats.drawMs = Math.round((this.stats.drawMs * 0.9 + (performance.now() - t0) * 0.1) * 10) / 10;
      this.lastDrawn = f.timestamp;
      this.stats.drawn += 1;
      if (this.primed && this.clock.running()) {
        const off = Math.abs(this.clock.now() - f.timestamp) / 1000;
        this.stats.syncMs = Math.round(this.stats.syncMs * 0.9 + off * 0.1);
      }
    } finally { f.close(); }
  }

  /** Milliseconds until the next picture is due (for timer-driven painting). */
  msToNext(): number {
    if (!this.primed || !this.frames.length || !this.clock.running()) return 16;
    return Math.max(1, Math.min(16, (this.frames[0].timestamp - this.frameUs / 2 - this.clock.now()) / 1000));
  }

  /** Call once per display frame. */
  tick() {
    if (this.closed) return;
    this.stats.ticks += 1;
    const now = this.clock.now();
    const half = this.frameUs / 2;
    if (this.primed) {
      // Newest picture that is due; older due pictures are skipped.
      let due: P | null = null;
      while (this.frames.length && this.frames[0].timestamp <= now + half) {
        if (due) { due.close(); this.stats.dropped += 1; }
        due = this.frames.shift()!;
      }
      if (due) this.draw(due);
    }
    this.adapt(now);
    this.feed();
  }

  /** Keeps picture and sound together on slow phones. */
  private adapt(now: number) {
    const b = this.backend;
    if (!b || !this.primed || !this.clock.running()) { this.calmSince = 0; return; }
    // How far the decoder's INPUT trails the sound: the next packet still
    // waiting to be decoded. (An empty queue is a slow network, not a slow
    // phone — the sound waits for data too.) Same meaning at every quality
    // step, even keyframes-only.
    const lag = this.queue.length ? (now - this.queue[0].pts) / 1e6 : 0;
    const soft = b.kind === "software";
    if (lag > 2.5) {
      // Far behind: jump to the next keyframe after the playhead; its picture
      // is shown when the sound reaches it (never ahead of the sound).
      const idx = this.queue.findIndex((c) => c.key && c.pts > now + 300_000);
      this.stats.resyncs += 1;
      this.dropFrames();
      b.reset();
      if (idx >= 0) { this.queue = this.queue.slice(idx); this.needKey = false; }
      else { this.queue = []; this.needKey = true; }
      this.lastOut = -1;
      this.target = idx >= 0 ? this.queue[0].pts : now + 300_000;
      this.primed = false;
      this.paintAtOnce = false;
      if (soft) { this.skipLevel = Math.min(SKIP_KEYS, this.skipLevel + 1); b.setSkip(this.skipLevel); }
      this.calmSince = 0;
      return;
    }
    if (!soft) return;
    // 0 full · 1 no deblocking/SAO (every picture kept) · 2 + skip non-reference
    // pictures · 3 keyframes only. Filters go first: the motion stays fluid,
    // only fine edges soften.
    const t = performance.now();
    let level = this.skipLevel;
    if (lag > 0.8 && level >= SKIP_NONREF) level = SKIP_KEYS;
    else if (lag > 0.45) level = Math.max(level, SKIP_NONREF);
    else if (lag > 0.06) level = Math.max(level, 1);
    // Step up BEFORE falling behind: the decoder needs more time per picture
    // than the picture lasts (measured at the current step, so wait a moment
    // after each change for the average to settle).
    const budgetMs = this.frameUs / 1000 / Math.max(0.25, this.clock.rate?.() || 1);
    const load = this.stats.decodeMs > 0 ? this.stats.decodeMs / budgetMs : 0;
    if (load > 0.9 && level === this.skipLevel && level < SKIP_NONREF && t - this.lastStep > 1000) level += 1; // keyframes-only stays a last resort
    if (lag < 0.06 && load < 0.55) {
      if (!this.calmSince) this.calmSince = t;
      else if (t - this.calmSince > 6000 && level > 0) { level -= 1; this.calmSince = t; }
    } else this.calmSince = 0;
    if (level !== this.skipLevel) { this.skipLevel = level; this.lastStep = t; b.setSkip(level); }
  }

  private dropFrames() { this.frames.forEach((f) => f.close()); this.frames = []; }

  close() {
    this.closed = true;
    this.dropFrames();
    this.queue = [];
    this.backend = null;
  }
}
