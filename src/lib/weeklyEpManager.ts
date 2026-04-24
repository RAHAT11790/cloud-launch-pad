/**
 * Weekly EP Manager — v2
 *
 * Two key fields per series:
 *   - weeklyEveryDays  (e.g. 7) — how often a new episode releases
 *   - missingDays      (e.g. 5) — how many days have already passed
 *                                  since the LAST known episode release.
 *
 * Logic:
 *   lastReleasedAt = now - missingDays * day
 *   nextReleaseAt  = lastReleasedAt + weeklyEveryDays * day
 *
 * Lifecycle:
 *   1. Admin enables weekly tracking → entry written, status = "ticking".
 *   2. Timer keeps counting toward nextReleaseAt.
 *   3. When nextReleaseAt is reached → status flips to "pending"
 *      (a popup/badge appears in admin → "এপিসোড রিলিজ করুন"),
 *      and the series shows up in the Pending Releases list.
 *      The pending entry stays forever until admin acts (NO timer).
 *   4. Admin opens the series, adds the new episode and saves
 *      → markWeeklyEpisodeReleased() runs:
 *         - lastReleasedAt = now
 *         - nextReleaseAt  = now + weeklyEveryDays * day
 *         - releasedSavedAt = now  → starts the 5-min auto-clear of the
 *           pending message (entry itself stays alive, only the
 *           "released" badge auto-clears).
 *   5. After 5 min the pending notification disappears and the entry
 *      goes back to "ticking" until the next cycle.
 *
 * Calendar support:
 *   firstCycleStart / firstCycleEnd — admin can pick the first 7-day
 *   cycle on a calendar; we derive weeklyEveryDays + missingDays from it.
 */
import { db, ref, set, get, remove, update } from "@/lib/firebase";

export interface WeeklyPendingEntry {
  seriesId: string;
  seriesTitle: string;
  poster?: string;
  weeklyEveryDays: number;
  /** Days that had already passed when admin enabled tracking. */
  missingDays?: number;
  /** ms timestamp of last known episode release */
  lastReleasedAt: number;
  /** ms timestamp when next episode is expected */
  nextReleaseAt: number;
  /** ms timestamp when admin saved a new episode (starts 5-min auto-clear) */
  releasedSavedAt?: number;
  /** Optional first cycle range from calendar picker */
  firstCycleStart?: number;
  firstCycleEnd?: number;
  createdAt: number;
}

export const FIVE_MINUTES_MS = 5 * 60 * 1000;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const weeklyPendingPath = (seriesId: string) => `weeklyPending/${seriesId}`;

/**
 * Enable weekly tracking for a series.
 * `missingDays` = days passed since the LAST episode release.
 *
 * Example: cycle = 7, missingDays = 5
 *   → next episode appears in 7 - 5 = 2 days.
 */
export async function enableWeeklyForSeries(params: {
  seriesId: string;
  seriesTitle: string;
  poster?: string;
  weeklyEveryDays: number;
  missingDays: number;
  firstCycleStart?: number;
  firstCycleEnd?: number;
}) {
  const {
    seriesId,
    seriesTitle,
    poster,
    weeklyEveryDays,
    missingDays,
    firstCycleStart,
    firstCycleEnd,
  } = params;

  const safeEvery = Math.max(1, Number(weeklyEveryDays) || 7);
  // missingDays may legitimately exceed cycle (overdue) — clamp only to non-negative
  const safeMissing = Math.max(0, Number(missingDays) || 0);
  const now = Date.now();
  const lastReleasedAt = now - safeMissing * ONE_DAY_MS;
  const nextReleaseAt = lastReleasedAt + safeEvery * ONE_DAY_MS;

  const entry: WeeklyPendingEntry = {
    seriesId,
    seriesTitle,
    poster,
    weeklyEveryDays: safeEvery,
    missingDays: safeMissing,
    lastReleasedAt,
    nextReleaseAt,
    firstCycleStart,
    firstCycleEnd,
    createdAt: now,
  };
  await set(ref(db, weeklyPendingPath(seriesId)), entry);
  return entry;
}

/**
 * Called automatically when admin saves a new episode for a tracked series.
 *   - Resets timer for the next cycle.
 *   - Starts the 5-minute auto-clear window for the "released" badge.
 *   - The entry itself stays alive — only the badge clears, then the
 *     entry continues counting toward the next cycle.
 */
export async function markWeeklyEpisodeReleased(seriesId: string) {
  const snap = await get(ref(db, weeklyPendingPath(seriesId)));
  if (!snap.exists()) return;
  const entry = snap.val() as WeeklyPendingEntry;
  const now = Date.now();
  const safeEvery = Math.max(1, Number(entry.weeklyEveryDays) || 7);
  await update(ref(db, weeklyPendingPath(seriesId)), {
    lastReleasedAt: now,
    nextReleaseAt: now + safeEvery * ONE_DAY_MS,
    missingDays: 0,
    releasedSavedAt: now,
  });
}

export async function disableWeeklyForSeries(seriesId: string) {
  await remove(ref(db, weeklyPendingPath(seriesId)));
}

/**
 * Sweep ONLY the `releasedSavedAt` flag after 5 min.
 * Entries themselves are NEVER auto-deleted — they keep cycling.
 */
