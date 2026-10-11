import { useEffect, useState } from "react";
import { db, ref, onValue, set } from "@/lib/firebase";

/** Firebase path for the global Live TV on/off switch (missing = on). */
export const LIVE_TV_FLAG_PATH = "settings/liveTvEnabled";
const CACHE_KEY = "rs_live_tv_enabled_v1";

const readCache = (): boolean => {
  try { return localStorage.getItem(CACHE_KEY) !== "0"; } catch { return true; }
};

/** Main swipe pages in order; Live TV is removed completely when off. */
export const mainPagesFor = (liveTvOn: boolean) =>
  (liveTvOn ? ["home", "series", "livetv", "movies"] : ["home", "series", "movies"]) as
    ("home" | "series" | "livetv" | "movies")[];

/** Live, cached (instant first paint) Live TV switch. */
export const useLiveTvEnabled = (): boolean => {
  const [on, setOn] = useState(readCache);
  useEffect(() => onValue(ref(db, LIVE_TV_FLAG_PATH), (snap) => {
    const v = snap.val() !== false;
    try { localStorage.setItem(CACHE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
    setOn(v);
  }), []);
  return on;
};

export const setLiveTvEnabled = (on: boolean) => set(ref(db, LIVE_TV_FLAG_PATH), on);
