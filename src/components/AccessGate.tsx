// ============================================
// AccessGate — full-screen overlay shown before video playback.
// Loads all 5 Adsterra ad slots simultaneously (master-trap layout) and
// requires N successful direct-link views (with dwell timer) to unlock
// H hours of ad-free access.
// ============================================
import { useEffect, useRef, useState } from "react";
import { Lock, ExternalLink, Loader2, X } from "lucide-react";
import {
  AccessGateConfig,
  DEFAULT_GATE_CONFIG,
  getGateConfig,
  subscribeGateConfig,
  hasGateAccess,
  grantGateAccess,
  getGateProgress,
  setGateProgress,
} from "@/lib/accessGate";

interface Props {
  isPremium?: boolean | null;
  /** Called when access is granted/already-granted so the host can dismiss any blockers. */
  onUnlocked?: () => void;
  /** Called when user taps the X to abandon the gate. */
  onClose?: () => void;
}

/** Inject a raw <script>…</script> snippet so the browser executes it. */
function injectSnippet(snippet: string, host: HTMLElement) {
  if (!snippet || !host) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = snippet;
  Array.from(tmp.childNodes).forEach((node) => {
    if (node.nodeType === 1 && (node as Element).tagName === "SCRIPT") {
      const old = node as HTMLScriptElement;
      const s = document.createElement("script");
      Array.from(old.attributes).forEach((a) => s.setAttribute(a.name, a.value));
      if (old.textContent) s.textContent = old.textContent;
      if (s.src) s.async = true;
      host.appendChild(s);
    } else {
      host.appendChild(node);
    }
  });
}

