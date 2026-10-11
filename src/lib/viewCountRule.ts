// View-count rule: one view per user per series per 24h, and only after the
// user has actually watched at least 5 minutes OR 40% of the video (whichever
// comes first — short videos only need 40%).
export const VIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const VIEW_MIN_SECONDS = 5 * 60;
export const VIEW_MIN_FRACTION = 0.4;

export function requiredWatchSeconds(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return VIEW_MIN_SECONDS;
  return Math.min(VIEW_MIN_SECONDS, duration * VIEW_MIN_FRACTION);
}

export function hasWatchedEnough(watchedSeconds: number, duration: number): boolean {
  return watchedSeconds >= requiredWatchSeconds(duration);
}

export function canCountView(lastCountedAt: number | null | undefined, now: number): boolean {
  if (!lastCountedAt) return true;
  return now - lastCountedAt >= VIEW_COOLDOWN_MS;
}
