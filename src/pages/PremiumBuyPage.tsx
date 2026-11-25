import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, KeyRound, Crown, Coins, Sparkles, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useBranding } from "@/hooks/useBranding";
import { usePremium } from "@/hooks/usePremium";
import { firebaseRestGet } from "@/lib/firebaseRest";
import { buyPremiumWithCoins, type CoinPlan } from "@/lib/premiumAccess";
import { premiumPayPath } from "@/lib/premiumPayLink";
import LuckySpinButton from "@/components/luckyspin/LuckySpinButton";
import { usePaymentGateway } from "@/hooks/usePaymentGateway";
import { usableMethods, priceFor, plansFor } from "@/lib/paymentGateway";
import { MethodTile, AdminContactCard } from "@/components/premium/PaymentBits";
import { PremiumBenefits } from "@/components/premium/PremiumBenefits";

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
  const { config: gateway, plans } = usePaymentGateway();
  const methods = useMemo(() => usableMethods(gateway), [gateway]);
  const mainMethods = methods.filter((m) => m.kind !== "other");
  const otherMethods = methods.filter((m) => m.kind === "other");

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
    feats.push("No watermark on the player");
    return gateway.benefits.length ? gateway.benefits : feats;
  }, [lockedCount, settings.globalQualityLocks, settings.globalDownloadLock, gateway.benefits]);
  const bestIdx = plans.length >= 3 ? 1 : -1;

  const daysLeft = status && isPremium ? Math.max(0, Math.ceil((status.expiresAt - Date.now()) / 86400000)) : 0;

  return (
    <div className="min-h-screen pg3d-page text-foreground">
      <div className="max-w-3xl mx-auto px-4 pt-5 pb-24 space-y-5">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {/* Hero */}
        <div className="pg3d-hero" data-premium-hero>
          <div className="relative z-[1] flex items-center gap-4">
            <div className="pg3d-medal">
              {branding.logoUrl ? <img src={branding.logoUrl} alt="" /> : <Crown className="w-9 h-9 text-background" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black tracking-[0.2em] text-primary/90 uppercase">RS ANIME03</p>
              <h1 className="text-2xl font-black leading-tight pg3d-title">{branding.premiumTitle || "Premium Membership"}</h1>
              <p className="mt-1 text-[12px] text-muted-foreground">Every series, best quality, downloads — no ads.</p>
            </div>
          </div>
          {isPremium && (
            <div className="relative z-[1] mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 bg-emerald-500/15 border border-emerald-400/30">
              <Crown className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-200">Active — {daysLeft} days left</span>
            </div>
          )}
        </div>

        {/* Benefits */}
        {dynamicFeatures.length > 0 && (
          <div className="pg3d-card" data-premium-benefits>
            <h2 className="pg3d-h">What you get</h2>
            <PremiumBenefits benefits={gateway.benefits} fallback={dynamicFeatures} />
          </div>
        )}

        {/* Price list */}
        {plans.length > 0 && (
          <div data-premium-plans>
            <h2 className="pg3d-h px-1">Price list</h2>
            <div className="pg3d-plans">
              {plans.map((p: any, i: number) => (
                <div key={p.id || i} className={`pg3d-plan ${i === bestIdx ? "is-best" : ""}`}>
                  {i === bestIdx && <span className="absolute -top-2 right-3 text-[9px] font-black px-1.5 py-0.5 rounded bg-primary text-primary-foreground inline-flex items-center gap-1"><Sparkles className="w-2.5 h-2.5" /> BEST</span>}
                  <p className="text-[12px] font-bold text-muted-foreground">{p.name}</p>
                  <p className="mt-1 text-2xl font-black pg3d-title">৳{p.price}</p>

                  <p className="mt-2 text-[11px] text-foreground/80">{p.days} days</p>
                  <p className="text-[11px] text-foreground/60 inline-flex items-center gap-1"><Smartphone className="w-3 h-3" /> {p.maxDevices || 1} device{(p.maxDevices || 1) > 1 ? "s" : ""}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {mainMethods.filter((m) => m.kind === "crypto").map((method) => {
          const cryptoPlans = plansFor(method, plans);
          return cryptoPlans.length > 0 ? <div key={method.id} data-crypto-price-list={method.id}>
            <h2 className="pg3d-h px-1">{method.name} · USDT price list</h2>
            <div className="pg3d-plans">{cryptoPlans.map((plan) => <div key={plan.id} className="pg3d-plan">
              <p className="text-[12px] font-bold text-muted-foreground">{plan.name}</p>
              <p className="mt-1 text-xl font-black pg3d-title">{priceFor(method, Number(plan.price) || 0)}</p>
              <p className="mt-2 text-[11px] text-foreground/80">{plan.days} days · {plan.maxDevices || 1} devices</p>
            </div>)}</div>
          </div> : null;
        })}

        {/* Payment methods */}
        <div className="pg3d-card" data-premium-methods>
          <h2 className="pg3d-h">Pay with</h2>
          <div className="pg3d-methods">
            {mainMethods.map((m, i) => (
              <MethodTile key={m.id} method={m} index={i} onClick={() => navigate(premiumPayPath(m.id))} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <button type="button" onClick={() => navigate(premiumPayPath("redeem"))} className="pg3d-method" style={{ ["--mc" as any]: "hsl(250 80% 65%)", animationDelay: `${mainMethods.length * 70}ms` }} data-pay-method="redeem">
              <span className="pg3d-tile is-dark"><KeyRound className="w-7 h-7 text-primary" /></span>
              <span className="pg3d-chip">Redeem Code</span>
            </button>
          </div>
          {mainMethods.length === 0 && <p className="mt-3 text-[12px] text-muted-foreground">Online payment is being set up — use a redeem code or contact the admin.</p>}
        </div>

        {/* Others */}
        {(otherMethods.length > 0 || (gateway.contact.enabled && (gateway.contact.telegram || gateway.contact.whatsapp))) && (
          <div className="pg3d-card space-y-3" data-premium-others>
            <h2 className="pg3d-h !mb-0">Others</h2>
            {otherMethods.length > 0 && (
              <div className="pg3d-methods">
                {otherMethods.map((m, i) => <MethodTile key={m.id} method={m} index={i} onClick={() => navigate(premiumPayPath(m.id))} />)}
              </div>
            )}
            <AdminContactCard contact={gateway.contact} />
          </div>
        )}

        {/* Lucky Spin — shown only while the admin has it switched on */}
        <div><LuckySpinButton /></div>

        {/* Buy with Coins — admin can close this store from Daily Task Manager */}
        {settings.coinStoreEnabled === false ? (
          <div className="pg3d-card flex items-start gap-3" data-coin-store-closed>
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0"><Coins className="w-5 h-5 text-amber-300/70" /></div>
            <div>
              <h2 className="text-sm font-semibold">Coin store is closed</h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Buying Premium with coins is paused right now. Your {wallet.coins || 0} coins are safe — pay online or use a redeem code above.</p>
            </div>
          </div>
        ) : (
        <div className="pg3d-card">
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
                      toast.success(`Premium active — ${plan.days} days added! Refreshing to remove ads…`);
                    } else if ((res as any).reason === "store_closed") {
                      toast.error("The coin store is closed right now.");
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
        )}
      </div>
    </div>
  );
}
