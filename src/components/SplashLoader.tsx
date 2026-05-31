import { useEffect, useMemo, useState } from "react";
import logoImg from "@/assets/logo.png";
import actionBg from "@/assets/splash-action-bg.jpg";
import { useBranding, getBrandingSync } from "@/hooks/useBranding";

/**
 * Cinematic anime splash loader.
 * - Real action anime backdrop (dark overlay) — pulled from bundled asset for instant paint
 * - RGB conic spinner around the logo
 * - Branding text/emojis preserved exactly as set in Admin (no stripping)
 */

const SplashLoader = () => {
  const branding = useBranding();
  const initialBranding = getBrandingSync();
  const [resolvedLogo, setResolvedLogo] = useState(initialBranding.logoUrl || logoImg);
  const logoSrc = useMemo(() => branding.logoUrl || logoImg, [branding.logoUrl]);

  // Use branding values verbatim (keep emojis). Only fall back when Firebase value is missing.
  const displayName =
    (branding.splashText || initialBranding.splashText || branding.siteName || initialBranding.siteName || "").trim();
  const tagline = (branding.siteTagline || initialBranding.siteTagline || "").trim();

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const nextLogo = logoSrc || logoImg;
    if (typeof window === "undefined") { setResolvedLogo(nextLogo); return; }

    const apply = () => { if (!cancelled) setResolvedLogo(nextLogo); };
    const preload = new Image();
    preload.decoding = "async";

    const warmWithBrowserImage = () => {
      preload.src = nextLogo;
      if (preload.complete) { apply(); return; }
      preload.onload = apply;
      preload.onerror = () => { if (!cancelled) setResolvedLogo(logoImg); };
    };

    const warmWithCacheStorage = async () => {
      if (!("caches" in window) || !/^https?:/i.test(nextLogo)) { warmWithBrowserImage(); return; }
      try {
        const cache = await window.caches.open("rs-branding-assets-v1");
        let response = await cache.match(nextLogo);
        if (!response) {
          response = await fetch(nextLogo, { mode: "cors", cache: "force-cache" });
          if (response.ok) await cache.put(nextLogo, response.clone());
        }
        if (response?.ok) {
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setResolvedLogo(objectUrl);
          return;
        }
      } catch { /* fall through */ }
      warmWithBrowserImage();
    };

    void warmWithCacheStorage();
    return () => {
      cancelled = true;
      preload.onload = null;
      preload.onerror = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [logoSrc]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black">
      {/* Action anime background — bundled, instant paint */}
      <img
        src={actionBg}
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 0.55, filter: "saturate(1.05) contrast(1.05)" }}
      />
      {/* Vignette + dark wash for text legibility */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 55% at 50% 45%, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.92) 100%)",
        }}
      />
      {/* Soft animated red/blue glow accent (matches the anime backdrop) */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(45% 35% at 30% 70%, rgba(239,68,68,0.18) 0%, transparent 60%)," +
            "radial-gradient(40% 30% at 75% 30%, rgba(59,130,246,0.18) 0%, transparent 60%)",
          animation: "logoPulse 4s ease-in-out infinite",
        }}
      />

      <div className="relative z-10 flex flex-col items-center px-6">
        {/* Logo with multi-color RGB conic spinner */}
        <div className="relative w-[150px] h-[150px] flex items-center justify-center">
          {/* Outer halo */}
          <div
            aria-hidden
            className="absolute inset-[-22px] rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 65%)",
              filter: "blur(14px)",
              animation: "logoPulse 2.4s ease-in-out infinite",
            }}
          />
          {/* RGB conic spinner */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "conic-gradient(from 0deg, #ef4444, #f59e0b, #84cc16, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)",
              mask: "radial-gradient(circle, transparent 64px, #000 66px, #000 73px, transparent 75px)",
              WebkitMask: "radial-gradient(circle, transparent 64px, #000 66px, #000 73px, transparent 75px)",
              animation: "spin 2.2s linear infinite",
              filter: "drop-shadow(0 0 12px rgba(255,255,255,0.35))",
            }}
          />
          {/* Counter-rotating inner thin ring */}
          <div
            className="absolute inset-[12px] rounded-full"
            style={{
              background:
                "conic-gradient(from 180deg, transparent 0deg, transparent 270deg, rgba(255,255,255,0.85) 340deg, transparent 360deg)",
              mask: "radial-gradient(circle, transparent 56px, #000 57px, #000 60px, transparent 61px)",
              WebkitMask: "radial-gradient(circle, transparent 56px, #000 57px, #000 60px, transparent 61px)",
              animation: "spin 3.4s linear infinite reverse",
            }}
          />
          {/* Logo — perfectly circular */}
          <img
            src={resolvedLogo}
            alt={displayName || "Logo"}
            className="relative w-[112px] h-[112px] rounded-full object-cover"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            style={{
              boxShadow:
                "0 0 0 2px rgba(0,0,0,0.85), 0 0 0 3px rgba(255,255,255,0.18), 0 0 32px rgba(255,255,255,0.22), inset 0 0 20px rgba(0,0,0,0.55)",
            }}
          />
        </div>

        {/* Wordmark — preserves emojis exactly as set */}
        {displayName ? (
          <div
            className="mt-9 text-[22px] font-bold tracking-[6px] uppercase text-center text-white"
            style={{
              fontFamily: "'Russo One', 'Inter', sans-serif",
              textShadow: "0 2px 18px rgba(0,0,0,0.85), 0 0 22px rgba(255,255,255,0.18)",
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

        {/* Progress rail with RGB sweep */}
        <div className="mt-8 w-[220px] h-[3px] rounded-full overflow-hidden bg-white/[0.10] relative">
          <div
            className="absolute inset-y-0 left-0 w-[50%] rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, #ef4444 25%, #3b82f6 50%, #a855f7 75%, transparent 100%)",
              animation: "loadingMove 1.6s cubic-bezier(0.4,0,0.2,1) infinite",
              boxShadow: "0 0 12px rgba(255,255,255,0.45)",
            }}
          />
        </div>

        {/* Status dots */}
        <div className="mt-5 flex items-center gap-2">
          {[
            "#ef4444", "#3b82f6", "#a855f7",
          ].map((c, i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: c,
                boxShadow: `0 0 8px ${c}`,
                animation: `logoPulse 1.3s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SplashLoader;
