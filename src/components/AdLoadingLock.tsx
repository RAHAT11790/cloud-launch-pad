import { useEffect, useState } from "react";
import { AD_BACK_LOCK_MS, subscribeAdBackLock } from "@/lib/adBackLock";

/**
 * Full-screen hold shown while a sponsor ad loads after a player tap.
 * Touches and Back are blocked until the countdown ends (see adBackLock.ts).
 */
const AdLoadingLock = () => {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => subscribeAdBackLock(setUntil), []);
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [until]);
  const left = until ? Math.max(0, until - now) : 0;
  if (!left) return null;
  const secs = Math.ceil(left / 1000);
  const progress = 1 - left / AD_BACK_LOCK_MS;
  const stop = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <div
      role="alertdialog"
      aria-label="Sponsor loading"
      className="ad-lock-root"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onTouchStart={stop}
      onContextMenu={stop}
    >
      <div className="ad-lock-card">
        <span className="ad-lock-ring" aria-hidden>
          <svg viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="21" className="ad-lock-track" />
            <circle cx="24" cy="24" r="21" className="ad-lock-fill" strokeDasharray={131.95} strokeDashoffset={131.95 * (1 - progress)} />
          </svg>
          <b role="timer" aria-live="polite">{secs}</b>
        </span>
        <p className="ad-lock-title">Sponsor loading…</p>
        <p className="ad-lock-sub">Back unlocks in {secs}s. Ads keep RS ANIME03 free.</p>
      </div>
    </div>
  );
};

export default AdLoadingLock;
