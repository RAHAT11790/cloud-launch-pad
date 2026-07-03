import { useEffect } from "react";
import {
  enterAdsterraPlayerScope,
  exitAdsterraPlayerScope,
  setAdsterraPremium,
  markAdsterraInteractionNow,
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
      // Only the guard starts automatically. Ads themselves are interaction-driven
      // and reloaded by the player with cooldown control.
      window.setTimeout(() => { startAdGuard(videoEl ?? null); }, 1500);
    }, 250);
    return () => window.clearTimeout(t);
  }, [isPremium, videoEl]);

  useEffect(() => {
    if (isPremium) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-player-panel='true']")) return;
      if (target.closest("button, a, input, textarea, select, [role='button']")) return;
      markAdsterraInteractionNow();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isPremium]);

  return null;
};

export default AdsterraAdManager;
