import { useEffect, useRef } from "react";
import {
  clearAdsterraWindow,
  enterAdsterraPlayerScope,
  exitAdsterraPlayerScope,
  loadAdsterraSlots,
  setAdsterraPremium,
} from "@/lib/adsterraAds";
import { stopAdGuard } from "@/lib/adGuard";
import { adSlotReady, noteAdDwell, noteAdShown, startAdSession, stopAdSession } from "@/lib/adPacing";
import { trackPopunderDwell } from "@/lib/adEngagement";

interface Props { isPremium?: boolean | null; videoEl?: HTMLVideoElement | null; }

/**
 * Activity-paced ad releaser.
 * A pop-under can only fire when the pacing engine says the slot is open
 * (30s–6min gaps, session caps, new-user protection). Every other user click
 * is ignored, which keeps the Adsterra script alive for hours instead of
 * burning out in the first half hour.
 */
const AdsterraAdManager = ({ isPremium, videoEl }: Props) => {
  const busy = useRef(false);

  useEffect(() => {
    enterAdsterraPlayerScope();
    startAdSession();
    return () => { exitAdsterraPlayerScope(); stopAdGuard(); };
  }, []);

  useEffect(() => () => { stopAdSession(); }, []);

  useEffect(() => {
    if (isPremium === null || isPremium === undefined) return;
    setAdsterraPremium(!!isPremium);
    stopAdGuard();
    if (isPremium) return;

    const release = async () => {
      if (busy.current) return;
      if (!adSlotReady()) return;
      busy.current = true;
      try {
        await loadAdsterraSlots();
        noteAdShown();
        const dwell = await trackPopunderDwell(10);
        noteAdDwell(dwell);
      } catch {
        /* ignore */
      } finally {
        // Remove the ad window so nothing keeps firing outside our schedule.
        clearAdsterraWindow();
        busy.current = false;
      }
    };

    const onClick = () => { void release(); };
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
    };
  }, [isPremium, videoEl]);

  return null;
};

export default AdsterraAdManager;
