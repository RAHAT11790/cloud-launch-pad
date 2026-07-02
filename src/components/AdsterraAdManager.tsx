import { useEffect } from "react";
import {
  enterAdsterraPlayerScope,
  exitAdsterraPlayerScope,
  loadAdsterraSlots,
  setAdsterraPremium,
} from "@/lib/adsterraAds";
import { stopAdGuard } from "@/lib/adGuard";

interface Props { isPremium?: boolean | null; videoEl?: HTMLVideoElement | null; }

const AdsterraAdManager = ({ isPremium, videoEl }: Props) => {
  useEffect(() => {
    enterAdsterraPlayerScope();
    return () => { exitAdsterraPlayerScope(); stopAdGuard(); };
  }, []);

  useEffect(() => {
    if (isPremium === null || isPremium === undefined) return;
    setAdsterraPremium(!!isPremium);
    stopAdGuard();
    if (isPremium) return;
    // Show the first player ad quickly; adsterraAds.ts handles the normal
    // refresh/cycle after this initial mount.
    const t = window.setTimeout(() => { loadAdsterraSlots(); }, 2_000);
    return () => window.clearTimeout(t);
  }, [isPremium, videoEl]);

  return null;
};

export default AdsterraAdManager;
