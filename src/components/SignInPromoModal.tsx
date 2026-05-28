import { useEffect, useState } from "react";
import { X, History, Heart, Shield, Crown, Sparkles } from "lucide-react";
import { useBranding } from "@/hooks/useBranding";
import logoImg from "@/assets/logo.png";

interface SignInPromoModalProps {
  open: boolean;
  onClose: () => void;
  onSignIn: () => void;
}

const STORAGE_KEY = "rs_signin_promo_seen";

const benefits = [
  { icon: History, title: "Watch History", desc: "Pick up exactly where you left off, on any device." },
  { icon: Heart, title: "Favorites & Lists", desc: "Save anime you love and build your personal library." },
  { icon: Crown, title: "Premium Subscription", desc: "Unlock ad-free streaming with a paid subscription." },
  { icon: Shield, title: "Secure Cloud Sync", desc: "Your progress is safely tied to your account." },
];

const SignInPromoModal = ({ open, onClose, onSignIn }: SignInPromoModalProps) => {
  const branding = useBranding();
  const logoSrc = branding.logoUrl || logoImg;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setMounted(true));
    } else {
      setMounted(false);
    }
  }, [open]);

  if (!open) return null;

  const handleClose = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center px-4"
      style={{
        background: "hsl(var(--background) / 0.78)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-[400px] rounded-3xl overflow-hidden transition-all duration-300 ${
          mounted ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-4 scale-95"
        }`}
        style={{
          background: "linear-gradient(160deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
          border: "1px solid hsl(var(--border))",
          boxShadow:
            "0 40px 80px -20px hsl(var(--primary) / 0.35), 0 20px 40px -10px hsl(0 0% 0% / 0.4)",
        }}
      >
        {/* Top accent gradient */}
        <div
          className="absolute top-0 left-0 right-0 h-1.5"
          style={{
            background:
              "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--primary) / 0.4), hsl(var(--primary)))",
          }}
        />

        {/* Close button */}
        <button
          onClick={handleClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{
            background: "hsl(var(--secondary))",
            color: "hsl(var(--foreground))",
          }}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 pt-8 pb-6 text-center">
          {/* Logo halo */}
          <div className="relative inline-flex">
            <div
              className="absolute inset-[-10px] rounded-full opacity-70"
              style={{
                background:
                  "radial-gradient(circle, hsl(var(--primary) / 0.45) 0%, transparent 70%)",
                filter: "blur(10px)",
              }}
            />
            <div
              className="relative w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: "linear-gradient(145deg, hsl(var(--background)), hsl(var(--card)))",
                boxShadow: "0 10px 30px -10px hsl(var(--primary) / 0.5)",
              }}
            >
              <img src={logoSrc} alt={branding.siteName} className="w-11 h-11 object-contain" />
            </div>
          </div>

          <h2 className="mt-5 text-xl font-extrabold text-foreground tracking-tight">
            Sign in to unlock more
          </h2>
          <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">
            You're browsing as a guest. Create a free account to save your progress and go premium.
          </p>
        </div>

        {/* Benefits */}
        <div className="px-6 pb-2 space-y-2">
          {benefits.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex items-start gap-3 p-3 rounded-2xl"
              style={{ background: "hsl(var(--secondary) / 0.5)" }}
            >
              <div
                className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                style={{
                  background: "hsl(var(--primary) / 0.12)",
                  color: "hsl(var(--primary))",
                }}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-foreground leading-tight">
                  {title}
                </div>
                <div className="text-[11.5px] text-muted-foreground leading-snug mt-0.5">
                  {desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-6 pt-5 pb-6 space-y-2">
          <button
            onClick={onSignIn}
            className="w-full h-12 rounded-2xl font-bold text-[14px] flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
            style={{
              background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.85))",
              color: "hsl(var(--primary-foreground))",
              boxShadow: "0 12px 30px -10px hsl(var(--primary) / 0.6)",
            }}
          >
            <Sparkles className="w-4 h-4" />
            Sign in or create account
          </button>
          <button
            onClick={handleClose}
            className="w-full h-11 rounded-2xl text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Continue as guest
          </button>
        </div>
      </div>
    </div>
  );
};

export default SignInPromoModal;
export { STORAGE_KEY as SIGNIN_PROMO_STORAGE_KEY };
