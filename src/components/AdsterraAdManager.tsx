import { useEffect } from "react";
import {
  enterAdsterraPlayerScope,
  exitAdsterraPlayerScope,
  loadAdsterraSlots,
  setAdsterraPremium,
} from "@/lib/adsterraAds";
import { startAdGuard, stopAdGuard } from "@/lib/adGuard";

interface Props { isPremium?: boolean | null; videoEl?: HTMLVideoElement | null; }

/**
 * Mount this only inside the video player.
 * Premium users → no ad scripts.
 * Non-premium → lightweight Stream Link / Popunder cycle only.
 */
const AdsterraAdManager = ({ isPremium, videoEl }: Props) => {
  useEffect(() => {
    enterAdsterraPlayerScope();
    return () => { exitAdsterraPlayerScope(); stopAdGuard(); };
  }, []);

  useEffect(() => {
    if (isPremium === null || isPremium === undefined) return;
    setAdsterraPremium(!!isPremium);
    if (isPremium) { stopAdGuard(); return; }
    const t = window.setTimeout(() => {
      loadAdsterraSlots();
      // Best-effort ads only: no blocking DNS/adblock guard popup in player.
      stopAdGuard();
    }, 250);
    return () => window.clearTimeout(t);
  }, [isPremium, videoEl]);

  return null;
};

export default AdsterraAdManager;
