import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Check, Mail } from "lucide-react";
import { confirmEmailLinkOnSite, readPendingProfileReset, ticketRid } from "@/lib/emailService";
import { useBranding } from "@/hooks/useBranding";

/**
 * The email's Verify / Reset button opens this page (same domain as the site).
 * It confirms the link once, then hands over to the screen that finishes the
 * request: the sign-in page (via ?ev=…) or the profile's password panel.
 */
export default function VerifyEmailLink() {
  const { rid = "", token = "" } = useParams();
  const [state, setState] = useState<"busy" | "ok" | "error">("busy");
  const [message, setMessage] = useState("Please wait a moment while we confirm your email.");
  const [purpose, setPurpose] = useState<"register" | "reset">("register");
  const started = useRef(false);
  const branding = useBranding();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    confirmEmailLinkOnSite(rid, token).then((r) => {
      setPurpose(r.purpose);
      setState("ok");
      setMessage(r.purpose === "reset" ? "It's really you. Taking you back to set your new password…" : "Your email is verified. Taking you back…");
      const profileReset = r.purpose === "reset" ? readPendingProfileReset() : null;
      const next = profileReset && ticketRid(profileReset.token) === r.rid
        ? "/profile"
        : `/?ev=${encodeURIComponent(r.rid)}&eg=${encodeURIComponent(r.grant)}&ep=${r.purpose}`;
      window.setTimeout(() => window.location.replace(next), 900);
    }).catch((err) => {
      setState("error");
      setMessage(err?.message || "This link can't be used any more. Please ask for a new email.");
    });
  }, [rid, token]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-background px-5">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
      </div>
      <main className="relative w-full max-w-[360px] rounded-3xl border border-primary/20 glass-card-strong p-6 text-center">
        <div className="relative mx-auto mb-4 h-16 w-16">
          <div className="absolute inset-0 rotate-6 rounded-2xl gradient-primary opacity-40" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary shadow-lg">
            {state === "busy" ? <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-primary-foreground/30 border-t-primary-foreground" />
              : state === "ok" ? <Check className="h-8 w-8 text-primary-foreground" />
              : <AlertTriangle className="h-8 w-8 text-primary-foreground" />}
          </div>
        </div>
        <h1 className="text-xl font-black text-foreground" style={{ fontFamily: "'Russo One', sans-serif" }}>
          {state === "busy" ? "Confirming your email" : state === "ok" ? (purpose === "reset" ? "Email confirmed" : "Email verified") : "Link not valid"}
        </h1>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground" role={state === "error" ? "alert" : "status"}>{message}</p>
        {state !== "busy" && (
          <a href="/" className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold gradient-primary text-primary-foreground btn-glow">
            <Mail className="h-4 w-4" /> Open {branding.siteName || "RS ANIME03"}
          </a>
        )}
      </main>
    </div>
  );
}
