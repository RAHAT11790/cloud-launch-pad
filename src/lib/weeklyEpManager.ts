/**
 * Weekly EP Manager
 * 
 * Tracks series that release new episodes on a weekly schedule.
 * Admin enables a series for weekly tracking with: weeklyEveryDays + daysSinceLastEpisode.
 * The system computes nextReleaseAt and displays a countdown in admin/home.
 * When admin saves a new episode, timer auto-resets and entry is auto-cleared after 5 mins.
 */
import { db, ref, set, get, remove, update } from "@/lib/firebase";

export interface WeeklyPendingEntry {
  seriesId: string;
  seriesTitle: string;
  poster?: string;
  weeklyEveryDays: number;
  /** ms timestamp of last known episode release */
  lastReleasedAt: number;
  /** ms timestamp when next episode is expected */
  nextReleaseAt: number;
  /** ms timestamp when admin saved a new episode (used for 5min auto-clear) */
  releasedSavedAt?: number;
  createdAt: number;
}

export const FIVE_MINUTES_MS = 5 * 60 * 1000;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const weeklyPendingPath = (seriesId: string) => `weeklyPending/${seriesId}`;

/**
 * Enable weekly tracking for a series.
 * @param daysSinceLastEpisode - how many days ago the previous episode actually released
 */
export async function enableWeeklyForSeries(params: {
  seriesId: string;
  seriesTitle: string;
  poster?: string;
  weeklyEveryDays: number;
  daysSinceLastEpisode: number;
}) {
  const { seriesId, seriesTitle, poster, weeklyEveryDays, daysSinceLastEpisode } = params;
  const safeEvery = Math.max(1, Number(weeklyEveryDays) || 7);
  const safeSince = Math.max(0, Math.min(safeEvery * 4, Number(daysSinceLastEpisode) || 0));
  const now = Date.now();
  const lastReleasedAt = now - safeSince * ONE_DAY_MS;
  const nextReleaseAt = lastReleasedAt + safeEvery * ONE_DAY_MS;

  const entry: WeeklyPendingEntry = {
    seriesId,
    seriesTitle,
    poster,
    weeklyEveryDays: safeEvery,
    lastReleasedAt,
    nextReleaseAt,
    createdAt: now,
  };
  await set(ref(db, weeklyPendingPath(seriesId)), entry);
  return entry;
}

/**
 * Mark a new episode as released — resets the timer and triggers the 5-minute
 * auto-clear window. The entry will then be removed by sweepExpiredWeekly().
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
    releasedSavedAt: now,
  });
}

export async function disableWeeklyForSeries(seriesId: string) {
  await remove(ref(db, weeklyPendingPath(seriesId)));
}

/**
 * Remove entries whose 5-minute auto-clear window has elapsed since the
 * admin saved a new episode. Should run on admin panel mount + on interval.
 */
export async function sweepExpiredWeekly() {
  const snap = await get(ref(db, "weeklyPending"));
  if (!snap.exists()) return 0;
  const data = snap.val() || {};
  const now = Date.now();
  const updates: Record<string, null> = {};
  Object.entries(data).forEach(([sid, raw]: [string, any]) => {
    const e = raw as WeeklyPendingEntry;
    if (e?.releasedSavedAt && now - e.releasedSavedAt >= FIVE_MINUTES_MS) {
      updates[`weeklyPending/${sid}`] = null;
    }
  });
  if (Object.keys(updates).length > 0) {
    await update(ref(db), updates as any);
  }
  return Object.keys(updates).length;
}

export interface WeeklyStatus {
  isOverdue: boolean;
  isReleasedRecently: boolean; // saved within 5 min window
  msUntilNext: number;
  daysUntilNext: number;
  hoursUntilNext: number;
  countdownLabel: string;
}

export function computeWeeklyStatus(entry: WeeklyPendingEntry): WeeklyStatus {
  const now = Date.now();
  const msUntilNext = Math.max(0, entry.nextReleaseAt - now);
  const overdueMs = Math.max(0, now - entry.nextReleaseAt);
  const isOverdue = msUntilNext === 0;
  const isReleasedRecently = !!entry.releasedSavedAt && now - entry.releasedSavedAt < FIVE_MINUTES_MS;

  const daysUntilNext = Math.floor(msUntilNext / ONE_DAY_MS);
  const hoursUntilNext = Math.floor((msUntilNext % ONE_DAY_MS) / (60 * 60 * 1000));
  const minsUntilNext = Math.floor((msUntilNext % (60 * 60 * 1000)) / 60000);

  let countdownLabel = "";
  if (isReleasedRecently) {
    const remain = Math.max(0, FIVE_MINUTES_MS - (now - (entry.releasedSavedAt || 0)));
    const m = Math.floor(remain / 60000);
    const s = Math.floor((remain % 60000) / 1000).toString().padStart(2, "0");
    countdownLabel = `Released • clears in ${m}:${s}`;
  } else if (isOverdue) {
    const overdueDays = Math.floor(overdueMs / ONE_DAY_MS);
    const overdueHrs = Math.floor((overdueMs % ONE_DAY_MS) / (60 * 60 * 1000));
    countdownLabel = overdueDays > 0 ? `Overdue ${overdueDays}d ${overdueHrs}h` : `Overdue ${overdueHrs}h`;
  } else if (daysUntilNext > 0) {
    countdownLabel = `${daysUntilNext}d ${hoursUntilNext}h left`;
  } else if (hoursUntilNext > 0) {
    countdownLabel = `${hoursUntilNext}h ${minsUntilNext}m left`;
  } else {
    countdownLabel = `${minsUntilNext}m left`;
  }

  return { isOverdue, isReleasedRecently, msUntilNext, daysUntilNext, hoursUntilNext, countdownLabel };
}
