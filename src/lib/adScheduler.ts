// ============================================================
// Site-wide automatic ad timer.
// ------------------------------------------------------------
// One place decides WHEN an ad comes (rules in `adTiming.ts`):
//   • The clock runs only while the visitor has the site on screen in an ad
//     zone, and is saved on the device, so a reload never resets it.
//   • When it runs out the ad is "due" and is called automatically: at once
//     if the browser still allows it (a tap within the last few seconds),
//     otherwise on the visitor's very next tap or key press anywhere — no
//     ad button. Browsers never let a page open a tab without that.
//   • An ad only counts when a sponsor tab really opened; a silent tag hands
//     the next try to the Direct Link, so ads never stop in long visits.
// ============================================================
import { db, ref, runTransaction } from "@/lib/firebase";
import {
  getAdsterraConfig,
  loadAdsterraSlots,
  markTagCapped,
  pageLeftSince,
  releaseAd,
  subscribeAdsterraConfig,
  tagOpenedSince,
  TAG_VERIFY_MS,
} from "@/lib/adsterraAds";
import { noteAdOpened } from "@/lib/adPenalty";
import { firstAdGapMs, gapRangeFromMinutes, nextAdGapMs, type GapRange } from "@/lib/adTiming";

const LS_TIMER = "rs_ad_timer_v2";
const TICK_MS = 1000;
/** After a try that opened nothing, wait this long before trying again. */
const RETRY_AFTER_MS = 8_000;
/** How long after a call the page must be covered to count as "opened". */
const OPEN_PROOF_MS = 2_000;

type TimerState = { left: number; prev: number; due: boolean; shown: number };

let range: GapRange = gapRangeFromMinutes();
let timer: TimerState | null = null;
let active = false;
let interval: ReturnType<typeof setInterval> | null = null;
let lastTick = 0;
let busy = false;
let lastTryAt = 0;
let configUnsub: (() => void) | null = null;
const listeners = new Set<(s: AdTimerSnapshot) => void>();

export type AdTimerSnapshot = { active: boolean; due: boolean; leftMs: number; shown: number };

function read(): TimerState {
  if (timer) return timer;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_TIMER) || "null");
    if (raw && Number.isFinite(Number(raw.left))) {
      timer = {
        left: Math.max(0, Math.min(range.maxMs, Number(raw.left))),
        prev: Number(raw.prev) || 0,
        due: !!raw.due,
        shown: Number(raw.shown) || 0,
      };
      return timer;
    }
  } catch { /* fresh */ }
  timer = { left: firstAdGapMs(range), prev: 0, due: false, shown: 0 };
  write();
  return timer;
}

function write() {
  try { if (timer) localStorage.setItem(LS_TIMER, JSON.stringify(timer)); } catch { /* ignore */ }
}

export function adTimerSnapshot(): AdTimerSnapshot {
  const t = read();
  return { active, due: t.due, leftMs: t.left, shown: t.shown };
}

function emit() {
  const snap = adTimerSnapshot();
  listeners.forEach((fn) => { try { fn(snap); } catch { /* ignore */ } });
}

export function subscribeAdTimer(fn: (s: AdTimerSnapshot) => void): () => void {
  listeners.add(fn);
  fn(adTimerSnapshot());
  return () => { listeners.delete(fn); };
}

const hasActivation = () => {
  try { return !!(navigator as any).userActivation?.isActive; } catch { return false; }
};

function countShown(kind: string) {
  try { void runTransaction(ref(db, `analytics/ads/${new Date().toISOString().slice(0, 10)}/auto/${kind}`), (v) => (Number(v) || 0) + 1); } catch { /* ignore */ }
}

/** A sponsor tab really opened: start a fresh random wait. */
function markShown(kind: string) {
  const t = read();
  const gap = nextAdGapMs(range, t.prev);
  timer = { left: gap, prev: gap, due: false, shown: t.shown + 1 };
  write();
  countShown(kind);
  emit();
}

/** Call the due ad now. Must run inside a tap / key press (or its activation). */
async function fire(fromTap: boolean) {
  if (!active || busy) return;
  const t = read();
  if (!t.due) return;
  const now = Date.now();
  if (now - lastTryAt < RETRY_AFTER_MS) return;
  busy = true;
  lastTryAt = now;
  try {
    const result = await releaseAd({ forceDirect: !fromTap });
    if (result === "none" || result === "mounted") { lastTryAt = 0; return; }
    noteAdOpened();
    if (result === "direct") {
      await new Promise((r) => setTimeout(r, OPEN_PROOF_MS));
      if (pageLeftSince(now - 50)) markShown("direct");
      // Nothing opened (blocked without a tap): stays due for the next tap.
      else lastTryAt = 0;
      return;
    }
    // "tag": count it only when the tag really opened a sponsor tab.
    await new Promise((r) => setTimeout(r, TAG_VERIFY_MS));
    if (tagOpenedSince(now - 1000) || pageLeftSince(now - 50)) markShown("tag");
    else { markTagCapped(); lastTryAt = 0; } // next tap goes to the Direct Link
  } catch {
    lastTryAt = 0;
  } finally {
    busy = false;
  }
}

function tick() {
  const now = performance.now();
  const delta = Math.min(5_000, Math.max(0, now - lastTick));
  lastTick = now;
  if (!active || document.visibilityState !== "visible") return;
  const t = read();
  if (!t.due) {
    t.left = Math.max(0, t.left - delta);
    if (t.left <= 0) t.due = true;
    write();
    emit();
  }
  // Due: call it right away when the browser still allows a new tab.
  if (t.due && hasActivation()) void fire(false);
}

const onGesture = (e: Event) => {
  if (!active || !read().due) return;
  if (e instanceof KeyboardEvent && (e.key === "Escape" || e.repeat)) return;
  void fire(true);
};

/** Turn the automatic ads on (ad zone, not premium) or off. */
export function setAdTimerActive(on: boolean) {
  if (typeof window === "undefined" || on === active) return;
  active = on;
  if (on) {
    read();
    lastTick = performance.now();
    if (!interval) interval = setInterval(tick, TICK_MS);
    // capture: runs before the sponsor tag's own listener sees the tap.
    document.addEventListener("click", onGesture, true);
    document.addEventListener("keydown", onGesture, true);
    if (!configUnsub) {
      configUnsub = subscribeAdsterraConfig((cfg) => {
        range = gapRangeFromMinutes(cfg?.gapMinMinutes, cfg?.gapMaxMinutes);
        const t = read();
        if (!t.due && t.left > range.maxMs) { t.left = range.maxMs; write(); }
      });
    }
    // Load settings + mount the tag early so the first due tap is instant.
    void getAdsterraConfig().then(() => { if (active) void loadAdsterraSlots(); });
  } else {
    if (interval) { clearInterval(interval); interval = null; }
    document.removeEventListener("click", onGesture, true);
    document.removeEventListener("keydown", onGesture, true);
  }
  emit();
}

/** Admin/test helper: make the ad due now. */
export function forceAdDue() {
  const t = read();
  t.left = 0; t.due = true; write(); lastTryAt = 0; emit();
}

