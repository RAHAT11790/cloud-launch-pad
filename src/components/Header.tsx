import { useState, useEffect, useMemo } from "react";
import { Search, User } from "lucide-react";
import logoImg from "@/assets/logo.png";
import NotificationPanel from "./NotificationPanel";
import { useBranding } from "@/hooks/useBranding";
import ThemeToggle from "./ThemeToggle";
import { db, ref, set, update, onValue } from "@/lib/firebase";

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
}

const Header = ({ onSearchClick, onProfileClick, onOpenContent, animeTitles = [], onLogoClick, chatOpen }: HeaderProps) => {
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

  // Pick random titles for placeholder rotation
  const displayTitles = useMemo(() => {
    if (animeTitles.length === 0) return ["Search..."];
    const shuffled = [...animeTitles].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(20, shuffled.length));
  }, [animeTitles]);

  // Rotate placeholder text
  useEffect(() => {
    if (displayTitles.length <= 1) return;
    const interval = setInterval(() => {
      setAnimating(true);
      setTimeout(() => {
        setPlaceholderIdx(prev => (prev + 1) % displayTitles.length);
        setAnimating(false);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, [displayTitles.length]);

  useEffect(() => {
    const id = getExistingUserId();
    setUserId(id);

    // Load profile photo
    try {
      const photo = localStorage.getItem("rs_profile_photo");
      setProfilePhoto(photo);
    } catch {}

    // Listen for profile photo changes
    const checkPhoto = () => {
      try {
        const photo = localStorage.getItem("rs_profile_photo");
        setProfilePhoto(photo);
      } catch {}
    };
    const interval = setInterval(checkPhoto, 2000);

    // Update online status only for real users
    if (id) {
      const userUnsub = onValue(ref(db, `users/${id}`), (snap) => {
        const data = snap.val() || {};
        const remotePhoto = String(data.profilePhoto || data.photoUrl || data.avatar || "").trim();
        const remoteName = String(data.name || "").trim();
        if (remotePhoto) {
          try { localStorage.setItem("rs_profile_photo", remotePhoto); } catch {}
          setProfilePhoto(remotePhoto);
        }
        if (remoteName && remoteName !== "Guest User") {
          try {
            localStorage.setItem("rs_display_name", remoteName);
            const rawUser = localStorage.getItem("rsanime_user");
            const parsedUser = rawUser ? JSON.parse(rawUser) : {};
            localStorage.setItem("rsanime_user", JSON.stringify({ ...parsedUser, name: remoteName }));
          } catch {}
        }
      });

      const updateOnline = () => {
        update(ref(db, `users/${id}`), { online: true, lastSeen: Date.now() }).catch(() => {});
      };
      updateOnline();
      const heartbeat = setInterval(updateOnline, 30000);
      
      const onUnload = () => {
        update(ref(db, `users/${id}`), { online: false, lastSeen: Date.now() }).catch(() => {});
      };
      window.addEventListener("beforeunload", onUnload);

      return () => {
        clearInterval(interval);
        clearInterval(heartbeat);
        userUnsub();
        window.removeEventListener("beforeunload", onUnload);
      };
    }

    return () => {
      clearInterval(interval);
    };
  }, []);

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

      <div className="relative flex-1 mx-3 cursor-pointer" onClick={onSearchClick} style={{ maxWidth: 200, minWidth: 120 }}>
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
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <NotificationPanel userId={userId} onOpenContent={onOpenContent} />
        {userId ? (
          <button
            onClick={onProfileClick}
            className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center transition-all hover:scale-110"
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
            className="h-9 px-3.5 rounded-full bg-primary text-primary-foreground text-[12px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95"
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
