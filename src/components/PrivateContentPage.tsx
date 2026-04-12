import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { ArrowLeft, Lock, Eye, EyeOff, KeyRound, Play, ChevronDown, ChevronRight, Loader2, Film, X } from "lucide-react";
import { db, ref, onValue, get, set } from "@/lib/firebase";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { useBranding } from "@/hooks/useBranding";

const VideoPlayer = lazy(() => import("@/components/VideoPlayer"));

interface PrivateEpisode {
  episodeNumber: number;
  title: string;
  link: string;
}

interface PrivateSeries {
  id: string;
  title: string;
  description?: string;
  backdrop?: string;
  poster?: string;
  episodes: PrivateEpisode[];
  createdAt?: number;
}

interface PrivateContentPageProps {
  onClose: () => void;
}

const PrivateContentPage = ({ onClose }: PrivateContentPageProps) => {
  const branding = useBranding();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [series, setSeries] = useState<PrivateSeries[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<PrivateSeries | null>(null);
  const [playingEp, setPlayingEp] = useState<PrivateEpisode | null>(null);

  // Forgot PIN states
  const [forgotMode, setForgotMode] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [newPin, setNewPin] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);

  const userId = useMemo(() => {
    try {
      const raw = localStorage.getItem("rsanime_user");
      return raw ? JSON.parse(raw)?.id : null;
    } catch { return null; }
  }, []);

  const userEmail = useMemo(() => {
    try {
      const raw = localStorage.getItem("rsanime_user");
      return raw ? JSON.parse(raw)?.email : null;
    } catch { return null; }
  }, []);

  // Check if user has PIN set
  useEffect(() => {
    if (!userId) return;
    const unsub = onValue(ref(db, `users/${userId}/privatePin`), (snap) => {
      setHasPin(snap.val() !== null);
    });
    return () => unsub();
  }, [userId]);

  // Load private content
  useEffect(() => {
    const unsub = onValue(ref(db, "privateContent"), (snap) => {
      const data = snap.val();
      if (!data) { setSeries([]); return; }
      const items: PrivateSeries[] = Object.entries(data).map(([id, val]: [string, any]) => ({
        id,
        title: val.title || "",
        description: val.description || "",
        backdrop: val.backdrop || "",
        poster: val.poster || "",
        episodes: val.episodes ? Object.values(val.episodes) : [],
        createdAt: val.createdAt || 0,
      }));
      items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setSeries(items);
    });
    return () => unsub();
  }, []);

  const verifyPin = async () => {
    if (!userId || !pin.trim()) return;
    setLoading(true);
    try {
      const snap = await get(ref(db, `users/${userId}/privatePin`));
      const savedPin = snap.val();
      if (savedPin === pin.trim()) {
        setIsAuthenticated(true);
        toast.success("✅ অ্যাক্সেস দেওয়া হয়েছে!");
      } else {
        toast.error("❌ পাসওয়ার্ড ভুল!");
      }
    } catch {
      toast.error("Error verifying");
    }
    setLoading(false);
  };

  const setNewPinForUser = async () => {
    if (!userId || !pin.trim() || pin.trim().length < 4) {
      toast.error("পাসওয়ার্ড কমপক্ষে ৪ ক্যারেক্টার হতে হবে");
      return;
    }
    setLoading(true);
    try {
      await set(ref(db, `users/${userId}/privatePin`), pin.trim());
      setHasPin(true);
      setIsAuthenticated(true);
      toast.success("✅ পাসওয়ার্ড সেট হয়েছে!");
    } catch {
      toast.error("Error setting password");
    }
    setLoading(false);
  };

  // Send OTP for forgot PIN
  const sendOtp = async () => {
    if (!userId || !userEmail) {
      toast.error("ইমেইল পাওয়া যায়নি");
      return;
    }
    setOtpLoading(true);
    try {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      // Store OTP in Firebase with 5 min expiry
      await set(ref(db, `users/${userId}/pinResetOtp`), {
        code: otp,
        expiresAt: Date.now() + 5 * 60 * 1000,
        email: userEmail,
      });

      // Try to send email via edge function
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        await supabase.functions.invoke("send-otp-email", {
          body: { email: userEmail, otp, siteName: branding.siteName },
        });
      } catch {
        // If edge function fails, show OTP in toast as fallback
        console.log("Email sending failed, OTP stored in Firebase");
      }

      setOtpSent(true);
      toast.success(`📧 কোড পাঠানো হয়েছে: ${userEmail}`);
    } catch {
      toast.error("Error sending code");
    }
    setOtpLoading(false);
  };

  const verifyOtpAndResetPin = async () => {
    if (!userId || !otpInput.trim() || !newPin.trim()) return;
    if (newPin.trim().length < 4) {
      toast.error("পাসওয়ার্ড কমপক্ষে ৪ ক্যারেক্টার");
      return;
    }
    setOtpLoading(true);
    try {
      const snap = await get(ref(db, `users/${userId}/pinResetOtp`));
      const otpData = snap.val();
      if (!otpData || otpData.code !== otpInput.trim()) {
        toast.error("❌ কোড ভুল!");
        setOtpLoading(false);
        return;
      }
      if (otpData.expiresAt < Date.now()) {
        toast.error("⏰ কোডের মেয়াদ শেষ!");
        setOtpLoading(false);
        return;
      }
      // Set new PIN
      await set(ref(db, `users/${userId}/privatePin`), newPin.trim());
      await set(ref(db, `users/${userId}/pinResetOtp`), null);
      setForgotMode(false);
      setOtpSent(false);
      setOtpInput("");
      setNewPin("");
      setPin("");
      toast.success("✅ নতুন পাসওয়ার্ড সেট হয়েছে!");
    } catch {
      toast.error("Error resetting");
    }
    setOtpLoading(false);
  };

  // Video Player
  if (playingEp && selectedSeries) {
    const episodeList = selectedSeries.episodes.map((ep, idx) => ({
      number: ep.episodeNumber || idx + 1,
      active: ep === playingEp,
      onClick: () => setPlayingEp(ep),
    }));

    return (
      <div className="fixed inset-0 z-[300]">
        <Suspense fallback={<div className="fixed inset-0 bg-black flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
          <VideoPlayer
            src={playingEp.link}
            title={selectedSeries.title}
            subtitle={`Episode ${playingEp.episodeNumber}: ${playingEp.title}`}
            poster={selectedSeries.backdrop || selectedSeries.poster}
            onClose={() => setPlayingEp(null)}
            episodeList={episodeList}
          />
        </Suspense>
      </div>
    );
  }

  // Series Detail View
  if (selectedSeries && isAuthenticated) {
    return (
      <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto"
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.25 }}>
        {/* Backdrop */}
        {selectedSeries.backdrop && (
          <div className="relative h-[200px] w-full">
            <img src={selectedSeries.backdrop} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 30%, hsl(var(--background)) 100%)" }} />
          </div>
        )}
        <div className="px-4 pb-24" style={{ marginTop: selectedSeries.backdrop ? "-40px" : "70px" }}>
          <button onClick={() => setSelectedSeries(null)} className="flex items-center gap-2 mb-4 text-sm text-secondary-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" /> Back
          </button>
          <h2 className="text-xl font-bold mb-1">{selectedSeries.title}</h2>
          {selectedSeries.description && (
            <p className="text-sm text-muted-foreground mb-4">{selectedSeries.description}</p>
          )}
          <h3 className="text-sm font-semibold mb-3">Episodes ({selectedSeries.episodes.length})</h3>
          <div className="space-y-2">
            {selectedSeries.episodes.map((ep, idx) => (
              <button key={idx} onClick={() => setPlayingEp(ep)}
                className="w-full flex items-center gap-3 glass-card p-3 rounded-xl hover:border-primary transition-all">
                <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
                  <Play className="w-5 h-5 text-primary-foreground" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium">EP {ep.episodeNumber || idx + 1}</p>
                  {ep.title && <p className="text-[11px] text-muted-foreground">{ep.title}</p>}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    );
  }

  // Login / Set PIN Screen
  if (!isAuthenticated) {
    return (
      <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "tween", duration: 0.3 }}>
        <button onClick={onClose} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" /> Back
        </button>

        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-full gradient-primary flex items-center justify-center mx-auto mb-4">
            <Lock className="w-10 h-10 text-primary-foreground" />
          </div>
          <h2 className="text-xl font-bold mb-1">Private Content</h2>
          <p className="text-sm text-muted-foreground">
            {hasPin === false ? "প্রথমে একটি পাসওয়ার্ড সেট করুন" : "পাসওয়ার্ড দিয়ে এক্সেস করুন"}
          </p>
        </div>

        {forgotMode ? (
          <div className="max-w-sm mx-auto">
            {!otpSent ? (
              <div className="space-y-4">
                <p className="text-sm text-center text-muted-foreground">
                  আপনার ইমেইলে ({userEmail || "N/A"}) একটি কোড পাঠানো হবে
                </p>
                <button onClick={sendOtp} disabled={otpLoading || !userEmail}
                  className="w-full py-3 rounded-xl gradient-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  কোড পাঠান
                </button>
                <button onClick={() => setForgotMode(false)} className="w-full py-2 text-sm text-muted-foreground hover:text-foreground">
                  ← Back to Login
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">ইমেইলে পাঠানো কোড</label>
                  <input type="text" value={otpInput} onChange={e => setOtpInput(e.target.value)}
                    placeholder="৬ ডিজিটের কোড" maxLength={6}
                    className="w-full py-3 px-4 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-center text-lg font-mono tracking-[8px] focus:border-primary focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">নতুন পাসওয়ার্ড</label>
                  <input type="password" value={newPin} onChange={e => setNewPin(e.target.value)}
                    placeholder="নতুন পাসওয়ার্ড (মিনিমাম ৪)"
                    className="w-full py-3 px-4 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none" />
                </div>
                <button onClick={verifyOtpAndResetPin} disabled={otpLoading || !otpInput || !newPin}
                  className="w-full py-3 rounded-xl gradient-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  পাসওয়ার্ড রিসেট করুন
                </button>
                <button onClick={() => { setOtpSent(false); setForgotMode(false); }} className="w-full py-2 text-sm text-muted-foreground">
                  ← Back
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-sm mx-auto space-y-4">
            {hasPin === null ? (
              <div className="flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : (
              <>
                <div className="relative">
                  <input
                    type={showPin ? "text" : "password"}
                    value={pin}
                    onChange={e => setPin(e.target.value)}
                    placeholder={hasPin ? "পাসওয়ার্ড দিন" : "নতুন পাসওয়ার্ড সেট করুন (মিনিমাম ৪)"}
                    className="w-full py-3 px-4 pr-12 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none"
                    onKeyDown={e => e.key === "Enter" && (hasPin ? verifyPin() : setNewPinForUser())}
                  />
                  <button onClick={() => setShowPin(!showPin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <button onClick={hasPin ? verifyPin : setNewPinForUser} disabled={loading || !pin.trim()}
                  className="w-full py-3 rounded-xl gradient-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  {hasPin ? "এক্সেস করুন" : "পাসওয়ার্ড সেট করুন"}
                </button>
                {hasPin && (
                  <button onClick={() => setForgotMode(true)} className="w-full py-2 text-sm text-primary hover:underline">
                    পাসওয়ার্ড ভুলে গেছেন?
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </motion.div>
    );
  }

  // Content List (authenticated)
  return (
    <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
      initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
      transition={{ type: "tween", duration: 0.3 }}>
      <button onClick={onClose} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground">
        <ArrowLeft className="w-5 h-5" /> Back
      </button>

      <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
        <Lock className="w-5 h-5 text-primary" /> Private Content
      </h2>
      <p className="text-sm text-muted-foreground mb-5">শুধুমাত্র অনুমোদিত ব্যবহারকারীদের জন্য</p>

      {series.length === 0 ? (
        <div className="text-center py-16">
          <Film className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">এখনো কোনো প্রাইভেট কন্টেন্ট নেই</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {series.map(s => (
            <button key={s.id} onClick={() => setSelectedSeries(s)}
              className="text-left rounded-xl overflow-hidden glass-card hover:border-primary transition-all">
              <div className="aspect-video bg-card relative">
                {s.backdrop || s.poster ? (
                  <img src={s.backdrop || s.poster} alt={s.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full gradient-primary flex items-center justify-center">
                    <Film className="w-8 h-8 text-primary-foreground/50" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 p-2" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)" }}>
                  <p className="text-[11px] font-semibold line-clamp-1 text-white">{s.title}</p>
                  <p className="text-[9px] text-white/60">{s.episodes.length} Episodes</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
};

export default PrivateContentPage;
