import { useBranding } from "@/hooks/useBranding";

/**
 * Anime-style splash loader — ultra optimized.
 * - No top-falling animations.
 * - Background: anime-style mesh/grid + dot scatter + soft drifting glows.
 * - Center: RGB conic spinner around logo.
 * - Title + tagline with RGB cycling glow for readability.
 */

const LOGO_SIZE = 96;
const RING_SIZE = 132;

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
          "radial-gradient(ellipse at 50% 40%, rgba(120,40,180,0.22), transparent 60%), radial-gradient(ellipse at 12% 88%, rgba(255,40,120,0.14), transparent 55%), radial-gradient(ellipse at 88% 14%, rgba(40,180,255,0.16), transparent 55%), linear-gradient(180deg, #05030c 0%, #0d0418 55%, #03020a 100%)",
        animation: "splFadeIn 0.35s ease-out",
      }}
    >
      {/* Anime mesh/grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,90,180,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(120,200,255,0.08) 1px, transparent 1px)",
          backgroundSize: "44px 44px, 44px 44px",
          maskImage: "radial-gradient(ellipse at center, black 25%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 25%, transparent 80%)",
          animation: "bgGridDrift 18s linear infinite",
          willChange: "background-position",
        }}
      />

      {/* Dot scatter (ছিটা-ফুটা) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.55) 1px, transparent 1.4px), radial-gradient(rgba(255,120,200,0.45) 1px, transparent 1.4px)",
          backgroundSize: "26px 26px, 38px 38px",
          backgroundPosition: "0 0, 13px 19px",
          maskImage: "radial-gradient(ellipse at center, black 15%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 15%, transparent 75%)",
        }}
      />

      {/* Diagonal anime speed lines, very subtle */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.07] mix-blend-screen"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, rgba(255,255,255,0.9) 0 1px, transparent 1px 7px)",
        }}
      />

      {/* Soft drifting color glows — stay behind spinner, no outward emission */}
      <div
        className="absolute pointer-events-none rounded-full"
        style={{
          width: 360, height: 360,
          left: "50%", top: "50%",
          transform: "translate(-50%,-50%)",
          background: "radial-gradient(circle, rgba(255,90,180,0.25), transparent 65%)",
          filter: "blur(30px)",
          animation: "auraBreath 5s ease-in-out infinite",
          willChange: "transform, opacity",
        }}
      />
      <div
        className="absolute pointer-events-none rounded-full"
        style={{
          width: 280, height: 280,
          left: "50%", top: "50%",
          transform: "translate(-50%,-50%)",
          background: "radial-gradient(circle, rgba(90,200,255,0.22), transparent 65%)",
          filter: "blur(24px)",
          animation: "auraBreath 6.5s ease-in-out 0.8s infinite",
          willChange: "transform, opacity",
        }}
      />

      {/* Spinner + logo */}
      <div className="relative flex items-center justify-center" style={{ width: RING_SIZE, height: RING_SIZE }}>
        <div
          className="absolute rounded-full"
          style={{
            inset: 0,
            background:
              "conic-gradient(from 0deg, #ff0055, #ff8a00, #ffe600, #00ff85, #00d4ff, #6a5cff, #ff00c8, #ff0055)",
            animation: "rgbConicSpin 2.4s linear infinite",
            filter: "drop-shadow(0 0 16px rgba(255,90,180,0.7)) drop-shadow(0 0 26px rgba(90,200,255,0.45))",
            willChange: "transform",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{ inset: 6, background: "#06040d", boxShadow: "inset 0 0 18px rgba(255,255,255,0.06)" }}
        />
        {logo ? (
          <img
            src={logo}
            alt={title || "Site logo"}
            className="relative z-10 rounded-full object-cover"
            style={{
              width: LOGO_SIZE, height: LOGO_SIZE,
              border: "2px solid rgba(255,255,255,0.4)",
              boxShadow: "0 10px 32px rgba(0,0,0,0.6), 0 0 22px rgba(255,120,200,0.5)",
            }}
          />
        ) : (
          <div
            className="relative z-10 rounded-full"
            style={{
              width: LOGO_SIZE, height: LOGO_SIZE,
              background: "radial-gradient(circle, #fff, #ff9ad5 55%, #6a5cff)",
              boxShadow: "0 0 28px rgba(255,120,200,0.55)",
            }}
          />
        )}
      </div>

      {title && (
        <h1
          className="relative mt-8 px-5 text-center font-black leading-tight"
          style={{
            fontSize: "clamp(24px,6vw,36px)",
            letterSpacing: "0.18em",
            fontFamily: "'Russo One','Bebas Neue','Poppins',system-ui,sans-serif",
            color: "#ffffff",
            animation: "rgbTextGlow 4s ease-in-out infinite",
          }}
        >
          {title}
        </h1>
      )}

      {tagline && (
        <div
          className="relative mt-3 px-4 text-center"
          style={{
            color: "#ffffff",
            fontSize: "clamp(11px,2.6vw,13px)",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            fontWeight: 800,
            animation: "rgbTextGlow 4s ease-in-out 0.6s infinite",
          }}
        >
          {tagline}
        </div>
      )}

      <div className="relative mt-7 w-[260px] max-w-[70vw] h-[3px] bg-white/10 overflow-hidden rounded-full">
        <div
          className="absolute inset-y-0 w-2/3"
          style={{
            background:
              "linear-gradient(90deg, transparent, #ff0055, #ffe600, #00d4ff, #c47bff, transparent)",
            animation: "splashBarFill 1.6s ease-in-out infinite",
            filter: "drop-shadow(0 0 8px rgba(255,120,200,0.7))",
          }}
        />
      </div>
      <div
        className="relative mt-3 text-[10px] tracking-[0.45em] text-white/85"
        style={{ fontFamily: "ui-monospace,monospace", textShadow: "0 0 8px rgba(0,212,255,0.6)" }}
      >
        SYS · LOADING
      </div>
    </div>
  );
};

export default SplashLoader;
