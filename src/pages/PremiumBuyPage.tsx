import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CreditCard, KeyRound, Crown, Check, Coins, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/hooks/useBranding";
import { usePremium } from "@/hooks/usePremium";
import { firebaseRestGet } from "@/lib/firebaseRest";
import { buyPremiumWithCoins, type CoinPlan } from "@/lib/premiumAccess";

const DEFAULT_COIN_PLANS: CoinPlan[] = [
  { id: "coin-10d", name: "10 Days", coins: 100, days: 10 },
  { id: "coin-20d", name: "20 Days", coins: 200, days: 20, featured: true },
  { id: "coin-30d", name: "30 Days", coins: 300, days: 30 },
];


export default function PremiumBuyPage() {
  const navigate = useNavigate();
  const branding = useBranding();
  const { isPremium, status, settings, wallet } = usePremium();
  const [lockedCount, setLockedCount] = useState<number>(0);
  const [buying, setBuying] = useState<string | null>(null);

  // Admin-controlled plans (settings.extraPlans); fallback to defaults if none.
  const coinPlans: CoinPlan[] = useMemo(() => {
    const list = (settings?.extraPlans || []).filter(
      (p) => p && typeof p.coins === "number" && typeof p.days === "number",
    );
    return list.length > 0 ? list : DEFAULT_COIN_PLANS;
  }, [settings?.extraPlans]);


  // Bandwidth: count locked titles from the tiny `adminContentIndex` instead of
  // downloading the full `webseries` + `movies` nodes (~20 MB) on every visit.
  useEffect(() => {
    let cancel = false;
    const CACHE_KEY = "rs_locked_count_v1";
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) setLockedCount(Number(cached) || 0);
    } catch {}
    (async () => {
      try {
        const [idxWs, idxMv] = await Promise.all([
          firebaseRestGet<Record<string, any>>("adminContentIndex/webseries"),
          firebaseRestGet<Record<string, any>>("adminContentIndex/movies"),
        ]);
        const count = (obj: any) => Object.values(obj || {}).filter((v: any) => v?.premium).length;
        const total = count(idxWs) + count(idxMv);
        if (cancel) return;
        setLockedCount(total);
        try { sessionStorage.setItem(CACHE_KEY, String(total)); } catch {}
      } catch {}
    })();
    return () => { cancel = true; };
  }, []);

  const dynamicFeatures = useMemo(() => {
    const feats: string[] = [];
    if (lockedCount > 0) feats.push(`Unlock ${lockedCount}+ premium series & movies`);
    const lockedQ = Object.entries(settings.globalQualityLocks || {})
      .filter(([, on]) => on)
      .map(([q]) => q.toUpperCase());
    if (lockedQ.length) feats.push(`${lockedQ.join(", ")} quality unlocked`);
    if (settings.globalDownloadLock) feats.push("Video downloads enabled");
    feats.push("Ad-free playback priority");
    return feats;
  }, [lockedCount, settings.globalQualityLocks, settings.globalDownloadLock]);

  const daysLeft = status && isPremium ? Math.max(0, Math.ceil((status.expiresAt - Date.now()) / 86400000)) : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 pt-6 pb-24">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {/* Hero */}
        <div className="mt-6 rounded-3xl overflow-hidden border border-amber-400/20 bg-gradient-to-br from-amber-500/10 via-yellow-500/5 to-transparent p-6 sm:p-8">
          <div className="flex items-start gap-4">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="logo" className="w-14 h-14 rounded-2xl object-cover ring-2 ring-amber-400/40" />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center">
                <Crown className="w-7 h-7 text-black" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-amber-200 to-yellow-300 bg-clip-text text-transparent">
                {branding.premiumTitle || "Premium Membership"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Unlock all locked series, 4K quality, downloads and more.
              </p>
            </div>
          </div>

          {isPremium && (
            <div className="mt-5 rounded-2xl bg-emerald-500/10 border border-emerald-400/30 px-4 py-2.5 inline-flex items-center gap-2">
              <Crown className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-emerald-200">Active — {daysLeft} days left</span>
            </div>
          )}
        </div>

        {/* Features */}
        {dynamicFeatures.length > 0 && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="text-sm font-semibold mb-3">What you get</h2>
            <ul className="space-y-2 text-sm">
              {dynamicFeatures.map((f) => (
                <li key={f} className="flex gap-2"><Check className="w-4 h-4 text-emerald-400 flex-shrink-0" /> <span>{f}</span></li>
              ))}
            </ul>
          </div>
        )}

        {/* Payment options */}
        <h2 className="mt-8 text-lg font-semibold">Buy Premium</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            className="h-14 justify-start border-white/10 hover:bg-white/5"
            onClick={() => navigate("/premium?tab=bkash")}
          >
            <CreditCard className="w-5 h-5 text-pink-400" />
            <div className="text-left">
              <div className="text-sm font-semibold">bKash</div>
              <div className="text-[11px] text-muted-foreground">Pay manually</div>
            </div>
          </Button>
          <Button
            variant="outline"
            className="h-14 justify-start border-white/10 hover:bg-white/5"
            onClick={() => navigate("/premium?tab=redeem")}
          >
            <KeyRound className="w-5 h-5 text-indigo-400" />
            <div className="text-left">
              <div className="text-sm font-semibold">Redeem Code</div>
              <div className="text-[11px] text-muted-foreground">Use gift code</div>
            </div>
          </Button>
        </div>

        {/* Buy with Coins */}
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Coins className="w-5 h-5 text-amber-300" /> Buy with Coins
            </h2>
            <button
              type="button"
              onClick={() => navigate("/daily-tasks")}
              className="text-[11px] font-semibold text-amber-300 hover:underline"
            >
              Earn coins →
            </button>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Your wallet: <b className="text-amber-300">{wallet.coins || 0}</b> coins • Instant activation, no code needed.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {coinPlans.map((plan) => {
              const enough = (wallet.coins || 0) >= plan.coins;
              const isBuying = buying === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  disabled={!enough || !!buying}
                  onClick={async () => {
                    setBuying(plan.id);
                    const res = await buyPremiumWithCoins(plan);
                    setBuying(null);
                    if (res.ok) {
                      toast.success(`Premium active — ${plan.days} days added!`);
                    } else if ((res as any).reason === "insufficient") {
                      toast.error("Not enough coins. Complete daily tasks to earn more.");
                    } else {
                      toast.error("Could not activate. Try again.");
                    }
                  }}
                  className={[
                    "relative rounded-2xl p-4 text-left border transition-transform active:scale-[0.98]",
                    plan.featured
                      ? "border-amber-400/40 bg-gradient-to-br from-amber-500/15 to-yellow-500/5"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                    !enough ? "opacity-60" : "",
                  ].join(" ")}
                >
                  {plan.featured && (
                    <span className="absolute top-2 right-2 text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-400 text-black inline-flex items-center gap-1">
                      <Sparkles className="w-2.5 h-2.5" /> BEST
                    </span>
                  )}
                  <div className="text-2xl font-black text-foreground leading-none">{plan.days}<span className="text-sm font-semibold text-muted-foreground"> days</span></div>
                  <div className="mt-2 flex items-center gap-1.5 text-amber-300 font-bold text-sm">
                    <Coins className="w-4 h-4" /> {plan.coins} coins
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {isBuying ? "Activating…" : enough ? "Tap to redeem" : `Need ${plan.coins - (wallet.coins || 0)} more`}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
