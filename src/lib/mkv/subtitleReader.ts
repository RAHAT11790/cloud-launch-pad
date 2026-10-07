// ============================================================
// Embedded subtitle side-reader
// ============================================================
// Shows subtitles stored inside an .mkv WITHOUT touching native playback:
// the <video> keeps playing its own source while this reader walks the
// clusters a little ahead of the playhead and emits only subtitle cues.
// Used whenever the original audio is playing (also for E-AC3/AC3 files that
// the full engine can't remux), so turning on CC is instant and glitch-free.

import { isPgsTrack, MkvBlockStream, subtitleBlockText, unpackFrame, type MkvBlock, type MkvCue, type MkvHeader } from "./mkvDemux";
import { HttpRangeSource, type TextCue } from "./mkvEngine";
import { PgsDecoder, type PgsBitmapCue } from "./pgs";

export class MkvSubtitleReader {
  private source: HttpRangeSource;
  private reader: MkvBlockStream | null = null;
  private generation = 0;
  private running = false;
  private destroyed = false;
  private windowStart = -1;
  private lastPts = -1;
  private eof = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pgs = new Map<number, PgsDecoder>();
  private seen = new Set<string>();
  private chain: Promise<void> = Promise.resolve();
  private readonly wanted: Set<number>;

  constructor(
    url: string,
    private readonly header: MkvHeader,
    private readonly cues: MkvCue[],
    private readonly getTime: () => number,
    private readonly cb: { onTextCue?: (track: number, cue: TextCue) => void; onBitmapCue?: (track: number, cue: PgsBitmapCue) => void },
    private readonly readAhead = 25,
  ) {
    this.source = new HttpRangeSource(url);
    const subs = header.subtitles.filter((s) => s.route === "text");
    subs.filter(isPgsTrack).forEach((t) => this.pgs.set(t.number, new PgsDecoder()));
    this.wanted = new Set(subs.map((s) => s.number));
  }

  start() {
    this.restart(this.getTime());
    this.timer = setInterval(this.tick, 800);
  }

  private secs(ticks: number) { return (ticks * this.header.timecodeScale) / 1e9; }

  private cueFor(seconds: number) {
    if (!this.cues.length) return this.header.firstClusterPos;
    const target = (Math.max(0, seconds - 2) * 1e9) / this.header.timecodeScale;
    let pos = this.cues[0].pos;
    for (const c of this.cues) { if (c.timeTicks <= target) pos = c.pos; else break; }
    return pos;
  }

  private restart(t: number) {
    this.generation += 1;
    this.source.cancelPending();
    this.reader = new MkvBlockStream(this.source, this.cueFor(t), this.wanted, 512 * 1024);
    this.windowStart = Math.max(0, t - 2);
    this.lastPts = this.windowStart;
    this.eof = false;
    this.running = false;
    this.pgs.forEach((d) => d.reset());
    void this.pump(this.generation);
  }

  private tick = () => {
    if (this.destroyed) return;
    const t = this.getTime();
    // Seek outside the window we've read → jump the reader there.
    if (t < this.windowStart - 1 || t > this.lastPts + 20) { this.restart(t); return; }
    if (!this.running && !this.eof) void this.pump(this.generation);
  };

  private async pump(gen: number) {
    if (this.running || this.destroyed || !this.reader) return;
    this.running = true;
    const reader = this.reader;
    try {
      while (gen === this.generation && !this.destroyed) {
        const limit = this.getTime() + this.readAhead;
        reader.pauseAtTicks = Math.floor((limit * 1e9) / this.header.timecodeScale);
        const block = await reader.next();
        if (gen !== this.generation || this.destroyed) return;
        this.lastPts = Math.max(this.lastPts, this.secs(reader.currentClusterTicks));
        if (!block) { if (!reader.paused) this.eof = true; break; }
        this.emit(block);
      }
    } catch { /* network hiccup: next tick retries */ } finally {
      if (gen === this.generation) this.running = false;
    }
  }

  private emit(block: MkvBlock) {
    const track = this.header.subtitles.find((s) => s.number === block.track);
    if (!track) return;
    const key = `${block.track}:${block.ptsTicks}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const start = this.secs(block.ptsTicks);
    const duration = block.durationTicks > 0 ? this.secs(block.durationTicks) : 0;
    const frames = block.frames;
    this.chain = this.chain.then(async () => {
      if (this.destroyed) return;
      for (const raw of frames) {
        const frame = await unpackFrame(track, raw).catch(() => null);
        if (!frame) continue;
        if (isPgsTrack(track)) {
          const d = this.pgs.get(track.number);
          if (d) for (const cue of d.push(frame, start)) this.cb.onBitmapCue?.(track.number, cue);
        } else {
          const text = subtitleBlockText(track, frame);
          if (text) this.cb.onTextCue?.(track.number, { start, end: start + (duration || 3), text });
        }
      }
    }).catch(() => undefined);
  }

  destroy() {
    this.destroyed = true;
    this.generation += 1;
    if (this.timer) clearInterval(this.timer);
    this.source.abort();
    this.reader = null;
  }
}
