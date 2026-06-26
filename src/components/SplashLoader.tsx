import { useMemo } from "react";
import { useBranding } from "@/hooks/useBranding";

/**
 * Anime cyberpunk splash loader — admin-driven (logo/name/tagline from Firebase).
 * Hexagonal targeting frame, drifting sakura petals, RGB-glitch title, scan HUD bar.
 * GPU-only transforms — lag-free.
 */
const HEX_CLIP =
  "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)";

const SplashLoader = () => {
  const branding = useBranding();
  const title = branding.siteName || "";
  const tagline = branding.siteTagline || branding.splashText || "";
  const logo = branding.logoUrl || "";

  // Pre-compute petal positions once
  const petals = useMemo(
    () =>
      Array.from({ length: 14 }).map((_, i) => ({
        left: `${(i * 7 + (i % 3) * 11) % 100}%`,
        delay: `${(i * 0.6) % 7}s`,
        duration: `${7 + (i % 5)}s`,
        size: 6 + (i % 4) * 3,
        drift: `${(i % 2 === 0 ? 1 : -1) * (30 + (i * 7) % 60)}px`,
        hue: i % 3 === 0 ? "#ff5f8a" : i % 3 === 1 ? "#ffb6c8" : "#ff8fb3",
      })),
    []
  );

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 20% 10%, rgba(120,20,60,0.45) 0%, transparent 55%)," +
          "radial-gradient(ellipse at 80% 90%, rgba(20,60,120,0.4) 0%, transparent 55%)," +
          "linear-gradient(180deg,#06060c 0%,#0a0612 100%)",
      }}
    >
      {/* Faint kanji backdrop */}
      <div
        className="absolute select-none pointer-events-none font-black"
        style={{
          fontSize: "min(60vw,520px)",
          lineHeight: 1,
          color: "transparent",
          WebkitTextStroke: "1px rgba(255,80,120,0.18)",
          animation: "splashKanji 4s ease-in-out infinite",
          fontFamily: "serif",
        }}
      >
        燃
      </div>

      {/* Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.6) 1px,transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage:
            "radial-gradient(circle at center, #000 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(circle at center, #000 30%, transparent 75%)",
        }}
      />

      {/* Falling sakura petals */}
      {petals.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 pointer-events-none"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            background: p.hue,
            borderRadius: "100% 0 100% 0",
            opacity: 0,
            filter: "blur(0.3px) drop-shadow(0 0 6px rgba(255,100,140,0.55))",
            // @ts-ignore — custom CSS var
            "--drift": p.drift,
            animation: `splashPetalFall ${p.duration} linear ${p.delay} infinite`,
          }}
        />
      ))}

      {/* Central hex emblem */}
      <div className="relative w-[230px] h-[230px] flex items-center justify-center">
        {/* Outer hex (slow spin) */}
        <div
          className="absolute inset-0"
          style={{
            clipPath: HEX_CLIP,
            background:
              "conic-gradient(from 0deg,#ff3866,#ff8a5b,#ffd166,#5ad7ff,#a06bff,#ff3866)",
            animation: "splashHexSpin 8s linear infinite",
            filter: "drop-shadow(0 0 25px rgba(255,60,100,0.5))",
          }}
        />
        {/* Inner cutout */}
        <div
          className="absolute inset-[6px]"
          style={{
            clipPath: HEX_CLIP,
            background: "#06060c",
          }}
        />
        {/* Middle hex (reverse spin, thinner) */}
        <div
          className="absolute inset-[14px]"
          style={{
            clipPath: HEX_CLIP,
            background:
              "conic-gradient(from 180deg,transparent 0deg,rgba(90,215,255,0.9) 40deg,transparent 90deg,transparent 180deg,rgba(255,80,140,0.9) 220deg,transparent 270deg)",
            animation: "splashHexSpinRev 4s linear infinite",
          }}
        />
        <div
          className="absolute inset-[18px]"
          style={{ clipPath: HEX_CLIP, background: "#0a0612" }}
        />

        {/* Glow behind logo */}
        <div
          className="absolute inset-[28px] rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle,rgba(255,60,100,0.65) 0%,rgba(120,30,80,0.25) 50%,transparent 75%)",
            animation: "splashGlow 2s ease-in-out infinite",
            filter: "blur(8px)",
          }}
        />

        {/* Logo */}
        {logo ? (
          <img
            src={logo}
            alt={title}
            className="relative z-10 w-[140px] h-[140px] rounded-full object-cover"
            style={{
              boxShadow:
                "0 0 30px rgba(255,60,100,0.6),0 0 60px rgba(90,215,255,0.25)",
            }}
          />
        ) : (
          <div
            className="relative z-10 w-[140px] h-[140px] rounded-full"
            style={{ background: "#1a0a18" }}
          />
        )}

        {/* Corner brackets */}
        {[
          { top: -6, left: -6, rot: 0 },
          { top: -6, right: -6, rot: 90 },
          { bottom: -6, right: -6, rot: 180 },
          { bottom: -6, left: -6, rot: 270 },
        ].map((c, i) => (
          <span
            key={i}
            className="absolute w-5 h-5 pointer-events-none"
            style={{
              ...c,
              transform: `rotate(${c.rot}deg)`,
              borderTop: "2px solid #5ad7ff",
              borderLeft: "2px solid #5ad7ff",
              animation: `splashCorner 1.6s ease-in-out ${i * 0.15}s infinite`,
              filter: "drop-shadow(0 0 6px #5ad7ff)",
            }}
          />
        ))}
      </div>

      {/* Title — RGB glitch effect */}
      {title && (
        <div
          className="relative mt-12"
          style={{ animation: "splashGlitch 3s steps(1) infinite" }}
        >
          <div
            className="text-[26px] font-black tracking-[0.45em] text-white relative"
            style={{
              fontFamily:
                "'Bebas Neue','Russo One','Oswald',system-ui,sans-serif",
              textShadow:
                "0 0 18px rgba(255,60,100,0.55),0 0 38px rgba(255,60,100,0.25)",
            }}
          >
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                color: "#ff2d6a",
                transform: "translate(-1.5px,0)",
                mixBlendMode: "screen",
                opacity: 0.75,
              }}
            >
              {title}
            </span>
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                color: "#5ad7ff",
                transform: "translate(1.5px,0)",
                mixBlendMode: "screen",
                opacity: 0.75,
              }}
            >
              {title}
            </span>
            <span className="relative">{title}</span>
          </div>
        </div>
      )}

      {/* Tagline */}
      {tagline && (
        <div
          className="mt-3 text-[10px] uppercase text-white/65"
          style={{ letterSpacing: "0.5em", fontFamily: "system-ui,sans-serif" }}
        >
          {tagline}
        </div>
      )}

      {/* HUD scan bar */}
      <div className="mt-8 w-[260px] h-[2px] bg-white/10 overflow-hidden relative rounded-full">
        <div
          className="absolute inset-y-0 w-1/2"
          style={{
            background:
              "linear-gradient(90deg,transparent,#ff2d6a,#5ad7ff,transparent)",
            animation: "splashBarFill 1.8s ease-in-out infinite",
            filter: "drop-shadow(0 0 6px rgba(255,80,120,0.7))",
          }}
        />
      </div>
      <div
        className="mt-2 text-[9px] tracking-[0.5em] text-white/45"
        style={{ fontFamily: "ui-monospace,monospace" }}
      >
        SYS · LOADING
      </div>
    </div>
  );
};

export default SplashLoader;
