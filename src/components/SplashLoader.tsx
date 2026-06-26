import { useBranding } from "@/hooks/useBranding";

/**
 * Ultra-professional anime-style splash loader.
 * All text/logo values come from admin panel (settings/branding in Firebase).
 * Pure CSS animations — GPU-accelerated transforms only, zero JS loop, no lag.
 */
const SplashLoader = () => {
  const branding = useBranding();
  const title = branding.siteName || "";
  const tagline = branding.siteTagline || branding.splashText || "";
  const logo = branding.logoUrl || "";

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 15% 0%, rgba(80,20,40,0.55) 0%, transparent 55%)," +
          "radial-gradient(ellipse at 85% 100%, rgba(120,30,40,0.45) 0%, transparent 55%)," +
          "radial-gradient(ellipse at 50% 50%, rgba(20,10,25,0.6) 0%, transparent 70%)," +
          "#050507",
      }}
    >
      {/* Subtle scanline veil for anime feel */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.08]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.6) 0px, rgba(255,255,255,0.6) 1px, transparent 1px, transparent 3px)",
        }}
      />
      {/* Moving sheen across the screen */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ mixBlendMode: "screen" }}
      >
        <div
          className="absolute left-0 right-0 h-[40%]"
          style={{
            background:
              "linear-gradient(180deg, transparent, rgba(255,80,100,0.07), transparent)",
            animation: "splashScanline 6s linear infinite",
          }}
        />
      </div>

      {/* Logo + rings stack */}
      <div className="relative w-[200px] h-[200px] flex items-center justify-center">
        {/* Outer soft halo */}
        <div
          className="absolute inset-[-30px] rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(220,40,60,0.45) 0%, rgba(220,40,60,0.18) 35%, transparent 70%)",
            animation: "splashHaloSlow 4s ease-in-out infinite",
            filter: "blur(8px)",
          }}
        />
        {/* Inner glow halo */}
        <div
          className="absolute inset-[-6px] rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(255,90,110,0.5) 0%, transparent 65%)",
            animation: "splashHalo 2.2s ease-in-out infinite",
            filter: "blur(6px)",
          }}
        />
        {/* Shockwave ring */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            border: "1px solid rgba(255,90,110,0.55)",
            animation: "splashShockwave 2.4s ease-out infinite",
          }}
        />

        {/* Conic gradient ring (anime energy) */}
        <div
          className="absolute inset-[-14px] rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(255,60,80,0.95) 60deg, transparent 140deg, transparent 220deg, rgba(255,180,80,0.7) 280deg, transparent 360deg)",
            animation: "splashRingSpin 2.6s linear infinite",
            WebkitMask:
              "radial-gradient(circle, transparent 58%, #000 60%, #000 100%)",
            mask:
              "radial-gradient(circle, transparent 58%, #000 60%, #000 100%)",
          }}
        />
        {/* Counter-rotating thin ring */}
        <div
          className="absolute inset-[-22px] rounded-full"
          style={{
            background:
              "conic-gradient(from 90deg, transparent 0deg, rgba(255,255,255,0.85) 12deg, transparent 30deg, transparent 180deg, rgba(255,255,255,0.4) 195deg, transparent 215deg)",
            animation: "splashRingSpinRev 4s linear infinite",
            WebkitMask:
              "radial-gradient(circle, transparent 66%, #000 67%, #000 100%)",
            mask:
              "radial-gradient(circle, transparent 66%, #000 67%, #000 100%)",
          }}
        />

        {/* Logo */}
        {logo ? (
          <img
            src={logo}
            alt={title}
            className="relative w-[140px] h-[140px] rounded-full object-cover z-10"
            style={{
              boxShadow:
                "0 0 40px rgba(255,60,80,0.55), 0 0 80px rgba(255,60,80,0.25), inset 0 0 20px rgba(0,0,0,0.6)",
            }}
          />
        ) : (
          <div
            className="relative w-[140px] h-[140px] rounded-full z-10"
            style={{
              background:
                "radial-gradient(circle, #2a0a14 0%, #050507 100%)",
              boxShadow:
                "0 0 40px rgba(255,60,80,0.45), inset 0 0 20px rgba(0,0,0,0.6)",
            }}
          />
        )}
      </div>

      {/* Title — admin-driven, shimmer effect */}
      {title && (
        <div
          className="mt-12 text-[24px] font-semibold relative"
          style={{
            fontFamily:
              "'Cormorant Garamond', 'Playfair Display', Georgia, serif",
            letterSpacing: "0.4em",
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.55) 0%, #ffffff 45%, #ffd9dc 55%, rgba(255,255,255,0.55) 100%)",
            backgroundSize: "200% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            animation: "splashTextShimmer 3.5s linear infinite",
            textShadow: "0 0 25px rgba(255,80,100,0.25)",
          }}
        >
          {title}
        </div>
      )}

      {/* Tagline — admin-driven */}
      {tagline && (
        <div
          className="mt-3 text-[11px] text-white/75"
          style={{
            letterSpacing: "0.45em",
            fontFamily: "Georgia, serif",
          }}
        >
          {tagline}
        </div>
      )}

      {/* Animated loading dots */}
      <div className="mt-8 flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-white/80"
            style={{
              animation: `splashDot 1.1s ease-in-out ${i * 0.15}s infinite`,
              boxShadow: "0 0 8px rgba(255,80,100,0.6)",
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default SplashLoader;
