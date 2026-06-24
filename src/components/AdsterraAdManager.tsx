import { useEffect } from "react";
import {
  enterAdsterraPlayerScope,
  exitAdsterraPlayerScope,
  loadAdsterraSlots,
  setAdsterraPremium,
} from "@/lib/adsterraAds";
import { startAdGuard, stopAdGuard } from "@/lib/adGuard";

interface Props { isPremium?: boolean | null; videoEl?: HTMLVideoElement | null; }

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
      startAdGuard(videoEl ?? null);
    }, 250);
    return () => window.clearTimeout(t);
  }, [isPremium, videoEl]);

  return null;
};

export default AdsterraAdManager;
