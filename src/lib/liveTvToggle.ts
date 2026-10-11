import { useEffect, useState } from "react";
import { db, ref, onValue, set } from "@/lib/firebase";

// Admin switch for the whole Live TV section (bottom tab + page).
// Stored at settings/liveTvEnabled; missing = on. Mirrored in localStorage so
// the bottom bar paints the right tabs instantly on reload.
export const LIVE_TV_SETTING_PATH = "settings/liveTvEnabled";
const CACHE_KEY = "rs_live_tv_enabled_v1";

export function parseLiveTvEnabled(value: unknown): boolean {
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return true;
}

function readCached(): boolean {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function useLiveTvEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(readCached);
  useEffect(() => {
    const unsub = onValue(ref(db, LIVE_TV_SETTING_PATH), (snap) => {
      const next = parseLiveTvEnabled(snap.val());
      try { localStorage.setItem(CACHE_KEY, next ? "1" : "0"); } catch {}
      setEnabled(next);
    });
    return () => unsub();
  }, []);
  return enabled;
}

export async function setLiveTvEnabled(enabled: boolean): Promise<void> {
  await set(ref(db, LIVE_TV_SETTING_PATH), enabled);
  try { localStorage.setItem(CACHE_KEY, enabled ? "1" : "0"); } catch {}
}
