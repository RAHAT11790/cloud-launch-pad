import { useBranding } from "@/hooks/useBranding";

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
          "radial-gradient(ellipse at 20% 10%, #1a1230 0%, transparent 55%), radial-gradient(ellipse at 85% 90%, #2a0a14 0%, transparent 55%), #050507",
      }}
    >
      {/* Logo + rotating ring */}
      <div className="relative w-[160px] h-[160px] flex items-center justify-center">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            border: "2px solid transparent",
            borderTopColor: "rgba(255,255,255,0.85)",
            borderLeftColor: "rgba(255,255,255,0.25)",
            animation: "spin 2.4s linear infinite",
          }}
        />
        {logo && (
          <img
            src={logo}
            alt={title}
            className="w-[130px] h-[130px] rounded-full object-cover"
            style={{ filter: "drop-shadow(0 0 30px rgba(220,30,40,0.45))" }}
          />
        )}
      </div>

      {/* Title (from admin) */}
      {title && (
        <div
          className="mt-10 text-white text-[26px] font-semibold"
          style={{
            fontFamily: "'Cormorant Garamond', 'Playfair Display', Georgia, serif",
            letterSpacing: "0.35em",
          }}
        >
          {title}
        </div>
      )}

      {/* Tagline (from admin) */}
      {tagline && (
        <div
          className="mt-3 text-white/85 text-[12px]"
          style={{ letterSpacing: "0.35em", fontFamily: "Georgia, serif" }}
        >
          {tagline}
        </div>
      )}

      {/* Thin progress line */}
      <div className="mt-8 w-[260px] h-[1px] bg-white/10 overflow-hidden relative">
        <div
          className="absolute top-0 left-0 h-full w-[35%]"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)",
            animation: "loadingMove 1.6s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
};

export default SplashLoader;
