// ============================================
// AccessGate — multi-stage ad trap before video playback.
//
// Flow (designed to maximize verified Adsterra ad views per user):
//   STAGE 1 — Intro Popup (mandatory 5s wait)
//     Modal with Native Banner + Social Bar combo. Close button labeled
//     "Click here to close this ad" is disabled for 5 seconds.
//     On close → fires popunder/social script + opens directLink.
//
//   STAGE 2 — Main Trap (clicksRequired cycles)
//     Each cycle = TWO taps on ACCESS:
//       Tap A (primary)   → opens directLink (stream-link style).
//                           NO count, NO timer. Toast: "Ad not counted yet,
//                           please return and tap ACCESS again."
//       Tap B (secondary) → fires popunder + opens directLink again.
//                           Starts dwell timer (admin-configured seconds).
//                           Toast: "Ad clicked. Stay for Xs to count this view."
//
//   STAGE 3 — Verification (visibility-based)
//     On return to the tab:
//       • If elapsed >= dwellSec → +1 count. Toast success.
//       • If elapsed <  dwellSec → no count. Toast failure (back too early).
//
//   Total per user ≈ 1 intro ad + (clicksRequired × 2) ad opens.
//   Admin sets clicksRequired = 5 → user sees ~11 real ad interactions.
//
// Ad-blocker / DNS guard runs only inside this gate (never on the player).
// All ad scripts and floating layers are torn down on unmount so they
// never leak into Home / Profile / Player.
// ============================================
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Lock, MousePointerClick, ShieldCheck, ShieldAlert, X, Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
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
  onUnlocked?: () => void;
  onClose?: () => void;
}

