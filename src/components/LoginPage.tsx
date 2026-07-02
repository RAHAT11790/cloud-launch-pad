import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Lock, Eye, EyeOff, LogIn, Mail, AlertTriangle, Smartphone, ArrowLeft, KeyRound, Check } from "lucide-react";
import logoImg from "@/assets/logo.png";
import { db, auth, googleProvider, ref, set, get, update, remove, signInWithPopup } from "@/lib/firebase";
import { ensureGuestUser, transferGuestCoinsToUser } from "@/lib/premiumAccess";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SITE_NAME, TELEGRAM_ADMIN_URL } from "@/lib/siteConfig";
import { useBranding } from "@/hooks/useBranding";
import { buildEmailAliasKey, writeDisplayName, writeProfilePhoto } from "@/lib/localUser";

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

const LoginPage = ({ onLogin, onGuest }: LoginPageProps) => {
  const SESSION_STARTED_AT_KEY = "rs_session_started_at";
  const branding = useBranding();
  const logoSrc = branding.logoUrl || logoImg;
  const [isRegister, setIsRegister] = useState(false);
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

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setDeviceLimitError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const gEmail = user.email || "";
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
      if (err.code !== "auth/popup-closed-by-user") {
        toast.error("Google sign-in failed: " + err.message);
      }
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
    if (!forgotEmail.trim()) { toast.error("Please enter your email"); return; }
    setForgotLoading(true);
    try {
      // Find user by email in Firebase
      const emailKey = forgotEmail.trim().toLowerCase().replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
      const snap = await get(ref(db, `appUsers/${emailKey}`));
      if (!snap.exists()) {
        toast.error("No account found with this email!");
        setForgotLoading(false);
        return;
      }

      // Check if custom email service URL is configured
      const emailServiceSnap = await get(ref(db, "settings/emailService/otpFunctionUrl"));
      const customUrl = emailServiceSnap.val();

      if (customUrl) {
        // Use custom edge function for OTP
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        // Store OTP temporarily in Firebase
        await set(ref(db, `otpCodes/${emailKey}`), { code: otp, expires: Date.now() + 5 * 60 * 1000 });

        const res = await fetch(customUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            email: forgotEmail.trim(), 
            otp, 
            siteName: branding.siteName || SITE_NAME,
            logoUrl: branding.logoUrl || "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png",
            siteUrl: "https://rsanime03.lovable.app",
            telegramUrl: "https://t.me/rs_woner",
          }),
        });
        if (!res.ok) throw new Error("Email sending failed");

        setForgotOtpSent(true);
        toast.success(`📧 Code sent to: ${forgotEmail}`);
      } else {
        // Fallback: Use Supabase Auth OTP
        const { error } = await supabase.auth.signInWithOtp({
          email: forgotEmail.trim(),
          options: { shouldCreateUser: true },
        });
        if (error) {
          console.error("OTP send error:", error);
          toast.error("ইমেল পাঠাতে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
          setForgotLoading(false);
          return;
        }
        setForgotOtpSent(true);
        toast.success(`📧 Code sent to: ${forgotEmail}`);
      }
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
    setForgotLoading(false);
  };

  const handleResetPasswordWithOtp = async () => {
    if (!forgotOtp.trim() || !forgotNewPw.trim()) return;
    if (forgotNewPw.length < 4) { toast.error("Password must be at least 4 characters"); return; }
    if (forgotNewPw !== forgotNewPwConfirm) { toast.error("Passwords don't match!"); return; }

    setForgotLoading(true);
    try {
      const emailKey = forgotEmail.trim().toLowerCase().replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");

      // Check if custom email service was used
      const emailServiceSnap = await get(ref(db, "settings/emailService/otpFunctionUrl"));
      const customUrl = emailServiceSnap.val();

      if (customUrl) {
        // Verify OTP from Firebase
        const otpSnap = await get(ref(db, `otpCodes/${emailKey}`));
        const otpData = otpSnap.val();
        if (!otpData || otpData.code !== forgotOtp.trim()) {
          toast.error("❌ Incorrect code!");
          setForgotLoading(false);
          return;
        }
        if (Date.now() > otpData.expires) {
          toast.error("⏰ Code expired! Please request a new one.");
          await remove(ref(db, `otpCodes/${emailKey}`));
          setForgotLoading(false);
          return;
        }
        // Clean up OTP
        await remove(ref(db, `otpCodes/${emailKey}`));
      } else {
        // Verify OTP via Supabase Auth
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: forgotEmail.trim(),
          token: forgotOtp.trim(),
          type: 'email',
        });
        if (verifyError) {
          if (verifyError.message.includes("expired")) {
            toast.error("⏰ Code expired! Please request a new one.");
          } else {
            toast.error("❌ Incorrect code!");
          }
          setForgotLoading(false);
          return;
        }
      }

      // OTP verified — update password in Firebase RTDB
      const snap = await get(ref(db, `appUsers/${emailKey}`));
      if (!snap.exists()) { toast.error("Account not found"); setForgotLoading(false); return; }

      await set(ref(db, `appUsers/${emailKey}/password`), forgotNewPw.trim());

      // Log password reset to Firebase
      const userName = snap.val()?.name || "";
      const logKey = `${emailKey}_${Date.now()}`;
      await set(ref(db, `passwordResets/${logKey}`), {
        email: forgotEmail.trim(),
        name: userName,
        timestamp: Date.now(),
        method: customUrl ? "custom-otp" : "supabase-otp",
      });

      // Sign out of Supabase if it was used
      if (!customUrl) await supabase.auth.signOut();

      toast.success("✅ New password set! You can now login.");
      setShowForgotPw(false);
      setForgotOtpSent(false);
      setForgotOtp("");
      setForgotNewPw("");
      setForgotNewPwConfirm("");
      setForgotEmail("");
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
    setForgotLoading(false);
  };

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
    if (formPassword.length < 4) { toast.error("Password must be at least 4 characters"); return; }

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
        for (const node of nodesToSearch) {
          try {
            const allRef = ref(db, node);
            const allSnap = await get(allRef);
            if (allSnap.exists()) {
              const allData = allSnap.val();
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
        const emailKey = formEmail.toLowerCase().replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
        const userId = "user_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
        
        await registerDeviceAfterLogin(userId);

        await set(ref(db, `appUsers/${emailKey}`), {
          id: userId, name: formName, email: formEmail, password: formPassword, createdAt: Date.now(),
        });
        await syncCanonicalUserNode(userId, {
          id: userId,
          name: formName,
          email: formEmail,
          createdAt: Date.now(),
          online: true,
          lastSeen: Date.now(),
          authProvider: "email",
        }, formEmail);
        try { const prev = JSON.parse(localStorage.getItem("rsanime_user") || "null"); if (prev?.id && prev.id !== userId) { const r = await transferGuestCoinsToUser(prev.id, userId); if (r.transferred > 0) toast.success(`✨ ${r.transferred} guest coins transferred to your account`); } } catch {}
        localStorage.setItem("rsanime_user", JSON.stringify({ id: userId, name: formName, email: formEmail })); try { window.dispatchEvent(new Event("rs_auth_changed")); } catch {}
        localStorage.setItem(SESSION_STARTED_AT_KEY, Date.now().toString());
        writeDisplayName(formName, userId);
        toast.success("Account created successfully!");
        onLogin(userId);
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
    } catch (err: any) { toast.error("Error: " + err.message); }
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
                  <label className="text-xs text-muted-foreground mb-1.5 block">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type={showGooglePw ? "text" : "password"}
                      placeholder="Enter password"
                      value={googlePw}
                      onChange={e => setGooglePw(e.target.value)}
                      className="w-full py-3 pl-10 pr-10 rounded-xl bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground"
                      style={{ boxShadow: "var(--neu-shadow-inset)" }}
                    />
                    <button type="button" onClick={() => setShowGooglePw(!showGooglePw)} className="absolute right-3.5 top-1/2 -translate-y-1/2">
                      {showGooglePw ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type={showGooglePwConfirm ? "text" : "password"}
                      placeholder="Re-enter password"
                      value={googlePwConfirm}
                      onChange={e => setGooglePwConfirm(e.target.value)}
                      className="w-full py-3 pl-10 pr-10 rounded-xl bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground"
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
              <button onClick={() => { setShowForgotPw(false); setForgotOtpSent(false); setForgotEmail(""); setForgotOtp(""); setForgotNewPw(""); setForgotNewPwConfirm(""); }}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              <motion.div className="text-center mb-5"
                initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              >
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-primary/20 flex items-center justify-center">
                  <Mail className="w-7 h-7 text-primary" />
                </div>
                <h2 className="text-xl font-black text-primary" style={{ fontFamily: "'Russo One', sans-serif" }}>
                  Reset Password
                </h2>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {forgotOtpSent ? "Enter the code sent to your email and set a new password" : "A verification code will be sent to your email"}
                </p>
              </motion.div>

              {forgotOtpSent ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">6-digit code from email</label>
                    <input type="text" value={forgotOtp} onChange={e => setForgotOtp(e.target.value)}
                      placeholder="6-digit code" maxLength={6}
                      className="w-full py-3 px-4 rounded-xl bg-secondary border border-border text-foreground text-center text-lg font-mono tracking-[8px] focus:border-primary focus:outline-none" />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type="password" value={forgotNewPw} onChange={e => setForgotNewPw(e.target.value)}
                      placeholder="New password (min 4 chars)"
                      className="w-full py-3 pl-10 pr-4 rounded-xl bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none" />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type="password" value={forgotNewPwConfirm} onChange={e => setForgotNewPwConfirm(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full py-3 pl-10 pr-4 rounded-xl bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none" />
                  </div>
                  <motion.button
                    onClick={handleResetPasswordWithOtp}
                    disabled={forgotLoading || !forgotOtp || !forgotNewPw}
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50 transition-all"
                  >
                    {forgotLoading ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> : <><KeyRound className="w-4 h-4" /> Reset Password</>}
                  </motion.button>
                  <button onClick={() => setForgotOtpSent(false)} className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground">
                    ← Resend Code
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="email"
                      placeholder="Enter your email"
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      className="w-full py-3 pl-10 pr-4 rounded-xl bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground"
                      style={{ boxShadow: "var(--neu-shadow-inset)" }}
                    />
                  </div>

                  <motion.button
                    onClick={handleForgotPassword}
                    disabled={forgotLoading || !forgotEmail.trim()}
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 btn-glow disabled:opacity-50 transition-all"
                  >
                    {forgotLoading ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> : <><Mail className="w-4 h-4" /> Send Code</>}
                  </motion.button>

                  <a href={TELEGRAM_ADMIN_URL} target="_blank" rel="noopener noreferrer"
                    className="block text-center text-[11px] text-primary/60 hover:text-primary hover:underline mt-3">
                    📩 Having trouble? Contact Owner
                  </a>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
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
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: "repeating-linear-gradient(0deg, transparent, transparent 2px, hsla(176,65%,48%,0.02) 2px, hsla(176,65%,48%,0.02) 4px)",
                  }}
                />

                <motion.div className="text-center mb-6 relative z-10"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1 }}
                >
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
                </motion.div>

                <motion.div className="flex gap-1 mb-5 bg-foreground/5 rounded-xl p-1 relative z-10"
                  initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }}
                >
                  <button
                    onClick={() => { setIsRegister(false); setDeviceLimitError(null); }}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${!isRegister ? "gradient-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"}`}
                  >Sign In</button>
                  <button
                    onClick={() => { setIsRegister(true); setDeviceLimitError(null); }}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${isRegister ? "gradient-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"}`}
                  >Sign Up</button>
                </motion.div>

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
                  <AnimatePresence mode="wait">
                    {isRegister && (
                      <motion.div key="email-field"
                        initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                      >
                        <div className="relative mb-3">
                          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <input name="email" type="email" placeholder="Email" defaultValue={email} maxLength={100}
                            className="w-full py-3 pl-10 pr-4 rounded-xl bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground" style={{ boxShadow: "var(--neu-shadow-inset)" }} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  
                  <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input name="name" type="text" placeholder={isRegister ? "Username" : "Email or Username"} defaultValue={name} maxLength={100}
                        className="w-full py-3 pl-10 pr-4 rounded-xl bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground" style={{ boxShadow: "var(--neu-shadow-inset)" }} />
                    </div>
                  </motion.div>
                  
                  <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25 }}>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input name="password" type={showPassword ? "text" : "password"} placeholder="Password" defaultValue={password}
                        className="w-full py-3 pl-10 pr-10 rounded-xl bg-secondary border border-border text-foreground text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground" style={{ boxShadow: "var(--neu-shadow-inset)" }} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2">
                        {showPassword ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                      </button>
                    </div>
                  </motion.div>
                  
                  <motion.button type="submit" disabled={loading}
                    initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
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
                <motion.button
                  type="button"
                  onClick={() => { ensureGuestUser(); onGuest?.(); }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full mt-3 py-3 rounded-xl bg-transparent border border-dashed border-foreground/20 text-foreground/80 font-medium text-sm flex items-center justify-center gap-2 hover:bg-foreground/5 hover:text-foreground transition-all relative z-10"
                >
                  Continue as Guest
                </motion.button>

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
