import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db, ref, set, get } from "@/lib/firebase";
import { consumeUnlockTokenForCurrentUser, getLocalUserId, getRandomPrizeDuration } from "@/lib/unlockAccess";

const Unlock = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"verifying" | "success" | "denied">("verifying");
  const [prizeHours, setPrizeHours] = useState<number | null>(null);
  const [prizeMinutes, setPrizeMinutes] = useState<number | null>(null);
  const isPrize = searchParams.get("mode") === "prize";

  useEffect(() => {
    const doUnlock = async () => {
      const token = searchParams.get("t") || "";
      const userId = getLocalUserId();

      if (!userId || !token) {
        setStatus("denied");
        setTimeout(() => navigate("/", { replace: true }), 2500);
        return;
      }

      const consume = await consumeUnlockTokenForCurrentUser(token);
      if (!consume.ok) {
        localStorage.removeItem("rsanime_ad_access");
        setStatus("denied");
        setTimeout(() => navigate("/", { replace: true }), 2500);
        return;
      }

      // Determine duration: prize mode = random, normal = 24h
      let durationMs: number;
      let hours = 24;
      let minutes = 0;

      if (isPrize) {
        const prize = getRandomPrizeDuration();
        hours = prize.hours;
        minutes = prize.minutes;
        durationMs = prize.totalMs;
      } else {
        durationMs = 24 * 60 * 60 * 1000;
      }

      const expiry = Date.now() + durationMs;
      localStorage.setItem("rsanime_ad_access", expiry.toString());
      setPrizeHours(hours);
      setPrizeMinutes(minutes);
      setStatus("success");

      // Save to Firebase
      try {
        const userStr = localStorage.getItem("rsanime_user");
        if (userStr) {
          const user = JSON.parse(userStr);
          const id = user.id || user.uid || user.username || user.email?.replace(/[.@]/g, "_") || "user_" + Date.now();
          await set(ref(db, `freeAccessUsers/${id}`), {
            userId: id,
            name: user.name || user.username || "Unknown",
            email: user.email || "",
            unlockedAt: Date.now(),
            expiresAt: expiry,
            prizeHours: hours,
            prizeMinutes: minutes,
            mode: isPrize ? "prize" : "normal",
          });

          // Also save to prizePool if prize mode
          if (isPrize) {
            const prizeId = `${id}_${Date.now()}`;
            await set(ref(db, `prizePool/${prizeId}`), {
              userId: id,
              name: user.name || user.username || "Unknown",
              email: user.email || "",
              hours,
              minutes,
              totalMs: durationMs,
              claimedAt: Date.now(),
              expiresAt: expiry,
            });
          }
        }
      } catch (err) {
        console.error("Failed to save free access:", err);
      }

      setTimeout(() => navigate("/", { replace: true }), 5000);
    };

    doUnlock();
  }, [navigate, searchParams, isPrize]);

  if (status === "denied") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card rounded-2xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl border border-border">
          <div className="w-16 h-16 mx-auto rounded-full bg-destructive/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            লিংকটি সঠিক নয় অথবা মেয়াদ শেষ হয়ে গেছে।
          </p>
          <p className="text-xs text-muted-foreground animate-pulse">Redirecting...</p>
        </div>
      </div>
    );
  }

  // Prize success UI
  if (status === "success" && isPrize && prizeHours !== null) {
    const totalH = prizeHours;
    const totalM = prizeMinutes || 0;
    const isJackpot = totalH >= 42;
    const isGreat = totalH >= 36 && !isJackpot;
    const isGood = totalH >= 30 && !isGreat && !isJackpot;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card rounded-2xl p-8 max-w-sm w-full text-center space-y-5 shadow-2xl border border-border relative overflow-hidden">
          {/* Confetti decorations for jackpot */}
          {isJackpot && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-2 left-4 w-3 h-3 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
              <div className="absolute top-6 right-8 w-2 h-2 bg-pink-400 rounded-full animate-bounce" style={{ animationDelay: "0.3s" }} />
              <div className="absolute top-4 left-1/2 w-2.5 h-2.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0.5s" }} />
              <div className="absolute bottom-8 left-6 w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
              <div className="absolute bottom-12 right-6 w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0.4s" }} />
            </div>
          )}

          {/* Prize icon */}
          <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center ${
            isJackpot ? "bg-gradient-to-br from-yellow-400 to-orange-500 animate-pulse" 
            : isGreat ? "bg-gradient-to-br from-purple-500 to-pink-500"
            : isGood ? "bg-gradient-to-br from-blue-500 to-cyan-500"
            : "bg-gradient-to-br from-primary to-accent"
          }`}>
            <span className="text-3xl">
              {isJackpot ? "🏆" : isGreat ? "💎" : isGood ? "⭐" : "🎁"}
            </span>
          </div>

          <h2 className={`text-2xl font-bold ${
            isJackpot ? "text-yellow-500" 
            : isGreat ? "text-purple-400"
            : "text-foreground"
          }`}>
            {isJackpot ? "🎉 JACKPOT! 🎉" 
            : isGreat ? "💎 Amazing Prize!" 
            : isGood ? "⭐ Great Prize!"
            : "🎊 Congratulations!"}
          </h2>

          <div className="bg-muted/50 rounded-xl p-4 space-y-2">
            <p className="text-sm text-muted-foreground">আপনি পেয়েছেন</p>
            <p className={`text-3xl font-black ${
              isJackpot ? "text-yellow-500" 
              : isGreat ? "text-purple-400"
              : isGood ? "text-blue-400"
              : "text-primary"
            }`}>
              {totalH}h {totalM > 0 ? `${totalM}m` : ""}
            </p>
            <p className="text-sm text-muted-foreground">ফ্রি এক্সেস!</p>
          </div>

          {isJackpot && (
            <p className="text-xs text-yellow-500 font-semibold">
              ⭐ আপনি সেই ভাগ্যবান ০.৫% এর মধ্যে একজন!
            </p>
          )}
          {isGreat && (
            <p className="text-xs text-purple-400 font-semibold">
              💎 অসাধারণ! আপনি অনেক ভাগ্যবান!
            </p>
          )}

          <p className="text-xs text-muted-foreground animate-pulse">
            হোমপেজে নিয়ে যাচ্ছে...
          </p>
        </div>
      </div>
    );
  }

  // Normal success / verifying
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl border border-border">
        <div className="w-16 h-16 mx-auto rounded-full gradient-primary flex items-center justify-center">
          {status === "verifying" ? (
            <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <h2 className="text-xl font-bold text-foreground">
          {status === "verifying" ? "Verifying..." : "Access Unlocked!"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {status === "verifying"
            ? "যাচাই করা হচ্ছে..."
            : `আপনি ${prizeHours || 24} ঘন্টা${prizeMinutes ? ` ${prizeMinutes} মিনিট` : ""} ফ্রি এক্সেস পেয়েছেন!`}
        </p>
        <p className="text-xs text-muted-foreground animate-pulse">Redirecting...</p>
      </div>
    </div>
  );
};

export default Unlock;
