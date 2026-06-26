import { useMemo } from "react";
import { useBranding } from "@/hooks/useBranding";

/**
 * Ultra splash loader — 25 random variants.
 * One variant is picked at mount. All animations are GPU transforms (lag-free).
 * Branding (logo / siteName / tagline) is admin-driven.
 */

const RGB = ["#ff3df5", "#ff5f6d", "#ff9a3c", "#ffd23f", "#28ff7a", "#00d4ff", "#5a6bff", "#c84bff"];
const rgbGradient = (deg = 90) =>
  `linear-gradient(${deg}deg,${RGB.join(",")},${RGB[0]})`;
const conic = "conic-gradient(from 0deg,#ff0040,#ff7a00,#ffd400,#28ff7a,#00d4ff,#5a6bff,#c84bff,#ff0040)";

const arr = (n: number) => Array.from({ length: n });

/* ============================= 25 VARIANTS ============================= */

// 1. RGB conic spinner
const V_ConicSpinner = () => (
  <div className="relative w-[200px] h-[200px] flex items-center justify-center">
    <div className="absolute inset-0 rounded-full" style={{ background: conic, animation: "splOrbit 3s linear infinite", filter: "drop-shadow(0 0 22px rgba(255,80,200,0.55))" }} />
    <div className="absolute inset-[6px] rounded-full" style={{ background: "#06060c" }} />
    <div className="absolute inset-[14px] rounded-full" style={{ background: conic, animation: "splOrbitRev 5s linear infinite", opacity: 0.85 }} />
    <div className="absolute inset-[18px] rounded-full" style={{ background: "#06060c" }} />
  </div>
);

// 2. Flower bloom (open/close)
const V_FlowerBloom = () => (
  <div className="relative w-[200px] h-[200px] flex items-center justify-center">
    {arr(8).map((_, i) => (
      <span key={i} className="absolute" style={{
        width: 28, height: 60, borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%",
        background: `radial-gradient(circle at 50% 30%, ${RGB[i % RGB.length]}, transparent 70%)`,
        // @ts-ignore
        "--rot": `${i * 45}deg`,
        transformOrigin: "50% 100%",
        animation: `splBloom 2.4s ease-in-out ${i * 0.05}s infinite`,
        filter: `drop-shadow(0 0 8px ${RGB[i % RGB.length]})`,
      }} />
    ))}
    <div className="absolute w-6 h-6 rounded-full" style={{ background: "#fff", boxShadow: "0 0 18px #fff,0 0 36px #ffd400" }} />
  </div>
);

// 3. Sparkle rain from top (magic)
const V_MagicSparkles = () => {
  const items = useMemo(() => arr(30).map((_, i) => ({
    left: `${(i * 13 + (i % 5) * 7) % 100}%`,
    dx: `${(i % 2 ? 1 : -1) * ((i * 11) % 60)}px`,
    delay: `${(i * 0.17) % 3}s`,
    dur: `${2.5 + (i % 5) * 0.5}s`,
    size: 4 + (i % 4) * 2,
    color: RGB[i % RGB.length],
  })), []);
  return (
    <>
      {items.map((s, i) => (
        <span key={i} className="absolute top-0 pointer-events-none" style={{
          left: s.left, width: s.size, height: s.size, background: s.color,
          borderRadius: "50%", filter: `drop-shadow(0 0 8px ${s.color})`,
          // @ts-ignore
          "--dx": s.dx,
          animation: `splSparkleDrop ${s.dur} linear ${s.delay} infinite`,
        }} />
      ))}
      <V_ConicSpinner />
    </>
  );
};

