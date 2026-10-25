/**
 * History position at which this page load started. Entries at or before it belong to an
 * earlier page load (e.g. before the standalone download page), so going "back" past it
 * reloads the whole site — in-app closes navigate instead of crossing that boundary.
 */
export const BOOT_HISTORY_IDX: number = (() => {
  try { const idx = window.history.state?.idx; return typeof idx === "number" ? idx : 0; } catch { return 0; }
})();
export function canGoBackInApp(idx: unknown = window.history.state?.idx) {
  return typeof idx === "number" && idx > BOOT_HISTORY_IDX;
}
