// ============================================================
// Software audio decoding for tracks the browser can't play
// ============================================================
// AC3 / E-AC3 / DTS / TrueHD (and FLAC/PCM/MP2) are decoded by a tiny WASM
// build of FFmpeg's decoders in a worker, re-wrapped as FLAC-in-MP4 and fed to
// the normal audio sidecar. The decoder (~470 KB gzipped) loads only when such
// a track is actually played.
import type { MkvBlock, MkvHeader, MkvTrack } from "./mkvDemux";
import { buildInitSegment } from "./mp4Writer";
import { DECODED_AUDIO_MIME, DECODED_CHANNELS, DECODED_RATE, decoderIdFor, flacStreamInfo } from "./flacPcm";
import type { EncodedFrame } from "./pcmFeeder";

export { DECODED_AUDIO_MIME, decoderIdFor };

/** Codec families browsers never decode themselves (Chrome/Firefox on phones and PCs). */
const NEEDS_SOFTWARE = /^(AC3|E-AC3|EAC3|DTS.*|TRUEHD|MLP)$/i;

let supportCache: boolean | null = null;
/** Can this browser play decoded audio (worker + WASM + FLAC in Media Source)? */
export function decodedAudioSupported(): boolean {
  if (supportCache !== null) return supportCache;
  try {
    const MS = typeof window !== "undefined" ? (window as any).MediaSource || (window as any).ManagedMediaSource : null;
    supportCache = !!(MS && typeof Worker !== "undefined" && typeof WebAssembly === "object" && MS.isTypeSupported(DECODED_AUDIO_MIME));
  } catch { supportCache = false; }
  return supportCache;
}

/** Can the software decoder play this track (codec name as shown in the track list)? */
export function canDecodeTrack(codec: string, opts: { zlib?: boolean; bitDepth?: number } = {}): boolean {
  return !opts.zlib && decoderIdFor(codec, opts.bitDepth) > 0 && decodedAudioSupported();
}

const NATIVE_MIME: Record<string, string[]> = {
  AC3: ['audio/mp4; codecs="ac-3"'],
  "E-AC3": ['audio/mp4; codecs="ec-3"'],
  DTS: ['audio/mp4; codecs="dtsc"', 'audio/mp4; codecs="dtsx"'],
  TRUEHD: ['audio/mp4; codecs="mlpa"'],
};
/**
 * The first audio track of an .mkv is played by the browser itself. Dolby/DTS
 * there is silent on almost every phone and PC — those files need the
 * software decoder for their own original audio too.
 */
export function nativeAudioIsSilent(codec: string): boolean {
  const c = String(codec || "").toUpperCase();
  if (!NEEDS_SOFTWARE.test(c)) return false;
  const types = NATIVE_MIME[c.startsWith("DTS") ? "DTS" : c === "EAC3" ? "E-AC3" : c] || [];
  try {
    const probe = typeof document !== "undefined" ? document.createElement("video") : null;
    const MS = typeof window !== "undefined" ? (window as any).MediaSource : null;
    if (types.some((t) => (probe && probe.canPlayType(t) === "probably") || (MS && MS.isTypeSupported(t)))) return false;
  } catch { /* treat as silent */ }
  return true;
}

/** MP4 init segment for the decoded (48 kHz stereo FLAC) stream. */
export function decodedAudioInit(): Uint8Array {
  return buildInitSegment({
    kind: "audio",
    timescale: DECODED_RATE,
    channels: DECODED_CHANNELS,
    sampleRate: DECODED_RATE,
    sampleSize: 16,
    codecPrivate: new Uint8Array(0),
    flacStreamInfo: flacStreamInfo(),
  });
}

type Reply = { id: number; ok: boolean; fragments?: Uint8Array[]; error?: string };

// A decoder started ahead of time (download + compile the WASM while the
// episode opens), so a Dolby/DTS track starts without that wait.
let warmWorker: Worker | null = null;
const takeWarmWorker = () => { const w = warmWorker; warmWorker = null; return w; };
export function prewarmAudioDecoder() {
  if (warmWorker || typeof Worker === "undefined" || !decodedAudioSupported()) return;
  try {
    warmWorker = new Worker(new URL("./audioDecode.worker.ts", import.meta.url), { type: "module" });
    warmWorker.postMessage({ type: "reset", id: 0 }); // loads the decoder; reply is ignored
  } catch { warmWorker = null; }
}

/** One decode worker per playing track; messages are answered in order. */
export class AudioDecoderClient {
  private worker: Worker;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();
  private dead: Error | null = null;

  constructor() {
    this.worker = takeWarmWorker() || new Worker(new URL("./audioDecode.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      this.waiting.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data); else w.reject(new Error(e.data.error || "audio decoder failed"));
    };
    this.worker.onerror = (e) => this.kill(new Error(e.message || "audio decoder crashed"));
  }

  private kill(error: Error) {
    this.dead = error;
    this.waiting.forEach((w) => w.reject(error));
    this.waiting.clear();
  }

  private call(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<Reply> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    return new Promise<Reply>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  async open(track: MkvTrack): Promise<void> {
    const id = decoderIdFor(track.codec, track.bitDepth);
    if (!id) throw new Error("no decoder for this audio");
    const extra = track.codecPrivate?.length ? track.codecPrivate.slice() : null;
    const r = await this.call({ type: "open", cfg: { id, extra, rate: track.sampleRate, channels: track.channels, bits: track.bitDepth } });
    if (!r.ok) throw new Error("audio decoder could not open this track");
  }
  reset() { return this.call({ type: "reset" }).then(() => undefined); }
  async push(frames: EncodedFrame[], final = false): Promise<Uint8Array[]> {
    const r = await this.call({ type: "push", frames, final }, frames.map((f) => f.data.buffer));
    return r.fragments || [];
  }
  destroy() {
    this.kill(new Error("aborted"));
    try { this.worker.terminate(); } catch { /* ignore */ }
  }
}

const join = (parts: Uint8Array[]): Uint8Array | null => {
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** Same role as AudioFragmenter, but decodes: blocks in, FLAC fMP4 out (async). */
export class DecodedAudioFragmenter {
  private pending: EncodedFrame[] = [];
  private ready: Promise<void>;
  constructor(private readonly header: MkvHeader, readonly track: MkvTrack, private readonly client: AudioDecoderClient, private readonly batch = 32) {
    this.ready = client.reset();
  }

  private toSamples(ticks: number) { return Math.round((ticks * this.header.timecodeScale * DECODED_RATE) / 1_000_000_000); }

  async push(block: MkvBlock): Promise<Uint8Array | null> {
    const prefix = this.track.stripPrefix;
    block.frames.forEach((frame, i) => {
      let data: Uint8Array;
      if (prefix?.length) { data = new Uint8Array(prefix.length + frame.length); data.set(prefix, 0); data.set(frame, prefix.length); }
      else data = frame.slice(); // own buffer: it is transferred to the worker
      this.pending.push({ data, pts: i === 0 ? this.toSamples(block.ptsTicks) : -1 });
    });
    return this.pending.length >= this.batch ? this.flush() : null;
  }

  async flush(final = false): Promise<Uint8Array | null> {
    await this.ready;
    const list = this.pending;
    this.pending = [];
    if (!list.length && !final) return null;
    return join(await this.client.push(list, final));
  }
}
