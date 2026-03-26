import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { Episode } from "@/data/animeData";
import logoImg from "@/assets/logo.png";
import SplashLoader from "@/components/SplashLoader";
import { Lock, ExternalLink, Loader2 } from "lucide-react";
import { TELEGRAM_CHANNEL_URL } from "@/lib/siteConfig";

// Helper: get best available src from episode (fallback if default link is empty)
const getEpisodeSrc = (ep: Episode): string => {
  return ep.link || ep.link480 || ep.link720 || ep.link1080 || ep.link4k || "";
};
import { AnimatePresence, motion } from "framer-motion";
import SaltPlayer from "@/components/SaltPlayer";
import { X } from "lucide-react";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import HeroSlider from "@/components/HeroSlider";
import CategoryPills from "@/components/CategoryPills";
import AnimeSection from "@/components/AnimeSection";
import AnimeDetails from "@/components/AnimeDetails";
import VideoPlayer from "@/components/VideoPlayer";
import SearchPage from "@/components/SearchPage";
import ProfilePage from "@/components/ProfilePage";
import NewEpisodeReleases from "@/components/NewEpisodeReleases";
import LoginPage from "@/components/LoginPage";
import { useFirebaseData } from "@/hooks/useFirebaseData";
import { useSelectedAnimeSalt } from "@/hooks/useSelectedAnimeSalt";
import { animeSaltApi } from "@/lib/animeSaltApi";
import LiveSupportChat from "@/components/LiveSupportChat";
import { initializeUiTheme } from "@/lib/uiTheme";

// Session cache for API responses to speed up continue watching
const apiCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 min
const cachedApiCall = async (key: string, fn: () => Promise<any>) => {
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const data = await fn();
  apiCache.set(key, { data, ts: Date.now() });
  return data;
};
import { db, ref, set, onValue, get } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";
import { toast } from "sonner";
import { registerFCMToken } from "@/lib/fcm";
import { createUnlockLinkForCurrentUser } from "@/lib/unlockAccess";

