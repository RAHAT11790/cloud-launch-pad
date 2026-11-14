import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Lock, Eye, EyeOff, LogIn, Mail, AlertTriangle, Smartphone, ArrowLeft, KeyRound, Check } from "lucide-react";
import logoImg from "@/assets/logo.png";
import { db, auth, googleProvider, ref, set, get, update, remove, signInWithPopup } from "@/lib/firebase";
import { ensureGuestUser, transferGuestCoinsToUser } from "@/lib/premiumAccess";
import { firebaseRestGet } from "@/lib/firebaseRest";
import { toast } from "sonner";
import { SITE_NAME, TELEGRAM_ADMIN_URL } from "@/lib/siteConfig";
import { useBranding } from "@/hooks/useBranding";
import { buildEmailAliasKey, writeDisplayName, writeProfilePhoto } from "@/lib/localUser";
import {
  isAllowedEmail, normalizeEmail, emailCanonicalKey, sendEmailCode, verifyEmailCode,
  subscribeLoginAccess, loginAccessNow, allowedDomainsLabel, type LoginAccess,
  savePendingRegister, readPendingRegister, clearPendingRegister, cooldownLeftMs,
  resendEmailCode, claimEmailLink, takeVerifyRedirect, ticketRid, EmailServiceError,
  savePendingReset, readPendingReset, clearPendingReset,
} from "@/lib/emailService";
import { useEmailLinkWatch } from "@/hooks/useEmailLinkWatch";
import { OtpBoxes, PasteCodeButton, CodeTimer, DailyPips, ResendButton, SentToCard, PasswordStrength, StepDots, SecureNote } from "@/components/auth/EmailCodeKit";

type CodeMeta = { expiresAt: number; totalMs: number; dailyLeft: number | null; dailyMax: number | null };
const metaOf = (t: { expiresAt: number; dailyLeft: number | null; dailyMax: number | null }): CodeMeta =>
  ({ expiresAt: t.expiresAt, totalMs: Math.max(60_000, t.expiresAt - Date.now()), dailyLeft: t.dailyLeft, dailyMax: t.dailyMax });

interface LoginPageProps {
  onLogin: (userId: string) => void;
  onGuest?: () => void;
}

const PARTICLE_SEEDS = Array.from({ length: 0 }, (_, i) => ({
  id: i,
  x: ((i * 73) % 100) / 100,
  y: ((i * 47) % 100) / 100,
  scale: 0.55 + ((i * 19) % 45) / 100,
  duration: 3.2 + ((i * 13) % 35) / 10,
  delay: ((i * 11) % 20) / 10,
}));

