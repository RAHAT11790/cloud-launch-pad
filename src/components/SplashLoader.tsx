import { useEffect, useMemo, useState } from "react";
import logoImg from "@/assets/logo.png";
import fallbackBg from "@/assets/splash-action-bg.jpg";
import { useBranding, getBrandingSync } from "@/hooks/useBranding";

/**
 * Splash loader — ultra smooth, zero-lag.
 * - Single GPU transform (one rotating ring + one pulsing halo). No conic masks, no SVG noise.
 * - Background image is fully controlled from Admin (branding.splashBgUrl). Bundled asset is fallback only.
 * - Logo + background are both warmed via CacheStorage so reloads paint instantly.
 */

const BG_CACHE = "rs-branding-assets-v1";

async function warmAsset(url: string): Promise<string> {
  if (!url || typeof window === "undefined") return url;
  if (!/^https?:/i.test(url) || !("caches" in window)) return url;
  try {
    const cache = await window.caches.open(BG_CACHE);
    let res = await cache.match(url);
    if (!res) {
      res = await fetch(url, { mode: "cors", cache: "force-cache" });
      if (res.ok) await cache.put(url, res.clone());
    }
    if (res?.ok) {
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    }
  } catch { /* fallthrough */ }
  return url;
}

const SplashLoader = () => {
  const branding = useBranding();
  const initial = getBrandingSync();

  const logoSrc = useMemo(() => branding.logoUrl || initial.logoUrl || logoImg, [branding.logoUrl, initial.logoUrl]);
  const bgSrc = useMemo(
    () => branding.splashBgUrl || initial.splashBgUrl || fallbackBg,
    [branding.splashBgUrl, initial.splashBgUrl]
  );

  const [resolvedLogo, setResolvedLogo] = useState(logoSrc);
  const [resolvedBg, setResolvedBg] = useState(bgSrc);

  const displayName = (branding.splashText || initial.splashText || branding.siteName || initial.siteName || "").trim();
  const tagline = (branding.siteTagline || initial.siteTagline || "").trim();

  useEffect(() => {
    let cancelled = false;
    let objUrl: string | null = null;
    (async () => {
      const out = await warmAsset(logoSrc);
      if (cancelled) return;
      if (out !== logoSrc) objUrl = out;
      setResolvedLogo(out);
    })();
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [logoSrc]);

  useEffect(() => {
    let cancelled = false;
    let objUrl: string | null = null;
    (async () => {
      const out = await warmAsset(bgSrc);
      if (cancelled) return;
      if (out !== bgSrc) objUrl = out;
      setResolvedBg(out);
    })();
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [bgSrc]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black">
      {/* Background image — instant paint via cached blob */}
      <img
        src={resolvedBg}
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 0.6, transform: "translateZ(0)", willChange: "transform" }}
        loading="eager"
        decoding="async"
      />
      {/* Vignette wash for readability */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 55% at 50% 45%, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.94) 100%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center px-6">
        {/* Logo with single smooth ring (transform-only, GPU) */}
        <div className="relative w-[150px] h-[150px] flex items-center justify-center">
          {/* Soft halo */}
          <div
            aria-hidden
            className="absolute inset-[-18px] rounded-full splash-halo"
            style={{
              background: "radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 65%)",
              filter: "blur(12px)",
            }}
          />
          {/* Rotating SVG ring — pure transform, no masks, no conic */}
          <svg
            className="absolute inset-0 splash-spin"
            viewBox="0 0 100 100"
            style={{ willChange: "transform", transform: "translateZ(0)" }}
          >
            <defs>
              <linearGradient id="splashRing" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(255,255,255,0)" />
                <stop offset="55%" stopColor="rgba(255,255,255,0.55)" />
                <stop offset="100%" stopColor="#ffffff" />
              </linearGradient>
            </defs>
            <circle
              cx="50" cy="50" r="46"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="2"
            />
            <circle
              cx="50" cy="50" r="46"
              fill="none"
              stroke="url(#splashRing)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeDasharray="120 220"
            />
          </svg>
          {/* Logo */}
          <img
            src={resolvedLogo}
            alt={displayName || "Logo"}
            className="relative w-[112px] h-[112px] rounded-full object-cover"
            loading="eager"
            decoding="async"
            style={{
              boxShadow:
                "0 0 0 2px rgba(0,0,0,0.85), 0 0 0 3px rgba(255,255,255,0.18), 0 0 28px rgba(255,255,255,0.18), inset 0 0 18px rgba(0,0,0,0.55)",
            }}
          />
        </div>

        {/* Wordmark */}
        {displayName ? (
          <div
            className="mt-9 text-[22px] font-bold tracking-[6px] uppercase text-center text-white"
            style={{
              fontFamily: "'Russo One', 'Inter', sans-serif",
              textShadow: "0 2px 18px rgba(0,0,0,0.85), 0 0 22px rgba(255,255,255,0.16)",
            }}
          >
            {displayName}
          </div>
        ) : null}

        {/* Tagline */}
        {tagline ? (
          <p
            className="mt-2.5 text-[11px] uppercase tracking-[5px] font-semibold text-center"
            style={{ color: "rgba(255,255,255,0.85)", textShadow: "0 1px 8px rgba(0,0,0,0.85)" }}
          >
            {tagline}
          </p>
        ) : null}

        {/* Progress rail — soft white sweep */}
        <div className="mt-8 w-[220px] h-[2.5px] rounded-full overflow-hidden bg-white/[0.08]">
          <div
            className="h-full w-[40%] rounded-full splash-sweep"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)",
              willChange: "transform",
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes splashSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes splashHalo { 0%,100% { opacity: 0.55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.05); } }
        @keyframes splashSweep { 0% { transform: translateX(-110%); } 100% { transform: translateX(360%); } }
        .splash-spin { animation: splashSpin 2.6s linear infinite; }
        .splash-halo { animation: splashHalo 2.6s ease-in-out infinite; }
        .splash-sweep { animation: splashSweep 1.6s cubic-bezier(.45,.05,.25,1) infinite; }
      `}</style>
    </div>
  );
};

export default SplashLoader;
