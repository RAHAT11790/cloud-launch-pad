import { useBranding } from "@/hooks/useBranding";

/**
 * Anime-style splash loader.
 * - RGB conic spinner in the middle (around the logo).
 * - ALL emissions come FROM the spinner outward: dots, streaks, aura rings, rotating light beams.
 * - Anime-style background: dark gradient + faint hex/grid + scanlines + corner brackets + kanji ghost.
 * - Text has strong RGB cycling glow for readability. No falling-from-top anything.
 */

const LOGO_SIZE = 96;
const RING_SIZE = 132;

const palette = ["#ff0055", "#ff8a00", "#ffe600", "#00ff85", "#00d4ff", "#6a5cff", "#ff00c8"];

// Dust dots radiating outward from spinner center
const DOT_COUNT = 48;
const dots = Array.from({ length: DOT_COUNT }, (_, i) => {
  const angle = (i / DOT_COUNT) * Math.PI * 2 + (i % 4) * 0.12;
  const distance = 180 + (i % 7) * 38;
  return {
    dx: `${Math.cos(angle) * distance}px`,
    dy: `${Math.sin(angle) * distance}px`,
    delay: `${(i * 0.09) % 3.2}s`,
    dur: `${2.4 + (i % 5) * 0.35}s`,
    color: palette[i % palette.length],
    size: 3 + (i % 4),
  };
});

// Streak lines shooting outward
const STREAK_COUNT = 18;
const streaks = Array.from({ length: STREAK_COUNT }, (_, i) => ({
  rot: `${(i / STREAK_COUNT) * 360}deg`,
  delay: `${(i * 0.16) % 2.4}s`,
  dur: `${1.6 + (i % 4) * 0.25}s`,
  color: palette[i % palette.length],
  w: 60 + (i % 3) * 24,
}));

// Expanding aura rings
const auras = [0, 0.7, 1.4, 2.1];

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
          "radial-gradient(ellipse at 50% 45%, rgba(120,40,180,0.22), transparent 55%), radial-gradient(ellipse at 12% 88%, rgba(255,40,120,0.14), transparent 50%), radial-gradient(ellipse at 88% 12%, rgba(40,180,255,0.16), transparent 50%), linear-gradient(180deg, #05030c 0%, #0d0418 55%, #03020a 100%)",
        animation: "splFadeIn 0.35s ease-out",
      }}
    >
      {/* Anime grid + scanlines bg */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "80px 80px, 80px 80px",
          animation: "bgGridDrift 12s linear infinite",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.18] mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 4px)",
        }}
      />

      {/* Corner brackets — anime HUD vibe */}
      {[
        { top: 18, left: 18, borderTop: 2, borderLeft: 2 },
        { top: 18, right: 18, borderTop: 2, borderRight: 2 },
        { bottom: 18, left: 18, borderBottom: 2, borderLeft: 2 },
        { bottom: 18, right: 18, borderBottom: 2, borderRight: 2 },
      ].map((p, i) => (
        <span
          key={`corner-${i}`}
          className="absolute pointer-events-none"
          style={{
            width: 36,
            height: 36,
            borderStyle: "solid",
            borderColor: "rgba(255,90,180,0.65)",
            borderWidth: 0,
            boxShadow: "0 0 12px rgba(255,90,180,0.45)",
            animation: "splashCorner 2.4s ease-in-out infinite",
            ...p,
          }}
        />
      ))}

      {/* Kanji ghost */}
      <div
        className="absolute pointer-events-none select-none"
        style={{
          top: "12%",
          right: "8%",
          fontSize: "clamp(72px, 18vw, 180px)",
          fontWeight: 900,
          color: "rgba(255,80,170,0.10)",
          letterSpacing: "0.05em",
          fontFamily: "'Russo One', serif",
          animation: "splashKanji 4s ease-in-out infinite",
        }}
      >
        アニメ
      </div>

      {/* Emission stage — anchored to center */}
      <div className="absolute left-1/2 top-1/2 pointer-events-none" style={{ width: 0, height: 0 }}>
        {/* Rotating light beams */}
        <div
          className="absolute"
          style={{
            left: 0, top: 0, width: 580, height: 580, borderRadius: "9999px",
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(255,90,180,0.20) 14deg, transparent 30deg, transparent 90deg, rgba(120,200,255,0.18) 104deg, transparent 120deg, transparent 180deg, rgba(255,210,90,0.18) 194deg, transparent 210deg, transparent 270deg, rgba(140,255,160,0.16) 284deg, transparent 300deg)",
            transform: "translate(-50%,-50%)",
            animation: "beamSpin 9s linear infinite",
            filter: "blur(2px)",
            willChange: "transform",
          }}
        />
        <div
          className="absolute"
          style={{
            left: 0, top: 0, width: 440, height: 440, borderRadius: "9999px",
            background:
              "conic-gradient(from 180deg, transparent 0deg, rgba(196,123,255,0.20) 20deg, transparent 40deg, transparent 120deg, rgba(255,160,90,0.20) 140deg, transparent 160deg, transparent 240deg, rgba(90,255,200,0.18) 260deg, transparent 280deg)",
            transform: "translate(-50%,-50%)",
            animation: "beamSpin 7s linear infinite reverse",
            filter: "blur(2px)",
            willChange: "transform",
          }}
        />

        {/* Expanding aura rings */}
        {auras.map((delay, i) => (
          <span
            key={`aura-${i}`}
            className="absolute"
            style={{
              left: 0, top: 0,
              width: RING_SIZE, height: RING_SIZE, borderRadius: "9999px",
              border: "2px solid rgba(255,255,255,0.55)",
              boxShadow: "0 0 24px rgba(255,90,180,0.4), inset 0 0 18px rgba(120,200,255,0.25)",
              transform: "translate(-50%,-50%) scale(0.2)",
              animation: `auraRing 2.8s ease-out ${delay}s infinite`,
              willChange: "transform, opacity",
            }}
          />
        ))}

        {/* Streak lines shooting outward */}
        {streaks.map((s, i) => (
          <span
            key={`streak-${i}`}
            className="absolute"
            style={{
              left: 0, top: 0,
              width: s.w, height: 2,
              background: `linear-gradient(90deg, transparent, ${s.color}, transparent)`,
              boxShadow: `0 0 10px ${s.color}`,
              borderRadius: 2,
              // @ts-ignore
              "--rot": s.rot,
              transformOrigin: "left center",
              animation: `streakOut ${s.dur} ease-out ${s.delay} infinite`,
              willChange: "transform, opacity",
            }}
          />
        ))}

        {/* Dust dots radiating outward */}
        {dots.map((d, i) => (
          <span
            key={`dot-${i}`}
            className="absolute"
            style={{
              left: 0, top: 0,
              width: d.size, height: d.size, borderRadius: "9999px",
              background: d.color,
              boxShadow: `0 0 8px ${d.color}, 0 0 14px ${d.color}`,
              // @ts-ignore
              "--dx": d.dx,
              "--dy": d.dy,
              animation: `dotOut ${d.dur} ease-out ${d.delay} infinite`,
              willChange: "transform, opacity",
            }}
          />
        ))}
      </div>

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

      {/* Title — strong RGB cycling glow */}
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
