import { useEffect, useRef, useState } from "react";
import { checkEmailStatus, type EmailStatus } from "@/lib/emailService";

const POLL_MS = 4000;

/**
 * Watches an email ticket while its screen is open. When the person taps the
 * "Verify" button inside the email (any device/browser), the status turns
 * "verified" and `onVerified` runs once, so this screen finishes by itself.
 * Checks pause while the tab is hidden and run at once when it comes back.
 */
export function useEmailLinkWatch(ticket: string | null | undefined, onVerified: () => void): EmailStatus | null {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const cb = useRef(onVerified);
  cb.current = onVerified;

  useEffect(() => {
    setStatus(null);
    if (!ticket) return;
    let stopped = false;
    let busy = false;
    let fired = false;
    const tick = async () => {
      if (stopped || busy || fired || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const s = await checkEmailStatus(ticket);
        if (stopped) return;
        setStatus(s.status);
        if (s.status === "verified") { fired = true; cb.current(); }
        if (s.status !== "pending" && s.status !== "verified") stopped = true;
      } catch { /* network blips: try again next tick */ }
      finally { busy = false; }
    };
    const first = window.setTimeout(tick, 1500);
    const timer = window.setInterval(tick, POLL_MS);
    const onShow = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [ticket]);

  return status;
}
