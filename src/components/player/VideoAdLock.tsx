import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { formatLockClock, STRIKES_TO_LOCK, VIDEO_LOCK_MS } from "@/lib/adTiming";

/** Covers the player while videos are locked for closing ads too fast. */
const VideoAdLock = ({ until }: { until: number }) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [until]);
  const left = Math.max(0, until - now);
  if (!left) return null;
  const progress = 1 - left / VIDEO_LOCK_MS;
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };
  return (
    <div className="vid-lock-root" role="alertdialog" aria-label="Videos locked" onClick={stop} onPointerDown={stop} onTouchStart={stop} onDoubleClick={stop}>
      <span className="vid-lock-icon" aria-hidden><Lock className="w-6 h-6" /></span>
      <p className="vid-lock-title">Videos locked</p>
      <p className="vid-lock-clock" role="timer" aria-live="polite">{formatLockClock(left)}</p>
      <div className="vid-lock-bar" aria-hidden><span style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} /></div>
      <p className="vid-lock-sub">Ads were closed too quickly {STRIKES_TO_LOCK} times. Stay on an ad for at least 5 seconds — videos unlock by themselves.</p>
    </div>
  );
};

export default VideoAdLock;
