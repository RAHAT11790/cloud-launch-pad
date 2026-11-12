// ============================================================
// Ad back-lock — after the player releases an ad, Back is ignored for a
// few seconds so the sponsor script can load and open completely.
// ============================================================
// Back presses are swallowed BEFORE the router sees them (window capture
// listener) and the history position is restored with history.forward(), so
// no synthetic history entry is ever created and router state stays exact.

/** How long Back stays locked after an ad call (user asked for 5 seconds). */
export const AD_BACK_LOCK_MS = 5000;

/** Milliseconds of lock left for a lock started at `startedAt`. */
export function adLockRemaining(startedAt: number, now: number, ms = AD_BACK_LOCK_MS): number {
  if (!Number.isFinite(startedAt) || startedAt <= 0) return 0;
  return Math.max(0, Math.min(ms, startedAt + ms - now));
}

let startedAt = 0;
let endTimer: ReturnType<typeof setTimeout> | null = null;
let restoring = false;
const listeners = new Set<(lockedUntil: number) => void>();

const lockedUntil = () => (startedAt ? startedAt + AD_BACK_LOCK_MS : 0);
const notify = () => { const until = isAdBackLocked() ? lockedUntil() : 0; listeners.forEach((fn) => { try { fn(until); } catch { /* ignore */ } }); };

export function isAdBackLocked(now = Date.now()): boolean {
  return adLockRemaining(startedAt, now) > 0;
}

const onPop = (event: PopStateEvent) => {
  if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
  if (!isAdBackLocked()) return;
  // Swallow the Back press and put the page back where it was.
  event.stopImmediatePropagation();
  restoring = true;
  try { window.history.forward(); } catch { restoring = false; }
  // history.forward() is a no-op when there is no forward entry; never stay stuck.
  setTimeout(() => { restoring = false; }, 400);
};

function uninstall() {
  if (typeof window === "undefined") return;
  window.removeEventListener("popstate", onPop, true);
}

export function endAdBackLock() {
  startedAt = 0;
  if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  // Keep listening briefly so a forward-restore already in flight is swallowed too.
  setTimeout(() => { if (!startedAt) uninstall(); }, 500);
  notify();
}

/** Lock Back for AD_BACK_LOCK_MS from `at` (the tap that released the ad). */
export function startAdBackLock(at = Date.now()) {
  if (typeof window === "undefined") return;
  startedAt = at;
  window.removeEventListener("popstate", onPop, true);
  window.addEventListener("popstate", onPop, true);
  if (endTimer) clearTimeout(endTimer);
  endTimer = setTimeout(endAdBackLock, Math.max(0, adLockRemaining(at, Date.now())) + 20);
  notify();
}

/** Subscribe to lock changes; receives the wall-clock unlock time (0 = unlocked). */
export function subscribeAdBackLock(fn: (lockedUntil: number) => void): () => void {
  listeners.add(fn);
  fn(isAdBackLocked() ? lockedUntil() : 0);
  return () => { listeners.delete(fn); };
}
