// ============================================================
// PictureDecoder — draws the picture of an .mkv whose video the browser
// can't show itself (HEVC/H.265 or 10-bit H.264 → black screen, sound only).
// ============================================================
// The <video> element keeps the sound and the clock (play / pause / seek /
// speed all stay native). Video frames are decoded here and painted on a
// canvas laid exactly over the element, always matching video.currentTime:
//   1. the phone's own hardware decoder through WebCodecs, when it has one;
//   2. otherwise a built-in software decoder (FFmpeg → WASM, in a worker),
//      which lowers quality steps while the phone falls behind instead of
//      letting picture and sound drift apart.
import type { MkvBlock, MkvHeader, MkvTrack } from "./mkvDemux";
import { webCodecsVideoCodec } from "./videoCodec";

import { PictureCore, type Chunk, type CoreStats } from "./pictureCore";

interface Backend {
  readonly kind: "hardware" | "software";
  pending(): number;
  decode(c: Chunk): void;
  reset(): void;
  setSkip(level: number): void;
  close(): void;
}

/** Can the software decoder's worker paint by itself (OffscreenCanvas)? */
const workerPaintPossible = () =>
  typeof HTMLCanvasElement !== "undefined" && "transferControlToOffscreen" in HTMLCanvasElement.prototype && typeof OffscreenCanvas !== "undefined";

/** Hands a packet to a worker without breaking other frames that share its memory. */
const ownBytes = (d: Uint8Array) => (d.byteOffset === 0 && d.byteLength === d.buffer.byteLength ? d : d.slice());

const wcSupportCache = new Map<string, boolean>();

// Software decoder started ahead of time on phones known to need it.
let warmWorker: Worker | null = null;
const takeWorker = () => { const w = warmWorker || newVideoWorker(); warmWorker = null; return w; };
const newVideoWorker = () => new Worker(new URL("./videoDecode.worker.ts", import.meta.url), { type: "module" });
const newPaintWorker = () => new Worker(new URL("./videoPaint.worker.ts", import.meta.url), { type: "module" });
export function prewarmPictureDecoder() {
  if (warmWorker || typeof Worker === "undefined" || typeof WebAssembly !== "object") return;
  try { warmWorker = newVideoWorker(); warmWorker.postMessage({ type: "warm" }); } catch { warmWorker = null; }
}

/** Is there any way to draw this track's picture on this device? */
export function pictureDecodingPossible(track: MkvTrack | null | undefined): boolean {
  if (!track || !/HEVC|AVC/i.test(track.codecId)) return false;
  if (typeof window === "undefined" || typeof (window as any).VideoFrame === "undefined") return false;
  return typeof Worker !== "undefined" && typeof WebAssembly === "object";
}

class HardwareBackend implements Backend {
  readonly kind = "hardware" as const;
  private dec: VideoDecoder;
  constructor(private readonly config: VideoDecoderConfig, onFrame: (f: VideoFrame) => void, onError: (e: Error) => void) {
    this.dec = new VideoDecoder({ output: onFrame, error: (e) => onError(e instanceof Error ? e : new Error(String(e))) });
    this.dec.configure(config);
  }
  static async create(track: MkvTrack, onFrame: (f: VideoFrame) => void, onError: (e: Error) => void): Promise<HardwareBackend | null> {
    const VD = (window as any).VideoDecoder as typeof VideoDecoder | undefined;
    const codec = webCodecsVideoCodec(track);
    if (!VD || !codec) return null;
    const config: VideoDecoderConfig = {
      codec,
      description: track.codecPrivate?.length ? track.codecPrivate.slice() : undefined,
      hardwareAcceleration: "prefer-hardware",
    };
    const cacheKey = `${codec}:${track.width}x${track.height}`;
    let ok = wcSupportCache.get(cacheKey);
    if (ok === undefined) {
      ok = await VD.isConfigSupported(config).then((r) => !!r.supported).catch(() => false);
      wcSupportCache.set(cacheKey, ok);
    }
    if (!ok) return null;
    try { return new HardwareBackend(config, onFrame, onError); } catch { return null; }
  }
  pending() { return this.dec.state === "configured" ? this.dec.decodeQueueSize : 0; }
  decode(c: Chunk) {
    if (this.dec.state !== "configured") return;
    this.dec.decode(new EncodedVideoChunk({ type: c.key ? "key" : "delta", timestamp: c.pts, data: c.data }));
  }
  reset() { try { this.dec.reset(); this.dec.configure(this.config); } catch { /* closed */ } }
  setSkip() { /* hardware keeps up */ }
  close() { try { this.dec.close(); } catch { /* ignore */ } }
}

