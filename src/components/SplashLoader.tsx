import logoImg from "@/assets/logo.png";
import { useBranding } from "@/hooks/useBranding";

/**
 * Ultra-professional splash loader.
 * - Deep cinematic gradient background with subtle aurora glow
 * - Centered logo with double-ring orbital loader
 * - Refined wordmark with letter-spacing + gradient text
 * - Slim animated progress bar with shimmer
 */
const SplashLoader = () => {
  const branding = useBranding();
  const logoSrc = branding.logoUrl ;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#06070b]">
      {/* Aurora gradient backdrop */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 35%, hsla(42,80%,50%,0.18) 0%, transparent 70%), radial-gradient(40% 35% at 50% 80%, hsla(38,90%,48%,0.10) 0%, transparent 70%), linear-gradient(180deg, #06070b 0%, #0a0c12 100%)",
        }}
      />

      {/* Vignette */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(circle at center, transparent 55%, rgba(0,0,0,0.55) 100%)" }}
      />

      {/* Fine grain noise overlay */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative z-10 flex flex-col items-center px-6">
        {/* Logo with orbital rings */}
        <div className="relative w-[140px] h-[140px] flex items-center justify-center">
          {/* Outer slow ring */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: "1.5px solid transparent",
              borderTopColor: "hsla(42,80%,55%,0.85)",
              borderRightColor: "hsla(42,80%,55%,0.25)",
              animation: "spin 2.4s linear infinite",
            }}
          />
          {/* Inner counter ring */}
          <div
            className="absolute inset-3 rounded-full"
            style={{
              border: "1px solid transparent",
              borderBottomColor: "hsla(38,90%,55%,0.9)",
              borderLeftColor: "hsla(38,90%,55%,0.2)",
              animation: "spin 1.6s linear infinite reverse",
            }}
          />
          {/* Soft glow disc */}
          <div
            className="absolute inset-5 rounded-full"
            style={{
              background:
                "radial-gradient(circle, hsla(42,90%,55%,0.35) 0%, hsla(42,90%,55%,0) 70%)",
              animation: "logoPulse 2.6s ease-in-out infinite",
            }}
          />
          {/* Logo */}
          <img
            src={logoSrc}
            alt={branding.splashText}
            className="relative w-[78px] h-[78px] object-contain"
            style={{
              filter:
                "drop-shadow(0 0 18px hsla(42,90%,55%,0.55)) drop-shadow(0 0 2px rgba(255,255,255,0.25))",
            }}
          />
        </div>

        {/* Wordmark */}
        <div
          className="mt-7 text-[26px] font-black tracking-[10px] uppercase relative"
          style={{
            fontFamily: "'Russo One', sans-serif",
            background:
              "linear-gradient(180deg, #ffffff 0%, hsl(42 90% 70%) 55%, hsl(38 90% 50%) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            filter: "drop-shadow(0 2px 14px hsla(42,90%,55%,0.35))",
          }}
        >
          {branding.splashText}
        </div>

        {/* Tagline */}
        <p className="mt-2 text-[10px] uppercase tracking-[6px] text-white/45 font-medium">
          
        </p>

        {/* Progress bar */}
        <div className="mt-7 w-[200px] h-[2px] rounded-full overflow-hidden bg-white/[0.06] relative">
          <div
            className="absolute inset-y-0 left-0 w-[45%] rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, hsl(42 90% 60%) 50%, transparent 100%)",
              animation: "loadingMove 1.4s cubic-bezier(0.4,0,0.2,1) infinite",
            }}
          />
        </div>

        <p className="mt-4 text-[9px] uppercase tracking-[4px] text-white/35">
          
        </p>
      </div>
    </div>
  );
};

export default SplashLoader;
