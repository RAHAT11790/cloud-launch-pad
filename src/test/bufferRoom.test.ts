import { describe, expect, it } from "vitest";
import { appendWithRoom, learnedCap, MIN_CAP_SEC } from "@/lib/mkv/bufferRoom";

/** Fake SourceBuffer holding `capacity` seconds of 1-second chunks, like a phone's small audio buffer. */
function fakeBuffer(capacity: number) {
  const chunks: number[] = []; // start second of each 1 s chunk
  const sb: any = {
    updating: false,
    get buffered() {
      const sorted = [...chunks].sort((a, b) => a - b);
      const ranges: Array<[number, number]> = [];
      for (const s of sorted) { const last = ranges[ranges.length - 1]; if (last && last[1] === s) last[1] = s + 1; else ranges.push([s, s + 1]); }
      return { length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] };
    },
    appendBuffer(data: Uint8Array) {
      if (chunks.length >= capacity) { const e = new Error("The SourceBuffer is full"); (e as any).name = "QuotaExceededError"; throw e; }
      chunks.push(data[0]);
    },
    remove(from: number, to: number) { for (let i = chunks.length - 1; i >= 0; i -= 1) if (chunks[i] >= from && chunks[i] + 1 <= to) chunks.splice(i, 1); },
    addEventListener() {}, removeEventListener() {},
  };
  return { sb, chunks };
}

describe("full phone audio buffer", () => {
  it("a full buffer waits for playback instead of stopping the language", async () => {
    const { sb, chunks } = fakeBuffer(10); // ~2 MB of decoded Dolby audio ≈ 10 s
    let now = 0;
    let cap = Infinity;
    const opts = { clock: () => now, stale: () => false, idle: () => Promise.resolve(), waitMs: 5, onFull: (a: number) => { cap = learnedCap(cap, a); } };
    for (let s = 0; s < 10; s += 1) expect(await appendWithRoom(sb, new Uint8Array([s]), opts)).toBe(true);
    // 11th second does not fit until the playhead moves on
    const pending = appendWithRoom(sb, new Uint8Array([10]), opts);
    setTimeout(() => { now = 4; }, 30);
    await expect(pending).resolves.toBe(true);
    expect(chunks).toContain(10);
    expect(Math.min(...chunks)).toBeGreaterThanOrEqual(2); // played audio before 4 − 2 s was dropped
    expect(cap).toBe(7); // learned: holds 10 s, 2 s kept behind, 1 s margin → read 7 s ahead
  });

  it("a seek while waiting drops the stale data without an error", async () => {
    const { sb } = fakeBuffer(3);
    let stale = false;
    const opts = { clock: () => 0, stale: () => stale, idle: () => Promise.resolve(), waitMs: 5 };
    for (let s = 0; s < 3; s += 1) await appendWithRoom(sb, new Uint8Array([s]), opts);
    const pending = appendWithRoom(sb, new Uint8Array([3]), opts);
    setTimeout(() => { stale = true; }, 20);
    await expect(pending).resolves.toBe(false);
  });

  it("other append errors still surface", async () => {
    const sb: any = { updating: false, buffered: { length: 0 }, appendBuffer() { throw new Error("decode error"); } };
    await expect(appendWithRoom(sb, new Uint8Array([0]), { clock: () => 0, stale: () => false, idle: () => Promise.resolve() })).rejects.toThrow("decode error");
  });

  it("the learned read-ahead never drops below the minimum", () => {
    expect(learnedCap(45, 1)).toBe(MIN_CAP_SEC);
    expect(learnedCap(25, 12)).toBe(11);
    expect(learnedCap(8, 30)).toBe(8);
  });
});
