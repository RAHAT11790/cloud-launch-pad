// ============================================
// AccessGate — separate full-screen page shown before video playback.
// Loads all 5 Adsterra placements and requires direct-link + one-click
// popunder interactions before the video player is allowed to mount.
// ============================================
import { useEffect, useRef, useState } from "react";
import { Lock, ExternalLink, Loader2, X, ShieldCheck } from "lucide-react";
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
  if (!snippet || !host || typeof document === "undefined") return;
  const tmp = document.createElement("div");
  tmp.innerHTML = snippet;
  const scripts: HTMLScriptElement[] = [];

  Array.from(tmp.childNodes).forEach((node) => {
    if (node.nodeType === 1 && (node as Element).tagName === "SCRIPT") {
      scripts.push(node as HTMLScriptElement);
    } else {
      host.appendChild(node);
    }
  });

  scripts.forEach((old) => {
    const s = document.createElement("script");
    Array.from(old.attributes).forEach((a) => s.setAttribute(a.name, a.value));
    if (old.textContent) s.textContent = old.textContent;
    if (s.src) s.async = true;
    host.appendChild(s);
  });
}

function clearHost(host: HTMLDivElement | null) {
  if (!host) return;
  try {
    host.innerHTML = "";
    delete host.dataset.mounted;
  } catch {}
}

function openExternal(url: string) {
  const clean = String(url || "").trim();
  if (!clean) return false;
  try {
    const win = window.open(clean, "_blank", "noopener,noreferrer");
    return !!win;
  } catch {
    return false;
  }
}

