import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft, Coins, CreditCard, KeyRound, Crown, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useBranding } from "@/hooks/useBranding";
import { usePremium } from "@/hooks/usePremium";
import { buyPremiumWithCoins, CoinPlan, ensureGuestUser } from "@/lib/premiumAccess";

export default function PremiumBuyPage() {
  const navigate = useNavigate();
  const branding = useBranding();
  const { isPremium, status, wallet, settings, uid } = usePremium();
  const [busyPlan, setBusyPlan] = useState<string | null>(null);



  const plans: CoinPlan[] = [settings.coinPlan, ...(settings.extraPlans || [])];

  const handleBuyWithCoins = async (plan: CoinPlan) => {
    if (!uid) {
      ensureGuestUser();
    }
    if (wallet.coins < plan.coins) {
      toast({ title: "Not enough coins", description: `You need ${plan.coins} coins. Earn more from Free Premium.`, variant: "destructive" });
      navigate("/free-premium");
      return;
    }
    setBusyPlan(plan.id);
    const res = await buyPremiumWithCoins(plan);
    setBusyPlan(null);
    if (res.ok) {
      toast({ title: "Premium Activated 🎉", description: `Enjoy ${plan.days} days of premium!` });
    } else {
      toast({ title: "Purchase failed", description: (res as any).reason, variant: "destructive" });
    }
  };

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

          {/* Status strip */}
          <div className="mt-5 flex flex-wrap gap-3">
            <div className="rounded-2xl bg-black/40 border border-white/5 px-4 py-2.5 flex items-center gap-2">
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-muted-foreground">Balance</span>
              <span className="text-base font-bold text-amber-300">{wallet.coins}</span>
            </div>
            {isPremium && (
              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-400/30 px-4 py-2.5 flex items-center gap-2">
                <Crown className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-emerald-200">Active — {daysLeft} days left</span>
              </div>
            )}
          </div>
        </div>

        {/* Coin plans */}
        <h2 className="mt-8 text-lg font-semibold flex items-center gap-2">
          <Coins className="w-5 h-5 text-amber-400" /> Buy with Coins
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {plans.map((plan) => {
            const canAfford = wallet.coins >= plan.coins;
            const busy = busyPlan === plan.id;
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl border p-5 transition ${
                  plan.featured
                    ? "border-amber-400/40 bg-gradient-to-br from-amber-500/10 to-yellow-500/5"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                {plan.featured && (
                  <span className="absolute -top-2.5 right-4 text-[10px] font-bold uppercase tracking-wider bg-amber-400 text-black px-2 py-0.5 rounded-full">
                    Recommended
                  </span>
                )}
                <div className="text-sm text-muted-foreground">{plan.name}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-amber-300">{plan.coins}</span>
                  <Coins className="w-4 h-4 text-amber-400" />
                  <span className="text-sm text-muted-foreground">→ {plan.days} days</span>
                </div>
                <ul className="mt-3 space-y-1.5 text-sm">
                  <li className="flex gap-2"><Check className="w-4 h-4 text-emerald-400" /> All premium series</li>
                  <li className="flex gap-2"><Check className="w-4 h-4 text-emerald-400" /> 4K & all qualities</li>
                  <li className="flex gap-2"><Check className="w-4 h-4 text-emerald-400" /> Video downloads</li>
                </ul>
                <Button
                  onClick={() => handleBuyWithCoins(plan)}
                  disabled={busy}
                  className={`mt-4 w-full ${
                    canAfford
                      ? "bg-gradient-to-r from-amber-500 to-yellow-500 text-black hover:from-amber-400 hover:to-yellow-400"
                      : "bg-white/5 text-muted-foreground hover:bg-white/10"
                  }`}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : canAfford ? "Buy Now" : `Need ${plan.coins - wallet.coins} more`}
                </Button>
              </div>
            );
          })}
        </div>

        {/* Other options */}
        <h2 className="mt-8 text-lg font-semibold">Other Options</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Button
            variant="outline"
            className="h-14 justify-start border-white/10 hover:bg-white/5"
            onClick={() => navigate("/free-premium")}
          >
            <Coins className="w-5 h-5 text-amber-400" />
            <div className="text-left">
              <div className="text-sm font-semibold">Free Premium</div>
              <div className="text-xs text-muted-foreground">Earn coins by watching ads</div>
            </div>
          </Button>
          <Button
            variant="outline"
            className="h-14 justify-start border-white/10 hover:bg-white/5"
            onClick={() => navigate("/premium?tab=bkash")}
          >
            <CreditCard className="w-5 h-5 text-pink-400" />
            <div className="text-left">
              <div className="text-sm font-semibold">bKash</div>
              <div className="text-xs text-muted-foreground">Pay via bKash</div>
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
              <div className="text-xs text-muted-foreground">Use gift code</div>
            </div>
          </Button>
        </div>
      </div>
    </div>
  );
}