class SoftwareBackend implements Backend {
  readonly kind = "software" as const;
  private worker: Worker;
  private gen = 1;
  private inflight = 0;
  private skip = -1;
  /** Average decode time per packet (ms), for the quality steps. */
  decodeMs = 0;
  private constructor(worker: Worker) { this.worker = worker; }
  static async create(track: MkvTrack, onFrame: (f: VideoFrame) => void, onError: (e: Error) => void, onDone?: () => void): Promise<SoftwareBackend> {
    const worker = takeWorker();
    const b = new SoftwareBackend(worker);
    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("software decoder did not start")), 20000);
      worker.onmessage = (e: MessageEvent<any>) => {
        const m = e.data;
        if (m.type === "opened") { clearTimeout(timer); if (m.ok) resolve(); else reject(new Error(m.error || "software decoder could not open this video")); return; }
        if (m.type === "frame") { if (m.gen === b.gen) onFrame(m.frame); else m.frame.close(); return; }
        if (m.type === "done") { if (m.gen === b.gen) { b.inflight = Math.max(0, b.inflight - 1); b.decodeMs = b.decodeMs ? b.decodeMs * 0.9 + m.ms * 0.1 : m.ms; onDone?.(); } return; }
        if (m.type === "error") onError(new Error(m.error));
      };
      worker.onerror = (e) => { clearTimeout(timer); const err = new Error(e.message || "software decoder crashed"); reject(err); onError(err); };
    });
    worker.postMessage({ type: "open", codec: /HEVC/i.test(track.codecId) ? "hevc" : "h264", extra: track.codecPrivate?.length ? track.codecPrivate.slice() : null });
    await opened.catch((e) => { try { worker.terminate(); } catch { /* ignore */ } throw e; });
    return b;
  }
  pending() { return this.inflight; }
  decode(c: Chunk) {
    this.inflight += 1;
    const data = ownBytes(c.data);
    this.worker.postMessage({ type: "decode", gen: this.gen, data, pts: c.pts }, [data.buffer]);
  }
  reset() { this.gen += 1; this.inflight = 0; this.worker.postMessage({ type: "flush", gen: this.gen }); }
  setSkip(level: number) { if (level !== this.skip) { this.skip = level; this.worker.postMessage({ type: "skip", level }); } }
  close() { try { this.worker.postMessage({ type: "close" }); } catch { /* ignore */ } setTimeout(() => { try { this.worker.terminate(); } catch { /* ignore */ } }, 50); }
}

const withPrefix = (prefix: Uint8Array | undefined, frame: Uint8Array) => {
  if (!prefix?.length) return frame;
  const out = new Uint8Array(prefix.length + frame.length);
  out.set(prefix, 0); out.set(frame, prefix.length);
  return out;
};

export class PictureDecoder {
  private mode: "none" | "hardware" | "software" | "worker" = "none";
  /** Page-side timing (phone hardware decoder, or old browsers). */
  private core: PictureCore<VideoFrame> | null = null;
  private backend: Backend | null = null;
  /** Painting worker (the normal software path); it talks to its own decoding worker. */
  private worker: Worker | null = null;
  private decodeWorker: Worker | null = null;
  private workerDecoder: "hardware" | "software" = "software";
  private workerState: { gen: number; shown: number; skip: number; ready: boolean; stats: CoreStats; painter?: string } | null = null;
  private resetGen = 0;
  private workerReady = false;
  private canvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private styleTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private detachClock: (() => void) | null = null;
  private destroyed = false;
  private failed = false;
  private needKey = true;
  private lastPushed = -1;
  private readyWaiters: Array<() => void> = [];
  private readonly frameUs: number;

