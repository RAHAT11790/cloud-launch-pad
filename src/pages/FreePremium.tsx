import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Coins, Crown, Loader2, Play, Check, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useBranding } from "@/hooks/useBranding";
import { usePremium } from "@/hooks/usePremium";
import { awardCoin, CoinAd, getTodayRemaining, subscribeCoinAds, wasAdWatchedToday } from "@/lib/premiumAccess";
import CoinAnimation from "@/components/CoinAnimation";

interface PendingAd {
  id: string;
  startedAt: number;
  required: number;
}

const PENDING_KEY = "rs_pending_coin_ad";

export default function FreePremium() {
  const navigate = useNavigate();
  const branding = useBranding();
  const { uid, wallet, settings } = usePremium();
  const [ads, setAds] = useState<CoinAd[]>([]);
  const [pending, setPending] = useState<PendingAd | null>(null);
  const [now, setNow] = useState(Date.now());
  const [coinAnimTick, setCoinAnimTick] = useState(0);
  const settledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const u = subscribeCoinAds(setAds);
    return u;
  }, []);

  // Load any pending session from localStorage
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

  // When the tab regains focus, check if a pending ad has crossed the threshold
  useEffect(() => {
    const onFocus = async () => {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return;
      let p: PendingAd;
      try { p = JSON.parse(raw); } catch { return; }
      const elapsed = (Date.now() - p.startedAt) / 1000;
      if (settledRef.current.has(p.id)) return;
      if (elapsed >= p.required) {
        settledRef.current.add(p.id);
        localStorage.removeItem(PENDING_KEY);
        setPending(null);
        const res = await awardCoin(p.id, settings.dailyAdCap);
        if (res.ok) {
          setCoinAnimTick((t) => t + 1);
          toast({ title: "+1 Coin earned 🎉", description: `Balance: ${res.coins} coins` });
        } else {
          const reason = res.reason;
          if (reason === "already_watched") toast({ title: "Already watched today", description: "Try another ad." });
          else if (reason === "daily_cap") toast({ title: "Daily limit reached", description: `You can watch ${settings.dailyAdCap} ads/day.` });
          else if (reason === "no_user") toast({ title: "Login required", variant: "destructive" });
        }


      } else {
        // returned too early → discard
        localStorage.removeItem(PENDING_KEY);
        setPending(null);
        toast({
          title: "Not counted",
          description: `You returned after ${Math.floor(elapsed)}s. Stay at least ${p.required}s to earn a coin.`,
          variant: "destructive",
        });
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [settings.dailyAdCap]);

  const startAd = (ad: CoinAd) => {
    if (!uid) {
      toast({ title: "Login required", variant: "destructive" });
      return;
    }
    if (wasAdWatchedToday(wallet, ad.id)) {
      toast({ title: "Already watched today", description: "Come back tomorrow!" });
      return;
    }
    const remaining = getTodayRemaining(wallet, settings.dailyAdCap);
    if (remaining <= 0) {
      toast({ title: "Daily limit reached", description: `${settings.dailyAdCap} ads/day.` });
      return;
    }
    const p: PendingAd = { id: ad.id, startedAt: Date.now(), required: settings.adWatchSeconds };
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    setPending(p);
    window.open(ad.url, "_blank", "noopener,noreferrer");
  };

  const remaining = getTodayRemaining(wallet, settings.dailyAdCap);
  const goal = settings.coinPlan.coins;
  const progress = Math.min(100, (wallet.coins / goal) * 100);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <CoinAnimation trigger={coinAnimTick} />
      <div className="max-w-3xl mx-auto px-5 pt-6 pb-24">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {/* Hero */}
        <div className="mt-6 rounded-3xl overflow-hidden border border-amber-400/20 bg-gradient-to-br from-amber-500/15 via-orange-500/5 to-transparent p-6">
          <div className="flex items-center gap-4">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="logo" className="w-14 h-14 rounded-2xl object-cover ring-2 ring-amber-400/40" />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center">
                <Coins className="w-7 h-7 text-black" />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold">Free Premium</h1>
              <p className="text-sm text-muted-foreground">Watch ads → earn coins → unlock premium</p>
            </div>
          </div>

          {/* Coin balance + progress */}
          <div className="mt-6 rounded-2xl bg-black/40 border border-white/5 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Your Balance</span>
              <span className="text-amber-300 font-bold text-lg flex items-center gap-1">
                <Coins className="w-4 h-4" /> {wallet.coins} / {goal}
              </span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-yellow-300 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{Math.max(0, goal - wallet.coins)} more coins to unlock {settings.coinPlan.days} days of Premium</span>
              {wallet.coins >= goal && (
                <Button size="sm" className="h-7 bg-amber-500 text-black hover:bg-amber-400" onClick={() => navigate("/premium-buy")}>
                  <Crown className="w-3.5 h-3.5" /> Redeem
                </Button>
              )}
            </div>
          </div>

          <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2">
            <Timer className="w-3.5 h-3.5" />
            {remaining} of {settings.dailyAdCap} daily ads remaining • Stay at least {settings.adWatchSeconds}s to earn
          </div>
        </div>

        {/* Ads grid */}
        <h2 className="mt-8 text-lg font-semibold">Available Ads</h2>
        {ads.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center text-muted-foreground">
            No ads configured yet. Check back soon!
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {ads.filter(a => a.enabled !== false).map((ad, idx) => {
              const watched = wasAdWatchedToday(wallet, ad.id);
              const isPending = pending?.id === ad.id;
              const elapsed = isPending ? (now - pending!.startedAt) / 1000 : 0;
              const pct = isPending ? Math.min(100, (elapsed / pending!.required) * 100) : 0;
              return (
                <div
                  key={ad.id}
                  className={`rounded-2xl border p-4 transition ${
                    watched ? "border-emerald-400/30 bg-emerald-500/5 opacity-80" : "border-white/10 bg-white/[0.02] hover:border-amber-400/30"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${watched ? "bg-emerald-500/20" : "bg-amber-500/15"}`}>
                      {watched ? <Check className="w-5 h-5 text-emerald-400" /> : <Play className="w-5 h-5 text-amber-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{ad.name || `Ad #${idx + 1}`}</div>
                      <div className="text-xs text-muted-foreground">+1 coin • {settings.adWatchSeconds}s</div>
                    </div>
                    <Button
                      size="sm"
                      disabled={watched || remaining <= 0}
                      onClick={() => startAd(ad)}
                      className={watched ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500 text-black hover:bg-amber-400"}
                    >
                      {watched ? "Done" : isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Watch"}
                    </Button>
                  </div>
                  {isPending && !watched && (
                    <div className="mt-3">
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Waiting for your return... {Math.floor(elapsed)}s / {pending!.required}s
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-6 text-xs text-muted-foreground text-center">
          Rule: click an ad, stay on the ad page for at least {settings.adWatchSeconds} seconds, then come back. Coins are awarded on return.
        </p>
      </div>
    </div>
  );
}
