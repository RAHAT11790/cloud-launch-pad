import logoImg from "@/assets/logo.png";
import { useBranding } from "@/hooks/useBranding";

const SplashLoader = () => {
  const branding = useBranding();
  const logoSrc = branding.logoUrl || logoImg;

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center z-[9999]">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full opacity-15"
          style={{
            background: "radial-gradient(circle, hsl(var(--primary)) 0%, transparent 70%)",
            animation: "logoPulse 3s ease-in-out infinite",
          }}
        />
      </div>

      <img
        src={logoSrc}
        alt={branding.splashText}
        className="w-28 h-28 object-contain mb-5 relative z-10"
        style={{
          filter: "drop-shadow(0 0 30px hsla(42,80%,50%,0.4))",
          animation: "logoPulse 2s ease-in-out infinite",
        }}
      />

      <div
        className="text-2xl font-black tracking-[6px] uppercase relative z-10 gradient-text"
        style={{
          fontFamily: "'Russo One', sans-serif",
          filter: "drop-shadow(0 0 15px hsla(42,80%,50%,0.3))",
        }}
      >
        {branding.splashText}
      </div>

      <p className="mt-3 text-[10px] text-muted-foreground uppercase tracking-[5px] relative z-10">
        Loading...
      </p>

      <div className="mt-5 w-[160px] h-[3px] rounded-full overflow-hidden relative z-10" style={{ boxShadow: "var(--neu-shadow-inset)" }}>
        <div className="absolute h-full w-[40%] bg-gradient-to-r from-transparent via-primary to-transparent animate-[loadingMove_1s_ease-in-out_infinite]" />
      </div>
    </div>
  );
};

export default SplashLoader;