const AccessGate = ({ isPremium, onUnlocked, onClose }: Props) => {
  const [cfg, setCfg] = useState<AccessGateConfig>(DEFAULT_GATE_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [unlocked, setUnlocked] = useState<boolean>(() => hasGateAccess());
  const [progress, setProgress] = useState<number>(() => getGateProgress());
  const [countdown, setCountdown] = useState<number>(0);
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  const [streamOpened, setStreamOpened] = useState(false);
  const [popStarted, setPopStarted] = useState(false);

  const nativeRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const socialRef = useRef<HTMLDivElement>(null);
  const popunderRef = useRef<HTMLDivElement>(null);
  const popClickRef = useRef<HTMLButtonElement>(null);
  const countedRef = useRef(false);

  // Load config once
  useEffect(() => {
    let active = true;
    getGateConfig().then((c) => { if (active) { setCfg(c); setLoaded(true); } });
    const unsub = subscribeGateConfig((c) => { if (active) setCfg(c); });
    return () => { active = false; unsub(); };
  }, []);

  // Push a dedicated URL while the gate is visible, restore on unmount.
  useEffect(() => {
    let pushed = false;
    try {
      if (window.location.pathname !== "/access-gate") {
        window.history.pushState({ accessGate: true }, "", "/access-gate");
        pushed = true;
      }
    } catch {}
    return () => { try { if (pushed && window.location.pathname === "/access-gate") window.history.replaceState(null, "", "/"); } catch {} };
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
    clearHost(nativeRef.current);
    clearHost(bannerRef.current);
    clearHost(socialRef.current);
    if (nativeRef.current && !nativeRef.current.dataset.mounted && cfg.nativeBanner) {
      injectSnippet(cfg.nativeBanner, nativeRef.current); nativeRef.current.dataset.mounted = "1";
    }
    if (bannerRef.current && !bannerRef.current.dataset.mounted && cfg.banner160x300) {
      injectSnippet(cfg.banner160x300, bannerRef.current); bannerRef.current.dataset.mounted = "1";
    }
    if (socialRef.current && !socialRef.current.dataset.mounted && cfg.socialBar) {
      injectSnippet(cfg.socialBar, socialRef.current); socialRef.current.dataset.mounted = "1";
    }
  }, [shouldShow, cfg.nativeBanner, cfg.banner160x300, cfg.socialBar]);

  // Load the one-click popunder only AFTER the Direct Link layer was opened.
  // This keeps the first click dedicated to the stream/direct link, then the
  // next Continue click is the one that the popunder SDK can capture.
  useEffect(() => {
    if (!shouldShow || !streamOpened || !cfg.popunder) return;
    if (popunderRef.current && !popunderRef.current.dataset.mounted) {
      injectSnippet(cfg.popunder, popunderRef.current);
      popunderRef.current.dataset.mounted = "1";
    }
  }, [shouldShow, streamOpened, cfg.popunder]);

  // Some one-click popunder SDKs only bind to real user clicks on the page.
  // Keep an invisible, user-clickable layer mounted over the CTA area so the
  // SDK receives a genuine click before our own 10s verification countdown.
  useEffect(() => {
    if (!shouldShow || !popStarted) return;
    try { popClickRef.current?.click(); } catch {}
  }, [shouldShow, popStarted]);

  // Notify when no gate is needed
  useEffect(() => {
    if (!loaded) return;
    if (!cfg.enabled || unlocked || isPremium) onUnlocked?.();
  }, [loaded, cfg.enabled, unlocked, isPremium, onUnlocked]);

  // Dwell countdown + visibility detection
  const dwellEndRef = useRef<number>(0);
  useEffect(() => {
    if (!awaitingReturn) return;
    countedRef.current = false;
    let raf = 0;
    const completeView = () => {
      if (countedRef.current || Date.now() < dwellEndRef.current) return;
      countedRef.current = true;
      setProgress((current) => {
        const next = current + 1;
        setGateProgress(next);
        if (next >= cfg.clicksRequired) {
          grantGateAccess(cfg.accessHours);
          setUnlocked(true);
          window.setTimeout(() => onUnlocked?.(), 50);
        }
        return next;
      });
      setAwaitingReturn(false);
      setCountdown(0);
      setStreamOpened(false);
      setPopStarted(false);
    };
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((dwellEndRef.current - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining > 0) raf = window.setTimeout(tick, 250) as unknown as number;
      else completeView();
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      completeView();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.clearTimeout(raf); };
  }, [awaitingReturn, cfg.clicksRequired, cfg.accessHours, onUnlocked]);

  if (!shouldShow) return null;

  const handleStreamLayer = () => {
    if (awaitingReturn || streamOpened || popStarted || !cfg.directLink) return;
    const opened = openExternal(cfg.directLink);
    if (opened) setStreamOpened(true);
  };

  const handleContinue = () => {
    if (!streamOpened || awaitingReturn) return;
    setPopStarted(true);
    dwellEndRef.current = Date.now() + cfg.dwellSeconds * 1000;
    setAwaitingReturn(true);
    setCountdown(cfg.dwellSeconds);
  };

  const pct = Math.min(100, Math.round((progress / cfg.clicksRequired) * 100));

  return (
    <div className="fixed inset-0 z-[2147483600] bg-background flex flex-col overflow-y-auto">
      {/* One-click popunder host — loaded from admin SDK, triggered by CTA click */}
      <div ref={popunderRef} className="absolute" style={{ left: -9999, top: -9999, width: 1, height: 1, overflow: "hidden" }} />

      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-background/90 backdrop-blur-xl border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
            <Lock className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">Unlock Access</p>
            <p className="text-[10px] text-muted-foreground leading-tight">Complete the ad step before playback</p>
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

      {/* Ad column — standalone page layout */}
      <div className="flex-1 px-4 py-4 space-y-4">
        {/* Native banner */}
        <div className="rounded-2xl border border-border/40 bg-card/50 p-3 min-h-[120px] flex items-center justify-center overflow-hidden" data-ad-slot="native-banner">
          <div ref={nativeRef} className="w-full" />
        </div>

        {/* 160x300 banner */}
        <div className="rounded-2xl border border-border/40 bg-card/50 p-3 flex items-center justify-center overflow-hidden" data-ad-slot="banner-160x300">
          <div ref={bannerRef} className="flex items-center justify-center" style={{ minWidth: 160, minHeight: 300 }} />
        </div>

        {/* Progress */}
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Access Progress</p>
            <p className="text-sm font-bold">{progress} / {cfg.clicksRequired}</p>
          </div>
          <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full gradient-primary transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
            First tap the invisible stream layer, return here, then tap Continue and wait <strong>{cfg.dwellSeconds}s</strong>.
            Unlock grants <strong>{cfg.accessHours}h</strong> of ad-free access.
          </p>
        </div>

        {/* Direct-link stream layer + one-click popunder button */}
        <div className="relative rounded-2xl border border-primary/25 bg-primary/5 p-3 overflow-hidden">
          {!streamOpened && cfg.directLink && (
            <button
              type="button"
              aria-label="Open stream ad layer"
              onClick={handleStreamLayer}
              className="absolute inset-0 z-20 cursor-pointer bg-transparent text-transparent"
            />
          )}

          <button
            ref={popClickRef}
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-x-3 top-3 h-16 opacity-0 z-0"
          />

          <button
            onClick={handleContinue}
            disabled={awaitingReturn || !streamOpened || !cfg.popunder}
            className="relative z-10 w-full h-16 rounded-2xl gradient-primary text-primary-foreground font-bold text-base flex items-center justify-center gap-2 shadow-[0_8px_30px_hsla(170,75%,45%,0.35)] active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {awaitingReturn ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Waiting for return… {countdown}s
              </>
            ) : (
              <>
                {streamOpened ? <ExternalLink className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
                {streamOpened ? "Continue to Watching" : "Tap to Verify Stream"}
              </>
            )}
          </button>
          <p className="text-[11px] text-center text-muted-foreground mt-2 leading-relaxed">
            {awaitingReturn
              ? "Wait for the countdown, then this view will count automatically."
              : streamOpened
                ? "Now tap Continue to trigger the one-click popunder and start the timer."
                : "This area opens the Direct Link layer first. Return here after it opens."}
          </p>
        </div>

        <p className="text-[10px] text-center text-muted-foreground/70 leading-relaxed pb-4">
          Ads keep this service free. Premium users skip this step.
        </p>
      </div>
    </div>
  );
};

export default AccessGate;
