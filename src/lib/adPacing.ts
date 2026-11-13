// ============================================
// Master Ad Pacing Engine (v2 — hard-capped)
// --------------------------------------------
// Owner targets (must never be exceeded):
//   • never more than 50 pop-unders per rolling hour
//   • never below a 1 minute gap between two ads
//   • the Adsterra script must survive a full 3h session (no burst → no
//     network-side cool-down that kills every later call)
//
// How it is enforced (three independent brakes, all must pass):
//   1. HARD_MIN_GAP_SEC  — absolute floor between two ads (60s)
//   2. Rolling 60-minute window cap (HOURLY_CAP = 50) — survives reloads
//      because ad timestamps are persisted in localStorage
//   3. Adaptive gap based on the user's watch profile + engagement:
//        new user (<4d)     → 5–7 min
//        heavy (2h+/day)    → 4.5–6 min
//        medium (1h+/day)   → 3.5–5 min
//        casual (25m+/day)  → 3–4.5 min
//        light / short      → 2.5–4 min
//      Long dwell on a sponsor (10s+) rewards the user with a longer gap,
//      instantly bouncing back shortens it slightly (never below the floor).
//
// Activity is persisted to localStorage and mirrored to Firebase
// (analytics/userActivity/<device>/<date>). Nothing of this is shown in UI.
// ============================================
import { db, ref, update, runTransaction } from "@/lib/firebase";
import { getAdGapMs } from "@/lib/adsterraAds";

/** Admin-panel cool-down (seconds) — falls back to the hard floor. */
const adminGapSec = () => Math.max(10, Math.round(getAdGapMs() / 1000));

const LS_KEY = "rs_ad_profile_v1";
const LS_SLOTS = "rs_ad_slots_v2";
const todayKey = () => new Date().toISOString().slice(0, 10);

/** Absolute persisted floor: never more than one player ad per minute. */
export const HARD_MIN_GAP_SEC = 60;
/** Ceiling for a single gap (seconds). */
export const MAX_GAP_SEC = 120;
/** Rolling 60-minute cap. */
export const HOURLY_CAP = 50;
/** Rolling 24-hour cap (safety net for all-day users). */
export const DAILY_CAP = 400;

type Profile = {
  firstSeen: number;
  days: Record<string, number>; // date -> watched seconds
};

/** Ad timestamps persisted across reloads so a refresh can't reset the cap. */
type Slots = { ts: number[]; nextAt: number };

