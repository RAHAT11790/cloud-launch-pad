import { useBranding } from "@/hooks/useBranding";

/**
 * Ultra optimized anime splash loader.
 * Single consistent design: admin branding + sakura/petal fall + magic sparkle rain.
 * Animations are transform/opacity-only for smooth, low-lag playback.
 */

const petals = Array.from({ length: 22 }, (_, i) => ({
  left: `${(i * 11 + (i % 4) * 9) % 100}%`,
  delay: `${(i * 0.37) % 7}s`,
  dur: `${7.5 + (i % 6) * 0.65}s`,
  drift: `${(i % 2 ? 1 : -1) * (38 + (i % 7) * 13)}px`,
  size: 13 + (i % 5) * 3,
  opacity: 0.5 + (i % 4) * 0.12,
}));

const sparkles = Array.from({ length: 28 }, (_, i) => ({
  left: `${(i * 17 + 5) % 100}%`,
  delay: `${(i * 0.21) % 4}s`,
  dur: `${3 + (i % 5) * 0.55}s`,
  drift: `${(i % 2 ? 1 : -1) * (20 + (i % 6) * 9)}px`,
  size: 2 + (i % 3),
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
          "radial-gradient(ellipse at 50% 18%, rgba(255, 168, 210, 0.18), transparent 38%), radial-gradient(ellipse at 16% 85%, rgba(255, 202, 122, 0.12), transparent 42%), radial-gradient(ellipse at 84% 78%, rgba(132, 215, 255, 0.14), transparent 44%), linear-gradient(180deg, #08070f 0%, #110817 54%, #06050a 100%)",
        animation: "splFadeIn 0.35s ease-out",
      }}
    >
      <div className="absolute inset-0 pointer-events-none opacity-70" style={{ background: "linear-gradient(115deg, transparent 0 42%, rgba(255,255,255,0.08) 50%, transparent 58% 100%)", animation: "sakuraSheen 5.8s ease-in-out infinite" }} />
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.12) 1px, transparent 1.6px)", backgroundSize: "34px 34px", maskImage: "radial-gradient(circle at center, #000 18%, transparent 76%)", WebkitMaskImage: "radial-gradient(circle at center, #000 18%, transparent 76%)", opacity: 0.18 }} />

      {petals.map((p, i) => (
        <span
          key={`petal-${i}`}
          className="absolute top-0 pointer-events-none"
          style={{
            left: p.left,
            width: p.size,
            height: p.size * 1.45,
            opacity: p.opacity,
            borderRadius: "100% 0 100% 18%",
            background: i % 3 === 0
              ? "linear-gradient(135deg, rgba(255,240,246,0.98), rgba(255,124,185,0.88))"
              : "linear-gradient(135deg, rgba(255,220,236,0.95), rgba(255,174,116,0.78))",
            boxShadow: "0 0 10px rgba(255, 154, 206, 0.42)",
            transformOrigin: "50% 10%",
            // @ts-ignore CSS custom props
            "--drift": p.drift,
            animation: `sakuraPetalFall ${p.dur} linear ${p.delay} infinite`,
          }}
        />
      ))}

      {sparkles.map((s, i) => (
        <span
          key={`spark-${i}`}
          className="absolute top-0 pointer-events-none rounded-full"
          style={{
            left: s.left,
            width: s.size,
            height: s.size,
            background: i % 2 ? "#fff6c7" : "#ffd8f0",
            boxShadow: "0 0 10px currentColor, 0 0 18px rgba(255,255,255,0.7)",
            color: i % 2 ? "#fff6c7" : "#ffd8f0",
            // @ts-ignore CSS custom props
            "--drift": s.drift,
            animation: `sakuraSparkRain ${s.dur} ease-in ${s.delay} infinite`,
          }}
        />
      ))}

      <div className="relative flex items-center justify-center w-[196px] h-[196px]">
        <div className="absolute inset-0 rounded-full" style={{ background: "conic-gradient(from 0deg, rgba(255,120,196,0), rgba(255,120,196,0.95), rgba(255,223,130,0.95), rgba(126,219,255,0.95), rgba(255,120,196,0))", animation: "sakuraAuraSpin 6s linear infinite", filter: "blur(0.2px) drop-shadow(0 0 18px rgba(255,152,205,0.42))" }} />
        <div className="absolute inset-[4px] rounded-full" style={{ background: "#090711" }} />
        <div className="absolute inset-[16px] rounded-full" style={{ border: "1px solid rgba(255,255,255,0.22)", boxShadow: "inset 0 0 34px rgba(255,160,210,0.2), 0 0 42px rgba(126,219,255,0.18)", animation: "sakuraSoftPulse 2.6s ease-in-out infinite" }} />
        <div className="absolute inset-[32px] rounded-full" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.16), rgba(255,142,199,0.10) 45%, transparent 70%)" }} />
        {logo ? (
          <img
            src={logo}
            alt={title || "Site logo"}
            className="relative z-10 w-[104px] h-[104px] rounded-full object-cover"
            style={{ border: "2px solid rgba(255,255,255,0.28)", boxShadow: "0 12px 38px rgba(0,0,0,0.55), 0 0 28px rgba(255,151,207,0.42)" }}
          />
        ) : (
          <div className="relative z-10 w-[104px] h-[104px] rounded-full" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.88), rgba(255,150,205,0.55), rgba(126,219,255,0.22))", boxShadow: "0 0 34px rgba(255,151,207,0.48)" }} />
        )}
      </div>

      {title && (
        <h1
          className="mt-9 px-6 text-center font-black leading-tight"
          style={{
            fontSize: "clamp(24px,6.2vw,38px)",
            letterSpacing: "0.18em",
            fontFamily: "'Russo One','Bebas Neue','Poppins',system-ui,sans-serif",
            backgroundImage: "linear-gradient(90deg,#fff7fb,#ffc1df,#fff2a8,#b9efff,#fff7fb)",
            backgroundSize: "240% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            color: "transparent",
            animation: "sakuraTitleGlow 4.8s ease-in-out infinite",
            textShadow: "0 0 20px rgba(255,183,218,0.28)",
          }}
        >
          {title}
        </h1>
      )}

      {/* Tagline */}
      {tagline && (
        <div
          className="mt-3 px-5 text-center text-white/86"
          style={{
            fontSize: "clamp(11px,2.6vw,13px)",
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            fontWeight: 700,
            textShadow: "0 0 12px rgba(255,178,215,0.34),0 0 22px rgba(126,219,255,0.22)",
          }}
        >
          {tagline}
        </div>
      )}

      <div className="mt-8 w-[268px] max-w-[72vw] h-[3px] bg-white/10 overflow-hidden relative rounded-full">
        <div className="absolute inset-y-0 w-2/3" style={{
          background: "linear-gradient(90deg,transparent,#ff9ecd,#fff2a8,#b9efff,transparent)",
          animation: "splashBarFill 1.65s ease-in-out infinite",
          filter: "drop-shadow(0 0 8px rgba(255,178,215,0.68))",
        }} />
      </div>
      <div className="mt-3 text-[10px] tracking-[0.45em] text-white/62" style={{ fontFamily: "ui-monospace,monospace" }}>
        SYS · LOADING
      </div>
    </div>
  );
};

export default SplashLoader;
