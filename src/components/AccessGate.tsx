// ============================================
// AccessGate — standalone full-screen page shown before video playback.
// Layout: top banner → big circular timer → centered ACCESS button → bottom banner + native.
// Flow:
//   1) "Fat" intro layer runs ONE ad (social bar / popunder script preview). User taps Continue.
//   2) Access button becomes active. Each tap opens the Adsterra direct-link in a new tab
//      AND fires the one-click popunder. A 10s circular timer counts down on return.
//   3) Timer completes → +1 count. Repeat until clicksRequired is reached → grant access.
// Ad-blocker / DNS guard runs only inside this gate (never on the player).
// ============================================
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Lock, MousePointerClick, ShieldCheck, ShieldAlert, X, Sparkles } from "lucide-react";
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

/* ─── Ad layer containment (kept tight so they never block the CTA) ── */
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
      if (node.dataset.accessGateRuntime === "1" || !initial.has(node) || looksLikeGateAdNode(node)) node.remove();
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
  // 1) bait element
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

  // 2) DNS / network probe to known ad hosts
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
const AccessGate = ({ isPremium, onUnlocked, onClose }: Props) => {
  const [cfg, setCfg] = useState<AccessGateConfig>(DEFAULT_GATE_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [unlocked, setUnlocked] = useState<boolean>(() => hasGateAccess());
  const [progress, setProgress] = useState<number>(() => getGateProgress());
  const [countdown, setCountdown] = useState<number>(0);
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  const [intro, setIntro] = useState(true);                  // "fat" first-layer overlay
  const [introAdDone, setIntroAdDone] = useState(false);
  const [counted, setCounted] = useState<number | null>(null);
  const [blocker, setBlocker] = useState<boolean | null>(null); // null=checking, true=detected
  const [clickPulse, setClickPulse] = useState(0);

  const nativeRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const socialRef = useRef<HTMLDivElement>(null);
  const popunderRef = useRef<HTMLDivElement>(null);
  const introAdRef = useRef<HTMLDivElement>(null);

  const countedRef = useRef(false);
  const initialBodyChildrenRef = useRef<Set<Element>>(new Set());
  const touchedBodyLayersRef = useRef<Map<HTMLElement, { pe: string; z: string }>>(new Map());
  const dwellEndRef = useRef<number>(0);

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

  /* Containment + cleanup of stray fixed iframes from SDKs */
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
      clearHost(introAdRef.current);
    };
  }, [shouldShow]);

  /* Ad-blocker detection (only while gate is visible) */
  useEffect(() => {
    if (!shouldShow) return;
    setBlocker(null);
    let alive = true;
    detectAdBlocker().then((b) => { if (alive) setBlocker(b); });
    const id = window.setInterval(() => { detectAdBlocker().then((b) => { if (alive) setBlocker(b); }); }, 12000);
    return () => { alive = false; window.clearInterval(id); };
  }, [shouldShow]);

  /* Inject ad slots once gate is visible and not blocked */
  useEffect(() => {
    if (!shouldShow || blocker !== false) return;
    // Intro fat ad — uses social bar snippet (small, runs once)
    if (intro && introAdRef.current && !introAdRef.current.dataset.mounted && (cfg.socialBar || cfg.nativeBanner)) {
      injectSnippet(cfg.socialBar || cfg.nativeBanner, introAdRef.current);
      introAdRef.current.dataset.mounted = "1";
      window.setTimeout(() => setIntroAdDone(true), 1800);
    } else if (intro && !cfg.socialBar && !cfg.nativeBanner) {
      setIntroAdDone(true);
    }
    if (!intro) {
      if (nativeRef.current && !nativeRef.current.dataset.mounted && cfg.nativeBanner) {
        injectSnippet(cfg.nativeBanner, nativeRef.current); nativeRef.current.dataset.mounted = "1";
      }
      if (bannerRef.current && !bannerRef.current.dataset.mounted && cfg.banner160x300) {
        injectSnippet(cfg.banner160x300, bannerRef.current); bannerRef.current.dataset.mounted = "1";
      }
      if (socialRef.current && !socialRef.current.dataset.mounted && cfg.socialBar) {
        injectSnippet(cfg.socialBar, socialRef.current); socialRef.current.dataset.mounted = "1";
      }
    }
  }, [shouldShow, blocker, intro, cfg.nativeBanner, cfg.banner160x300, cfg.socialBar]);

  /* Notify host when access not needed */
  useEffect(() => {
    if (!loaded) return;
    if (!cfg.enabled || unlocked || isPremium) onUnlocked?.();
  }, [loaded, cfg.enabled, unlocked, isPremium, onUnlocked]);

  /* Dwell countdown */
  useEffect(() => {
    if (!awaitingReturn) return;
    countedRef.current = false;
    let timer = 0;
    const complete = () => {
      if (countedRef.current || Date.now() < dwellEndRef.current) return;
      countedRef.current = true;
      setProgress((cur) => {
        const next = cur + 1;
        setGateProgress(next);
        setCounted(next);
        window.setTimeout(() => setCounted(null), 2400);
        if (next >= cfg.clicksRequired) {
          void grantGateAccess(cfg.accessHours);
          setUnlocked(true);
          window.setTimeout(() => onUnlocked?.(), 50);
        }
        return next;
      });
      setAwaitingReturn(false);
      setCountdown(0);
    };
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((dwellEndRef.current - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining > 0) timer = window.setTimeout(tick, 250) as unknown as number;
      else complete();
    };
    tick();
    return () => { window.clearTimeout(timer); };
  }, [awaitingReturn, cfg.clicksRequired, cfg.accessHours, onUnlocked]);

  if (!shouldShow) return null;

  /* Actions */
  const dismissIntro = () => {
    if (!introAdDone) return;
    clearHost(introAdRef.current);
    setIntro(false);
  };

  const handleAccessClick = () => {
    if (awaitingReturn || blocker !== false) return;
    setClickPulse((n) => n + 1);
    // Fire popunder
    if (popunderRef.current && cfg.popunder && !popunderRef.current.dataset.mounted) {
      injectSnippet(cfg.popunder, popunderRef.current);
      popunderRef.current.dataset.mounted = "1";
    }
    // Open direct-link
    if (cfg.directLink) openExternal(cfg.directLink);
    clampFloatingAdLayers(initialBodyChildrenRef.current, touchedBodyLayersRef.current);
    // Start timer
    dwellEndRef.current = Date.now() + cfg.dwellSeconds * 1000;
    setAwaitingReturn(true);
    setCountdown(cfg.dwellSeconds);
  };

  const pct = Math.min(100, Math.round((progress / cfg.clicksRequired) * 100));
  const ringSize = 168;
  const ringStroke = 10;
  const radius = (ringSize - ringStroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const timerRatio = awaitingReturn ? Math.max(0, Math.min(1, (cfg.dwellSeconds - countdown) / Math.max(1, cfg.dwellSeconds))) : 0;
  const dashOffset = circumference * (1 - timerRatio);

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
            <p className="text-[10px] text-muted-foreground leading-tight">{cfg.accessHours}h ad-free after {cfg.clicksRequired} views</p>
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

      {/* ── Intro "fat" first-layer overlay ── runs ONE ad, then user taps Continue ── */}
      {intro && blocker === false && (
        <div className="fixed inset-0 z-[2147483646] bg-background/95 backdrop-blur-xl flex items-center justify-center p-6">
          <div className="max-w-sm w-full rounded-3xl border border-primary/30 bg-card p-5 text-center space-y-4 shadow-2xl animate-scale-in">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto">
              <Sparkles className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-extrabold">One quick ad to start</h2>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">Wait a moment, then tap Continue to begin the {cfg.clicksRequired}-view unlock.</p>
            </div>
            <div ref={introAdRef} className="min-h-[90px] rounded-xl border border-border/40 bg-secondary/30 p-2 overflow-hidden" />
            <button
              onClick={dismissIntro}
              disabled={!introAdDone}
              className="w-full h-12 rounded-2xl gradient-primary text-primary-foreground font-bold active:scale-95 transition-transform disabled:opacity-60"
            >
              {introAdDone ? "Continue →" : "Loading ad…"}
            </button>
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
          {/* Outer glow */}
          <div className="absolute inset-0 rounded-full bg-primary/10 blur-2xl animate-pulse" />
          {/* SVG progress ring */}
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
          {/* Inner button */}
          <button
            key={clickPulse}
            onClick={handleAccessClick}
            disabled={awaitingReturn || blocker !== false}
            className="relative w-[124px] h-[124px] rounded-full gradient-primary text-primary-foreground flex flex-col items-center justify-center gap-1 shadow-2xl active:scale-90 transition-transform disabled:opacity-90 overflow-hidden"
          >
            {/* ripple */}
            {clickPulse > 0 && (
              <span className="pointer-events-none absolute inset-0 rounded-full bg-primary-foreground/30 animate-ping" style={{ animationDuration: "0.7s", animationIterationCount: 1 }} />
            )}
            {awaitingReturn ? (
              <>
                <span className="text-3xl font-extrabold leading-none tabular-nums">{countdown}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">counting…</span>
              </>
            ) : (
              <>
                <MousePointerClick className="w-7 h-7" />
                <span className="text-sm font-extrabold uppercase tracking-wider">Access</span>
                <span className="text-[10px] opacity-90">{progress}/{cfg.clicksRequired}</span>
              </>
            )}
          </button>
        </div>

        {/* Counted toast */}
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
            ? "Stay or return after the timer finishes — this view will count automatically."
            : <>Tap <strong>Access</strong>, an ad opens. Wait <strong>{cfg.dwellSeconds}s</strong>, return — repeat <strong>{cfg.clicksRequired}×</strong> for <strong>{cfg.accessHours}h</strong> ad-free.</>}
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