// 4. Party confetti spray (from center)
const V_Confetti = () => {
  const items = useMemo(() => arr(36).map((_, i) => {
    const ang = (i / 36) * Math.PI * 2;
    return {
      dx: `${Math.cos(ang) * 320}px`,
      dy: `${Math.sin(ang) * 320}px`,
      delay: `${(i * 0.05) % 1.2}s`,
      color: RGB[i % RGB.length],
      w: 6 + (i % 3) * 3,
      h: 10 + (i % 4) * 3,
    };
  }), []);
  return (
    <div className="relative w-[200px] h-[200px] flex items-center justify-center">
      {items.map((c, i) => (
        <span key={i} className="absolute left-1/2 top-1/2" style={{
          width: c.w, height: c.h, background: c.color, borderRadius: 2,
          // @ts-ignore
          "--dx": c.dx, "--dy": c.dy,
          animation: `splConfetti 2.4s ease-out ${c.delay} infinite`,
          filter: `drop-shadow(0 0 6px ${c.color})`,
        }} />
      ))}
      <div className="w-14 h-14 rounded-full" style={{ background: conic, animation: "splOrbit 2.5s linear infinite", filter: "drop-shadow(0 0 14px #fff)" }} />
    </div>
  );
};

// 5. Orbiting dots
const V_Orbit = () => (
  <div className="relative w-[200px] h-[200px]">
    {[0, 1, 2].map((r) => (
      <div key={r} className="absolute inset-0" style={{ animation: `${r % 2 ? "splOrbitRev" : "splOrbit"} ${3 + r}s linear infinite` }}>
        {arr(6).map((_, i) => {
          const ang = (i / 6) * Math.PI * 2;
          const radius = 60 + r * 22;
          return (
            <span key={i} className="absolute left-1/2 top-1/2 w-3 h-3 rounded-full" style={{
              background: RGB[(i + r) % RGB.length],
              transform: `translate(${Math.cos(ang) * radius - 6}px,${Math.sin(ang) * radius - 6}px)`,
              boxShadow: `0 0 12px ${RGB[(i + r) % RGB.length]}`,
            }} />
          );
        })}
      </div>
    ))}
  </div>
);

// 6. Equalizer bars
const V_Bars = () => (
  <div className="flex items-end gap-2 h-[140px]">
    {arr(9).map((_, i) => (
      <span key={i} className="w-3 rounded-t" style={{
        height: "100%",
        background: `linear-gradient(180deg,${RGB[i % RGB.length]},${RGB[(i + 3) % RGB.length]})`,
        transformOrigin: "bottom",
        animation: `splBars 1.1s ease-in-out ${i * 0.09}s infinite`,
        boxShadow: `0 0 10px ${RGB[i % RGB.length]}`,
      }} />
    ))}
  </div>
);

// 7. Bouncing dot wave
const V_DotWave = () => (
  <div className="flex items-center gap-3 h-[80px]">
    {arr(7).map((_, i) => (
      <span key={i} className="w-4 h-4 rounded-full" style={{
        background: RGB[i % RGB.length],
        animation: `splDotWave 1s ease-in-out ${i * 0.1}s infinite`,
        boxShadow: `0 0 12px ${RGB[i % RGB.length]}`,
      }} />
    ))}
  </div>
);

// 8. Concentric ripples
const V_Ripples = () => (
  <div className="relative w-[200px] h-[200px] flex items-center justify-center">
    {arr(4).map((_, i) => (
      <span key={i} className="absolute w-[180px] h-[180px] rounded-full border-2" style={{
        borderColor: RGB[i % RGB.length],
        animation: `splRipple 2.4s ease-out ${i * 0.6}s infinite`,
      }} />
    ))}
    <div className="w-12 h-12 rounded-full" style={{ background: conic, animation: "splOrbit 2s linear infinite", filter: "drop-shadow(0 0 14px #fff)" }} />
  </div>
);

// 9. Flames
const V_Flames = () => (
  <div className="relative w-[200px] h-[200px] flex items-end justify-center">
    {arr(7).map((_, i) => (
      <span key={i} className="mx-[2px]" style={{
        width: 18, height: 80 + (i % 3) * 14,
        background: `linear-gradient(180deg,#ffd23f,#ff7a00 50%,#ff2d6a)`,
        borderRadius: "50% 50% 20% 20% / 70% 70% 30% 30%",
        transformOrigin: "bottom",
        animation: `splFlame 0.8s ease-in-out ${i * 0.1}s infinite`,
        filter: "blur(0.5px) drop-shadow(0 0 12px #ff7a00)",
      }} />
    ))}
  </div>
);