const Index = () => {
  const { webseries, movies, allAnime: firebaseAnime, categories, loading } = useFirebaseData();
  const { items: animeSaltItems, loading: saltLoading } = useSelectedAnimeSalt();

  // Merge AnimeSalt items into main data lists
  const allAnime = useMemo(() => {
    const combined = [...firebaseAnime, ...animeSaltItems];
    combined.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return combined;
  }, [firebaseAnime, animeSaltItems]);

  const allSeries = useMemo(() => {
    const saltSeries = animeSaltItems.filter(i => i.type === 'webseries');
    return [...webseries, ...saltSeries];
  }, [webseries, animeSaltItems]);

  const allMovies = useMemo(() => {
    const saltMovies = animeSaltItems.filter(i => i.type === 'movie');
    return [...movies, ...saltMovies];
  }, [movies, animeSaltItems]);
  
  // Maintenance mode check
  const [maintenance, setMaintenance] = useState<any>(null);

  useEffect(() => {
    const unsub = onValue(ref(db, "maintenance"), (snap) => {
      setMaintenance(snap.val());
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    initializeUiTheme();
  }, []);

  // Check if user is logged in
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    try {
      const u = localStorage.getItem("rsanime_user");
      return !!(u && JSON.parse(u).id);
    } catch { return false; }
  });

  // Keep auth-like local user state synced (Header may create user after mount)
  useEffect(() => {
    const syncLoginState = () => {
      try {
        const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
        setIsLoggedIn(!!u?.id);
      } catch {
        setIsLoggedIn(false);
      }
    };

    syncLoginState();
    const timer = setInterval(syncLoginState, 1500);
    window.addEventListener("storage", syncLoginState);

    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", syncLoginState);
    };
  }, []);

  // Ad-gate state for AnimeSalt player
  const [saltAdGateActive, setSaltAdGateActive] = useState(false);
  const [saltAdGateLink, setSaltAdGateLink] = useState<string | null>(null);
  const [saltAdGateLoading, setSaltAdGateLoading] = useState(false);
  const [globalFreeAccess, setGlobalFreeAccess] = useState(false);
  const [saltIsPremium, setSaltIsPremium] = useState<boolean | null>(null);
  const [userFreeAccessExpiresAt, setUserFreeAccessExpiresAt] = useState(0);
  const [unlockBlocked, setUnlockBlocked] = useState(false);

  // Device limit enforcement for already logged-in users
  const [deviceLimitWarning, setDeviceLimitWarning] = useState<{
    message: string;
    devices: string[];
    maxDevices: number;
  } | null>(null);

  // Listen for global free access
  useEffect(() => {
    const unsub = onValue(ref(db, "globalFreeAccess"), (snap) => {
      const data = snap.val();
      setGlobalFreeAccess(!!(data?.active && data?.expiresAt > Date.now()));
    });
    return () => unsub();
  }, []);

  // Check premium status - re-run when login state changes
  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (!u.id) { setSaltIsPremium(false); return; }
      const unsub = onValue(ref(db, `users/${u.id}/premium`), (snap) => {
        const data = snap.val();
        const isPrem = !!(data && data.active === true && data.expiresAt > Date.now());
        setSaltIsPremium(isPrem);
      });
      return () => unsub();
    } catch { setSaltIsPremium(false); }
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) {
      setUserFreeAccessExpiresAt(0);
      setUnlockBlocked(false);
      return;
    }

    let uid = "";
    try {
      uid = JSON.parse(localStorage.getItem("rsanime_user") || "{}").id || "";
    } catch {
      uid = "";
    }
    if (!uid) return;

    const unsubAccess = onValue(ref(db, `users/${uid}/freeAccess`), (snap) => {
      const data = snap.val();
      if (data?.active && Number(data.expiresAt) > Date.now()) {
        setUserFreeAccessExpiresAt(Number(data.expiresAt));
      } else {
        setUserFreeAccessExpiresAt(0);
      }
    });

    const unsubBlocked = onValue(ref(db, `users/${uid}/security/unlockBlocked`), (snap) => {
      setUnlockBlocked(!!snap.val()?.blocked);
    });

    return () => {
      unsubAccess();
      unsubBlocked();
    };
  }, [isLoggedIn]);

  // Realtime device limit monitor - check if current device is still within limit
  useEffect(() => {
    if (!isLoggedIn) return;
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (!u.id) return;
      const unsub = onValue(ref(db, `users/${u.id}/premium`), async (snap) => {
        const data = snap.val();
        if (!data || !data.active || data.expiresAt <= Date.now()) {
          setDeviceLimitWarning(null);
          return;
        }
        const maxDevices = Math.max(1, Number(data.maxDevices) || 1);
        const devices = data.devices || {};
        const deviceCount = Object.keys(devices).length;
        if (deviceCount <= maxDevices) {
          setDeviceLimitWarning(null);
          return;
        }
        // Over limit! Check if THIS device is registered
        const { getDeviceId, getDeviceFingerprint } = await import("@/lib/premiumDevice");
        const myDeviceId = getDeviceId();
        const myFp = getDeviceFingerprint();
        const isRegistered = devices[myDeviceId] || Object.entries(devices).some(([, d]: any) => d?.fingerprint === myFp);
        if (!isRegistered) {
          // This device is NOT registered and limit is exceeded - force warning
          const deviceNames = Object.values(devices).map((d: any) => d?.name || "Unknown Device");
          setDeviceLimitWarning({
            message: `Your account allows up to ${maxDevices} devices. Currently ${deviceCount} devices are logged in. This device is not registered.`,
            devices: deviceNames,
            maxDevices,
          });
        } else {
          setDeviceLimitWarning(null);
        }
      });
      return () => unsub();
    } catch {}
  }, [isLoggedIn]);

  // Welcome voice removed per user request

  const hasFreeAccess = useCallback((): boolean => {
    if (globalFreeAccess) return true;
    return userFreeAccessExpiresAt > Date.now();
  }, [globalFreeAccess, userFreeAccessExpiresAt]);

  const checkAndShowAdGate = useCallback(async (): Promise<boolean> => {
    // Returns true if access is granted, false if ad-gate shown
    // Device limit is enforced at login time, premium users get direct access
    if (!isLoggedIn) {
      toast.error("ভিডিও দেখতে লগইন করতে হবে");
      return false;
    }

    if (unlockBlocked) {
      toast.error("একই unlock token অপব্যবহারের কারণে এই অ্যাকাউন্ট ব্লক করা হয়েছে");
      return false;
    }

    if (saltIsPremium) return true;

    if (hasFreeAccess()) return true;

    // Show ad-gate
    setSaltAdGateActive(true);
    setSaltAdGateLoading(true);
    try {
      const result = await createUnlockLinkForCurrentUser();
      setSaltAdGateLoading(false);
      if (result.ok && result.shortUrl) {
        setSaltAdGateLink(result.shortUrl);
      } else {
        setSaltAdGateActive(false);
        toast.error("Unlock link তৈরি করা যায়নি, আবার চেষ্টা করুন");
      }
    } catch {
      setSaltAdGateLoading(false);
      setSaltAdGateActive(false);
      toast.error("Unlock service এখন unavailable");
    }
    return false;
  }, [isLoggedIn, unlockBlocked, saltIsPremium, hasFreeAccess]);

  const [activePage, setActivePage] = useState("home");
  const [activeCategory, setActiveCategory] = useState("All");
  const [dubFilter, setDubFilter] = useState<"all" | "official" | "fandub">("all");
  const [selectedAnime, setSelectedAnime] = useState<AnimeItem | null>(null);
  const [customPostDetail, setCustomPostDetail] = useState<{ title: string; backdrop: string; description: string } | null>(null);
  const [pendingAnimeId, setPendingAnimeId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("anime");
  });
  const [showSearch, setShowSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [playerState, setPlayerState] = useState<{
    src: string;
    title: string;
    subtitle: string;
    anime: AnimeItem;
    seasonIdx?: number;
    epIdx?: number;
    qualityOptions?: { label: string; src: string }[];
  } | null>(null);

  // AnimeSalt iframe player state
  const [saltPlayerState, setSaltPlayerState] = useState<{
    embedUrl: string;
    cleanEmbedUrl?: string;
    title: string;
    subtitle: string;
    anime?: AnimeItem;
    seasonIdx?: number;
    epIdx?: number;
    allEmbeds?: string[];
    currentEmbedIdx?: number;
    cropMode?: 'contain' | 'cover' | 'fill';
    cropW?: number;
    cropH?: number;
    loading?: boolean;
  } | null>(null);

  // AnimeSalt details request control + cache (avoid stale loading toast on cached reopen)
  const detailsCacheRef = useRef<Map<string, AnimeItem>>(new Map());
  const detailsLoadingToastRef = useRef<string | number | null>(null);
  const detailsLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailsRequestRef = useRef(0);

  const dismissDetailsLoadingToast = useCallback(() => {
    if (detailsLoadingTimeoutRef.current) {
      clearTimeout(detailsLoadingTimeoutRef.current);
      detailsLoadingTimeoutRef.current = null;
    }

    const activeToastId = detailsLoadingToastRef.current;
    if (activeToastId !== null) {
      toast.dismiss(activeToastId);
      detailsLoadingToastRef.current = null;
    }
  }, []);

  const showDetailsLoadingToast = useCallback(() => {
    dismissDetailsLoadingToast();
    const toastId = toast.loading("Loading details...", {
      duration: 5000,
      closeButton: true,
    });

    detailsLoadingToastRef.current = toastId;
    detailsLoadingTimeoutRef.current = setTimeout(() => {
      if (detailsLoadingToastRef.current === toastId) {
        toast.dismiss(toastId);
        detailsLoadingToastRef.current = null;
      }
      detailsLoadingTimeoutRef.current = null;
    }, 5000);

    return toastId;
  }, [dismissDetailsLoadingToast]);

  // Invalidate cached full details when source list refreshes
  useEffect(() => {
    detailsCacheRef.current.clear();
  }, [animeSaltItems]);

  useEffect(() => {
    return () => {
      dismissDetailsLoadingToast();
    };
  }, [dismissDetailsLoadingToast]);

  useEffect(() => {
    if (playerState || saltPlayerState) {
      dismissDetailsLoadingToast();
    }
  }, [playerState, saltPlayerState, dismissDetailsLoadingToast]);

  // Create a blob URL wrapper that embeds the video in a full-screen iframe (no proxy needed)
  const getCleanEmbedUrl = useCallback((embedUrl: string): string => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body,html{width:100%;height:100%;overflow:hidden;background:#000}iframe{width:100%;height:100%;border:none}</style></head><body><iframe src="${embedUrl}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="no-referrer"></iframe></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, []);

  // Continue watching data (per-device)
  const [continueWatching, setContinueWatching] = useState<any[]>([]);

  // Load continue watching from Firebase - per device
  useEffect(() => {
    if (!isLoggedIn) return;
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (!u.id) return;
      // Get device-specific watch history
      import("@/lib/premiumDevice").then(({ getDeviceId }) => {
        const deviceId = getDeviceId();
        const whRef = ref(db, `users/${u.id}/watchHistory/${deviceId}`);
        const unsub = onValue(whRef, (snapshot) => {
          const data = snapshot.val() || {};
          const items = Object.values(data) as any[];
          const withProgress = items.filter((i: any) => {
            if (i.id?.startsWith('as_')) return true;
            return i.currentTime && i.duration && (i.currentTime / i.duration) < 0.95;
          });
          withProgress.sort((a: any, b: any) => (b.watchedAt || 0) - (a.watchedAt || 0));
          setContinueWatching(withProgress);
        });
        // Store unsub for cleanup
        (window as any).__rs_cw_unsub = unsub;
      });
      return () => { (window as any).__rs_cw_unsub?.(); };
    } catch {}
  }, [isLoggedIn]);

  // Register/refresh FCM token silently (no prompts, no diagnostics)
  // Also check admin "forceNotifPrompt" setting to prompt users who haven't allowed yet
  useEffect(() => {
    if (!isLoggedIn) return;

    const registerPushToken = async () => {
      try {
        const pushPref = localStorage.getItem("rs_notif_push");
        if (pushPref === "false") return;

        const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
        if (!u?.id) return;

        // If permission already granted, just refresh token silently
        if ("Notification" in window && Notification.permission === "granted") {
          await registerFCMToken(u.id, false);
          return;
        }

        // If permission is "default" (not yet asked), check admin forceNotifPrompt
        if ("Notification" in window && Notification.permission === "default") {
          try {
            const snap = await get(ref(db, "settings/forceNotifPrompt"));
            if (snap.val() === true) {
              // Check if we already prompted this session
              const sessionKey = "rs_notif_prompted_session";
              if (!sessionStorage.getItem(sessionKey)) {
                sessionStorage.setItem(sessionKey, "1");
                // Small delay so page loads first
                await new Promise(r => setTimeout(r, 2000));
                const permission = await Notification.requestPermission();
                if (permission === "granted") {
                  await registerFCMToken(u.id, false);
                  toast.success("✅ নোটিফিকেশন চালু হয়েছে!", { duration: 3000 });
                }
              }
            }
          } catch {}
        }
      } catch {}
    };

    registerPushToken();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") registerPushToken();
    };

    window.addEventListener("focus", registerPushToken);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const refreshTimer = setInterval(registerPushToken, 10 * 60 * 1000);

    return () => {
      window.removeEventListener("focus", registerPushToken);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(refreshTimer);
    };
  }, [isLoggedIn]);

  // Back button handler
  const getCurrentLayer = useCallback(() => {
    if (playerState) return "player";
    if (saltPlayerState) return "saltPlayer";
    if (selectedAnime) return "details";
    if (showSearch) return "search";
    if (showProfile) return "profile";
    if (activePage === "series" || activePage === "movies") return activePage;
    return "home";
  }, [playerState, saltPlayerState, selectedAnime, showSearch, showProfile, activePage]);

  const handleBackPress = useCallback(() => {
    const layer = getCurrentLayer();
    if (layer === "player") { setPlayerState(null); return true; }
    if (layer === "saltPlayer") { setSaltPlayerState(null); return true; }
    if (layer === "details") { setSelectedAnime(null); return true; }
    if (layer === "search") { setShowSearch(false); return true; }
    if (layer === "profile") { setShowProfile(false); setActivePage("home"); return true; }
    if (layer === "series" || layer === "movies") { setActivePage("home"); return true; }
    return false;
  }, [getCurrentLayer]);

  useEffect(() => {
    if (window.history.state?.rsAnime !== true) {
      window.history.pushState({ rsAnime: true, page: "home" }, "");
    }
    let lastBackPress = 0;
    const onPopState = () => {
      window.history.pushState({ rsAnime: true }, "");
      const handled = handleBackPress();
      if (!handled) {
        const now = Date.now();
        if (now - lastBackPress < 2000) { window.close(); }
        else { lastBackPress = now; toast.info("Press back again to exit"); }
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [handleBackPress]);

  useEffect(() => {
    const layer = getCurrentLayer();
    if (layer !== "home") window.history.pushState({ rsAnime: true, page: layer }, "");
  }, [getCurrentLayer]);

  // Handle deep link: open anime detail from URL ?anime=ID
  useEffect(() => {
    if (pendingAnimeId && allAnime.length > 0) {
      const found = allAnime.find(a => a.id === pendingAnimeId);
      if (found) setSelectedAnime(found);
      setPendingAnimeId(null);
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [pendingAnimeId, allAnime]);

  const filteredAnime = useMemo(() => {
    if (activeCategory !== "All") return allAnime.filter(a => a.category === activeCategory);
    return allAnime;
  }, [activeCategory, allAnime]);

  const filteredSeries = useMemo(() => {
    let list = activeCategory !== "All" ? allSeries.filter(a => a.category === activeCategory) : allSeries;
    if (dubFilter !== "all") list = list.filter(a => (a.dubType || "official") === dubFilter);
    return list;
  }, [activeCategory, allSeries, dubFilter]);

  const filteredMovies = useMemo(() => {
    let list = activeCategory !== "All" ? allMovies.filter(a => a.category === activeCategory) : allMovies;
    if (dubFilter !== "all") list = list.filter(a => (a.dubType || "official") === dubFilter);
    return list;
  }, [activeCategory, allMovies, dubFilter]);

  const categoryGroups = useMemo(() => {
    const groups: Record<string, AnimeItem[]> = {};
    filteredAnime.forEach((a) => {
      if (!groups[a.category]) groups[a.category] = [];
      groups[a.category].push(a);
    });
    return groups;
  }, [filteredAnime]);

  // Hero slides: randomized mix from all anime with backdrop
  const [heroRotation, setHeroRotation] = useState(0);
  
  useEffect(() => {
    const timer = setInterval(() => {
      setHeroRotation(prev => prev + 1);
    }, 60000); // shuffle every 60 seconds
    return () => clearInterval(timer);
  }, []);

  // Pinned hero posts from Firebase
  const [pinnedHeroPosts, setPinnedHeroPosts] = useState<any[]>([]);
  // Custom background image from Firebase
  const [customBgImage, setCustomBgImage] = useState<string>("");
  useEffect(() => {
    const unsub = onValue(ref(db, "settings/pinnedHeroPosts"), (snap) => {
      const data = snap.val();
      if (data) {
        const arr = Object.entries(data).map(([k, v]: any) => ({ _key: k, ...v }));
        arr.sort((a: any, b: any) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
        setPinnedHeroPosts(arr);
      } else {
        setPinnedHeroPosts([]);
      }
    });
    return () => unsub();
  }, []);

  // Custom background image listener
  useEffect(() => {
    const unsub = onValue(ref(db, "settings/customBgImage"), (snap) => {
      setCustomBgImage(snap.val() || "");
    });
    return () => unsub();
  }, []);

  // Active theme from Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, "settings/activeTheme"), (snap) => {
      const themeId = snap.val();
      if (themeId && themeId !== "default") {
        import("@/lib/themePresets").then(({ THEME_PRESETS }) => {
          const preset = THEME_PRESETS.find(t => t.id === themeId);
          if (preset) {
            import("@/lib/uiTheme").then(({ saveUiTheme }) => {
              saveUiTheme(preset.colors);
            });
          }
        });
      } else if (themeId === "default") {
        import("@/lib/uiTheme").then(({ clearUiTheme }) => {
          clearUiTheme();
        });
      }
    });
    return () => unsub();
  }, []);

  const heroSlides = useMemo(() => {
    const withBackdrop = allAnime.filter(a => a.backdrop);
    if (withBackdrop.length === 0) return [];
    
    // Seeded shuffle based on rotation
    const shuffled = [...withBackdrop];
    let seed = heroRotation;
    for (let i = shuffled.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    const randomSlides = shuffled.slice(0, Math.min(6, shuffled.length)).map(item => ({
      id: item.id,
      title: item.title,
      backdrop: item.backdrop,
      subtitle: item.type === "webseries" ? "Series" : "Movie",
      rating: item.rating,
      year: item.year,
      type: item.type,
      isCustom: false,
      description: "",
    }));

    // Prepend pinned posts (always first, no duplicates)
    if (pinnedHeroPosts.length > 0) {
      const pinnedSlides = pinnedHeroPosts.map(p => ({
        id: p.id,
        title: p.title,
        backdrop: p.backdrop,
        subtitle: p.isCustom ? (p.description?.slice(0, 40) || "Custom Post") : (p.type === "webseries" ? "Series" : "Movie"),
        rating: p.rating || "",
        year: p.year || "",
        type: p.type || "custom",
        isCustom: !!p.isCustom,
        description: p.description || "",
        titleColor: p.titleColor || "",
        titleFont: p.titleFont || "",
      }));
      const pinnedIds = new Set(pinnedSlides.map(s => s.id));
      const filtered = randomSlides.filter(s => !pinnedIds.has(s.id));
      return [...pinnedSlides, ...filtered].slice(0, 8);
    }

    return randomSlides;
  }, [allAnime, heroRotation, pinnedHeroPosts]);

  // ALL ANIME: deduplicated, loads incrementally every 10s
  const [allAnimeVisibleCount, setAllAnimeVisibleCount] = useState(6);
  
  useEffect(() => {
    if (animeSaltItems.length === 0) return;
    setAllAnimeVisibleCount(6); // reset on new data
    const timer = setInterval(() => {
      setAllAnimeVisibleCount(prev => {
        const max = animeSaltItems.length;
        if (prev >= max) { clearInterval(timer); return prev; }
        return Math.min(prev + 6, max);
      });
    }, 10000); // every 10 seconds
    return () => clearInterval(timer);
  }, [animeSaltItems.length]);

  const allAnimeSaltUnique = useMemo(() => {
    const score = (item: AnimeItem) => {
      const hasBackdrop = item.backdrop ? 1 : 0;
      const hasPoster = item.poster ? 1 : 0;
      return (hasBackdrop * 1_000_000_000) + (hasPoster * 500_000_000) + (item.createdAt || 0);
    };

    const bestByTitle = new Map<string, AnimeItem>();
    animeSaltItems.forEach((item) => {
      const key = item.title.toLowerCase().trim();
      const prev = bestByTitle.get(key);
      if (!prev || score(item) > score(prev)) {
        bestByTitle.set(key, item);
      }
    });

    return Array.from(bestByTitle.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [animeSaltItems]);

  const handleCardClick = async (anime: AnimeItem) => {
    // Cancel any stale in-flight AnimeSalt details requests when switching content
    detailsRequestRef.current += 1;

    // AnimeSalt source
    if (anime.source === "animesalt" && anime.slug) {
      const cachedDetails = detailsCacheRef.current.get(anime.id);
      if (cachedDetails) {
        dismissDetailsLoadingToast();
        setSelectedAnime(cachedDetails);
        return;
      }

      const requestId = detailsRequestRef.current;
      const toastId = showDetailsLoadingToast();

      try {
        let result: any = null;
        if (anime.type === 'movie') {
          result = await cachedApiCall(`movie_${anime.slug}`, () => animeSaltApi.getMovie(anime.slug));
          if (!result.success || !result.data) {
            result = await cachedApiCall(`series_${anime.slug}`, () => animeSaltApi.getSeries(anime.slug));
          }
        } else {
          result = await cachedApiCall(`series_${anime.slug}`, () => animeSaltApi.getSeries(anime.slug));
          if (!result.success || !result.data || (!result.data.seasons?.length && !result.data.movieEmbedUrl)) {
            result = await cachedApiCall(`movie_${anime.slug}`, () => animeSaltApi.getMovie(anime.slug));
          }
        }

        if (requestId !== detailsRequestRef.current) return;

        if (result.success && result.data) {
          const d = result.data;
          // Sanitize language - remove any JS code contamination
          let cleanLanguage = '';
          if (d.languages && Array.isArray(d.languages)) {
            cleanLanguage = d.languages
              .filter((l: string) => l && l.length < 30 && !/[{}()=>;]/.test(l))
              .join(", ");
          }
          // Sanitize storyline
          let cleanStoryline = d.storyline || "";
          cleanStoryline = cleanStoryline
            .replace(/\{[^}]*['"][a-z]{2,3}['"][^}]*\}/g, '')
            .replace(/setInterval\([\s\S]*/g, '')
            .replace(/document\.\w+\([^)]*\)/g, '')
            .replace(/(?:const|let|var)\s+\w+\s*=/g, '')
            .replace(/=>\s*\{[\s\S]*/g, '')
            .replace(/\s+/g, ' ')
            .trim();

          const normalizedPoster = anime.poster || d.poster || "";
          const normalizedBackdrop = anime.backdrop || d.backdrop || normalizedPoster;

          const fullAnime: AnimeItem = {
            ...anime,
            poster: normalizedPoster,
            backdrop: normalizedBackdrop,
            storyline: cleanStoryline,
            year: d.year || anime.year,
            language: cleanLanguage,
            type: d.seasons?.length > 0 ? "webseries" : (d.movieEmbedUrl ? "movie" : anime.type),
            seasons: d.seasons?.length > 0 ? await (async () => {
              // Check for customSeasons first (full editor data)
              let customSeasons: any[] | null = null;
              try {
                const csSnap = await get(ref(db, `animesaltSelected/${anime.slug}/customSeasons`));
                customSeasons = csSnap.val();
              } catch {}

              if (customSeasons && Array.isArray(customSeasons) && customSeasons.length > 0) {
                // Use custom seasons data directly
                return customSeasons.map((s: any) => ({
                  name: s.name,
                  episodes: s.episodes.map((ep: any) => {
                    if (ep.link) {
                      return {
                        episodeNumber: ep.number,
                        title: `Episode ${ep.number}`,
                        link: ep.link,
                        link480: ep.link480 || '',
                        link720: ep.link720 || '',
                        link1080: ep.link1080 || '',
                        link4k: ep.link4k || '',
                      };
                    }
                    if (ep.hasAnimeSaltLink && ep.slug) {
                      return {
                        episodeNumber: ep.number,
                        title: `Episode ${ep.number}`,
                        link: `animesalt://${ep.slug}`,
                      };
                    }
                    return {
                      episodeNumber: ep.number,
                      title: `Episode ${ep.number}`,
                      link: '',
                    };
                  }),
                }));
              }

              // Fallback to episodeOverrides
              let overrides: Record<string, any> = {};
              try {
                const snap = await get(ref(db, `animesaltSelected/${anime.slug}/episodeOverrides`));
                overrides = snap.val() || {};
              } catch {}

              return d.seasons.map((s: any, sIdx: number) => ({
                name: s.name,
                episodes: s.episodes.map((ep: any, eIdx: number) => {
                  const overrideKey = `s${sIdx}_e${eIdx}`;
                  const override = overrides[overrideKey];
                  if (override?.link) {
                    return {
                      episodeNumber: ep.number,
                      title: `Episode ${ep.number}`,
                      link: override.link,
                      link480: override.link480 || '',
                      link720: override.link720 || '',
                      link1080: override.link1080 || '',
                      link4k: override.link4k || '',
                    };
                  }
                  return {
                    episodeNumber: ep.number,
                    title: `Episode ${ep.number}`,
                    link: `animesalt://${ep.slug}`,
                  };
                }),
              }));
            })() : undefined,
            movieLink: d.movieEmbedUrl ? `animesalt_movie://${anime.slug}` : undefined,
          };

          if (requestId !== detailsRequestRef.current) return;
          detailsCacheRef.current.set(anime.id, fullAnime);
          setSelectedAnime(fullAnime);
        } else {
          toast.error("Failed to load");
        }
      } catch {
        if (requestId === detailsRequestRef.current) {
          toast.error("Failed to load details");
        }
      } finally {
        if (detailsLoadingToastRef.current === toastId) dismissDetailsLoadingToast();
      }
      return;
    }

    dismissDetailsLoadingToast();
    setSelectedAnime(anime);
  };

  const handlePlay = async (anime: AnimeItem, seasonIdx?: number, epIdx?: number) => {
    if (unlockBlocked) {
      toast.error("এই অ্যাকাউন্ট token misuse এর কারণে ভিডিও অ্যাক্সেস ব্লক");
      return;
    }

    dismissDetailsLoadingToast();

    let src = "";
    let subtitle = "";
    let qualityOptions: { label: string; src: string }[] = [];
    if (anime.type === "webseries" && anime.seasons && seasonIdx !== undefined && epIdx !== undefined) {
      const season = anime.seasons[seasonIdx];
      const episode = season.episodes[epIdx];
      src = getEpisodeSrc(episode);
      subtitle = `${season.name} - Episode ${episode.episodeNumber}`;
      if (episode.link480) qualityOptions.push({ label: "480p", src: episode.link480 });
      if (episode.link720) qualityOptions.push({ label: "720p", src: episode.link720 });
      if (episode.link1080) qualityOptions.push({ label: "1080p", src: episode.link1080 });
      if (episode.link4k) qualityOptions.push({ label: "4K", src: episode.link4k });
    } else if (anime.movieLink) {
      src = anime.movieLink;
      subtitle = "Movie";
      if (anime.movieLink480) qualityOptions.push({ label: "480p", src: anime.movieLink480 });
      if (anime.movieLink720) qualityOptions.push({ label: "720p", src: anime.movieLink720 });
      if (anime.movieLink1080) qualityOptions.push({ label: "1080p", src: anime.movieLink1080 });
      if (anime.movieLink4k) qualityOptions.push({ label: "4K", src: anime.movieLink4k });
    }

    // Handle AnimeSalt video - check ad-gate first
    if (src.startsWith("animesalt://")) {
      const hasAccess = await checkAndShowAdGate();
      if (!hasAccess) return;
      const epSlug = src.replace("animesalt://", "");
      try {
        const result = await cachedApiCall(`ep_${epSlug}`, () => animeSaltApi.getEpisode(epSlug));
        if (result.embedUrl) {
          // Save to watch history for Continue Watching
          addToWatchHistory(anime, seasonIdx, epIdx, true);
          const newState = {
            embedUrl: result.embedUrl,
            cleanEmbedUrl: getCleanEmbedUrl(result.embedUrl),
            title: anime.title,
            subtitle: subtitle || `Episode`,
            anime,
            seasonIdx,
            epIdx,
            allEmbeds: result.allEmbeds || [result.embedUrl],
            currentEmbedIdx: 0,
            cropMode: 'contain' as const,
            cropW: 0,
            cropH: 0,
            loading: false,
          };
          setSaltPlayerState(newState);
          setSelectedAnime(null);
        } else {
          toast.error("Video source not found");
        }
      } catch {
        toast.error("Failed to load video");
      }
      return;
    }

    // Handle AnimeSalt movie playback
    if (src.startsWith("animesalt_movie://")) {
      const hasAccess = await checkAndShowAdGate();
      if (!hasAccess) return;
      const movieSlug = src.replace("animesalt_movie://", "");
      try {
        const result = await cachedApiCall(`movie_${movieSlug}`, () => animeSaltApi.getMovie(movieSlug));
        if (result.success && result.data?.movieEmbedUrl) {
          addToWatchHistory(anime, undefined, undefined, true);
          const newState = {
            embedUrl: result.data.movieEmbedUrl,
            cleanEmbedUrl: getCleanEmbedUrl(result.data.movieEmbedUrl),
            title: anime.title,
            subtitle: "Movie",
            anime,
            allEmbeds: result.data.allEmbeds || [result.data.movieEmbedUrl],
            currentEmbedIdx: 0,
            cropMode: 'contain' as const,
            cropW: 0,
            cropH: 0,
            loading: false,
          };
          setSaltPlayerState(newState);
          setSelectedAnime(null);
        } else {
          toast.error("Movie source not found");
        }
      } catch {
        toast.error("Failed to load movie");
      }
      return;
    }

    if (src) {
      addToWatchHistory(anime, seasonIdx, epIdx);
      setPlayerState({ src, title: anime.title, subtitle, anime, seasonIdx, epIdx, qualityOptions });
      setSelectedAnime(null);
    }
  };

  const addToWatchHistory = (anime: AnimeItem, seasonIdx?: number, epIdx?: number, preserveProgress = false) => {
    try {
      const user = localStorage.getItem("rsanime_user");
      if (!user) return;
      const userId = JSON.parse(user).id;
      if (!userId) return;

      // Get device-specific path
      import("@/lib/premiumDevice").then(({ getDeviceId }) => {
        const deviceId = getDeviceId();
        const historyItem: any = {
          id: anime.id,
          title: anime.title,
          poster: anime.poster,
          year: anime.year,
          rating: anime.rating,
          type: anime.type,
          watchedAt: Date.now(),
        };

        if (seasonIdx !== undefined && epIdx !== undefined && anime.seasons) {
          const season = anime.seasons[seasonIdx];
          historyItem.episodeInfo = {
            season: seasonIdx + 1,
            episode: epIdx + 1,
            seasonName: season.name,
            episodeNumber: season.episodes[epIdx].episodeNumber,
            seasonIdx,
            epIdx,
          };
        }

        if (preserveProgress) {
          import("@/lib/firebase").then(({ update }) => {
            update(ref(db, `users/${userId}/watchHistory/${deviceId}/${anime.id}`), historyItem).catch(() => {});
          });
        } else {
          set(ref(db, `users/${userId}/watchHistory/${deviceId}/${anime.id}`), historyItem);
        }
      });
    } catch (e) {
      console.error("Failed to save watch history:", e);
    }
  };

  // Save video progress to Firebase (per-device)
  const saveVideoProgress = useCallback((currentTime: number, duration: number) => {
    if (!playerState) return;
    try {
      const user = localStorage.getItem("rsanime_user");
      if (!user) return;
      const userId = JSON.parse(user).id;
      if (!userId || !playerState.anime.id) return;

      import("@/lib/premiumDevice").then(({ getDeviceId }) => {
        const deviceId = getDeviceId();
        const updates: any = { currentTime, duration, watchedAt: Date.now() };
        const histRef = ref(db, `users/${userId}/watchHistory/${deviceId}/${playerState.anime.id}`);
        import("@/lib/firebase").then(({ update }) => {
          update(histRef, updates).catch(() => {});
        });
      });
    } catch {}
  }, [playerState]);

  const handleContinueWatching = async (item: any) => {
    if (unlockBlocked) {
      toast.error("এই অ্যাকাউন্ট token misuse এর কারণে ভিডিও অ্যাক্সেস ব্লক");
      return;
    }

    const anime = allAnime.find(a => a.id === item.id);
    if (!anime) return;

    // AnimeSalt source: directly play the last watched episode
    if (anime.source === "animesalt") {
      // If we have episode info, try to play that episode directly
      if (item.episodeInfo) {
        const hasAccess = await checkAndShowAdGate();
        if (!hasAccess) return;
        try {
          // Always check customSeasons from Firebase first (admin edited data)
          let customSeasons: any[] | null = null;
          try {
            const csSnap = await get(ref(db, `animesaltSelected/${anime.slug}/customSeasons`));
            customSeasons = csSnap.val();
          } catch {}

          let sIdx = item.episodeInfo.seasonIdx ?? (item.episodeInfo.season - 1);
          let eIdx = item.episodeInfo.epIdx ?? (item.episodeInfo.episode - 1);

          // If customSeasons exist, use them (fresh admin data)
          if (customSeasons && Array.isArray(customSeasons) && customSeasons.length > 0) {
            // Clamp indices to valid range
            if (sIdx >= customSeasons.length) sIdx = customSeasons.length - 1;
            const cSeason = customSeasons[sIdx];
            if (!cSeason?.episodes?.length) {
              handleCardClick(anime);
              return;
            }
            if (eIdx >= cSeason.episodes.length) eIdx = cSeason.episodes.length - 1;
            const cEp = cSeason.episodes[eIdx];

            const fullAnime: AnimeItem = {
              ...anime,
              seasons: customSeasons.map((s: any) => ({
                name: s.name,
                episodes: (s.episodes || []).map((ep: any) => ({
                  episodeNumber: ep.episodeNumber || ep.number || 0,
                  title: ep.title || `Episode ${ep.episodeNumber || ep.number || 0}`,
                  link: ep.link || (ep.slug ? `animesalt://${ep.slug}` : ''),
                  link480: ep.link480 || '', link720: ep.link720 || '',
                  link1080: ep.link1080 || '', link4k: ep.link4k || '',
                })),
              })),
            };

            if (cEp.link && !cEp.link.startsWith('animesalt://')) {
              // Custom link - use regular video player
              addToWatchHistory(anime, sIdx, eIdx, true);
              setSelectedAnime(fullAnime);
              handlePlay(fullAnime, sIdx, eIdx);
              return;
            }

            // AnimeSalt embed - get slug from custom data
            const epSlug = cEp.slug || (cEp.link?.replace('animesalt://', '') || '');
            if (epSlug) {
              const epResult = await cachedApiCall(`ep_${epSlug}`, () => animeSaltApi.getEpisode(epSlug));
              if (epResult.embedUrl) {
                addToWatchHistory(anime, sIdx, eIdx, true);
                setSaltPlayerState({
                  embedUrl: epResult.embedUrl,
                  cleanEmbedUrl: getCleanEmbedUrl(epResult.embedUrl),
                  title: anime.title,
                  subtitle: `${cSeason.name} - Episode ${cEp.episodeNumber || cEp.number || eIdx + 1}`,
                  anime: fullAnime, seasonIdx: sIdx, epIdx: eIdx,
                  allEmbeds: epResult.allEmbeds || [epResult.embedUrl],
                  currentEmbedIdx: 0, cropMode: 'contain', cropW: 0, cropH: 0, loading: false,
                });
                return;
              }
            }
            handleCardClick(anime);
            return;
          }

          // Fallback: no customSeasons, fetch from AnimeSalt API + episodeOverrides
          let result = await cachedApiCall(`series_${anime.slug}`, () => animeSaltApi.getSeries(anime.slug));
          if (!result.success || !result.data?.seasons?.length) {
            result = await cachedApiCall(`movie_${anime.slug}`, () => animeSaltApi.getMovie(anime.slug));
          }
          if (result.success && result.data?.seasons?.length) {
            if (sIdx >= result.data.seasons.length) sIdx = result.data.seasons.length - 1;
            const season = result.data.seasons[sIdx];
            if (eIdx >= (season?.episodes?.length || 0)) eIdx = Math.max(0, (season?.episodes?.length || 1) - 1);
            if (season?.episodes?.[eIdx]) {
              const ep = season.episodes[eIdx];

              let overrides: Record<string, any> = {};
              try {
                const overSnap = await get(ref(db, `animesaltSelected/${anime.slug}/episodeOverrides`));
                overrides = overSnap.val() || {};
              } catch {}
              const overrideKey = `s${sIdx}_e${eIdx}`;
              const override = overrides[overrideKey];

              const buildSeasons = () => result.data.seasons.map((s: any, si: number) => ({
                name: s.name,
                episodes: s.episodes.map((e: any, ei: number) => {
                  const oKey = `s${si}_e${ei}`;
                  const o = overrides[oKey];
                  if (o?.link) {
                    return { episodeNumber: e.number, title: `Episode ${e.number}`, link: o.link, link480: o.link480 || '', link720: o.link720 || '', link1080: o.link1080 || '', link4k: o.link4k || '' };
                  }
                  return { episodeNumber: e.number, title: `Episode ${e.number}`, link: `animesalt://${e.slug}` };
                }),
              }));

              if (override?.link) {
                const fullAnime: AnimeItem = { ...anime, seasons: buildSeasons() };
                addToWatchHistory(anime, sIdx, eIdx, true);
                setSelectedAnime(fullAnime);
                handlePlay(fullAnime, sIdx, eIdx);
                return;
              }

              const epResult = await cachedApiCall(`ep_${ep.slug}`, () => animeSaltApi.getEpisode(ep.slug));
              if (epResult.embedUrl) {
                const fullAnime: AnimeItem = { ...anime, seasons: buildSeasons() };
                addToWatchHistory(anime, sIdx, eIdx, true);
                setSaltPlayerState({
                  embedUrl: epResult.embedUrl, cleanEmbedUrl: getCleanEmbedUrl(epResult.embedUrl),
                  title: anime.title, subtitle: `${season.name} - Episode ${ep.number}`,
                  anime: fullAnime, seasonIdx: sIdx, epIdx: eIdx,
                  allEmbeds: epResult.allEmbeds || [epResult.embedUrl],
                  currentEmbedIdx: 0, cropMode: 'contain', cropW: 0, cropH: 0, loading: false,
                });
                return;
              }
            }
          }
        } catch {}
      }
      // Fallback: open details
      handleCardClick(anime);
      return;
    }

    // Use preserveProgress=true so we don't overwrite currentTime/duration
    if (item.episodeInfo) {
      const sIdx = item.episodeInfo.seasonIdx ?? (item.episodeInfo.season - 1);
      const eIdx = item.episodeInfo.epIdx ?? (item.episodeInfo.episode - 1);
      let src = "";
      let subtitle = "";
      let qualityOptions: { label: string; src: string }[] = [];
      if (anime.seasons) {
        const season = anime.seasons[sIdx];
        const episode = season.episodes[eIdx];
        src = getEpisodeSrc(episode);
        subtitle = `${season.name} - Episode ${episode.episodeNumber}`;
        if (episode.link480) qualityOptions.push({ label: "480p", src: episode.link480 });
        if (episode.link720) qualityOptions.push({ label: "720p", src: episode.link720 });
        if (episode.link1080) qualityOptions.push({ label: "1080p", src: episode.link1080 });
        if (episode.link4k) qualityOptions.push({ label: "4K", src: episode.link4k });
      }
      if (src) {
        addToWatchHistory(anime, sIdx, eIdx, true);
        setPlayerState({ src, title: anime.title, subtitle, anime, seasonIdx: sIdx, epIdx: eIdx, qualityOptions: qualityOptions.length > 0 ? qualityOptions : undefined });
        setSelectedAnime(null);
      }
    } else {
      if (anime.movieLink) {
        addToWatchHistory(anime, undefined, undefined, true);
        setPlayerState({ src: anime.movieLink, title: anime.title, subtitle: "Movie", anime });
        setSelectedAnime(null);
      }
    }
  };

  const handleHeroPlay = (index: number) => {
    const slide = heroSlides[index];
    if (!slide) return;
    if (slide.isCustom) {
      setCustomPostDetail({ title: slide.title, backdrop: slide.backdrop, description: slide.description || "" });
      return;
    }
    const anime = allAnime.find(a => a.id === slide.id);
    if (!anime) return;
    if (anime.type === "webseries" && anime.seasons && anime.seasons.length > 0 && anime.seasons[0].episodes?.length > 0) {
      handlePlay(anime, 0, 0);
    } else if (anime.movieLink) {
      handlePlay(anime);
    } else {
      handleCardClick(anime);
    }
  };

  const handleHeroInfo = (index: number) => {
    const slide = heroSlides[index];
    if (!slide) return;
    if (slide.isCustom) {
      setCustomPostDetail({ title: slide.title, backdrop: slide.backdrop, description: slide.description || "" });
      return;
    }
    const anime = allAnime.find(a => a.id === slide.id);
    if (anime) handleCardClick(anime);
  };

  const handleNavigate = (page: string) => {
    setShowProfile(page === "profile");
    setActivePage(page);
    setDubFilter("all");
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  const handleLogin = (userId: string) => {
    setIsLoggedIn(true);
  };

  const handleLogout = async () => {
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (u?.id) {
        const { unregisterCurrentDevice } = await import("@/lib/premiumDevice");
        await unregisterCurrentDevice(u.id);
      }
    } catch {}
    localStorage.removeItem("rsanime_user");
    localStorage.removeItem("rs_display_name");
    localStorage.removeItem("rs_profile_photo");
    setIsLoggedIn(false);
  };

  const currentEpisodeList = playerState?.anime.seasons?.[playerState.seasonIdx ?? 0]?.episodes.map((ep, i) => ({
    number: ep.episodeNumber,
    title: ep.title,
    active: i === (playerState?.epIdx ?? 0),
    onClick: () => {
      const season = playerState!.anime.seasons![playerState!.seasonIdx ?? 0];
      const clickedEp = season.episodes[i];
      const qOpts: { label: string; src: string }[] = [];
      if (clickedEp.link480) qOpts.push({ label: "480p", src: clickedEp.link480 });
      if (clickedEp.link720) qOpts.push({ label: "720p", src: clickedEp.link720 });
      if (clickedEp.link1080) qOpts.push({ label: "1080p", src: clickedEp.link1080 });
      if (clickedEp.link4k) qOpts.push({ label: "4K", src: clickedEp.link4k });
      addToWatchHistory(playerState!.anime, playerState!.seasonIdx, i);
      setPlayerState({
        ...playerState!,
        src: getEpisodeSrc(clickedEp),
        subtitle: `${season.name} - Episode ${clickedEp.episodeNumber}`,
        epIdx: i,
        qualityOptions: qOpts.length > 0 ? qOpts : undefined,
      });
    },
  }));

  const handleVideoPlayerSeasonChange = useCallback((newSeasonIdx: number) => {
    if (!playerState?.anime.seasons) return;
    const season = playerState.anime.seasons[newSeasonIdx];
    if (!season?.episodes?.length) return;
    const ep = season.episodes[0];
    const qOpts: { label: string; src: string }[] = [];
    if (ep.link480) qOpts.push({ label: "480p", src: ep.link480 });
    if (ep.link720) qOpts.push({ label: "720p", src: ep.link720 });
    if (ep.link1080) qOpts.push({ label: "1080p", src: ep.link1080 });
    if (ep.link4k) qOpts.push({ label: "4K", src: ep.link4k });
    addToWatchHistory(playerState.anime, newSeasonIdx, 0);
    setPlayerState({
      ...playerState,
      src: getEpisodeSrc(ep),
      subtitle: `${season.name} - Episode ${ep.episodeNumber}`,
      seasonIdx: newSeasonIdx,
      epIdx: 0,
      qualityOptions: qOpts.length > 0 ? qOpts : undefined,
    });
  }, [playerState]);

  // Suggested anime: prioritize same category, then same language, excluding current
  const suggestedAnime = useMemo(() => {
    const current = playerState?.anime || saltPlayerState?.anime;
    if (!current) return [];
    const currentCategory = (current.category || "").toLowerCase().trim();
    const currentLanguage = (current.language || "").toLowerCase().trim();
    
    const candidates = allAnime.filter(a => a.id !== current.id);
    
    // Score each candidate: category match = 10, language match = 3
    const scored = candidates.map(a => {
      let score = 0;
      const cat = (a.category || "").toLowerCase().trim();
      const lang = (a.language || "").toLowerCase().trim();
      if (currentCategory && cat === currentCategory) score += 10;
      if (currentLanguage && lang === currentLanguage) score += 3;
      // Bonus for same type (movie/webseries)
      if (a.type === current.type) score += 1;
      return { anime: a, score };
    });
    
    scored.sort((a, b) => b.score - a.score || Math.random() - 0.5);
    return scored.filter(s => s.score > 0).slice(0, 20).map(s => s.anime);
  }, [playerState?.anime, saltPlayerState?.anime, allAnime]);

  // Show login page if not logged in
  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // Show maintenance page if server is under maintenance
  if (maintenance?.active) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center z-[9999] px-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-destructive/5 blur-[100px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-primary/5 blur-[100px]" />
        </div>
        <div className="relative z-10 w-full max-w-[380px] text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-destructive/10 border-2 border-destructive/30 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold text-foreground mb-2">Server is Down</h1>
          <p className="text-sm text-secondary-foreground mb-4">Server Under Maintenance</p>
          
          <div className="glass-card p-5 rounded-2xl mb-5 text-left">
            <p className="text-sm text-foreground leading-relaxed">{maintenance.message || "Server is temporarily down for maintenance."}</p>
          </div>

          {maintenance.resumeDate && (
            <div className="glass-card p-4 rounded-xl border-primary/30 bg-primary/5">
              <p className="text-xs text-muted-foreground mb-1">Will resume on</p>
              <p className="text-lg font-bold text-primary">
                {new Date(maintenance.resumeDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </p>
            </div>
           )}

          {/* Telegram join section */}
          <div className="mt-6 w-full max-w-[380px]">
            <p className="text-xs text-muted-foreground text-center mb-3">
              Join our Telegram channel for all updates, announcements & details about this website.
            </p>
            <a
              href={TELEGRAM_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2.5 w-full py-3 rounded-xl font-semibold text-sm transition-all"
              style={{ background: 'linear-gradient(135deg, #0088cc, #00aaee)', color: '#fff' }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              Join Telegram Channel
            </a>
          </div>

          <p className="text-[10px] text-muted-foreground mt-6">RS ANIME • Please wait</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <SplashLoader />;
  }

  const getPageContent = () => {
    switch (activePage) {
      case "series":
        return (
          <div className="pt-[65px] pb-24 px-4">
            <h2 className="text-xl font-bold mb-3 flex items-center category-bar">Anime Series</h2>
            <div className="flex gap-2 mb-4">
              {(["all", "official", "fandub"] as const).map(dt => (
                <button key={dt} onClick={() => setDubFilter(dt)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${dubFilter === dt
                    ? dt === "fandub" ? "bg-orange-600 border-orange-500 text-white shadow-[0_2px_12px_rgba(234,88,12,0.3)]"
                      : "gradient-primary text-primary-foreground border-primary/30 shadow-[0_2px_12px_hsla(170,75%,45%,0.3)]"
                    : "bg-card border-border text-muted-foreground"}`}>
                  {dt === "all" ? "All" : dt === "official" ? "𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥𝐝𝐮𝐛" : "𝐅𝐚𝐧𝐝𝐮𝐛"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {filteredSeries.map((anime) => (
                <div key={anime.id} className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover bg-card" onClick={() => handleCardClick(anime)}>
                  <img src={anime.poster} alt={anime.title} className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 40%, transparent 70%)" }} />
                  <span className="absolute top-1.5 right-1.5 gradient-primary px-2 py-0.5 rounded text-[9px] font-bold">{anime.year}</span>
                  {anime.dubType === "fandub" && <span className="absolute top-1.5 left-1.5 bg-orange-600 px-1.5 py-0.5 rounded text-[8px] font-bold text-white">FAN</span>}
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <p className="text-[11px] font-semibold leading-tight line-clamp-2">{anime.title}</p>
                  </div>
                </div>
              ))}
            </div>
            {filteredSeries.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">No anime found</p>}
          </div>
        );
      case "movies":
        return (
          <div className="pt-[65px] pb-24 px-4">
            <h2 className="text-xl font-bold mb-3 flex items-center category-bar">Anime Movies</h2>
            <div className="flex gap-2 mb-4">
              {(["all", "official", "fandub"] as const).map(dt => (
                <button key={dt} onClick={() => setDubFilter(dt)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${dubFilter === dt
                    ? dt === "fandub" ? "bg-orange-600 border-orange-500 text-white shadow-[0_2px_12px_rgba(234,88,12,0.3)]"
                      : "gradient-primary text-primary-foreground border-primary/30 shadow-[0_2px_12px_hsla(170,75%,45%,0.3)]"
                    : "bg-card border-border text-muted-foreground"}`}>
                  {dt === "all" ? "All" : dt === "official" ? "𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥𝐝𝐮𝐛" : "𝐅𝐚𝐧𝐝𝐮𝐛"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {filteredMovies.map((anime) => (
                <div key={anime.id} className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover bg-card" onClick={() => handleCardClick(anime)}>
                  <img src={anime.poster} alt={anime.title} className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 40%, transparent 70%)" }} />
                  <span className="absolute top-1.5 right-1.5 gradient-primary px-2 py-0.5 rounded text-[9px] font-bold">{anime.year}</span>
                  {anime.dubType === "fandub" && <span className="absolute top-1.5 left-1.5 bg-orange-600 px-1.5 py-0.5 rounded text-[8px] font-bold text-white">FAN</span>}
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <p className="text-[11px] font-semibold leading-tight line-clamp-2">{anime.title}</p>
                  </div>
                </div>
              ))}
            </div>
            {filteredMovies.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">No anime found</p>}
          </div>
        );
      default:
        return (
          <>
            <HeroSlider slides={heroSlides} onPlay={handleHeroPlay} onInfo={handleHeroInfo} />

            <CategoryPills active={activeCategory} onSelect={setActiveCategory} categories={categories} />
            
            {activeCategory !== "All" ? (
              /* Show filtered grid when a specific category is selected */
              <div className="px-4 pb-6">
                <h2 className="text-base font-bold mb-3 flex items-center category-bar">{activeCategory}</h2>
                {filteredAnime.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2.5">
                    {filteredAnime.map((anime) => (
                      <div key={anime.id} className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover bg-card" onClick={() => handleCardClick(anime)}>
                        <img src={anime.poster} alt={anime.title} className="w-full h-full object-cover" loading="lazy" />
                        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 40%, transparent 70%)" }} />
                        <span className="absolute top-1.5 right-1.5 gradient-primary px-2 py-0.5 rounded text-[9px] font-bold">{anime.year}</span>
                        <div className="absolute bottom-0 left-0 right-0 p-2">
                          <p className="text-[11px] font-semibold leading-tight line-clamp-2">{anime.title}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-10">No anime found in this category</p>
                )}
              </div>
            ) : (
              <>
                {/* Continue Watching */}
                {continueWatching.length > 0 && (
                  <div className="px-4 mb-5">
                    <h3 className="text-base font-bold mb-3 flex items-center category-bar">Continue Watching</h3>
                    <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide">
                      {continueWatching.slice(0, 10).map((item: any) => (
                        <div key={item.id} onClick={() => handleContinueWatching(item)}
                          className="flex-shrink-0 w-[130px] cursor-pointer">
                          <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-card mb-1">
                            <img src={item.poster} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                            <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 40%, transparent 70%)" }} />
                            {item.currentTime && item.duration && (
                              <div className="absolute bottom-0 left-0 right-0 h-1 bg-foreground/20">
                                <div className="h-full bg-primary rounded-r" style={{ width: `${Math.min((item.currentTime / item.duration) * 100, 100)}%` }} />
                              </div>
                            )}
                            <div className="absolute bottom-1 left-1.5 right-1.5 pb-1">
                              <p className="text-[10px] font-semibold leading-tight line-clamp-2">{item.title}</p>
                              {item.episodeInfo && (
                                <p className="text-[8px] text-primary mt-0.5">
                                  S{item.episodeInfo.season} E{item.episodeInfo.episodeNumber || item.episodeInfo.episode}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <NewEpisodeReleases allAnime={allAnime} onCardClick={handleCardClick} />
                {filteredSeries.length > 0 && (
                  <AnimeSection title="Trending Anime Series" items={filteredSeries.slice(0, 10)} onCardClick={handleCardClick} onViewAll={() => setActivePage("series")} />
                )}
                {filteredMovies.length > 0 && (
                  <AnimeSection title="Popular Anime Movies" items={filteredMovies.slice(0, 10)} onCardClick={handleCardClick} onViewAll={() => setActivePage("movies")} />
                )}
                {Object.entries(categoryGroups)
                  .filter(([cat]) => cat !== 'AnimeSalt')
                  .map(([cat, items]) => (
                  <AnimeSection key={cat} title={cat} items={items.slice(0, 10)} onCardClick={handleCardClick} />
                ))}

                {/* ALL ANIME - loads incrementally every 10s */}
                {allAnimeSaltUnique.length > 0 && (
                  <div className="px-4 mb-6">
                    <h3 className="text-base font-bold mb-3 flex items-center category-bar">🔥 ALL ANIME</h3>
                    <div className="grid grid-cols-3 gap-2.5">
                      {allAnimeSaltUnique.slice(0, allAnimeVisibleCount).map((anime) => (
                        <div key={anime.id} className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover bg-card" onClick={() => handleCardClick(anime)}>
                          <img src={anime.poster} alt={anime.title} className="w-full h-full object-cover" loading="lazy" />
                          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 40%, transparent 70%)" }} />
                          {anime.year && <span className="absolute top-1.5 right-1.5 gradient-primary px-2 py-0.5 rounded text-[9px] font-bold">{anime.year}</span>}
                          <div className="absolute bottom-0 left-0 right-0 p-2">
                            <p className="text-[11px] font-semibold leading-tight line-clamp-2">{anime.title}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            <footer className="text-center py-8 pb-24 px-4 border-t border-border/30 mt-8">
              <div className="text-2xl font-black text-primary text-glow tracking-wide mb-2">RS ANIME</div>
              <p className="text-xs text-muted-foreground mb-3">Unlimited Anime Series & Movies</p>
              <p className="text-[10px] text-muted-foreground">© 2026 RS ANIME. All rights reserved.</p>
            </footer>
          </>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background" style={customBgImage ? { backgroundImage: `url(${customBgImage})`, backgroundSize: 'cover', backgroundAttachment: 'fixed', backgroundPosition: 'center' } : undefined}>
      <Header onSearchClick={() => setShowSearch(true)} onProfileClick={() => handleNavigate("profile")} onOpenContent={(id) => { const a = allAnime.find(x => x.id === id); if (a) handleCardClick(a); }} animeTitles={allAnime.map(a => a.title)} onLogoClick={() => setChatOpen(prev => !prev)} chatOpen={chatOpen} />
      <main>{getPageContent()}</main>
      <BottomNav activePage={activePage} onNavigate={handleNavigate} />

      <AnimatePresence>
        {showSearch && (
          <SearchPage allAnime={allAnime} onClose={() => setShowSearch(false)} onCardClick={(anime) => { setShowSearch(false); handleCardClick(anime); }} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProfile && (
          <ProfilePage onClose={() => { setShowProfile(false); setActivePage("home"); }} allAnime={allAnime} onCardClick={handleCardClick} onLogout={handleLogout} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedAnime && (
          <AnimeDetails anime={selectedAnime} onClose={() => setSelectedAnime(null)} onPlay={handlePlay} />
        )}
      </AnimatePresence>

      {/* Custom Post Detail View */}
      <AnimatePresence>
        {customPostDetail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-background/95 backdrop-blur-sm overflow-y-auto"
          >
            <div className="relative">
              <img
                src={customPostDetail.backdrop}
                alt={customPostDetail.title}
                className="w-full h-[45vh] object-cover"
              />
              <div className="absolute inset-0" style={{
                background: `linear-gradient(to top, hsl(var(--background)) 0%, hsla(var(--background)/0.5) 40%, transparent 70%)`
              }} />
              <button
                onClick={() => setCustomPostDetail(null)}
                className="absolute top-4 right-4 z-10 bg-background/70 backdrop-blur-sm rounded-full p-2"
              >
                <X className="w-5 h-5 text-foreground" />
              </button>
            </div>
            <div className="px-5 -mt-16 relative z-10 pb-20">
              <h1 className="text-2xl font-extrabold text-foreground mb-4 drop-shadow-lg">
                {customPostDetail.title}
              </h1>
              {customPostDetail.description && (
                <div className="bg-card rounded-2xl p-5" style={{ boxShadow: "var(--neu-shadow)" }}>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                    {customPostDetail.description}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {playerState && (
        <VideoPlayer
          src={playerState.src}
          title={playerState.title}
          subtitle={playerState.subtitle}
          poster={playerState.anime.poster}
          onClose={() => { setPlayerState(null); }}
          qualityOptions={playerState.qualityOptions}
          animeId={playerState.anime.id}
          onSaveProgress={saveVideoProgress}
          onNextEpisode={
            playerState.anime.type === "webseries" && playerState.seasonIdx !== undefined && playerState.epIdx !== undefined
              ? () => {
                  const season = playerState.anime.seasons![playerState.seasonIdx!];
                  const nextIdx = (playerState.epIdx! + 1) % season.episodes.length;
                  const nextEp = season.episodes[nextIdx];
                  const qOpts: { label: string; src: string }[] = [];
                  if (nextEp.link480) qOpts.push({ label: "480p", src: nextEp.link480 });
                  if (nextEp.link720) qOpts.push({ label: "720p", src: nextEp.link720 });
                  if (nextEp.link1080) qOpts.push({ label: "1080p", src: nextEp.link1080 });
                  if (nextEp.link4k) qOpts.push({ label: "4K", src: nextEp.link4k });
                  addToWatchHistory(playerState.anime, playerState.seasonIdx, nextIdx);
                  setPlayerState({
                    ...playerState,
                    src: getEpisodeSrc(nextEp),
                    subtitle: `${season.name} - Episode ${nextEp.episodeNumber}`,
                    epIdx: nextIdx,
                    qualityOptions: qOpts.length > 0 ? qOpts : undefined,
                  });
                }
              : undefined
          }
          episodeList={currentEpisodeList}
          seasons={playerState.anime.seasons}
          currentSeasonIdx={playerState.seasonIdx}
          onSeasonChange={handleVideoPlayerSeasonChange}
          suggestedAnime={suggestedAnime}
          onSuggestedClick={(anime) => { setPlayerState(null); handleCardClick(anime); }}
        />
      )}

      {/* AnimeSalt Ad Gate overlay */}
      {saltAdGateActive && (
        <div className="fixed inset-0 z-[10000] bg-background/95 backdrop-blur-md flex items-center justify-center p-6">
          <div className="glass-card-strong p-8 max-w-sm w-full text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Unlock Free Access</h2>
            <p className="text-sm text-muted-foreground">
              Open the link below to get <span className="text-primary font-semibold">24 hours</span> of free access to all content.
            </p>
            {saltAdGateLoading ? (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Generating link...</span>
              </div>
            ) : saltAdGateLink ? (
              <button
                onClick={() => { window.location.href = saltAdGateLink; }}
                className="w-full gradient-primary text-primary-foreground font-bold py-3.5 rounded-xl btn-glow flex items-center justify-center gap-2 text-[15px]"
              >
                <ExternalLink className="w-5 h-5" />
                Open Unlock Link
              </button>
            ) : null}
            <button
              onClick={() => setSaltAdGateActive(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* AnimeSalt iframe player with episode list & crop modes */}
      {saltPlayerState && (
        <SaltPlayer
          saltPlayerState={saltPlayerState}
          setSaltPlayerState={setSaltPlayerState}
          getCleanEmbedUrl={getCleanEmbedUrl}
          animeSaltApi={animeSaltApi}
          addToWatchHistory={addToWatchHistory}
          suggestedAnime={suggestedAnime}
          onSuggestedClick={(anime) => { setSaltPlayerState(null); handleCardClick(anime); }}
        />
      )}

      {/* Device Limit Warning Overlay - forces logout for over-limit users */}
      {deviceLimitWarning && (
        <div className="fixed inset-0 z-[99999] bg-background/98 backdrop-blur-md flex items-center justify-center p-6">
          <div className="w-full max-w-[380px] text-center space-y-5">
            <div className="w-20 h-20 mx-auto mb-2 rounded-full bg-destructive/10 border-2 border-destructive/30 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h2 className="text-xl font-extrabold text-destructive">Device Limit Exceeded!</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{deviceLimitWarning.message}</p>
            
            <div className="bg-card/50 rounded-xl p-4 text-left space-y-2">
              <p className="text-xs font-semibold text-foreground/70 mb-2">Currently logged in:</p>
              {deviceLimitWarning.devices.map((name, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="text-lg">📱</span>
                  <span>{name}</span>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Log out from another device, then log in again on this device.
            </p>

            <button
              onClick={handleLogout}
              className="w-full py-3.5 rounded-xl bg-destructive text-destructive-foreground font-bold text-sm flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      )}
      {/* Live Support Chat */}
      <LiveSupportChat
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        onAnimeSelect={(animeKey) => {
          const normalized = animeKey.trim().toLowerCase();
          const byId = allAnime.find((a) => a.id.toLowerCase() === normalized);
          if (byId) {
            handleCardClick(byId);
            return;
          }

          const byTitle = allAnime.filter((a) => a.title.toLowerCase() === normalized);
          const preferred = byTitle.find((a) => a.source !== "animesalt") || byTitle[0];
          if (preferred) {
            handleCardClick(preferred);
          }
        }}
        animeList={allAnime.map(a => ({
          title: a.title,
          type: a.type,
          category: a.category,
          rating: a.rating,
          year: a.year,
          storyline: a.storyline,
          dubType: a.dubType,
          source: a.source || "firebase",
          id: a.id,
          seasonCount: a.seasons?.length,
          episodeCount: a.seasons?.reduce((sum, s) => sum + (s.episodes?.length || 0), 0),
        }))}
      />

    </div>
  );
};

export default Index;
