import { afterEach, describe, expect, it, vi } from "vitest";
import { PictureCore, type Chunk, type CoreBackend, type Pic } from "@/lib/mkv/pictureCore";

// A fake decoder: every packet becomes one picture after `delayTicks` ticks.
const setup = (opts: { decodeMs?: number } = {}) => {
  let now = 0; // µs
  const shown: number[] = [];
  const pending: Array<{ c: Chunk; at: number }> = [];
  const skips: number[] = [];
  let tick = 0;
  const backend: CoreBackend = {
    kind: "software",
    pending: () => pending.length,
    decode: (c) => { pending.push({ c, at: tick + 1 }); },
    reset: () => { pending.length = 0; },
    setSkip: (l) => { skips.push(l); },
  };
  const core = new PictureCore<Pic>(41_708, { now: () => now, running: () => true, rate: () => 1 }, (p) => { shown.push(p.timestamp); }, () => {});
  core.backend = backend;
  if (opts.decodeMs) core.stats.decodeMs = opts.decodeMs;
  const step = () => {
    tick += 1;
    while (pending.length && pending[0].at <= tick) {
      const { c } = pending.shift()!;
      core.onFrame({ timestamp: c.pts, close: () => {} });
    }
    core.tick();
  };
  return { core, shown, skips, setNow: (t: number) => { now = t; }, step };
};

const chunks = (from: number, n: number, keyEvery = 48): Chunk[] =>
  Array.from({ length: n }, (_, i) => ({ data: new Uint8Array(1), pts: Math.round((from + i) * 41_708), key: (from + i) % keyEvery === 0 }));

describe("picture timing (H.265 software path)", () => {
  it("never paints a picture before the sound reaches it", () => {
    const t = setup();
    t.core.reset(0);
    chunks(0, 48).forEach((c) => t.core.push(c));
    for (let ms = 0; ms < 1500; ms += 16) {
      t.setNow(ms * 1000);
      t.step();
      // the first picture after a seek is shown at once; every later one only when due
      t.shown.slice(1).forEach((pts) => expect(pts).toBeLessThanOrEqual(ms * 1000 + 41_708 / 2));
    }
    expect(t.shown.length).toBeGreaterThan(30);
  });

  it("starts from the next keyframe after a seek (no grey half-pictures)", () => {
    const t = setup();
    t.core.reset(5);
    chunks(100, 10).forEach((c) => t.core.push(c)); // no keyframe among these (100..109)
    for (let i = 0; i < 5; i++) t.step();
    expect(t.shown).toEqual([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("lowers the quality step when the decoder needs longer than a picture lasts — but never to keyframes-only just for being busy", () => {
    let wall = 0;
    vi.spyOn(performance, "now").mockImplementation(() => wall);
    const t = setup({ decodeMs: 60 }); // 60 ms per picture, a picture lasts ~42 ms
    t.core.reset(0);
    chunks(0, 600).forEach((c) => t.core.push(c));
    const levels = new Set<number>();
    for (let ms = 0; ms < 8000; ms += 16) {
      wall = ms; t.setNow(ms * 1000); t.core.stats.decodeMs = 60;
      t.step();
      levels.add(t.core.skip);
    }
    expect(levels.has(1)).toBe(true);
    expect(Math.max(...levels)).toBe(2);
  });

  it("goes back to full quality once the decoder is fast again", () => {
    let wall = 0;
    vi.spyOn(performance, "now").mockImplementation(() => wall);
    const t = setup({ decodeMs: 60 });
    t.core.reset(0);
    chunks(0, 1200).forEach((c) => t.core.push(c));
    for (let ms = 0; ms < 4000; ms += 16) { wall = ms; t.setNow(ms * 1000); t.core.stats.decodeMs = 60; t.step(); }
    expect(t.core.skip).toBeGreaterThan(0);
    for (let ms = 4000; ms < 30000; ms += 16) { wall = ms; t.setNow(ms * 1000); t.core.stats.decodeMs = 10; t.step(); }
    expect(t.core.skip).toBe(0);
  });
});
