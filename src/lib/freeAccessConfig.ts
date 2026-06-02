/**
 * Configurable free-access duration.
 *
 * The duration (in hours) for which a successful unlock grants free access.
 * Default = 24h. Admin can change this at runtime via the Free Access section
 * of the admin panel; the value is stored at `settings/freeAccess/durationHours`
 * in Firebase RTDB.
 *
 * We mirror the latest server value into localStorage so the Unlock page can
 * read it synchronously even if Firebase is slow on the first hit.
 */

import { db, ref, onValue, set as fbSet, get } from "@/lib/firebase";
import { useEffect, useState } from "react";

const LS_KEY = "rs_free_access_duration_hours";
const DEFAULT_HOURS = 24;
const FB_PATH = "settings/freeAccess/durationHours";

let cached: number | null = null;

export function getFreeAccessDurationHours(): number {
  if (cached && cached > 0) return cached;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        cached = n;
        return n;
      }
    }
  } catch {}
  return DEFAULT_HOURS;
}

export function getFreeAccessDurationMs(): number {
  return getFreeAccessDurationHours() * 60 * 60 * 1000;
}

/** Subscribe to admin-controlled duration changes. */
export function subscribeFreeAccessDuration(cb?: (hours: number) => void) {
  return onValue(ref(db, FB_PATH), (snap) => {
    const v = snap.val();
    const n = Number(v);
    const hours = Number.isFinite(n) && n > 0 ? n : DEFAULT_HOURS;
    cached = hours;
    try { localStorage.setItem(LS_KEY, String(hours)); } catch {}
    cb?.(hours);
  });
}

/** Admin: persist new duration. */
export async function setFreeAccessDurationHours(hours: number): Promise<void> {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("Invalid duration");
  }
  await fbSet(ref(db, FB_PATH), hours);
  cached = hours;
  try { localStorage.setItem(LS_KEY, String(hours)); } catch {}
}

/** Force a fresh read from Firebase (used by admin UI on mount). */
export async function loadFreeAccessDurationOnce(): Promise<number> {
  try {
    const snap = await get(ref(db, FB_PATH));
    const n = Number(snap.val());
    const hours = Number.isFinite(n) && n > 0 ? n : DEFAULT_HOURS;
    cached = hours;
    try { localStorage.setItem(LS_KEY, String(hours)); } catch {}
    return hours;
  } catch {
    return DEFAULT_HOURS;
  }
}

/**
 * Format a duration (in hours, possibly fractional) into a human label.
 * Examples:
 *   24      -> "24 ঘন্টা" / "24 hours"
 *   1.5     -> "1 ঘন্টা 30 মিনিট" / "1 hour 30 minutes"
 *   48      -> "2 দিন" / "2 days"
 */
export function formatFreeAccessDuration(
  hours: number,
  lang: "bn" | "en" = "en"
): string {
  if (!Number.isFinite(hours) || hours <= 0) hours = DEFAULT_HOURS;

  const totalMinutes = Math.round(hours * 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const remAfterDays = totalMinutes - days * 60 * 24;
  const hrs = Math.floor(remAfterDays / 60);
  const mins = remAfterDays - hrs * 60;

  const parts: string[] = [];
  if (lang === "bn") {
    if (days > 0) parts.push(`${days} দিন`);
    if (hrs > 0) parts.push(`${hrs} ঘন্টা`);
    if (mins > 0) parts.push(`${mins} মিনিট`);
    return parts.join(" ") || `${DEFAULT_HOURS} ঘন্টা`;
  }
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hrs > 0) parts.push(`${hrs} hour${hrs === 1 ? "" : "s"}`);
  if (mins > 0) parts.push(`${mins} minute${mins === 1 ? "" : "s"}`);
  return parts.join(" ") || `${DEFAULT_HOURS} hours`;
}

/**
 * React hook: returns the current admin-set free-access duration (hours)
 * and re-renders when admin changes it in Firebase.
 */
export function useFreeAccessDurationHours(): number {
  const [hours, setHours] = useState<number>(() => getFreeAccessDurationHours());
  useEffect(() => {
    // Seed with latest from Firebase
    loadFreeAccessDurationOnce().then((h) => setHours(h)).catch(() => {});
    const unsub = subscribeFreeAccessDuration((h) => setHours(h));
    return () => {
      try { (unsub as any)?.(); } catch {}
    };
  }, []);
  return hours;
}
