import { useEffect, useMemo, useState } from "react";
import logoImg from "@/assets/logo.png";
import { useBranding, getBrandingSync } from "@/hooks/useBranding";

/**
 * Main website splash loader.
 * Restored to the original login-intro style: dark login background, glowing
 * logo, big branded title, and welcome text. This is only for first website
 * entry/reload — AN card clicks use only the top "Loading details..." toast.
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
  const [resolvedLogo, setResolvedLogo] = useState(logoSrc);

  const displayName = (branding.loginTitle || branding.splashText || initial.splashText || branding.siteName || initial.siteName || "RS ANIME").trim();
  const siteName = (branding.siteName || initial.siteName || displayName || "RS ANIME").trim();

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

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center overflow-hidden">
      {/* Original login-style animated background */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
      >
        <div
          className="absolute top-[-30%] left-[-20%] w-[80%] h-[80%] rounded-full splash-login-blob-a"
          style={{ background: "radial-gradient(circle, hsla(176,65%,48%,0.08) 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-[-30%] right-[-20%] w-[80%] h-[80%] rounded-full splash-login-blob-b"
          style={{ background: "radial-gradient(circle, hsla(38,90%,55%,0.06) 0%, transparent 70%)" }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 px-6 splash-login-intro">
        <div className="relative splash-login-logo-wrap">
          <img
            src={resolvedLogo}
            alt={displayName}
            className="w-24 h-24 rounded-3xl object-cover"
            loading="eager"
            decoding="async"
            style={{ boxShadow: "0 0 60px hsla(176,65%,48%,0.35), 0 12px 35px rgba(0,0,0,0.45)" }}
          />
        </div>

        <h1
          className="text-4xl font-black gradient-text text-center"
          style={{ fontFamily: "'Russo One', sans-serif" }}
        >
          {displayName}
        </h1>
        <p className="text-sm text-muted-foreground text-center">Welcome to {siteName}</p>
      </div>

      <style>{`
        @keyframes splashIntroIn { from { transform: scale(.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes splashLogoGlow { 0%,100% { filter: drop-shadow(0 0 0 hsla(176,65%,48%,0)); } 50% { filter: drop-shadow(0 0 38px hsla(176,65%,48%,0.55)); } }
        @keyframes splashLoginBlobA { 0%,100% { transform: scale(1); } 50% { transform: scale(1.16) translate(18px, 10px); } }
        @keyframes splashLoginBlobB { 0%,100% { transform: scale(1); } 50% { transform: scale(1.12) translate(-16px, -10px); } }
        .splash-login-intro { animation: splashIntroIn .6s cubic-bezier(.16,1,.3,1) both; }
        .splash-login-logo-wrap { animation: splashLogoGlow 2s ease-in-out infinite; }
        .splash-login-blob-a { animation: splashLoginBlobA 8s ease-in-out infinite; }
        .splash-login-blob-b { animation: splashLoginBlobB 9s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

export default SplashLoader;
