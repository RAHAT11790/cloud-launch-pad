import { useEffect, useMemo, useState } from "react";
import logoImg from "@/assets/logo.png";
import { useBranding, getBrandingSync } from "@/hooks/useBranding";

/**
 * Ultra-professional splash loader.
 * - Pure black backdrop with a single soft gold halo (no busy aurora / grain)
 * - Circular logo with one slim conic gold ring and inner glow
 * - Clean wordmark in white (emoji stripped) + clearly readable tagline
 * - Slim progress rail
 */

const EMOJI_RE =
  /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const cleanText = (s: string) => (s || "").replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();

const SplashLoader = () => {
  const branding = useBranding();
  const initialBranding = getBrandingSync();
  const [resolvedLogo, setResolvedLogo] = useState(initialBranding.logoUrl || logoImg);
  const logoSrc = useMemo(() => branding.logoUrl || logoImg, [branding.logoUrl]);

  const rawName = branding.splashText || branding.siteName || initialBranding.splashText || initialBranding.siteName || "RS ANIME";
  const rawTag = branding.siteTagline || initialBranding.siteTagline || "Premium Anime Streaming";
  const displayName = cleanText(rawName) || "RS ANIME";
  const tagline = cleanText(rawTag);

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
      {/* Single soft gold halo — subtle, professional */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 42%, rgba(212,160,60,0.22) 0%, rgba(212,160,60,0.06) 35%, transparent 70%)," +
            "radial-gradient(circle at center, transparent 55%, rgba(0,0,0,0.85) 100%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center px-6">
        {/* Logo ring */}
        <div className="relative w-[140px] h-[140px] flex items-center justify-center">
          {/* Soft outer glow */}
          <div
            aria-hidden
            className="absolute inset-[-18px] rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(212,160,60,0.30) 0%, transparent 65%)",
              filter: "blur(10px)",
              animation: "logoPulse 3s ease-in-out infinite",
            }}
          />
          {/* Slim conic gold ring */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "conic-gradient(from 0deg, rgba(212,160,60,0) 0deg, rgba(212,160,60,0) 200deg, rgba(245,200,90,0.95) 320deg, rgba(212,160,60,0) 360deg)",
              mask: "radial-gradient(circle, transparent 62px, #000 63px, #000 70px, transparent 71px)",
              WebkitMask: "radial-gradient(circle, transparent 62px, #000 63px, #000 70px, transparent 71px)",
              animation: "spin 2.4s linear infinite",
            }}
          />
          {/* Logo */}
          <img
            src={resolvedLogo}
            alt={displayName}
            className="relative w-[110px] h-[110px] rounded-full object-cover"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            style={{
              boxShadow:
                "0 0 0 1px rgba(212,160,60,0.55), 0 0 28px rgba(212,160,60,0.45), inset 0 0 18px rgba(0,0,0,0.55)",
            }}
          />
        </div>

        {/* Wordmark — clean white, no emoji */}
        <div
          className="mt-10 text-[22px] font-bold tracking-[8px] uppercase text-center text-white"
          style={{
            fontFamily: "'Russo One', 'Inter', sans-serif",
            textShadow: "0 2px 18px rgba(212,160,60,0.45), 0 0 1px rgba(255,255,255,0.6)",
          }}
        >
          {displayName}
        </div>

        {/* Tagline — clearly visible */}
        {tagline ? (
          <p className="mt-2.5 text-[11px] uppercase tracking-[5px] font-semibold text-center"
             style={{ color: "rgba(245,210,140,0.85)" }}>
            {tagline}
          </p>
        ) : null}

        {/* Progress rail */}
        <div className="mt-8 w-[200px] h-[2px] rounded-full overflow-hidden bg-white/[0.08] relative">
          <div
            className="absolute inset-y-0 left-0 w-[45%] rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(245,200,90,1) 50%, transparent 100%)",
              animation: "loadingMove 1.6s cubic-bezier(0.4,0,0.2,1) infinite",
              boxShadow: "0 0 10px rgba(245,200,90,0.7)",
            }}
          />
        </div>

        {/* Status dots */}
        <div className="mt-5 flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: "rgba(245,200,90,0.9)",
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
