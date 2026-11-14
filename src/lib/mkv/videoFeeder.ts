// ============================================================
// VideoFeeder — drives the WASM HEVC/H.264 decoder (pure, Node-testable)
// ============================================================
import type { RsVideoModule } from "./wasm/rsvideo";

export interface DecodedPicture { width: number; height: number; pts: number; data: Uint8Array }

/** One compressed frame in → zero or more I420 pictures out (presentation order). */
export class VideoFeeder {
  private buf = 0;
  private cap = 0;
  constructor(private readonly m: RsVideoModule) {}

  open(codec: "hevc" | "h264", extra: Uint8Array | null, threads = 1): boolean {
    this.m._rv_set_threads?.(threads);
    let p = 0;
    if (extra?.length) { p = this.m._rv_alloc(extra.length); this.m.HEAPU8.set(extra, p); }
    const r = this.m._rv_open(codec === "h264" ? 2 : 1, p, extra?.length || 0);
    if (p) this.m._rv_free(p);
    return r === 0;
  }

  setSkip(level: number) { this.m._rv_set_skip(level); }
  flush() { this.m._rv_flush(); }

  private collect(out: (pic: DecodedPicture) => void) {
    while (this.m._rv_receive() === 1) {
      const w = this.m._rv_w(); const h = this.m._rv_h();
      const size = w * h + 2 * (w / 2) * (h / 2);
      const ptr = this.m._rv_frame();
      out({ width: w, height: h, pts: this.m._rv_pts(), data: this.m.HEAPU8.subarray(ptr, ptr + size) });
    }
  }

  /** `out` receives views into decoder memory: copy them before the next call. */
  decode(data: Uint8Array, pts: number, out: (pic: DecodedPicture) => void) {
    if (data.length > this.cap) {
      if (this.buf) this.m._rv_free(this.buf);
      this.cap = Math.max(data.length, this.cap * 2, 256 * 1024);
      this.buf = this.m._rv_alloc(this.cap);
    }
    this.m.HEAPU8.set(data, this.buf);
    let r = this.m._rv_send(this.buf, data.length, pts);
    if (r === 1) { this.collect(out); r = this.m._rv_send(this.buf, data.length, pts); }
    this.collect(out);
    return r >= 0;
  }

  drain(out: (pic: DecodedPicture) => void) { this.m._rv_send_eof(); this.collect(out); }
  close() { if (this.buf) this.m._rv_free(this.buf); this.buf = 0; this.cap = 0; this.m._rv_close(); }
}
