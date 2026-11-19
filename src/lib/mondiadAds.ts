// Mondiad ad codes — Firebase `settings/adNetworks/mondiad`, mirrored on device
// so the player and download page read them instantly. Empty box = no ad.
import { useEffect, useState } from "react";
import { db, ref, get, onValue } from "@/lib/firebase";

export type MondiadConfig = {
  enabled: boolean;
  /** Video player */
  popunder: string;
  playerInPagePush: string;
  /** Download page */
  banner: string;
  native: string;
  downloadInPagePush: string;
};

export const EMPTY_MONDIAD: MondiadConfig = {
  enabled: true, popunder: "", playerInPagePush: "", banner: "", native: "", downloadInPagePush: "",
};

export const MONDIAD_PATH = "settings/adNetworks/mondiad";
const LS_KEY = "rs_mondiad_cfg_v1";

const str = (v: unknown) => (typeof v === "string" ? v : "");
export function normalizeMondiad(raw: any): MondiadConfig {
  const v = raw && typeof raw === "object" ? raw : {};
  const player = v.player && typeof v.player === "object" ? v.player : {};
  const download = v.download && typeof v.download === "object" ? v.download : {};
  return {
    enabled: v.enabled !== false,
    popunder: str(player.popunder),
    playerInPagePush: str(player.inPagePush),
    banner: str(download.banner),
    native: str(download.native),
    downloadInPagePush: str(download.inPagePush),
  };
}
export function mondiadToFirebase(c: MondiadConfig) {
  return {
    enabled: c.enabled,
    player: { popunder: c.popunder.trim(), inPagePush: c.playerInPagePush.trim() },
    download: { banner: c.banner.trim(), native: c.native.trim(), inPagePush: c.downloadInPagePush.trim() },
    updatedAt: Date.now(),
  };
}

let cached: MondiadConfig | null = (() => {
  try { const v = localStorage.getItem(LS_KEY); return v ? { ...EMPTY_MONDIAD, ...JSON.parse(v) } : null; } catch { return null; }
})();
const remember = (c: MondiadConfig) => { cached = c; try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {} };

/** Synchronous device copy (may be a little old; the live listener refreshes it). */
export const mondiadCached = () => cached;

let pending: Promise<MondiadConfig> | null = null;
let liveUnsub: (() => void) | null = null;
function keepLive() {
  if (liveUnsub) return;
  try { liveUnsub = onValue(ref(db, MONDIAD_PATH), (s) => remember(normalizeMondiad(s.val()))); } catch {}
}

export async function getMondiadConfig(): Promise<MondiadConfig> {
  keepLive();
  if (cached) return cached;
  if (!pending) {
    pending = get(ref(db, MONDIAD_PATH))
      .then((s) => { const c = normalizeMondiad(s.val()); remember(c); return c; })
      .catch(() => ({ ...EMPTY_MONDIAD }))
      .finally(() => { pending = null; });
  }
  return pending;
}

export function useMondiadConfig(): MondiadConfig {
  const [cfg, setCfg] = useState<MondiadConfig>(() => cached || EMPTY_MONDIAD);
  useEffect(() => onValue(ref(db, MONDIAD_PATH), (s) => { const c = normalizeMondiad(s.val()); remember(c); setCfg(c); }), []);
  return cfg;
}
