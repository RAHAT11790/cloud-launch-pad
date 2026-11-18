import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Coins, Crown, Timer, X } from "lucide-react";
import { toast } from "sonner";
import { LuckyWheel } from "@/components/luckyspin/LuckyWheel";
import { useBranding } from "@/hooks/useBranding";
import { holdPremiumReload, releasePremiumReload } from "@/lib/premiumReload";
import { usePremium } from "@/hooks/usePremium";
import {
  cachedSpinSettings, formatUnlock, loadSpinState, prizePercents, spinLuckyWheel, spinTargetAngle, spinWindow, subscribeSpinSettings,
  type LuckySpinSettings, type SpinPrize, type SpinState,
} from "@/lib/luckySpin";

const SPIN_MS = 5300;

export default function LuckySpinPage() {
  const navigate = useNavigate();
  const branding = useBranding();
  const { wallet } = usePremium();
  const [cfg, setCfg] = useState<LuckySpinSettings>(() => cachedSpinSettings());
  const [state, setState] = useState<SpinState | null>(null);
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SpinPrize | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<number>();
  const held = useRef(false);
  const hold = () => { if (!held.current) { held.current = true; holdPremiumReload(); } };
  const release = () => { if (held.current) { held.current = false; releasePremiumReload(); } };
  useEffect(() => release, []);

  useEffect(() => subscribeSpinSettings(setCfg), []);
  const refresh = useCallback(() => { void loadSpinState().then(setState); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(t); window.clearTimeout(timer.current); }; }, []);

  const w = spinWindow(state, cfg, now);
  const coins = Number(wallet?.coins) || 0;
  const enough = coins >= cfg.coinCost;
  const locked = w.left <= 0 && w.unlockAt > now;
  const pct = prizePercents(cfg.prizes);

  const spin = async () => {
    if (busy || spinning) return;
    if (!cfg.enabled) { toast.error("Lucky Spin is closed right now."); return; }
    if (locked) { toast.error(`No spins left. Unlocks in ${formatUnlock(w.unlockAt - now)}.`); return; }
    if (!enough) { toast.error(`You need ${cfg.coinCost} coins to spin.`); return; }
    setBusy(true);
    hold(); // a won Premium must not reload the page before the wheel stops
    const r = await spinLuckyWheel();
    if ("reason" in r) {
      setBusy(false);
      release();
      toast.error(r.reason === "insufficient" ? `You need ${cfg.coinCost} coins to spin.`
        : r.reason === "wait" ? `No spins left. Unlocks in ${formatUnlock((r.unlockAt || now) - Date.now())}.`
        : r.reason === "off" ? "Lucky Spin is closed right now." : "Could not spin. Try again.");
      refresh();
      return;
    }
    setSpinning(true);
    setAngle((a) => spinTargetAngle(a, r.index, cfg.prizes.length, 7, (Math.random() - 0.5) * 0.6));
    timer.current = window.setTimeout(() => {
      setSpinning(false); setBusy(false); setResult(r.prize); refresh();
    }, SPIN_MS + 150);
  };

  const closeResult = () => { setResult(null); release(); };

  return (
    <div className="ls-page min-h-screen">
      <div className="mx-auto max-w-md px-4 pb-28 pt-4">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="ls-chip" aria-label="Back"><ArrowLeft className="h-4 w-4" /> Back</button>
          <span className="ls-chip ls-chip-gold"><Coins className="h-4 w-4" /> {coins}</span>
        </div>

        <div className="mt-5 text-center">
          <h1 className="ls-title">LUCKY SPIN</h1>
          <p className="ls-sub mt-1 text-[12.5px]">Spin the wheel and win free Premium days</p>
        </div>

        <div className="mt-4"><LuckyWheel prizes={cfg.prizes} angle={angle} spinning={spinning} logoUrl={branding.logoUrl} /></div>

        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="ls-stat"><b>{cfg.coinCost}</b><span>coins / spin</span></div>
          <div className="ls-stat"><b>{w.left}<small>/{cfg.spinsPerPeriod}</small></b><span>spins left</span></div>
          <div className="ls-stat"><b>{cfg.periodDays}</b><span>day{cfg.periodDays === 1 ? "" : "s"} cycle</span></div>
        </div>

        {locked ? (
          <div className="ls-locked mt-4"><Timer className="h-5 w-5" /><div><b>Spins unlock in {formatUnlock(w.unlockAt - now)}</b><span>You used all {cfg.spinsPerPeriod} spins of this {cfg.periodDays}-day cycle.</span></div></div>
        ) : (
          <button type="button" onClick={spin} disabled={busy || !cfg.enabled} className="ls-spin-btn mt-4">
            {spinning ? "Spinning…" : busy ? "Getting ready…" : !cfg.enabled ? "Closed right now" : enough ? `SPIN · ${cfg.coinCost} coins` : `Need ${cfg.coinCost - coins} more coins`}
          </button>
        )}
        {!enough && !locked && cfg.enabled && (
          <button type="button" onClick={() => navigate("/daily-tasks")} className="mt-2 w-full text-center text-[12px] font-semibold ls-link">Earn coins →</button>
        )}

        <div className="ls-odds mt-6">
          <h2>Prizes &amp; chances</h2>
          <ul>
            {cfg.prizes.map((p, i) => (
              <li key={p.id + i}><span className={`ls-dot ls-seg-${p.days > 0 ? i % 3 : "x"}`} /> <span className="flex-1">{p.days > 0 ? `${p.days} day${p.days === 1 ? "" : "s"} Premium` : p.label}</span><b>{pct[i] < 1 && pct[i] > 0 ? pct[i].toFixed(1) : Math.round(pct[i])}%</b></li>
            ))}
          </ul>
        </div>
      </div>

      {result && (
        <div className="ls-result-backdrop" role="dialog" aria-modal="true" onClick={closeResult}>
          <div className={`ls-result ${result.days > 0 ? "is-win" : ""}`} onClick={(e) => e.stopPropagation()}>
            <button className="ls-result-x" onClick={closeResult} aria-label="Close"><X className="h-4 w-4" /></button>
            {result.days > 0 && <div className="ls-burst" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ["--i" as any]: i }} />)}</div>}
            <div className="ls-result-icon">{result.days > 0 ? <Crown className="h-8 w-8" /> : <span>✦</span>}</div>
            <h3>{result.days > 0 ? "You won!" : "So close!"}</h3>
            <p>{result.days > 0 ? <><b>{result.days} day{result.days === 1 ? "" : "s"}</b> of Premium were added to your account.</> : `${result.label} — better luck on the next spin.`}</p>
            <button className="ls-spin-btn mt-4" onClick={closeResult}>{result.days > 0 ? "Awesome" : "OK"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