const StaticFloatingParticles = () => {
  const particles = useMemo(() => PARTICLE_SEEDS, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((particle) => (
        <motion.div
          key={particle.id}
          className="absolute w-1 h-1 rounded-full bg-primary/30"
          initial={{
            x: particle.x * 400,
            y: particle.y * 800,
            scale: particle.scale,
          }}
          animate={{
            y: [null, -100],
            opacity: [0, 0.8, 0],
          }}
          transition={{
            duration: particle.duration,
            repeat: Infinity,
            delay: particle.delay,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
};

const Spinner = () => <span className="animate-spin w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full" />;
const InlineError = ({ text }: { text: string }) => (
  <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-foreground">
    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-px" />
    <span>{text}</span>
  </div>
);

const LoginPage = ({ onLogin, onGuest }: LoginPageProps) => {
  const SESSION_STARTED_AT_KEY = "rs_session_started_at";
  const branding = useBranding();
  const logoSrc = branding.logoUrl || logoImg;
  const [isRegister, setIsRegister] = useState(false);
  const [access, setAccess] = useState<LoginAccess>(loginAccessNow);
  useEffect(() => subscribeLoginAccess(setAccess), []);
  const domainsText = allowedDomainsLabel(access.allowedDomains);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showContent, setShowContent] = useState(true);
  const [deviceLimitError, setDeviceLimitError] = useState<{
    message: string;
    deviceNames: string[];
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Google password set flow states
  const [googleSetPwMode, setGoogleSetPwMode] = useState(false);
  const [googlePw, setGooglePw] = useState("");
  const [googlePwConfirm, setGooglePwConfirm] = useState("");
  const [showGooglePw, setShowGooglePw] = useState(false);
  const [showGooglePwConfirm, setShowGooglePwConfirm] = useState(false);
  const [googlePendingData, setGooglePendingData] = useState<any>(null);

  // Forgot password states (OTP-based)
  const [showForgotPw, setShowForgotPw] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotOtpSent, setForgotOtpSent] = useState(false);
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotNewPw, setForgotNewPw] = useState("");
  const [forgotNewPwConfirm, setForgotNewPwConfirm] = useState("");
  const [forgotToken, setForgotToken] = useState("");
  /** "link" = the email button was tapped (claim on submit); "claimed" = already claimed on this device via the link page. */
  const [forgotLinkState, setForgotLinkState] = useState<"" | "link" | "claimed">("");
  const [forgotResendLeft, setForgotResendLeft] = useState(0);
  const [forgotMeta, setForgotMeta] = useState<CodeMeta | null>(null);
  const [forgotError, setForgotError] = useState("");
  const [showForgotPwText, setShowForgotPwText] = useState(false);
  const [verifyMeta, setVerifyMeta] = useState<CodeMeta | null>(null);

  // Sign-up email verification
  const [verifyPending, setVerifyPending] = useState<{ name: string; email: string; password: string; token: string; expiresAt: number; linkExpiresAt?: number } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resendLeft, setResendLeft] = useState(0);
  const [linkNotice, setLinkNotice] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const linkHandledRef = useRef(false);
  const finishingRef = useRef(false);

  const syncCanonicalUserNode = async (userId: string, payload: Record<string, any>, email?: string) => {
    const aliasKey = buildEmailAliasKey(email);
    let safePayload = { ...payload };
    const incomingPhoto = String(safePayload.profilePhoto || safePayload.photoUrl || safePayload.avatar || "").trim();
    if (!incomingPhoto) {
      const paths = [`users/${userId}`, aliasKey ? `users/${aliasKey}` : "", aliasKey ? `appUsers/${aliasKey}` : ""].filter(Boolean);
      for (const path of paths) {
        try {
          const snap = await get(ref(db, path));
          const data = snap.val() || {};
          const existingPhoto = String(data.profilePhoto || data.photoUrl || data.avatar || "").trim();
          if (existingPhoto) {
            safePayload = { ...safePayload, profilePhoto: existingPhoto, photoUrl: existingPhoto, avatar: existingPhoto };
            break;
          }
        } catch {}
      }
    }
    const writes: Promise<any>[] = [
      update(ref(db, `users/${userId}`), safePayload).catch(() => {}),
    ];
    if (aliasKey) {
      writes.push(update(ref(db, `users/${aliasKey}`), { ...safePayload, id: userId }).catch(() => {}));
    }
    await Promise.all(writes);
  };

  // Keep login instant and typing smooth — no delayed intro/audio work.
  useEffect(() => {
    setShowContent(true);
    return () => { audioRef.current?.pause(); };
  }, []);

  const checkAndRegisterDevice = async (userId: string): Promise<boolean> => {
    try {
      const { checkDeviceLimitForLogin, registerDeviceOnLogin } = await import("@/lib/premiumDevice");
      const result = await checkDeviceLimitForLogin(userId);
      if (!result.allowed) {
        setDeviceLimitError({
          message: result.reason || "Device limit reached!",
          deviceNames: result.registeredDeviceNames || [],
        });
        return false;
      }
      await registerDeviceOnLogin(userId);
      return true;
    } catch {
      return true;
    }
  };

  /** Plain words for Google sign-in failures (null = the viewer closed it themselves). */
  const googleErrorText = (code?: string, message?: string): string | null => {
    switch (code) {
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
      case "auth/user-cancelled":
        return null;
      case "auth/popup-blocked":
        return "Your browser blocked the Google window. Allow pop-ups for this site, then tap Continue with Google again.";
      case "auth/unauthorized-domain":
        return `Google sign-in isn't allowed on ${window.location.hostname} yet. Please use ${"rsanime03.lovable.app"} or sign in with email.`;
      case "auth/network-request-failed":
        return "No connection to Google. Check your internet and try again.";
      case "auth/operation-not-supported-in-this-environment":
      case "auth/web-storage-unsupported":
        return "This browser can't open Google sign-in. Open the site in Chrome, or sign in with email.";
      case "auth/too-many-requests":
        return "Too many tries. Please wait a minute and try again.";
      case "auth/internal-error":
        return "Google sign-in had a problem. Please try again.";
      default:
        return "Google sign-in failed: " + (message || code || "unknown error");
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setDeviceLimitError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const gEmail = user.email || "";
      if (!isAllowedEmail(gEmail, access.allowedDomains)) {
        try { await auth.signOut(); } catch {}
        toast.error(`Only ${domainsText} accounts are allowed.`);
        setLoading(false);
        return;
      }
      const gName = user.displayName || gEmail.split("@")[0];
      const gPhoto = user.photoURL || "";
      const commaKey = gEmail.toLowerCase().replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");

      let existingData: any = null;
      const keysToTry = [commaKey, gEmail.toLowerCase().replace(/[^a-z0-9]/g, "_")];
      const nodesToSearch = ['appUsers', 'users'];

      for (const node of nodesToSearch) {
        if (existingData) break;
        for (const key of keysToTry) {
          try {
            const snap = await get(ref(db, `${node}/${key}`));
            if (snap.exists()) {
              existingData = snap.val();
              break;
            }
          } catch (e) {}
        }
      }

      const uid = existingData?.id || "user_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);

      // Check if user already has a password set
      if (existingData?.password) {
        // User already has password, proceed normally
        const deviceOk = await checkAndRegisterDevice(uid);
        if (!deviceOk) { setLoading(false); return; }

        await set(ref(db, `appUsers/${commaKey}`), {
          ...existingData,
          id: uid, name: gName, email: gEmail, googleAuth: true,
          createdAt: existingData?.createdAt || Date.now(),
        });
        try {
          await syncCanonicalUserNode(uid, {
            name: gName,
            email: gEmail,
            online: true,
            authProvider: "google",
            googleAuth: true,
            lastSeen: Date.now(),
            createdAt: existingData?.createdAt || Date.now(),
            profilePhoto: gPhoto || existingData?.profilePhoto || existingData?.photoUrl || existingData?.avatar || "",
            photoUrl: gPhoto || existingData?.photoUrl || existingData?.profilePhoto || existingData?.avatar || "",
            avatar: gPhoto || existingData?.avatar || existingData?.profilePhoto || existingData?.photoUrl || "",
          }, gEmail);
        } catch (e) {}

        try { const prev = JSON.parse(localStorage.getItem("rsanime_user") || "null"); if (prev?.id && prev.id !== uid) { const r = await transferGuestCoinsToUser(prev.id, uid); if (r.transferred > 0) toast.success(`✨ ${r.transferred} guest coins transferred to your account`); } } catch {}
        localStorage.setItem("rsanime_user", JSON.stringify({ id: uid, name: gName, email: gEmail })); try { window.dispatchEvent(new Event("rs_auth_changed")); } catch {}
        localStorage.setItem(SESSION_STARTED_AT_KEY, Date.now().toString());
        writeDisplayName(gName, uid);
        if (gPhoto) writeProfilePhoto(gPhoto, uid);
        toast.success(`Welcome, ${gName}!`);
        onLogin(uid);
      } else {
        // No password set - show password set screen
        setGooglePendingData({
          uid, gName, gEmail, gPhoto, commaKey, existingData,
        });
        setGoogleSetPwMode(true);
      }
    } catch (err: any) {
      const msg = googleErrorText(err?.code, err?.message);
      if (msg) toast.error(msg, { duration: 7000 });
    }
    setLoading(false);
  };

  const handleGooglePasswordSet = async () => {
    if (!googlePw.trim()) { toast.error("Please enter a password"); return; }
    if (googlePw.length < 4) { toast.error("Password must be at least 4 characters"); return; }
    if (googlePw !== googlePwConfirm) { toast.error("Passwords don't match!"); return; }

    setLoading(true);
    try {
      const { uid, gName, gEmail, gPhoto, commaKey, existingData } = googlePendingData;

      const deviceOk = await checkAndRegisterDevice(uid);
      if (!deviceOk) { setLoading(false); return; }

      await set(ref(db, `appUsers/${commaKey}`), {
        id: uid, name: gName, email: gEmail, googleAuth: true,
        password: googlePw,
        createdAt: existingData?.createdAt || Date.now(),
      });
      try {
        await syncCanonicalUserNode(uid, {
          name: gName,
          email: gEmail,
          online: true,
          authProvider: "google",
          googleAuth: true,
          lastSeen: Date.now(),
          createdAt: existingData?.createdAt || Date.now(),
          profilePhoto: gPhoto || existingData?.profilePhoto || existingData?.photoUrl || existingData?.avatar || "",
          photoUrl: gPhoto || existingData?.photoUrl || existingData?.profilePhoto || existingData?.avatar || "",
          avatar: gPhoto || existingData?.avatar || existingData?.profilePhoto || existingData?.photoUrl || "",
        }, gEmail);
      } catch (e) {}

      try { const prev = JSON.parse(localStorage.getItem("rsanime_user") || "null"); if (prev?.id && prev.id !== uid) { const r = await transferGuestCoinsToUser(prev.id, uid); if (r.transferred > 0) toast.success(`✨ ${r.transferred} guest coins transferred to your account`); } } catch {}
        localStorage.setItem("rsanime_user", JSON.stringify({ id: uid, name: gName, email: gEmail })); try { window.dispatchEvent(new Event("rs_auth_changed")); } catch {}
      localStorage.setItem(SESSION_STARTED_AT_KEY, Date.now().toString());
      writeDisplayName(gName, uid);
      if (gPhoto) writeProfilePhoto(gPhoto, uid);
      toast.success(`Welcome, ${gName}! Password set successfully ✅`);
      setGoogleSetPwMode(false);
      setGooglePendingData(null);
      onLogin(uid);
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    const fEmail = normalizeEmail(forgotEmail);
    if (!fEmail) { toast.error("Please enter your email"); return; }
    if (!isAllowedEmail(fEmail, access.allowedDomains)) { toast.error(`Only ${domainsText} addresses are allowed.`); return; }
    setForgotLoading(true);
    try {
      const emailKey = fEmail.replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
      const snap = await get(ref(db, `appUsers/${emailKey}`));
      if (!snap.exists()) {
        toast.error("No account found with this email!");
        setForgotLoading(false);
        return;
      }
      const t = await sendEmailCode(fEmail, "reset", snap.val()?.name || "");
      setForgotToken(t.token);
      setForgotMeta(metaOf(t));
      setForgotError("");
      setForgotLinkState("");
      setForgotOtp("");
      savePendingReset({ email: fEmail, token: t.token, expiresAt: t.expiresAt, linkExpiresAt: t.linkExpiresAt });
      setForgotOtpSent(true);
      toast.success(`📧 Code sent to: ${fEmail}`);
    } catch (err: any) {
      setForgotError(err.message || "Could not send the code");
    }
    setForgotLoading(false);
  };

  const resetForgotState = () => {
    setShowForgotPw(false); setForgotOtpSent(false); setForgotOtp(""); setForgotToken("");
    setForgotNewPw(""); setForgotNewPwConfirm(""); setForgotEmail(""); setForgotLinkState("");
    setForgotMeta(null); setForgotError("");
    clearPendingReset();
  };

  /** Step 2 → checks the code right away (single use), then asks for the new password. */
  const confirmForgotCode = async (codeArg?: string) => {
    const code = String(codeArg ?? forgotOtp).replace(/\D/g, "");
    if (code.length !== 6 || forgotLoading) return;
    setForgotLoading(true); setForgotError("");
    try {
      const r = await verifyEmailCode(forgotToken, code);
      if (r.email !== normalizeEmail(forgotEmail) || r.purpose !== "reset") throw new Error("This code belongs to another email.");
      setForgotLinkState("claimed");
      clearPendingReset();
    } catch (err: any) {
      setForgotError(err?.message || "Incorrect code.");
      setForgotOtp("");
    }
    setForgotLoading(false);
  };

  const resendForgotCode = async () => {
    if (!forgotToken || forgotResendLeft > 0) return;
    setForgotLoading(true);
    try {
      const fEmail = normalizeEmail(forgotEmail);
      let t;
      try { t = await resendEmailCode(forgotToken, fEmail); }
      catch (err) {
        if (err instanceof EmailServiceError && ["not_found", "bad_ticket", "already_used"].includes(err.code)) t = await sendEmailCode(fEmail, "reset");
        else throw err;
      }
      setForgotToken(t.token); setForgotOtp(""); setForgotLinkState(""); setForgotMeta(metaOf(t)); setForgotError("");
      savePendingReset({ email: fEmail, token: t.token, expiresAt: t.expiresAt, linkExpiresAt: t.linkExpiresAt });
      toast.success("📧 New code sent");
    } catch (err: any) { setForgotError(err.message || "Could not send the code"); }
    setForgotLoading(false);
  };

  // The email's "Reset Password" button was tapped (any device) → no code needed here.
  useEmailLinkWatch(showForgotPw && forgotOtpSent && !forgotLinkState ? forgotToken : null, () => {
    setForgotLinkState("link");
    toast.success("✅ Email confirmed — now set your new password");
  });

  useEffect(() => {
    if (!showForgotPw || !forgotOtpSent) return;
    const tick = () => { setForgotResendLeft(Math.ceil(cooldownLeftMs(forgotEmail) / 1000)); setNowTick(Date.now()); };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [showForgotPw, forgotOtpSent, forgotEmail, forgotToken]);

  const handleResetPasswordWithOtp = async () => {
    if ((!forgotLinkState && forgotOtp.replace(/\D/g, "").length !== 6) || !forgotNewPw.trim()) { toast.error(forgotLinkState ? "Enter a new password" : "Enter the 6-digit code and a new password"); return; }
    if (forgotNewPw.length < 6) { setForgotError("Password must be at least 6 characters"); return; }
    if (forgotNewPw !== forgotNewPwConfirm) { setForgotError("Passwords don't match"); return; }

    setForgotLoading(true);
    try {
      const fEmail = normalizeEmail(forgotEmail);
      const result = forgotLinkState === "claimed"
        ? { email: fEmail, purpose: "reset" as const }
        : forgotLinkState === "link"
          ? await claimEmailLink(forgotToken)
          : await verifyEmailCode(forgotToken, forgotOtp);
      if (result.email !== fEmail || result.purpose !== "reset") { toast.error("❌ Incorrect code!"); setForgotLoading(false); return; }
      const emailKey = fEmail.replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
      const snap = await get(ref(db, `appUsers/${emailKey}`));
      if (!snap.exists()) { toast.error("Account not found"); setForgotLoading(false); return; }

      await set(ref(db, `appUsers/${emailKey}/password`), forgotNewPw.trim());
      await set(ref(db, `passwordResets/${emailKey}_${Date.now()}`), {
        email: fEmail, name: snap.val()?.name || "", timestamp: Date.now(), method: "email-service",
      });

      toast.success("✅ New password set! You can now login.");
      resetForgotState();
    } catch (err: any) {
      setForgotError(err.message || "Error");
      if (err instanceof EmailServiceError && ["already_used", "replaced", "locked", "expired", "not_found"].includes(err.code)) {
        setForgotOtpSent(false); setForgotOtp(""); setForgotToken(""); setForgotLinkState(""); clearPendingReset();
      }
    }
    setForgotLoading(false);
  };

  /** Creates the account — only ever called after the email code was verified. */
  const createVerifiedAccount = async (formName: string, formEmailRaw: string, formPassword: string) => {
    const formEmail = normalizeEmail(formEmailRaw);
    const emailKey = formEmail.replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
    const canonical = emailCanonicalKey(formEmail);
    const [taken, canon] = await Promise.all([
      get(ref(db, `appUsers/${emailKey}`)).catch(() => null),
      get(ref(db, `gmailRegistry/${canonical}`)).catch(() => null),
    ]);
    if (taken?.exists() || canon?.exists()) { toast.error("This email already has an account. Please sign in."); return false; }
    const userId = "user_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
    await registerDeviceAfterLogin(userId);
    await set(ref(db, `appUsers/${emailKey}`), {
      id: userId, name: formName, email: formEmail, password: formPassword, createdAt: Date.now(), emailVerified: true,
    });
    await set(ref(db, `gmailRegistry/${canonical}`), userId).catch(() => {});
    await syncCanonicalUserNode(userId, {
      id: userId, name: formName, email: formEmail, createdAt: Date.now(),
      online: true, lastSeen: Date.now(), authProvider: "email", emailVerified: true,
    }, formEmail);
    try { const prev = JSON.parse(localStorage.getItem("rsanime_user") || "null"); if (prev?.id && prev.id !== userId) { const r = await transferGuestCoinsToUser(prev.id, userId); if (r.transferred > 0) toast.success(`✨ ${r.transferred} guest coins transferred to your account`); } } catch {}
    localStorage.setItem("rsanime_user", JSON.stringify({ id: userId, name: formName, email: formEmail })); try { window.dispatchEvent(new Event("rs_auth_changed")); } catch {}
    localStorage.setItem(SESSION_STARTED_AT_KEY, Date.now().toString());
    writeDisplayName(formName, userId);
    clearPendingRegister();
    toast.success("✅ Email verified — account created!");
    onLogin(userId);
    return true;
  };

  /** Ends the sign-up screen when the request can no longer be used. */
  const dropDeadRequest = (err: unknown) => {
    if (err instanceof EmailServiceError && ["already_used", "replaced", "locked", "expired", "not_found", "bad_ticket"].includes(err.code)) {
      setVerifyError(err.code === "locked" || err.code === "expired" ? `${err.message} Tap “Resend code”.` : err.message);
      return true;
    }
    return false;
  };

  const submitVerifyCode = async (codeArg?: string, pendingArg?: typeof verifyPending) => {
    const pending = pendingArg || verifyPending;
    const code = String(codeArg ?? verifyCode).replace(/\D/g, "");
    if (!pending || finishingRef.current) return;
    if (code.length !== 6) { toast.error("Enter the 6-digit code"); return; }
    finishingRef.current = true;
    setVerifyLoading(true);
    setVerifyError("");
    try {
      const r = await verifyEmailCode(pending.token, code);
      if (r.email !== normalizeEmail(pending.email) || r.purpose !== "register") throw new Error("Incorrect code.");
      await createVerifiedAccount(pending.name, pending.email, pending.password);
    } catch (err: any) {
      if (!dropDeadRequest(err)) setVerifyError(err.message || "Incorrect code.");
      setVerifyCode("");
    }
    finishingRef.current = false;
    setVerifyLoading(false);
  };

  /** The email's "Verify Email" button was tapped → finish here, no code typing needed. */
  const finishByLink = async (pending: NonNullable<typeof verifyPending>) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setVerifyLoading(true);
    setVerifyError("");
    try {
      const r = await claimEmailLink(pending.token);
      if (r.email !== normalizeEmail(pending.email) || r.purpose !== "register") throw new Error("This link belongs to another email.");
      await createVerifiedAccount(pending.name, pending.email, pending.password);
    } catch (err: any) {
      // Another tab of this browser may have just finished it.
      let done = false;
      try { done = normalizeEmail(JSON.parse(localStorage.getItem("rsanime_user") || "null")?.email || "") === normalizeEmail(pending.email); } catch {}
      if (done) { clearPendingRegister(); window.location.reload(); return; }
      if (!dropDeadRequest(err)) setVerifyError(err.message || "Could not finish sign-up.");
    }
    finishingRef.current = false;
    setVerifyLoading(false);
  };

  const resendVerifyCode = async () => {
    if (!verifyPending || resendLeft > 0) return;
    setVerifyLoading(true);
    try {
      let t;
      try { t = await resendEmailCode(verifyPending.token, verifyPending.email); }
      catch (err) {
        // The old request is gone (expired/used) → start a fresh one for the same email.
        if (err instanceof EmailServiceError && ["not_found", "bad_ticket", "already_used"].includes(err.code)) t = await sendEmailCode(verifyPending.email, "register", verifyPending.name);
        else throw err;
      }
      const next = { ...verifyPending, token: t.token, expiresAt: t.expiresAt, linkExpiresAt: t.linkExpiresAt };
      setVerifyMeta(metaOf(t));
      setVerifyPending(next);
      savePendingRegister(next);
      setVerifyCode("");
      setVerifyError("");
      toast.success("📧 New code sent");
    } catch (err: any) { setVerifyError(err.message); }
    setVerifyLoading(false);
  };

  useEmailLinkWatch(verifyPending && !verifyError ? verifyPending.token : null, () => {
    if (verifyPending) void finishByLink(verifyPending);
  });

  // Resend + expiry countdown
  useEffect(() => {
    if (!verifyPending) return;
    const tick = () => { setResendLeft(Math.ceil(cooldownLeftMs(verifyPending.email) / 1000)); setNowTick(Date.now()); };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [verifyPending]);

  // Coming back from the email's button: /?ev=<request>&eg=<grant>&ep=register|reset
  useEffect(() => {
    if (linkHandledRef.current) return;
    linkHandledRef.current = true;
    const back = takeVerifyRedirect();
    const savedReg = readPendingRegister();
    if (!back) { if (savedReg) setVerifyPending(savedReg); return; }
    if (back.purpose === "register") {
      if (savedReg && ticketRid(savedReg.token) === back.rid) {
        setVerifyPending(savedReg);
        void finishByLink(savedReg);
      } else {
        if (savedReg) setVerifyPending(savedReg);
        setLinkNotice("Your email is verified ✓. Go back to the app or browser where you started signing up — it finishes there automatically.");
      }
      return;
    }
    // Password reset
    const savedReset = readPendingReset();
    setShowForgotPw(true);
    if (savedReset && ticketRid(savedReset.token) === back.rid) {
      setForgotEmail(savedReset.email); setForgotToken(savedReset.token);
      setForgotOtpSent(true); setForgotLinkState("link");
      toast.success("✅ Email confirmed — now set your new password");
      return;
    }
    claimEmailLink(back.rid, back.grant).then((r) => {
      setForgotEmail(r.email); setForgotToken("");
      setForgotOtpSent(true); setForgotLinkState("claimed");
      toast.success("✅ Email confirmed — now set your new password");
    }).catch((err) => toast.error(err?.message || "This link can't be used any more. Ask for a new code."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeviceLimitError(null);
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const formEmail = String(formData.get("email") || "").trim();
    const formName = String(formData.get("name") || "").trim();
    const formPassword = String(formData.get("password") || "");
    const loginInput = isRegister ? formEmail : formName;
    if (!loginInput || !formPassword.trim()) { toast.error("Please fill in all fields"); return; }
    if (isRegister && !formName) { toast.error("Please enter a username"); return; }
    if (isRegister && !isAllowedEmail(formEmail, access.allowedDomains)) { toast.error(`Only real ${domainsText} addresses can sign up.`); return; }
    if (isRegister && formPassword.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (!isRegister && formPassword.length < 4) { toast.error("Password must be at least 4 characters"); return; }

    setLoading(true);
    try {
      const input = loginInput;
      const inputLower = input.toLowerCase();
      const commaKey = inputLower.replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
      const legacyKey = inputLower.replace(/[^a-z0-9]/g, "_");
      const dotKey = inputLower.replace(/[^a-z0-9@._-]/g, "_");
      const nodesToSearch = ['appUsers', 'users'];
      const keysToTry = [...new Set([commaKey, legacyKey, dotKey])];
      const allMatches: any[] = [];

      for (const node of nodesToSearch) {
        for (const keyAttempt of keysToTry) {
          try {
            const kRef = ref(db, `${node}/${keyAttempt}`);
            const kSnap = await get(kRef);
            if (kSnap.exists()) { allMatches.push({ node, key: keyAttempt, data: kSnap.val() }); }
          } catch (e: any) {}
        }
      }

      if (allMatches.length === 0 && !isRegister) {
        // Login by username: scan the small appUsers list first and the big
        // users list only when needed, over plain HTTPS (a multi-MB read on
        // the live socket froze sign-in on phones).
        for (const node of nodesToSearch) {
          if (allMatches.some((m) => m.data?.password)) break;
          try {
            let allData: any = await firebaseRestGet<any>(node).catch(() => undefined);
            if (allData === undefined) { const allSnap = await get(ref(db, node)); allData = allSnap.exists() ? allSnap.val() : null; }
            if (allData && typeof allData === "object") {
              for (const key of Object.keys(allData)) {
                const u = allData[key];
                if (u && typeof u === 'object') {
                  const nameMatch = u.name && u.name.toLowerCase() === inputLower;
                  const emailMatch = u.email && u.email.toLowerCase() === inputLower;
                  if (nameMatch || emailMatch) { allMatches.push({ node, key, data: u }); }
                }
              }
            }
          } catch (e: any) {}
        }
      }

      const withPassword = allMatches.find(m => m.data?.password);
      const withId = allMatches.find(m => m.data?.id);
      const anyMatch = allMatches[0];
      let finalUserData: any = null;
      let finalUserId: string = "";

      if (anyMatch) {
        finalUserData = { ...anyMatch.data };
        if (withPassword) finalUserData.password = withPassword.data.password;
        if (withId) finalUserData.id = withId.data.id;
        if (!finalUserData.name && anyMatch.data.name) finalUserData.name = anyMatch.data.name;
        finalUserId = finalUserData.id || "";
      }

      if (isRegister) {
        if (anyMatch) { toast.error("This email/username is already taken!"); setLoading(false); return; }
        const canon = await get(ref(db, `gmailRegistry/${emailCanonicalKey(formEmail)}`)).catch(() => null);
        if (canon?.exists()) { toast.error("This email already has an account. Please sign in."); setLoading(false); return; }
        const t = await sendEmailCode(formEmail, "register", formName);
        const pending = { name: formName, email: normalizeEmail(formEmail), password: formPassword, token: t.token, expiresAt: t.expiresAt, linkExpiresAt: t.linkExpiresAt };
        savePendingRegister(pending);
        setVerifyCode("");
        setVerifyError("");
        setVerifyMeta(metaOf(t));
        setVerifyPending(pending);
        toast.success(`📧 Verification code sent to ${pending.email}`);
      } else {
        if (!anyMatch) { toast.error("User not found!"); setLoading(false); return; }
        if (finalUserData.password && finalUserData.password !== formPassword) { toast.error("Wrong password!"); setLoading(false); return; }

        const uid = finalUserId || commaKey;
        const deviceOk = await checkAndRegisterDevice(uid);
        if (!deviceOk) {
          setLoading(false);
          return;
        }

        if (!finalUserData.password) {
          try {
            await set(ref(db, `appUsers/${commaKey}`), {
              id: finalUserId || commaKey, name: finalUserData.name || input,
              password: formPassword, createdAt: finalUserData.createdAt || Date.now(),
            });
          } catch (e) {}
        }
        const displayName = finalUserData.name || input;
        const loginEmail = finalUserData.email || (input.includes("@") ? input : "");
        try { const prev = JSON.parse(localStorage.getItem("rsanime_user") || "null"); if (prev?.id && prev.id !== uid) { const r = await transferGuestCoinsToUser(prev.id, uid); if (r.transferred > 0) toast.success(`✨ ${r.transferred} guest coins transferred to your account`); } } catch {}
        localStorage.setItem("rsanime_user", JSON.stringify({ id: uid, name: displayName, email: loginEmail })); try { window.dispatchEvent(new Event("rs_auth_changed")); } catch {}
        localStorage.setItem(SESSION_STARTED_AT_KEY, Date.now().toString());
        writeDisplayName(displayName, uid);
        try {
          await syncCanonicalUserNode(uid, {
            name: displayName, email: loginEmail, online: true, lastSeen: Date.now(), authProvider: "email",
            profilePhoto: finalUserData.profilePhoto || finalUserData.photoUrl || finalUserData.avatar || "",
            photoUrl: finalUserData.photoUrl || finalUserData.profilePhoto || finalUserData.avatar || "",
            avatar: finalUserData.avatar || finalUserData.profilePhoto || finalUserData.photoUrl || "",
          }, loginEmail);
          const currentPhoto = String(finalUserData.profilePhoto || finalUserData.photoUrl || finalUserData.avatar || "").trim();
          if (currentPhoto) {
            writeProfilePhoto(currentPhoto, uid);
          }
        } catch (e) {}
        toast.success(`Welcome back, ${displayName}!`);
        onLogin(uid);
      }
    } catch (err: any) { toast.error(err?.message || "Something went wrong"); }
    setLoading(false);
  };

  const registerDeviceAfterLogin = async (userId: string) => {
    try {
      const { registerDeviceOnLogin } = await import("@/lib/premiumDevice");
      await registerDeviceOnLogin(userId);
    } catch {}
  };

  // ======= GOOGLE PASSWORD SET SCREEN =======
  if (googleSetPwMode && googlePendingData) {
    return (
      <motion.div
        className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div
            className="absolute top-[-30%] left-[-20%] w-[80%] h-[80%] rounded-full"
            style={{ background: "radial-gradient(circle, hsla(176,65%,48%,0.08) 0%, transparent 70%)" }}
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
        <StaticFloatingParticles />

        <motion.div className="relative z-10 w-full max-w-[360px] px-5"
          initial={{ y: 40, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="relative">
            <motion.div
              className="absolute -inset-[2px] rounded-3xl opacity-60"
              style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)), hsl(var(--primary)))" }}
              animate={{ backgroundPosition: ["0% 50%", "200% 50%"] }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            />
            <div className="relative glass-card-strong p-6 rounded-3xl overflow-hidden">
              <motion.div className="text-center mb-5"
                initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              >
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-primary/20 flex items-center justify-center">
                  <KeyRound className="w-7 h-7 text-primary" />
                </div>
                <h2 className="text-xl font-black text-primary" style={{ fontFamily: "'Russo One', sans-serif" }}>
                  Set Your Password
                </h2>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Hello {googlePendingData.gName}! Please set a password first
                </p>
              </motion.div>

              <div className="space-y-3">
                <div>
                  <label className="login-field-label text-xs text-muted-foreground mb-1.5 block">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type={showGooglePw ? "text" : "password"}
                      placeholder="Enter password"
                      value={googlePw}
                      onChange={e => setGooglePw(e.target.value)}
                      className="w-full py-3 pl-10 pr-10 rounded-xl login-input bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground"
                      style={{ boxShadow: "var(--neu-shadow-inset)" }}
                    />
                    <button type="button" onClick={() => setShowGooglePw(!showGooglePw)} className="absolute right-3.5 top-1/2 -translate-y-1/2">
                      {showGooglePw ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="login-field-label text-xs text-muted-foreground mb-1.5 block">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type={showGooglePwConfirm ? "text" : "password"}
                      placeholder="Re-enter password"
                      value={googlePwConfirm}
                      onChange={e => setGooglePwConfirm(e.target.value)}
                      className="w-full py-3 pl-10 pr-10 rounded-xl login-input bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground"
                      style={{ boxShadow: "var(--neu-shadow-inset)" }}
                    />
                    <button type="button" onClick={() => setShowGooglePwConfirm(!showGooglePwConfirm)} className="absolute right-3.5 top-1/2 -translate-y-1/2">
                      {showGooglePwConfirm ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                </div>

                {googlePw && googlePwConfirm && googlePw === googlePwConfirm && (
                  <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-2 text-xs text-green-500">
                    <Check className="w-3.5 h-3.5" /> Passwords match
                  </motion.div>
                )}
                {googlePw && googlePwConfirm && googlePw !== googlePwConfirm && (
                  <p className="text-xs text-destructive">Passwords don't match!</p>
                )}

                <motion.button
                  onClick={handleGooglePasswordSet}
                  disabled={loading || !googlePw || !googlePwConfirm}
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50 transition-all mt-2"
                >
                  {loading ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> : <><LogIn className="w-4 h-4" /> Login</>}
                </motion.button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  // ======= FORGOT PASSWORD SCREEN =======
  if (showForgotPw) {
    const step = !forgotOtpSent ? 0 : forgotLinkState ? 2 : 1;
    const pwOk = forgotNewPw.length >= 6 && forgotNewPw === forgotNewPwConfirm;
    const fInput = "w-full py-3 pl-10 pr-10 rounded-xl login-input bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground";
    return (
      <div className="fixed inset-0 z-[9999] bg-background flex items-center justify-center px-5 overflow-y-auto">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-primary/15 blur-3xl" />
          <div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full bg-accent/10 blur-3xl" />
        </div>
        <motion.div className="relative w-full max-w-[370px] py-6" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <div className="relative glass-card-strong rounded-3xl p-5 border border-primary/20">
            <div className="flex items-center justify-between mb-4">
              <button onClick={step === 1 ? () => { setForgotOtpSent(false); setForgotOtp(""); setForgotError(""); } : resetForgotState}
                className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-4 h-4" /> {step === 1 ? "Change email" : "Back to sign in"}
              </button>
              <span className="text-[10px] font-bold tracking-[2px] text-muted-foreground">STEP {step + 1}/3</span>
            </div>
            <StepDots steps={["Email", "Code", "New password"]} current={step} />

            <div className="text-center mt-5">
              <div className="relative w-14 h-14 mx-auto mb-3">
                <div className="absolute inset-0 rounded-2xl gradient-primary rotate-6 opacity-40" />
                <div className="relative w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center">
                  {step === 2 ? <KeyRound className="w-7 h-7 text-primary-foreground" /> : <Mail className="w-7 h-7 text-primary-foreground" />}
                </div>
              </div>
              <h2 className="text-xl font-black text-foreground" style={{ fontFamily: "'Russo One', sans-serif" }}>
                {step === 0 ? "Forgot password?" : step === 1 ? "Enter your code" : "Set a new password"}
              </h2>
              <p className="text-[11.5px] text-muted-foreground mt-1.5 leading-relaxed">
                {step === 0 ? "Enter your account email. We'll send a 6-digit code and a one-tap reset button."
                  : step === 1 ? "Type the code from the email, or tap Reset Password inside it."
                  : forgotLinkState === "link" ? "Email confirmed with the button — no code needed." : "Code accepted. Choose a strong new password."}
              </p>
            </div>

            <div className="mt-5 space-y-3">
              {step === 0 && (
                <>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type="email" inputMode="email" autoComplete="email" placeholder={`you@${access.allowedDomains[0]}`} value={forgotEmail} autoFocus
                      onChange={e => { setForgotEmail(e.target.value); setForgotError(""); }}
                      onKeyDown={e => { if (e.key === "Enter") handleForgotPassword(); }}
                      className={fInput} style={{ boxShadow: "var(--neu-shadow-inset)" }} />
                  </div>
                  {forgotError && <InlineError text={forgotError} />}
                  <motion.button onClick={handleForgotPassword} disabled={forgotLoading || !forgotEmail.trim()} whileTap={{ scale: 0.98 }}
                    className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50">
                    {forgotLoading ? <Spinner /> : <><Mail className="w-4 h-4" /> Send code</>}
                  </motion.button>
                  <SecureNote>You can ask for up to 3 codes a day. Each code works once and only for a few minutes.</SecureNote>
                </>
              )}

              {step === 1 && (
                <>
                  <SentToCard email={forgotEmail} note="Check Spam or Promotions if you can't see it." />
                  <OtpBoxes value={forgotOtp} onChange={(v) => { setForgotOtp(v); if (forgotError) setForgotError(""); }}
                    onComplete={(v) => void confirmForgotCode(v)} disabled={forgotLoading} error={!!forgotError} />
                  <PasteCodeButton disabled={forgotLoading} onCode={(c) => { setForgotOtp(c); if (forgotError) setForgotError(""); }} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {forgotMeta && <CodeTimer expiresAt={forgotMeta.expiresAt} totalMs={forgotMeta.totalMs} now={nowTick} />}
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="relative flex w-2 h-2"><span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" /><span className="relative w-2 h-2 rounded-full bg-primary" /></span>
                      Watching for the button
                    </span>
                  </div>
                  {forgotError && <InlineError text={forgotError} />}
                  <motion.button onClick={() => confirmForgotCode()} disabled={forgotLoading || forgotOtp.length !== 6} whileTap={{ scale: 0.98 }}
                    className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50">
                    {forgotLoading ? <Spinner /> : <><Check className="w-4 h-4" /> Continue</>}
                  </motion.button>
                  <div className="flex items-center justify-between">
                    <DailyPips left={forgotMeta?.dailyLeft ?? null} max={forgotMeta?.dailyMax ?? null} />
                    <ResendButton waitSec={forgotResendLeft} busy={forgotLoading} onClick={resendForgotCode} dailyLeft={forgotMeta?.dailyLeft} />
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="flex items-center gap-2.5 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3.5 py-2.5 text-[11.5px] text-foreground">
                    <span className="w-6 h-6 rounded-full bg-emerald-400/90 flex items-center justify-center shrink-0"><Check className="w-3.5 h-3.5 text-background" /></span>
                    <span className="min-w-0">Verified <b className="block truncate">{forgotEmail}</b></span>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type={showForgotPwText ? "text" : "password"} value={forgotNewPw} autoFocus autoComplete="new-password"
                      onChange={e => { setForgotNewPw(e.target.value); setForgotError(""); }} placeholder="New password (min 6)" className={fInput} />
                    <button type="button" onClick={() => setShowForgotPwText(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2" aria-label="Show password">
                      {showForgotPwText ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                  <PasswordStrength value={forgotNewPw} />
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type={showForgotPwText ? "text" : "password"} value={forgotNewPwConfirm} autoComplete="new-password"
                      onChange={e => { setForgotNewPwConfirm(e.target.value); setForgotError(""); }}
                      onKeyDown={e => { if (e.key === "Enter") handleResetPasswordWithOtp(); }}
                      placeholder="Re-enter new password" className={fInput} />
                    {forgotNewPwConfirm && <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                      {forgotNewPw === forgotNewPwConfirm ? <Check className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-destructive" />}
                    </span>}
                  </div>
                  {forgotError && <InlineError text={forgotError} />}
                  <motion.button onClick={handleResetPasswordWithOtp} disabled={forgotLoading || !pwOk} whileTap={{ scale: 0.98 }}
                    className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50">
                    {forgotLoading ? <Spinner /> : <><KeyRound className="w-4 h-4" /> Save new password</>}
                  </motion.button>
                </>
              )}

              <a href={TELEGRAM_ADMIN_URL} target="_blank" rel="noopener noreferrer"
                className="block text-center text-[11px] text-primary/70 hover:text-primary hover:underline pt-1">
                Having trouble? Contact the owner
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // ======= SIGN-UP EMAIL VERIFICATION SCREEN =======
  if (verifyPending) {
    const digits = verifyCode.replace(/\D/g, "").slice(0, 6);
    const meta = verifyMeta || { expiresAt: verifyPending.expiresAt, totalMs: 5 * 60_000, dailyLeft: null, dailyMax: null };
    return (
      <div className="fixed inset-0 z-[9999] bg-background flex items-center justify-center px-5 overflow-y-auto">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-primary/15 blur-3xl" />
          <div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full bg-accent/10 blur-3xl" />
        </div>
        <motion.div className="relative w-full max-w-[370px] py-6" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <div className="relative glass-card-strong rounded-3xl p-5 border border-primary/20">
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => { clearPendingRegister(); setVerifyPending(null); setVerifyCode(""); setVerifyError(""); setVerifyMeta(null); }}
                className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-4 h-4" /> Change email
              </button>
              <span className="text-[10px] font-bold tracking-[2px] text-muted-foreground">STEP 2/2</span>
            </div>
            <StepDots steps={["Your details", "Verify email"]} current={1} />
            <div className="text-center mt-5">
              <div className="relative w-14 h-14 mx-auto mb-3">
                <div className="absolute inset-0 rounded-2xl gradient-primary rotate-6 opacity-40" />
                <div className="relative w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center">
                  <Mail className="w-7 h-7 text-primary-foreground" />
                </div>
              </div>
              <h2 className="text-xl font-black text-foreground" style={{ fontFamily: "'Russo One', sans-serif" }}>Check your email</h2>
              <p className="text-[11.5px] text-muted-foreground mt-1.5 leading-relaxed">Type the 6-digit code, or tap <b className="text-foreground">Verify Email</b> in the email — this screen finishes by itself.</p>
            </div>

            <div className="mt-5 space-y-3">
              <SentToCard email={verifyPending.email} note="Check Spam or Promotions if you can't see it." />
              <OtpBoxes value={digits} onChange={(v) => { setVerifyCode(v); if (verifyError) setVerifyError(""); }}
                onComplete={(v) => void submitVerifyCode(v)} disabled={verifyLoading} error={!!verifyError} />
              <PasteCodeButton disabled={verifyLoading} onCode={(c) => { setVerifyCode(c); if (verifyError) setVerifyError(""); }} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CodeTimer expiresAt={meta.expiresAt} totalMs={meta.totalMs} now={nowTick} />
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="relative flex w-2 h-2"><span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" /><span className="relative w-2 h-2 rounded-full bg-primary" /></span>
                  Watching for the button
                </span>
              </div>
              {verifyError && <InlineError text={verifyError} />}
              <motion.button whileTap={{ scale: 0.98 }} onClick={() => submitVerifyCode()} disabled={verifyLoading || digits.length !== 6}
                className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50">
                {verifyLoading ? <Spinner /> : <><Check className="w-4 h-4" /> Verify &amp; create account</>}
              </motion.button>
              <div className="flex items-center justify-between">
                <DailyPips left={meta.dailyLeft} max={meta.dailyMax} />
                <ResendButton waitSec={resendLeft} busy={verifyLoading} onClick={resendVerifyCode} dailyLeft={meta.dailyLeft} />
              </div>
              <SecureNote>Never share this code. {branding.siteName} will never ask for it.</SecureNote>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div
      className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-[-30%] left-[-20%] w-[80%] h-[80%] rounded-full"
          style={{ background: "radial-gradient(circle, hsla(176,65%,48%,0.08) 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-[-30%] right-[-20%] w-[80%] h-[80%] rounded-full"
          style={{ background: "radial-gradient(circle, hsla(38,90%,55%,0.06) 0%, transparent 70%)" }}
        />
      </div>

      <StaticFloatingParticles />

      {/* TV Frame / Main Card */}
      <AnimatePresence>
        {!showContent ? (
          <motion.div
            key="intro"
            className="flex flex-col items-center gap-4"
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.5, opacity: 0, filter: "blur(20px)" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div
              className="relative"
              animate={{ 
                boxShadow: ["0 0 0px hsla(176,65%,48%,0)", "0 0 60px hsla(176,65%,48%,0.5)", "0 0 0px hsla(176,65%,48%,0)"]
              }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <img src={logoSrc} alt={branding.loginTitle} className="w-24 h-24 rounded-3xl" />
            </motion.div>
            <motion.h1
              className="text-4xl font-black gradient-text"
              style={{ fontFamily: "'Russo One', sans-serif" }}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {branding.loginTitle}
            </motion.h1>
            <motion.p
              className="text-sm text-muted-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              Welcome to {branding.siteName}
            </motion.p>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            className="relative z-10 w-full max-w-[360px] px-5"
            initial={{ y: 40, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="relative">
              <div
                className="absolute -inset-[2px] rounded-3xl opacity-60"
                style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)), hsl(var(--primary)))" }}
              />
              
              <div className="relative glass-card-strong p-6 rounded-3xl overflow-hidden">
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: "repeating-linear-gradient(0deg, transparent, transparent 2px, hsla(176,65%,48%,0.02) 2px, hsla(176,65%,48%,0.02) 4px)",
                  }}
                />

                <div className="text-center mb-6 relative z-10">
                  <img 
                    src={logoSrc} 
                    alt={branding.loginTitle} 
                    className="w-16 h-16 mx-auto mb-3 rounded-2xl"
                    style={{ boxShadow: "0 10px 40px hsla(176,65%,48%,0.3)" }}
                  />
                  <h1 className="text-2xl font-black text-primary" style={{ fontFamily: "'Russo One', sans-serif", textShadow: "0 0 30px hsla(176,65%,48%,0.4)" }}>
                    {branding.loginTitle}
                  </h1>
                  <p className="text-[11px] text-muted-foreground mt-1 tracking-wider uppercase">{branding.loginSubtitle}</p>
                </div>

                {linkNotice && (
                  <div role="status" className="relative z-10 mb-4 flex items-start gap-2.5 rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-3 text-[11px] leading-relaxed text-foreground">
                    <span className="w-6 h-6 rounded-full gradient-primary flex items-center justify-center shrink-0"><Check className="w-3.5 h-3.5 text-primary-foreground" /></span>
                    <span className="flex-1">{linkNotice}</span>
                    <button onClick={() => setLinkNotice("")} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">✕</button>
                  </div>
                )}

                <div className="flex gap-1 mb-5 bg-foreground/5 rounded-xl p-1 relative z-10">
                  <button
                    onClick={() => { setIsRegister(false); setDeviceLimitError(null); }}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${!isRegister ? "gradient-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"}`}
                  >Sign In</button>
                  <button
                    onClick={() => { setIsRegister(true); setDeviceLimitError(null); }}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${isRegister ? "gradient-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"}`}
                  >Sign Up</button>
                </div>

                {/* Device Limit Error */}
                {deviceLimitError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/30 relative z-10"
                  >
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-destructive mb-1">Device Limit!</p>
                        <p className="text-[11px] text-muted-foreground">{deviceLimitError.message}</p>
                        {deviceLimitError.deviceNames.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <p className="text-[11px] font-medium text-foreground/70">Logged in:</p>
                            {deviceLimitError.deviceNames.map((name, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <Smartphone className="w-3 h-3" />
                                <span>{name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-[10px] text-muted-foreground/70 mt-2">
                          Log out from another device to log in on this device.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-3 relative z-10">
                  {isRegister && (
                    <div>
                      <div className="relative mb-3">
                          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <input name="email" type="email" placeholder={`you@${access.allowedDomains[0]}`} defaultValue={email} maxLength={100}
                            className="w-full py-3 pl-10 pr-4 rounded-xl login-input bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground" style={{ boxShadow: "var(--neu-shadow-inset)" }} />
                      </div>
                      <p className="-mt-1.5 mb-1 px-1 text-[10.5px] text-muted-foreground">Only <b className="text-primary">{domainsText}</b> — we'll send a code to verify it.</p>
                    </div>
                  )}

                  <div>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input name="name" type="text" placeholder={isRegister ? "Username" : "Email or Username"} defaultValue={name} maxLength={100}
                        className="w-full py-3 pl-10 pr-4 rounded-xl login-input bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground" style={{ boxShadow: "var(--neu-shadow-inset)" }} />
                    </div>
                  </div>

                  <div>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input name="password" type={showPassword ? "text" : "password"} placeholder={isRegister ? "Password (min 6)" : "Password"} defaultValue={password} onChange={e => setPassword(e.target.value)} autoComplete={isRegister ? "new-password" : "current-password"}
                        className="w-full py-3 pl-10 pr-10 rounded-xl login-input bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground" style={{ boxShadow: "var(--neu-shadow-inset)" }} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2">
                        {showPassword ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                      </button>
                    </div>
                    {isRegister && <div className="mt-2"><PasswordStrength value={password} /></div>}
                  </div>

                  <motion.button type="submit" disabled={loading}
                    whileTap={{ scale: 0.98 }}
                    className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50 transition-all">
                    {loading ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> : <><LogIn className="w-4 h-4" /> {isRegister ? "Create Account" : "Sign In"}</>}
                  </motion.button>
                </form>

                {/* Divider */}
                <div className="flex items-center gap-3 my-4 relative z-10">
                  <div className="flex-1 h-px bg-foreground/10" />
                  <span className="text-[11px] text-muted-foreground">or</span>
                  <div className="flex-1 h-px bg-foreground/10" />
                </div>

                {/* Google */}
                <motion.button onClick={handleGoogleSignIn} disabled={loading}
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  className="w-full py-3 rounded-xl bg-foreground/8 border border-foreground/10 text-foreground font-medium text-sm flex items-center justify-center gap-3 hover:bg-foreground/12 disabled:opacity-50 transition-all relative z-10">
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </motion.button>

                {/* Continue as Guest */}
                {access.guestEnabled && (
                <motion.button
                  type="button"
                  onClick={() => { ensureGuestUser(); onGuest?.(); }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full mt-3 py-3 rounded-xl bg-transparent border border-dashed border-foreground/20 text-foreground/80 font-medium text-sm flex items-center justify-center gap-2 hover:bg-foreground/5 hover:text-foreground transition-all relative z-10"
                >
                  Continue as Guest
                </motion.button>
                )}


                {/* Footer Links */}
                {!isRegister && (
                  <motion.div className="text-center mt-4 relative z-10"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
                  >
                    <p>
                      <button onClick={() => setShowForgotPw(true)} className="text-[11px] text-primary/60 hover:text-primary hover:underline">
                        Forgot Password?
                      </button>
                    </p>
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default LoginPage;
