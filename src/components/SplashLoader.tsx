import { useBranding } from "@/hooks/useBranding";

/**
 * Ultra-optimized splash loader.
 * - Compact RGB conic spinner sized just slightly larger than the logo image.
 * - Everything radiates OUTWARD from the spinner: flower petals, sparks,
 *   rotating light beams, expanding aura rings, confetti burst.
 * - Transform/opacity only, GPU friendly.
 */

const LOGO_SIZE = 96;
const RING_SIZE = 128;

const palette = ["#ff3b6b", "#ffd23b", "#3bd1ff", "#7cff8a", "#c47bff", "#ffa14a", "#ff6ad5"];

// Radial petals/sparks ejected from the spinner center
const PETAL_COUNT = 36;
const petals = Array.from({ length: PETAL_COUNT }, (_, i) => {
  const angle = (i / PETAL_COUNT) * Math.PI * 2 + (i % 3) * 0.18;
  const distance = 240 + (i % 6) * 40; // outward distance in px
  return {
    ex: `${Math.cos(angle) * distance}px`,
    ey: `${Math.sin(angle) * distance}px`,
    er: `${(i % 2 ? 1 : -1) * (360 + (i % 5) * 180)}deg`,
    delay: `${(i * 0.13) % 3.2}s`,
    dur: `${2.8 + (i % 5) * 0.35}s`,
    color: palette[i % palette.length],
    size: 10 + (i % 4) * 4,
    isPetal: i % 2 === 0,
  };
});

