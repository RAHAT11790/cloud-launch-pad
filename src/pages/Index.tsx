import { useState, useMemo, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import type { Episode } from "@/data/animeData";
import logoImg from "@/assets/logo.png";
import SplashLoader from "@/components/SplashLoader";
import { Lock, ExternalLink, Loader2 } from "lucide-react";
import { TELEGRAM_CHANNEL_URL } from "@/lib/siteConfig";

const isInvalidPlaybackUrl = (url?: string | null) => {
  const normalized = String(url || "").trim().toLowerCase().split("?")[0].split("#")[0];
  if (!normalized) return true;
  return /\.(avif|gif|jpe?g|png|svg|webp|bmp)$/i.test(normalized);
};

const isDirectMediaPlaybackUrl = (url?: string | null) => {
  const normalized = String(url || "").trim().toLowerCase();
  return /\.(m3u8|mp4|webm|ogg|mov|mkv)(?:[?#].*)?$/.test(normalized);
};

const getAnimeSaltPlaybackSources = (payload: any): { primarySrc: string; qualityOptions?: { label: string; src: string }[] } => {
  const seen = new Set<string>();
  const normalize = (value?: string | null) => String(value || "").trim();
  const pushUnique = (list: { label: string; src: string }[], label: string, src?: string | null) => {
    const cleanSrc = normalize(src);
    if (!cleanSrc || seen.has(cleanSrc)) return;
    seen.add(cleanSrc);
    list.push({ label, src: cleanSrc });
  };

  const directOptions: { label: string; src: string }[] = [];
  const embedOptions: { label: string; src: string }[] = [];

  const links = Array.isArray(payload?.links) ? payload.links : [];
  links.forEach((entry: any, index: number) => {
    const cleanSrc = normalize(entry?.url || entry?.src);
    if (!cleanSrc) return;
    const label = String(entry?.quality || entry?.label || `Source ${index + 1}`);
    if (isDirectMediaPlaybackUrl(cleanSrc)) {
      pushUnique(directOptions, label, cleanSrc);
    } else {
      pushUnique(embedOptions, `Server ${embedOptions.length + 1}`, cleanSrc);
    }
  });

  [payload?.streamUrl, payload?.videoUrl, payload?.directUrl, payload?.file].forEach((candidate, index) => {
    if (isDirectMediaPlaybackUrl(candidate)) {
      pushUnique(directOptions, index === 0 ? "Auto" : `Source ${index + 1}`, candidate);
    }
  });

  const embedCandidates = [payload?.embedUrl, payload?.movieEmbedUrl, ...(Array.isArray(payload?.allEmbeds) ? payload.allEmbeds : [])];
  embedCandidates.forEach((candidate) => {
    if (isDirectMediaPlaybackUrl(candidate)) {
      pushUnique(directOptions, `Source ${directOptions.length + 1}`, candidate);
    } else {
      pushUnique(embedOptions, `Server ${embedOptions.length + 1}`, candidate);
    }
  });

  if (directOptions.length > 0) {
    return {
      primarySrc: directOptions[0].src,
      qualityOptions: directOptions.length > 1 ? directOptions : undefined,
    };
  }

  return {
    primarySrc: embedOptions[0]?.src || "",
    qualityOptions: embedOptions.length > 1 ? embedOptions : undefined,
  };
};

// Helper: get best available src from episode (fallback if default link is empty)
const getEpisodeSrc = (ep?: Episode | null): string => {
  if (!ep) return "";
  return [ep.link, ep.link480, ep.link720, ep.link1080, ep.link4k].find((url) => !isInvalidPlaybackUrl(url)) || "";
};

const getMovieSrc = (anime: AnimeItem): string => {
  return [anime.movieLink, anime.movieLink480, anime.movieLink720, anime.movieLink1080, anime.movieLink4k].find((url) => !isInvalidPlaybackUrl(url)) || "";
};

const getEpisodeQualityOptions = (ep: Episode): { label: string; src: string }[] => {
  const qualityOptions: { label: string; src: string }[] = [];
  if (!isInvalidPlaybackUrl(ep.link480)) qualityOptions.push({ label: "480p", src: ep.link480! });
  if (!isInvalidPlaybackUrl(ep.link720)) qualityOptions.push({ label: "720p", src: ep.link720! });
  if (!isInvalidPlaybackUrl(ep.link1080)) qualityOptions.push({ label: "1080p", src: ep.link1080! });
  if (!isInvalidPlaybackUrl(ep.link4k)) qualityOptions.push({ label: "4K", src: ep.link4k! });
  return qualityOptions;
};
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import HeroSlider from "@/components/HeroSlider";
import CategoryPills from "@/components/CategoryPills";
import AnimeSection from "@/components/AnimeSection";
import AnimeDetails from "@/components/AnimeDetails";
import VideoPlayer from "@/components/VideoPlayer";
import NotificationsPage from "@/pages/NotificationsPage";
import ProfilePage from "@/components/ProfilePage";
import SearchPage from "@/components/SearchPage";
import NewEpisodeReleases from "@/components/NewEpisodeReleases";
import LoginPage from "@/components/LoginPage";
import { useFirebaseData } from "@/hooks/useFirebaseData";
import { useSelectedAnimeSalt } from "@/hooks/useSelectedAnimeSalt";
import { animeSaltApi } from "@/lib/animeSaltApi";
import LiveSupportChat from "@/components/LiveSupportChat";
import LiveTvPage from "@/components/LiveTvPage";
import { initializeUiTheme } from "@/lib/uiTheme";
import { useBranding } from "@/hooks/useBranding";

// Session cache for API responses to speed up continue watching
const apiCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 min
const cachedApiCall = async (key: string, fn: () => Promise<any>) => {
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    // Skip cache if previous response was a failure — allow retry
    const c: any = cached.data;
    const ok = c && (c.success === true || c.embedUrl || c.allEmbeds?.length || c.links?.length || c.data);
    if (ok) return cached.data;
  }
  // Try up to 2 times on failure (cloudflare worker / animesalt site flake)
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await fn();
      const ok = data && (data.success === true || data.embedUrl || data.allEmbeds?.length || data.links?.length || data.data);
      if (ok) {
        apiCache.set(key, { data, ts: Date.now() });
        return data;
      }
      lastErr = new Error("empty");
    } catch (e) { lastErr = e; }
    if (attempt === 0) await new Promise(r => setTimeout(r, 600));
  }
  throw lastErr || new Error("API failed");
};
import { db, ref, set, onValue, get } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";
import { toast } from "sonner";
// FCM removed — push notifications no longer used
import { isUnlockBlockActive } from "@/lib/unlockBlock";
import { getCurrentDeviceFreeAccessExpiry } from "@/lib/unlockAccess";
// Unlock gate toggle — admin can disable from Firebase (settings/unlockGateEnabled).
// When false: no flash, no redirect, no toast — players play instantly for everyone.
const isShortenerEnabled = async (): Promise<boolean> => {
  try {
    const snap = await get(ref(db, "settings/unlockGateEnabled"));
    const v = snap.val();
    if (v === false) return false;
    return true;
  } catch { return true; }
};

type MainPage = "home" | "series" | "livetv" | "movies";

const MAIN_PAGE_ORDER: MainPage[] = ["home", "series", "livetv", "movies"];

const isMainPage = (page: string): page is MainPage => MAIN_PAGE_ORDER.includes(page as MainPage);