  constructor(private readonly header: MkvHeader, private readonly track: MkvTrack, private readonly video: HTMLVideoElement, private readonly onFatal?: (e: Error) => void) {
    this.frameUs = Math.max(8000, Math.round((track.defaultDurationNs || 41_708_333) / 1000));
  }

  get kind() { return this.mode === "worker" ? this.workerDecoder : this.mode === "hardware" ? "hardware" : this.mode === "none" ? "none" : "software"; }
  /** Where the picture is painted: "worker" = the decoder's own thread. */
  get paintMode() { return this.mode === "worker" ? `worker-${this.workerDecoder}-${this.workerState?.painter || "?"}` : this.mode; }
  /** Time (s) of the picture on screen, -1 before the first one. */
  get shownSeconds() { return this.core ? this.core.shownSeconds : this.workerState?.shown ?? -1; }
  get skip() { return this.core ? this.core.skip : this.workerState?.skip ?? 0; }
  get stats(): CoreStats { return this.core ? this.core.stats : this.workerState?.stats || { drawn: 0, dropped: 0, resyncs: 0, ticks: 0, drawMs: 0, arrived: 0, syncMs: 0, decodeMs: 0 }; }
  get isFailed() { return this.failed; }
  get ready() { return this.core ? this.core.ready : this.workerReady; }

  private mainClock = {
    now: () => this.video.currentTime * 1e6,
    running: () => !this.video.paused && !this.video.seeking && this.video.readyState >= 3,
    rate: () => this.video.playbackRate || 1,
  };

  private markReady = () => { this.readyWaiters.splice(0).forEach((r) => r()); };

  /**
   * Opens the best decoder. Normal path: one painting worker that uses the
   * phone's hardware decoder, or the built-in software decoder (its own
   * worker) when the phone has none. Old browsers without OffscreenCanvas
   * paint on the page instead.
   */
  async open(): Promise<void> {
    if (workerPaintPossible()) {
      try { await this.openWorkerPaint(); return; } catch (e) {
        if (this.destroyed) throw e;
        console.warn("[picture] worker painting unavailable:", (e as Error).message);
        this.removeCanvas();
      }
    }
    const hw = await HardwareBackend.create(this.track, (f) => this.core?.onFrame(f), (e) => this.hardwareFailed(e));
    if (this.destroyed) { hw?.close(); throw new Error("aborted"); }
    if (hw) { this.startPageCore(hw, "hardware"); return; }
    const sw = await SoftwareBackend.create(this.track, (f) => this.core?.onFrame(f), (e) => this.fail(e), () => this.core?.feed());
    if (this.destroyed) { sw.close(); throw new Error("aborted"); }
    this.startPageCore(sw, "software");
  }

  private startPageCore(b: Backend, mode: "hardware" | "software") {
    const c = this.mountCanvas();
    const g = c.getContext("2d", { desynchronized: true } as CanvasRenderingContext2DSettings) || c.getContext("2d");
    const paint = (f: VideoFrame) => {
      if (!g) return;
      const w = f.displayWidth || f.codedWidth; const h = f.displayHeight || f.codedHeight;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      g.drawImage(f as unknown as CanvasImageSource, 0, 0, w, h);
    };
    this.backend = b;
    this.core = new PictureCore<VideoFrame>(this.frameUs, this.mainClock, paint, this.markReady);
    this.core.backend = b;
    this.mode = mode;
    const tick = () => { if (this.destroyed || !this.core) return; this.raf = requestAnimationFrame(tick); if (!this.failed) this.core.tick(); };
    this.raf = requestAnimationFrame(tick);
  }

