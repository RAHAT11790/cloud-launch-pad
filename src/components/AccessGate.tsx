// ============================================
// AccessGate — separate full-screen page shown before video playback.
// Loads all 5 Adsterra placements and requires direct-link + one-click
// popunder interactions before the video player is allowed to mount.
// ============================================
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Lock, MousePointerClick, ShieldCheck, TimerReset, X } from "lucide-react";
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
    s.dataset.accessGateScript = "1";
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

const ADSTER_DOMAIN_HINTS = [
  "adsterra",
  "effectivecpmnetwork",
  "highperformanceformat",
  "profitabledisplaynetwork",
  "profitableratecpm",
  "cpmrevenuegate",
  "onclkds",
  "onclick",
  "container-",
];

function looksLikeGateAdNode(el: Element) {
  const meta = [
    el.tagName,
    el.id,
    typeof el.className === "string" ? el.className : "",
    el.getAttribute("src") || "",
    el.getAttribute("data-zone") || "",
    el.getAttribute("data-cfasync") || "",
  ].join(" ").toLowerCase();
  const html = (() => {
    try { return el.outerHTML.slice(0, 2500).toLowerCase(); } catch { return ""; }
  })();
  return ADSTER_DOMAIN_HINTS.some((hint) => meta.includes(hint) || html.includes(hint));
}

function clampFloatingAdLayers(initialBodyChildren: Set<Element>, touched: Map<HTMLElement, { pointerEvents: string; zIndex: string }>) {
  if (typeof document === "undefined") return;
  const appRoot = document.getElementById("root");
  if (appRoot) {
    appRoot.style.position = "relative";
    appRoot.style.zIndex = "2147483647";
    appRoot.style.isolation = "isolate";
  }

  Array.from(document.body.children).forEach((node) => {
    if (!(node instanceof HTMLElement) || node === appRoot) return;
    if (!looksLikeGateAdNode(node) && initialBodyChildren.has(node)) return;

    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const z = Number.parseInt(style.zIndex || "0", 10) || 0;
    const floating = style.position === "fixed" || style.position === "sticky" || z > 1000 || node.tagName === "IFRAME";
    const largeLayer = rect.width > window.innerWidth * 0.45 && rect.height > 80;

    if (floating || largeLayer || looksLikeGateAdNode(node)) {
      if (!touched.has(node)) touched.set(node, { pointerEvents: node.style.pointerEvents, zIndex: node.style.zIndex });
      node.dataset.accessGateRuntime = "1";
      node.style.pointerEvents = "none";
      node.style.zIndex = "2147482000";
    }
  });
}

