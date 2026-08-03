// ============================================
// Master Ad Pacing Engine
// --------------------------------------------
// Goal: never burn the Adsterra script quota in the first minutes of a
// session (that is what pushed the network into a permanent cool-down and
// killed every later ad call). Instead, ads are released on a slow, random,
// activity-aware timer:
//
//   • New users (first 4 days)      → slowest pacing (5–6 min gap)
//   • Heavy watchers (2h+/day)      → slow pacing (4.5–6 min gap)
//   • Medium watchers (1h+/day)     → 3.5–5 min gap
//   • Light / short sessions        → 1–3 min gap (never below 30s)
//   • Watched a pop-under 10s+      → next gap multiplied (reward = fewer ads)
//   • Closed the ad too fast        → gap shortened a little (soft penalty)
//
// Session caps mirror the owner's targets:
//   ~15–20 ads in the first 30 minutes, ~40–60 ads across a 3-hour session.
//
// All activity is persisted to localStorage (instant) and mirrored to
// Firebase (analytics/userActivity/<device>/<date>) so the profile survives
// across devices/sessions. Nothing of this is shown in the UI.
// ============================================
import { db, ref, update, runTransaction } from "@/lib/firebase";

const LS_KEY = "rs_ad_profile_v1";
const todayKey = () => new Date().toISOString().slice(0, 10);

type Profile = {
  firstSeen: number;
  days: Record<string, number>; // date -> watched seconds
};

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

// ---------- session state ----------
type SessionState = {
  startedAt: number;
  activeMs: number;
  lastTick: number;
  adsShown: number;
  lastAdAt: number;
  nextAdAt: number;
  engagementBonus: number; // >1 = slower ads (reward), <1 = faster (penalty)
  timer?: number;
};

const S: SessionState = {
  startedAt: Date.now(),
  activeMs: 0,
  lastTick: Date.now(),
  adsShown: 0,
  lastAdAt: 0,
  nextAdAt: 0,
  engagementBonus: 1,
};

let started = false;
let flushTimer: number | undefined;

function tick() {
  const now = Date.now();
  const delta = now - S.lastTick;
  S.lastTick = now;
  if (delta <= 0 || delta > 90_000) return; // tab was asleep
  if (document.visibilityState !== "visible") return;
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
  const ageDays = accountAgeDays();
  const avgMin = avgDailySeconds() / 60;
  const sessionMin = S.activeMs / 60_000;

  // Brand-new users: keep it very light for the first days.
  if (ageDays < 4) return rand(300, 380);

  if (avgMin >= 120) return rand(270, 360);   // heavy watcher → fewest ads
  if (avgMin >= 60) return rand(210, 300);    // medium
  if (avgMin >= 25) return rand(150, 240);    // casual

  // Short-session users: a little faster, but never spammy.
  return sessionMin < 5 ? rand(90, 150) : rand(75, 180);
}

/** Session cap curve: ~20 ads in 30 min, ~55 across 3 hours. */
function sessionCap() {
  const min = S.activeMs / 60_000;
  if (min <= 30) return Math.min(20, 4 + Math.floor(min / 2));
  return Math.min(60, 20 + Math.floor((min - 30) / 30) * 8);
}

function scheduleNext() {
  const gap = Math.max(30, Math.min(420, baseGapSeconds() * S.engagementBonus));
  S.nextAdAt = Date.now() + gap * 1000;
}

/** Should we release an ad right now? */
export function adSlotReady() {
  tick();
  if (!S.nextAdAt) {
    // First ad of the session — give the user a calm warm-up window.
    S.nextAdAt = S.startedAt + rand(45, 90) * 1000;
  }
  if (Date.now() < S.nextAdAt) return false;
  if (S.adsShown >= sessionCap()) return false;
  return true;
}

export function noteAdShown() {
  S.adsShown += 1;
  S.lastAdAt = Date.now();
  scheduleNext();
  try {
    void runTransaction(ref(db, `analytics/ads/${todayKey()}/player/shown`), (v) => (Number(v) || 0) + 1);
  } catch {}
}

/**
 * Feed measured dwell time (seconds the user stayed on the sponsor tab).
 * Long dwell = reward with a longer ad-free window.
 */
export function noteAdDwell(seconds: number) {
  if (seconds >= 10) S.engagementBonus = Math.min(2.2, S.engagementBonus * 1.35);
  else if (seconds >= 5) S.engagementBonus = Math.min(2.2, S.engagementBonus * 1.1);
  else S.engagementBonus = Math.max(0.7, S.engagementBonus * 0.85);
  scheduleNext();
  try {
    const bucket = seconds >= 10 ? "full" : seconds >= 5 ? "partial" : "quick";
    void runTransaction(ref(db, `analytics/ads/${todayKey()}/dwell/${bucket}`), (v) => (Number(v) || 0) + 1);
    void runTransaction(ref(db, `analytics/ads/${todayKey()}/dwellSeconds`), (v) => (Number(v) || 0) + Math.round(seconds));
  } catch {}
}

export function adPacingSnapshot() {
  tick();
  return {
    sessionMinutes: S.activeMs / 60_000,
    adsShown: S.adsShown,
    cap: sessionCap(),
    nextAdInSec: Math.max(0, Math.round((S.nextAdAt - Date.now()) / 1000)),
    engagementBonus: S.engagementBonus,
    newUser: accountAgeDays() < 4,
  };
}
