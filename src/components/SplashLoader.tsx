import logoImg from "@/assets/logo.png";
import { useBranding } from "@/hooks/useBranding";

/**
 * Ultra-professional splash loader.
 * Pure CSS, zero JS work, no layout thrash — feels instant even on weak TVs.
 * Animations auto-disable in tv-mode (see index.css).
 */
const SplashLoader = () => {
  const branding = useBranding();
  const logoSrc = branding.logoUrl || logoImg;

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden bg-background flex items-center justify-center">
      {/* Deep gradient backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 35%, hsl(var(--primary) / 0.22) 0%, transparent 55%), radial-gradient(ellipse at 50% 100%, hsl(var(--primary) / 0.12) 0%, transparent 60%), hsl(var(--background))",
        }}
      />

      {/* Subtle grid texture */}
      <div
        className="absolute inset-0 opacity-[0.05] splash-grid pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 75%)",
        }}
      />

      {/* Rotating aura ring */}
      <div className="absolute splash-aura w-[420px] h-[420px] max-w-[80vw] max-h-[80vw] rounded-full pointer-events-none">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0%, hsl(var(--primary) / 0.55) 30%, transparent 60%, hsl(var(--primary) / 0.35) 90%, transparent 100%)",
            filter: "blur(28px)",
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        {/* Logo with soft orbit ring */}
        <div className="relative">
          <div
            className="absolute inset-[-22px] rounded-full border splash-ring"
            style={{ borderColor: "hsl(var(--primary) / 0.35)" }}
          />
          <div
            className="absolute inset-[-12px] rounded-full border splash-ring-inner"
            style={{ borderColor: "hsl(var(--primary) / 0.6)" }}
          />
          <div
            className="relative w-[112px] h-[112px] rounded-2xl flex items-center justify-center splash-logo"
            style={{
              background:
                "linear-gradient(145deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
              boxShadow:
                "0 30px 60px -20px hsl(var(--primary) / 0.45), inset 0 1px 0 hsl(var(--foreground) / 0.06)",
            }}
          >
            <img
              src={logoSrc}
              alt={branding.splashText}
              className="w-[78px] h-[78px] object-contain"
              draggable={false}
            />
          </div>
        </div>

        {/* Wordmark */}
        <div
          className="mt-7 text-[22px] font-black tracking-[8px] uppercase splash-wordmark"
          style={{
            fontFamily: "'Russo One', sans-serif",
            background:
              "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--foreground)), hsl(var(--primary)))",
            backgroundSize: "200% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {branding.splashText}
        </div>

        <p className="mt-2 text-[10px] uppercase tracking-[6px] text-muted-foreground">
          Loading experience
        </p>

        {/* Progress bar */}
        <div
          className="mt-6 w-[200px] h-[3px] rounded-full overflow-hidden relative"
          style={{ background: "hsl(var(--secondary))" }}
        >
          <div
            className="absolute inset-y-0 splash-bar"
            style={{
              width: "45%",
              background:
                "linear-gradient(90deg, transparent, hsl(var(--primary)), transparent)",
              borderRadius: 999,
            }}
          />
        </div>
      </div>

      {/* Footer brand line */}
      <div className="absolute bottom-6 left-0 right-0 text-center">
        <p className="text-[10px] uppercase tracking-[5px] text-muted-foreground/70">
          {branding.siteName}
        </p>
      </div>

      <style>{`
        @keyframes splashAura { to { transform: rotate(360deg); } }
        @keyframes splashRing { to { transform: rotate(360deg); } }
        @keyframes splashRingRev { to { transform: rotate(-360deg); } }
        @keyframes splashLogo {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes splashBar {
          0% { left: -45%; }
          100% { left: 100%; }
        }
        @keyframes splashWord {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .splash-aura { animation: splashAura 14s linear infinite; }
        .splash-ring { animation: splashRing 18s linear infinite; }
        .splash-ring-inner { animation: splashRingRev 11s linear infinite; }
        .splash-logo { animation: splashLogo 3.2s ease-in-out infinite; }
        .splash-bar { animation: splashBar 1.1s cubic-bezier(.65,.05,.36,1) infinite; }
        .splash-wordmark { animation: splashWord 3.8s linear infinite; }
        html.tv-mode .splash-aura,
        html.tv-mode .splash-ring,
        html.tv-mode .splash-ring-inner,
        html.tv-mode .splash-logo,
        html.tv-mode .splash-bar,
        html.tv-mode .splash-wordmark { animation: none !important; }
      `}</style>
    </div>
  );
};

export default SplashLoader;