function cleanupGateRuntime(initialBodyChildren: Set<Element>, touched: Map<HTMLElement, { pointerEvents: string; zIndex: string }>) {
  try {
    document.querySelectorAll('script[data-access-gate-script="1"], script[src*="highperformanceformat"], script[src*="profitabledisplaynetwork"], script[src*="profitableratecpm"], script[src*="cpmrevenuegate"], script[src*="adsterra"], script[src*="onclkds"], script[src*="onclick"]').forEach((node) => node.remove());

    Array.from(document.body.children).forEach((node) => {
      if (!(node instanceof HTMLElement) || node.id === "root") return;
      if (node.dataset.accessGateRuntime === "1" || !initialBodyChildren.has(node) || looksLikeGateAdNode(node)) node.remove();
    });

    touched.forEach((value, node) => {
      if (!node.isConnected) return;
      node.style.pointerEvents = value.pointerEvents;
      node.style.zIndex = value.zIndex;
      delete node.dataset.accessGateRuntime;
    });
    touched.clear();
  } catch {}
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
  const [countedMessage, setCountedMessage] = useState<number | null>(null);

  const nativeRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const socialRef = useRef<HTMLDivElement>(null);
  const popunderRef = useRef<HTMLDivElement>(null);
  const countedRef = useRef(false);
  const initialBodyChildrenRef = useRef<Set<Element>>(new Set());
  const touchedBodyLayersRef = useRef<Map<HTMLElement, { pointerEvents: string; zIndex: string }>>(new Map());
  const appRootStyleRef = useRef<{ position: string; zIndex: string; isolation: string } | null>(null);

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

  // Keep all third-party ad layers contained to this route. Some SDKs append
  // fixed iframes directly to <body>; they must never block the verify button
  // or survive after leaving /access-gate.
  useEffect(() => {
    if (!shouldShow) return;
    initialBodyChildrenRef.current = new Set(Array.from(document.body.children));
    const appRoot = document.getElementById("root");
    if (appRoot && !appRootStyleRef.current) {
      appRootStyleRef.current = {
        position: appRoot.style.position,
        zIndex: appRoot.style.zIndex,
        isolation: appRoot.style.isolation,
      };
    }
    document.documentElement.dataset.accessGateActive = "1";
    clampFloatingAdLayers(initialBodyChildrenRef.current, touchedBodyLayersRef.current);
    const guard = window.setInterval(() => clampFloatingAdLayers(initialBodyChildrenRef.current, touchedBodyLayersRef.current), 450);
    return () => {
      window.clearInterval(guard);
      delete document.documentElement.dataset.accessGateActive;
      cleanupGateRuntime(initialBodyChildrenRef.current, touchedBodyLayersRef.current);
      const root = document.getElementById("root");
      if (root && appRootStyleRef.current) {
        root.style.position = appRootStyleRef.current.position;
        root.style.zIndex = appRootStyleRef.current.zIndex;
        root.style.isolation = appRootStyleRef.current.isolation;
      }
      appRootStyleRef.current = null;
      clearHost(nativeRef.current);
      clearHost(bannerRef.current);
      clearHost(socialRef.current);
      clearHost(popunderRef.current);
    };
  }, [shouldShow]);

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
        setCountedMessage(next);
        window.setTimeout(() => setCountedMessage(null), 2600);
        if (next >= cfg.clicksRequired) {
          void grantGateAccess(cfg.accessHours);
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
    if (awaitingReturn || streamOpened || popStarted) return;
    setCountedMessage(null);
    if (!cfg.directLink) {
      setStreamOpened(true);
      return;
    }
    openExternal(cfg.directLink);
    setStreamOpened(true);
  };

  const handleContinue = () => {
    if (!streamOpened || awaitingReturn) return;
    if (popunderRef.current && cfg.popunder && !popunderRef.current.dataset.mounted) {
      injectSnippet(cfg.popunder, popunderRef.current);
      popunderRef.current.dataset.mounted = "1";
    }
    clampFloatingAdLayers(initialBodyChildrenRef.current, touchedBodyLayersRef.current);
    setPopStarted(true);
    dwellEndRef.current = Date.now() + cfg.dwellSeconds * 1000;
    setAwaitingReturn(true);
    setCountdown(cfg.dwellSeconds);
  };

  const pct = Math.min(100, Math.round((progress / cfg.clicksRequired) * 100));
  const timerPct = awaitingReturn ? Math.min(100, Math.max(0, ((cfg.dwellSeconds - countdown) / Math.max(1, cfg.dwellSeconds)) * 100)) : 0;

  return (
    <div data-access-gate-root="true" className="fixed inset-0 z-[2147483647] bg-background flex flex-col overflow-y-auto isolate">
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

        {/* Direct-link + one-click popunder button. No invisible overlay here, so the CTA always receives the tap. */}
        <div className="sticky bottom-3 z-[2147483647] relative rounded-2xl border border-primary/25 bg-primary/10 p-3 overflow-hidden shadow-2xl backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 rounded-2xl border border-primary/40 animate-pulse" />
          {countedMessage !== null && !awaitingReturn && (
            <div className="mb-3 rounded-xl border border-primary/30 bg-primary/15 px-3 py-2 flex items-center justify-center gap-2 animate-scale-in">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold">Counted {countedMessage}</span>
            </div>
          )}
          <button
            onClick={streamOpened ? handleContinue : handleStreamLayer}
            disabled={awaitingReturn}
            className="relative z-10 w-full h-16 rounded-2xl gradient-primary text-primary-foreground font-bold text-base flex items-center justify-center gap-2 shadow-lg active:scale-[0.96] transition-transform disabled:opacity-80 overflow-hidden"
          >
            {awaitingReturn && (
              <span
                className="absolute inset-y-0 left-0 bg-primary-foreground/20 transition-all duration-300"
                style={{ width: `${timerPct}%` }}
              />
            )}
            {awaitingReturn ? (
              <>
                <TimerReset className="relative z-10 w-5 h-5 animate-spin" />
                <span className="relative z-10">Timer Running · {countdown}s</span>
              </>
            ) : (
              <>
                {streamOpened ? <MousePointerClick className="w-5 h-5 animate-pulse" /> : <ShieldCheck className="w-5 h-5" />}
                {streamOpened ? "Start 10s Verification" : "Open Ad & Verify"}
              </>
            )}
          </button>
          <p className="text-[11px] text-center text-muted-foreground mt-2 leading-relaxed">
            {awaitingReturn
              ? "Timer started. Return after it finishes and this view will count automatically."
              : streamOpened
                ? "Tap the button once. The one-click popunder starts here, then wait for the timer."
                : "Only this button opens the ad layer. Other page ads cannot block this tap."}
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
