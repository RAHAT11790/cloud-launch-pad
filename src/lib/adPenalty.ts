// ============================================================
// Fast-close penalty state (per guest / account ID).
// ------------------------------------------------------------
// Rules live in `adTiming.ts`. This module only remembers them:
//   • `users/{id}/adPenalty` — real accounts in Firebase, guests on the
//     device (firebase.ts routes guest paths to localStorage automatically).
//   • A localStorage mirror per ID gives an instant answer on every open,
//     so closing and reopening the site never lifts a lock.
// And it measures how long the viewer stayed away after an ad opened.
// ============================================================
import { db, ref, get, set } from "@/lib/firebase";
import { getLocalUserId } from "@/lib/unlockAccess";
import { ensureGuestUser } from "@/lib/premiumAccess";
import {
  EMPTY_PENALTY,
  normalizePenalty,
  recordAdReturn,
  videoLockRemaining,
  type AdReturnOutcome,
  type PenaltyState,
} from "@/lib/adTiming";

const LS_PREFIX = "rs_ad_penalty_v1:";
/** The ad tab must take over the screen within this time to be measured. */
const LEAVE_WINDOW_MS = 4_000;

export type AdReturnEvent = { outcome: Exclude<AdReturnOutcome, "ok">; strikes: number; lockedUntil: number; awayMs: number };

let uid = "";
let state: PenaltyState = EMPTY_PENALTY;
const stateListeners = new Set<(s: PenaltyState) => void>();
const returnListeners = new Set<(e: AdReturnEvent) => void>();
let unlockTimer: ReturnType<typeof setTimeout> | null = null;

export function penaltyUid(): string {
  try { return getLocalUserId() || ensureGuestUser(); } catch { return "anon"; }
}

function readMirror(id: string): PenaltyState {
  try { return normalizePenalty(JSON.parse(localStorage.getItem(LS_PREFIX + id) || "null")); } catch { return EMPTY_PENALTY; }
}

function writeMirror(id: string, s: PenaltyState) {
  try { localStorage.setItem(LS_PREFIX + id, JSON.stringify(s)); } catch { /* storage full */ }
}

function emit() {
  stateListeners.forEach((fn) => { try { fn(state); } catch { /* ignore */ } });
  if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = null; }
  const left = videoLockRemaining(state);
  // Tell listeners the moment the lock ends.
  if (left > 0) unlockTimer = setTimeout(emit, left + 50);
}

/** Merge two copies: the longer lock and every recent warning win. */
function merge(a: PenaltyState, b: PenaltyState): PenaltyState {
  return normalizePenalty({
    strikes: Array.from(new Set([...a.strikes, ...b.strikes])),
    lockedUntil: Math.max(a.lockedUntil || 0, b.lockedUntil || 0),
  });
}

/** Load (or switch to) the current visitor's penalty record. */
export function syncPenaltyUser(id = penaltyUid()) {
  if (!id) return;
  if (id !== uid) {
    uid = id;
    state = readMirror(id);
    emit();
  }
  const forId = id;
  void get(ref(db, `users/${forId}/adPenalty`)).then((snap) => {
    if (uid !== forId) return;
    const next = merge(state, normalizePenalty(snap.val()));
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    writeMirror(forId, state);
    emit();
  }).catch(() => undefined);
}

function save() {
  if (!uid) return;
  writeMirror(uid, state);
  void set(ref(db, `users/${uid}/adPenalty`), { strikes: state.strikes, lockedUntil: state.lockedUntil, updatedAt: Date.now() }).catch(() => undefined);
  emit();
}

export function getPenalty(): PenaltyState {
  if (!uid) syncPenaltyUser();
  return state;
}

export function videosLockedMs(now = Date.now()): number {
  return videoLockRemaining(getPenalty(), now);
}

export function subscribePenalty(fn: (s: PenaltyState) => void): () => void {
  stateListeners.add(fn);
  fn(getPenalty());
  return () => { stateListeners.delete(fn); };
}

export function subscribeAdReturn(fn: (e: AdReturnEvent) => void): () => void {
  returnListeners.add(fn);
  return () => { returnListeners.delete(fn); };
}

/** Apply one measured return (also used by tests through the pure rules). */
export function applyAdReturn(awayMs: number, now = Date.now()): AdReturnOutcome {
  if (!uid) syncPenaltyUser();
  const result = recordAdReturn(state, awayMs, now);
  state = result.state;
  if (result.outcome === "ok") return "ok";
  save();
  const event: AdReturnEvent = { outcome: result.outcome, strikes: result.strikes, lockedUntil: state.lockedUntil, awayMs };
  returnListeners.forEach((fn) => { try { fn(event); } catch { /* ignore */ } });
  return result.outcome;
}

// ---------------- time away on the ad ----------------
let pending: { openedAt: number; leftAt: number } | null = null;
let hooked = false;

function onVisibility() {
  const now = performance.now();
  if (!pending) return;
  if (document.visibilityState === "hidden") {
    if (!pending.leftAt && now - pending.openedAt <= LEAVE_WINDOW_MS) pending.leftAt = now;
    return;
  }
  // Back on the site.
  const p = pending;
  pending = null;
  if (!p.leftAt) return; // the ad never took over the screen — nothing to judge
  applyAdReturn(now - p.leftAt);
}

/** An ad was just called: measure the visit if the ad tab takes over the screen. */
export function noteAdOpened() {
  if (typeof document === "undefined") return;
  if (!hooked) {
    hooked = true;
    document.addEventListener("visibilitychange", onVisibility);
  }
  const at = performance.now();
  pending = { openedAt: at, leftAt: document.visibilityState === "hidden" ? at : 0 };
  // The ad never covered the page (pop-under behind, blocked): forget it.
  setTimeout(() => { if (pending && pending.openedAt === at && !pending.leftAt) pending = null; }, LEAVE_WINDOW_MS + 100);
}
