// Lucky Spin — spend coins to spin a prize wheel of Premium days.
// Admin settings: Firebase `settings/luckySpin` (missing = off).
// Per-user window: `users/{uid}/luckySpin` = { start, used, lastPrize, lastAt }.
import { db, get, onValue, ref, runTransaction, set } from "@/lib/firebase";
import { ensureGuestUser } from "@/lib/premiumAccess";
import { getLocalUserId } from "@/lib/unlockAccess";

const DAY = 86_400_000;
export const MAX_PRIZES = 12;
export const MIN_PRIZES = 2;

export interface SpinPrize {
  id: string;
  /** Text on the wheel, e.g. "7 Days" or "Try again". */
  label: string;
  /** Premium days won; 0 = nothing. */
  days: number;
  /** Chance weight. Each prize wins with chance / (sum of all chances). */
  chance: number;
}

export interface LuckySpinSettings {
  enabled: boolean;
  /** Coins taken for one spin. */
  coinCost: number;
  /** How many spins one person gets in each period. */
  spinsPerPeriod: number;
  /** Period length in days; the first spin starts the period. */
  periodDays: number;
  prizes: SpinPrize[];
}

export interface SpinState { start: number; used: number; lastPrize?: string; lastAt?: number }

export const DEFAULT_SPIN_PRIZES: SpinPrize[] = [
  { id: "p1", label: "1 Day", days: 1, chance: 25 },
  { id: "p2", label: "Try again", days: 0, chance: 20 },
  { id: "p3", label: "2 Days", days: 2, chance: 15 },
  { id: "p4", label: "5 Days", days: 5, chance: 5 },
  { id: "p5", label: "No luck", days: 0, chance: 20 },
  { id: "p6", label: "3 Days", days: 3, chance: 10 },
  { id: "p7", label: "7 Days", days: 7, chance: 2 },
  { id: "p8", label: "Try again", days: 0, chance: 3 },
];

export const DEFAULT_LUCKY_SPIN: LuckySpinSettings = {
  enabled: false, coinCost: 20, spinsPerPeriod: 3, periodDays: 7, prizes: DEFAULT_SPIN_PRIZES,
};

const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Cleans whatever is stored in Firebase into safe settings (bad prizes dropped, numbers clamped). */
export function normalizeSpinSettings(raw: any): LuckySpinSettings {
  const r = raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(r.prizes) ? r.prizes : r.prizes && typeof r.prizes === "object" ? Object.values(r.prizes) : null;
  const prizes = (list || DEFAULT_SPIN_PRIZES)
    .filter((p: any) => p && typeof p === "object")
    .map((p: any, i: number): SpinPrize => ({
      id: String(p.id || `p${i + 1}`).slice(0, 24),
      label: String(p.label ?? "").trim().slice(0, 14) || (Number(p.days) > 0 ? `${int(p.days, 0, 365, 0)} Days` : "Try again"),
      days: int(p.days, 0, 365, 0),
      chance: Math.max(0, Math.min(1000, Number(p.chance) || 0)),
    }))
    .slice(0, MAX_PRIZES);
  const usable = prizes.length >= MIN_PRIZES && prizes.some((p) => p.chance > 0);
  return {
    enabled: r.enabled === true && usable,
    coinCost: int(r.coinCost, 0, 100_000, DEFAULT_LUCKY_SPIN.coinCost),
    spinsPerPeriod: int(r.spinsPerPeriod, 1, 100, DEFAULT_LUCKY_SPIN.spinsPerPeriod),
    periodDays: int(r.periodDays, 1, 365, DEFAULT_LUCKY_SPIN.periodDays),
    prizes: usable ? prizes : DEFAULT_SPIN_PRIZES,
  };
}

/** Real chance of each prize in percent (weights may sum to anything). */
export function prizePercents(prizes: SpinPrize[]): number[] {
  const total = prizes.reduce((s, p) => s + Math.max(0, p.chance), 0);
  return prizes.map((p) => (total > 0 ? (Math.max(0, p.chance) / total) * 100 : 0));
}

/** Weighted pick. `r` is a random number in [0, 1). */
export function pickPrizeIndex(prizes: SpinPrize[], r: number): number {
  const total = prizes.reduce((s, p) => s + Math.max(0, p.chance), 0);
  if (!(total > 0)) return 0;
  let x = Math.min(Math.max(r, 0), 0.999999999) * total;
  for (let i = 0; i < prizes.length; i++) {
    x -= Math.max(0, prizes[i].chance);
    if (x < 0) return i;
  }
  return prizes.length - 1;
}

/** Spins left in the current period and when the wheel unlocks again (0 = open now). */
export function spinWindow(state: Partial<SpinState> | null | undefined, s: Pick<LuckySpinSettings, "spinsPerPeriod" | "periodDays">, now: number) {
  const start = Number(state?.start) || 0;
  const ends = start + s.periodDays * DAY;
  if (!start || now >= ends) return { left: s.spinsPerPeriod, used: 0, start: 0, unlockAt: 0, fresh: true };
  const used = Math.max(0, Number(state?.used) || 0);
  const left = Math.max(0, s.spinsPerPeriod - used);
  return { left, used, start, unlockAt: left > 0 ? 0 : ends, fresh: false, endsAt: ends };
}

/**
 * Wheel rotation (degrees, clockwise) that stops prize `index` under the top pointer.
 * Always turns forward from `current` by at least `turns` full circles.
 */
