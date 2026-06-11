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
 * Premium users → no ad scripts and no guard.
 * Non-premium → Adsterra Popunder + Social Bar + adblock/VPN/DNS guard.
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
      // Start the bypass-detection guard after ads have a chance to load.
      window.setTimeout(() => { startAdGuard(videoEl ?? null); }, 1500);
    }, 250);
    return () => window.clearTimeout(t);
  }, [isPremium, videoEl]);

  return null;
};

export default AdsterraAdManager;
