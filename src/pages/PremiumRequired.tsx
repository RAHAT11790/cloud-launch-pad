import { useNavigate, useSearchParams } from "react-router-dom";
import { Crown, Sparkles, Coins, ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/hooks/useBranding";

export default function PremiumRequired() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const branding = useBranding();
  const title = params.get("title") || "This content";
  const reason = params.get("reason") || "series"; // series | episode | quality | download

  const reasonText: Record<string, string> = {
    series: "This series is Premium Only",
    episode: "This episode is Premium Only",
    quality: "This video quality is Premium Only",
    download: "Downloads are Premium Only",
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_hsl(45_100%_25%/0.25),_transparent_60%),radial-gradient(ellipse_at_bottom,_hsl(280_60%_20%/0.2),_transparent_60%)] bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 pt-8 pb-16">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="mt-8 flex flex-col items-center text-center">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="logo" className="w-20 h-20 rounded-2xl object-cover shadow-2xl ring-2 ring-amber-400/30" />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center shadow-2xl">
              <Crown className="w-10 h-10 text-black" />
            </div>
          )}

          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-300">
            <Lock className="w-3 h-3" /> Premium Required
          </div>

          <h1 className="mt-4 text-3xl sm:text-4xl font-bold bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 bg-clip-text text-transparent">
            {reasonText[reason] || reasonText.series}
          </h1>

          <p className="mt-3 max-w-md text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">{title}</span> is available for premium members only.
            Free users cannot access this content. Get premium to unlock the full experience.
          </p>

          <div className="mt-8 grid w-full max-w-md gap-3">
            <Button
              size="lg"
              onClick={() => navigate("/premium-buy")}
              className="h-14 bg-gradient-to-r from-amber-500 to-yellow-500 text-black hover:from-amber-400 hover:to-yellow-400 font-semibold text-base shadow-lg shadow-amber-500/20"
            >
              <Crown className="w-5 h-5" /> Buy Premium
            </Button>

          </div>

          <div className="mt-10 grid grid-cols-3 gap-3 w-full max-w-md text-left">
            {[
              { icon: Sparkles, label: "All Premium Series" },
              { icon: Crown, label: "4K & 1080p Quality" },
              { icon: Coins, label: "Downloads Unlocked" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="rounded-xl border border-white/5 bg-white/[0.02] p-3 flex flex-col items-start gap-2"
              >
                <Icon className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-muted-foreground leading-snug">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
