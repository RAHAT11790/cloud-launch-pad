// ============================================================
// PGS (Blu-ray image subtitle) decoder
// ============================================================
// Many of our BluRay rips carry the dialogue subtitles as PGS bitmaps instead
// of text. Each Matroska block holds one display set (segments without the
// "PG" file header). We decode palette + RLE objects to RGBA bitmaps.

export interface PgsBitmap { x: number; y: number; width: number; height: number; rgba: Uint8ClampedArray }
export interface PgsBitmapCue {
  start: number;
  /** Updated in place when the next display set clears/replaces this one. */
  end: number;
  planeWidth: number;
  planeHeight: number;
  bitmaps: PgsBitmap[];
}

interface PcsObject { objectId: number; x: number; y: number; crop?: { x: number; y: number; w: number; h: number } }
interface OdsObject { width: number; height: number; chunks: Uint8Array[]; expected: number }

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export class PgsDecoder {
  private pal = new Uint8ClampedArray(256 * 4);
  private objects = new Map<number, OdsObject>();
  private current: PgsBitmapCue | null = null;
  private plane = { w: 1920, h: 1080 };
  private pcsObjects: PcsObject[] = [];

  reset() {
    this.objects.clear();
    this.pcsObjects = [];
    this.current = null;
  }

  private setPaletteEntry(id: number, y: number, cr: number, cb: number, a: number) {
    const o = id * 4;
    this.pal[o] = clamp(Math.round(y + 1.402 * (cr - 128)));
    this.pal[o + 1] = clamp(Math.round(y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128)));
    this.pal[o + 2] = clamp(Math.round(y + 1.772 * (cb - 128)));
    this.pal[o + 3] = a;
  }

  private decodeRle(obj: OdsObject): Uint8ClampedArray | null {
    const { width, height } = obj;
    if (!width || !height || width * height > 4096 * 2160) return null;
    let total = 0;
    for (const c of obj.chunks) total += c.length;
    const data = new Uint8Array(total);
    let off = 0;
    for (const c of obj.chunks) { data.set(c, off); off += c.length; }
    const out = new Uint8ClampedArray(width * height * 4);
    let x = 0; let y = 0; let i = 0;
    const put = (color: number, run: number) => {
      const o = color * 4;
      for (let k = 0; k < run && x < width; k += 1, x += 1) {
        const p = (y * width + x) * 4;
        out[p] = this.pal[o]; out[p + 1] = this.pal[o + 1]; out[p + 2] = this.pal[o + 2]; out[p + 3] = this.pal[o + 3];
      }
    };
    while (i < data.length && y < height) {
      const b = data[i++];
      if (b !== 0) { put(b, 1); continue; }
      const n = data[i++];
      if (n === undefined) break;
      if (n === 0) { x = 0; y += 1; continue; }
      const flag = n & 0xc0;
      if (flag === 0x00) put(0, n & 0x3f);
      else if (flag === 0x40) put(0, ((n & 0x3f) << 8) | data[i++]);
      else if (flag === 0x80) { const len = n & 0x3f; put(data[i++], len); }
      else { const len = ((n & 0x3f) << 8) | data[i++]; put(data[i++], len); }
    }
    return out;
  }

  /** Feed one Matroska PGS block (a display set). Returns newly started cues. */
  push(block: Uint8Array, time: number): PgsBitmapCue[] {
    const started: PgsBitmapCue[] = [];
    let i = 0;
    while (i + 3 <= block.length) {
      const type = block[i];
      const size = (block[i + 1] << 8) | block[i + 2];
      const seg = block.subarray(i + 3, i + 3 + size);
      i += 3 + size;
      if (type === 0x16 && seg.length >= 11) {
        this.plane = { w: (seg[0] << 8) | seg[1], h: (seg[2] << 8) | seg[3] };
        const state = seg[7];
        if (state & 0x80 || state & 0x40) this.objects.clear(); // epoch start / acquisition point
        const count = seg[10];
        const objs: PcsObject[] = [];
        let p = 11;
        for (let k = 0; k < count && p + 8 <= seg.length; k += 1) {
          const objectId = (seg[p] << 8) | seg[p + 1];
          const cropped = seg[p + 3] & 0x80;
          const ox = (seg[p + 4] << 8) | seg[p + 5];
          const oy = (seg[p + 6] << 8) | seg[p + 7];
          p += 8;
          let crop: PcsObject["crop"];
          if (cropped && p + 8 <= seg.length) {
            crop = { x: (seg[p] << 8) | seg[p + 1], y: (seg[p + 2] << 8) | seg[p + 3], w: (seg[p + 4] << 8) | seg[p + 5], h: (seg[p + 6] << 8) | seg[p + 7] };
            p += 8;
          }
          objs.push({ objectId, x: ox, y: oy, crop });
        }
        this.pcsObjects = objs;
      } else if (type === 0x14 && seg.length >= 2) {
        for (let p = 2; p + 5 <= seg.length; p += 5) this.setPaletteEntry(seg[p], seg[p + 1], seg[p + 2], seg[p + 3], seg[p + 4]);
      } else if (type === 0x15 && seg.length >= 4) {
        const id = (seg[0] << 8) | seg[1];
        const seq = seg[3];
        if (seq & 0x80) {
          if (seg.length < 11) continue;
          const len = (seg[4] << 16) | (seg[5] << 8) | seg[6];
          const w = (seg[7] << 8) | seg[8];
          const h = (seg[9] << 8) | seg[10];
          this.objects.set(id, { width: w, height: h, chunks: [seg.slice(11)], expected: Math.max(0, len - 4) });
        } else {
          this.objects.get(id)?.chunks.push(seg.slice(4));
        }
      } else if (type === 0x80) {
        // End of display set → close the previous cue and maybe start a new one.
        if (this.current && this.current.end > time) this.current.end = time;
        this.current = null;
        if (!this.pcsObjects.length) continue;
        const bitmaps: PgsBitmap[] = [];
        for (const po of this.pcsObjects) {
          const obj = this.objects.get(po.objectId);
          if (!obj) continue;
          const rgba = this.decodeRle(obj);
          if (!rgba) continue;
          bitmaps.push({ x: po.x, y: po.y, width: obj.width, height: obj.height, rgba });
        }
        if (!bitmaps.length) continue;
        const cue: PgsBitmapCue = { start: time, end: time + 8, planeWidth: this.plane.w, planeHeight: this.plane.h, bitmaps };
        this.current = cue;
        started.push(cue);
      }
    }
    return started;
  }
}
