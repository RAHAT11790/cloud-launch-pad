import { useEffect, useRef } from "react";
import {
  enterAdsterraPlayerScope,
  exitAdsterraPlayerScope,
  markTagCapped,
  releaseAd,
  setAdsterraPremium,
  tagOpenedSince,
  TAG_VERIFY_MS,
  subscribeAdsterraConfig,
} from "@/lib/adsterraAds";
import { stopAdGuard } from "@/lib/adGuard";
import { adSlotReady, noteAdShown, startAdSession, stopAdSession } from "@/lib/adPacing";

interface Props { isPremium?: boolean | null; videoEl?: HTMLVideoElement | null; }

/**
 * Activity-paced ad releaser.
 * A pop-under can only fire when the pacing engine says the slot is open
 * (a persisted one-minute floor plus session caps). Every other user click
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

  // Keep the admin cool-down mirrored locally so pacing follows the panel.
  useEffect(() => subscribeAdsterraConfig(() => {}), []);

  useEffect(() => {
    if (isPremium === null || isPremium === undefined) return;
    setAdsterraPremium(!!isPremium);
    stopAdGuard();
    if (isPremium) return;

    const release = async () => {
      if (busy.current) return;
      if (!adSlotReady()) return;
      busy.current = true;
      const askedAt = Date.now();
      try {
        const result = await releaseAd();
        if (result === "direct") {
          noteAdShown();
        } else if (result === "tag") {
          // Count it only when the tag really opened a sponsor tab. A silent
          // tag (its own frequency cap) switches the next tap to the Direct
          // Link instead of eating the slot — ads keep running all session.
          await new Promise((r) => window.setTimeout(r, TAG_VERIFY_MS));
          if (tagOpenedSince(askedAt - 1000)) noteAdShown();
          else markTagCapped();
        }
      } catch {
        /* ignore */
      } finally {
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
