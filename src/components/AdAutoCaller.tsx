import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ShieldAlert, Lock } from "lucide-react";
import { usePremium } from "@/hooks/usePremium";
import { setAdTimerActive } from "@/lib/adScheduler";
import { enterAdsterraPlayerScope, exitAdsterraPlayerScope, setAdsterraPremium } from "@/lib/adsterraAds";
import { subscribeAdReturn, syncPenaltyUser, type AdReturnEvent } from "@/lib/adPenalty";
import { formatLockClock, isAutoAdPath, MIN_AD_VIEW_MS, STRIKES_TO_LOCK, VIDEO_LOCK_MS } from "@/lib/adTiming";

/**
 * Site-wide automatic ads + the "ad closed too fast" warning.
 * Timing lives in adScheduler.ts, the warning/lock rules in adTiming.ts.
 */
const AdAutoCaller = () => {
  const { pathname } = useLocation();
  const { uid, isPremium, loaded } = usePremium();
  const [notice, setNotice] = useState<AdReturnEvent | null>(null);
  const [now, setNow] = useState(Date.now);

  useEffect(() => { syncPenaltyUser(uid || undefined); }, [uid]);

  const allowed = loaded && !isPremium && isAutoAdPath(pathname);
  useEffect(() => {
    setAdsterraPremium(!!isPremium);
    if (allowed) enterAdsterraPlayerScope();
    else exitAdsterraPlayerScope();
    setAdTimerActive(allowed);
  }, [allowed, isPremium]);

  useEffect(() => subscribeAdReturn((e) => setNotice(e)), []);
  useEffect(() => {
    if (notice?.outcome !== "locked") return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [notice]);

  if (!notice) return null;
  const locked = notice.outcome === "locked";
  const left = locked ? Math.max(0, notice.lockedUntil - now) : 0;
  const secs = Math.round(MIN_AD_VIEW_MS / 1000);
  return (
    <div className="ad-warn-root" role="alertdialog" aria-modal="true" aria-labelledby="ad-warn-title">
      <div className={`ad-warn-card${locked ? " is-locked" : ""}`}>
        <span className="ad-warn-icon" aria-hidden>{locked ? <Lock className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}</span>
        <h2 id="ad-warn-title" className="ad-warn-title">{locked ? "Videos locked" : "Ad closed too fast"}</h2>
        <p className="ad-warn-text">
          {locked
            ? `You closed ads too quickly ${STRIKES_TO_LOCK} times. Every video is locked for ${Math.round(VIDEO_LOCK_MS / 60000)} minutes.`
            : `Please stay on the ad for at least ${secs} seconds before coming back. Ads keep RS ANIME03 free.`}
        </p>
        {locked ? (
          <p className="ad-warn-clock" role="timer" aria-live="polite">{formatLockClock(left)}</p>
        ) : (
          <div className="ad-warn-meter" aria-label={`Warning ${notice.strikes} of ${STRIKES_TO_LOCK}`}>
            <div className="ad-warn-dots">
              {Array.from({ length: STRIKES_TO_LOCK }, (_, i) => <span key={i} className={i < notice.strikes ? "on" : ""} />)}
            </div>
            <p className="ad-warn-count">
              Warning {notice.strikes} of {STRIKES_TO_LOCK}
              {notice.strikes >= STRIKES_TO_LOCK - 1 ? " — next one locks videos" : ` — at ${STRIKES_TO_LOCK}, videos lock for ${Math.round(VIDEO_LOCK_MS / 60000)} min`}
            </p>
          </div>
        )}
        <button type="button" className="ad-warn-btn" onClick={() => setNotice(null)}>I understand</button>
      </div>
    </div>
  );
};

export default AdAutoCaller;