  private async openWorkerPaint() {
    const c = this.mountCanvas();
    const off = c.transferControlToOffscreen();
    const dec = takeWorker();
    let w: Worker;
    try { w = newPaintWorker(); } catch (e) { dec.terminate(); throw e; }
    this.worker = w; this.decodeWorker = dec;
    const link = new MessageChannel();
    dec.postMessage({ type: "port", port: link.port1 }, [link.port1]);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("software decoder did not start")), 20000);
      w.onmessage = (e: MessageEvent<any>) => {
        const m = e.data;
        if (m.type === "opened") {
          clearTimeout(timer);
          if (!m.ok) { reject(new Error(m.error || "picture decoder could not open this video")); return; }
          this.workerDecoder = m.kind;
          // The phone decodes by itself: the software decoder is not needed.
          if (m.kind === "hardware") { const d = this.decodeWorker; this.decodeWorker = null; setTimeout(() => d?.terminate(), 100); }
          resolve();
          return;
        }
        if (m.type === "kind") { this.workerDecoder = m.kind; return; }
        if (m.type === "needDecoder") {
          const d = newVideoWorker(); const ch = new MessageChannel();
          this.decodeWorker = d;
          d.onerror = (ev) => this.fail(new Error(ev.message || "software decoder crashed"));
          d.postMessage({ type: "port", port: ch.port1 }, [ch.port1]);
          w.postMessage({ type: "port", port: ch.port2 }, [ch.port2]);
          return;
        }
        if (m.type === "log") { console.warn("[picture]", m.text); return; }
        if (m.type === "state") { if (m.gen === this.resetGen) this.workerState = m; return; }
        if (m.type === "ready") { if (m.gen === this.resetGen) { this.workerReady = true; this.markReady(); } return; }
        if (m.type === "error") this.fail(new Error(m.error));
      };
      const crashed = (e: ErrorEvent) => { clearTimeout(timer); const err = new Error(e.message || "software decoder crashed"); reject(err); this.fail(err); };
      w.onerror = crashed; dec.onerror = crashed;
      w.postMessage({
        type: "open", canvas: off, port: link.port2, frameUs: this.frameUs,
        codec: /HEVC/i.test(this.track.codecId) ? "hevc" : "h264",
        extra: this.track.codecPrivate?.length ? this.track.codecPrivate.slice() : null,
        hw: this.hardwareConfig(),
      }, [off, link.port2]);
    }).catch((e) => {
      this.worker = null; this.decodeWorker = null;
      try { w.terminate(); dec.terminate(); } catch { /* ignore */ }
      throw e;
    });
    if (this.destroyed) throw new Error("aborted");
    this.mode = "worker";
    this.startClockSync();
  }

  /** WebCodecs config for the phone's own decoder (sizes come from the stream itself). */
  private hardwareConfig(): VideoDecoderConfig | null {
    const codec = webCodecsVideoCodec(this.track);
    if (!codec) return null;
    return { codec, description: this.track.codecPrivate?.length ? this.track.codecPrivate.slice() : undefined, hardwareAcceleration: "prefer-hardware" };
  }

  /** The worker paints on the sound's clock: tell it where the sound is. */
  private startClockSync() {
    const v = this.video;
    const send = () => {
      if (!this.worker) return;
      this.worker.postMessage({ type: "clock", t: v.currentTime, rate: v.playbackRate || 1, running: this.mainClock.running(), at: performance.timeOrigin + performance.now() });
    };
    const events = ["play", "playing", "pause", "seeking", "seeked", "waiting", "ratechange", "timeupdate", "stalled", "canplay"];
    events.forEach((ev) => v.addEventListener(ev, send));
    this.clockTimer = setInterval(send, 400);
    this.detachClock = () => events.forEach((ev) => v.removeEventListener(ev, send));
    send();
  }

  /** A hardware decoder that errors mid-way is replaced by the software one. */
  private hardwareFailed(e: Error) {
    if (this.destroyed || this.mode !== "hardware") return;
    console.warn("[picture] hardware decoder failed, using the built-in decoder:", e.message);
    cancelAnimationFrame(this.raf);
    try { this.backend?.close(); } catch { /* ignore */ }
    this.backend = null;
    this.core?.close(); this.core = null;
    this.removeCanvas();
    this.mode = "none";
    SoftwareBackend.create(this.track, (f) => this.core?.onFrame(f), (err) => this.fail(err), () => this.core?.feed()).then((sw) => {
      if (this.destroyed) { sw.close(); return; }
      this.startPageCore(sw, "software");
      this.reset(this.video.currentTime);
    }).catch((err) => { if (!this.destroyed) this.fail(err); });
  }

  private fail(e: Error) {
    if (this.failed || this.destroyed) return;
    this.failed = true;
    this.markReady();
    this.onFatal?.(e);
  }

  private mountCanvas() {
    const v = this.video;
    const c = document.createElement("canvas");
    c.setAttribute("data-rs-picture", "1");
    c.width = this.track.width || 1280; c.height = this.track.height || 720;
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;";
    this.copyStyle(c);
    v.insertAdjacentElement("afterend", c);
    (c as unknown as { rsPicture?: PictureDecoder }).rsPicture = this; // read by player checks
    this.canvas = c;
    if (!this.styleTimer) this.styleTimer = setInterval(() => { if (this.canvas) this.copyStyle(this.canvas); }, 500);
    return c;
  }

  private removeCanvas() { const c = this.canvas; this.canvas = null; c?.remove(); }

  /** Same fit / zoom / brightness as the video element. */
  private copyStyle(c: HTMLCanvasElement) {
    const v = this.video;
    const cs = getComputedStyle(v);
    c.style.objectFit = cs.objectFit || "contain";
    c.style.filter = v.style.filter || "";
    c.style.transform = v.style.transform || "";
    c.style.transformOrigin = v.style.transformOrigin || "";
    c.style.display = v.isConnected && cs.display !== "none" ? "block" : "none";
  }

  private ptsUs(ticks: number) { return Math.round((ticks * this.header.timecodeScale) / 1000); }

  /** Queue one video block from the file (in file order). */
  push(block: MkvBlock) {
    if (this.destroyed || this.failed) return;
    const base = this.ptsUs(block.ptsTicks);
    block.frames.forEach((frame, i) => {
      const key = block.isKey && i === 0;
      if (this.needKey && !key) return;
      this.needKey = false;
      const c: Chunk = { data: withPrefix(this.track.stripPrefix, frame), pts: base + i * this.frameUs, key };
      this.lastPushed = Math.max(this.lastPushed, c.pts);
      if (this.worker) {
        const data = ownBytes(c.data);
        this.worker.postMessage({ type: "chunk", data, pts: c.pts, key: c.key }, [data.buffer]);
      } else this.core?.push(c);
    });
  }

  /** Seconds of compressed picture waiting ahead of the playhead. */
  aheadSeconds(): number {
    return this.lastPushed < 0 ? 0 : this.lastPushed / 1e6 - this.video.currentTime;
  }

  /** Seek: forget everything and start again from the next keyframe. */
  reset(seconds: number) {
    this.needKey = true;
    this.lastPushed = -1;
    if (this.worker) {
      this.resetGen += 1;
      this.workerReady = false;
      this.worker.postMessage({ type: "reset", t: seconds, gen: this.resetGen });
    } else this.core?.reset(seconds);
  }

  /** Resolves once the picture at the playhead is on screen (or decoding gave up). */
  whenReady(timeoutMs = 12000): Promise<void> {
    if (this.ready || this.failed || this.destroyed) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { this.readyWaiters = this.readyWaiters.filter((r) => r !== done); resolve(); }, timeoutMs);
      this.readyWaiters.push(done);
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    if (this.styleTimer) clearInterval(this.styleTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.detachClock?.();
    this.core?.close(); this.core = null;
    this.backend?.close(); this.backend = null;
    const w = this.worker; const dec = this.decodeWorker;
    this.worker = null; this.decodeWorker = null;
    if (w) { try { w.postMessage({ type: "close" }); } catch { /* ignore */ } }
    if (w || dec) setTimeout(() => { try { w?.terminate(); dec?.terminate(); } catch { /* ignore */ } }, 80);
    this.markReady();
    const c = this.canvas;
    this.canvas = null;
    if (c) { c.style.transition = "opacity 160ms ease"; c.style.opacity = "0"; setTimeout(() => c.remove(), 180); }
  }
}
