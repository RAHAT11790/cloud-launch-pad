import { useEffect } from "react";
import { loadAmbientSlots, setPremium } from "@/lib/monetagAds";

interface Props {
  isPremium?: boolean | null;
}

/**
 * Mount this only inside the video player.
 * Premium users: ZERO ad scripts injected (early return).
 */
const MonetagAdManager = ({ isPremium }: Props) => {
  useEffect(() => {
    if (isPremium === null) return; // still loading premium status — be safe, wait
    setPremium(!!isPremium);
    if (isPremium) return; // premium → never load ads
    const t = window.setTimeout(() => { loadAmbientSlots(); }, 250);
    return () => window.clearTimeout(t);
  }, [isPremium]);
  return null;
};

export default MonetagAdManager;