const Index = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const animeRouteMatch = matchPath("/anime/:animeId", pathname);
  const watchRouteMatch = matchPath("/watch/:animeId", pathname);
  const isSearchRoute = pathname === "/search";
  const isNotificationsRoute = pathname === "/notifications";
  const isAnimeRoute = !!animeRouteMatch;
  const isWatchRoute = !!watchRouteMatch;
  const isRoutedOverlay = isSearchRoute || isNotificationsRoute || isAnimeRoute || isWatchRoute;
  const animeRouteId = animeRouteMatch?.params.animeId ? decodeURIComponent(animeRouteMatch.params.animeId) : null;
  const watchRouteAnimeId = watchRouteMatch?.params.animeId ? decodeURIComponent(watchRouteMatch.params.animeId) : null;
  const { webseries, movies, allAnime: firebaseAnime, categories, loading } = useFirebaseData();
  const { items: animeSaltItems, loading: saltLoading } = useSelectedAnimeSalt();
  const brandingConfig = useBranding();

  // AnimeSalt enabled state from Firebase
  const [animeSaltEnabled, setAnimeSaltEnabled] = useState(true);
  useEffect(() => {
    const unsub = onValue(ref(db, "settings/animeSaltEnabled"), (snap) => {
      const val = snap.val();
      setAnimeSaltEnabled(val !== false); // default true
    });
    return () => unsub();
  }, []);

  // Merge AnimeSalt items into main data lists (only when enabled)
  const activeSaltItems = useMemo(() => animeSaltEnabled ? animeSaltItems : [], [animeSaltEnabled, animeSaltItems]);

  const allAnime = useMemo(() => {
    const combined = [...firebaseAnime, ...activeSaltItems];
    combined.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return combined;
  }, [firebaseAnime, activeSaltItems]);

  const allSeries = useMemo(() => {
    const saltSeries = activeSaltItems.filter(i => i.type === 'webseries');
    return [...webseries, ...saltSeries];
  }, [webseries, activeSaltItems]);

  const allMovies = useMemo(() => {
    const saltMovies = activeSaltItems.filter(i => i.type === 'movie');
    return [...movies, ...saltMovies];
  }, [movies, activeSaltItems]);
  
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

  // Check if user is logged in (must have email - no guest accounts)
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    try {
      const u = localStorage.getItem("rsanime_user");
      if (!u) return false;
      const parsed = JSON.parse(u);
      return !!(parsed.id && parsed.email);
    } catch { return false; }
  });

  // Keep auth-like local user state synced (Header may create user after mount)
  useEffect(() => {
    const syncLoginState = () => {
      try {
        const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
        setIsLoggedIn(!!(u?.id && u?.email));
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
  const [globalFreeAccess, setGlobalFreeAccess] = useState(false);
  const [saltIsPremium, setSaltIsPremium] = useState<boolean | null>(null);
  const [userFreeAccessExpiresAt, setUserFreeAccessExpiresAt] = useState(0);
  const [freeAccessLoaded, setFreeAccessLoaded] = useState(false);
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

  // Force-logout if account was deleted by admin (guest cleanup, etc.)
  useEffect(() => {
    let uid = "";
    try { uid = JSON.parse(localStorage.getItem("rsanime_user") || "{}").id || ""; } catch {}
    if (!uid) return;
    const unsub = onValue(ref(db, `users/${uid}`), (snap) => {
      const data = snap.val();
      const sessionStartedAt = Number(localStorage.getItem("rs_session_started_at") || "0");
      const wasExplicitlyDeleted = !!data?.deleted || !!data?.deletedAt;
      const wasSessionRevoked = !!(data?.sessionRevokedAt && sessionStartedAt > 0 && Number(data.sessionRevokedAt) >= sessionStartedAt);
      if (!wasExplicitlyDeleted && !wasSessionRevoked) return;

      try {
        localStorage.removeItem("rsanime_user");
        localStorage.removeItem("rs_display_name");
        localStorage.removeItem("rs_profile_photo");
        localStorage.removeItem("rs_session_started_at");
      } catch {}
      setIsLoggedIn(false);
      setSelectedAnime(null);
      setPlayerState(null);
      setSaltPlayerState(null);
      try { window.history.replaceState({}, "", "/"); } catch {}
    });
    return () => unsub();
  }, [isLoggedIn]);

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
      setFreeAccessLoaded(true);
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

    setFreeAccessLoaded(false);

    let disposed = false;
    let accessRequestSeq = 0;

    const unsubAccess = onValue(ref(db, `users/${uid}/freeAccess`), async (snap) => {
      const requestSeq = ++accessRequestSeq;
      const data = snap.val();
      if (data?.active && Number(data.expiresAt) > Date.now()) {
        const allowedExpiry = getCurrentDeviceFreeAccessExpiry(data);
        if (disposed || requestSeq !== accessRequestSeq) return;
        setUserFreeAccessExpiresAt(allowedExpiry);
        setFreeAccessLoaded(true);
        setDeviceLimitWarning(null);
      } else {
        if (disposed || requestSeq !== accessRequestSeq) return;
        setUserFreeAccessExpiresAt(0);
        setFreeAccessLoaded(true);
        setDeviceLimitWarning(null);
      }
    });

    const unsubBlocked = onValue(ref(db, `users/${uid}/security/unlockBlocked`), (snap) => {
      setUnlockBlocked(isUnlockBlockActive(snap.val()));
    });

    return () => {
      disposed = true;
      unsubAccess();
      unsubBlocked();
    };
  }, [isLoggedIn]);

  // Device-limit popup inside the app is intentionally disabled.
  // Premium device limits are enforced only during login.

  // Welcome voice removed per user request

  const hasFreeAccess = useCallback((): boolean => {
    if (globalFreeAccess) return true;
    return userFreeAccessExpiresAt > Date.now();
  }, [globalFreeAccess, userFreeAccessExpiresAt]);

  const redirectToUnlockRequired = useCallback((anime: AnimeItem, seasonIdx?: number, epIdx?: number) => {
    try {
      sessionStorage.setItem("rs_pendingUnlockPlayback", JSON.stringify({
        animeId: anime.id,
        seasonIdx,
        epIdx,
        title: anime.title,
        poster: anime.poster,
        backdrop: anime.backdrop,
      }));
    } catch {}
    setPlayerState(null);
    setSaltPlayerState(null);
    setSelectedAnime(null);
    setSaltAdGateActive(false);
    navigate("/unlock-required");
  }, [navigate]);

  const checkAndShowAdGate = useCallback(async (anime?: AnimeItem, seasonIdx?: number, epIdx?: number): Promise<boolean> => {
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

    // If admin disabled the shortener system entirely, free users get instant access (no ad-gate).
    const shortenerOn = await isShortenerEnabled();
    if (!shortenerOn) return true;

    if (anime) {
      redirectToUnlockRequired(anime, seasonIdx, epIdx);
    }
    return false;
  }, [isLoggedIn, unlockBlocked, saltIsPremium, hasFreeAccess, redirectToUnlockRequired]);

  const [activePage, setActivePage] = useState<MainPage>(() => {
    try {
      const savedPage = sessionStorage.getItem("rs_activePage") || "home";
      return isMainPage(savedPage) ? savedPage : "home";
    } catch {
      return "home";
    }
  });
  const pageScrollPositions = useRef<Record<MainPage, number>>({ home: 0, series: 0, livetv: 0, movies: 0 });
  const [activeCategory, setActiveCategory] = useState("All");
  const [dubFilter, setDubFilter] = useState<"all" | "official" | "fandub">("all");
  const [selectedAnime, setSelectedAnime] = useState<AnimeItem | null>(null);
  const [customPostDetail, setCustomPostDetail] = useState<{ title: string; backdrop: string; description: string } | null>(null);
  const [pendingAnimeId, setPendingAnimeId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("anime");
    if (fromUrl) return fromUrl;
    // Restore from sessionStorage on refresh
    try { return sessionStorage.getItem("rs_selectedAnimeId"); } catch { return null; }
  });
  const showSearch = false;
  const [showProfile, setShowProfile] = useState(() => {
    try { return sessionStorage.getItem("rs_uiLayer") === "profile"; } catch { return false; }
  });
  const [chatOpen, setChatOpen] = useState(false);

  const buildAnimeRoute = useCallback((animeId: string) => `/anime/${encodeURIComponent(animeId)}`, []);
  const buildWatchRoute = useCallback((animeId: string, seasonIdx?: number, epIdx?: number) => {
    const params = new URLSearchParams();
    if (seasonIdx !== undefined) params.set("s", String(seasonIdx));
    if (epIdx !== undefined) params.set("e", String(epIdx));
    const qs = params.toString();
    return `/watch/${encodeURIComponent(animeId)}${qs ? `?${qs}` : ""}`;
  }, []);
  const stopAllPlayback = useCallback(() => {
    try {
      document.querySelectorAll("video, audio").forEach((node) => {
        const media = node as HTMLMediaElement;
        try { media.pause(); } catch {}
        try { media.currentTime = 0; } catch {}
        try { media.removeAttribute("src"); } catch {}
        try { media.load(); } catch {}
      });
      document.querySelectorAll('iframe[title="player"], iframe[src*="hf.space"], iframe[src*="huggingface"]').forEach((node) => {
        const frame = node as HTMLIFrameElement;
        try { frame.src = "about:blank"; } catch {}
      });
    } catch {}
  }, []);
  const hardCloseToHome = useCallback(() => {
    stopAllPlayback();
    setPlayerState(null);
    setSaltPlayerState(null);
    setSelectedAnime(null);
    setShowProfile(false);
    setCustomPostDetail(null);
    navigate("/", { replace: true });
  }, [navigate, stopAllPlayback]);
  const closeRouteLayer = useCallback((fallback: string = "/") => {
    stopAllPlayback();
    if (window.history.length > 1) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, stopAllPlayback]);

  // Persist activePage to sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem("rs_activePage", activePage); } catch {}
  }, [activePage]);

  // Persist selectedAnime ID to sessionStorage
  useEffect(() => {
    try {
      if (selectedAnime) {
        sessionStorage.setItem("rs_selectedAnimeId", selectedAnime.id);
      } else {
        sessionStorage.removeItem("rs_selectedAnimeId");
      }
    } catch {}
  }, [selectedAnime]);
  const [playerState, setPlayerState] = useState<{
    src: string;
    title: string;
    subtitle: string;
    anime: AnimeItem;
    seasonIdx?: number;
    epIdx?: number;
    qualityOptions?: { label: string; src: string }[];
    audioTracks?: { language: string; label: string; link: string; link480?: string; link720?: string; link1080?: string; link4k?: string }[];
    nextEpisodeSrc?: string;
    resumeTime?: number;
  } | null>(() => {
    try {
      const saved = sessionStorage.getItem("rs_playerState");
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });
  const playerStateRef = useRef(playerState);
  useEffect(() => { playerStateRef.current = playerState; }, [playerState]);

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
  } | null>(() => {
    try {
      const saved = sessionStorage.getItem("rs_saltPlayerState");
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });

  // Persist player states to sessionStorage for refresh recovery
  useEffect(() => {
    try {
      if (playerState) {
        const { qualityOptions, ...rest } = playerState;
        sessionStorage.setItem("rs_playerState", JSON.stringify(rest));
      } else {
        sessionStorage.removeItem("rs_playerState");
      }
    } catch {}
  }, [playerState]);

  useEffect(() => {
    try {
      if (saltPlayerState) {
        const { loading, ...rest } = saltPlayerState;
        sessionStorage.setItem("rs_saltPlayerState", JSON.stringify(rest));
      } else {
        sessionStorage.removeItem("rs_saltPlayerState");
      }
    } catch {}
  }, [saltPlayerState]);

  useEffect(() => {
    if (!saltPlayerState?.embedUrl || !saltPlayerState.anime) return;

    const embedServers = (saltPlayerState.allEmbeds || [saltPlayerState.embedUrl]).filter(Boolean);
    setPlayerState({
      src: saltPlayerState.embedUrl,
      title: saltPlayerState.title,
      subtitle: saltPlayerState.subtitle,
      anime: saltPlayerState.anime,
      seasonIdx: saltPlayerState.seasonIdx,
      epIdx: saltPlayerState.epIdx,
      qualityOptions: embedServers.length > 1
        ? embedServers.map((serverUrl: string, index: number) => ({ label: `Server ${index + 1}`, src: serverUrl }))
        : undefined,
      nextEpisodeSrc:
        saltPlayerState.anime.type === "webseries" &&
        saltPlayerState.anime.seasons &&
        saltPlayerState.seasonIdx !== undefined &&
        saltPlayerState.epIdx !== undefined
          ? getEpisodeSrc(saltPlayerState.anime.seasons[saltPlayerState.seasonIdx]?.episodes?.[saltPlayerState.epIdx + 1] as Episode)
          : undefined,
    });
    setSaltPlayerState(null);
  }, [saltPlayerState]);

  // Persist exact current UI layer so refresh returns to the same screen
  useEffect(() => {
    try {
      const layer = playerState
        ? "player"
        : saltPlayerState
          ? "saltPlayer"
          : selectedAnime
            ? "details"
            : showProfile
                ? "profile"
                : (activePage === "series" || activePage === "movies")
                  ? activePage
                  : "home";
      sessionStorage.setItem("rs_uiLayer", layer);
    } catch {}
  }, [playerState, saltPlayerState, selectedAnime, showProfile, activePage]);

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

  // Continue watching data (per-account, NOT per-device)
  const [continueWatching, setContinueWatching] = useState<any[]>([]);

  // Load continue watching from Firebase - per ACCOUNT
  useEffect(() => {
    if (!isLoggedIn) return;
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (!u.id) return;
      const whRef = ref(db, `users/${u.id}/watchHistory`);
      const unsub = onValue(whRef, (snapshot) => {
        const data = snapshot.val() || {};
        // Skip legacy per-device nested keys (objects without `id` field)
        const items = Object.values(data).filter((v: any) => v && typeof v === "object" && v.id) as any[];
        const withProgress = items.filter((i: any) => {
          if (i.id?.startsWith('as_')) return true;
          return i.currentTime && i.duration && (i.currentTime / i.duration) < 0.95;
        });
        withProgress.sort((a: any, b: any) => (b.watchedAt || 0) - (a.watchedAt || 0));
        setContinueWatching(withProgress);
      });
      return () => unsub();
    } catch {}
  }, [isLoggedIn]);
  // FCM token registration & forceNotifPrompt removed — push notifications fully disabled
  // Back button handler
  const getCurrentLayer = useCallback(() => {
    if (playerState) return "player";
    if (saltPlayerState) return "saltPlayer";
    if (selectedAnime) return "details";
    if (showProfile) return "profile";
    if (activePage === "series" || activePage === "movies" || activePage === "livetv") return activePage;
    return "home";
  }, [playerState, saltPlayerState, selectedAnime, showProfile, activePage]);


  useEffect(() => {
    try {
      const layer = sessionStorage.getItem("rs_uiLayer");
      if (layer === "profile") setShowProfile(true);
      if (layer === "series" || layer === "movies" || layer === "livetv") setActivePage(layer);
    } catch {}
  }, []);

  const handleBackPress = useCallback(() => {
    const layer = getCurrentLayer();
    if (layer === "player") { stopAllPlayback(); setPlayerState(null); return true; }
    if (layer === "saltPlayer") { stopAllPlayback(); setSaltPlayerState(null); return true; }
    if (layer === "details") { setSelectedAnime(null); return true; }
    if (layer === "profile") { setShowProfile(false); return true; }
    if (layer === "series" || layer === "movies" || layer === "livetv") {
      setVisualPage("home");
      setActivePage("home");
      return true;
    }
    return false;
  }, [activePage, getCurrentLayer, stopAllPlayback]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const animeId = params.get("anime");
    if (animeId) setPendingAnimeId(animeId);
  }, [location.search]);

  useEffect(() => {
    if (isAnimeRoute && animeRouteId) {
      if (selectedAnime?.id !== animeRouteId) setPendingAnimeId(animeRouteId);
      return;
    }
    if (!isWatchRoute && selectedAnime) {
      setSelectedAnime(null);
    }
  }, [animeRouteId, isAnimeRoute, isWatchRoute, selectedAnime]);

  useEffect(() => {
    // Routed pages (/search, /notifications) own their own history entry — do NOT
    // push our rsAnime guard state on top of them, otherwise the browser back
    // button needs two clicks (one to pop our duplicate, one to actually leave).
    if (isRoutedOverlay) return;

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
  }, [handleBackPress, isRoutedOverlay]);

  useEffect(() => {
    if (isRoutedOverlay) return;
    const layer = getCurrentLayer();
    if (layer !== "home") window.history.pushState({ rsAnime: true, page: layer }, "");
  }, [getCurrentLayer, isRoutedOverlay]);

  // Handle deep link: open anime detail from URL ?anime=ID (legacy query form)
  // For AnimeSalt shared links (as_<slug>) we must wait until the salt data
  // has finished loading — otherwise the lookup fires too early, finds nothing,
  // and the pending id gets cleared so the share link silently dies.
  useEffect(() => {
    if (!pendingAnimeId) return;
    if (allAnime.length === 0) return;

    const isSaltLink = pendingAnimeId.startsWith("as_");
    if (isSaltLink && saltLoading) return; // wait for AN data

    const found = allAnime.find((a) => a.id === pendingAnimeId);
    if (found) {
      setSelectedAnime(found);
      if (!pathname.startsWith("/anime/") && !pathname.startsWith("/watch/")) {
        navigate(buildAnimeRoute(found.id), { replace: true });
      }
      setPendingAnimeId(null);
      return;
    }

    // If we're still waiting for firebase or salt to load, don't clear yet.
    if (loading || (isSaltLink && saltLoading)) return;

    // For AN links: try to construct a minimal stub from the slug so the
    // details page still opens (it will fetch full metadata on its own path).
    if (isSaltLink) {
      const slug = pendingAnimeId.slice(3);
      if (slug) {
        const stub: AnimeItem = {
          id: pendingAnimeId,
          title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          poster: "",
          backdrop: "",
          year: "",
          rating: "",
          language: "",
          category: "AnimeSalt",
          type: "webseries",
          storyline: "",
          source: "animesalt",
          slug,
        };
        handleCardClick(stub);
        if (!pathname.startsWith("/anime/") && !pathname.startsWith("/watch/")) {
          navigate(buildAnimeRoute(stub.id), { replace: true });
        }
      }
    }

    setPendingAnimeId(null);
  }, [pendingAnimeId, allAnime, pathname, navigate, buildAnimeRoute, saltLoading, loading]);

  const filteredAnime = useMemo(() => {
    if (activeCategory !== "All") return allAnime.filter(a => a.category === activeCategory);
    return allAnime;
  }, [activeCategory, allAnime]);

  // Live popularity signals from analytics — used to rank Trending content
  const [analyticsViews, setAnalyticsViews] = useState<Record<string, any>>({});
  const [analyticsTotals, setAnalyticsTotals] = useState<Record<string, any>>({});
  const [analyticsClicks, setAnalyticsClicks] = useState<Record<string, any>>({});
  useEffect(() => {
    const unsubV = onValue(ref(db, "analytics/views"), (snap) => setAnalyticsViews(snap.val() || {}));
    const unsubT = onValue(ref(db, "analytics/totals/views"), (snap) => setAnalyticsTotals(snap.val() || {}));
    const unsubC = onValue(ref(db, "analytics/totals/clicks"), (snap) => setAnalyticsClicks(snap.val() || {}));
    return () => { unsubV(); unsubT(); unsubC(); };
  }, []);

  const getViewCount = useCallback((id: string): number => {
    // Prefer all-time totals counter (never reset)
    const t = analyticsTotals[id];
    let totalViews = 0;
    if (t) {
      if (typeof t === "number") totalViews = t;
      else if (typeof t === "object" && typeof t.count === "number") totalViews = t.count;
    }
    // Fallback / boost from per-day views
    const data = analyticsViews[id];
    if (data) {
      if (typeof data === "number") totalViews += data;
      else {
        Object.values(data).forEach((v: any) => {
          if (typeof v === "number") totalViews += v;
          else if (v && typeof v === "object") {
            Object.values(v).forEach((x: any) => { if (typeof x === "number") totalViews += x; });
          }
        });
      }
    }
    return totalViews;
  }, [analyticsViews, analyticsTotals]);

  const getClickCount = useCallback((id: string): number => {
    const c = analyticsClicks[id];
    if (!c) return 0;
    if (typeof c === "number") return c;
    if (typeof c === "object" && typeof c.count === "number") return c.count;
    return 0;
  }, [analyticsClicks]);

  // Popularity score = views*2 + clicks (views weighted higher since they imply real watching)
  const getPopularity = useCallback((id: string): number => {
    return getViewCount(id) * 2 + getClickCount(id);
  }, [getViewCount, getClickCount]);

  // Rotation tick — every 45s reshuffle ties so Trending feels alive even with stable counters
  const [trendingTick, setTrendingTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTrendingTick(x => x + 1), 45000);
    return () => clearInterval(t);
  }, []);

  // Trending Series — strictly popularity-ranked (NOT recency). Items with 0 popularity
  // shuffle randomly so Trending stays fresh and doesn't mirror "New Releases".
  const trendingSeries = useMemo(() => {
    let list = activeCategory !== "All" ? allSeries.filter(a => a.category === activeCategory) : allSeries;
    if (dubFilter !== "all") list = list.filter(a => (a.dubType || "official") === dubFilter);
    // Stable random offset per item, reshuffled by trendingTick
    const seed = trendingTick;
    const rand = (id: string) => {
      let h = seed;
      for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
      return (Math.abs(h) % 1000) / 1000;
    };
    return [...list].sort((a, b) => {
      const diff = getPopularity(b.id) - getPopularity(a.id);
      if (diff !== 0) return diff;
      return rand(a.id) - rand(b.id);
    });
  }, [activeCategory, allSeries, dubFilter, getPopularity, trendingTick]);

  // For grids/category pages — keep recency-based ordering
  const filteredSeries = useMemo(() => {
    let list = activeCategory !== "All" ? allSeries.filter(a => a.category === activeCategory) : allSeries;
    if (dubFilter !== "all") list = list.filter(a => (a.dubType || "official") === dubFilter);
    return [...list].sort((a, b) => {
      return ((b as any).updatedAt || (b as any).createdAt || 0) - ((a as any).updatedAt || (a as any).createdAt || 0);
    });
  }, [activeCategory, allSeries, dubFilter]);

  const filteredMovies = useMemo(() => {
    let list = activeCategory !== "All" ? allMovies.filter(a => a.category === activeCategory) : allMovies;
    if (dubFilter !== "all") list = list.filter(a => (a.dubType || "official") === dubFilter);
    return [...list].sort((a, b) => {
      const diff = getPopularity(b.id) - getPopularity(a.id);
      if (diff !== 0) return diff;
      return ((b as any).updatedAt || (b as any).createdAt || 0) - ((a as any).updatedAt || (a as any).createdAt || 0);
    });
  }, [activeCategory, allMovies, dubFilter, getPopularity]);

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

    // Reflect details view in the URL so back-button works as a real route.
    // Use replace when coming from a routed overlay (search/notifications) to
    // avoid stacking duplicate entries; push from anywhere else.
    const targetRoute = buildAnimeRoute(anime.id);
    if (location.pathname !== targetRoute) {
      const fromRoutedOverlay = isSearchRoute || isNotificationsRoute;
      navigate(targetRoute, { replace: fromRoutedOverlay });
    }

    // Track click for trending popularity (fire-and-forget)
    try {
      import("@/lib/firebase").then(({ runTransaction, ref: fbRef, db: fbDb }) => {
        runTransaction(fbRef(fbDb, `analytics/totals/clicks/${anime.id}`), (curr: any) => {
          const base = curr && typeof curr === "object" ? curr : { count: 0 };
          return { count: (base.count || 0) + 1, title: anime.title || base.title || "", lastClick: Date.now() };
        }).catch(() => {});
      });
    } catch {}


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
        // Step 1: Try Firebase customSeasons first (no API needed)
        let firebaseSeasons: any[] | null = null;
        let firebaseMeta: any = null;
        try {
          const [csSnap, metaSnap] = await Promise.all([
            get(ref(db, `animesaltSelected/${anime.slug}/customSeasons`)),
            get(ref(db, `animesaltSelected/${anime.slug}`)),
          ]);
          const cs = csSnap.val();
          if (cs && Array.isArray(cs) && cs.length > 0) firebaseSeasons = cs;
          firebaseMeta = metaSnap.val() || {};
        } catch {}

        // If Firebase has customSeasons, use directly without API
        if (firebaseSeasons) {
          if (requestId !== detailsRequestRef.current) return;
          const fullAnime: AnimeItem = {
            ...anime,
            poster: anime.poster || firebaseMeta?.poster || '',
            backdrop: anime.backdrop || firebaseMeta?.backdrop || anime.poster || '',
            storyline: firebaseMeta?.storyline || anime.storyline || '',
            year: firebaseMeta?.year || anime.year,
            language: firebaseMeta?.language || anime.language || '',
            type: 'webseries',
            seasons: firebaseSeasons.map((s: any) => ({
              name: s.name,
              episodes: (s.episodes || []).map((ep: any) => {
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
                  return { episodeNumber: ep.number, title: `Episode ${ep.number}`, link: `animesalt://${ep.slug}` };
                }
                return { episodeNumber: ep.number, title: `Episode ${ep.number}`, link: '' };
              }),
            })),
          };
          detailsCacheRef.current.set(anime.id, fullAnime);
          setSelectedAnime(fullAnime);
          dismissDetailsLoadingToast();
          return;
        }

        // Step 2: Try API call as fallback
        let result: any = null;
        try {
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
        } catch {
          // API failed — use metadata-only fallback below
          result = null;
        }

        if (requestId !== detailsRequestRef.current) return;

        if (result && result.success && result.data) {
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
          // API didn't return data — show anime with metadata from Firebase
          const fallbackAnime: AnimeItem = {
            ...anime,
            poster: anime.poster || '',
            backdrop: anime.backdrop || anime.poster || '',
            storyline: anime.storyline || '',
            year: anime.year || '',
            language: anime.language || '',
          };
          detailsCacheRef.current.set(anime.id, fallbackAnime);
          setSelectedAnime(fallbackAnime);
        }
      } catch {
        if (requestId === detailsRequestRef.current) {
          // Show anime with available metadata instead of error
          const fallbackAnime: AnimeItem = {
            ...anime,
            storyline: anime.storyline || '',
          };
          setSelectedAnime(fallbackAnime);
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

    if (!isLoggedIn) {
      toast.error("ভিডিও দেখতে লগইন করতে হবে");
      return;
    }

    if (!freeAccessLoaded) {
      return;
    }

    stopAllPlayback();
    const targetWatchRoute = buildWatchRoute(anime.id, seasonIdx, epIdx);
    if (location.pathname !== targetWatchRoute || location.search !== new URL(targetWatchRoute, window.location.origin).search) {
      navigate(targetWatchRoute);
    }

    if (!hasFreeAccess() && !saltIsPremium) {
      // If admin disabled the unlock gate entirely, skip redirect and play directly
      const shortenerOn = await isShortenerEnabled();
      if (shortenerOn) {
        redirectToUnlockRequired(anime, seasonIdx, epIdx);
        return;
      }
    }

    dismissDetailsLoadingToast();

    let src = "";
    let subtitle = "";
    let qualityOptions: { label: string; src: string }[] = [];
    let audioTracks: { language: string; label: string; link: string; link480?: string; link720?: string; link1080?: string; link4k?: string }[] | undefined;
    if (anime.type === "webseries" && anime.seasons && seasonIdx !== undefined && epIdx !== undefined) {
      const season = anime.seasons[seasonIdx];
      const episode = season.episodes[epIdx];
      src = getEpisodeSrc(episode);
      subtitle = `${season.name} - Episode ${episode.episodeNumber}`;
      if (episode.link480) qualityOptions.push({ label: "480p", src: episode.link480 });
      if (episode.link720) qualityOptions.push({ label: "720p", src: episode.link720 });
      if (episode.link1080) qualityOptions.push({ label: "1080p", src: episode.link1080 });
      if (episode.link4k) qualityOptions.push({ label: "4K", src: episode.link4k });
      if (episode.audioTracks?.length) audioTracks = episode.audioTracks;
      } else if (anime.movieLink) {
        src = getMovieSrc(anime);
      subtitle = "Movie";
        if (!isInvalidPlaybackUrl(anime.movieLink480)) qualityOptions.push({ label: "480p", src: anime.movieLink480! });
        if (!isInvalidPlaybackUrl(anime.movieLink720)) qualityOptions.push({ label: "720p", src: anime.movieLink720! });
        if (!isInvalidPlaybackUrl(anime.movieLink1080)) qualityOptions.push({ label: "1080p", src: anime.movieLink1080! });
        if (!isInvalidPlaybackUrl(anime.movieLink4k)) qualityOptions.push({ label: "4K", src: anime.movieLink4k! });
    }

    // Handle AnimeSalt video - check ad-gate first
    if (src.startsWith("animesalt://")) {
      const hasAccess = await checkAndShowAdGate(anime, seasonIdx, epIdx);
      if (!hasAccess) return;
      const epSlug = src.replace("animesalt://", "");
      try {
        const result = await cachedApiCall(`ep_${epSlug}`, () => animeSaltApi.getEpisode(epSlug));
        const { primarySrc, qualityOptions: sourceOptions } = getAnimeSaltPlaybackSources(result || {});
        if (primarySrc) {
          addToWatchHistory(anime, seasonIdx, epIdx, true);
          setPlayerState({
            src: primarySrc,
            title: anime.title,
            subtitle: subtitle || `Episode`,
            anime,
            seasonIdx,
            epIdx,
            qualityOptions: sourceOptions,
            nextEpisodeSrc:
              anime.type === "webseries" && anime.seasons && seasonIdx !== undefined && epIdx !== undefined
                ? getEpisodeSrc(anime.seasons[seasonIdx]?.episodes?.[epIdx + 1] as Episode)
                : undefined,
          } as any);
          setSelectedAnime(null);
        } else {
          console.warn("[AN] no source for episode", epSlug, result);
          toast.error("Episode source not available. Try another server or episode.");
        }
      } catch (e) {
        console.warn("[AN] episode load failed", epSlug, e);
        toast.error("Failed to load episode. Please try again.");
      }
      return;
    }

    // Handle AnimeSalt movie playback
    if (src.startsWith("animesalt_movie://")) {
      const hasAccess = await checkAndShowAdGate(anime, seasonIdx, epIdx);
      if (!hasAccess) return;
      const movieSlug = src.replace("animesalt_movie://", "");
      try {
        const result = await cachedApiCall(`movie_${movieSlug}`, () => animeSaltApi.getMovie(movieSlug));
        const { primarySrc, qualityOptions: sourceOptions } = getAnimeSaltPlaybackSources(result.success ? result.data : result);
        if (primarySrc) {
          addToWatchHistory(anime, undefined, undefined, true);
          setPlayerState({
            src: primarySrc,
            title: anime.title,
            subtitle: "Movie",
            anime,
            qualityOptions: sourceOptions,
          } as any);
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
      setPlayerState({
        src,
        title: anime.title,
        subtitle,
        anime,
        seasonIdx,
        epIdx,
        qualityOptions,
        audioTracks,
        nextEpisodeSrc:
          anime.type === "webseries" && anime.seasons && seasonIdx !== undefined && epIdx !== undefined
            ? getEpisodeSrc(anime.seasons[seasonIdx]?.episodes?.[epIdx + 1] as Episode)
            : undefined,
      });
      setSelectedAnime(null);
    }
  };

  useEffect(() => {
    if (!isWatchRoute) {
      stopAllPlayback();
      if (playerStateRef.current) setPlayerState(null);
      return;
    }
    if (!watchRouteAnimeId || allAnime.length === 0 || !freeAccessLoaded) return;

    const params = new URLSearchParams(location.search);
    const nextSeasonIdx = params.get("s") !== null ? Number(params.get("s")) : undefined;
    const nextEpIdx = params.get("e") !== null ? Number(params.get("e")) : undefined;
    const targetAnime = allAnime.find((item) => item.id === watchRouteAnimeId);
    if (!targetAnime) return;

    const current = playerStateRef.current;
    const sameAnime = current?.anime.id === watchRouteAnimeId;
    const sameSeason = (current?.seasonIdx ?? undefined) === nextSeasonIdx;
    const sameEpisode = (current?.epIdx ?? undefined) === nextEpIdx;
    if (sameAnime && sameSeason && sameEpisode && current) return;

    void handlePlay(targetAnime, nextSeasonIdx, nextEpIdx);
  }, [allAnime, freeAccessLoaded, isWatchRoute, location.search, watchRouteAnimeId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("resumeUnlock") !== "1" || allAnime.length === 0 || !freeAccessLoaded) return;

    // Wait until free access state is loaded before triggering playback,
    // otherwise handlePlay will redirect back to /unlock-required (loop).
    if (!hasFreeAccess() && !saltIsPremium) return;

    let pending: { animeId: string; seasonIdx?: number; epIdx?: number } | null = null;
    try {
      const raw = sessionStorage.getItem("rs_pendingUnlockPlayback");
      pending = raw ? JSON.parse(raw) : null;
    } catch {}

    window.history.replaceState({}, "", window.location.pathname);
    if (!pending?.animeId) return;

    const anime = allAnime.find((item) => item.id === pending?.animeId);
    if (!anime) return;

    try { sessionStorage.removeItem("rs_pendingUnlockPlayback"); } catch {}
    handlePlay(anime, pending.seasonIdx, pending.epIdx);
  }, [allAnime, handlePlay, userFreeAccessExpiresAt, globalFreeAccess, saltIsPremium, freeAccessLoaded]);

  const addToWatchHistory = (anime: AnimeItem, seasonIdx?: number, epIdx?: number, preserveProgress = false) => {
    try {
      const user = localStorage.getItem("rsanime_user");
      if (!user) return;
      const userId = JSON.parse(user).id;
      if (!userId) return;

      const historyItem: any = {
        id: anime.id,
        source: anime.source || "firebase",
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
          update(ref(db, `users/${userId}/watchHistory/${anime.id}`), historyItem).catch(() => {});
        });
      } else {
        set(ref(db, `users/${userId}/watchHistory/${anime.id}`), historyItem);
      }
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

      const updates: any = { currentTime, duration, watchedAt: Date.now() };
      const histRef = ref(db, `users/${userId}/watchHistory/${playerState.anime.id}`);
      import("@/lib/firebase").then(({ update }) => {
        update(histRef, updates).catch(() => {});
      });
    } catch {}
  }, [playerState]);

  const handleContinueWatching = async (item: any) => {
    if (unlockBlocked) {
      toast.error("এই অ্যাকাউন্ট token misuse এর কারণে ভিডিও অ্যাক্সেস ব্লক");
      return;
    }

    const preferredSource = item.source || "firebase";
    const anime =
      allAnime.find(a => a.id === item.id && (a.source || "firebase") === preferredSource) ||
      allAnime.find(a => a.id === item.id && (a.source || "firebase") === "firebase") ||
      allAnime.find(a => a.id === item.id);
    if (!anime) return;

    // AnimeSalt source: directly play the last watched episode
    if (anime.source === "animesalt") {
      // If we have episode info, try to play that episode directly
      if (item.episodeInfo) {
        const hasAccess = await checkAndShowAdGate(anime, item.episodeInfo?.seasonIdx, item.episodeInfo?.epIdx);
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
              const targetWatchRoute = buildWatchRoute(anime.id, sIdx, eIdx);
              if (`${location.pathname}${location.search}` !== targetWatchRoute) {
                navigate(targetWatchRoute);
              }
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

              const targetWatchRoute = buildWatchRoute(anime.id, sIdx, eIdx);
              if (`${location.pathname}${location.search}` !== targetWatchRoute) {
                navigate(targetWatchRoute);
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
        const hasAccess = await checkAndShowAdGate(anime, sIdx, eIdx);
        if (!hasAccess) return;
        const targetWatchRoute = buildWatchRoute(anime.id, sIdx, eIdx);
        if (`${location.pathname}${location.search}` !== targetWatchRoute) {
          navigate(targetWatchRoute);
        }
        const episode = anime.seasons?.[sIdx]?.episodes?.[eIdx];
        addToWatchHistory(anime, sIdx, eIdx, true);
        setPlayerState({
          src,
          title: anime.title,
          subtitle,
          anime,
          seasonIdx: sIdx,
          epIdx: eIdx,
          audioTracks: episode?.audioTracks,
          resumeTime: item.currentTime || 0,
          qualityOptions: qualityOptions.length > 0 ? qualityOptions : undefined,
          nextEpisodeSrc: getEpisodeSrc(anime.seasons?.[sIdx]?.episodes?.[eIdx + 1] as Episode),
        });
        setSelectedAnime(null);
      }
    } else {
      if (anime.movieLink) {
        const hasAccess = await checkAndShowAdGate(anime);
        if (!hasAccess) return;
        const targetWatchRoute = buildWatchRoute(anime.id);
        if (`${location.pathname}${location.search}` !== targetWatchRoute) {
          navigate(targetWatchRoute);
        }
        addToWatchHistory(anime, undefined, undefined, true);
        const movieSrc = getMovieSrc(anime);
        if (!movieSrc) {
          handleCardClick(anime);
          return;
        }
        setPlayerState({
          src: movieSrc,
          title: anime.title,
          subtitle: "Movie",
          anime,
          qualityOptions: [
            !isInvalidPlaybackUrl(anime.movieLink480) ? { label: "480p", src: anime.movieLink480! } : null,
            !isInvalidPlaybackUrl(anime.movieLink720) ? { label: "720p", src: anime.movieLink720! } : null,
            !isInvalidPlaybackUrl(anime.movieLink1080) ? { label: "1080p", src: anime.movieLink1080! } : null,
            !isInvalidPlaybackUrl(anime.movieLink4k) ? { label: "4K", src: anime.movieLink4k! } : null,
          ].filter(Boolean) as { label: string; src: string }[],
        });
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
    localStorage.removeItem("rs_session_started_at");
    setIsLoggedIn(false);
  };

  const handleLogoutAllDevices = async () => {
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (u?.id) {
        const { logoutAllDevices } = await import("@/lib/premiumDevice");
        await logoutAllDevices(u.id);
      }
    } catch {}

    localStorage.removeItem("rsanime_user");
    localStorage.removeItem("rs_display_name");
    localStorage.removeItem("rs_profile_photo");
    localStorage.removeItem("rs_session_started_at");
    setDeviceLimitWarning(null);
    setUserFreeAccessExpiresAt(0);
    setIsLoggedIn(false);
    toast.success("All devices logged out. Please log in again.");
  };

  const currentEpisodeList = playerState?.anime.seasons?.[playerState.seasonIdx ?? 0]?.episodes.map((ep, i) => ({
    number: ep.episodeNumber,
    title: ep.title,
    active: i === (playerState?.epIdx ?? 0),
    onClick: async () => {
      const season = playerState!.anime.seasons![playerState!.seasonIdx ?? 0];
      const clickedEp = season.episodes[i];
      const hasAccess = await checkAndShowAdGate(playerState!.anime, playerState!.seasonIdx, i);
      if (!hasAccess) return;
      let nextSrc = getEpisodeSrc(clickedEp);
      let qOpts = getEpisodeQualityOptions(clickedEp);
      if (playerState?.anime.source === "animesalt" && String(clickedEp.link || "").startsWith("animesalt://")) {
        const epSlug = String(clickedEp.link).replace("animesalt://", "");
        try {
          const epResult = await animeSaltApi.getEpisode(epSlug);
          const embedServers = (epResult.allEmbeds || [epResult.embedUrl]).filter(Boolean);
          nextSrc = epResult.embedUrl || nextSrc;
          qOpts = embedServers.length > 1
            ? embedServers.map((serverUrl: string, index: number) => ({ label: `Server ${index + 1}`, src: serverUrl }))
            : [];
        } catch {}
      }
      addToWatchHistory(playerState!.anime, playerState!.seasonIdx, i);
      const nextState = {
        ...playerState!,
        src: nextSrc,
        subtitle: `${season.name} - Episode ${clickedEp.episodeNumber}`,
        epIdx: i,
        qualityOptions: qOpts.length > 0 ? qOpts : undefined,
        nextEpisodeSrc: undefined,
      };
      playerStateRef.current = nextState; // sync ref BEFORE navigate fires the route effect
      setPlayerState(nextState);
      navigate(buildWatchRoute(playerState!.anime.id, playerState!.seasonIdx, i), { replace: true });
    },
  }));

  const handleVideoPlayerSeasonChange = useCallback(async (newSeasonIdx: number) => {
    if (!playerState?.anime.seasons) return;
    const season = playerState.anime.seasons[newSeasonIdx];
    if (!season?.episodes?.length) return;
    const ep = season.episodes[0];
    const hasAccess = await checkAndShowAdGate(playerState.anime, newSeasonIdx, 0);
    if (!hasAccess) return;
    let nextSrc = getEpisodeSrc(ep);
    let qOpts: { label: string; src: string }[] = getEpisodeQualityOptions(ep);
    if (playerState.anime.source === "animesalt" && String(ep.link || "").startsWith("animesalt://")) {
      const epSlug = String(ep.link).replace("animesalt://", "");
      try {
        const epResult = await animeSaltApi.getEpisode(epSlug);
        const embedServers = (epResult.allEmbeds || [epResult.embedUrl]).filter(Boolean);
        nextSrc = epResult.embedUrl || nextSrc;
        qOpts = embedServers.length > 1
          ? embedServers.map((serverUrl: string, index: number) => ({ label: `Server ${index + 1}`, src: serverUrl }))
          : [];
      } catch {}
    }
    addToWatchHistory(playerState.anime, newSeasonIdx, 0);
    const nextState = {
      ...playerState,
      src: nextSrc,
      subtitle: `${season.name} - Episode ${ep.episodeNumber}`,
      seasonIdx: newSeasonIdx,
      epIdx: 0,
      qualityOptions: qOpts.length > 0 ? qOpts : undefined,
      nextEpisodeSrc: undefined,
    };
    playerStateRef.current = nextState;
    setPlayerState(nextState);
    navigate(buildWatchRoute(playerState.anime.id, newSeasonIdx, 0), { replace: true });
  }, [checkAndShowAdGate, playerState, navigate, buildWatchRoute]);

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
    return scored.filter(s => s.score > 0).slice(0, 8).map(s => s.anime);
  }, [playerState?.anime, saltPlayerState?.anime, allAnime]);

  useEffect(() => {
    const warmProfile = () => import("@/components/ProfilePage");
    if (showProfile) {
      void warmProfile();
      return;
    }
    const idle = (window as any).requestIdleCallback;
    if (typeof idle === "function") {
      const id = idle(warmProfile);
      return () => {
        try { (window as any).cancelIdleCallback?.(id); } catch {}
      };
    }
    const timer = window.setTimeout(() => {
      void warmProfile();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [showProfile]);

  // ===== SWIPE NAVIGATION — ALL PAGES ALWAYS RENDERED (ZERO FLASH) =====
  const [visualPage, setVisualPage] = useState<MainPage>(activePage);
  const activePageIdx = MAIN_PAGE_ORDER.indexOf(activePage);
  const swipeTrackRef = useRef<HTMLDivElement | null>(null);
  const swipeRafRef = useRef<number | null>(null);
  const isSwipeAnimatingRef = useRef(false);

  // Sync visualPage when activePage changes
  useEffect(() => { setVisualPage(activePage); }, [activePage]);

  const applyStripTransform = useCallback((pageIdx: number, dx = 0, animate = false) => {
    const track = swipeTrackRef.current;
    if (!track) return;
    track.style.transition = animate ? "transform 280ms cubic-bezier(0.25, 0.1, 0.25, 1)" : "none";
    track.style.transform = `translate3d(calc(-${pageIdx * 100}vw + ${dx}px), 0, 0)`;
  }, []);

  const queueStripTransform = useCallback((pageIdx: number, dx = 0, animate = false) => {
    if (swipeRafRef.current !== null) cancelAnimationFrame(swipeRafRef.current);
    swipeRafRef.current = requestAnimationFrame(() => {
      applyStripTransform(pageIdx, dx, animate);
      swipeRafRef.current = null;
    });
  }, [applyStripTransform]);

  const pageContainerRefs = useRef<Record<MainPage, HTMLDivElement | null>>({ home: null, series: null, livetv: null, movies: null });

  const restorePageScroll = useCallback((_page: MainPage) => {
    // Each page has its own scroll container now — no need to restore window scroll
  }, []);

  const handleNavigate = useCallback((page: string) => {
    if (page === "profile") {
      void import("@/components/ProfilePage");
      setShowProfile(true);
      return;
    }
    const nextPage = isMainPage(page) ? page : "home";
    if (showProfile) {
      setShowProfile(false);
      if (nextPage === activePage) { restorePageScroll(activePage); return; }
    }
    if (nextPage === activePage) return;

    setDubFilter("all");

    const nextIdx = MAIN_PAGE_ORDER.indexOf(nextPage);
    // Update BottomNav immediately
    setVisualPage(nextPage);
    // Animate strip to target
    isSwipeAnimatingRef.current = true;
    queueStripTransform(nextIdx, 0, true);

    const onDone = () => {
      isSwipeAnimatingRef.current = false;
      setActivePage(nextPage);
      restorePageScroll(nextPage);
    };
    const track = swipeTrackRef.current;
    if (track) {
      const handler = () => { track.removeEventListener("transitionend", handler); onDone(); };
      track.addEventListener("transitionend", handler);
      // Safety fallback
      setTimeout(() => { track.removeEventListener("transitionend", handler); onDone(); }, 350);
    } else {
      onDone();
    }
  }, [activePage, showProfile, queueStripTransform, restorePageScroll]);

  // Set initial position without animation
  useLayoutEffect(() => {
    if (showProfile) return;
    applyStripTransform(activePageIdx, 0, false);
  }, [activePage, applyStripTransform, activePageIdx, showProfile]);

  useEffect(() => {
    return () => { if (swipeRafRef.current !== null) cancelAnimationFrame(swipeRafRef.current); };
  }, []);

  // Memoized page contents for the horizontal strip



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

          <p className="text-[10px] text-muted-foreground mt-6">{brandingConfig.siteName} • Please wait</p>
        </div>
      </div>
    );
  }

  if (loading && !playerState && !saltPlayerState && !isSearchRoute && !isNotificationsRoute) {
    return <SplashLoader />;
  }

  const getPageContent_series = () => (
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

  const getPageContent_movies = () => (
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

  const getPageContent_home = () => (
    <>
      <HeroSlider slides={heroSlides} onPlay={handleHeroPlay} onInfo={handleHeroInfo} />
      <CategoryPills active={activeCategory} onSelect={setActiveCategory} categories={categories} />
      {activeCategory !== "All" ? (
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
          {continueWatching.length > 0 && (
            <div className="px-4 mb-5">
              <h3 className="text-base font-bold mb-3 flex items-center category-bar">Continue Watching</h3>
              <div data-no-swipe="true" className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide" style={{ touchAction: "pan-x pan-y" }}>
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
          {trendingSeries.length > 0 && (
            <AnimeSection title="🔥 Trending Anime Series" items={trendingSeries.slice(0, 10)} onCardClick={handleCardClick} onViewAll={() => setActivePage("series")} />
          )}
          {filteredMovies.length > 0 && (
            <AnimeSection title="Popular Anime Movies" items={filteredMovies.slice(0, 10)} onCardClick={handleCardClick} onViewAll={() => setActivePage("movies")} />
          )}
          {Object.entries(categoryGroups)
            .filter(([cat]) => cat !== 'AnimeSalt')
            .map(([cat, items]) => (
            <AnimeSection key={cat} title={cat} items={items.slice(0, 10)} onCardClick={handleCardClick} />
          ))}

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
        <div className="text-2xl font-black text-primary text-glow tracking-wide mb-2">{brandingConfig.siteName}</div>
        <p className="text-xs text-muted-foreground mb-3">{brandingConfig.footerText}</p>
        <p className="text-[10px] text-muted-foreground">{brandingConfig.footerCopyright}</p>
      </footer>
    </>
  );



  // === DEDICATED PLAYER VIEW ===
  // When a video is playing, unmount the ENTIRE home tree (header, swipe track,
  // hero slider, sections, etc.) so nothing runs in the background. This is the
  // "separate page" the user has been asking for — same React tree, but the
  // home UI no longer renders, eliminating leaks and CPU drain.
  if (playerState) {
    return (
      <div className="fixed inset-0 z-[100] bg-black animate-in fade-in duration-150">
        <VideoPlayer
          src={playerState.src}
          title={playerState.title}
          subtitle={playerState.subtitle}
          poster={playerState.anime.poster}
          onClose={hardCloseToHome}
          qualityOptions={playerState.qualityOptions}
          audioTracks={playerState.audioTracks}
          animeId={playerState.anime.id}
          initialSeekTime={playerState.resumeTime}
          onSaveProgress={saveVideoProgress}
          onNextEpisode={
            playerState.anime.type === "webseries" && playerState.seasonIdx !== undefined && playerState.epIdx !== undefined
              ? async () => {
                  const season = playerState.anime.seasons![playerState.seasonIdx!];
                  const nextIdx = (playerState.epIdx! + 1) % season.episodes.length;
                  const nextEp = season.episodes[nextIdx];
                  const hasAccess = await checkAndShowAdGate(playerState.anime, playerState.seasonIdx, nextIdx);
                  if (!hasAccess) return;
                  let nextSrc = getEpisodeSrc(nextEp);
                  let qOpts = getEpisodeQualityOptions(nextEp);
                  if (playerState.anime.source === "animesalt" && String(nextEp.link || "").startsWith("animesalt://")) {
                    const epSlug = String(nextEp.link).replace("animesalt://", "");
                    try {
                      const epResult = await animeSaltApi.getEpisode(epSlug);
                      const embedServers = (epResult.allEmbeds || [epResult.embedUrl]).filter(Boolean);
                      nextSrc = epResult.embedUrl || nextSrc;
                      qOpts = embedServers.length > 1
                        ? embedServers.map((serverUrl: string, index: number) => ({ label: `Server ${index + 1}`, src: serverUrl }))
                        : [];
                    } catch {}
                  }
                  addToWatchHistory(playerState.anime, playerState.seasonIdx, nextIdx);
                  const nextState = {
                    ...playerState,
                    src: nextSrc,
                    subtitle: `${season.name} - Episode ${nextEp.episodeNumber}`,
                    epIdx: nextIdx,
                    qualityOptions: qOpts.length > 0 ? qOpts : undefined,
                    nextEpisodeSrc: undefined,
                  };
                  playerStateRef.current = nextState;
                  setPlayerState(nextState);
                  navigate(buildWatchRoute(playerState.anime.id, playerState.seasonIdx, nextIdx), { replace: true });
                }
              : undefined
          }
          episodeList={currentEpisodeList}
          seasons={playerState.anime.seasons}
          currentSeasonIdx={playerState.seasonIdx}
          onSeasonChange={handleVideoPlayerSeasonChange}
          suggestedAnime={[]}
          onSuggestedClick={(anime) => {
            stopAllPlayback();
            navigate(buildAnimeRoute(anime.id));
            handleCardClick(anime);
          }}
          nextEpisodeSrc={playerState.nextEpisodeSrc}
          forceEmbedMode={playerState.anime.source === "animesalt" && !isDirectMediaPlaybackUrl(playerState.src)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" style={customBgImage ? { backgroundImage: `url(${customBgImage})`, backgroundSize: 'cover', backgroundAttachment: 'fixed', backgroundPosition: 'center' } : undefined}>
      <Header onSearchClick={() => navigate("/search")} onProfileClick={() => handleNavigate("profile")} onOpenContent={(id) => { const a = allAnime.find(x => x.id === id); if (a) handleCardClick(a); }} animeTitles={allAnime.map(a => a.title)} onLogoClick={() => setChatOpen(prev => !prev)} chatOpen={chatOpen} />
      <main
        className="relative overflow-hidden"
        style={{ height: "calc(100vh - 65px)", marginTop: 0, touchAction: "pan-y pinch-zoom" }}
      >
        <div ref={swipeTrackRef} style={{
          display: "flex",
          width: `${MAIN_PAGE_ORDER.length * 100}vw`,
          height: "100%",
          transform: `translate3d(-${activePageIdx * 100}vw, 0, 0)`,
          transition: "none",
          willChange: "transform",
          backfaceVisibility: "hidden",
        }}>
          {MAIN_PAGE_ORDER.map((page) => (
            <div
              key={page}
              ref={(el) => { pageContainerRefs.current[page] = el; }}
              style={{
                width: "100vw",
                height: "100%",
                flexShrink: 0,
                overflowY: "auto",
                overflowX: "hidden",
                backfaceVisibility: "hidden",
                transform: "translateZ(0)",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {page === "home" && getPageContent_home()}
              {page === "series" && getPageContent_series()}
              {page === "livetv" && <LiveTvPage isActive={activePage === "livetv"} onExitPlayer={() => setActivePage("home")} />}
              {page === "movies" && getPageContent_movies()}
            </div>
          ))}
        </div>
      </main>
      <BottomNav activePage={showProfile ? "profile" : visualPage} onNavigate={handleNavigate} />

      <AnimatePresence>
        {isSearchRoute && (
          <SearchPage
            allAnime={allAnime}
            onClose={() => {
              if (window.history.length > 1) navigate(-1);
              else navigate("/");
            }}
            onCardClick={(anime) => navigate(buildAnimeRoute(anime.id), { replace: true })}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isNotificationsRoute && <NotificationsPage />}
      </AnimatePresence>

      <AnimatePresence>
        {showProfile && (
          <ProfilePage onClose={() => setShowProfile(false)} allAnime={allAnime} onCardClick={handleCardClick} onLogout={handleLogout} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedAnime && (
          <AnimeDetails anime={selectedAnime} onClose={() => closeRouteLayer("/")} onPlay={handlePlay} />
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

      {/* VideoPlayer is rendered via early-return above when playerState is active —
          this guarantees the home tree is fully unmounted while playing. */}

      {/* Live Support Chat */}
      <LiveSupportChat
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        onAnimeSelect={(animeKey) => {
          const normalized = decodeURIComponent(animeKey).trim().toLowerCase();
          const byId = allAnime.find((a) => a.id.toLowerCase() === normalized);
          if (byId) {
            handleCardClick(byId);
            return;
          }

          const bySlug = allAnime.find((a) => {
            const slug = a.slug?.toLowerCase();
            return slug === normalized || `as_${slug}` === normalized;
          });
          if (bySlug) {
            handleCardClick(bySlug);
            return;
          }

          const byTitle = allAnime.filter((a) => a.title.trim().toLowerCase() === normalized);
          const preferred = byTitle.find((a) => a.source !== "animesalt") || byTitle[0];
          if (preferred) {
            handleCardClick(preferred);
          }
        }}
        getAnimeList={() => allAnime.map(a => ({
          title: a.title,
          type: a.type,
          category: a.category,
          rating: a.rating,
          year: a.year,
          storyline: a.storyline,
          dubType: a.dubType,
          source: a.source || "firebase",
          id: a.id,
          slug: a.slug,
          shareLink: `${window.location.origin}/?anime=${encodeURIComponent(a.id)}`,
          seasonCount: a.seasons?.length,
          episodeCount: a.seasons?.reduce((sum, s) => sum + (s.episodes?.length || 0), 0),
        }))}
      />

    </div>
  );
};

export default Index;
