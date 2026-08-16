import { useState, useEffect, useMemo, useRef } from "react";
import { Search, User } from "lucide-react";
import logoImg from "@/assets/logo.png";
import { useBranding } from "@/hooks/useBranding";
import ThemeToggle from "./ThemeToggle";
import { db, ref, set, update, onValue } from "@/lib/firebase";
import { readProfilePhoto, writeDisplayName, writeProfilePhoto } from "@/lib/localUser";

// Get existing user ID from localStorage (do NOT auto-create guest accounts)
const getExistingUserId = (): string | undefined => {
  try {
    const existing = localStorage.getItem("rsanime_user");
    if (existing) {
      const parsed = JSON.parse(existing);
      if (parsed.id && parsed.email) {
        // Only return ID if user has an email (real account, not guest)
        const displayName = parsed.name || localStorage.getItem("rs_display_name") || "";
        if (displayName && displayName !== "Guest User") {
          update(ref(db, `users/${parsed.id}`), {
            name: displayName,
            online: true,
            lastSeen: Date.now(),
          }).catch(() => {});
        }
        return parsed.id;
      }
    }
  } catch {}
  return undefined;
};

interface HeaderProps {
  onSearchClick: () => void;
  onProfileClick: () => void;
  onOpenContent?: (contentId: string) => void;
  animeTitles?: string[];
  onLogoClick?: () => void;
  chatOpen?: boolean;
  showSearch?: boolean;
}

