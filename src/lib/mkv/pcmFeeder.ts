// ============================================================
// Decoded-audio feeder: compressed frames → WASM decoder → FLAC fMP4
// ============================================================
// Pure (no DOM): runs inside the decode worker and in unit tests. Keeps the
// running sample clock so every fragment lands at the episode's real time.
import type { RsAudioModule } from "./wasm/rsaudio";
import { DECODED_RATE, FLAC_BLOCK, encodeFlacFrame } from "./flacPcm";
import { buildFragment, type Mp4Sample } from "./mp4Writer";

export interface DecoderOpen { id: number; extra?: Uint8Array | null; rate?: number; channels?: number; bits?: number }
/** One compressed frame; `pts` is in 48 kHz samples, or -1 when it simply follows the previous frame. */
export interface EncodedFrame { data: Uint8Array; pts: number }

/** A timestamp this far from the running clock is a real gap (seek, missing data). */
const GAP_SAMPLES = DECODED_RATE / 10;

export class PcmFeeder {
  private pcm = new Float32Array(FLAC_BLOCK * 8);
  private len = 0;            // stereo frames waiting in `pcm`
  private start = -1;         // sample position of pcm[0]
  private seq = 1;
  private samples: Mp4Sample[] = [];
  private fragStart = -1;
  private out: Uint8Array[] = [];

  constructor(private readonly m: RsAudioModule) {}

  open(cfg: DecoderOpen): boolean {
    let ptr = 0;
    const extra = cfg.extra && cfg.extra.length ? cfg.extra : null;
    if (extra) { ptr = this.m._rs_alloc(extra.length); this.m.HEAPU8.set(extra, ptr); }
    const r = this.m._rs_open(cfg.id, ptr, extra ? extra.length : 0, Math.round(cfg.rate || 0), cfg.channels || 0, cfg.bits || 0);
    if (ptr) this.m._rs_free(ptr);
    this.resetClock();
    return r === 0;
  }

  close() { try { this.m._rs_close(); } catch { /* ignore */ } }

  private resetClock() { this.len = 0; this.start = -1; this.samples = []; this.fragStart = -1; this.out = []; }

  /** After a seek: forget decoder history and the clock. */
  reset() { this.m._rs_reset(); this.resetClock(); }

  private emitFrame(frames: number) {
    const at = this.start;
    const data = encodeFlacFrame(this.pcm, 0, frames, at);
    if (this.fragStart < 0) this.fragStart = at;
    this.samples.push({ data, duration: frames, cto: 0, isKey: true });
    this.pcm.copyWithin(0, frames * 2, this.len * 2);
    this.len -= frames;
    this.start += frames;
  }

  private closeFragment() {
    if (!this.samples.length) return;
    this.out.push(buildFragment(this.seq++, Math.max(0, this.fragStart), this.samples, 1));
    this.samples = [];
    this.fragStart = -1;
  }

  /** Emit every full block; with `all`, also the remainder. */
  private drain(all: boolean) {
    while (this.len >= FLAC_BLOCK) this.emitFrame(FLAC_BLOCK);
    if (all && this.len > 0) this.emitFrame(this.len);
  }

  private append(ptr: number, frames: number) {
    const need = (this.len + frames) * 2;
    if (need > this.pcm.length) { const n = new Float32Array(Math.max(need, this.pcm.length * 2)); n.set(this.pcm.subarray(0, this.len * 2)); this.pcm = n; }
    const src = this.m.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + frames * 2);
    this.pcm.set(src, this.len * 2);
    this.len += frames;
  }

  /** Decode frames; returns finished fMP4 fragments (may be empty). */
  push(frames: EncodedFrame[], final = false): Uint8Array[] {
    for (const f of frames) {
      if (f.pts >= 0) {
        const expected = this.start < 0 ? -1 : this.start + this.len;
        if (expected < 0) this.start = f.pts;
        else if (Math.abs(f.pts - expected) > GAP_SAMPLES) {
          // Real gap: finish what we have and restart the clock at this frame.
          this.drain(true); this.closeFragment();
          this.len = 0; this.start = f.pts;
        }
      } else if (this.start < 0) continue; // nothing to anchor this frame to yet
      const p = this.m._rs_alloc(f.data.length);
      this.m.HEAPU8.set(f.data, p);
      const n = this.m._rs_decode(p, f.data.length);
      this.m._rs_free(p);
      if (n > 0) this.append(this.m._rs_out(), n);
    }
    this.drain(final);
    this.closeFragment();
    const out = this.out;
    this.out = [];
    return out;
  }
}