// 10. Heartbeat
const V_Heart = () => (
  <div className="w-[120px] h-[120px] flex items-center justify-center" style={{ animation: "splHeart 1.1s ease-in-out infinite" }}>
    <div className="relative w-[100px] h-[100px]">
      {[0, 1].map((s) => (
        <span key={s} className="absolute top-0 w-[50px] h-[80px] rounded-t-full" style={{
          left: s ? 50 : 0,
          background: "linear-gradient(180deg,#ff2d6a,#c81d57)",
          transformOrigin: "bottom",
          transform: s ? "rotate(45deg) translateX(-6px)" : "rotate(-45deg) translateX(6px)",
          boxShadow: "0 0 24px #ff2d6a",
        }} />
      ))}
    </div>
  </div>
);

// 11. Star burst
const V_StarBurst = () => (
  <div className="relative w-[200px] h-[200px] flex items-center justify-center">
    {arr(16).map((_, i) => (
      <span key={i} className="absolute w-2 h-8 rounded-full" style={{
        // @ts-ignore
        "--rot": `${(i * 360) / 16}deg`,
        background: RGB[i % RGB.length],
        animation: `splStarBurst 1.8s ease-out ${i * 0.05}s infinite`,
        filter: `drop-shadow(0 0 8px ${RGB[i % RGB.length]})`,
      }} />
    ))}
    <div className="w-10 h-10 rounded-full bg-white" style={{ boxShadow: "0 0 30px #fff,0 0 60px #ffd400" }} />
  </div>
);

// 12. Galaxy swirl
const V_Galaxy = () => (
  <div className="relative w-[220px] h-[220px] flex items-center justify-center">
    {arr(24).map((_, i) => {
      const ang = (i / 24) * Math.PI * 2;
      const r = 30 + (i % 6) * 14;
      return (
        <span key={i} className="absolute left-1/2 top-1/2 w-2 h-2 rounded-full" style={{
          background: RGB[i % RGB.length],
          transform: `translate(${Math.cos(ang) * r - 4}px,${Math.sin(ang) * r - 4}px)`,
          animation: `splGalaxy 3s linear ${(i * 0.08)}s infinite`,
          boxShadow: `0 0 10px ${RGB[i % RGB.length]}`,
        }} />
      );
    })}
  </div>
);

// 13. Neon ring pulse
const V_NeonRing = () => (
  <div className="relative w-[200px] h-[200px] flex items-center justify-center">
    {[0, 1, 2].map((i) => (
      <div key={i} className="absolute rounded-full border-[3px]" style={{
        width: 100 + i * 40, height: 100 + i * 40,
        color: RGB[i * 2 % RGB.length],
        borderColor: "currentColor",
        animation: `splNeonPulse 1.6s ease-in-out ${i * 0.2}s infinite`,
      }} />
    ))}
  </div>
);

// 14. Liquid blob
const V_Liquid = () => (
  <div className="w-[150px] h-[150px]" style={{
    background: conic,
    animation: "splLiquid 6s ease-in-out infinite, splOrbit 8s linear infinite",
    filter: "blur(0.4px) drop-shadow(0 0 22px rgba(255,80,200,0.5))",
  }} />
);

// 15. Triangle morph
const V_Morph = () => (
  <div className="w-[130px] h-[130px]" style={{
    background: conic,
    animation: "splTriMorph 3s ease-in-out infinite",
    filter: "drop-shadow(0 0 20px rgba(255,80,200,0.55))",
  }} />
);