const Header = ({ onSearchClick, onProfileClick, onOpenContent, animeTitles = [], onLogoClick, chatOpen, showSearch = true }: HeaderProps) => {
  const branding = useBranding();
  const logoSrc = branding.logoUrl ;
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);

  // Listen to AI chat enabled status from Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, "settings/aiChat/enabled"), (snap) => {
      setAiEnabled(snap.val() === true);
    });
    return () => unsub();
  }, []);

  // Placeholder rotation: wait until titles CONTENT is stable for 1.5s (not
  // just any array-ref change) before doing anything. Then shuffle ONCE and
  // cycle every 4s. Never re-shuffle. This kills the "50-60 names flashing"
  // bug caused by parent Index.tsx re-creating the animeTitles array on
  // every render.
  const titlesSignature = useMemo(() => {
    if (!animeTitles || animeTitles.length === 0) return "";
    return `${animeTitles.length}|${animeTitles[0]}|${animeTitles[animeTitles.length - 1]}`;
  }, [animeTitles]);

  const [settledTitles, setSettledTitles] = useState<string[]>([]);
  useEffect(() => {
    if (!animeTitles || animeTitles.length === 0) return;
    const snapshot = animeTitles.slice(0, 200);
    const t = setTimeout(() => {
      const shuffled = [...snapshot].sort(() => Math.random() - 0.5).slice(0, 20);
      setSettledTitles((prev) => (prev.length >= 5 ? prev : shuffled));
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titlesSignature]);

  const displayTitles = settledTitles.length > 0 ? settledTitles : ["Search..."];

  // Rotate placeholder text — only once titles have settled.
  useEffect(() => {
    if (displayTitles.length <= 1) return;
    setPlaceholderIdx(0);
    const interval = setInterval(() => {
      setAnimating(true);
      setTimeout(() => {
        setPlaceholderIdx(prev => (prev + 1) % displayTitles.length);
        setAnimating(false);
      }, 300);
    }, 4000);
    return () => clearInterval(interval);
  }, [displayTitles]);

  // Track current logged-in user id (reacts instantly to login/logout)
  useEffect(() => {
    const syncId = () => {
      const id = getExistingUserId();
      setUserId((prev) => (prev === id ? prev : id));
      try {
        const photo = readProfilePhoto(id);
        setProfilePhoto((prev) => (prev === photo ? prev : photo));
      } catch {}
    };
    syncId();
    const poll = setInterval(syncId, 800);
    window.addEventListener("storage", syncId);
    window.addEventListener("rs_auth_changed", syncId as EventListener);
    return () => {
      clearInterval(poll);
      window.removeEventListener("storage", syncId);
      window.removeEventListener("rs_auth_changed", syncId as EventListener);
    };
  }, []);

  // Firebase profile + online status — re-bound whenever userId changes.
  // Bandwidth note: we subscribe to the two tiny child fields we actually use
  // instead of the whole `users/{uid}` object, otherwise every heartbeat write
  // re-downloads the entire user record (watchlist, history, devices…).
  useEffect(() => {
    if (!userId) return;
    const unsubPhoto = onValue(ref(db, `users/${userId}/profilePhoto`), (snap) => {
      const remotePhoto = String(snap.val() || "").trim();
      if (!remotePhoto) return;
      writeProfilePhoto(remotePhoto, userId);
      setProfilePhoto(remotePhoto);
    });
    const unsubName = onValue(ref(db, `users/${userId}/name`), (snap) => {
      const remoteName = String(snap.val() || "").trim();
      if (!remoteName || remoteName === "Guest User") return;
      try {
        writeDisplayName(remoteName, userId);
        const rawUser = localStorage.getItem("rsanime_user");
        const parsedUser = rawUser ? JSON.parse(rawUser) : {};
        localStorage.setItem("rsanime_user", JSON.stringify({ ...parsedUser, name: remoteName }));
      } catch {}
    });
    const userUnsub = () => { unsubPhoto(); unsubName(); };
    const updateOnline = () => {
      update(ref(db, `users/${userId}`), { online: true, lastSeen: Date.now() }).catch(() => {});
    };
    updateOnline();
    const heartbeat = setInterval(updateOnline, 120000);
    const onUnload = () => {
      update(ref(db, `users/${userId}`), { online: false, lastSeen: Date.now() }).catch(() => {});
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      clearInterval(heartbeat);
      userUnsub();
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [userId]);

  const currentPlaceholder = displayTitles[placeholderIdx] || "Search...";

  return (
    <header className="fixed top-0 left-0 right-0 h-[60px] z-50 flex items-center justify-between px-4 transition-all duration-300 bg-background"
      style={{ boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
      
      {/* Logo - clickable for chat only when AI is enabled */}
      {aiEnabled ? (
        <button onClick={onLogoClick} className="relative group flex-shrink-0">
          <img src={logoSrc} alt={branding.siteName} className="h-10 w-10 rounded-lg object-contain transition-transform group-hover:scale-110 group-active:scale-95" style={{ boxShadow: "var(--neu-shadow-sm)" }} />
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-background animate-pulse" />
          {chatOpen && (
            <span className="absolute -top-1 -left-1 w-3 h-3 rounded-full bg-primary animate-ping" />
          )}
        </button>
      ) : (
        <div className="relative flex-shrink-0">
          <img src={logoSrc} alt={branding.siteName} className="h-10 w-10 rounded-lg object-contain" style={{ boxShadow: "var(--neu-shadow-sm)" }} />
        </div>
      )}

      {showSearch && (
        <div className="relative flex-1 mx-2 cursor-pointer min-w-0" onClick={onSearchClick} style={{ maxWidth: 200 }}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4 z-10" />
          <div className="w-full py-2.5 pl-9 pr-3 rounded-full text-sm h-[38px] flex items-center overflow-hidden"
            style={{ boxShadow: "var(--neu-shadow-inset)", background: "hsl(var(--secondary))" }}>
            <span
              className={`text-muted-foreground text-sm block whitespace-nowrap overflow-hidden text-ellipsis transition-opacity duration-300 ${animating ? "opacity-0" : "opacity-100"}`}
              style={{ width: '100%' }}
            >
              {currentPlaceholder}
            </span>
          </div>
        </div>
      )}
      <div className="flex items-center gap-1 flex-shrink-0">
        <ThemeToggle />
        {userId ? (
          <button
            onClick={onProfileClick}
            className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
            style={{ boxShadow: "var(--neu-shadow-sm)" }}
            aria-label="Open profile"
          >
            {profilePhoto ? (
              <img src={profilePhoto} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full gradient-primary flex items-center justify-center">
                <User className="w-4 h-4 text-primary-foreground" />
              </div>
            )}
          </button>
        ) : (
          <button
            onClick={onProfileClick}
            className="h-9 px-2.5 sm:px-3.5 rounded-full bg-primary text-primary-foreground text-[11px] sm:text-[12px] font-bold uppercase tracking-wider flex items-center gap-1 sm:gap-1.5 transition-all hover:scale-105 active:scale-95 flex-shrink-0 whitespace-nowrap"
            style={{ boxShadow: "0 4px 14px hsl(var(--primary) / 0.35)" }}
            aria-label="Sign in"
          >
            <User className="w-3.5 h-3.5" />
            Login
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;
