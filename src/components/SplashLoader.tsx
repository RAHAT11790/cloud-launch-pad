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
      <div className="relative w-[240px] h-[240px] flex items-center justify-center">
        {/* RGB rainbow conic ring (main spinner) */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg,#ff0040,#ff7a00,#ffd400,#28ff7a,#00d4ff,#5a6bff,#c84bff,#ff0040)",
            animation: "splashHexSpin 3.2s linear infinite",
            filter: "drop-shadow(0 0 22px rgba(255,80,160,0.55)) drop-shadow(0 0 30px rgba(90,215,255,0.35))",
          }}
        />
        {/* Inner mask */}
        <div className="absolute inset-[5px] rounded-full" style={{ background: "#06060c" }} />
        {/* Counter-rotating accent ring */}
        <div
          className="absolute inset-[12px] rounded-full"
          style={{
            background:
              "conic-gradient(from 180deg,transparent 0deg,#00ffd5 60deg,transparent 120deg,transparent 240deg,#ff3df5 300deg,transparent 360deg)",
            animation: "splashHexSpinRev 5s linear infinite",
            opacity: 0.9,
          }}
        />
        <div className="absolute inset-[17px] rounded-full" style={{ background: "#0a0612" }} />

        {/* Glow behind logo */}
        <div
          className="absolute inset-[26px] rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle,rgba(255,80,180,0.55) 0%,rgba(90,80,200,0.25) 50%,transparent 75%)",
            animation: "splashGlow 2s ease-in-out infinite",
            filter: "blur(10px)",
          }}
        />

        {/* Logo */}
        {logo ? (
          <img
            src={logo}
            alt={title}
            className="relative z-10 w-[150px] h-[150px] rounded-full object-cover"
            style={{
              boxShadow:
                "0 0 26px rgba(255,80,160,0.55),0 0 60px rgba(90,215,255,0.35)",
            }}
          />
        ) : (
          <div
            className="relative z-10 w-[150px] h-[150px] rounded-full"
            style={{ background: "#1a0a18" }}
          />
        )}

        {/* Corner brackets — rainbow tinted */}
        {[
          { top: -8, left: -8, rot: 0, c: "#ff3df5" },
          { top: -8, right: -8, rot: 90, c: "#ffd400" },
          { bottom: -8, right: -8, rot: 180, c: "#28ff7a" },
          { bottom: -8, left: -8, rot: 270, c: "#00d4ff" },
        ].map((c, i) => (
          <span
            key={i}
            className="absolute w-6 h-6 pointer-events-none"
            style={{
              top: c.top as number | undefined,
              left: c.left as number | undefined,
              right: c.right as number | undefined,
              bottom: c.bottom as number | undefined,
              transform: `rotate(${c.rot}deg)`,
              borderTop: `2px solid ${c.c}`,
              borderLeft: `2px solid ${c.c}`,
              animation: `splashCorner 1.6s ease-in-out ${i * 0.15}s infinite`,
              filter: `drop-shadow(0 0 6px ${c.c})`,
            }}
          />
        ))}
      </div>

      {/* Title — crisp readable, rainbow gradient text */}
      {title && (
        <div className="relative mt-10 px-6 text-center">
          <h1
            className="font-black tracking-[0.32em] leading-none"
            style={{
              fontSize: "clamp(22px,6vw,34px)",
              fontFamily: "'Bebas Neue','Russo One','Oswald',system-ui,sans-serif",
              backgroundImage:
                "linear-gradient(90deg,#ff3df5,#ff7a00,#ffd400,#28ff7a,#00d4ff,#5a6bff,#ff3df5)",
              backgroundSize: "300% 100%",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              WebkitTextFillColor: "transparent",
              animation: "splashTitleShift 6s linear infinite",
              filter:
                "drop-shadow(0 0 10px rgba(255,80,200,0.55)) drop-shadow(0 0 22px rgba(0,200,255,0.35))",
            }}
          >
            {title}
          </h1>
        </div>
      )}

      {/* Tagline — bright, readable */}
      {tagline && (
        <div
          className="mt-4 px-4 text-center text-white/90"
          style={{
            fontSize: "clamp(11px,2.6vw,13px)",
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            fontFamily: "system-ui,sans-serif",
            fontWeight: 600,
            textShadow: "0 0 10px rgba(255,80,180,0.45),0 0 18px rgba(0,200,255,0.3)",
          }}
        >
          {tagline}
        </div>
      )}

      {/* HUD scan bar — full RGB */}
      <div className="mt-8 w-[280px] h-[3px] bg-white/10 overflow-hidden relative rounded-full">
        <div
          className="absolute inset-y-0 w-2/3"
          style={{
            background:
              "linear-gradient(90deg,transparent,#ff3df5,#ffd400,#28ff7a,#00d4ff,transparent)",
            animation: "splashBarFill 1.8s ease-in-out infinite",
            filter: "drop-shadow(0 0 8px rgba(255,120,200,0.7))",
          }}
        />
      </div>
      <div
        className="mt-3 text-[10px] tracking-[0.5em] text-white/70"
        style={{ fontFamily: "ui-monospace,monospace" }}
      >
        SYS · LOADING
      </div>
    </div>
  );
};

export default SplashLoader;