// 16. Grid pulse
const V_Grid = () => (
  <div className="grid grid-cols-3 gap-2">
    {arr(9).map((_, i) => (
      <span key={i} className="w-6 h-6 rounded" style={{
        background: RGB[i % RGB.length],
        animation: `splGridPulse 1.4s ease-in-out ${(i * 0.1)}s infinite`,
        boxShadow: `0 0 10px ${RGB[i % RGB.length]}`,
      }} />
    ))}
  </div>
);

// 17. DNA helix
const V_DNA = () => (
  <div className="relative w-[60px] h-[200px]">
    {arr(12).map((_, i) => {
      const t = i / 12;
      return (
        <span key={i} className="absolute left-1/2 w-3 h-3 rounded-full" style={{
          top: `${t * 100}%`,
          transform: `translate(${Math.sin(t * Math.PI * 4) * 24 - 6}px,0)`,
          background: RGB[i % RGB.length],
          animation: `splDotWave 1.4s ease-in-out ${i * 0.08}s infinite`,
          boxShadow: `0 0 10px ${RGB[i % RGB.length]}`,
        }} />
      );
    })}
  </div>
);

// 18. Atom
const V_Atom = () => (
  <div className="relative w-[200px] h-[200px] flex items-center justify-center">
    {[0, 60, 120].map((deg, i) => (
      <div key={i} className="absolute w-[180px] h-[70px] rounded-full border-2" style={{
        borderColor: RGB[i * 2 % RGB.length],
        transform: `rotate(${deg}deg)`,
        animation: `${i % 2 ? "splOrbit" : "splOrbitRev"} 2.5s linear infinite`,
        filter: `drop-shadow(0 0 8px ${RGB[i * 2 % RGB.length]})`,
      }} />
    ))}
    <div className="w-6 h-6 rounded-full bg-white" style={{ boxShadow: "0 0 18px #fff,0 0 36px #00d4ff" }} />
  </div>
);

// 19. Swing petals (gentle open/close)
const V_Sakura = () => (
  <div className="relative w-[200px] h-[200px] flex items-center justify-center">
    {arr(12).map((_, i) => (
      <span key={i} className="absolute" style={{
        width: 22, height: 38, borderRadius: "100% 0 100% 0",
        background: `linear-gradient(135deg,${RGB[i % RGB.length]},#fff)`,
        // @ts-ignore
        "--rot": `${i * 30}deg`,
        transformOrigin: "50% 100%",
        animation: `splSwingPetal 2.2s ease-in-out ${i * 0.06}s infinite`,
        filter: `drop-shadow(0 0 6px ${RGB[i % RGB.length]})`,
      }} />
    ))}
  </div>
);

// 20. Lightning bolt flash
const V_Bolt = () => (
  <div className="relative w-[160px] h-[200px] flex items-center justify-center">
    <svg viewBox="0 0 40 80" width="120" height="180" style={{ animation: "splBoltFlash 1s ease-in-out infinite" }}>
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          {RGB.map((c, i) => <stop key={i} offset={`${(i / (RGB.length - 1)) * 100}%`} stopColor={c} />)}
        </linearGradient>
      </defs>
      <polygon points="22,0 4,46 18,46 14,80 36,30 22,30" fill="url(#bg)" />
    </svg>
  </div>
);

// 21. Scan radar
const V_Radar = () => (
  <div className="relative w-[200px] h-[200px] rounded-full" style={{
    background: "radial-gradient(circle,rgba(0,212,255,0.12),transparent 70%)",
    border: "2px solid rgba(0,212,255,0.5)",
  }}>
    <div className="absolute inset-0 rounded-full overflow-hidden" style={{ animation: "splScanRing 2.4s linear infinite" }}>
      <div className="absolute top-0 left-1/2 w-1/2 h-1/2" style={{
        background: "conic-gradient(from 0deg,rgba(0,255,200,0.7),transparent 90deg)",
        transformOrigin: "0% 100%",
      }} />
    </div>
    {[40, 70, 100].map((r, i) => (
      <div key={i} className="absolute left-1/2 top-1/2 rounded-full border" style={{
        width: r * 2, height: r * 2, marginLeft: -r, marginTop: -r,
        borderColor: "rgba(0,212,255,0.35)",
      }} />
    ))}
  </div>
);