export async function sweepExpiredWeekly() {
  const snap = await get(ref(db, "weeklyPending"));
  if (!snap.exists()) return 0;
  const data = snap.val() || {};
  const now = Date.now();
  const updates: Record<string, null | number> = {};
  Object.entries(data).forEach(([sid, raw]: [string, any]) => {
    const e = raw as WeeklyPendingEntry;
    if (e?.releasedSavedAt && now - e.releasedSavedAt >= FIVE_MINUTES_MS) {
      // Clear only the released badge flag, keep the entry alive
      updates[`weeklyPending/${sid}/releasedSavedAt`] = null;
    }
  });
  if (Object.keys(updates).length > 0) {
    await update(ref(db), updates as any);
  }
  return Object.keys(updates).length;
}

export interface WeeklyStatus {
  /** Timer has reached zero — admin needs to add a new episode. */
  isPending: boolean;
  /** Admin saved a new ep within the last 5 minutes. */
  isReleasedRecently: boolean;
  /** Too old / too many missed cycles — hide from weekly action lists. */
  isStale: boolean;
  msUntilNext: number;
  daysUntilNext: number;
  hoursUntilNext: number;
  countdownLabel: string;
  /** Numeric days display: e.g. "5/7" → 5 days passed of a 7-day cycle */
  progressLabel: string;
}

export function computeWeeklyStatus(entry: WeeklyPendingEntry): WeeklyStatus {
  const now = Date.now();
  const msUntilNext = Math.max(0, entry.nextReleaseAt - now);
  const overdueMs = Math.max(0, now - entry.nextReleaseAt);
  const isPending = msUntilNext === 0;
  const isReleasedRecently =
    !!entry.releasedSavedAt && now - entry.releasedSavedAt < FIVE_MINUTES_MS;
  const staleThresholdMs = Math.max(entry.weeklyEveryDays * ONE_DAY_MS * 2, 14 * ONE_DAY_MS);
  const isStale = overdueMs > staleThresholdMs;

  const daysUntilNext = Math.floor(msUntilNext / ONE_DAY_MS);
  const hoursUntilNext = Math.floor((msUntilNext % ONE_DAY_MS) / (60 * 60 * 1000));
  const minsUntilNext = Math.floor((msUntilNext % (60 * 60 * 1000)) / 60000);

  // Progress: days passed of cycle
  const cycleMs = Math.max(1, entry.weeklyEveryDays) * ONE_DAY_MS;
  const passedMs = Math.max(0, now - entry.lastReleasedAt);
  const passedDays = Math.min(entry.weeklyEveryDays, Math.floor(passedMs / ONE_DAY_MS));
  const progressLabel = `${passedDays}/${entry.weeklyEveryDays}d`;

  let countdownLabel = "";
  if (isReleasedRecently) {
    const remain = Math.max(
      0,
      FIVE_MINUTES_MS - (now - (entry.releasedSavedAt || 0)),
    );
    const m = Math.floor(remain / 60000);
    const s = Math.floor((remain % 60000) / 1000)
      .toString()
      .padStart(2, "0");
    countdownLabel = `Released ✓ clears in ${m}:${s}`;
  } else if (isPending) {
    const overdueDays = Math.floor(overdueMs / ONE_DAY_MS);
    const overdueHrs = Math.floor((overdueMs % ONE_DAY_MS) / (60 * 60 * 1000));
    countdownLabel =
      overdueDays > 0
        ? `Release now! (${overdueDays}d ${overdueHrs}h overdue)`
        : `Release now! (${overdueHrs}h overdue)`;
  } else if (daysUntilNext > 0) {
    countdownLabel = `${daysUntilNext}d ${hoursUntilNext}h left`;
  } else if (hoursUntilNext > 0) {
    countdownLabel = `${hoursUntilNext}h ${minsUntilNext}m left`;
  } else {
    countdownLabel = `${minsUntilNext}m left`;
  }

  return {
    isPending,
    isReleasedRecently,
    isStale,
    msUntilNext,
    daysUntilNext,
    hoursUntilNext,
    countdownLabel,
    progressLabel,
  };
}

export function shouldShowWeeklyEntry(entry: WeeklyPendingEntry) {
  const status = computeWeeklyStatus(entry);
  return !status.isStale;
}

/**
 * Helper: derive (weeklyEveryDays, missingDays) from a calendar range
 * representing the FIRST cycle (e.g. 1st → 7th).
 */
export function deriveFromCycleRange(
  firstStart: Date,
  firstEnd: Date,
): { weeklyEveryDays: number; missingDays: number } {
  const startMs = new Date(firstStart).setHours(0, 0, 0, 0);
  const endMs = new Date(firstEnd).setHours(0, 0, 0, 0);
  const cycle = Math.max(1, Math.round((endMs - startMs) / ONE_DAY_MS));
  const today = new Date().setHours(0, 0, 0, 0);
  // Last EP release is the START of the current cycle that contains today
  const sinceStart = Math.max(0, Math.floor((today - startMs) / ONE_DAY_MS));
  const missingDays = sinceStart % cycle;
  return { weeklyEveryDays: cycle, missingDays };
}
