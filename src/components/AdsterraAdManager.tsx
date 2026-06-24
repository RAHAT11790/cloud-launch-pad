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
    // First ad call is delayed 45s after the player opens — no ads at all
    // during the first 45 seconds. After that adsterraAds.ts handles its
    // own 45–60s cycle between Stream Link and Popunder.
    const t = window.setTimeout(() => { loadAdsterraSlots(); }, 45_000);
    return () => window.clearTimeout(t);
  }, [isPremium, videoEl]);

  return null;
};

export default AdsterraAdManager;
