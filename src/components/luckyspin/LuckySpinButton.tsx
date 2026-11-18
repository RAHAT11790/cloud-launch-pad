import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cachedSpinSettings, formatUnlock, loadSpinState, spinWindow, subscribeSpinSettings, type LuckySpinSettings, type SpinState } from "@/lib/luckySpin";

/** Golden "Lucky Spin" button — shown only while the admin has Lucky Spin switched on. */
export default function LuckySpinButton({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<LuckySpinSettings>(() => cachedSpinSettings());
  const [state, setState] = useState<SpinState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => subscribeSpinSettings(setCfg), []);
  useEffect(() => { if (cfg.enabled) void loadSpinState().then(setState); }, [cfg.enabled]);
  const w = spinWindow(state, cfg, now);
  useEffect(() => {
    if (!cfg.enabled || !w.unlockAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cfg.enabled, w.unlockAt]);

  if (!cfg.enabled) return null;
  const locked = w.left <= 0 && w.unlockAt > now;
  return (
    <button type="button" onClick={() => navigate("/lucky-spin")} className={`ls-cta ${locked ? "is-locked" : ""} ${className}`}>
      <span className="ls-cta-shine" aria-hidden="true" />
      <span className="ls-cta-icon" aria-hidden="true"><span className="ls-cta-wheel" /></span>
      <span className="min-w-0 flex-1 text-left">
        <strong>Lucky Spin</strong>
        <small>{locked ? "Spins used — come back soon" : `${w.left} spin${w.left === 1 ? "" : "s"} left · ${cfg.coinCost} coins each · win Premium`}</small>
      </span>
      {locked ? <span className="ls-cta-timer">{formatUnlock(w.unlockAt - now)}</span> : <ChevronRight className="h-4 w-4 shrink-0" />}
    </button>
  );
}
