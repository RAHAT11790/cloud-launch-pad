import { useEffect, useState } from "react";
import { firebaseRestGet } from "@/lib/firebaseRest";
import { normalizeWatermark, type WatermarkSettings } from "@/lib/playerWatermark";

const KEY = "rs_player_watermark_v1";

export function useWatermarkSettings(): WatermarkSettings {
  const [s, setS] = useState<WatermarkSettings>(() => {
    try { return normalizeWatermark(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return normalizeWatermark(null); }
  });
  useEffect(() => {
    let off = false;
    firebaseRestGet<any>("settings/playerWatermark").then((raw) => {
      if (off) return;
      setS(normalizeWatermark(raw));
      try { localStorage.setItem(KEY, JSON.stringify(raw ?? null)); } catch {}
    }).catch(() => {});
    return () => { off = true; };
  }, []);
  return s;
}
