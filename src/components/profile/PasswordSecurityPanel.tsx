import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, Check, Eye, EyeOff, KeyRound, Lock, Mail, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { db, get, ref, set, update } from "@/lib/firebase";
import { useEmailLinkWatch } from "@/hooks/useEmailLinkWatch";
import {
  claimEmailLink, cooldownLeftMs, EmailServiceError, normalizeEmail, resendEmailCode, sendEmailCode, verifyEmailCode,
} from "@/lib/emailService";
import { CodeTimer, DailyPips, OtpBoxes, PasswordStrength, ResendButton, SecureNote, SentToCard, StepDots } from "@/components/auth/EmailCodeKit";

const keyOf = (email: string) => email.toLowerCase().replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
const legacyKeyOf = (email: string) => email.toLowerCase().replace(/[^a-z0-9]/g, "_");
const MIN = 6;

function PwInput({ value, onChange, placeholder, show, onToggle, autoFocus, onEnter, mark }: {
  value: string; onChange: (v: string) => void; placeholder: string; show: boolean; onToggle?: () => void; autoFocus?: boolean; onEnter?: () => void; mark?: "ok" | "bad" | null;
}) {
  return (
    <div className="relative">
      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        onKeyDown={(e) => { if (e.key === "Enter") onEnter?.(); }} autoComplete="new-password"
        className="w-full py-3 pl-10 pr-10 rounded-xl bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground" />
      {mark ? (
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2">{mark === "ok" ? <Check className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-destructive" />}</span>
      ) : onToggle ? (
        <button type="button" onClick={onToggle} className="absolute right-3.5 top-1/2 -translate-y-1/2" aria-label={show ? "Hide password" : "Show password"}>
          {show ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
        </button>
      ) : null}
    </div>
  );
}
const Err = ({ text }: { text: string }) => (
  <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-foreground">
    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-px" /><span>{text}</span>
  </div>
);
const Spin = () => <span className="animate-spin w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full" />;

