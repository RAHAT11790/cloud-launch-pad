// ============================================================
// RS Anime — SITE-WIDE Ad-Block Gate (v1)
// ------------------------------------------------------------
// One engine for the whole app. It never matters which page the user is on
// (home, series, profile, video player, deep link, PWA cold start) — as soon
// as a blocker / filtering DNS / VPN filter is proven, the router is pushed to
// /adblocker-detected. Once the user genuinely removes it, /adblocker-removed
// confirms and returns them where they were.
//
// Re-verification runs on: boot, every route change, tab focus, network change
// and a rolling interval — so a blocker switched ON mid-session is caught too.
// ============================================================

import { detectAdBlock, type AdBlockSignals } from "@/lib/adBlockDetect";

export const GATE_PATH = "/adblocker-detected";
export const CLEARED_PATH = "/adblocker-removed";
const RETURN_KEY = "rs_gate_return";
const CLEARED_UNTIL_KEY = "rs_gate_cleared_until";
/** Grace window after a verified clean re-check (ms). */
const CLEAR_GRACE = 3 * 60_000;
const SWEEP_MS = 45_000;
/** Forced (grace-ignoring) re-verification interval — catches mid-session re-enable. */
const FORCE_SWEEP_MS = 90_000;

/** Routes the gate must never fight with. */
const EXEMPT = [GATE_PATH, CLEARED_PATH, "/admin", "/an-explorer"];

export type GateState = { blocked: boolean; signals: AdBlockSignals | null; checking: boolean };

let state: GateState = { blocked: false, signals: null, checking: false };
const listeners = new Set<(s: GateState) => void>();
let started = false;
let inflight: Promise<AdBlockSignals> | null = null;

const emit = () => { for (const l of listeners) { try { l(state); } catch {} } };

export const getGateState = () => state;
export const subscribeGate = (fn: (s: GateState) => void) => {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
};

export const isExemptPath = (p: string) => EXEMPT.some((e) => p === e || p.startsWith(e + "/"));

const graceActive = () => {
  try { return Number(sessionStorage.getItem(CLEARED_UNTIL_KEY) || 0) > Date.now(); } catch { return false; }
};
const grantGrace = () => {
  try { sessionStorage.setItem(CLEARED_UNTIL_KEY, String(Date.now() + CLEAR_GRACE)); } catch {}
};
export const rememberReturnPath = (p: string) => {
  if (isExemptPath(p)) return;
  try { sessionStorage.setItem(RETURN_KEY, p); } catch {}
};
export const takeReturnPath = () => {
  try {
    const v = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return v || "/";
  } catch { return "/"; }
};

/** Run the evidence chain (de-duplicated across concurrent callers). */
export async function runGateCheck(force = false): Promise<AdBlockSignals> {
  if (inflight) return inflight;
  state = { ...state, checking: true };
  emit();
  inflight = detectAdBlock()
    .then((s) => {
      const blocked = s.blocked && (force || !graceActive());
      state = { blocked, signals: s, checking: false };
      emit();
      return s;
    })
    .catch(() => {
      state = { ...state, checking: false };
      emit();
      return state.signals as AdBlockSignals;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Called by the gate page's "Re-Check" button. */
export async function recheckAndClear(): Promise<boolean> {
  const s = await runGateCheck(true);
  const clean = !s?.blocked;
  if (clean) {
    grantGrace();
    state = { blocked: false, signals: s, checking: false };
    emit();
  }
  return clean;
}

export function startAdBlockGate() {
  if (started || typeof window === "undefined") return;
  started = true;

  const kick = () => { void runGateCheck(); };

  // Boot — quick first pass, then a confirming pass once ad tags had a chance.
  setTimeout(kick, 1200);
  setTimeout(kick, 9000);
  setInterval(kick, SWEEP_MS);

  // 🔁 HARD re-verification loop. Ignores the "cleared" grace window, so a user
  // who passed the gate with the blocker OFF and switched it back ON mid-session
  // (including while a video is playing) is caught within FORCE_SWEEP_MS.
  setInterval(() => { void runGateCheck(true); }, FORCE_SWEEP_MS);
  setTimeout(() => { void runGateCheck(true); }, 30_000);

  // A returning tab is the most common moment a blocker/DNS filter gets toggled.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void runGateCheck(true); });
  window.addEventListener("online", kick);
  window.addEventListener("focus", kick);
}

