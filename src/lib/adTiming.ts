// ============================================================
// Ad timing + fast-close penalty rules (pure, unit-tested).
// ------------------------------------------------------------
// Owner rules:
//   • Ads come at RANDOM times while the visitor is on the site — never a
//     fixed rhythm — and never more than 10 minutes apart.
//   • Medium load: a 24-minute episode gets about 2–4 ads.
//   • A viewer must stay on an opened ad for at least 5 seconds. Coming
//     back sooner is a warning; the 6th warning locks every video on the
//     site for 5 minutes (saved per guest / account ID).
// ============================================================

export const MINUTE = 60_000;
/** Hard ceiling between two ads: one always comes within 10 minutes. */
export const AD_GAP_CEILING_MS = 10 * MINUTE;
/** Default random range between two ads. */
export const DEFAULT_GAP_MIN_MS = 2 * MINUTE;
export const DEFAULT_GAP_MAX_MS = 10 * MINUTE;
/** The first ad of a visit arrives a little sooner. */
export const FIRST_GAP_MIN_MS = 1 * MINUTE;
export const FIRST_GAP_MAX_MS = 3 * MINUTE;
/** Two gaps in a row are never this close, so the rhythm never repeats. */
export const MIN_GAP_VARIATION_MS = 45_000;

export type GapRange = { minMs: number; maxMs: number };

/** Admin minutes → a safe range (1..10 min, min ≤ max). */
export function gapRangeFromMinutes(minMin?: unknown, maxMin?: unknown): GapRange {
  const clamp = (v: unknown, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(10, Math.max(1, n)) * MINUTE : d;
  };
  let minMs = clamp(minMin, DEFAULT_GAP_MIN_MS);
  let maxMs = clamp(maxMin, DEFAULT_GAP_MAX_MS);
  if (minMs > maxMs) [minMs, maxMs] = [maxMs, minMs];
  return { minMs, maxMs: Math.min(AD_GAP_CEILING_MS, maxMs) };
}

/**
 * Random gap (ms) before the next ad. Triangular distribution leaning to
 * the long end (mode at 3/4 of the range) → mostly 5–9 minute gaps with
 * the occasional short one. `prevMs` keeps consecutive gaps different.
 */
export function nextAdGapMs(
  range: GapRange = { minMs: DEFAULT_GAP_MIN_MS, maxMs: DEFAULT_GAP_MAX_MS },
  prevMs = 0,
  rand: () => number = Math.random,
): number {
  const lo = Math.max(0, Math.min(range.minMs, AD_GAP_CEILING_MS));
  const hi = Math.max(lo, Math.min(range.maxMs, AD_GAP_CEILING_MS));
  const mode = lo + (hi - lo) * 0.75;
  const draw = () => {
    const u = Math.min(1, Math.max(0, rand()));
    const f = hi > lo ? (mode - lo) / (hi - lo) : 0;
    const v = u < f ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
    return Math.round(Math.min(hi, Math.max(lo, v)));
  };
  let gap = draw();
  for (let i = 0; i < 4 && prevMs > 0 && Math.abs(gap - prevMs) < MIN_GAP_VARIATION_MS && hi - lo > MIN_GAP_VARIATION_MS * 2; i++) gap = draw();
  return gap;
}

/** Wait before the very first ad of a visit. */
export function firstAdGapMs(range?: GapRange, rand: () => number = Math.random): number {
  const hi = Math.min(FIRST_GAP_MAX_MS, range?.maxMs ?? FIRST_GAP_MAX_MS);
  const lo = Math.min(FIRST_GAP_MIN_MS, hi);
  return Math.round(lo + Math.min(1, Math.max(0, rand())) * (hi - lo));
}

// ---------------- fast-close penalty ----------------

/** The viewer must stay on an opened ad at least this long. */
export const MIN_AD_VIEW_MS = 5_000;
/** Warnings that trigger the video lock. */
export const STRIKES_TO_LOCK = 6;
/** How long every video stays locked. */
export const VIDEO_LOCK_MS = 5 * MINUTE;
/** Old warnings are forgotten after a day. */
export const STRIKE_MEMORY_MS = 24 * 60 * MINUTE;

export type PenaltyState = { strikes: number[]; lockedUntil: number };
export const EMPTY_PENALTY: PenaltyState = { strikes: [], lockedUntil: 0 };
export type AdReturnOutcome = "ok" | "warning" | "locked";

export function normalizePenalty(raw: unknown, now = Date.now()): PenaltyState {
  const v = (raw && typeof raw === "object" ? raw : {}) as { strikes?: unknown; lockedUntil?: unknown };
  const list = Array.isArray(v.strikes) ? v.strikes : v.strikes && typeof v.strikes === "object" ? Object.values(v.strikes) : [];
  const strikes = list.map(Number).filter((t) => Number.isFinite(t) && t > now - STRIKE_MEMORY_MS && t <= now + 60_000).sort((a, b) => a - b).slice(-STRIKES_TO_LOCK);
  const lockedUntil = Number(v.lockedUntil) || 0;
  // A lock can never be longer than the rule allows (protects against bad data).
  return { strikes, lockedUntil: lockedUntil > now + VIDEO_LOCK_MS + 60_000 ? now + VIDEO_LOCK_MS : lockedUntil };
}

export function videoLockRemaining(state: PenaltyState, now = Date.now()): number {
  return Math.max(0, (state.lockedUntil || 0) - now);
}

/**
 * The viewer came back from an opened ad after `awayMs`.
 * ≥ 5 s → nothing happens. Sooner → one warning; the 6th locks videos for
 * 5 minutes and the warning count starts over.
 */
export function recordAdReturn(state: PenaltyState, awayMs: number, now = Date.now()): { state: PenaltyState; outcome: AdReturnOutcome; strikes: number } {
  const clean = normalizePenalty(state, now);
  if (!(awayMs < MIN_AD_VIEW_MS)) return { state: clean, outcome: "ok", strikes: clean.strikes.length };
  const strikes = [...clean.strikes, now];
  if (strikes.length >= STRIKES_TO_LOCK) {
    return { state: { strikes: [], lockedUntil: now + VIDEO_LOCK_MS }, outcome: "locked", strikes: STRIKES_TO_LOCK };
  }
  return { state: { strikes, lockedUntil: clean.lockedUntil }, outcome: "warning", strikes: strikes.length };
}

/** "4:05" style countdown. */
export function formatLockClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------- where automatic ads run ----------------
/** Pages without automatic ads: admin tools, the download flow (its own ad
 *  steps), ad-blocker/payment/task pages that manage ads themselves. */
const NO_AUTO_AD_PREFIXES = ["/admin", "/download", "/adblocker", "/premium-buy", "/premium-required", "/daily-tasks", "/unlock", "/an-explorer"];
export function isAutoAdPath(pathname: string): boolean {
  const p = String(pathname || "/").toLowerCase();
  return !NO_AUTO_AD_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`) || p.startsWith(`${prefix}-`));
}