/* ─── Snippet helpers ─────────────────────────────────────────────── */
function injectSnippet(snippet: string, host: HTMLElement) {
  if (!snippet || !host || typeof document === "undefined") return;
  const tmp = document.createElement("div");
  tmp.innerHTML = snippet;
  const scripts: HTMLScriptElement[] = [];
  Array.from(tmp.childNodes).forEach((node) => {
    if (node.nodeType === 1 && (node as Element).tagName === "SCRIPT") scripts.push(node as HTMLScriptElement);
    else host.appendChild(node);
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
  try { host.innerHTML = ""; delete host.dataset.mounted; } catch {}
}

function openExternal(url: string) {
  const clean = String(url || "").trim();
  if (!clean) return false;
  try { return !!window.open(clean, "_blank", "noopener,noreferrer"); } catch { return false; }
}

/* ─── Ad layer containment ────────────────────────────────────────── */
const ADSTER_HINTS = ["adsterra","effectivecpmnetwork","highperformanceformat","profitabledisplaynetwork","profitableratecpm","cpmrevenuegate","onclkds","onclick","container-"];
function looksLikeGateAdNode(el: Element) {
  const meta = [el.tagName, el.id, typeof el.className === "string" ? el.className : "", el.getAttribute("src") || "", el.getAttribute("data-zone") || ""].join(" ").toLowerCase();
  let html = ""; try { html = el.outerHTML.slice(0, 2000).toLowerCase(); } catch {}
  return ADSTER_HINTS.some((h) => meta.includes(h) || html.includes(h));
}

function clampFloatingAdLayers(initial: Set<Element>, touched: Map<HTMLElement, { pe: string; z: string }>) {
  if (typeof document === "undefined") return;
  Array.from(document.body.children).forEach((node) => {
    if (!(node instanceof HTMLElement) || node.id === "root") return;
    if (!looksLikeGateAdNode(node) && initial.has(node)) return;
    const cs = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const z = Number.parseInt(cs.zIndex || "0", 10) || 0;
    const floating = cs.position === "fixed" || cs.position === "sticky" || z > 1000 || node.tagName === "IFRAME";
    const large = rect.width > window.innerWidth * 0.45 && rect.height > 80;
    if (floating || large || looksLikeGateAdNode(node)) {
      if (!touched.has(node)) touched.set(node, { pe: node.style.pointerEvents, z: node.style.zIndex });
      node.dataset.accessGateRuntime = "1";
      node.style.pointerEvents = "none";
      node.style.zIndex = "2147482000";
    }
  });
}

function cleanupGateRuntime(initial: Set<Element>, touched: Map<HTMLElement, { pe: string; z: string }>) {
  try {
    document.querySelectorAll('script[data-access-gate-script="1"], script[src*="highperformanceformat"], script[src*="profitabledisplaynetwork"], script[src*="profitableratecpm"], script[src*="cpmrevenuegate"], script[src*="adsterra"], script[src*="onclkds"], script[src*="onclick"]').forEach((n) => n.remove());
    Array.from(document.body.children).forEach((node) => {
      if (!(node instanceof HTMLElement) || node.id === "root") return;
      if (node.dataset.accessGateRuntime === "1" || (!initial.has(node) && looksLikeGateAdNode(node))) node.remove();
    });
    touched.forEach((v, n) => {
      if (!n.isConnected) return;
      n.style.pointerEvents = v.pe; n.style.zIndex = v.z;
      delete n.dataset.accessGateRuntime;
    });
    touched.clear();
  } catch {}
}

/* ─── Ad-blocker / DNS detection ──────────────────────────────────── */
async function detectAdBlocker(): Promise<boolean> {
  const bait = document.createElement("div");
  bait.className = "ads adsbox ad-banner adsbygoogle adsterra-banner";
  bait.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:120px;height:40px;";
  bait.innerHTML = "&nbsp;";
  document.body.appendChild(bait);
  await new Promise((r) => setTimeout(r, 120));
  const cs = window.getComputedStyle(bait);
  const baitBlocked = bait.offsetParent === null || bait.offsetHeight === 0 || cs.display === "none" || cs.visibility === "hidden";
  bait.remove();
  if (baitBlocked) return true;

  const probes = ["https://www.effectivecpmnetwork.com/favicon.ico", "https://highperformanceformat.com/favicon.ico"];
  let allFailed = true;
  await Promise.all(probes.map(async (u) => {
    try {
      await fetch(u + "?_=" + Date.now(), { method: "GET", mode: "no-cors", cache: "no-store" });
      allFailed = false;
    } catch {}
  }));
  return allFailed;
}

/* ─── Component ───────────────────────────────────────────────────── */
type ClickStep = "primary" | "secondary";

const AccessGate = ({ isPremium, onUnlocked, onClose }: Props) => {
  const [cfg, setCfg] = useState<AccessGateConfig>(DEFAULT_GATE_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [unlocked, setUnlocked] = useState<boolean>(() => hasGateAccess());
  const [progress, setProgress] = useState<number>(() => getGateProgress());
  const [countdown, setCountdown] = useState<number>(0);
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  const [clickStep, setClickStep] = useState<ClickStep>("primary");

  const [intro, setIntro] = useState(true);
  const [introWait, setIntroWait] = useState(5);
  const [counted, setCounted] = useState<number | null>(null);
  const [blocker, setBlocker] = useState<boolean | null>(null);

  const nativeRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const socialRef = useRef<HTMLDivElement>(null);
  const popunderRef = useRef<HTMLDivElement>(null);
  const introNativeRef = useRef<HTMLDivElement>(null);
  const introBannerRef = useRef<HTMLDivElement>(null);

  const initialBodyChildrenRef = useRef<Set<Element>>(new Set());
  const touchedBodyLayersRef = useRef<Map<HTMLElement, { pe: string; z: string }>>(new Map());

  // dwell tracking
  const dwellEndRef = useRef<number>(0);
  const dwellStartRef = useRef<number>(0);
  const leftPageRef = useRef<boolean>(false);
  const dwellResolvedRef = useRef<boolean>(false);

  /* Load config */
  useEffect(() => {
    let active = true;
    getGateConfig().then((c) => { if (active) { setCfg(c); setLoaded(true); } });
    const unsub = subscribeGateConfig((c) => { if (active) setCfg(c); });
    return () => { active = false; unsub(); };
  }, []);

  /* Dedicated URL */
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

  /* Re-check access on focus */
  useEffect(() => {
    const check = () => setUnlocked(hasGateAccess());
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, []);

  const shouldShow = loaded && cfg.enabled && !unlocked && !isPremium;

  /* Containment */
  useEffect(() => {
    if (!shouldShow) return;
    initialBodyChildrenRef.current = new Set(Array.from(document.body.children));
    document.documentElement.dataset.accessGateActive = "1";
    clampFloatingAdLayers(initialBodyChildrenRef.current, touchedBodyLayersRef.current);
    const guard = window.setInterval(() => clampFloatingAdLayers(initialBodyChildrenRef.current, touchedBodyLayersRef.current), 500);
    return () => {
      window.clearInterval(guard);
      delete document.documentElement.dataset.accessGateActive;
      cleanupGateRuntime(initialBodyChildrenRef.current, touchedBodyLayersRef.current);
      clearHost(nativeRef.current);
      clearHost(bannerRef.current);
      clearHost(socialRef.current);
      clearHost(popunderRef.current);
      clearHost(introNativeRef.current);
      clearHost(introBannerRef.current);
    };
  }, [shouldShow]);

  /* Ad-blocker detection */
  useEffect(() => {
    if (!shouldShow) return;
    setBlocker(null);
    let alive = true;
    detectAdBlocker().then((b) => { if (alive) setBlocker(b); });
    const id = window.setInterval(() => { detectAdBlocker().then((b) => { if (alive) setBlocker(b); }); }, 12000);
    return () => { alive = false; window.clearInterval(id); };
  }, [shouldShow]);

  /* Intro 5s countdown */
  useEffect(() => {
    if (!shouldShow || !intro || blocker !== false) return;
    setIntroWait(5);
    const id = window.setInterval(() => {
      setIntroWait((n) => {
        if (n <= 1) { window.clearInterval(id); return 0; }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [shouldShow, intro, blocker]);

  /* Inject intro ads */
  useEffect(() => {
    if (!shouldShow || !intro || blocker !== false) return;
    if (introNativeRef.current && !introNativeRef.current.dataset.mounted && cfg.nativeBanner) {
      injectSnippet(cfg.nativeBanner, introNativeRef.current);
      introNativeRef.current.dataset.mounted = "1";
    }
    if (introBannerRef.current && !introBannerRef.current.dataset.mounted && (cfg.banner160x300 || cfg.socialBar)) {
      injectSnippet(cfg.banner160x300 || cfg.socialBar, introBannerRef.current);
      introBannerRef.current.dataset.mounted = "1";
    }
  }, [shouldShow, intro, blocker, cfg.nativeBanner, cfg.banner160x300, cfg.socialBar]);

  /* Inject main page ads */
  useEffect(() => {
    if (!shouldShow || intro || blocker !== false) return;
    if (nativeRef.current && !nativeRef.current.dataset.mounted && cfg.nativeBanner) {
      injectSnippet(cfg.nativeBanner, nativeRef.current); nativeRef.current.dataset.mounted = "1";
    }
    if (bannerRef.current && !bannerRef.current.dataset.mounted && cfg.banner160x300) {
      injectSnippet(cfg.banner160x300, bannerRef.current); bannerRef.current.dataset.mounted = "1";
    }
    if (socialRef.current && !socialRef.current.dataset.mounted && cfg.socialBar) {
      injectSnippet(cfg.socialBar, socialRef.current); socialRef.current.dataset.mounted = "1";
    }
  }, [shouldShow, intro, blocker, cfg.nativeBanner, cfg.banner160x300, cfg.socialBar]);

  /* Notify host when access not needed */
  useEffect(() => {
    if (!loaded) return;
    if (!cfg.enabled || unlocked || isPremium) onUnlocked?.();
  }, [loaded, cfg.enabled, unlocked, isPremium, onUnlocked]);

  /* Verify dwell on return to tab */
  const finalizeSuccess = useCallback(() => {
    if (dwellResolvedRef.current) return;
    dwellResolvedRef.current = true;
    setProgress((cur) => {
      const next = cur + 1;
      setGateProgress(next);
      setCounted(next);
      window.setTimeout(() => setCounted(null), 2400);
      toast.success(`Ad #${next} counted! ${next}/${cfg.clicksRequired} verified.`, {
        description: cfg.clicksRequired - next > 0 ? `${cfg.clicksRequired - next} more to unlock ${cfg.accessHours}h ad-free access.` : "Unlocking your ad-free access now…",
        duration: 3500,
      });
      if (next >= cfg.clicksRequired) {
        void grantGateAccess(cfg.accessHours);
        setUnlocked(true);
        window.setTimeout(() => onUnlocked?.(), 50);
      }
      return next;
    });
    setAwaitingReturn(false);
    setCountdown(0);
    setClickStep("primary");
  }, [cfg.clicksRequired, cfg.accessHours, onUnlocked]);

  const finalizeFailure = useCallback((elapsedSec: number) => {
    if (dwellResolvedRef.current) return;
    dwellResolvedRef.current = true;
    setAwaitingReturn(false);
    setCountdown(0);
    setClickStep("secondary"); // let them retry the popunder leg
    toast.error(`Ad not counted — closed after ${elapsedSec}s`, {
      description: `You need to keep the ad open for ${cfg.dwellSeconds}s. Please tap ACCESS again to retry.`,
      duration: 4500,
      icon: "⚠️",
    });
  }, [cfg.dwellSeconds]);

  /* Dwell countdown — runs alongside visibility tracking */
  useEffect(() => {
    if (!awaitingReturn) return;
    let timer = 0;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((dwellEndRef.current - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining > 0) {
        timer = window.setTimeout(tick, 250) as unknown as number;
      } else {
        // timer hit zero — if user is still on tab (never left), count it
        if (!leftPageRef.current && document.visibilityState === "visible") {
          finalizeSuccess();
        }
        // otherwise wait for visibilitychange to resolve
      }
    };
    tick();
    return () => { window.clearTimeout(timer); };
  }, [awaitingReturn, finalizeSuccess]);

  /* Visibility detection during dwell */
  useEffect(() => {
    if (!awaitingReturn) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        leftPageRef.current = true;
        return;
      }
      // returned visible
      if (!leftPageRef.current) return; // didn't actually leave
      const elapsed = Math.floor((Date.now() - dwellStartRef.current) / 1000);
      if (Date.now() >= dwellEndRef.current) finalizeSuccess();
      else finalizeFailure(elapsed);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [awaitingReturn, finalizeSuccess, finalizeFailure]);

  if (!shouldShow) return null;

  /* Intro close — fires ads then enters main */
  const dismissIntro = () => {
    if (introWait > 0) return;
    // fire initial popunder + open direct link
    if (popunderRef.current && cfg.popunder && !popunderRef.current.dataset.mounted) {
      injectSnippet(cfg.popunder, popunderRef.current);
      popunderRef.current.dataset.mounted = "1";
    }
    if (cfg.directLink) openExternal(cfg.directLink);
    toast.success("Intro ad loaded. Now tap ACCESS to start unlocking.", { duration: 3000 });
    clearHost(introNativeRef.current);
    clearHost(introBannerRef.current);
    setIntro(false);
  };

  /* Main ACCESS click — 2-step trap */
  const handleAccessClick = () => {
    if (awaitingReturn || blocker !== false) return;

    if (clickStep === "primary") {
      // PRIMARY tap — open directLink only, no count, no timer
      if (cfg.directLink) openExternal(cfg.directLink);
      else if (cfg.popunder && popunderRef.current) {
        // fallback: re-inject popunder fresh
        try { popunderRef.current.innerHTML = ""; } catch {}
        injectSnippet(cfg.popunder, popunderRef.current);
      }
      toast.message("Ad opened — please return and tap ACCESS once more", {
        description: "This view does NOT count yet. Tap ACCESS again to fire the verified ad.",
        duration: 4000,
        icon: "↩️",
      });
      setClickStep("secondary");
      clampFloatingAdLayers(initialBodyChildrenRef.current, touchedBodyLayersRef.current);
      return;
    }

    // SECONDARY tap — fire popunder + direct link, start dwell verification
    if (popunderRef.current && cfg.popunder) {
      try { popunderRef.current.innerHTML = ""; delete popunderRef.current.dataset.mounted; } catch {}
      injectSnippet(cfg.popunder, popunderRef.current);
      popunderRef.current.dataset.mounted = "1";
    }
    if (cfg.directLink) openExternal(cfg.directLink);

    clampFloatingAdLayers(initialBodyChildrenRef.current, touchedBodyLayersRef.current);

    dwellStartRef.current = Date.now();
    dwellEndRef.current = Date.now() + cfg.dwellSeconds * 1000;
    leftPageRef.current = false;
    dwellResolvedRef.current = false;
    setAwaitingReturn(true);
    setCountdown(cfg.dwellSeconds);

    toast.success(`Ad clicked — wait ${cfg.dwellSeconds}s for the view to count`, {
      description: "Stay on the ad page until the timer ends. Closing early will not count.",
      duration: 4000,
      icon: "⏳",
    });
  };

  const pct = Math.min(100, Math.round((progress / cfg.clicksRequired) * 100));
  const ringSize = 168;
  const ringStroke = 10;
  const radius = (ringSize - ringStroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const timerRatio = awaitingReturn ? Math.max(0, Math.min(1, (cfg.dwellSeconds - countdown) / Math.max(1, cfg.dwellSeconds))) : 0;
  const dashOffset = circumference * (1 - timerRatio);

  const buttonLabel = awaitingReturn
    ? `${countdown}`
    : clickStep === "primary"
      ? "ACCESS"
      : "TAP AGAIN";

  const buttonHint = awaitingReturn
    ? `wait ${cfg.dwellSeconds}s`
    : clickStep === "primary"
      ? `${progress}/${cfg.clicksRequired}`
      : "verify view";

  return (
    <div data-access-gate-root="true" className="fixed inset-0 z-[2147483647] bg-background flex flex-col overflow-y-auto isolate">
      {/* Hidden popunder host */}
      <div ref={popunderRef} className="absolute" style={{ left: -9999, top: -9999, width: 1, height: 1, overflow: "hidden" }} />

      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-background/90 backdrop-blur-xl border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
            <Lock className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">Unlock Access</p>
            <p className="text-[10px] text-muted-foreground leading-tight">{cfg.accessHours}h ad-free after {cfg.clicksRequired} verified views</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="w-9 h-9 rounded-xl border border-border/40 flex items-center justify-center active:scale-90 transition-transform" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Ad-blocker overlay ── */}
      {blocker === true && (
        <div className="fixed inset-0 z-[2147483647] bg-background/95 backdrop-blur-xl flex items-center justify-center p-6">
          <div className="max-w-sm w-full rounded-3xl border border-destructive/40 bg-card p-6 text-center space-y-4 shadow-2xl animate-scale-in">
            <div className="w-16 h-16 rounded-2xl bg-destructive/15 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8 text-destructive" />
            </div>
            <h2 className="text-lg font-extrabold">Ad-Blocker / DNS Detected</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You're using an ad-blocker, VPN, AdGuard DNS, NextDNS, Pi-hole or a custom DNS that blocks ads.
              <br /><br />
              Please <strong>disable it for this site</strong>, then tap Retry. Premium users skip all ads.
            </p>
            <button
              onClick={() => { setBlocker(null); detectAdBlocker().then(setBlocker); }}
              className="w-full h-12 rounded-2xl gradient-primary text-primary-foreground font-bold active:scale-95 transition-transform"
            >
              🔄 Retry
            </button>
          </div>
        </div>
      )}

      {/* ── INTRO popup — banner + social combo, 5s mandatory wait ── */}
      {intro && blocker === false && (
        <div className="fixed inset-0 z-[2147483646] bg-black/70 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="max-w-sm w-full rounded-3xl border border-primary/40 bg-card p-4 sm:p-5 space-y-4 shadow-2xl animate-scale-in">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-extrabold leading-tight">Sponsored — quick look</h2>
                <p className="text-[10.5px] text-muted-foreground leading-tight">
                  Tap the close button below after the {introWait > 0 ? `${introWait}s wait` : "wait"} to continue.
                </p>
              </div>
            </div>

            {/* Native banner combo */}
            <div ref={introNativeRef} className="min-h-[110px] rounded-xl border border-border/40 bg-secondary/30 p-2 overflow-hidden" />
            {/* 160x300 / social bar combo */}
            <div ref={introBannerRef} className="min-h-[180px] rounded-xl border border-border/40 bg-secondary/30 p-2 overflow-hidden flex items-center justify-center" />

            <button
              onClick={dismissIntro}
              disabled={introWait > 0}
              className="w-full h-12 rounded-2xl gradient-primary text-primary-foreground font-extrabold uppercase tracking-wider text-sm active:scale-95 transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" />
              {introWait > 0 ? `Wait ${introWait}s to close…` : "Click here to close this ad"}
            </button>
            <p className="text-[10px] text-center text-muted-foreground/80">
              Closing this ad fires the next sponsor link. {cfg.accessHours}h ad-free access waits after {cfg.clicksRequired} verified views.
            </p>
          </div>
        </div>
      )}

      {/* Social bar host */}
      <div ref={socialRef} className="contents" />

      {/* Main column */}
      <div className="flex-1 px-4 py-4 flex flex-col items-center gap-5 max-w-md w-full mx-auto">
        {/* TOP banner */}
        <div className="w-full rounded-2xl border border-border/40 bg-card/50 p-3 min-h-[110px] flex items-center justify-center overflow-hidden">
          <div ref={nativeRef} className="w-full" />
        </div>

        {/* CIRCULAR timer + Access button (CENTER) */}
        <div className="relative flex items-center justify-center my-2" style={{ width: ringSize, height: ringSize }}>
          <div className="absolute inset-0 rounded-full bg-primary/10 blur-2xl animate-pulse" />
          <svg width={ringSize} height={ringSize} className="absolute inset-0 -rotate-90">
            <circle cx={ringSize/2} cy={ringSize/2} r={radius} stroke="hsl(var(--border))" strokeWidth={ringStroke} fill="none" opacity={0.5} />
            <circle
              cx={ringSize/2} cy={ringSize/2} r={radius}
              stroke="hsl(var(--primary))" strokeWidth={ringStroke} fill="none"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: "stroke-dashoffset 0.3s linear" }}
            />
          </svg>
          <button
            onClick={handleAccessClick}
            disabled={awaitingReturn || blocker !== false}
            className={`relative w-[124px] h-[124px] rounded-full text-primary-foreground flex flex-col items-center justify-center gap-1 shadow-2xl active:scale-90 transition-transform disabled:opacity-90 overflow-hidden ${
              clickStep === "secondary" && !awaitingReturn ? "bg-amber-500" : "gradient-primary"
            }`}
          >
            {awaitingReturn ? (
              <>
                <span className="text-3xl font-extrabold leading-none tabular-nums">{countdown}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">stay on ad</span>
              </>
            ) : (
              <>
                {clickStep === "primary" ? <MousePointerClick className="w-7 h-7" /> : <AlertTriangle className="w-7 h-7" />}
                <span className="text-sm font-extrabold uppercase tracking-wider">{buttonLabel}</span>
                <span className="text-[10px] opacity-90">{buttonHint}</span>
              </>
            )}
          </button>
        </div>

        {/* Step hint */}
        <div className={`text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full ${
          awaitingReturn ? "bg-primary/15 text-primary" : clickStep === "primary" ? "bg-secondary text-foreground/80" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        }`}>
          {awaitingReturn ? "Verifying view…" : clickStep === "primary" ? "Step 1 of 2 — open ad" : "Step 2 of 2 — verify view"}
        </div>

        {/* Counted toast inline */}
        {counted !== null && (
          <div className="rounded-full bg-primary/15 border border-primary/40 px-4 py-1.5 flex items-center gap-2 animate-scale-in">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold">Counted {counted} / {cfg.clicksRequired}</span>
          </div>
        )}

        {/* Linear progress */}
        <div className="w-full space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider">Progress</span>
            <span className="font-bold">{progress} / {cfg.clicksRequired}</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div className="h-full gradient-primary transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Hint */}
        <p className="text-[11px] text-center text-muted-foreground leading-relaxed px-2">
          {awaitingReturn
            ? `Keep the ad open for ${cfg.dwellSeconds}s. Coming back early will not count this view.`
            : clickStep === "primary"
              ? <>Tap <strong>ACCESS</strong> — the sponsor link opens. Return, then tap <strong>TAP AGAIN</strong> to fire the verified ad.</>
              : <>Tap <strong>TAP AGAIN</strong> — wait <strong>{cfg.dwellSeconds}s</strong> on the ad, then return to count this view.</>}
        </p>

        {/* BOTTOM banner */}
        <div className="w-full rounded-2xl border border-border/40 bg-card/50 p-3 flex items-center justify-center overflow-hidden">
          <div ref={bannerRef} className="flex items-center justify-center" style={{ minWidth: 160, minHeight: 300 }} />
        </div>

        <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/70">
          <ShieldCheck className="w-3 h-3" /> Ads keep this service free. Premium users skip this step.
        </div>
      </div>
    </div>
  );
};

export default AccessGate;
