import { useBranding } from "@/hooks/useBranding";

/**
 * Ultra-optimized splash loader.
 * - Compact RGB conic spinner sized just slightly larger than the logo image.
 * - Sakura petal fall + party-spray confetti burst behind the logo.
 * - Transform/opacity-only animations for smooth playback.
 */

const LOGO_SIZE = 96;
const RING_SIZE = 128; // a touch bigger than the logo

// Fire embers falling from top like flower petals
const embers = Array.from({ length: 22 }, (_, i) => ({
  left: `${(i * 11 + (i % 4) * 5) % 100}%`,
  delay: `${(i * 0.37) % 6}s`,
  dur: `${5.5 + (i % 5) * 0.8}s`,
  drift: `${(i % 2 ? 1 : -1) * (28 + (i % 6) * 16)}px`,
  size: 8 + (i % 4) * 4,
  hue: i % 3, // 0=red, 1=orange, 2=yellow
}));

// Party-spray confetti burst (from center) — fires repeatedly
const confettiColors = ["#ff3b6b", "#ffd23b", "#3bd1ff", "#7cff8a", "#c47bff", "#ffa14a"];
const burst = Array.from({ length: 26 }, (_, i) => {
  const angle = (i / 26) * Math.PI * 2;
  const radius = 160 + (i % 5) * 30;
  return {
    cx: `${Math.cos(angle) * radius}px`,
    cy: `${Math.sin(angle) * radius - 40}px`,
    cr: `${(i % 2 ? 1 : -1) * (360 + (i % 4) * 180)}deg`,
    delay: `${(i * 0.07) % 2.6}s`,
    dur: `${2.4 + (i % 5) * 0.3}s`,
    color: confettiColors[i % confettiColors.length],
    w: 5 + (i % 3) * 2,
    h: 9 + (i % 4) * 3,
  };
});

// Drifting ribbons from top (party streamers)
const ribbons = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 19 + 4) % 100}%`,
  delay: `${(i * 0.33) % 5}s`,
  dur: `${5.5 + (i % 5) * 0.6}s`,
  drift: `${(i % 2 ? 1 : -1) * (24 + (i % 5) * 12)}px`,
  color: confettiColors[i % confettiColors.length],
  w: 4,
  h: 14 + (i % 3) * 4,
}));

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
          "radial-gradient(ellipse at 50% 22%, rgba(180,120,255,0.18), transparent 42%), radial-gradient(ellipse at 18% 82%, rgba(255,170,90,0.12), transparent 44%), radial-gradient(ellipse at 82% 78%, rgba(90,200,255,0.14), transparent 44%), linear-gradient(180deg, #07060d 0%, #100818 55%, #050409 100%)",
        animation: "splFadeIn 0.35s ease-out",
      }}
    >
      {/* Fire embers falling from top */}
      {embers.map((e, i) => {
        const grad =
          e.hue === 0
            ? "radial-gradient(circle at 35% 30%, #fff3a8 0%, #ffd24a 25%, #ff7a1a 55%, #ff2d00 80%, rgba(120,0,0,0) 100%)"
            : e.hue === 1
            ? "radial-gradient(circle at 35% 30%, #fff1cc 0%, #ffae3a 30%, #ff5a00 65%, rgba(120,20,0,0) 100%)"
            : "radial-gradient(circle at 35% 30%, #ffffff 0%, #ffe27a 30%, #ffb02a 60%, rgba(180,60,0,0) 100%)";
        return (
          <span
            key={`ember-${i}`}
            className="absolute top-0 pointer-events-none"
            style={{
              left: e.left,
              width: e.size,
              height: e.size * 1.5,
              borderRadius: "100% 0 100% 18%",
              background: grad,
              // @ts-ignore
              "--drift": e.drift,
              animation: `fireEmberFall ${e.dur} linear ${e.delay} infinite, emberFlicker 1.2s ease-in-out ${e.delay} infinite`,
              willChange: "transform, opacity, filter",
            }}
          />
        );
      })}

      {/* Party streamers falling */}
      {ribbons.map((r, i) => (
        <span
          key={`rib-${i}`}
          className="absolute top-0 pointer-events-none"
          style={{
            left: r.left,
            width: r.w,
            height: r.h,
            background: r.color,
            borderRadius: 2,
            boxShadow: `0 0 10px ${r.color}aa`,
            // @ts-ignore
            "--drift": r.drift,
            animation: `confettiRibbon ${r.dur} linear ${r.delay} infinite`,
            willChange: "transform, opacity",
          }}
        />
      ))}

      {/* Center stage: confetti burst + RGB spinner + logo */}
      <div className="relative flex items-center justify-center" style={{ width: RING_SIZE, height: RING_SIZE }}>
        {/* Confetti party-spray bursting from center, behind spinner */}
        {burst.map((b, i) => (
          <span
            key={`burst-${i}`}
            className="absolute top-1/2 left-1/2 pointer-events-none"
            style={{
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

        {/* RGB conic spinner ring */}
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
        {/* Inner mask to make it a ring */}
        <div
          className="absolute rounded-full"
          style={{
            inset: 6,
            background: "#08060f",
            boxShadow: "inset 0 0 18px rgba(255,255,255,0.06)",
          }}
        />

        {/* Logo */}
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

      {/* Title — solid readable with subtle RGB sweep */}
      {title && (
        <h1
          className="mt-8 px-5 text-center font-black leading-tight"
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
          className="mt-2 px-4 text-center"
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

      {/* Progress bar */}
      <div className="mt-7 w-[260px] max-w-[70vw] h-[3px] bg-white/10 overflow-hidden relative rounded-full">
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
      <div className="mt-3 text-[10px] tracking-[0.45em] text-white/70" style={{ fontFamily: "ui-monospace,monospace" }}>
        SYS · LOADING
      </div>
    </div>
  );
};

export default SplashLoader;