// Confetti burst (smaller, ribbon-like) also from center
const burst = Array.from({ length: 22 }, (_, i) => {
  const angle = (i / 22) * Math.PI * 2 + 0.4;
  const radius = 150 + (i % 5) * 28;
  return {
    cx: `${Math.cos(angle) * radius}px`,
    cy: `${Math.sin(angle) * radius}px`,
    cr: `${(i % 2 ? 1 : -1) * (360 + (i % 4) * 180)}deg`,
    delay: `${(i * 0.09) % 2.2}s`,
    dur: `${2.0 + (i % 5) * 0.28}s`,
    color: palette[i % palette.length],
    w: 5 + (i % 3) * 2,
    h: 10 + (i % 4) * 3,
  };
});

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
          "radial-gradient(ellipse at 50% 50%, rgba(180,120,255,0.18), transparent 45%), radial-gradient(ellipse at 18% 82%, rgba(255,170,90,0.10), transparent 44%), radial-gradient(ellipse at 82% 78%, rgba(90,200,255,0.12), transparent 44%), linear-gradient(180deg, #07060d 0%, #100818 55%, #050409 100%)",
        animation: "splFadeIn 0.35s ease-out",
      }}
    >
      {/* Emission stage — everything anchored to viewport center */}
      <div className="absolute left-1/2 top-1/2 pointer-events-none" style={{ width: 0, height: 0 }}>
        {/* Expanding aura rings emitted from spinner */}
        {auras.map((delay, i) => (
          <span
            key={`aura-${i}`}
            className="absolute"
            style={{
              left: 0,
              top: 0,
              width: RING_SIZE,
              height: RING_SIZE,
              borderRadius: "9999px",
              border: "2px solid rgba(255,255,255,0.55)",
              boxShadow:
                "0 0 24px rgba(255,90,180,0.35), inset 0 0 18px rgba(120,200,255,0.25)",
              transform: "translate(-50%,-50%) scale(0.2)",
              animation: `auraRing 2.8s ease-out ${delay}s infinite`,
              willChange: "transform, opacity",
            }}
          />
        ))}

        {/* Rotating light beams (conic) */}
        <div
          className="absolute"
          style={{
            left: 0,
            top: 0,
            width: 560,
            height: 560,
            borderRadius: "9999px",
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(255,90,180,0.18) 14deg, transparent 30deg, transparent 90deg, rgba(120,200,255,0.16) 104deg, transparent 120deg, transparent 180deg, rgba(255,210,90,0.16) 194deg, transparent 210deg, transparent 270deg, rgba(140,255,160,0.14) 284deg, transparent 300deg)",
            transform: "translate(-50%,-50%) rotate(0deg)",
            animation: "beamSpin 9s linear infinite",
            filter: "blur(2px)",
            willChange: "transform",
          }}
        />
        <div
          className="absolute"
          style={{
            left: 0,
            top: 0,
            width: 460,
            height: 460,
            borderRadius: "9999px",
            background:
              "conic-gradient(from 180deg, transparent 0deg, rgba(196,123,255,0.18) 20deg, transparent 40deg, transparent 120deg, rgba(255,160,90,0.18) 140deg, transparent 160deg, transparent 240deg, rgba(90,255,200,0.16) 260deg, transparent 280deg)",
            transform: "translate(-50%,-50%) rotate(0deg)",
            animation: "beamSpin 7s linear infinite reverse",
            filter: "blur(2px)",
            willChange: "transform",
          }}
        />

        {/* Radiating petals + sparks */}
        {petals.map((p, i) => (
          <span
            key={`petal-${i}`}
            className="absolute"
            style={{
              left: 0,
              top: 0,
              width: p.size,
              height: p.isPetal ? p.size * 1.5 : p.size,
              marginLeft: -p.size / 2,
              marginTop: -p.size / 2,
              borderRadius: p.isPetal ? "100% 0 100% 0" : "9999px",
              background: p.isPetal
                ? `radial-gradient(circle at 30% 30%, #fff, ${p.color} 55%, transparent 100%)`
                : `radial-gradient(circle, #fff 0%, ${p.color} 50%, transparent 80%)`,
              color: p.color,
              boxShadow: `0 0 10px ${p.color}cc, 0 0 22px ${p.color}66`,
              // @ts-ignore CSS vars
              "--ex": p.ex,
              "--ey": p.ey,
              "--er": p.er,
              animation: `petalEject ${p.dur} ease-out ${p.delay} infinite, sparkFlicker 1.4s ease-in-out ${p.delay} infinite`,
              willChange: "transform, opacity, filter",
            }}
          />
        ))}

        {/* Confetti burst */}
        {burst.map((b, i) => (
          <span
            key={`burst-${i}`}
            className="absolute"
            style={{
              left: 0,
              top: 0,
              width: b.w,
              height: b.h,
              marginLeft: -b.w / 2,
              marginTop: -b.h / 2,
              background: b.color,
              borderRadius: 1.5,
              boxShadow: `0 0 8px ${b.color}cc`,
              // @ts-ignore
              "--cx": b.cx,
              "--cy": b.cy,
              "--cr": b.cr,
              animation: `confettiBurst ${b.dur} ease-out ${b.delay} infinite`,
              willChange: "transform, opacity",
            }}
          />
        ))}
      </div>

      {/* Spinner + logo (above emissions) */}
      <div className="relative flex items-center justify-center" style={{ width: RING_SIZE, height: RING_SIZE }}>
        <div
          className="absolute rounded-full"
          style={{
            inset: 0,
            background:
              "conic-gradient(from 0deg, #ff0055, #ff8a00, #ffe600, #00ff85, #00d4ff, #6a5cff, #ff00c8, #ff0055)",
            animation: "rgbConicSpin 2.4s linear infinite",
            filter: "drop-shadow(0 0 14px rgba(255,90,180,0.55)) drop-shadow(0 0 22px rgba(90,200,255,0.35))",
            willChange: "transform",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            inset: 6,
            background: "#08060f",
            boxShadow: "inset 0 0 18px rgba(255,255,255,0.06)",
          }}
        />

        {logo ? (
          <img
            src={logo}
            alt={title || "Site logo"}
            className="relative z-10 rounded-full object-cover"
            style={{
              width: LOGO_SIZE,
              height: LOGO_SIZE,
              border: "2px solid rgba(255,255,255,0.32)",
              boxShadow: "0 10px 32px rgba(0,0,0,0.6), 0 0 22px rgba(255,120,200,0.42)",
            }}
          />
        ) : (
          <div
            className="relative z-10 rounded-full"
            style={{
              width: LOGO_SIZE,
              height: LOGO_SIZE,
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
            fontSize: "clamp(22px,5.8vw,34px)",
            letterSpacing: "0.16em",
            fontFamily: "'Russo One','Bebas Neue','Poppins',system-ui,sans-serif",
            color: "#ffffff",
            textShadow:
              "0 0 10px rgba(255,80,170,0.55), 0 0 22px rgba(80,180,255,0.45), 0 2px 14px rgba(0,0,0,0.6)",
          }}
        >
          {title}
        </h1>
      )}

      {tagline && (
        <div
          className="relative mt-2 px-4 text-center"
          style={{
            color: "#f3f0ff",
            fontSize: "clamp(11px,2.6vw,13px)",
            letterSpacing: "0.26em",
            textTransform: "uppercase",
            fontWeight: 700,
            textShadow: "0 0 10px rgba(255,255,255,0.25), 0 2px 8px rgba(0,0,0,0.6)",
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
              "linear-gradient(90deg, transparent, #ff3b6b, #ffd23b, #3bd1ff, #c47bff, transparent)",
            animation: "splashBarFill 1.6s ease-in-out infinite",
            filter: "drop-shadow(0 0 8px rgba(255,120,200,0.7))",
          }}
        />
      </div>
      <div className="relative mt-3 text-[10px] tracking-[0.45em] text-white/70" style={{ fontFamily: "ui-monospace,monospace" }}>
        SYS · LOADING
      </div>
    </div>
  );
};

export default SplashLoader;
