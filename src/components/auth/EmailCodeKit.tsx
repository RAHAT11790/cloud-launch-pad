import { useEffect, useRef, useState } from "react";
import { Check, Clock3, RotateCcw, ShieldCheck } from "lucide-react";
import { formatWait } from "@/lib/emailService";

/**
 * Shared pieces for every "we emailed you a code" screen (sign-up, forgot
 * password, change password) so they look and behave the same everywhere.
 */

/** Six code boxes over one real input (keeps paste + SMS/Gmail autofill working). */
export function OtpBoxes({
  value, onChange, onComplete, disabled, error, success, autoFocus = true,
}: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void;
  disabled?: boolean; error?: boolean; success?: boolean; autoFocus?: boolean;
}) {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  const [focused, setFocused] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const lastDone = useRef("");
  useEffect(() => { if (error) setShakeKey((k) => k + 1); }, [error]);
  useEffect(() => {
    if (digits.length === 6 && digits !== lastDone.current && !disabled) { lastDone.current = digits; onComplete?.(digits); }
    if (digits.length < 6) lastDone.current = "";
  }, [digits, disabled, onComplete]);
  return (
    <label className="relative block" aria-label="6-digit code">
      <input
        value={digits}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        inputMode="numeric" autoComplete="one-time-code" autoFocus={autoFocus} maxLength={6} disabled={disabled}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0" aria-label="6-digit code"
      />
      <div key={shakeKey} className={`grid grid-cols-6 gap-2 ${error ? "otp-shake" : ""}`}>
        {Array.from({ length: 6 }).map((_, i) => {
          const filled = !!digits[i];
          const active = focused && i === Math.min(digits.length, 5) && !success;
          const tone = success ? "border-emerald-400/70 bg-emerald-400/10 text-foreground"
            : error ? "border-destructive/70 bg-destructive/10 text-foreground"
            : active ? "border-primary bg-primary/10 text-foreground ring-2 ring-primary/25"
            : filled ? "border-primary/60 bg-primary/10 text-foreground"
            : "border-border bg-secondary text-muted-foreground";
          return (
            <div key={i} className={`otp-box relative flex h-[52px] items-center justify-center rounded-xl border text-[22px] font-black tabular-nums transition-colors ${tone}`}>
              {digits[i] || ""}
              {active && !filled && <span className="otp-caret absolute h-6 w-[2px] rounded bg-primary" />}
            </div>
          );
        })}
      </div>
    </label>
  );
}

/** "Code valid 4:12" with a draining ring, turning red when it runs out. */
export function CodeTimer({ expiresAt, totalMs, now }: { expiresAt: number; totalMs: number; now: number }) {
  const left = Math.max(0, expiresAt - now);
  const frac = totalMs > 0 ? Math.min(1, left / totalMs) : 0;
  const r = 9, c = 2 * Math.PI * r;
  const expired = left <= 0;
  const low = !expired && left < 60_000;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${expired ? "text-destructive" : low ? "text-amber-400" : "text-muted-foreground"}`}>
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] -rotate-90" aria-hidden>
        <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
        <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: "stroke-dashoffset 1s linear" }} />
      </svg>
      {expired ? "Code expired" : <>Valid for <b className="tabular-nums text-foreground">{formatWait(Math.ceil(left / 1000))}</b></>}
    </span>
  );
}

/** Codes left today, as small pips: ●●○ 2 of 3 left. */
export function DailyPips({ left, max }: { left: number | null; max: number | null }) {
  if (left == null || !max) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Codes you can still request today">
      <span className="flex gap-[3px]">
        {Array.from({ length: max }).map((_, i) => (
          <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < left ? "bg-primary" : "bg-muted-foreground/30"}`} />
        ))}
      </span>
      <span><b className="text-foreground">{left}</b>/{max} today</span>
    </span>
  );
}

/** Resend button with its own countdown; shows when the next code can be asked. */
export function ResendButton({ waitSec, busy, onClick, dailyLeft }: { waitSec: number; busy?: boolean; onClick: () => void; dailyLeft?: number | null }) {
  const out = dailyLeft === 0;
  return (
    <button type="button" onClick={onClick} disabled={busy || waitSec > 0 || out}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold text-primary transition-colors hover:bg-primary/10 disabled:text-muted-foreground disabled:hover:bg-transparent">
      {waitSec > 0 ? <Clock3 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
      {out ? "No codes left today" : waitSec > 0 ? <>Resend in <span className="tabular-nums">{formatWait(waitSec)}</span></> : "Resend code"}
    </button>
  );
}

/** Where the email went + what to look for. */
export function SentToCard({ email, note }: { email: string; note?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.07] px-3.5 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl gradient-primary">
        <Check className="h-4.5 w-4.5 text-primary-foreground" />
      </span>
      <span className="min-w-0 text-[11.5px] leading-snug text-muted-foreground">
        Code sent to
        <b className="block truncate text-[13px] text-foreground">{email}</b>
        {note && <span className="block text-[10.5px]">{note}</span>}
      </span>
    </div>
  );
}

/** 0–4 password score with a label. */
export function passwordScore(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "" };
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  else if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s += 0.5;
  const score = Math.max(1, Math.min(4, Math.floor(s)));
  return { score, label: ["", "Weak", "Okay", "Good", "Strong"][score] };
}
export function PasswordStrength({ value }: { value: string }) {
  const { score, label } = passwordScore(value);
  if (!value) return null;
  const color = score <= 1 ? "bg-destructive" : score === 2 ? "bg-amber-400" : score === 3 ? "bg-primary" : "bg-emerald-400";
  return (
    <div className="flex items-center gap-2 px-1" aria-live="polite">
      <div className="grid flex-1 grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((i) => <span key={i} className={`h-1 rounded-full transition-colors ${i <= score ? color : "bg-muted-foreground/20"}`} />)}
      </div>
      <span className="w-12 text-right text-[10.5px] font-semibold text-muted-foreground">{label}</span>
    </div>
  );
}

/** 1 — 2 — 3 step header. */
export function StepDots({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {steps.map((s, i) => {
        const done = i < current, on = i === current;
        return (
          <li key={s} className="flex flex-1 items-center gap-1.5">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-black transition-colors ${
              done ? "gradient-primary text-primary-foreground" : on ? "border-2 border-primary text-primary" : "border border-border text-muted-foreground"}`}>
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={`truncate text-[10.5px] font-semibold ${on ? "text-foreground" : "text-muted-foreground"}`}>{s}</span>
            {i < steps.length - 1 && <span className={`h-px flex-1 ${done ? "bg-primary" : "bg-border"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export function SecureNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[10.5px] leading-relaxed text-muted-foreground">
      <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
      <span>{children}</span>
    </p>
  );
}
