import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Coins, Crown, Loader2, Play, Timer, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { useBranding } from "@/hooks/useBranding";
import { usePremium } from "@/hooks/usePremium";
import {
  awardCoin,
  CoinAd,
  getTodayRemaining,
  subscribeCoinAds,
  ensureGuestUser,
} from "@/lib/premiumAccess";
import CoinAnimation from "@/components/CoinAnimation";

interface PendingSession {
  startedAt: number;
  required: number;
  adId: string;
}

const PENDING_KEY = "rs_pending_coin_ad_v2";
const CONFIRMED_KEY = "rs_free_premium_first_tap";
const makeCoinAdSessionId = (slotId: string) => {
  const day = new Date().toISOString().slice(0, 10);
  return `${slotId}_${day}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

/** Inject an SDK snippet or URL into a background container. Non-blocking; ignores errors. */
function injectBackgroundSdk(snippet: string, container: HTMLElement) {
  const s = (snippet || "").trim();
  if (!s) return;
  if (/^https?:\/\//i.test(s) && !s.includes("<")) {
    const script = document.createElement("script");
    script.src = s; script.async = true;
    container.appendChild(script);
    return;
  }
  const tmp = document.createElement("div");
  tmp.innerHTML = s;
  Array.from(tmp.childNodes).forEach((node) => {
    if (node.nodeType === 1 && (node as Element).tagName === "SCRIPT") {
      const old = node as HTMLScriptElement;
      const ns = document.createElement("script");
      Array.from(old.attributes).forEach((a) => ns.setAttribute(a.name, a.value));
      if (old.textContent) ns.textContent = old.textContent;
      if (ns.src) ns.async = true;
      container.appendChild(ns);
    } else {
      container.appendChild(node);
    }
  });
}

const extractFirstUrl = (value: string) => value.match(/https?:\/\/[^'"\s<>]+/)?.[0] || value.trim();
const isScriptPlacement = (value: string) => /<script|\.js(\?|#|$)/i.test(value.trim());

export default function FreePremium() {
  const navigate = useNavigate();
  const branding = useBranding();
  const { uid, wallet, settings } = usePremium();
  const [ads, setAds] = useState<CoinAd[]>([]);
  const [pending, setPending] = useState<PendingSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const [coinAnimTick, setCoinAnimTick] = useState(0);
  const [firstTapDone, setFirstTapDone] = useState<boolean>(() => localStorage.getItem(CONFIRMED_KEY) !== "0");
  const settledRef = useRef<Set<string>>(new Set());
  const bgContainerRef = useRef<HTMLDivElement | null>(null);
  const bannerContainerRef = useRef<HTMLDivElement | null>(null);
  const nativeContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeCoinAds(setAds), []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (raw) setPending(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    const iv = window.setInterval(() => setNow(Date.now()), 300);
    return () => window.clearInterval(iv);
  }, []);

  // Resolve slots
  const popunderAd = ads.find((a) => a.id === "adsterra_popunder" && a.enabled !== false);
  const smartlinkAd = ads.find((a) => a.id === "adsterra_smartlink" && a.enabled !== false);
  const bannerAd = ads.find((a) => a.id === "adsterra_banner_160" && a.enabled !== false && a.url);
  const nativeBannerAd = ads.find((a) => a.id === "adsterra_native_banner" && a.enabled !== false && a.url);
  const socialBarAd = ads.find((a) => a.id === "adsterra_social_bar" && a.enabled !== false && a.url);
  // Popunder/Social Bar SDKs must be preloaded before the user taps; injecting
  // the popunder script inside the click handler is usually too late for mobile
  // browsers and popup blockers. Native + 160x300 banners render separately.
  const backgroundAds = [socialBarAd, popunderAd].filter(Boolean) as CoinAd[];

  // Inject background SDKs (once per ad-list change)
  useEffect(() => {
    if (!bgContainerRef.current) return;
    bgContainerRef.current.innerHTML = "";
    backgroundAds.forEach((ad) => injectBackgroundSdk(ad.url, bgContainerRef.current!));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundAds.map((a) => a.id + a.url).join("|")]);

  useEffect(() => {
    if (!bannerContainerRef.current) return;
    bannerContainerRef.current.innerHTML = "";
    if (bannerAd?.url) injectBackgroundSdk(bannerAd.url, bannerContainerRef.current);
  }, [bannerAd?.url]);

  useEffect(() => {
    if (!nativeContainerRef.current) return;
    nativeContainerRef.current.innerHTML = "";
    if (nativeBannerAd?.url) injectBackgroundSdk(nativeBannerAd.url, nativeContainerRef.current);
  }, [nativeBannerAd?.url]);

  const settlePendingCoin = useCallback(async (quiet = false) => {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return false;
    let p: PendingSession;
    try { p = JSON.parse(raw); } catch { localStorage.removeItem(PENDING_KEY); return false; }
    if (settledRef.current.has(String(p.startedAt))) return true;
    const elapsed = (Date.now() - p.startedAt) / 1000;
    if (elapsed < p.required) {
      setPending(p);
      if (!quiet) {
        toast({
          title: "Timer still running",
          description: `Wait ${Math.ceil(p.required - elapsed)}s more, then return to claim the coin.`,
        });
      }
      return false;
    }

    settledRef.current.add(String(p.startedAt));
    localStorage.removeItem(PENDING_KEY);
    setPending(null);
    const res = await awardCoin(p.adId, settings.dailyAdCap);
    if (res.ok) {
      setCoinAnimTick((t) => t + 1);
      toast({ title: "+1 Coin earned 🎉", description: `Balance: ${res.coins} coins` });
    } else {
      const reason = (res as any).reason;
      if (reason === "daily_cap") toast({ title: "Daily limit reached", description: `Max ${settings.dailyAdCap} coins/day per device.`, variant: "destructive" });
      else if (reason === "no_user") toast({ title: "Guest ID not ready", description: "Tap once again.", variant: "destructive" });
      else toast({ title: "Coin not added", description: "Please open a fresh ad and try again.", variant: "destructive" });
    }
    return true;
  }, [settings.dailyAdCap]);

  // Detect return from ad tab and settle timer. Also settles while the page is
  // visible, so a finished timer does not require a refresh/focus trick.
  useEffect(() => {
    const onFocus = () => { setNow(Date.now()); void settlePendingCoin(false); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const iv = window.setInterval(() => { void settlePendingCoin(true); }, 1000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(iv);
    };
  }, [settlePendingCoin]);

  const remaining = getTodayRemaining(wallet, settings.dailyAdCap);
  const goal = settings.coinPlan.coins;
  const progress = Math.min(100, (wallet.coins / goal) * 100);

  const handleMainButton = async () => {
    if (!uid) ensureGuestUser();
    if (pending) {
      const settled = await settlePendingCoin(false);
      if (settled) return;
    }
    if (remaining <= 0) {
      toast({ title: "Daily limit reached", description: `Max ${settings.dailyAdCap} coins/day. Come back tomorrow.`, variant: "destructive" });
      return;
    }

    localStorage.setItem(CONFIRMED_KEY, "1");
    setFirstTapDone(true);

    // Every tap is one fresh counted slot. Reusing hourly IDs was the reason
    // users got "already collected" after earning only one coin.
    const earnAd = popunderAd || smartlinkAd;
    const earnUrl = (earnAd?.url || "").trim();
    if (!earnAd || !earnUrl) {
      toast({ title: "Ad not configured", description: "Admin has not set the earn-coin ad link yet.", variant: "destructive" });
      return;
    }

    const adId = makeCoinAdSessionId(earnAd.id);
    const p: PendingSession = { startedAt: Date.now(), required: settings.adWatchSeconds, adId };
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    setPending(p);
    toast({
      title: `✅ Timer started — stay ${settings.adWatchSeconds}s`,
      description: "Come back after the timer completes to earn 1 coin.",
      duration: 5000,
    });
    if (isScriptPlacement(earnUrl)) {
      injectBackgroundSdk(earnUrl, bgContainerRef.current || document.body);
    } else {
      window.open(extractFirstUrl(earnUrl), "_blank", "noopener,noreferrer");
    }
  };

  const elapsed = pending ? (now - pending.startedAt) / 1000 : 0;
  const pct = pending ? Math.min(100, (elapsed / pending.required) * 100) : 0;
  const isTimerRunning = !!pending && elapsed < pending.required;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <CoinAnimation trigger={coinAnimTick} />
      {/* Invisible container where background Adsterra SDKs live */}
      <div ref={bgContainerRef} aria-hidden style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", overflow: "hidden", pointerEvents: "none", zIndex: 2147483000 }} />

      <div className="max-w-2xl mx-auto px-4 pt-5 pb-20">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {/* Hero */}
        <div className="mt-5 rounded-2xl overflow-hidden border border-amber-400/25 bg-gradient-to-br from-amber-500/20 via-orange-500/8 to-transparent p-4">
          <div className="flex items-center gap-4">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="logo" className="w-14 h-14 rounded-2xl object-cover ring-2 ring-amber-400/40" />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center">
                <Coins className="w-7 h-7 text-black" />
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold">Free Premium</h1>
              <p className="text-sm text-muted-foreground">Tap the button → earn coins → unlock premium</p>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-black/40 border border-white/5 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Your Balance</span>
              <span className="text-amber-300 font-bold text-lg flex items-center gap-1">
                <Coins className="w-4 h-4" /> {wallet.coins} / {goal}
              </span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-400 to-yellow-300 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{Math.max(0, goal - wallet.coins)} more coins to unlock {settings.coinPlan.days} days of Premium</span>
              {wallet.coins >= goal && (
                <button className="h-7 px-3 rounded-full text-xs font-bold bg-amber-500 text-black hover:bg-amber-400 inline-flex items-center gap-1" onClick={() => navigate("/premium-buy")}>
                  <Crown className="w-3.5 h-3.5" /> Redeem
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2">
            <Timer className="w-3.5 h-3.5" />
            {remaining} of {settings.dailyAdCap} daily coins remaining • Stay {settings.adWatchSeconds}s on ad tab to earn
          </div>
        </div>

        {/* THE ONE professional earn button */}
        <div className="mt-5">
          <div className="relative rounded-2xl overflow-hidden border border-amber-400/30 bg-gradient-to-br from-neutral-950 via-neutral-900 to-black p-4">
            {/* status layer */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${firstTapDone ? "bg-emerald-400" : "bg-amber-400"} animate-pulse`} />
                <span className="text-[11px] uppercase tracking-widest font-bold text-white/70">
                  {isTimerRunning ? "Timer Running" : firstTapDone ? "Ready to Earn" : "Sponsor · Step 1"}
                </span>
              </div>
              <div className="text-[11px] text-white/50 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Real click only
              </div>
            </div>

            {/* Sub-layer explanation */}
            <div className="mb-4 rounded-xl bg-white/5 border border-white/10 p-3 text-[11px] text-white/70 leading-relaxed">
              {!firstTapDone ? (
                <>
                  <b className="text-amber-300">Step 1:</b> First tap opens a preview link. A notice will appear —{" "}
                  <i>"This ad was not counted"</i>. Close the tab and tap the button again to start the {settings.adWatchSeconds}-second count timer.
                </>
              ) : isTimerRunning ? (
                <>
                  <b className="text-emerald-300">Counting…</b> Stay on the ad tab for at least{" "}
                  <b>{Math.max(0, Math.ceil(pending!.required - elapsed))}s</b> more, then return here to receive 1 coin.
                </>
              ) : (
                <>
                  <b className="text-emerald-300">Ready to earn:</b> Tap the button below. The counted {settings.adWatchSeconds}-second timer will start automatically.
                </>
              )}
            </div>

            <button
              onClick={handleMainButton}
              disabled={isTimerRunning || remaining <= 0}
              className="group relative w-full h-11 rounded-xl font-black text-xs tracking-wide overflow-hidden
                         bg-gradient-to-br from-amber-400 via-orange-500 to-amber-600 text-black
                         shadow-[0_20px_60px_-12px_rgba(251,146,60,0.5)]
                         hover:shadow-[0_25px_70px_-10px_rgba(251,146,60,0.7)]
                         active:scale-[0.98] transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              <div className="relative flex items-center justify-center gap-2">
                {isTimerRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Waiting for return… {Math.floor(elapsed)}s / {pending!.required}s</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-black" />
                    <span>{firstTapDone ? `Watch Ad & Earn +1 Coin` : `Open Sponsor · Step 1 of 2`}</span>
                  </>
                )}
              </div>
            </button>

            {isTimerRunning && (
              <div className="mt-4">
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}

            {remaining <= 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-400/30 p-3 text-xs text-red-200">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                Daily coin cap reached for this device. Come back tomorrow to earn more.
              </div>
            )}
          </div>
        </div>

        {bannerAd?.url && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1.5">Sponsored · 160×300</div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2 min-h-[120px] overflow-hidden flex items-center justify-center">
              <div ref={bannerContainerRef} className="w-full max-w-[320px] min-h-[100px] overflow-hidden" />
            </div>
          </div>
        )}

        {nativeBannerAd?.url && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1.5">Sponsored · Native</div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2 min-h-[140px] overflow-hidden">
              <div ref={nativeContainerRef} className="w-full min-h-[120px] overflow-hidden" />
            </div>
          </div>
        )}

        <p className="mt-4 text-[10px] text-muted-foreground text-center leading-relaxed">
          Every click must be a real user click. No ads auto-open on this page.<br />
          Social Bar/In-Page Push and banner placements run from the Adsterra settings only.
        </p>
      </div>
    </div>
  );
}