export function spinTargetAngle(current: number, index: number, count: number, turns = 6, jitter = 0): number {
  const seg = 360 / count;
  const center = (index + 0.5) * seg + Math.max(-0.4, Math.min(0.4, jitter)) * seg;
  const now = ((current % 360) + 360) % 360;
  const delta = (((360 - center - now) % 360) + 360) % 360;
  return current + turns * 360 + delta;
}

/** Prize index that sits under the top pointer for a wheel turned `angle` degrees. */
export function prizeAtAngle(angle: number, count: number): number {
  const a = (((-angle) % 360) + 360) % 360;
  return Math.floor(a / (360 / count)) % count;
}

export const spinUserId = () => getLocalUserId() || ensureGuestUser();

/** Live admin settings (cached on device so the profile button paints at once). */
const SETTINGS_CACHE = "rs_lucky_spin_cfg_v1";
export function cachedSpinSettings(): LuckySpinSettings {
  try { return normalizeSpinSettings(JSON.parse(localStorage.getItem(SETTINGS_CACHE) || "null")); } catch { return DEFAULT_LUCKY_SPIN; }
}
export function subscribeSpinSettings(cb: (s: LuckySpinSettings) => void): () => void {
  return onValue(ref(db, "settings/luckySpin"), (snap) => {
    const raw = snap.val();
    try { localStorage.setItem(SETTINGS_CACHE, JSON.stringify(raw ?? null)); } catch { /* full */ }
    cb(normalizeSpinSettings(raw));
  });
}

export async function saveSpinSettings(s: LuckySpinSettings) {
  await set(ref(db, "settings/luckySpin"), { ...s, prizes: s.prizes.map((p) => ({ ...p })) });
}

export async function loadSpinSettings(): Promise<LuckySpinSettings> {
  const snap = await get(ref(db, "settings/luckySpin")).catch(() => null);
  return normalizeSpinSettings(snap?.val());
}

export async function loadSpinState(uid = spinUserId()): Promise<SpinState | null> {
  if (!uid) return null;
  const snap = await get(ref(db, `users/${uid}/luckySpin`)).catch(() => null);
  return (snap?.val() as SpinState) || null;
}

export type SpinResult =
  | { ok: true; index: number; prize: SpinPrize; expiresAt?: number; left: number; unlockAt: number }
  | { ok: false; reason: "off" | "wait" | "insufficient" | "no_user" | "unknown"; unlockAt?: number };

const random01 = () => {
  try { return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296; } catch { return Math.random(); }
};

/** One spin: takes a spin slot, then the coins, picks the prize and adds the Premium days. */
export async function spinLuckyWheel(): Promise<SpinResult> {
  const uid = spinUserId();
  if (!uid) return { ok: false, reason: "no_user" };
  const cfg = await loadSpinSettings();
  if (!cfg.enabled) return { ok: false, reason: "off" };
  const now = Date.now();

  let slot: { ok: boolean; left: number; unlockAt: number } = { ok: false, left: 0, unlockAt: 0 };
  await runTransaction(ref(db, `users/${uid}/luckySpin`), (cur: any) => {
    const w = spinWindow(cur, cfg, now);
    if (w.left <= 0) { slot = { ok: false, left: 0, unlockAt: w.unlockAt }; return cur; }
    const start = w.fresh ? now : w.start;
    const used = w.used + 1;
    const left = cfg.spinsPerPeriod - used;
    slot = { ok: true, left, unlockAt: left > 0 ? 0 : start + cfg.periodDays * DAY };
    return { ...(cur || {}), start, used };
  });
  if (!slot.ok) return { ok: false, reason: "wait", unlockAt: slot.unlockAt };

  let paid = cfg.coinCost <= 0;
  if (!paid) {
    await runTransaction(ref(db, `users/${uid}/coinWallet`), (cur: any) => {
      const wallet = cur || { coins: 0 };
      if ((Number(wallet.coins) || 0) < cfg.coinCost) { paid = false; return cur; }
      paid = true;
      return { ...wallet, coins: (Number(wallet.coins) || 0) - cfg.coinCost };
    });
  }
  if (!paid) {
    // Give the spin slot back — no coins were taken.
    await runTransaction(ref(db, `users/${uid}/luckySpin`), (cur: any) => (cur ? { ...cur, used: Math.max(0, (Number(cur.used) || 1) - 1) } : cur)).catch(() => null);
    return { ok: false, reason: "insufficient" };
  }

  const index = pickPrizeIndex(cfg.prizes, random01());
  const prize = cfg.prizes[index];
  let expiresAt: number | undefined;
  if (prize.days > 0) {
    const snap = await get(ref(db, `users/${uid}/premium`)).catch(() => null);
    const existing = snap?.val() || {};
    const base = existing.active && Number(existing.expiresAt) > Date.now() ? Number(existing.expiresAt) : Date.now();
    expiresAt = base + prize.days * DAY;
    await set(ref(db, `users/${uid}/premium`), { active: true, expiresAt, source: "spin", grantedAt: Date.now(), planId: `spin-${prize.id}` });
  }
  await runTransaction(ref(db, `users/${uid}/luckySpin`), (cur: any) => ({ ...(cur || {}), lastPrize: prize.label, lastAt: Date.now() })).catch(() => null);
  return { ok: true, index, prize, expiresAt, left: slot.left, unlockAt: slot.unlockAt };
}

/** "6d 23h", "4h 05m", "12m 09s" */
export function formatUnlock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}