/** Change password (old → new) or reset it with an email code, inside the profile. */
export default function PasswordSecurityPanel({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"change" | "reset">("change");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // reset-by-email state
  const [ticket, setTicket] = useState("");
  const [meta, setMeta] = useState<{ expiresAt: number; totalMs: number; dailyLeft: number | null; dailyMax: number | null } | null>(null);
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState<"" | "code" | "link">("");
  const [wait, setWait] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    (async () => {
      try {
        const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
        const e = String(u.email || "");
        setEmail(e);
        if (!e) { setHasPassword(false); return; }
        for (const k of [keyOf(e), legacyKeyOf(e)]) {
          const s = await get(ref(db, `appUsers/${k}`));
          if (s.exists() && s.val().password) { setHasPassword(true); return; }
        }
        setHasPassword(false);
      } catch { setHasPassword(false); }
    })();
  }, []);

  useEffect(() => {
    if (mode !== "reset" || !ticket) return;
    const t = () => { setWait(Math.ceil(cooldownLeftMs(email) / 1000)); setNow(Date.now()); };
    t();
    const id = setInterval(t, 1000);
    return () => clearInterval(id);
  }, [mode, ticket, email]);

  useEmailLinkWatch(mode === "reset" && ticket && !verified ? ticket : null, () => {
    setVerified("link");
    toast.success("Email confirmed — now set your new password");
  });

  const pwMatch = confirmPw ? (newPw === confirmPw ? "ok" : "bad") : null;
  const pwReady = newPw.length >= MIN && newPw === confirmPw;

  const writePassword = async (pw: string) => {
    const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
    for (const k of [keyOf(email), legacyKeyOf(email)]) {
      const s = await get(ref(db, `appUsers/${k}`));
      if (s.exists()) { await update(ref(db, `appUsers/${k}`), { password: pw }); return s.val(); }
    }
    await set(ref(db, `appUsers/${keyOf(email)}`), { id: u.id, name: u.name, email, createdAt: Date.now(), password: pw });
    return null;
  };

  const submitChange = async () => {
    setError("");
    if (hasPassword && !oldPw) { setError("Enter your current password"); return; }
    if (newPw.length < MIN) { setError(`New password needs at least ${MIN} characters`); return; }
    if (hasPassword && oldPw === newPw) { setError("New password must be different from the current one"); return; }
    if (newPw !== confirmPw) { setError("Passwords don't match"); return; }
    if (!email) { setError("This account has no email"); return; }
    setBusy(true);
    try {
      if (hasPassword) {
        let current: any = null;
        for (const k of [keyOf(email), legacyKeyOf(email)]) {
          const s = await get(ref(db, `appUsers/${k}`));
          if (s.exists()) { current = s.val(); break; }
        }
        if (!current || current.password !== oldPw) { setError("Current password is incorrect"); setBusy(false); return; }
      }
      await writePassword(newPw);
      toast.success(hasPassword ? "Password changed" : "Password set");
      onBack();
    } catch (e: any) { setError(e?.message || "Could not save the password"); }
    setBusy(false);
  };

  const sendCode = async () => {
    setError(""); setBusy(true);
    try {
      let t;
      if (ticket) {
        try { t = await resendEmailCode(ticket, email); }
        catch (err) {
          if (err instanceof EmailServiceError && ["not_found", "bad_ticket", "already_used"].includes(err.code)) t = await sendEmailCode(email, "reset");
          else throw err;
        }
      } else t = await sendEmailCode(email, "reset");
      setTicket(t.token); setCode(""); setVerified("");
      setMeta({ expiresAt: t.expiresAt, totalMs: Math.max(60_000, t.expiresAt - Date.now()), dailyLeft: t.dailyLeft, dailyMax: t.dailyMax });
    } catch (e: any) { setError(e?.message || "Could not send the code"); }
    setBusy(false);
  };

  const checkCode = async (c?: string) => {
    const v = String(c ?? code).replace(/\D/g, "");
    if (v.length !== 6 || busy) return;
    setBusy(true); setError("");
    try {
      const r = await verifyEmailCode(ticket, v);
      if (r.email !== normalizeEmail(email) || r.purpose !== "reset") throw new Error("This code belongs to another email.");
      setVerified("code");
    } catch (e: any) { setError(e?.message || "Incorrect code"); setCode(""); }
    setBusy(false);
  };

  const submitReset = async () => {
    setError("");
    if (!pwReady) { setError(newPw.length < MIN ? `New password needs at least ${MIN} characters` : "Passwords don't match"); return; }
    setBusy(true);
    try {
      if (verified === "link") {
        const r = await claimEmailLink(ticket);
        if (r.email !== normalizeEmail(email) || r.purpose !== "reset") throw new Error("This link belongs to another email.");
      }
      await writePassword(newPw);
      toast.success("New password saved");
      onBack();
    } catch (e: any) {
      setError(e?.message || "Could not save the password");
      if (e instanceof EmailServiceError && ["already_used", "replaced", "locked", "expired", "not_found"].includes(e.code)) { setTicket(""); setVerified(""); }
    }
    setBusy(false);
  };

  const enterReset = () => { setMode("reset"); setError(""); setOldPw(""); setNewPw(""); setConfirmPw(""); };
  const leaveReset = () => { setMode("change"); setError(""); setTicket(""); setVerified(""); setCode(""); setNewPw(""); setConfirmPw(""); };
  const step = !ticket ? 0 : verified ? 2 : 1;

  return (
    <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto"
      initial={{ x: 34, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 34, opacity: 0 }} transition={{ type: "tween", duration: 0.28 }}>
      <div className="sticky top-0 z-20 flex items-center gap-2.5 px-3.5 py-2.5 bg-background/85 backdrop-blur-md border-b border-border/60">
        <button type="button" onClick={mode === "reset" ? leaveReset : onBack} className="w-[38px] h-[38px] rounded-xl grid place-items-center bg-foreground/5" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h2 className="text-base font-extrabold leading-tight">{mode === "reset" ? "Reset by email" : "Password & security"}</h2>
          <p className="text-[10.5px] text-muted-foreground truncate">{email || "No email on this account"}</p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[480px] px-4 pt-4 pb-28 space-y-3">
        {hasPassword === null ? (
          <div className="py-16 grid place-items-center"><span className="animate-spin w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full" /></div>
        ) : mode === "change" ? (
          <>
            <div className="rounded-2xl border border-border/80 bg-card/70 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl grid place-items-center bg-primary/15 text-primary"><KeyRound className="w-5 h-5" /></span>
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold">{hasPassword ? "Change password" : "Set a password"}</h3>
                  <p className="text-[10.5px] text-muted-foreground">{hasPassword ? "Enter your current password, then a new one" : "Your account has no password yet"}</p>
                </div>
              </div>
              {hasPassword && <PwInput value={oldPw} onChange={(v) => { setOldPw(v); setError(""); }} placeholder="Current password" show={show} onToggle={() => setShow((s) => !s)} autoFocus />}
              <PwInput value={newPw} onChange={(v) => { setNewPw(v); setError(""); }} placeholder={`New password (min ${MIN})`} show={show} onToggle={hasPassword ? undefined : () => setShow((s) => !s)} />
              <PasswordStrength value={newPw} />
              <PwInput value={confirmPw} onChange={(v) => { setConfirmPw(v); setError(""); }} placeholder="Re-enter new password" show={show} mark={pwMatch} onEnter={submitChange} />
              {error && <Err text={error} />}
              <motion.button whileTap={{ scale: 0.98 }} onClick={submitChange} disabled={busy || !pwReady || (hasPassword && !oldPw)}
                className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50">
                {busy ? <Spin /> : <><Save className="w-4 h-4" /> {hasPassword ? "Change password" : "Set password"}</>}
              </motion.button>
            </div>
            {hasPassword && email && (
              <button type="button" onClick={enterReset} className="w-full flex items-center gap-3 rounded-2xl border border-border/80 bg-card/70 px-4 py-3.5 text-left">
                <span className="w-10 h-10 rounded-xl grid place-items-center bg-primary/15 text-primary"><Mail className="w-5 h-5" /></span>
                <span className="min-w-0 flex-1"><strong className="block text-sm">Forgot your current password?</strong><small className="block text-[10.5px] text-muted-foreground">Reset it with a 6-digit code sent to your email</small></span>
              </button>
            )}
            <SecureNote>Use at least {MIN} characters. Mixing upper and lower case, numbers and symbols makes it stronger.</SecureNote>
          </>
        ) : (
          <div className="rounded-2xl border border-border/80 bg-card/70 p-4 space-y-3">
            <StepDots steps={["Send code", "Enter code", "New password"]} current={step} />
            {step === 0 && (
              <>
                <div className="rounded-xl bg-foreground/5 p-3 text-[11.5px] text-muted-foreground leading-relaxed">
                  We'll email a 6-digit code and a one-tap reset button to<br /><b className="text-foreground break-all">{email}</b>
                </div>
                {error && <Err text={error} />}
                <motion.button whileTap={{ scale: 0.98 }} onClick={sendCode} disabled={busy || !email}
                  className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50">
                  {busy ? <Spin /> : <><Mail className="w-4 h-4" /> Send code</>}
                </motion.button>
                <SecureNote>Up to 3 codes a day. Each code works once and only for a few minutes.</SecureNote>
              </>
            )}
            {step === 1 && (
              <>
                <SentToCard email={email} note="Check Spam or Promotions if you can't see it." />
                <OtpBoxes value={code} onChange={(v) => { setCode(v); if (error) setError(""); }} onComplete={(v) => void checkCode(v)} disabled={busy} error={!!error} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {meta && <CodeTimer expiresAt={meta.expiresAt} totalMs={meta.totalMs} now={now} />}
                  <span className="text-[11px] text-muted-foreground">or tap the email button</span>
                </div>
                {error && <Err text={error} />}
                <motion.button whileTap={{ scale: 0.98 }} onClick={() => checkCode()} disabled={busy || code.length !== 6}
                  className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50">
                  {busy ? <Spin /> : <><Check className="w-4 h-4" /> Continue</>}
                </motion.button>
                <div className="flex items-center justify-between">
                  <DailyPips left={meta?.dailyLeft ?? null} max={meta?.dailyMax ?? null} />
                  <ResendButton waitSec={wait} busy={busy} onClick={sendCode} dailyLeft={meta?.dailyLeft} />
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div className="flex items-center gap-2.5 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3.5 py-2.5 text-[11.5px]">
                  <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                  <span>{verified === "link" ? "Email confirmed with the button." : "Code accepted."} Choose a new password.</span>
                </div>
                <PwInput value={newPw} onChange={(v) => { setNewPw(v); setError(""); }} placeholder={`New password (min ${MIN})`} show={show} onToggle={() => setShow((s) => !s)} autoFocus />
                <PasswordStrength value={newPw} />
                <PwInput value={confirmPw} onChange={(v) => { setConfirmPw(v); setError(""); }} placeholder="Re-enter new password" show={show} mark={pwMatch} onEnter={submitReset} />
                {error && <Err text={error} />}
                <motion.button whileTap={{ scale: 0.98 }} onClick={submitReset} disabled={busy || !pwReady}
                  className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50">
                  {busy ? <Spin /> : <><KeyRound className="w-4 h-4" /> Save new password</>}
                </motion.button>
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
