// View-count rule: one view per device per series every 24h, counted once the
// viewer has stayed on the player for 20 seconds.
export const VIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const VIEW_MIN_SECONDS = 20;

export function hasWatchedEnough(watchedSeconds: number): boolean {
  return watchedSeconds >= VIEW_MIN_SECONDS;
}

export function canCountView(lastCountedAt: number | null | undefined, now: number): boolean {
  if (!lastCountedAt) return true;
  return now - lastCountedAt >= VIEW_COOLDOWN_MS;
}
