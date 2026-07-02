import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CreditCard, KeyRound, Crown, Check, Coins, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/hooks/useBranding";
import { usePremium } from "@/hooks/usePremium";
import { db, ref, get } from "@/lib/firebase";
import { buyPremiumWithCoins, type CoinPlan } from "@/lib/premiumAccess";

const COIN_PLANS: CoinPlan[] = [
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

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [wsSnap, mvSnap] = await Promise.all([
          get(ref(db, "webseries")),
          get(ref(db, "movies")),
        ]);
        const count = (obj: any) => Object.values(obj || {}).filter((v: any) => v?.premium).length;
        if (!cancel) setLockedCount(count(wsSnap.val()) + count(mvSnap.val()));
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
      </div>
    </div>
  );
}
