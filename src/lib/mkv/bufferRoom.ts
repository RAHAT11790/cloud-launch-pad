// ============================================================
// Full Media Source buffer = wait, never fail
// ============================================================
// Chrome on Android keeps only 2 MB (low-end) or 5 MB (mid-range) of audio per
// SourceBuffer, and 30–80 MB of video. Reading ahead faster than that throws
// QuotaExceededError ("The SourceBuffer is full"), which used to stop the
// chosen language a few seconds after it started. A full buffer is now just
// back-pressure: drop what is already played, wait for the playhead to use
// up what is queued, then append the same data again.

export const isQuotaError = (e: unknown): boolean => (e as { name?: string } | null)?.name === "QuotaExceededError";

/** Seconds buffered ahead of `t` in the range that contains it (0 when none). */
export function aheadOf(buffered: TimeRanges | undefined | null, t: number): number {
  if (!buffered) return 0;
  try {
    for (let i = 0; i < buffered.length; i += 1) if (t >= buffered.start(i) - 0.25 && t < buffered.end(i)) return buffered.end(i) - t;
  } catch { /* SourceBuffer removed */ }
  return 0;
}

/** Seconds held by the range around `t` (what this buffer really holds when full). */
export function heldAround(buffered: TimeRanges | undefined | null, t: number): number {
  if (!buffered) return 0;
  try {
    for (let i = 0; i < buffered.length; i += 1) if (t >= buffered.start(i) - 0.25 && t < buffered.end(i)) return buffered.end(i) - buffered.start(i);
  } catch { /* SourceBuffer removed */ }
  return 0;
}

/** Played-out media kept behind the playhead when the buffer is tight. */
export const TIGHT_BEHIND_SEC = 2;
/** Smallest read-ahead a learned cap may shrink to. */
export const MIN_CAP_SEC = 3;
/** How long to wait for playback to make room before trying again. */
export const ROOM_WAIT_MS = 400;

/** Read-ahead that fits: a bit less than what was buffered when it overflowed. */
export const learnedCap = (current: number, aheadAtFull: number): number =>
  Math.max(MIN_CAP_SEC, Math.min(current, aheadAtFull - 1));

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Remove media already played (keeping a little) and detached ranges after the playhead's range. */
export async function freeRoom(sb: SourceBuffer, t: number, idle: () => Promise<void>, keepBehind = TIGHT_BEHIND_SEC): Promise<void> {
  const cuts: Array<[number, number]> = [];
  try {
    const b = sb.buffered;
    if (b.length && b.start(0) < t - keepBehind) cuts.push([0, t - keepBehind]);
    let currentEnd = -1;
    for (let i = 0; i < b.length; i += 1) if (t >= b.start(i) - 0.25 && t < b.end(i)) currentEnd = b.end(i);
    for (let i = 0; i < b.length; i += 1) if (currentEnd >= 0 && b.start(i) > currentEnd + 0.5) { cuts.push([b.start(i), Infinity]); break; }
  } catch { return; }
  for (const [from, to] of cuts) {
    await idle();
    try { sb.remove(from, to); } catch { /* updating / removed */ }
    await idle();
  }
}

export interface RoomOptions {
  /** Current playback time. */
  clock: () => number;
  /** The data no longer matters (seek, language change, destroyed). */
  stale: () => boolean;
  /** Resolves when the SourceBuffer is not updating. */
  idle: () => Promise<void>;
  /** Called on every overflow with the seconds that fit ahead (held − kept behind). */
  onFull?: (aheadSec: number) => void;
  waitMs?: number;
}

/** Append `data`, waiting for room instead of failing. Resolves false when the data went stale. */
export async function appendWithRoom(sb: SourceBuffer, data: Uint8Array, o: RoomOptions): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    if (o.stale()) return false;
    await o.idle();
    if (o.stale()) return false;
    try {
      sb.appendBuffer(data as unknown as BufferSource);
      await o.idle();
      return true;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      const t = o.clock();
      o.onFull?.(Math.max(aheadOf(sb.buffered, t), heldAround(sb.buffered, t) - TIGHT_BEHIND_SEC));
      await freeRoom(sb, t, o.idle);
      // Right after freeing, try once more; then let playback use up the queue.
      if (attempt > 0) await sleep(o.waitMs ?? ROOM_WAIT_MS);
    }
  }
}