const AccessGate = ({ isPremium, onUnlocked, onClose }: Props) => {
  const [cfg, setCfg] = useState<AccessGateConfig>(DEFAULT_GATE_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [unlocked, setUnlocked] = useState<boolean>(() => hasGateAccess());
  const [progress, setProgress] = useState<number>(() => getGateProgress());
  const [countdown, setCountdown] = useState<number>(0);
  const [awaitingReturn, setAwaitingReturn] = useState(false);

  const nativeRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const socialRef = useRef<HTMLDivElement>(null);
  const popunderRef = useRef<HTMLDivElement>(null);

  // Load config once
  useEffect(() => {
    let active = true;
    getGateConfig().then((c) => { if (active) { setCfg(c); setLoaded(true); } });
    const unsub = subscribeGateConfig((c) => { if (active) setCfg(c); });
    return () => { active = false; unsub(); };
  }, []);

  // Re-check access on focus
  useEffect(() => {
    const check = () => setUnlocked(hasGateAccess());
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, []);

  // Inject ad snippets after gate is visible & needed
  const shouldShow = loaded && cfg.enabled && !unlocked && !isPremium;
  useEffect(() => {
    if (!shouldShow) return;
    if (nativeRef.current && !nativeRef.current.dataset.mounted && cfg.nativeBanner) {
      injectSnippet(cfg.nativeBanner, nativeRef.current); nativeRef.current.dataset.mounted = "1";
    }
    if (bannerRef.current && !bannerRef.current.dataset.mounted && cfg.banner160x300) {
      injectSnippet(cfg.banner160x300, bannerRef.current); bannerRef.current.dataset.mounted = "1";
    }
    if (socialRef.current && !socialRef.current.dataset.mounted && cfg.socialBar) {
      injectSnippet(cfg.socialBar, socialRef.current); socialRef.current.dataset.mounted = "1";
    }
    if (popunderRef.current && !popunderRef.current.dataset.mounted && cfg.popunder) {
      injectSnippet(cfg.popunder, popunderRef.current); popunderRef.current.dataset.mounted = "1";
    }
  }, [shouldShow, cfg.nativeBanner, cfg.banner160x300, cfg.socialBar, cfg.popunder]);

  // Notify when no gate is needed
  useEffect(() => {
    if (!loaded) return;
    if (!cfg.enabled || unlocked || isPremium) onUnlocked?.();
  }, [loaded, cfg.enabled, unlocked, isPremium, onUnlocked]);

  // Dwell countdown + visibility detection
  const dwellEndRef = useRef<number>(0);
  useEffect(() => {
    if (!awaitingReturn) return;
    let raf = 0;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((dwellEndRef.current - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining > 0) raf = window.setTimeout(tick, 250) as unknown as number;
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // User came back. Did they meet the dwell?
      if (Date.now() >= dwellEndRef.current) {
        const next = progress + 1;
        setGateProgress(next);
        setProgress(next);
        if (next >= cfg.clicksRequired) {
          grantGateAccess(cfg.accessHours);
          setUnlocked(true);
          onUnlocked?.();
        }
      }
      setAwaitingReturn(false);
      setCountdown(0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.clearTimeout(raf); };
  }, [awaitingReturn, progress, cfg.clicksRequired, cfg.accessHours, onUnlocked]);

  if (!shouldShow) return null;

  const handleContinue = () => {
    if (!cfg.directLink) return;
    dwellEndRef.current = Date.now() + cfg.dwellSeconds * 1000;
    setAwaitingReturn(true);
    setCountdown(cfg.dwellSeconds);
    try { window.open(cfg.directLink, "_blank", "noopener"); } catch {}
  };

  const pct = Math.min(100, Math.round((progress / cfg.clicksRequired) * 100));

  return (
    <div className="fixed inset-0 z-[2147483600] bg-background flex flex-col overflow-y-auto">
      {/* Hidden popunder host — fires on any click via the script itself */}
      <div ref={popunderRef} className="absolute pointer-events-none opacity-0" style={{ left: -9999, top: -9999, width: 0, height: 0 }} />

      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-background/90 backdrop-blur-xl border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
            <Lock className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">Unlock Access</p>
            <p className="text-[10px] text-muted-foreground leading-tight">Watch ads to enjoy ad-free playback</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="w-9 h-9 rounded-xl border border-border/40 flex items-center justify-center active:scale-90 transition-transform" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Social bar host (Adsterra mounts its own fixed element from the script) */}
      <div ref={socialRef} className="contents" />

      {/* Ad column — trap layout */}
      <div className="flex-1 px-4 py-4 space-y-4">
        {/* Native banner */}
        <div className="rounded-2xl border border-border/40 bg-card/50 p-3 min-h-[120px] flex items-center justify-center overflow-hidden">
          <div ref={nativeRef} className="w-full" />
        </div>

        {/* 160x300 banner */}
        <div className="rounded-2xl border border-border/40 bg-card/50 p-3 flex items-center justify-center overflow-hidden">
          <div ref={bannerRef} className="flex items-center justify-center" style={{ minWidth: 160, minHeight: 300 }} />
        </div>

        {/* Progress */}
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Progress</p>
            <p className="text-sm font-bold">{progress} / {cfg.clicksRequired}</p>
          </div>
          <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full gradient-primary transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
            Tap the button below, wait <strong>{cfg.dwellSeconds}s</strong> on the ad page, then return here.
            Unlock grants <strong>{cfg.accessHours}h</strong> of ad-free access.
          </p>
        </div>

        {/* Direct link button (with overlay timer) */}
        <div className="relative">
          <button
            onClick={handleContinue}
            disabled={awaitingReturn || !cfg.directLink}
            className="w-full h-16 rounded-2xl gradient-primary text-primary-foreground font-bold text-base flex items-center justify-center gap-2 shadow-[0_8px_30px_hsla(170,75%,45%,0.35)] active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {awaitingReturn ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Waiting for return… {countdown}s
              </>
            ) : (
              <>
                <ExternalLink className="w-5 h-5" />
                Continue (Watch Ad)
              </>
            )}
          </button>
          {awaitingReturn && (
            <p className="text-[11px] text-center text-muted-foreground mt-2">
              Stay on the ad tab for the timer to count. Come back to continue.
            </p>
          )}
        </div>

        <p className="text-[10px] text-center text-muted-foreground/70 leading-relaxed pb-4">
          Ads keep this service free. Premium users skip this step.
        </p>
      </div>
    </div>
  );
};

export default AccessGate;
