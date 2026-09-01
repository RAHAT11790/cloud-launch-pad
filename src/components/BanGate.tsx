// Full-screen block shown to banned accounts / devices. Mounted once in App.
import { useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { subscribeBanState, type BanState } from "@/lib/banGuard";

const BanGate = () => {
  const [state, setState] = useState<BanState>({ banned: false });

  useEffect(() => {
    const off = subscribeBanState(setState);
    return () => off();
  }, []);

  useEffect(() => {
    if (!state.banned) return;
    try {
      document.documentElement.style.overflow = "hidden";
      // Kill any playing media immediately.
      document.querySelectorAll("video, audio").forEach((el) => {
        try { (el as HTMLMediaElement).pause(); } catch { /* noop */ }
      });
    } catch { /* noop */ }
    return () => { try { document.documentElement.style.overflow = ""; } catch { /* noop */ } };
  }, [state.banned]);

  const onAdmin = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
  if (!state.banned || onAdmin) return null;


  return (
    <div className="fixed inset-0 z-[999999] bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center rounded-2xl border border-destructive/30 bg-card p-8 shadow-2xl">
        <div className="w-16 h-16 mx-auto rounded-full bg-destructive/15 text-destructive flex items-center justify-center">
          <Ban className="w-8 h-8" />
        </div>
        <h1 className="mt-5 text-xl font-bold text-foreground">Access Blocked</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This {state.scope === "device" ? "device" : "account"} has been suspended by the administrator.
        </p>
        {state.reason ? (
          <p className="mt-3 text-xs text-muted-foreground/80">Reason: {state.reason}</p>
        ) : null}
        <p className="mt-5 text-xs text-muted-foreground/70">
          If you think this is a mistake, contact support on Telegram.
        </p>
      </div>
    </div>
  );
};

export default BanGate;
