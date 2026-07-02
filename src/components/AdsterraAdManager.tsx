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
    // No player-ad cooldown: every user click while the player is open can ask
    // Adsterra for the configured Popunder + Social/Push placements.
    const onClick = () => { loadAdsterraSlots().catch(() => {}); };
    document.addEventListener("click", onClick, { capture: true });
    const t = window.setTimeout(onClick, 900);
    return () => {
      document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
      window.clearTimeout(t);
    };
  }, [isPremium, videoEl]);

  return null;
};

export default AdsterraAdManager;