// 22. Cube spin
const V_Cube = () => (
  <div style={{ perspective: 600 }} className="w-[120px] h-[120px] flex items-center justify-center">
    <div className="relative w-[80px] h-[80px]" style={{
      transformStyle: "preserve-3d",
      animation: "splCubeRot 4s linear infinite",
    }}>
      {[
        { t: "translateZ(40px)", c: RGB[0] },
        { t: "rotateY(180deg) translateZ(40px)", c: RGB[2] },
        { t: "rotateY(90deg) translateZ(40px)", c: RGB[4] },
        { t: "rotateY(-90deg) translateZ(40px)", c: RGB[6] },
        { t: "rotateX(90deg) translateZ(40px)", c: RGB[1] },
        { t: "rotateX(-90deg) translateZ(40px)", c: RGB[5] },
      ].map((f, i) => (
        <span key={i} className="absolute inset-0 border" style={{
          background: `${f.c}40`, borderColor: f.c, transform: f.t,
          boxShadow: `0 0 18px ${f.c}`,
        }} />
      ))}
    </div>
  </div>
);

// 23. Yin-yang dual orb
const V_DualOrb = () => (
  <div className="relative w-[160px] h-[160px]" style={{ animation: "splOrbit 2s linear infinite" }}>
    <span className="absolute left-0 top-1/2 w-16 h-16 -translate-y-1/2 rounded-full" style={{
      background: "radial-gradient(circle,#ff3df5,#c81d57)", boxShadow: "0 0 24px #ff3df5",
    }} />
    <span className="absolute right-0 top-1/2 w-16 h-16 -translate-y-1/2 rounded-full" style={{
      background: "radial-gradient(circle,#00d4ff,#1d57c8)", boxShadow: "0 0 24px #00d4ff",
    }} />
  </div>
);

// 24. Hex stack
const V_HexStack = () => {
  const HEX = "polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)";
  return (
    <div className="relative w-[200px] h-[200px] flex items-center justify-center">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="absolute" style={{
          width: 200 - i * 36, height: 200 - i * 36, clipPath: HEX,
          background: conic,
          animation: `${i % 2 ? "splOrbitRev" : "splOrbit"} ${3 + i * 0.5}s linear infinite`,
          opacity: 0.9 - i * 0.15,
          filter: "drop-shadow(0 0 12px rgba(255,80,200,0.5))",
        }} />
      ))}
    </div>
  );
};

// 25. Rainbow loading bar (big)
const V_BigBar = () => (
  <div className="flex flex-col items-center gap-4">
    <div className="w-12 h-12 rounded-full" style={{ background: conic, animation: "splOrbit 1.5s linear infinite", filter: "drop-shadow(0 0 16px #fff)" }} />
    <div className="w-[260px] h-2 bg-white/10 rounded-full overflow-hidden relative">
      <div className="absolute inset-y-0 w-1/2 rounded-full" style={{
        background: rgbGradient(),
        animation: "splashBarFill 1.8s ease-in-out infinite",
        filter: "drop-shadow(0 0 10px rgba(255,80,200,0.7))",
      }} />
    </div>
  </div>
);

const VARIANTS: Array<() => JSX.Element> = [
  V_ConicSpinner, V_FlowerBloom, V_MagicSparkles, V_Confetti, V_Orbit,
  V_Bars, V_DotWave, V_Ripples, V_Flames, V_Heart,
  V_StarBurst, V_Galaxy, V_NeonRing, V_Liquid, V_Morph,
  V_Grid, V_DNA, V_Atom, V_Sakura, V_Bolt,
  V_Radar, V_Cube, V_DualOrb, V_HexStack, V_BigBar,
];