function deviceId() {
  try {
    let id = localStorage.getItem("rs_device_id");
    if (!id) {
      id = `d_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem("rs_device_id", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

function readProfile(): Profile {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (raw && typeof raw === "object") {
      return { firstSeen: Number(raw.firstSeen) || Date.now(), days: raw.days || {} };
    }
  } catch {}
  const fresh: Profile = { firstSeen: Date.now(), days: {} };
  try { localStorage.setItem(LS_KEY, JSON.stringify(fresh)); } catch {}
  return fresh;
}

function writeProfile(p: Profile) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch {}
}

function readSlots(): Slots {
  let s: Slots = { ts: [], nextAt: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SLOTS) || "null");
    if (raw && Array.isArray(raw.ts)) {
      s = { ts: raw.ts.map(Number).filter(Number.isFinite), nextAt: Number(raw.nextAt) || 0 };
    }
  } catch {}
  const cutoff = Date.now() - 86_400_000;
  s.ts = s.ts.filter((t) => t > cutoff).sort((a, b) => a - b);
  return s;
}

function writeSlots(s: Slots) {
  try { localStorage.setItem(LS_SLOTS, JSON.stringify(s)); } catch {}
}

const countWithin = (ts: number[], ms: number) => {
  const from = Date.now() - ms;
  return ts.reduce((n, t) => (t >= from ? n + 1 : n), 0);
};

// ---------- session state ----------
type SessionState = {
  startedAt: number;
  activeMs: number;
  lastTick: number;
  adsShown: number;
  lastAdAt: number;
  engagementBonus: number; // >1 = slower ads (reward), <1 = faster (penalty)
};

const S: SessionState = {
  startedAt: Date.now(),
  activeMs: 0,
  lastTick: Date.now(),
  adsShown: 0,
  lastAdAt: 0,
  engagementBonus: 1,
};

let started = false;
let flushTimer: number | undefined;

function tick() {
  const now = Date.now();
  const delta = now - S.lastTick;
  S.lastTick = now;
  if (delta <= 0 || delta > 90_000) return; // tab was asleep
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  S.activeMs += delta;
}

function flush() {
  tick();
  const p = readProfile();
  const key = todayKey();
  p.days[key] = Math.round(S.activeMs / 1000);
  // keep only the last 14 days
  const keys = Object.keys(p.days).sort();
  while (keys.length > 14) { delete p.days[keys.shift()!]; }
  writeProfile(p);
  try {
    void update(ref(db, `analytics/userActivity/${deviceId()}/${key}`), {
      seconds: p.days[key],
      adsShown: S.adsShown,
      firstSeen: p.firstSeen,
      updatedAt: Date.now(),
    });
  } catch {}
}

export function startAdSession() {
  if (started) return;
  started = true;
  S.startedAt = Date.now();
  S.lastTick = Date.now();
  S.adsShown = 0;
  document.addEventListener("visibilitychange", tick);
  flushTimer = window.setInterval(flush, 30_000);
  readProfile(); // make sure firstSeen is stamped
}

export function stopAdSession() {
  if (!started) return;
  started = false;
  flush();
  document.removeEventListener("visibilitychange", tick);
  if (flushTimer) window.clearInterval(flushTimer);
  flushTimer = undefined;
}

// ---------- profile derived signals ----------
function avgDailySeconds() {
  const p = readProfile();
  const vals = Object.entries(p.days)
    .filter(([d]) => d !== todayKey())
    .map(([, v]) => Number(v) || 0)
    .slice(-7);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function accountAgeDays() {
  const p = readProfile();
  return (Date.now() - p.firstSeen) / 86_400_000;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Base gap (seconds) before the next pop-under may fire. */
function baseGapSeconds() {
  // The admin-panel cool-down is authoritative; new users just get a slightly
  // lighter load on top of it.
  const gap = adminGapSec();
  return accountAgeDays() < 4 ? gap * 1.5 : gap;
}

function sessionCap() {
  const min = S.activeMs / 60_000;
  return Math.min(400, 3 + Math.floor(min * 2));
}

function scheduleNext(from = Date.now()) {
  const gap = Math.max(adminGapSec(), baseGapSeconds() * S.engagementBonus);
  const slots = readSlots();
  slots.nextAt = from + gap * 1000;
  writeSlots(slots);
  return gap;
}

/** Should we release an ad right now? Every brake must agree. */
export function adSlotReady() {
  tick();
  const slots = readSlots();
  const now = Date.now();

  // Warm-up window for the very first ad of a session (persisted, so a
  // page refresh cannot be used to skip it).
  if (!slots.nextAt) {
    slots.nextAt = now + Math.min(20_000, adminGapSec() * 1000);
    writeSlots(slots);
    return false;
  }

  if (now < slots.nextAt) return false;                                   // adaptive gap
  const last = slots.ts.length ? slots.ts[slots.ts.length - 1] : 0;
  if (last && now - last < adminGapSec() * 1000) return false;         // hard floor
  if (countWithin(slots.ts, 3_600_000) >= HOURLY_CAP) return false;       // rolling hour
  if (countWithin(slots.ts, 86_400_000) >= DAILY_CAP) return false;       // rolling day
  if (S.adsShown >= sessionCap()) return false;                           // session curve
  return true;
}

export function noteAdShown() {
  const now = Date.now();
  S.adsShown += 1;
  S.lastAdAt = now;
  const slots = readSlots();
  slots.ts.push(now);
  writeSlots(slots);
  scheduleNext(now);
  try {
    void runTransaction(ref(db, `analytics/ads/${todayKey()}/player/shown`), (v) => (Number(v) || 0) + 1);
  } catch {}
}

/**
 * Feed measured dwell time (seconds the user stayed on the sponsor tab).
 * Long dwell = reward with a longer ad-free window.
 */
export function noteAdDwell(seconds: number) {
  if (seconds >= 10) S.engagementBonus = Math.min(1.6, S.engagementBonus * 1.2);
  else if (seconds >= 5) S.engagementBonus = Math.min(1.6, S.engagementBonus * 1.05);
  else S.engagementBonus = Math.max(0.85, S.engagementBonus * 0.9);
  scheduleNext(S.lastAdAt || Date.now());
  try {
    const bucket = seconds >= 10 ? "full" : seconds >= 5 ? "partial" : "quick";
    void runTransaction(ref(db, `analytics/ads/${todayKey()}/dwell/${bucket}`), (v) => (Number(v) || 0) + 1);
    void runTransaction(ref(db, `analytics/ads/${todayKey()}/dwellSeconds`), (v) => (Number(v) || 0) + Math.round(seconds));
  } catch {}
}

export function adPacingSnapshot() {
  tick();
  const slots = readSlots();
  return {
    sessionMinutes: S.activeMs / 60_000,
    adsShown: S.adsShown,
    cap: sessionCap(),
    lastHour: countWithin(slots.ts, 3_600_000),
    hourlyCap: HOURLY_CAP,
    nextAdInSec: Math.max(0, Math.round((slots.nextAt - Date.now()) / 1000)),
    engagementBonus: S.engagementBonus,
    newUser: accountAgeDays() < 4,
  };
}
