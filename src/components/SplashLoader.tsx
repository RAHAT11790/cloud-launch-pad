import { useEffect, useMemo, useState } from "react";
import logoImg from "@/assets/logo.png";
import { useBranding, getBrandingSync } from "@/hooks/useBranding";

/**
 * Ultra-professional splash loader.
 * - Cinematic deep-black backdrop with layered amber aurora + radial vignette
 * - Logo locked inside a glass disc with dual orbital arcs and inner pulse
 * - Wordmark uses gradient text with a subtle shimmer sweep
 * - Slim segmented progress rail with traveling highlight
 * - All branding text is hydrated instantly from localStorage cache (zero FOUC)
 */
const SplashLoader = () => {
  const branding = useBranding();
  // Hydrate text synchronously from cache so there is no "empty" flash.
  const initialBranding = getBrandingSync();
  const [resolvedLogo, setResolvedLogo] = useState(
    initialBranding.logoUrl || logoImg
  );
  const logoSrc = useMemo(() => branding.logoUrl || logoImg, [branding.logoUrl]);

  // Display text with safe fallback so first-ever visit isn't blank
  const displayName = branding.splashText || branding.siteName || initialBranding.splashText || initialBranding.siteName || "LOADING";
  const tagline = branding.siteTagline || initialBranding.siteTagline || "";

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const nextLogo = logoSrc || logoImg;

    if (typeof window === "undefined") {
      setResolvedLogo(nextLogo);
      return;
    }

    const apply = () => {
      if (!cancelled) setResolvedLogo(nextLogo);
    };

    const preload = new Image();
    preload.decoding = "async";

    const warmWithBrowserImage = () => {
      preload.src = nextLogo;
      if (preload.complete) {
        apply();
        return;
      }
      preload.onload = apply;
      preload.onerror = () => {
        if (!cancelled) setResolvedLogo(logoImg);
      };
    };

    const warmWithCacheStorage = async () => {
      if (!("caches" in window) || !/^https?:/i.test(nextLogo)) {
        warmWithBrowserImage();
        return;
      }
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
      } catch {
        // fall through
      }
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#04050a]">
      {/* Cinematic aurora backdrop */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 45% at 50% 30%, hsla(42,90%,55%,0.22) 0%, transparent 70%)," +
            "radial-gradient(45% 40% at 50% 85%, hsla(28,95%,50%,0.14) 0%, transparent 70%)," +
            "radial-gradient(30% 25% at 15% 65%, hsla(38,90%,50%,0.10) 0%, transparent 70%)," +
            "linear-gradient(180deg, #04050a 0%, #07080f 60%, #04050a 100%)",
        }}
      />

      {/* Soft vignette */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(circle at center, transparent 50%, rgba(0,0,0,0.7) 100%)" }}
      />

      {/* Fine grain noise */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative z-10 flex flex-col items-center px-6">
        {/* Logo lockup */}
        <div className="relative w-[160px] h-[160px] flex items-center justify-center">
          {/* Outermost faint halo */}
          <div
            aria-hidden
            className="absolute inset-[-14px] rounded-full"
            style={{
              background:
                "radial-gradient(circle, hsla(42,90%,55%,0.18) 0%, transparent 65%)",
              animation: "logoPulse 3.2s ease-in-out infinite",
              filter: "blur(8px)",
            }}
          />

          {/* Outer slow arc */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: "1.5px solid transparent",
              borderTopColor: "hsla(42,90%,60%,0.95)",
              borderRightColor: "hsla(42,90%,60%,0.18)",
              animation: "spin 2.6s linear infinite",
              filter: "drop-shadow(0 0 10px hsla(42,90%,55%,0.45))",
            }}
          />
          {/* Inner counter arc */}
          <div
            className="absolute inset-[14px] rounded-full"
            style={{
              border: "1px solid transparent",
              borderBottomColor: "hsla(32,95%,58%,0.9)",
              borderLeftColor: "hsla(32,95%,58%,0.15)",
              animation: "spin 1.8s linear infinite reverse",
            }}
          />

          {/* Glass disc behind logo */}
          <div
            aria-hidden
            className="absolute inset-[22px] rounded-full"
            style={{
              background:
                "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 45%, rgba(0,0,0,0.4) 100%)",
              boxShadow:
                "inset 0 0 24px rgba(0,0,0,0.55), 0 6px 30px hsla(42,90%,40%,0.25)",
              backdropFilter: "blur(4px)",
            }}
          />

          {/* Logo */}
          <img
            src={resolvedLogo}
            alt={displayName}
            className="relative w-[88px] h-[88px] rounded-full object-cover ring-1 ring-white/15"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            style={{
              filter:
                "drop-shadow(0 0 22px hsla(42,95%,55%,0.6)) drop-shadow(0 0 3px rgba(255,255,255,0.35))",
            }}
          />
        </div>

        {/* Wordmark with shimmer */}
        <div className="mt-8 relative">
          <div
            className="text-[24px] font-black tracking-[10px] uppercase text-center"
            style={{
              fontFamily: "'Russo One', sans-serif",
              background:
                "linear-gradient(180deg, #ffffff 0%, hsl(42 90% 72%) 55%, hsl(32 95% 50%) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              filter: "drop-shadow(0 2px 16px hsla(42,90%,55%,0.4))",
            }}
          >
            {displayName}
          </div>
          {/* Shimmer sweep */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none overflow-hidden"
            style={{
              background:
                "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.35) 50%, transparent 65%)",
              backgroundSize: "250% 100%",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              animation: "loadingMove 2.6s linear infinite",
              mixBlendMode: "screen",
            }}
          />
        </div>

        {tagline ? (
          <p className="mt-2 text-[10px] uppercase tracking-[6px] text-white/45 font-medium text-center">
            {tagline}
          </p>
        ) : (
          <div className="mt-2 h-[10px]" />
        )}

        {/* Segmented progress rail */}
        <div className="mt-7 w-[220px] h-[3px] rounded-full overflow-hidden bg-white/[0.06] relative">
          <div
            className="absolute inset-y-0 left-0 w-[40%] rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, hsl(42 95% 60%) 50%, transparent 100%)",
              animation: "loadingMove 1.5s cubic-bezier(0.4,0,0.2,1) infinite",
              boxShadow: "0 0 12px hsla(42,90%,55%,0.7)",
            }}
          />
        </div>

        {/* Status dots */}
        <div className="mt-5 flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-amber-400/80"
              style={{
                animation: `logoPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SplashLoader;