const BACKGROUNDS = [
  "radial-gradient(ellipse at 20% 10%,rgba(120,20,60,0.45),transparent 55%),radial-gradient(ellipse at 80% 90%,rgba(20,60,120,0.4),transparent 55%),linear-gradient(180deg,#06060c,#0a0612)",
  "radial-gradient(ellipse at 50% 0%,rgba(90,40,200,0.45),transparent 60%),linear-gradient(180deg,#050510,#0a0820)",
  "radial-gradient(ellipse at 10% 100%,rgba(0,160,200,0.4),transparent 60%),radial-gradient(ellipse at 90% 0%,rgba(255,80,160,0.35),transparent 60%),#06060c",
  "radial-gradient(circle at 50% 50%,#0a0a1c,#000)",
  "linear-gradient(135deg,#0a0612 0%,#1a0a2a 50%,#06060c 100%)",
];

/* ============================= COMPONENT ============================= */

const SplashLoader = () => {
  const branding = useBranding();
  const title = branding.siteName || "";
  const tagline = branding.siteTagline || branding.splashText || "";
  const logo = branding.logoUrl || "";

  // Pick a random variant + background on mount
  const { Variant, bg } = useMemo(() => {
    const Variant = VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
    const bg = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
    return { Variant, bg };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
      style={{ background: bg, animation: "splFadeIn 0.4s ease-out" }}
    >
      {/* Subtle grid veil */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.06]" style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.6) 1px,transparent 1px)",
        backgroundSize: "40px 40px",
        maskImage: "radial-gradient(circle at center,#000 30%,transparent 75%)",
        WebkitMaskImage: "radial-gradient(circle at center,#000 30%,transparent 75%)",
      }} />

      {/* Logo above animation */}
      {logo && (
        <img
          src={logo}
          alt={title}
          className="w-[88px] h-[88px] rounded-full object-cover mb-8"
          style={{
            boxShadow: "0 0 24px rgba(255,80,160,0.55),0 0 56px rgba(90,215,255,0.3)",
            border: "2px solid rgba(255,255,255,0.15)",
          }}
        />
      )}

      {/* The random variant */}
      <div className="flex items-center justify-center min-h-[200px]">
        <Variant />
      </div>

      {/* Title — animated rainbow gradient */}
      {title && (
        <h1
          className="mt-10 px-6 text-center font-black leading-none"
          style={{
            fontSize: "clamp(22px,6vw,34px)",
            letterSpacing: "0.3em",
            fontFamily: "'Bebas Neue','Russo One','Oswald',system-ui,sans-serif",
            backgroundImage: rgbGradient(90),
            backgroundSize: "300% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            color: "transparent",
            animation: "splashTitleShift 6s linear infinite",
            filter: "drop-shadow(0 0 10px rgba(255,80,200,0.55)) drop-shadow(0 0 22px rgba(0,200,255,0.35))",
          }}
        >
          {title}
        </h1>
      )}

      {/* Tagline */}
      {tagline && (
        <div
          className="mt-3 px-4 text-center text-white/90"
          style={{
            fontSize: "clamp(11px,2.6vw,13px)",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            fontWeight: 600,
            textShadow: "0 0 10px rgba(255,80,180,0.45),0 0 18px rgba(0,200,255,0.3)",
          }}
        >
          {tagline}
        </div>
      )}

      {/* HUD bar */}
      <div className="mt-8 w-[260px] h-[3px] bg-white/10 overflow-hidden relative rounded-full">
        <div className="absolute inset-y-0 w-2/3" style={{
          background: "linear-gradient(90deg,transparent,#ff3df5,#ffd400,#28ff7a,#00d4ff,transparent)",
          animation: "splashBarFill 1.8s ease-in-out infinite",
          filter: "drop-shadow(0 0 8px rgba(255,120,200,0.7))",
        }} />
      </div>
      <div className="mt-3 text-[10px] tracking-[0.5em] text-white/70" style={{ fontFamily: "ui-monospace,monospace" }}>
        SYS · LOADING
      </div>
    </div>
  );
};

export default SplashLoader;
