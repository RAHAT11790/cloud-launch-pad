import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db, ref, set } from "@/lib/firebase";
import { consumeUnlockTokenForCurrentUser, getLocalUserId } from "@/lib/unlockAccess";

const Unlock = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"verifying" | "success" | "denied">("verifying");

  useEffect(() => {
    const doUnlock = async () => {
      const token = searchParams.get("t") || "";
      const userId = getLocalUserId();

      if (!userId) {
        setStatus("denied");
        setTimeout(() => navigate("/", { replace: true }), 2500);
        return;
      }

      if (!token) {
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

      setStatus("success");

      // Grant 24 hours access
      const expiry = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem("rsanime_ad_access", expiry.toString());

      // Save free access user info to Firebase
      try {
        const userStr = localStorage.getItem("rsanime_user");
        if (userStr) {
          const user = JSON.parse(userStr);
          const userId = user.id || user.uid || user.username || user.email?.replace(/[.@]/g, "_");
          const id = userId || "user_" + Date.now();
          const accessData = {
            userId: id,
            name: user.name || user.username || "Unknown",
            email: user.email || "",
            unlockedAt: Date.now(),
            expiresAt: expiry,
          };
          await set(ref(db, `freeAccessUsers/${id}`), accessData);
        } else {
          const anonId = "anon_" + Date.now();
          await set(ref(db, `freeAccessUsers/${anonId}`), {
            userId: anonId, name: "Anonymous", email: "",
            unlockedAt: Date.now(), expiresAt: expiry,
          });
        }
      } catch (err) {
        console.error("Failed to save free access:", err);
      }

      setTimeout(() => navigate("/", { replace: true }), 2000);
    };

    doUnlock();
  }, [navigate, searchParams]);

  if (status === "denied") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="bg-card rounded-2xl p-8 max-w-sm w-[90%] text-center space-y-4 shadow-2xl border border-border">
          <div className="w-16 h-16 mx-auto rounded-full bg-destructive/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            Please use the unlock link from the video player to get free access.
          </p>
          <p className="text-xs text-muted-foreground animate-pulse">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="bg-card rounded-2xl p-8 max-w-sm w-[90%] text-center space-y-4 shadow-2xl border border-border">
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
            ? "Please wait while we verify your access..."
            : "You now have 24 hours of free access to all videos."}
        </p>
        <p className="text-xs text-muted-foreground animate-pulse">Redirecting...</p>
      </div>
    </div>
  );
};

export default Unlock;
