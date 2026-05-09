import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useBranding } from "@/hooks/useBranding";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, Settings, X, Lock, Unlock,
  ChevronRight, ChevronDown, FastForward, Rewind, Crop, Check, ExternalLink, Loader2, Download, PauseCircle, PlayCircle, Search, Server
} from "lucide-react";
import type { AnimeItem, Season } from "@/data/animeData";
import { db, ref, onValue, set, remove, update, get } from "@/lib/firebase";
import logoImg from "@/assets/logo.png";
import { createUnlockLinksForAllServices, createTelegramBotUnlockLink, getLocalUserId, type AdService } from "@/lib/unlockAccess";
import { isUnlockBlockActive } from "@/lib/unlockBlock";
import { toast } from "sonner";
// Unlock gate toggle — admin disables from settings/unlockGateEnabled (Firebase).
// When false: no ad-gate, no flash — full silent free playback.
const isShortenerEnabled = async (): Promise<boolean> => {
  try {
    const snap = await import("@/lib/firebase").then(m => m.get(m.ref(m.db, "settings/unlockGateEnabled")));
    const v = snap.val();
    if (v === false) return false;
    return true;
  } catch { return true; }
};

interface QualityOption {
  label: string;
  src: string;
}

interface VideoServerOption {
  name: string;
  domain: string;
  locked?: boolean;
}

const PROXY_SERVER_LIMIT = 3;

// Cloudflare CDN proxy for fast video streaming
import { CLOUDFLARE_CDN_URL, SUPABASE_URL } from "@/lib/siteConfig";
const CLOUDFLARE_CDN = CLOUDFLARE_CDN_URL;

// Built-in playback proxy is kept as a fallback for plain HTTP sources.
// HTTPS premium/direct links must stay direct and must never be forced
// through a proxy route.
const BUILTIN_STREAM_PROXY = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/video-proxy`
  : "";

const buildProxyPlaybackUrl = (proxyBase: string, targetUrl: string, apiKey?: string): string => {
  const base = proxyBase.trim();
  const encoded = encodeURIComponent(targetUrl);
  if (!base) return targetUrl;
  let url: string;
  // Support {url}/{URL} placeholder: https://proxy.example.com/?url={url}
  if (base.includes('{url}')) url = base.split('{url}').join(encoded);
  else if (base.includes('{URL}')) url = base.split('{URL}').join(encoded);
  // Support ending with = or ?url= or &url=
  else if (/[?&](?:url|URL)=$/.test(base) || base.endsWith('=')) url = `${base}${encoded}`;
  else if (base.includes('?url=') || base.includes('&url=') || base.includes('?URL=') || base.includes('&URL=')) url = `${base}${encoded}`;
  // Default: append ?url=
  else url = `${base.replace(/\/$/, '')}?url=${encoded}`;
  // Append API key if provided
  if (apiKey) {
    url += (url.includes('?') ? '&' : '?') + `apikey=${encodeURIComponent(apiKey)}`;
  }
  return url;
};

const tryUpgradeToHttps = (rawUrl: string): string => {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed.toLowerCase().startsWith("http://")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return trimmed.replace(/^http:\/\//i, "https://");
  }
};

const isDirectPlaybackUrl = (url: string): boolean => {
  const normalized = url.trim().toLowerCase();
  return normalized.startsWith("https://") || normalized.startsWith("blob:") || normalized.startsWith("data:");
};

const isInsecureHttpSource = (url: string): boolean => {
  return String(url || "").trim().toLowerCase().startsWith("http://");
};

const isBypassSource = (url: string): boolean => {
  const normalized = String(url || "").trim().toLowerCase();
  return normalized.startsWith("blob:") || normalized.startsWith("data:") || normalized.startsWith("mediasource:");
};

const isProxyPreferredSource = (url: string): boolean => {
  const trimmed = String(url || "").trim();
  if (!trimmed || isBypassSource(trimmed)) return false;
  return isInsecureHttpSource(trimmed);
};

const isLikelyImageUrl = (url: string): boolean => {
  const normalized = String(url || "").trim().toLowerCase().split("?")[0].split("#")[0];
  return /\.(avif|gif|jpe?g|png|svg|webp|bmp)$/i.test(normalized);
};

const buildFallbackServers = (rawUrl: string): VideoServerOption[] => {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const canMirror = hostname.includes("bot-hosting.net") || /sttv|sttvs/.test(hostname);
    if (!canMirror) return [];

    const port = parsed.port ? `:${parsed.port}` : "";
    const protocol = parsed.protocol || "http:";
    return Array.from({ length: PROXY_SERVER_LIMIT }, (_, index) => ({
      name: `Server ${index + 1}`,
      domain: `${protocol}//fi${index + 1}.bot-hosting.net${port}`,
    }));
  } catch {
    return [];
  }
};

const getRoleDefaultServerIndex = (
  servers: VideoServerOption[],
  isPremium: boolean | null,
): number => {
  if (!servers.length || isPremium === null) return -1;

  if (isPremium) {
    const premiumIndex = servers.findIndex((server) => !!server.locked);
    return premiumIndex >= 0 ? premiumIndex : 0;
  }

  return servers.findIndex((server) => !server.locked);
};

const buildPlaybackCandidates = (url: string, cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string): string[] => {
  const rawUrl = String(url || "").trim();
  if (!rawUrl || isLikelyImageUrl(rawUrl)) return [];

  const candidates: string[] = [];
  const addCandidate = (candidate?: string | null) => {
    if (!candidate || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  const directUrl = rawUrl;
  const encodedRawUrl = encodeURIComponent(rawUrl);
  const cloudflareCandidate = CLOUDFLARE_CDN ? `${CLOUDFLARE_CDN}/video-proxy?url=${encodedRawUrl}` : null;
  const customProxyCandidate = proxyUrl ? buildProxyPlaybackUrl(proxyUrl, rawUrl, proxyApiKey) : null;
  const builtinProxyCandidate = BUILTIN_STREAM_PROXY ? buildProxyPlaybackUrl(BUILTIN_STREAM_PROXY, rawUrl) : null;
  const prefersDirectPlayback = isDirectPlaybackUrl(directUrl);
  const preferProxyFirst = !!proxyUrl && isProxyPreferredSource(rawUrl);

  if (isBypassSource(rawUrl)) {
    addCandidate(rawUrl);
    return candidates;
  }

  if (preferProxyFirst) {
    if (customProxyCandidate) addCandidate(customProxyCandidate);
    if (builtinProxyCandidate) addCandidate(builtinProxyCandidate);
    if (cdnEnabled && cloudflareCandidate) addCandidate(cloudflareCandidate);
    addCandidate(directUrl);
    return candidates;
  }

  if (prefersDirectPlayback) {
    addCandidate(directUrl);
    if (customProxyCandidate) addCandidate(customProxyCandidate);
    if (builtinProxyCandidate) addCandidate(builtinProxyCandidate);
    if (cdnEnabled && cloudflareCandidate) addCandidate(cloudflareCandidate);
    return candidates;
  }

  if (customProxyCandidate) addCandidate(customProxyCandidate);
  if (builtinProxyCandidate) addCandidate(builtinProxyCandidate);
  if (cdnEnabled && cloudflareCandidate) addCandidate(cloudflareCandidate);

  if (candidates.length === 0) {
    addCandidate(directUrl);
  }

  return candidates;
};

const getPrimaryPlaybackSrc = (url: string, cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string): string => {
  return buildPlaybackCandidates(url, cdnEnabled, proxyUrl, proxyApiKey)[0] || url;
};

interface AudioTrackOption {
  language: string;
  label: string;
  src?: string; // If set, switch to this URL for this language
  src480?: string;
  src720?: string;
  src1080?: string;
  src4k?: string;
  nativeIndex?: number; // If set, switch native audio track
}

interface VideoPlayerProps {
  src: string;
  title: string;
  subtitle?: string;
  poster?: string;
  onClose: () => void;
  onNextEpisode?: () => void;
  episodeList?: { number: number; title?: string; active: boolean; onClick: () => void }[];
  qualityOptions?: QualityOption[];
  audioTracks?: { language: string; label: string; link: string; link480?: string; link720?: string; link1080?: string; link4k?: string }[];
  animeId?: string;
  onSaveProgress?: (currentTime: number, duration: number) => void;
  hideDownload?: boolean;
  noProxy?: boolean;
  noServerSwitch?: boolean;
  seasons?: Season[];
  currentSeasonIdx?: number;
  onSeasonChange?: (idx: number) => void;
  suggestedAnime?: AnimeItem[];
  onSuggestedClick?: (anime: AnimeItem) => void;
  nextEpisodeSrc?: string;
  disableUnlockGate?: boolean;
}

const formatTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const VideoPlayer = ({ src, title, subtitle, poster, onClose, onNextEpisode, episodeList, qualityOptions, audioTracks: propAudioTracks, animeId, onSaveProgress, hideDownload, noProxy, noServerSwitch, seasons, currentSeasonIdx, onSeasonChange, suggestedAnime, onSuggestedClick, nextEpisodeSrc, disableUnlockGate = false }: VideoPlayerProps) => {
  const branding = useBranding();
  const playerLoaderLogo = branding.playerLogoUrl || branding.logoUrl || logoImg;
  // Removed preload anime character image - no longer needed

  const videoRef = useRef<HTMLVideoElement>(null);
  const embedIframeRef = useRef<HTMLIFrameElement>(null);
  // Mirror state from iframe embed (Server 2 mode)
  const embedTimeRef = useRef({ currentTime: 0, duration: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const rafId = useRef<number>(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [boostedVolume, setBoostedVolume] = useState(100); // 0-100%
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [skipIndicator, setSkipIndicator] = useState<{ side: "left" | "right" | "center"; text: string } | null>(null);
  const [brightness, setBrightness] = useState(1);
  const [swipeState, setSwipeState] = useState<{ startX: number; startY: number; type: string | null } | null>(null);
  const cropModes = ["contain", "cover", "fill"] as const;
  const cropLabels = ["Fit", "Crop", "Stretch"];
  const [cropIndex, setCropIndex] = useState(0);
  const [settingsTab, setSettingsTab] = useState<"speed" | "quality" | "audio">("speed");
  const [currentQuality, setCurrentQuality] = useState<string>("Auto");
  const [cdnEnabled, setCdnEnabled] = useState(true);
  const [proxyUrl, setProxyUrl] = useState<string>('');
  const [proxyApiKey, setProxyApiKey] = useState<string>('');
  const [playbackRouteReady, setPlaybackRouteReady] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(''); // resolved playback src
  const activeSourceBaseRef = useRef(src); // currently selected raw source (before proxy/CDN)
  const sourceBaseRef = useRef(src);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<string>("Default");
  const [showAudioPanel, setShowAudioPanel] = useState(false);

  // ===== SERVER CHANGER =====
  const [videoServers, setVideoServers] = useState<VideoServerOption[]>([]);
  const [activeServerIndex, setActiveServerIndex] = useState(0);
  const [manualServerSelected, setManualServerSelected] = useState(false);
  const [showServerPanel, setShowServerPanel] = useState(false);
  useEffect(() => {
    const unsub = onValue(ref(db, "settings/videoServers"), (snap) => {
      const val = snap.val();
      let servers: VideoServerOption[] = [];
      if (val && Array.isArray(val)) {
        servers = val.filter((s: any) => s && s.domain);
      } else if (val && typeof val === "object") {
        servers = Object.values(val).filter((s: any) => s && s.domain) as any[];
      }
      setVideoServers(servers.slice(0, PROXY_SERVER_LIMIT));
    });
    return () => unsub();
  }, []);

  const effectiveVideoServers = useMemo(() => {
    if (noServerSwitch) return [];
    if (videoServers.length > 0) return videoServers.slice(0, PROXY_SERVER_LIMIT);
    return buildFallbackServers(src).slice(0, PROXY_SERVER_LIMIT);
  }, [noServerSwitch, src, videoServers]);

  // ===== LEGACY EMBED BRIDGE =====
  // Some older server setups used an iframe bridge page, but playback now
  // stays on the native <video src> path because /watch/ routes are not valid
  // direct media URLs and can return non-playable responses.
  const sendEmbedCmd = useCallback((cmd: string, payload?: Record<string, unknown>) => {
    const w = embedIframeRef.current?.contentWindow;
    if (!w) return;
    try {
      w.postMessage({ target: "rs-embed", cmd, ...(payload || {}) }, "*");
    } catch { /* noop */ }
  }, []);

  // Never switch to iframe mode for direct playback URLs.
  const isEmbedPlayback = false;

  // Throttle React state updates from the iframe → ~1 update/sec
  const lastEmbedSyncRef = useRef(0);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const d = ev.data as { source?: string; type?: string; currentTime?: number; duration?: number } | null;
      if (!d || d.source !== "rs-embed") return;
      switch (d.type) {
        case "ready":
        case "meta":
        case "canplay":
          // Iframe is loaded — kick off playback and clear the buffering UI
          setIsBuffering(false);
          setShowFixedLoader(false);
          setVideoError(false);
          // Auto-trigger play; muted-fallback if browser blocks audio autoplay.
          sendEmbedCmd("play");
          // If we have a pending seek (e.g. from server switch / resume), apply it
          if (pendingSeek.current !== null) {
            sendEmbedCmd("seek", { time: pendingSeek.current });
            pendingSeek.current = null;
          }
          break;
        case "playing":
          setPlaying(true);
          setIsBuffering(false);
          setShowFixedLoader(false);
          break;
        case "pause":
          setPlaying(false);
          break;
        case "waiting":
          setIsBuffering(true);
          break;
        case "time": {
          const ct = d.currentTime ?? 0;
          const dur = d.duration ?? 0;
          embedTimeRef.current = { currentTime: ct, duration: dur };
          // Live DOM updates → 60fps smooth, zero React cost
          if (progressRef.current && dur > 0) {
            progressRef.current.style.width = `${(ct / dur) * 100}%`;
          }
          if (timeDisplayRef.current && dur > 0) {
            timeDisplayRef.current.textContent = `${formatTime(ct)} / ${formatTime(dur)}`;
          }
          // Throttle React re-renders to ~1 Hz
          const now = performance.now();
          if (now - lastEmbedSyncRef.current >= 1000) {
            lastEmbedSyncRef.current = now;
            setCurrentTime(ct);
            if (Number.isFinite(dur) && dur > 0) setDuration(dur);
          }
          break;
        }
        case "ended":
          embedTimeRef.current.currentTime = embedTimeRef.current.duration;
          setPlaying(false);
          if (onNextEpisode) onNextEpisode();
          break;
        case "error":
          setVideoError(true);
          setIsBuffering(false);
          break;
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [sendEmbedCmd, onNextEpisode]);


  
  // Load CDN + proxy settings from Firebase (skip if noProxy)
  useEffect(() => {
    let mounted = true;

    if (noProxy) {
      setCdnEnabled(false);
      setProxyUrl('');
      setProxyApiKey('');
      setPlaybackRouteReady(true);
      return;
    }

    setPlaybackRouteReady(false);

    (async () => {
      try {
        const [cdnSnap, proxySnap] = await Promise.all([
          get(ref(db, "settings/cdnEnabled")),
          get(ref(db, "settings/proxyServer")),
        ]);

        if (!mounted) return;

        setCdnEnabled(cdnSnap.val() !== false);

        const proxyVal = proxySnap.val();
        if (proxyVal && proxyVal.url) {
          setProxyUrl(proxyVal.url);
          setProxyApiKey(proxyVal.apiKey || '');
        } else {
          setProxyUrl('');
          setProxyApiKey('');
        }
      } catch {
        if (!mounted) return;
      } finally {
        if (mounted) setPlaybackRouteReady(true);
      }
    })();

    const unsub1 = onValue(ref(db, "settings/cdnEnabled"), (snap) => {
      const val = snap.val();
      const enabled = val !== false;
      setCdnEnabled(enabled);
    });

    const unsub2 = onValue(ref(db, "settings/proxyServer"), (snap) => {
      const val = snap.val();
      if (val && val.url) {
        setProxyUrl(val.url);
        setProxyApiKey(val.apiKey || '');
      } else {
        setProxyUrl('');
        setProxyApiKey('');
      }
    });

    return () => {
      mounted = false;
      unsub1();
      unsub2();
    };
  }, [noProxy, src]);
  const [isPremium, setIsPremium] = useState<boolean | null>(null); // null = loading
  const [adGateActive, setAdGateActive] = useState(false);
  const [adLinks, setAdLinks] = useState<{ service: AdService; shortUrl: string }[]>([]);
  const [shortenLoading, setShortenLoading] = useState(false);
  const [showQualityPanel, setShowQualityPanel] = useState(false);
  const [showDownloadQualityPicker, setShowDownloadQualityPicker] = useState(false);
  const [bulkDownloadMode, setBulkDownloadMode] = useState(false);
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<any[]>([]);
  const [offlinePlaySrc, setOfflinePlaySrc] = useState<string | null>(null);
  const [offlinePlayInfo, setOfflinePlayInfo] = useState<any>(null);
  const [videoError, setVideoError] = useState(false);
  const failedSrcsRef = useRef<Set<string>>(new Set());
  // Throttle React state updates from native <video> RAF loop to ~1 Hz
  const lastNativeSyncRef = useRef(0);
  // Persistent retry counter (per-src) so we don't retry-storm across re-renders
  const retryAttemptsRef = useRef<Map<string, number>>(new Map());
  const [isBuffering, setIsBuffering] = useState(true);
  const [showFixedLoader, setShowFixedLoader] = useState(true);
  const [switchingEpisode, setSwitchingEpisode] = useState(false);
  const loaderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tutorialLink, setTutorialLink] = useState<string | null>(null);
  const [tutorialVideos, setTutorialVideos] = useState<{ title: string; url: string }[]>([]);
  const [showTutorialVideo, setShowTutorialVideo] = useState(false);
  const [activeTutorialIdx, setActiveTutorialIdx] = useState(0);
  const [showNextEpOverlay, setShowNextEpOverlay] = useState(false);
  const [nextEpCountdown, setNextEpCountdown] = useState(0);
  const nextEpTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextEpCancelledRef = useRef(false);
  // Global download manager state
  const [activeDownloads, setActiveDownloads] = useState<Map<string, any>>(new Map());
  const [globalFreeAccess, setGlobalFreeAccess] = useState<boolean>(false);
  const [userFreeAccessExpiresAt, setUserFreeAccessExpiresAt] = useState(0);
  const [freeAccessLoaded, setFreeAccessLoaded] = useState(false); // prevents unlock-button flash before Firebase responds
  const [unlockBlocked, setUnlockBlocked] = useState(false);
  const [verifyLang, setVerifyLang] = useState<"en" | "bn">("en");
  const [accessCodeInput, setAccessCodeInput] = useState("");
  const [accessCodeBusy, setAccessCodeBusy] = useState(false);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    import("@/lib/downloadManager").then(({ downloadManager }) => {
      unsub = downloadManager.subscribe(setActiveDownloads);
    });
    return () => { unsub?.(); };
  }, []);

  // Check IndexedDB for already downloaded episodes matching this title
  useEffect(() => {
    import("@/lib/downloadStore").then(({ getAllDownloads }) => {
      getAllDownloads().then((all) => {
        const matching = all.filter(d => d.title === title);
        // Sort ep1 → ep2 → ... ascending (extract episode number from subtitle)
        const epNum = (s?: string) => {
          const m = String(s || "").match(/episode\s*(\d+)|ep\s*(\d+)|\b(\d+)\b/i);
          return m ? parseInt(m[1] || m[2] || m[3], 10) : 9999;
        };
        matching.sort((a, b) => epNum(a.subtitle) - epNum(b.subtitle));
        setDownloadedEpisodes(matching);
      });
    });
  }, [title, activeDownloads]);

  // Listen for global free access from Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, "globalFreeAccess"), (snap) => {
      const data = snap.val();
      if (data?.active && data?.expiresAt > Date.now()) {
        setGlobalFreeAccess(true);
      } else {
        setGlobalFreeAccess(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const uid = getLocalUserId();
    if (!uid) {
      setUserFreeAccessExpiresAt(0);
      setUnlockBlocked(false);
      setFreeAccessLoaded(true);
      return;
    }

    let disposed = false;
    let accessRequestSeq = 0;

    const unsubAccess = onValue(ref(db, `users/${uid}/freeAccess`), async (snap) => {
      const requestSeq = ++accessRequestSeq;
      setFreeAccessLoaded(false);
      const data = snap.val();
      if (data?.active && Number(data.expiresAt) > Date.now()) {
        const { ensureFreeAccessDeviceAllowed } = await import("@/lib/freeAccessDevice");
        const allowed = await ensureFreeAccessDeviceAllowed(uid, data);
        if (disposed || requestSeq !== accessRequestSeq) return;
        setUserFreeAccessExpiresAt(allowed ? Number(data.expiresAt) : 0);
      } else {
        if (disposed || requestSeq !== accessRequestSeq) return;
        setUserFreeAccessExpiresAt(0);
      }
      if (disposed || requestSeq !== accessRequestSeq) return;
      setFreeAccessLoaded(true);
    }, () => {
      // On error, mark loaded so UI doesn't hang forever
      if (disposed) return;
      setFreeAccessLoaded(true);
    });

    const unsubBlocked = onValue(ref(db, `users/${uid}/security/unlockBlocked`), (snap) => {
      setUnlockBlocked(isUnlockBlockActive(snap.val()));
    });

    return () => {
      disposed = true;
      unsubAccess();
      unsubBlocked();
    };
  }, []);

  // ===== VIDEO VIEW TRACKING =====
  useEffect(() => {
    if (!animeId) return;
    const getUserId = (): string | null => {
      try { const u = localStorage.getItem("rsanime_user"); if (u) return JSON.parse(u).id; } catch {} return null;
    };
    const uid = getUserId();
    if (!uid) return;

    // 1. Log a view count (per-day, per-user)
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const viewRef = ref(db, `analytics/views/${animeId}/${today}/${uid}`);
    set(viewRef, { timestamp: Date.now(), title: title || "" }).catch(() => {});

    // 1b. All-time total counter (never reset by daily cleanup)
    import("@/lib/firebase").then(({ runTransaction, ref: fbRef, db: fbDb }) => {
      runTransaction(fbRef(fbDb, `analytics/totals/views/${animeId}`), (curr: any) => {
        const base = curr && typeof curr === "object" ? curr : { count: 0, title: "" };
        return { count: (base.count || 0) + 1, title: title || base.title || "", lastSeen: Date.now() };
      }).catch(() => {});
    });

    // 2. Track as active viewer (presence)
    const activeRef = ref(db, `analytics/activeViewers/${animeId}/${uid}`);
    const userName = (() => {
      try { return localStorage.getItem("rs_display_name") || JSON.parse(localStorage.getItem("rsanime_user") || "{}").name || "User"; } catch { return "User"; }
    })();
    set(activeRef, { title: title || "", userName, startedAt: Date.now() }).catch(() => {});

    // 3. Log to daily aggregate
    const dailyRef = ref(db, `analytics/dailyActive/${today}/${uid}`);
    set(dailyRef, { lastSeen: Date.now(), userName }).catch(() => {});

    return () => {
      // Remove active viewer on unmount
      remove(activeRef).catch(() => {});
    };
  }, [animeId, title]);

  // Check 24h access
  const has24hAccess = useCallback((): boolean => {
    if (globalFreeAccess) return true;
    return userFreeAccessExpiresAt > Date.now();
  }, [globalFreeAccess, userFreeAccessExpiresAt]);

  // Load tutorial videos from Firebase
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    unsubs.push(onValue(ref(db, "settings/tutorialLink"), (snap) => {
      setTutorialLink(snap.val() || null);
    }));
    unsubs.push(onValue(ref(db, "settings/tutorialVideos"), (snap) => {
      const val = snap.val();
      if (val && typeof val === "object") {
        const list = Object.values(val).map((v: any) => ({ title: v.title || "", url: v.url || "" }));
        setTutorialVideos(list);
      } else {
        setTutorialVideos([]);
      }
    }));
    return () => unsubs.forEach(u => u());
  }, []);

  // Maintenance pause listener
  useEffect(() => {
    const unsub = onValue(ref(db, "maintenance"), (snap) => {
      const maint = snap.val();
      if (!maint?.active && maint?.lastPauseDuration && maint?.lastResumedAt) {
        const appliedKey = `rsanime_pause_applied_${maint.lastResumedAt}`;
        if (!localStorage.getItem(appliedKey)) {
          const expiry = localStorage.getItem("rsanime_ad_access");
          if (expiry) {
            const newExpiry = parseInt(expiry) + maint.lastPauseDuration;
            localStorage.setItem("rsanime_ad_access", newExpiry.toString());
          }
          localStorage.setItem(appliedKey, "true");
        }
      }
    });
    return () => unsub();
  }, []);

  const grant24hAccess = useCallback(() => {
    const expiry = Date.now() + 24 * 60 * 60 * 1000;
    localStorage.setItem("rsanime_ad_access", expiry.toString());
  }, []);

  // Premium check (device limit is now enforced at login time)
  useEffect(() => {
    const getUserId = (): string | null => {
      try { const u = localStorage.getItem("rsanime_user"); if (u) return JSON.parse(u).id; } catch {} return null;
    };
    const uid = getUserId();
    if (!uid) { setIsPremium(false); return; }

    const premRef = ref(db, `users/${uid}/premium`);
    const unsub = onValue(premRef, (snap) => {
      const data = snap.val();
      const isPrem = !!(data && data.active === true && data.expiresAt > Date.now());
      setIsPremium(isPrem);
    });
    return () => unsub();
  }, []);

  // Ad gate - only run after premium AND freeAccess data have loaded
  useEffect(() => {
    if (disableUnlockGate) {
      setAdGateActive(false);
      return;
    }
    if (isPremium === null) return; // still loading premium status
    if (!freeAccessLoaded) return; // wait for Firebase freeAccess snapshot — prevents unlock-button flash

    const uid = getLocalUserId();
    if (!uid) {
      setAdGateActive(false);
      return;
    }

    if (unlockBlocked) {
      setAdGateActive(false);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = "";
      }
      return;
    }

    if (isPremium || has24hAccess()) {
      setAdGateActive(false);
      return;
    }
    // Shortener master toggle: if admin disabled it, give free users instant access
    isShortenerEnabled().then((on) => {
      if (!on) { setAdGateActive(false); return; }
      // No access - block video and show ad gate
      setAdGateActive(true);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
      }
      setShortenLoading(true);
      createUnlockLinksForAllServices().then((result) => {
        setShortenLoading(false);
        if (result.ok && result.links.length > 0) setAdLinks(result.links);
        else setAdGateActive(false);
      }).catch(() => { setShortenLoading(false); setAdGateActive(false); });
    });
  }, [disableUnlockGate, isPremium, has24hAccess, unlockBlocked, freeAccessLoaded]);

  const handleOpenAdLink = useCallback(async (url: string, service?: AdService) => {
    const { openExternalBrowser, openTelegramDeepLink } = await import("@/lib/openExternal");

    // Telegram-bot mode: redirect to bot deep link (NOT shortener)
    const isTelegramMode =
      service?.mode === "miniapp" ||
      url === "miniapp://telegram" ||
      /telegram|t\.me/i.test(service?.id || "") ||
      /telegram|t\.me/i.test(service?.name || "");

    if (isTelegramMode) {
      try {
        const { createTelegramBotUnlockLink } = await import("@/lib/unlockAccess");
        const r = await createTelegramBotUnlockLink();
        if (r.ok && r.url) {
          openTelegramDeepLink(r.url);
          return;
        }
      } catch {}
      // Fallback: open bot directly
      try {
        const fb = await import("@/lib/firebase");
        const botSnap = await fb.get(fb.ref(fb.db, "settings/telegramVerifyBotUsername"));
        const botUsername = String(botSnap.val() || "RS_ANIME_FIND_BOT").replace(/^@/, "").trim();
        window.location.href = `https://t.me/${botUsername}`;
      } catch {
        window.location.href = "https://t.me/RS_ANIME_FIND_BOT";
      }
      return;
    }

    // Shortener mode: open the short URL directly in external browser
    if (url && url !== "miniapp://telegram") {
      openExternalBrowser(url);
    }
  }, []);

  const handleClaimAccessCode = useCallback(async () => {
    const code = accessCodeInput.trim().toUpperCase().replace(/\s+/g, "");
    if (!code) { toast.error("Paste your access token first"); return; }
    setAccessCodeBusy(true);
    try {
      const { claimAccessCode } = await import("@/lib/unlockAccess");
      const r = await claimAccessCode(code);
      if (r.ok) {
        toast.success("✅ Access unlocked!");
        setAccessCodeInput("");
        setAdGateActive(false);
      } else {
        const map: Record<string, string> = {
          invalid_code: "Invalid token",
          already_used: "This token was already used",
          expired: "Token expired – get a new one from the bot",
          not_owner: "This token belongs to another user",
          login_required: "Please sign in first",
          empty_code: "Paste your access token first",
        };
        toast.error(map[r.error || ""] || r.error || "Could not claim token");
      }
    } finally {
      setAccessCodeBusy(false);
    }
  }, [accessCodeInput]);
  useEffect(() => {
    if (!onSaveProgress) return;
    const v = videoRef.current;
    if (!v) return;
    const saveInterval = setInterval(() => {
      if (v.currentTime > 0 && v.duration > 0) onSaveProgress(v.currentTime, v.duration);
    }, 10000);
    const onPause = () => { if (v.currentTime > 0 && v.duration > 0) onSaveProgress(v.currentTime, v.duration); };
    v.addEventListener("pause", onPause);
    return () => {
      clearInterval(saveInterval);
      v.removeEventListener("pause", onPause);
      if (v.currentTime > 0 && v.duration > 0) onSaveProgress(v.currentTime, v.duration);
    };
  }, [onSaveProgress]);

  // Restore watch position (per-account)
  useEffect(() => {
    if (!animeId) return;
    try {
      const user = localStorage.getItem("rsanime_user");
      if (!user) return;
      const userId = JSON.parse(user).id;
      if (!userId) return;
      import("@/lib/firebase").then(({ get: fbGet, ref: fbRef, db: fbDb }) => {
        const histRef = fbRef(fbDb, `users/${userId}/watchHistory/${animeId}`);
        fbGet(histRef).then((snap: any) => {
          if (snap.exists()) {
            const data = snap.val();
            if (data.currentTime && data.duration && (data.currentTime / data.duration) < 0.95) {
              pendingSeek.current = data.currentTime;
              const v = videoRef.current;
              if (v && v.duration > 0) {
                v.currentTime = data.currentTime;
              }
            }
          }
        });
      });
    } catch {}
  }, [animeId]);

  // Build quality list - 4K is premium-only
  const is4KLabel = (label: string) => /4k|2160|uhd/i.test(label);

  const availableQualities: QualityOption[] = useMemo(() => {
    // Keep raw URLs here; proxy is applied only when actually loading/switching source
    const list: QualityOption[] = [{ label: "Auto", src }];
    if (qualityOptions?.length) qualityOptions.forEach(q => { if (q.src) list.push({ ...q }); });
    return list;
  }, [src, qualityOptions]);

  const resolvePlaybackSrc = useCallback((rawUrl: string) => {
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed) return "";
    if (isLikelyImageUrl(trimmed)) return "";
    return getPrimaryPlaybackSrc(trimmed, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
  }, [cdnEnabled, proxyUrl, proxyApiKey]);

  const applyServerDomain = useCallback((rawUrl: string, serverIndex: number) => {
    const server = effectiveVideoServers[serverIndex];
    if (!server?.domain) return rawUrl;
    const domainTrim = server.domain.trim().replace(/\/$/, "");
    try {
      const url = new URL(rawUrl);
      return `${domainTrim}${url.pathname}${url.search}${url.hash}`;
    } catch {
      const trimmedRawUrl = String(rawUrl || "").trim();
      const match = trimmedRawUrl.match(/^https?:\/\/[^\/]+(\/.*)/i);
      return `${domainTrim}${match ? match[1] : trimmedRawUrl}`;
    }
  }, [effectiveVideoServers]);

  const preloadLinkRef = useRef<HTMLLinkElement | null>(null);
  const serverSwitchingRef = useRef(false);
  const instantSwitchRef = useRef(false);

  // NOTE: Aggressive next-episode preload removed — it caused CORS fetches
  // and wasted bandwidth that slowed the *current* video load. Browser will
  // naturally prefetch via the video element when user switches.

  const switchServer = useCallback((serverIndex: number) => {
    if (serverIndex === activeServerIndex || !effectiveVideoServers[serverIndex]) return;
    if (effectiveVideoServers[serverIndex].locked && !isPremium) return;
    if (serverSwitchingRef.current) return;
    const v = videoRef.current;
    if (!v) return;

    const savedTime = v.currentTime || 0;
    const wasPlaying = !v.paused;
    const newRawSrc = applyServerDomain(sourceBaseRef.current, serverIndex);
    const resolved = resolvePlaybackSrc(newRawSrc);

    setShowServerPanel(false);
    serverSwitchingRef.current = true;
    setVideoError(false);

    setManualServerSelected(true);
    setActiveServerIndex(serverIndex);
    activeSourceBaseRef.current = newRawSrc;
    pendingSeek.current = savedTime;

    failedSrcsRef.current.clear();
    retryAttemptsRef.current.clear();

    // Fast swap — just change src, browser handles the rest. No removeAttribute/double-load.
    setCurrentSrc(resolved);
    try {
      v.src = resolved;
      v.load();
      if (savedTime > 0) {
        const onMeta = () => { try { v.currentTime = savedTime; } catch {} v.removeEventListener("loadedmetadata", onMeta); };
        v.addEventListener("loadedmetadata", onMeta);
      }
      if (wasPlaying) v.play().catch(() => {});
    } catch {}

    // Auto-failover only if server truly dead (5s, no data at all)
    window.setTimeout(() => {
      const vv = videoRef.current;
      if (!vv) return;
      if (vv.readyState < 1 && vv.networkState === 3) {
        const nextIdx = effectiveVideoServers.findIndex((s, i) => i !== serverIndex && (!s.locked || isPremium));
        if (nextIdx >= 0 && nextIdx !== serverIndex) {
          serverSwitchingRef.current = false;
          switchServer(nextIdx);
        }
      }
    }, 5000);

    window.setTimeout(() => {
      serverSwitchingRef.current = false;
    }, 400);
  }, [activeServerIndex, effectiveVideoServers, resolvePlaybackSrc, applyServerDomain, isPremium]);

  // Keep RS01/default server on first load; premium servers stay manual-only.

  const getTierDefaultSelection = useCallback((rawUrl: string) => {
    const defaultServerIndex = getRoleDefaultServerIndex(effectiveVideoServers, isPremium);
    if (defaultServerIndex < 0) {
      return {
        usesServer: false,
        serverIndex: 0,
        rawSrc: rawUrl,
        resolvedSrc: resolvePlaybackSrc(rawUrl),
      };
    }

    const tierRawSrc = applyServerDomain(rawUrl, defaultServerIndex);
    return {
      usesServer: true,
      serverIndex: defaultServerIndex,
      rawSrc: tierRawSrc,
      resolvedSrc: resolvePlaybackSrc(tierRawSrc),
    };
  }, [applyServerDomain, effectiveVideoServers, isPremium, resolvePlaybackSrc]);

  const [audioTrackOptions, setAudioTrackOptions] = useState<AudioTrackOption[]>([]);


  // Build audio track options from props + detect native audio tracks on video load
  useEffect(() => {
    const tracks: AudioTrackOption[] = [];
    // Add manual audio tracks from props
    if (propAudioTracks?.length) {
      propAudioTracks.forEach(t => {
        tracks.push({ language: t.language, label: t.label, src: t.link, src480: t.link480, src720: t.link720, src1080: t.link1080, src4k: t.link4k });
      });
    }
    setAudioTrackOptions(tracks);
    setCurrentAudioTrack("Default");
  }, [propAudioTracks, src]);

  // Detect native audio tracks when video loads
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const detectNativeTracks = () => {
      const audioTracks = (v as any).audioTracks;
      if (audioTracks && audioTracks.length > 1) {
        const nativeTracks: AudioTrackOption[] = [];
        for (let i = 0; i < audioTracks.length; i++) {
          const t = audioTracks[i];
          nativeTracks.push({
            language: t.language || `Track ${i + 1}`,
            label: t.label || t.language || `Audio ${i + 1}`,
            nativeIndex: i,
          });
        }
        setAudioTrackOptions(prev => {
          // Merge: native tracks first, then manual tracks
          const manualTracks = prev.filter(t => t.src);
          return [...nativeTracks, ...manualTracks];
        });
      }
    };
    v.addEventListener("loadedmetadata", detectNativeTracks);
    return () => v.removeEventListener("loadedmetadata", detectNativeTracks);
  }, [currentSrc]);

  const switchAudioTrack = useCallback((track: AudioTrackOption) => {
    const v = videoRef.current;
    if (!v) return;
    const savedTime = v.currentTime;
    const wasPlaying = !v.paused;

    if (track.nativeIndex !== undefined) {
      // Switch native audio track
      const audioTracks = (v as any).audioTracks;
      if (audioTracks) {
        for (let i = 0; i < audioTracks.length; i++) {
          audioTracks[i].enabled = i === track.nativeIndex;
        }
      }
      setCurrentAudioTrack(track.label);
    } else if (track.src) {
      // Pick quality-matched audio URL based on current quality selection
      let audioUrl = track.src;
      const q = currentQuality.toLowerCase();
      if (q.includes('4k') || q.includes('2160') || q.includes('uhd')) audioUrl = track.src4k || track.src1080 || track.src;
      else if (q.includes('1080')) audioUrl = track.src1080 || track.src;
      else if (q.includes('720')) audioUrl = track.src720 || track.src;
      else if (q.includes('480')) audioUrl = track.src480 || track.src;
      // Switch to a different URL for this language
      sourceBaseRef.current = audioUrl;
      const finalAudioUrl = manualServerSelected ? applyServerDomain(audioUrl, activeServerIndex) : audioUrl;
      const proxiedSrc = resolvePlaybackSrc(finalAudioUrl);
      activeSourceBaseRef.current = finalAudioUrl;
      setCurrentSrc(proxiedSrc);
      setCurrentAudioTrack(track.label);
    // Restore playback position after source change
      const restoreTime = () => {
        if (v.duration > 0) {
          v.currentTime = savedTime;
          if (wasPlaying) v.play().catch(() => {});
          v.removeEventListener("loadedmetadata", restoreTime);
        }
      };
      v.addEventListener("loadedmetadata", restoreTime);
    }
    setShowAudioPanel(false);
  }, [currentQuality, resolvePlaybackSrc, manualServerSelected, activeServerIndex, applyServerDomain]);

  const resetToDefaultAudio = useCallback(() => {
    const v = videoRef.current;
    const defaultRawSrc = src;
    const defaultResolvedSrc = resolvePlaybackSrc(defaultRawSrc);
    const savedTime = v?.currentTime || 0;
    const wasPlaying = !!v && !v.paused;

    const audioTracks = (v as any)?.audioTracks;
    if (audioTracks?.length) {
      for (let i = 0; i < audioTracks.length; i++) {
        audioTracks[i].enabled = i === 0;
      }
    }

    sourceBaseRef.current = defaultRawSrc;
    activeSourceBaseRef.current = defaultRawSrc;
    setCurrentAudioTrack("Default");
    setShowAudioPanel(false);

    const finalDefaultSrc = manualServerSelected ? applyServerDomain(defaultRawSrc, activeServerIndex) : defaultRawSrc;
    const finalResolvedSrc = resolvePlaybackSrc(finalDefaultSrc);

    if (v && currentSrc !== finalResolvedSrc) {
      const restoreTime = () => {
        if (v.duration > 0) {
          v.currentTime = savedTime;
          if (wasPlaying) v.play().catch(() => {});
          v.removeEventListener("loadedmetadata", restoreTime);
        }
      };

      v.addEventListener("loadedmetadata", restoreTime);
      activeSourceBaseRef.current = finalDefaultSrc;
      setCurrentSrc(finalResolvedSrc);
    }

  }, [currentSrc, resolvePlaybackSrc, src, manualServerSelected, activeServerIndex, applyServerDomain]);

  useEffect(() => {
    if (!playbackRouteReady || isPremium === null) return;
    const v = videoRef.current;
    if (v) {
      try { v.pause(); } catch {}
    }
    instantSwitchRef.current = true;
    setSwitchingEpisode(true);
    sourceBaseRef.current = src;
    const tierDefault = getTierDefaultSelection(src);
    activeSourceBaseRef.current = tierDefault.rawSrc;
    setActiveServerIndex(tierDefault.serverIndex);
    setManualServerSelected(tierDefault.usesServer);
    setCurrentSrc(tierDefault.resolvedSrc);
    setCurrentQuality("Auto");
    setVideoError(false);
    setIsBuffering(true);
    failedSrcsRef.current.clear();
    pendingSeek.current = 0;
    const t = setTimeout(() => {
      instantSwitchRef.current = false;
      setSwitchingEpisode(false);
    }, 450);
    return () => clearTimeout(t);
  }, [src, qualityOptions, noProxy, playbackRouteReady, isPremium, getTierDefaultSelection]);

  // Loader follows real buffering state — show whenever video isn't playable, hide as soon as it can play.
  useEffect(() => {
    if (loaderTimeoutRef.current) {
      clearTimeout(loaderTimeoutRef.current);
      loaderTimeoutRef.current = null;
    }

    if (!currentSrc || switchingEpisode) {
      setShowFixedLoader(false);
      return;
    }

    // Strict mapping: loader visibility == buffering state.
    setShowFixedLoader(isBuffering);
  }, [currentSrc, isBuffering, switchingEpisode]);

  // Simple volume sync - no AudioContext needed
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    v.volume = muted ? 0 : Math.min(1, boostedVolume / 100);
  }, [boostedVolume, muted, currentSrc]);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const stopAndClosePlayer = useCallback(async () => {
    clearHideTimer();
    setShowControls(false);
    setLocked(false);
    setShowSettings(false);
    setShowAudioPanel(false);
    setShowQualityPanel(false);
    setShowServerPanel(false);

    try {
      if (document.fullscreenElement) {
        try { (screen.orientation as any).unlock?.(); } catch {}
        await document.exitFullscreen().catch(() => {});
      }
    } catch {}

    const v = videoRef.current;
    if (v) {
      try { v.pause(); } catch {}
      v.removeAttribute("src");
      v.src = "";
      v.load();
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }

    onClose();
  }, [clearHideTimer, onClose]);

  // Auto-close when user leaves the page/app — pause when tab hidden, fully close on pagehide.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        const v = videoRef.current;
        if (v) { try { v.pause(); } catch {} }
      }
    };
    const onPageHide = () => {
      const v = videoRef.current;
      if (v) {
        try { v.pause(); } catch {}
        try { v.removeAttribute("src"); v.src = ""; v.load(); } catch {}
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  // MediaSession API - show anime title + artwork in Chrome media notification
  useEffect(() => {
    if ('mediaSession' in navigator) {
      const artworkSrc = (() => {
        if (!poster) return `${window.location.origin}/favicon.ico`;
        try {
          return poster.startsWith("http") ? poster : new URL(poster, window.location.origin).toString();
        } catch {
          return `${window.location.origin}/favicon.ico`;
        }
      })();

      navigator.mediaSession.metadata = new MediaMetadata({
        title: title,
        artist: subtitle || 'RS ANIME',
        album: 'RS ANIME',
        artwork: [
          { src: artworkSrc, sizes: "96x96" },
          { src: artworkSrc, sizes: "192x192" },
          { src: artworkSrc, sizes: "384x384" },
          { src: artworkSrc, sizes: "512x512" },
        ],
      });
      navigator.mediaSession.setActionHandler('play', () => { videoRef.current?.play(); });
      navigator.mediaSession.setActionHandler('pause', () => { videoRef.current?.pause(); });
      navigator.mediaSession.setActionHandler('seekbackward', () => seek(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => seek(10));
      // Stop button - closes video and removes notification
      navigator.mediaSession.setActionHandler('stop', stopAndClosePlayer);
      if (onNextEpisode) {
        navigator.mediaSession.setActionHandler('nexttrack', onNextEpisode);
      }
    }
    return () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setActionHandler('stop', null);
      }
    };
  }, [title, subtitle, poster, onNextEpisode, stopAndClosePlayer]);

  const scheduleHideTimer = useCallback(() => {
    clearHideTimer();
    if (adGateActive || showSettings || showAudioPanel || showQualityPanel || showServerPanel || showDownloadQualityPicker) return;
    // Keep controls visible while a video error is showing — user must reach the server switcher
    if (videoError) return;
    hideTimer.current = setTimeout(() => {
      setShowControls(false);
    }, locked ? 2200 : 3800);
  }, [adGateActive, clearHideTimer, locked, showAudioPanel, showDownloadQualityPicker, showQualityPanel, showServerPanel, showSettings, videoError]);

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    scheduleHideTimer();
  }, [scheduleHideTimer]);

  const toggleControls = useCallback(() => {
    setShowControls((prev) => {
      const next = !prev;
      if (!next) {
        clearHideTimer();
      } else {
        setTimeout(() => scheduleHideTimer(), 0);
      }
      return next;
    });
  }, [clearHideTimer, scheduleHideTimer]);

  useEffect(() => {
    if (showControls) scheduleHideTimer();
    else clearHideTimer();

    return clearHideTimer;
  }, [showControls, scheduleHideTimer, clearHideTimer]);

  // Force controls visible whenever a video error is shown so the server switcher is always reachable
  useEffect(() => {
    if (videoError) {
      setShowControls(true);
      clearHideTimer();
    }
  }, [videoError, clearHideTimer]);

  // Only show loader overlay during initial fixed load period; hide during server switch for seamless experience
  const showLoaderOverlay = !!currentSrc && !videoError && (showFixedLoader || serverSwitchingRef.current);

  // ===== AUTO NEXT EPISODE OVERLAY =====
  useEffect(() => {
    if (!onNextEpisode || duration <= 0 || currentTime <= 0) return;
    if (nextEpCancelledRef.current) return;
    const remaining = duration - currentTime;
    // ONLY show in the last 60 seconds - strict check
    const inLast60 = remaining <= 60 && remaining > 0;
    if (inLast60 && !showNextEpOverlay) {
      setShowNextEpOverlay(true);
      setNextEpCountdown(Math.ceil(remaining));
    } else if (inLast60 && showNextEpOverlay) {
      setNextEpCountdown(Math.ceil(remaining));
    } else if (!inLast60 && showNextEpOverlay) {
      // User seeked back out of the last 60s zone - hide timer
      setShowNextEpOverlay(false);
      setNextEpCountdown(0);
    }
  }, [currentTime, duration, onNextEpisode, showNextEpOverlay]);

  // Reset next ep overlay when src OR currentSrc changes (covers both prop change and quality switch)
  useEffect(() => {
    setShowNextEpOverlay(false);
    setNextEpCountdown(0);
    nextEpCancelledRef.current = false;
  }, [src, currentSrc]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playbackRouteReady || !currentSrc) return;

    // Track last known good position for fallback recovery
    let lastKnownTime = 0;
    const onLoaded = () => {
      setDuration(v.duration);
      if (v.readyState >= 2) {
        setIsBuffering(false);
      }
      if (pendingSeek.current !== null) {
        v.currentTime = pendingSeek.current;
        pendingSeek.current = null;
      }
      // Only autoplay if ad gate is not active
      if (!adGateActive) {
        // Keep native audio path; do not force muted autoplay fallback
        v.play().catch(() => {});
      }
    };
    const onPlay = () => {
      setPlaying(true);
      setVideoError(false);
      setIsBuffering(false);
      // Start RAF loop for smooth progress
      const tick = () => {
        if (!v.paused && !v.ended) {
          const ct = v.currentTime;
          if (ct > 0) lastKnownTime = ct;
          const dur = v.duration;
          // Direct DOM updates for progress bar — 60fps, no React re-render
          if (progressRef.current && dur > 0) {
            progressRef.current.style.width = `${(ct / dur) * 100}%`;
          }
          if (timeDisplayRef.current && dur > 0) {
            timeDisplayRef.current.textContent = `${formatTime(ct)} / ${formatTime(dur)}`;
          }
          // Throttle React state to ~1 Hz so the giant component doesn't
          // re-render every frame. UI buttons stay smooth via DOM refs above.
          const now = performance.now();
          if (now - lastNativeSyncRef.current >= 1000) {
            lastNativeSyncRef.current = now;
            setCurrentTime(ct);
            if (Number.isFinite(dur) && dur > 0) setDuration(dur);
          }
          rafId.current = requestAnimationFrame(tick);
        }
      };
      rafId.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(rafId.current);
    };
    const onEnded = () => {
      setPlaying(false);
      cancelAnimationFrame(rafId.current);
      // Auto next episode
      if (onNextEpisode) {
        onNextEpisode();
      }
    };
    const MAX_RETRIES = 2;
    const onError = () => {
      const errSrc = currentSrc;
      const prev = retryAttemptsRef.current.get(errSrc) || 0;
      const next = prev + 1;
      retryAttemptsRef.current.set(errSrc, next);
      if (next > MAX_RETRIES) {
        console.log('Video failed after retries. URL:', currentSrc);
        failedSrcsRef.current.add(currentSrc);
        const sameQualityRouteFallback = buildPlaybackCandidates(
          activeSourceBaseRef.current,
          cdnEnabled,
          proxyUrl || undefined,
          proxyApiKey || undefined
        ).find((candidateSrc) => !failedSrcsRef.current.has(candidateSrc) && candidateSrc !== currentSrc);

        if (sameQualityRouteFallback) {
          pendingSeek.current = lastKnownTime || v?.currentTime || 0;
          setCurrentSrc(sameQualityRouteFallback);
          return;
        }

        const nextOption = availableQualities.find((q) => {
          const candidateRawSrc = manualServerSelected ? applyServerDomain(q.src, activeServerIndex) : q.src;
          const candidateSrc = getPrimaryPlaybackSrc(candidateRawSrc, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
          return !failedSrcsRef.current.has(candidateSrc) && candidateSrc !== currentSrc;
        });

        if (nextOption) {
          pendingSeek.current = lastKnownTime || v?.currentTime || 0;
          const nextFallbackRawSrc = manualServerSelected ? applyServerDomain(nextOption.src, activeServerIndex) : nextOption.src;
          const newFallbackSrc = getPrimaryPlaybackSrc(nextFallbackRawSrc, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
          activeSourceBaseRef.current = nextFallbackRawSrc;
          if (newFallbackSrc === currentSrc) {
            v.currentTime = pendingSeek.current;
            pendingSeek.current = null;
            v.load();
          } else {
            setCurrentSrc(newFallbackSrc);
          }
          setCurrentQuality(nextOption.label);
        } else {
          // ===== AUTO SERVER FAILOVER =====
          // All quality/route fallbacks exhausted — try next server automatically
          if (effectiveVideoServers.length > 1) {
            const nextServerIdx = (activeServerIndex + 1) % effectiveVideoServers.length;
            // Only auto-failover if we haven't cycled through all servers
            const failoverKey = `__server_failover_${nextServerIdx}`;
            if (!failedSrcsRef.current.has(failoverKey)) {
              failedSrcsRef.current.add(failoverKey);
              // Reset failed srcs for the new server (keep failover keys)
              const failoverKeys = new Set([...failedSrcsRef.current].filter(k => k.startsWith("__server_failover_")));
              failedSrcsRef.current = failoverKeys;
              switchServer(nextServerIdx);
              return;
            }
          }
          setVideoError(true);
        }
        return;
      }
      console.log(`Video error, retry ${next}/${MAX_RETRIES}...`);
      // Exponential backoff: 500ms, 1000ms
      const delay = next * 500;
      setTimeout(() => {
        if (v) {
          const savedTime = v.currentTime || lastKnownTime;
          // For MKV files, try removing the src attribute and re-setting it
          v.src = currentSrc;
          v.load();
          v.addEventListener('loadedmetadata', () => {
            if (savedTime > 0) v.currentTime = savedTime;
            v.play().catch(() => {});
          }, { once: true });
          // Also listen for canplay as fallback for MKV
          v.addEventListener('canplay', () => {
            if (savedTime > 0 && Math.abs(v.currentTime - savedTime) > 2) {
              v.currentTime = savedTime;
            }
            v.play().catch(() => {});
          }, { once: true });
        }
      }, delay);
    };
    const onLoadedData = () => {
      if (v.readyState >= 2) {
        setVideoError(false);
        setIsBuffering(false);
      }
    };
    const onCanPlay = () => {
      setVideoError(false);
      setIsBuffering(false);
      // Also apply pending seek here in case loadedmetadata didn't fire
      if (pendingSeek.current !== null && v.duration > 0) {
        v.currentTime = pendingSeek.current;
        pendingSeek.current = null;
      }
      if (v.paused && !adGateActive) {
        // Keep native audio path; manual user interaction will start playback if autoplay is blocked
        v.play().catch(() => {});
      }
    };
    const onCanPlayThrough = () => {
      setIsBuffering(false);
    };
    // Debounce waiting briefly to avoid flashing on tiny buffer hiccups
    let waitingTimer: ReturnType<typeof setTimeout> | null = null;
    const onWaiting = () => {
      if (waitingTimer) clearTimeout(waitingTimer);
      // Longer debounce — avoid flashing loader on tiny network hiccups during smooth playback
      waitingTimer = setTimeout(() => {
        if (v.readyState < 3) setIsBuffering(true);
      }, 1200);
    };
    const onPlaying = () => {
      if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = null; }
      if (stalledTimer) { clearTimeout(stalledTimer); stalledTimer = null; }
      setVideoError(false);
      setIsBuffering(false);
    };
    const onLoadStart = () => {
      // Only show loader if we genuinely don't have data yet
      if (v.readyState < 2) setIsBuffering(true);
    };
    const onSeeked = () => {
      setIsBuffering(false);
    };
    let stalledTimer: ReturnType<typeof setTimeout> | null = null;
    const onStalled = () => {
      if (stalledTimer) clearTimeout(stalledTimer);
      stalledTimer = setTimeout(() => {
        if (v.readyState < 3) setIsBuffering(true);
      }, 1500);
    };
    const onSuspend = () => {
      if (!v.paused && v.readyState >= 3) {
        setIsBuffering(false);
      }
    };
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onError);
    v.addEventListener("loadeddata", onLoadedData);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("canplaythrough", onCanPlayThrough);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("stalled", onStalled);
    v.addEventListener("suspend", onSuspend);
    v.addEventListener("loadstart", onLoadStart);
    // Show loader only if data isn't already buffered (fast switch keeps UI clean)
    if (v.readyState < 2) setIsBuffering(true);
    // NOTE: do NOT call v.load() — setting v.src already triggers loading.
    // Forcing v.load() on every server/quality switch restarts download from scratch
    // and adds 5-10s latency on otherwise-fast HTTPS sources.

    return () => {
      cancelAnimationFrame(rafId.current);
      if (stalledTimer) clearTimeout(stalledTimer);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onError);
      v.removeEventListener("loadeddata", onLoadedData);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("canplaythrough", onCanPlayThrough);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("stalled", onStalled);
      v.removeEventListener("suspend", onSuspend);
      // NOTE: do NOT clear v.src here. This cleanup runs on every currentSrc change
      // (server / quality / audio switch). Wiping src would discard the freshly-set
      // source React just rendered and force a restart from 0:00. Real teardown
      // happens in the unmount-only effect below.
    };
  }, [currentSrc, adGateActive, availableQualities, currentQuality, cdnEnabled, proxyUrl, playbackRouteReady, switchServer, effectiveVideoServers, activeServerIndex]);

  // Unmount-only teardown: stop background playback when the player is removed.
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v) {
        try { v.pause(); } catch {}
        try { v.removeAttribute("src"); v.src = ""; v.load(); } catch {}
      }
      if (preloadLinkRef.current) {
        try { document.head.removeChild(preloadLinkRef.current); } catch {}
        preloadLinkRef.current = null;
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      }
    };
  }, []);

  useEffect(() => {
    const onFs = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      // Unlock orientation when exiting fullscreen externally (e.g. swipe gesture)
      if (!fs) { try { (screen.orientation as any).unlock?.(); } catch {} }
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  // Pause video when app goes background / tab hidden
  useEffect(() => {
    const pausePlayback = () => {
      const v = videoRef.current;
      if (!v) return;
      if (!v.paused) {
        v.pause();
        setPlaying(false);
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) pausePlayback();
    };

    window.addEventListener('pagehide', pausePlayback);
    window.addEventListener('beforeunload', pausePlayback);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', pausePlayback);
      window.removeEventListener('beforeunload', pausePlayback);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const togglePlay = useCallback(() => {
    if (isEmbedPlayback) {
      sendEmbedCmd(playing ? "pause" : "play");
      setPlaying((p) => !p);
      resetHideTimer();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
    resetHideTimer();
  }, [isEmbedPlayback, playing, resetHideTimer, sendEmbedCmd]);

  const MAX_VOL = 100;
  const applyPlayerVolume = useCallback((nextBoost: number, nextMuted = muted) => {
    const clampedBoost = Math.max(0, Math.min(MAX_VOL, nextBoost));
    const effectiveMuted = nextMuted || clampedBoost <= 0;
    setBoostedVolume(clampedBoost);
    setMuted(effectiveMuted);
    setVolume(Math.min(1, clampedBoost / 100));
    if (isEmbedPlayback) {
      sendEmbedCmd("mute", { muted: effectiveMuted });
      sendEmbedCmd("volume", { volume: effectiveMuted ? 0 : Math.min(1, clampedBoost / 100) });
      return;
    }
    const v = videoRef.current;
    if (v) {
      v.muted = effectiveMuted;
      v.volume = effectiveMuted ? 0 : Math.min(1, clampedBoost / 100);
    }
  }, [muted, isEmbedPlayback, sendEmbedCmd]);

  const getSafeSeekTime = useCallback((v: HTMLVideoElement, target: number) => {
    if (!Number.isFinite(v.duration) || v.duration <= 0) return 0;

    let clamped = Math.min(Math.max(target, 0), v.duration);

    // For proxied streams, seek only within seekable range to prevent reset-to-zero
    if (v.seekable && v.seekable.length > 0) {
      const start = v.seekable.start(0);
      const end = v.seekable.end(v.seekable.length - 1);
      clamped = Math.min(Math.max(clamped, start), end);
    }

    return clamped;
  }, []);

  const seek = useCallback((seconds: number) => {
    if (isEmbedPlayback) {
      const dur = embedTimeRef.current.duration || 0;
      const cur = embedTimeRef.current.currentTime || 0;
      const next = Math.max(0, Math.min(dur || cur + seconds, cur + seconds));
      sendEmbedCmd("seek", { time: next });
      embedTimeRef.current.currentTime = next;
      setSkipIndicator({ side: seconds > 0 ? "right" : "left", text: `${Math.abs(seconds)}s` });
      setTimeout(() => setSkipIndicator(null), 600);
      resetHideTimer();
      return;
    }
    const v = videoRef.current;
    if (!v) return;

    const nextTime = getSafeSeekTime(v, v.currentTime + seconds);
    v.currentTime = nextTime;

    setSkipIndicator({ side: seconds > 0 ? "right" : "left", text: `${Math.abs(seconds)}s` });
    setTimeout(() => setSkipIndicator(null), 600);
    resetHideTimer();
  }, [getSafeSeekTime, isEmbedPlayback, resetHideTimer, sendEmbedCmd]);

  const toggleFullscreen = useCallback(async () => {
    const el = videoContainerRef.current || containerRef.current || videoRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        try { (screen.orientation as any).unlock?.(); } catch {}
        await document.exitFullscreen();
      } else {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
        try { await (screen.orientation as any).lock?.('landscape'); } catch {}
      }
    } catch (e) { console.log('Fullscreen not supported'); }
  }, []);

  const setSpeed = useCallback((rate: number) => {
    if (isEmbedPlayback) {
      sendEmbedCmd("rate", { rate });
    } else if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
    setPlaybackRate(rate);
    setShowSettings(false);
  }, [isEmbedPlayback, sendEmbedCmd]);


  const switchQuality = useCallback((option: QualityOption) => {
    // Block 4K for non-premium users
    if (is4KLabel(option.label) && !isPremium) return;
    if (option.label === currentQuality) { setShowSettings(false); return; }

    sourceBaseRef.current = option.src;
    const finalOptionSrc = manualServerSelected ? applyServerDomain(option.src, activeServerIndex) : option.src;
    activeSourceBaseRef.current = finalOptionSrc;
    const newSrc = resolvePlaybackSrc(finalOptionSrc);

    if (newSrc === currentSrc) {
      setCurrentQuality(option.label);
      setShowSettings(false);
      return;
    }
    const v = videoRef.current;
    pendingSeek.current = v?.currentTime || 0;
    setIsBuffering(true);
    setCurrentSrc(newSrc);
    setCurrentQuality(option.label);
    setShowSettings(false);

  }, [currentQuality, currentSrc, isPremium, resolvePlaybackSrc, manualServerSelected, activeServerIndex, applyServerDomain]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = getSafeSeekTime(v, pct * v.duration);
    resetHideTimer();
  }, [getSafeSeekTime, resetHideTimer]);

  // Touch drag seeking on progress bar
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isSeeking = useRef(false);

  const handleProgressTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isSeeking.current = true;
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    v.currentTime = getSafeSeekTime(v, pct * v.duration);
    resetHideTimer();
  }, [getSafeSeekTime, resetHideTimer]);

  const handleProgressTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!isSeeking.current) return;
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    const target = getSafeSeekTime(v, pct * v.duration);
    v.currentTime = target;

    // Update progress bar immediately
    if (progressRef.current && v.duration > 0) {
      progressRef.current.style.width = `${(target / v.duration) * 100}%`;
    }
    if (timeDisplayRef.current && v.duration > 0) {
      timeDisplayRef.current.textContent = `${formatTime(target)} / ${formatTime(v.duration)}`;
    }
  }, [getSafeSeekTime]);

  const handleProgressTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isSeeking.current = false;
  }, []);

  const lastTap = useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  const handleVideoClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (locked) return;
    const now = Date.now();
    const clientX = "touches" in e ? e.changedTouches[0].clientX : e.clientX;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;

    if (now - lastTap.current.time < 250) {
      // Double tap — cancel single tap
      // Double tap detected
      if (relX < 0.33) seek(-10);
      else if (relX > 0.66) seek(10);
      else {
        togglePlay();
        setSkipIndicator({ side: "center", text: playing ? "⏸" : "▶" });
        setTimeout(() => setSkipIndicator(null), 600);
      }
      lastTap.current = { time: 0, x: 0 };
    } else {
      lastTap.current = { time: now, x: clientX };
      // Show controls INSTANTLY on single tap — no 300ms wait
      toggleControls();
    }
  }, [locked, seek, togglePlay, playing, toggleControls]);


  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    setSwipeState({ startX: t.clientX, startY: t.clientY, type: null });
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swipeState || locked) return;
    const t = e.touches[0];
    const dy = t.clientY - swipeState.startY;
    if (!swipeState.type && Math.abs(dy) > 20) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const relX = (swipeState.startX - rect.left) / rect.width;
      setSwipeState({ ...swipeState, type: relX > 0.5 ? "volume" : "brightness" });
    }
    if (swipeState.type === "volume") {
      const newBoosted = Math.min(MAX_VOL, Math.max(0, boostedVolume - dy * 0.8));
      applyPlayerVolume(newBoosted, false);
      setSwipeState({ ...swipeState, startY: t.clientY });
    } else if (swipeState.type === "brightness") {
      const newBr = Math.min(1.5, Math.max(0.3, brightness - dy * 0.003));
      setBrightness(newBr);
      setSwipeState({ ...swipeState, startY: t.clientY });
    }
  }, [swipeState, locked, brightness, boostedVolume, muted, applyPlayerVolume]);

  const handleTouchEnd = useCallback(() => setSwipeState(null), []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const lightweightMode = !isFullscreen;

  return (
    <div className={`fixed inset-0 z-[300] bg-background/[0.98] flex flex-col items-center ${isFullscreen ? '' : 'overflow-y-auto'}`} ref={containerRef}>
      {/* Close button */}
      {!isFullscreen && (
          <button onClick={stopAndClosePlayer} className="absolute top-5 right-5 z-[310] w-10 h-10 rounded-full gradient-primary flex items-center justify-center transition-all">
          <X className="w-5 h-5" />
        </button>
      )}

      <div className={`w-full ${isFullscreen ? 'h-full p-0' : 'max-w-full p-5'}`}>
        {!isFullscreen && (
          <div className="text-center mb-2.5">
            <h1 className="text-2xl font-extrabold text-primary tracking-wider">{branding.playerName}</h1>
          </div>
        )}

        {!isFullscreen && (
          <div className="text-center mb-5">
            <p className="text-lg font-semibold">{title}</p>
            {subtitle && <p className="text-sm text-secondary-foreground">{subtitle}</p>}
          </div>
        )}

        {/* Video Container - will-change for GPU compositing */}
        <div
          ref={videoContainerRef}
          className={`relative bg-black overflow-hidden ${
            isFullscreen 
              ? "w-screen h-screen rounded-none" 
              : "w-full rounded-xl aspect-video"
          }`}
          style={{ filter: `brightness(${brightness})`, margin: isFullscreen ? 0 : undefined }}
          onContextMenu={(e) => e.preventDefault()}
          onClick={handleVideoClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* No thumbnail/poster overlay — solid black bg only for fast load */}
          {/* ===== Server 1 (HuggingFace / Firem) iframe mode =====
              When the active server domain is hf.space (or any host serving
              our branded `req.html`), play the MKV inside that page so the
              browser doesn't choke on the Matroska container. The iframe is
              the *visual* surface — UI/controls live in this player and drive
              the embed via postMessage (see useEffect above). */}
          {isEmbedPlayback && !adGateActive ? (
            (() => {
              // currentSrc is already the fully-built watch URL produced by
              // applyServerDomain() — e.g.
              //   https://xxx.hf.space/watch/http://fi3.bot-hosting.net/.../file.mkv
              // We load it directly as the iframe src. The hf.space backend
              // serves the player page (or proxies the video) at that path.
              return (
                <iframe
                  ref={embedIframeRef}
                  src={currentSrc}
                  className="absolute inset-0 w-full h-full bg-black border-0 block"
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="no-referrer"
                  title="player"
                />
              );
            })()
          ) : (
            <video
              ref={videoRef}
              src={adGateActive ? "" : currentSrc}
              className="w-full h-full bg-black"
              style={{ objectFit: cropModes[cropIndex], WebkitTouchCallout: "none", userSelect: "none" }}
              playsInline
              preload={adGateActive ? "none" : "auto"}
              autoPlay={!adGateActive}
              controlsList="nodownload noplaybackrate noremoteplayback"
              disablePictureInPicture
              disableRemotePlayback
              onContextMenu={(e) => e.preventDefault()}
              onDragStart={(e) => e.preventDefault()}
            />
          )}

          {/* Video Error Banner — non-blocking, controls always remain accessible above (z-40) */}
          {videoError && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[5] pointer-events-none px-3 max-w-[90%]">
              <div className="player-glass rounded-xl px-3 py-2 flex items-center gap-2 pointer-events-auto shadow-lg border border-destructive/40 bg-black/70">
                <div className="w-7 h-7 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
                  <X className="w-4 h-4 text-destructive" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-white truncate">Video unavailable</p>
                  <p className="text-[10px] text-white/70 truncate">Tap a different server below</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setVideoError(false); setIsBuffering(true); const v = videoRef.current; if (v) { v.load(); } }} className="px-2.5 py-1 rounded-md gradient-primary text-[10px] font-semibold shrink-0">
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Loading spinner on top of thumbnail */}
          {showLoaderOverlay && (
            <div className="absolute inset-0 flex items-center justify-center z-[6] pointer-events-none bg-black/10">
              <div className="player-loader-shell">
                <span className="player-loader-petal" />
                <span className="player-loader-petal" />
                <span className="player-loader-petal" />
                <span className="player-loader-petal" />
                <span className="player-loader-petal" />
                <span className="player-loader-petal" />
                <span className="player-loader-petal" />
                <span className="player-loader-petal" />
                <span className="player-loader-petal" />
                <span className="player-loader-petal" />
                <span className="player-loader-petal" />
                <span className="player-loader-petal" />
              </div>
            </div>
          )}

          {skipIndicator && (
            <div className={`absolute top-1/2 -translate-y-1/2 skip-indicator w-16 h-16 flex items-center justify-center text-foreground text-xl font-bold ${
              skipIndicator.side === "left" ? "left-[15%]" :
              skipIndicator.side === "right" ? "right-[15%]" : "left-1/2 -translate-x-1/2"
            }`}>
              {skipIndicator.side === "left" ? <Rewind className="w-6 h-6" /> :
               skipIndicator.side === "right" ? <FastForward className="w-6 h-6" /> :
               <span className="text-2xl">{skipIndicator.text}</span>}
              {skipIndicator.side !== "center" && <span className="text-xs mt-1 absolute -bottom-5">{skipIndicator.text}</span>}
            </div>
          )}

          {/* Auto Next Episode Overlay */}
          {showNextEpOverlay && onNextEpisode && !videoError && (
            <div className="absolute bottom-20 right-3 z-30 animate-in slide-in-from-right-5 duration-500" onClick={(e) => e.stopPropagation()}>
              <div className="player-glass rounded-xl p-3 pr-4 flex items-center gap-3 shadow-lg border border-primary/30" style={{ boxShadow: "0 0 20px hsla(176, 65%, 48%, 0.2)" }}>
                <div className="relative w-10 h-10 flex items-center justify-center">
                  {/* Circular countdown */}
                  <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="16" fill="none" stroke="hsla(176,65%,48%,0.15)" strokeWidth="2" />
                    <circle cx="18" cy="18" r="16" fill="none" stroke="hsl(176,65%,48%)" strokeWidth="2.5"
                      strokeDasharray={`${(nextEpCountdown / 60) * 100} 100`}
                      strokeLinecap="round" className="transition-all duration-1000" />
                  </svg>
                  <span className="absolute text-[10px] font-bold text-primary">{nextEpCountdown}s</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Up Next</span>
                  <span className="text-xs font-semibold text-foreground">Next Episode</span>
                </div>
                <div className="flex gap-1.5 ml-1">
                  <button onClick={() => { nextEpCancelledRef.current = true; setShowNextEpOverlay(false); }} className="text-[9px] text-muted-foreground hover:text-foreground px-2 py-1 rounded bg-foreground/10">
                    Cancel
                  </button>
                  <button onClick={() => onNextEpisode()} className="text-[10px] font-bold px-3 py-1 rounded-lg gradient-primary btn-glow flex items-center gap-1">
                    Play <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {swipeState?.type && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 player-glass px-6 py-3 rounded-xl text-center">
              {swipeState.type === "volume" ? (
                <div className="flex items-center gap-2">
                  {muted || boostedVolume <= 0 ? <VolumeX className="w-5 h-5 text-primary" /> : <Volume2 className="w-5 h-5 text-primary" />}
                  <span className="text-sm font-semibold">{Math.round(boostedVolume)}%</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-primary text-lg">☀</span>
                  <span className="text-sm font-semibold">{Math.round(brightness * 100)}%</span>
                </div>
              )}
            </div>
          )}

          {/* Controls Overlay - smooth fade in/out */}
          {!locked && (
            <div
              className={`absolute inset-0 flex flex-col justify-between text-white transition-opacity duration-300 ease-out ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
              style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 30%, transparent 60%, rgba(0,0,0,0.7) 70%)" }}
            >
              {/* Top controls */}
              <div className="flex justify-end gap-2 p-3">
                <button onClick={(e) => { e.stopPropagation(); setCropIndex((cropIndex + 1) % 3); }} className="player-touch-button h-7 px-2.5 rounded-full flex items-center justify-center gap-1 transition-transform duration-150 active:scale-95">
                  <Crop className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium">{cropLabels[cropIndex]}</span>
                </button>
                {effectiveVideoServers.length > 1 && !noServerSwitch && (
                  <div className="relative">
                    <button onClick={(e) => { e.stopPropagation(); setShowServerPanel(!showServerPanel); }} className={`player-touch-button h-7 px-2.5 rounded-full flex items-center justify-center gap-1 transition-transform duration-150 active:scale-95 ${manualServerSelected ? 'ring-1 ring-primary' : ''}`}>
                      <Server className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-medium">{manualServerSelected ? (effectiveVideoServers[activeServerIndex]?.name || `S${activeServerIndex + 1}`) : "Default"}</span>
                    </button>
                    {showServerPanel && (
                      <div className="absolute top-9 right-0 player-glass rounded-xl p-2 z-30 min-w-[140px] shadow-lg" onClick={(e) => e.stopPropagation()}>
                        <p className="text-[9px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Server</p>
                        {!isPremium && (
                          <button onClick={() => {
                            const tierDefault = getTierDefaultSelection(sourceBaseRef.current);
                            setShowServerPanel(false);
                            setActiveServerIndex(tierDefault.serverIndex);
                            setManualServerSelected(tierDefault.usesServer);
                            activeSourceBaseRef.current = tierDefault.rawSrc;
                            setCurrentSrc(tierDefault.resolvedSrc);
                          }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between gap-2 ${
                              !manualServerSelected ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                            }`}>
                            <span>Default</span>
                            {!manualServerSelected && <Check className="w-3 h-3" />}
                          </button>
                        )}
                        {effectiveVideoServers.map((srv, idx) => {
                          const isLocked = srv.locked && !isPremium;
                          return (
                            <button key={idx} onClick={() => { if (!isLocked) switchServer(idx); }}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between gap-2 ${
                                activeServerIndex === idx ? "gradient-primary font-bold text-white" : isLocked ? "opacity-50 cursor-not-allowed" : "hover:bg-foreground/10"
                              }`}>
                              <span className="flex items-center gap-1.5">
                                {srv.locked && <Lock className="w-3 h-3 text-accent" />}
                                {srv.name || `Server ${idx + 1}`}
                              </span>
                              {isLocked && <span className="text-[8px] text-accent font-medium">Premium</span>}
                              {!isLocked && activeServerIndex === idx && <Check className="w-3 h-3" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={(e) => { e.stopPropagation(); setLocked(true); resetHideTimer(); }} className="player-touch-button w-8 h-8 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                  <Lock className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Center play */}
              <div className="flex items-center justify-center gap-8">
                <button onClick={(e) => { e.stopPropagation(); seek(-10); }} className="player-touch-button w-10 h-10 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                  <SkipBack className="w-5 h-5" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="player-touch-button player-touch-button--primary w-14 h-14 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                  {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-1" />}
                </button>
                <button onClick={(e) => { e.stopPropagation(); seek(10); }} className="player-touch-button w-10 h-10 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                  <SkipForward className="w-5 h-5" />
                </button>
              </div>

              {/* Bottom controls */}
              <div className="px-3 pb-3">
                {/* Progress bar - GPU accelerated with will-change */}
                <div
                  ref={progressBarRef}
                  className="w-full h-6 flex items-center cursor-pointer mb-2 relative touch-none"
                  onClick={(e) => { e.stopPropagation(); handleProgressClick(e); }}
                  onTouchStart={handleProgressTouchStart}
                  onTouchMove={handleProgressTouchMove}
                  onTouchEnd={handleProgressTouchEnd}
                >
                  <div className="w-full h-1.5 bg-foreground/20 rounded-full relative">
                    <div
                      ref={progressRef}
                      className="h-full gradient-primary rounded-full relative"
                      style={{ width: `${progress}%` }}
                    >
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary shadow-[0_0_10px_hsla(355,85%,55%,0.6)]" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span ref={timeDisplayRef} className="text-[11px] font-medium">{formatTime(currentTime)} / {formatTime(duration)}</span>
                    <button onClick={(e) => {
                      e.stopPropagation();
                      applyPlayerVolume(boostedVolume, !muted);
                    }} className="w-6 h-6 flex items-center justify-center">
                      {muted || boostedVolume <= 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="player-control-chip text-[10px] px-2 py-0.5 rounded">{playbackRate}x</span>
                    {availableQualities.length > 1 && (
                      <div className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowQualityPanel(!showQualityPanel); }}
                          className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-all ${
                            currentQuality !== "Auto" ? "gradient-primary text-white" : "player-control-chip"
                          }`}
                        >
                          {currentQuality}
                        </button>
                        {showQualityPanel && (
                          <div className="absolute bottom-8 right-0 player-glass rounded-xl p-2 z-30 min-w-[120px] shadow-lg" onClick={(e) => e.stopPropagation()}>
                            <p className="text-[9px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Quality</p>
                            {availableQualities.map((opt) => {
                              const is4K = is4KLabel(opt.label);
                              const locked4K = is4K && !isPremium;
                              return (
                                <button key={opt.label} onClick={() => { if (!locked4K) { switchQuality(opt); setShowQualityPanel(false); } }}
                                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between ${
                                    locked4K ? "opacity-50 cursor-not-allowed" :
                                    currentQuality === opt.label ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                                  }`}>
                                  <span className="flex items-center gap-1.5">
                                    {opt.label}
                                    {locked4K && <Lock className="w-3 h-3 text-accent" />}
                                  </span>
                                  {locked4K && <span className="text-[8px] text-accent font-medium">Premium</span>}
                                  {!locked4K && currentQuality === opt.label && <Check className="w-3 h-3" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Audio track button */}
                    {audioTrackOptions.length > 0 && (
                      <div className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowAudioPanel(!showAudioPanel); setShowQualityPanel(false); }}
                          className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-all flex items-center gap-1 ${
                            currentAudioTrack !== "Default" ? "gradient-primary text-white" : "player-control-chip"
                          }`}
                        >
                          🎧 {currentAudioTrack === "Default" ? "Audio" : currentAudioTrack}
                        </button>
                        {showAudioPanel && (
                          <div className="absolute bottom-8 right-0 player-glass rounded-xl p-2 z-30 min-w-[140px] shadow-lg" onClick={(e) => e.stopPropagation()}>
                            <p className="text-[9px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Audio Track</p>
                            <button onClick={resetToDefaultAudio}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between ${
                                currentAudioTrack === "Default" ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                              }`}>
                              <span>Default</span>
                              {currentAudioTrack === "Default" && <Check className="w-3 h-3" />}
                            </button>
                            {audioTrackOptions.map((track, idx) => (
                              <button key={idx} onClick={() => switchAudioTrack(track)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between ${
                                  currentAudioTrack === track.label ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                                }`}>
                                <span className="flex items-center gap-1.5">
                                  🎧 {track.label}
                                </span>
                                {currentAudioTrack === track.label && <Check className="w-3 h-3" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {onNextEpisode && (
                      <button onClick={(e) => { e.stopPropagation(); onNextEpisode(); }} className="player-control-chip text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-transform duration-150 active:scale-95">
                        Next <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); setSettingsTab("speed"); }} className="player-touch-button w-7 h-7 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                      <Settings className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="player-touch-button w-7 h-7 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                      {isFullscreen ? <Minimize className="w-3 h-3" /> : <Maximize className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Locked indicator */}
          {locked && showControls && (
            <div className="absolute top-3 right-3 z-20" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setLocked(false); setShowControls(true); scheduleHideTimer(); }} className="player-touch-button w-10 h-10 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                <Unlock className="w-4 h-4 text-primary" />
              </button>
            </div>
          )}
          {locked && !showControls && (
            <div className="absolute inset-0" onClick={(e) => { e.stopPropagation(); setShowControls(true); scheduleHideTimer(); }} />
          )}

          {/* Settings panel */}
          {showSettings && (
            <div className="absolute bottom-16 right-3 player-glass rounded-xl p-3 z-20 min-w-[180px] max-h-[250px] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setShowSettings(false)} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-foreground/20 flex items-center justify-center hover:bg-foreground/30 transition-all">
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="flex gap-1.5 mb-3 pr-7">
                <button onClick={() => setSettingsTab("speed")} className={`text-[11px] px-3 py-1.5 rounded-full font-medium transition-all ${settingsTab === "speed" ? "gradient-primary text-white" : "bg-foreground/10 hover:bg-foreground/20"}`}>
                  Speed
                </button>
                <button onClick={() => setSettingsTab("quality")} className={`text-[11px] px-3 py-1.5 rounded-full font-medium transition-all ${settingsTab === "quality" ? "gradient-primary text-white" : "bg-foreground/10 hover:bg-foreground/20"}`}>
                  Quality
                </button>
                {audioTrackOptions.length > 0 && (
                  <button onClick={() => setSettingsTab("audio")} className={`text-[11px] px-3 py-1.5 rounded-full font-medium transition-all ${settingsTab === "audio" ? "gradient-primary text-white" : "bg-foreground/10 hover:bg-foreground/20"}`}>
                    🎧 Audio
                  </button>
                )}
              </div>

              {settingsTab === "speed" && (
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Playback Speed</p>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <button key={r} onClick={() => setSpeed(r)}
                      className={`block w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${playbackRate === r ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"}`}>
                      {r}x {r === 1 && "(Normal)"}
                    </button>
                  ))}
                </div>
              )}

              {settingsTab === "quality" && (
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Video Quality</p>
                  {availableQualities.map((opt) => {
                    const is4K = is4KLabel(opt.label);
                    const locked4K = is4K && !isPremium;
                    return (
                      <button key={opt.label} onClick={() => { if (!locked4K) switchQuality(opt); }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between ${
                          locked4K ? "opacity-50 cursor-not-allowed" :
                          currentQuality === opt.label ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                        }`}>
                        <span className="flex items-center gap-1.5">
                          {opt.label}
                          {locked4K && <Lock className="w-3 h-3 text-accent" />}
                        </span>
                        {locked4K && <span className="text-[8px] text-accent font-medium">Premium</span>}
                        {!locked4K && currentQuality === opt.label && <Check className="w-3.5 h-3.5" />}
                      </button>
                    );
                  })}
                  {availableQualities.length <= 1 && (
                    <p className="text-[10px] text-muted-foreground/60 text-center py-2">No additional qualities available</p>
                  )}
                </div>
              )}

              {settingsTab === "audio" && (
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Audio Language</p>
                  <button onClick={resetToDefaultAudio}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between ${
                      currentAudioTrack === "Default" ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                    }`}>
                    <span>Default</span>
                    {currentAudioTrack === "Default" && <Check className="w-3.5 h-3.5" />}
                  </button>
                  {audioTrackOptions.map((track, idx) => {
                    const qualityCount = [track.src480, track.src720, track.src1080, track.src4k].filter(Boolean).length;
                    return (
                    <button key={idx} onClick={() => switchAudioTrack(track)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between ${
                        currentAudioTrack === track.label ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                      }`}>
                      <span className="flex items-center gap-1.5">
                        🎧 {track.label}
                        {qualityCount > 0 && <span className="text-[9px] opacity-60 ml-1">({qualityCount + 1} qualities)</span>}
                      </span>
                      {currentAudioTrack === track.label && <Check className="w-3.5 h-3.5" />}
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Device limit is now enforced at login time - no overlay needed */}

        {/* Ad Gate Overlay – bilingual professional verify card */}
        {adGateActive && !unlockBlocked && (() => {
          const t = verifyLang === "bn"
            ? {
                title: "ফ্রি অ্যাক্সেস আনলক করুন",
                subtitle: "নিচের যেকোনো একটি বাটনে ক্লিক করে সংক্ষিপ্ত শর্টনার শেষ করুন – সম্পন্ন হলে অটো আনলক হয়ে যাবে।",
                howTitle: "কীভাবে কাজ করে",
                step1: "১. নিচের যেকোনো আনলক বাটনে চাপুন",
                step2: "২. শর্টনার পেজে কয়েক সেকেন্ড অপেক্ষা করুন",
                step3: "৩. ফিরে আসার পর অ্যাক্সেস অটো আনলক হবে",
                or: "অথবা টেলিগ্রাম থেকে পাওয়া টোকেন পেস্ট করুন",
                placeholder: "আপনার অ্যাক্সেস টোকেন এখানে পেস্ট করুন",
                claim: "টোকেন দিয়ে আনলক করুন",
                preparing: "লিংক প্রস্তুত হচ্ছে...",
                langBtn: "EN",
              }
            : {
                title: "Unlock Free Access",
                subtitle: "Tap any unlock button below, complete the short link – you'll be redirected back automatically.",
                howTitle: "How it works",
                step1: "1. Tap any Unlock button below",
                step2: "2. Wait a few seconds on the shortener page",
                step3: "3. You'll be redirected back automatically",
                or: "Or paste the token you received from Telegram",
                placeholder: "Paste your access token here",
                claim: "Unlock with token",
                preparing: "Preparing links...",
                langBtn: "বাং",
              };
          return (
          <div className="fixed inset-0 z-[400] bg-black/90 flex items-center justify-center backdrop-blur-sm p-3 overflow-y-auto">
            <div className="relative bg-gradient-to-br from-card via-card to-background rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl border border-primary/20 my-auto">
              {/* Lang toggle */}
              <button
                onClick={() => setVerifyLang(v => v === "en" ? "bn" : "en")}
                className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-primary/15 text-primary text-[10px] font-bold border border-primary/30">
                🌐 {t.langBtn}
              </button>

              <div className="text-center space-y-1.5 pt-1">
                <div className="w-12 h-12 mx-auto rounded-full gradient-primary flex items-center justify-center">
                  <Lock className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-base font-bold text-foreground">{t.title}</h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{t.subtitle}</p>
              </div>

              {/* Steps */}
              <div className="bg-muted/40 rounded-xl p-3 space-y-1 text-left">
                <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">{t.howTitle}</p>
                <p className="text-[11px] text-foreground/80">{t.step1}</p>
                <p className="text-[11px] text-foreground/80">{t.step2}</p>
                <p className="text-[11px] text-foreground/80">{t.step3}</p>
              </div>

              {shortenLoading ? (
                <div className="flex items-center justify-center gap-2 py-3">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">{t.preparing}</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {adLinks.map((link, i) => (
                    <button
                      key={link.service.id || i}
                      onClick={() => handleOpenAdLink(link.shortUrl, link.service)}
                      className="w-full py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 text-white text-sm"
                      style={{ background: link.service.color || (i === 0 ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "linear-gradient(135deg, #f59e0b, #ef4444)") }}
                    >
                      <ExternalLink className="w-4 h-4" />
                      {link.service.icon || "🔓"} {link.service.name || `Unlock ${i + 1}`}
                      {link.service.durationHours ? (
                        <span className="text-[10px] opacity-80 ml-1">({link.service.durationHours}h)</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}

              {/* Token paste section */}
              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-[10px] text-center text-muted-foreground uppercase tracking-wider">— {t.or} —</p>
                <input
                  type="text"
                  value={accessCodeInput}
                  onChange={(e) => setAccessCodeInput(e.target.value.toUpperCase())}
                  placeholder={t.placeholder}
                  className="w-full px-3 py-2.5 rounded-xl bg-muted/60 border border-border text-center font-mono text-sm tracking-widest focus:outline-none focus:border-primary"
                  maxLength={20}
                />
                <button
                  onClick={handleClaimAccessCode}
                  disabled={accessCodeBusy || !accessCodeInput.trim()}
                  className="w-full py-2.5 rounded-xl gradient-primary text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                  {accessCodeBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {t.claim}
                </button>
              </div>

              {/* Tutorial Video Buttons */}
              {tutorialVideos.length > 0 ? (
                <div className="space-y-1.5">
                  {tutorialVideos.map((vid, idx) => (
                    <button key={idx}
                      onClick={() => { setActiveTutorialIdx(idx); setShowTutorialVideo(true); }}
                      className="w-full py-2 rounded-xl bg-secondary text-secondary-foreground font-medium flex items-center justify-center gap-2 transition-all active:scale-95 text-xs">
                      <Play className="w-3.5 h-3.5" />
                      {vid.title || `Tutorial ${idx + 1}`}
                    </button>
                  ))}
                </div>
              ) : tutorialLink ? (
                <button
                  onClick={() => { setActiveTutorialIdx(-1); setShowTutorialVideo(true); }}
                  className="w-full py-2 rounded-xl bg-secondary text-secondary-foreground font-medium flex items-center justify-center gap-2 transition-all active:scale-95 text-xs">
                  <Play className="w-3.5 h-3.5" />
                  How to open my link
                </button>
              ) : null}
            </div>
          </div>
          );
        })()}

        {unlockBlocked && (
          <div className="fixed inset-0 z-[450] bg-black/90 flex items-center justify-center backdrop-blur-sm p-5">
            <div className="bg-card rounded-2xl p-6 max-w-sm w-full text-center space-y-3 border border-border shadow-2xl">
              <h3 className="text-lg font-bold text-foreground">Access Blocked</h3>
              <p className="text-sm text-muted-foreground">This account is temporarily blocked because the same unlock token was used on multiple accounts.</p>
              <button onClick={onClose} className="w-full py-2.5 rounded-xl gradient-primary text-primary-foreground font-semibold">Close Player</button>
            </div>
          </div>
        )}

        {/* Tutorial Video Modal */}
        {showTutorialVideo && (() => {
          const activeVid = activeTutorialIdx >= 0 && tutorialVideos[activeTutorialIdx]
            ? tutorialVideos[activeTutorialIdx]
            : tutorialLink ? { title: "How to open my link", url: tutorialLink } : null;
          if (!activeVid) return null;
          return (
            <div className="fixed inset-0 z-[500] bg-black/95 flex items-center justify-center backdrop-blur-sm" onClick={() => setShowTutorialVideo(false)}>
              <div className="w-full max-w-xs mx-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-semibold text-foreground">📖 {activeVid.title}</h3>
                  <button onClick={() => setShowTutorialVideo(false)} className="w-8 h-8 rounded-full bg-foreground/20 flex items-center justify-center hover:bg-foreground/30 transition-all">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '9/16' }}>
                  <video
                    src={getPrimaryPlaybackSrc(activeVid.url, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined)}
                    className="w-full h-full"
                    controls
                    autoPlay
                    playsInline
                    style={{ objectFit: 'contain' }}
                    crossOrigin={activeVid.url.startsWith("http://") ? "anonymous" : undefined}
                    controlsList="nodownload noplaybackrate noremoteplayback"
                    disablePictureInPicture
                    disableRemotePlayback
                    onContextMenu={(e) => e.preventDefault()}
                  />
                </div>
              </div>
            </div>
          );
        })()}

        {/* Download Button with Quality Picker + Offline Playback */}
        {!isFullscreen && !adGateActive && !hideDownload && (() => {
          const normalizeKeyPart = (value: string) =>
            value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

          const createUrlHash = (value: string) => {
            let hash = 0;
            for (let i = 0; i < value.length; i++) {
              hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
            }
            return hash.toString(36);
          };

          const createDownloadId = (videoTitle: string, videoSubtitle: string | undefined, quality: string, url: string) => {
            const base = [videoTitle, videoSubtitle].filter(Boolean).map((part) => normalizeKeyPart(part as string)).join("__") || "video";
            const qualityPart = normalizeKeyPart(quality || "Auto") || "auto";
            return `${base}__${qualityPart}__${createUrlHash(url)}`;
          };

          const relatedDownloads = Array.from(activeDownloads.values()).filter((item: any) => (
            item.title === title && (!subtitle || item.subtitle === subtitle)
          ));

          const dl = relatedDownloads.find((item: any) => item.status === "downloading")
            ?? relatedDownloads.find((item: any) => item.status === "paused")
            ?? relatedDownloads.find((item: any) => item.status === "complete");

          const isDownloading = dl?.status === "downloading";
          const isPaused = dl?.status === "paused";
          const isComplete = dl?.status === "complete";

          // Check if this episode is already saved in IndexedDB
          const savedEpisode = downloadedEpisodes.find(d => d.subtitle === subtitle);
          const isAlreadySaved = !!savedEpisode;

          const startDownloadWithQuality = async (quality: string, qualitySrc: string) => {
            const dlId = createDownloadId(title, subtitle, quality, qualitySrc);
            const proxiedUrl = getPrimaryPlaybackSrc(qualitySrc, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
            const { downloadManager } = await import("@/lib/downloadManager");
            downloadManager.startDownload({
              id: dlId,
              url: proxiedUrl,
              title,
              subtitle,
              poster,
              quality,
            });
            setShowDownloadQualityPicker(false);
            const { toast } = await import("sonner");
            toast.info(`${quality} ডাউনলোড শুরু হয়েছে`);
          };

          // Bulk: download every episode of the current season at the chosen quality
          const startBulkDownloadWithQuality = async (quality: string) => {
            const season = seasons && currentSeasonIdx !== undefined ? seasons[currentSeasonIdx] : null;
            if (!season || !season.episodes?.length) {
              const { toast } = await import("sonner");
              toast.error("কোন এপিসোড পাওয়া যায়নি");
              return;
            }
            const { downloadManager } = await import("@/lib/downloadManager");
            const { toast } = await import("sonner");
            const pickEpUrl = (ep: any): string => {
              const q = quality.toLowerCase();
              if (q.includes("4k") || q.includes("2160")) return ep.link4k || ep.link1080 || ep.link720 || ep.link480 || ep.link;
              if (q.includes("1080")) return ep.link1080 || ep.link720 || ep.link480 || ep.link;
              if (q.includes("720")) return ep.link720 || ep.link480 || ep.link1080 || ep.link;
              if (q.includes("480")) return ep.link480 || ep.link720 || ep.link1080 || ep.link;
              return ep.link || ep.link1080 || ep.link720 || ep.link480;
            };
            let queued = 0;
            for (const ep of season.episodes) {
              const epUrl = pickEpUrl(ep);
              if (!epUrl) continue;
              const epSubtitle = `${season.name} - Episode ${ep.episodeNumber}`;
              const epDlId = createDownloadId(title, epSubtitle, quality, epUrl);
              const proxied = getPrimaryPlaybackSrc(epUrl, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
              downloadManager.startDownload({
                id: epDlId,
                url: proxied,
                title,
                subtitle: epSubtitle,
                poster,
                quality,
              });
              queued++;
            }
            setShowDownloadQualityPicker(false);
            setBulkDownloadMode(false);
            toast.success(`${queued} এপিসোড ${quality}-এ ডাউনলোড শুরু হয়েছে`);
          };

          const playOffline = async (episodeData?: any) => {
            const ep = episodeData || savedEpisode;
            if (!ep) return;
            const { getVideoBlob } = await import("@/lib/downloadStore");
            const blob = await getVideoBlob(ep.id);
            if (blob) {
              const blobUrl = URL.createObjectURL(blob);
              setOfflinePlaySrc(blobUrl);
              setOfflinePlayInfo(ep);
            } else {
              const { toast } = await import("sonner");
              toast.error("ভিডিও ফাইল পাওয়া যায়নি");
            }
          };

          return (
            <div className="mt-5 w-full max-w-md mx-auto space-y-3">
              {/* Main Download / Play Offline Button */}
              <div className="relative">
                {isAlreadySaved && !isDownloading && !isPaused ? (
                  /* Already downloaded - show play offline button */
                  <button
                    onClick={() => playOffline()}
                    className="relative w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all bg-primary text-primary-foreground hover:scale-[1.02]"
                  >
                    <Play className="w-4 h-4" /> Play Offline
                    {savedEpisode?.quality && savedEpisode.quality !== "Auto" && (
                      <span className="text-[10px] opacity-80">• {savedEpisode.quality}</span>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      if (isDownloading || isComplete) return;
                      if (isPaused && dl) {
                        const { downloadManager } = await import("@/lib/downloadManager");
                        downloadManager.resumeDownload(dl.id);
                        const { toast } = await import("sonner");
                        toast.info("Download resumed");
                        return;
                      }
                      // Show quality picker if multiple qualities available
                      if (availableQualities.length > 1) {
                        setBulkDownloadMode(false);
                        setShowDownloadQualityPicker(true);
                      } else {
                        // Only one quality - download directly
                        startDownloadWithQuality(currentQuality, src);
                      }
                    }}
                    disabled={isDownloading || isComplete}
                    className={`relative w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all overflow-hidden ${
                      isComplete
                        ? "bg-primary text-primary-foreground"
                        : isDownloading
                          ? "bg-secondary text-foreground border border-primary/30"
                          : isPaused
                            ? "bg-secondary text-foreground border border-accent/30"
                            : "gradient-primary text-primary-foreground btn-glow hover:scale-[1.02]"
                    }`}
                  >
                    {isDownloading && dl && (
                      <div
                        className="absolute inset-0 gradient-primary opacity-80 transition-all duration-300 ease-linear"
                        style={{ width: `${dl.percent}%` }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                      {isComplete ? (
                        <><Check className="w-4 h-4" /> Downloaded</>
                      ) : isDownloading && dl ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="font-mono">{dl.percent}%</span>
                          <span className="text-xs opacity-80">
                            {dl.loadedMB.toFixed(1)}/{dl.totalMB > 0 ? dl.totalMB.toFixed(1) : "??"} MB
                          </span>
                          {dl.quality !== "Auto" && <span className="text-[10px] opacity-80">• {dl.quality}</span>}
                        </>
                      ) : isPaused && dl ? (
                        <>
                          <PlayCircle className="w-4 h-4" />
                          <span>Resume</span>
                          <span className="font-mono text-xs opacity-80">{dl.percent}%</span>
                        </>
                      ) : (
                        <><Download className="w-4 h-4" /> Download</>
                      )}
                    </span>
                  </button>
                )}
                {/* Pause & Cancel buttons */}
                {isDownloading && dl && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex items-center gap-1">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const { downloadManager } = await import("@/lib/downloadManager");
                        downloadManager.pauseDownload(dl.id);
                        const { toast } = await import("sonner");
                        toast.info("Download paused");
                      }}
                      className="w-8 h-8 rounded-full bg-accent/80 hover:bg-accent flex items-center justify-center transition-all"
                    >
                      <PauseCircle className="w-4 h-4 text-white" />
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const { downloadManager } = await import("@/lib/downloadManager");
                        downloadManager.cancelDownload(dl.id);
                        const { toast } = await import("sonner");
                        toast.info("Download cancelled");
                      }}
                      className="w-8 h-8 rounded-full bg-destructive/80 hover:bg-destructive flex items-center justify-center transition-all"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                )}
              </div>

              {/* Download All Episodes (only for webseries with multiple episodes) */}
              {seasons && currentSeasonIdx !== undefined && seasons[currentSeasonIdx]?.episodes?.length > 1 && (
                <button
                  onClick={() => {
                    if (availableQualities.length > 1) {
                      setBulkDownloadMode(true);
                      setShowDownloadQualityPicker(true);
                    } else {
                      startBulkDownloadWithQuality(currentQuality || "Auto");
                    }
                  }}
                  className="w-full py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 bg-secondary text-foreground border border-primary/40 hover:bg-primary/10 transition-all text-sm"
                >
                  <Download className="w-4 h-4 text-primary" />
                  Download All Episodes
                  <span className="text-[10px] opacity-70">({seasons[currentSeasonIdx].episodes.length} eps • {seasons[currentSeasonIdx].name})</span>
                </button>
              )}

              {/* Quality Picker Dropdown */}
              {showDownloadQualityPicker && (
                <div className="bg-card border border-border rounded-xl p-3 shadow-xl animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-foreground">
                      {bulkDownloadMode ? "All Episodes — Select Quality" : "কোয়ালিটি সিলেক্ট করুন"}
                    </p>
                    <button
                      onClick={() => { setShowDownloadQualityPicker(false); setBulkDownloadMode(false); }}
                      className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {availableQualities.map((opt) => {
                      const is4K = is4KLabel(opt.label);
                      const locked4K = is4K && !isPremium;
                      return (
                        <button
                          key={opt.label}
                          onClick={() => {
                            if (locked4K) return;
                            if (bulkDownloadMode) startBulkDownloadWithQuality(opt.label);
                            else startDownloadWithQuality(opt.label, opt.src);
                          }}
                          disabled={locked4K}
                          className={`py-2.5 px-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                            locked4K
                              ? "bg-secondary/50 text-muted-foreground opacity-50 cursor-not-allowed"
                              : "bg-secondary hover:bg-primary hover:text-primary-foreground border border-border hover:border-primary"
                          }`}
                        >
                          <Download className="w-3.5 h-3.5" />
                          {opt.label}
                          {locked4K && <Lock className="w-3 h-3" />}
                        </button>
                      );
                    })}
                  </div>
                  {bulkDownloadMode && (
                    <p className="text-[10px] text-muted-foreground mt-2 text-center">
                      Episodes will queue one by one. Keep app open until done.
                    </p>
                  )}
                </div>
              )}

              {/* Downloaded Episodes List (inline, right here) */}
              {downloadedEpisodes.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-3">
                  <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5 text-primary" /> ডাউনলোড করা ({downloadedEpisodes.length})
                  </p>
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {downloadedEpisodes.map((ep) => (
                      <button
                        key={ep.id}
                        onClick={() => playOffline(ep)}
                        className={`w-full flex items-center gap-2.5 p-2 rounded-lg transition-all hover:bg-primary/10 ${
                          ep.subtitle === subtitle ? "bg-primary/15 border border-primary/30" : "bg-secondary/50"
                        }`}
                      >
                        {ep.poster && (
                          <img src={ep.poster} alt="" className="w-12 h-8 rounded object-cover flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-[11px] font-semibold text-foreground truncate">{ep.subtitle || ep.title}</p>
                          <p className="text-[9px] text-muted-foreground">
                            {ep.quality && ep.quality !== "Auto" ? ep.quality : ""} • {(ep.size / (1024 * 1024)).toFixed(1)} MB
                          </p>
                        </div>
                        <Play className="w-4 h-4 text-primary flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Season Selector + Episode List */}
        {episodeList && episodeList.length > 0 && (
          <div className="mt-4 bg-background rounded-xl p-4">
            {/* Season selector */}
            {seasons && seasons.length > 1 && onSeasonChange && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-muted-foreground">{seasons.length} Seasons</span>
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {seasons.map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => onSeasonChange(idx)}
                      className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        idx === (currentSeasonIdx ?? 0)
                          ? 'gradient-primary text-primary-foreground border-primary/30 shadow-[0_2px_12px_hsla(170,75%,45%,0.25)]'
                          : 'bg-secondary border-border/40 text-muted-foreground hover:border-primary/30'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Horizontal episode scroll */}
            <div className="grid grid-cols-5 gap-2 pb-2">
              {episodeList.map((ep) => (
                <button
                  key={ep.number}
                  onClick={ep.onClick}
                  className={`w-full h-12 rounded-xl flex items-center justify-center transition-all border text-center ${
                    ep.active
                      ? "gradient-primary border-primary/40 text-primary-foreground shadow-[0_0_12px_hsla(170,75%,45%,0.3)]"
                      : "bg-secondary/70 border-border/40 hover:border-primary/30 text-foreground"
                  }`}
                >
                  <span className="text-sm font-bold">{ep.number}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Suggested Videos */}
        {lightweightMode && suggestedAnime && suggestedAnime.length > 0 && onSuggestedClick && (
          <div className="mt-4 bg-background rounded-xl p-4">
            <h3 className="text-sm font-bold mb-3 flex items-center gap-1.5 text-foreground">
              <Play className="w-3.5 h-3.5 text-primary" /> Suggested for you
            </h3>
            <div className="grid grid-cols-3 gap-2.5">
              {suggestedAnime.map((anime) => (
                <div
                  key={anime.id}
                  onClick={() => onSuggestedClick(anime)}
                  className="w-full cursor-pointer group"
                >
                  <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-card mb-1.5">
                    <img src={anime.poster} alt={anime.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 40%, transparent 70%)" }} />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-8 h-8 rounded-full bg-primary/80 flex items-center justify-center">
                        <Play className="w-4 h-4 text-primary-foreground" fill="currentColor" />
                      </div>
                    </div>
                    <div className="absolute top-1 right-1 flex flex-col items-end gap-0.5 z-10">
                      {anime.year && <span className="text-[8px] font-bold bg-black/60 px-1.5 py-0.5 rounded text-white">{anime.year}</span>}
                      <span className={`px-1 py-0.5 rounded text-[7px] font-black tracking-wider ${anime.source === "animesalt" ? "bg-accent/85 text-accent-foreground" : "bg-primary/85 text-primary-foreground"}`}>{anime.source === "animesalt" ? "AN" : "RS"}</span>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-1.5">
                      <p className="text-[10px] font-semibold leading-tight line-clamp-2 text-white">{anime.title}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Offline Video Player Overlay */}
      {offlinePlaySrc && offlinePlayInfo && (
        <div className="fixed inset-0 z-[500] bg-black flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 bg-card border-b border-border/30">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{offlinePlayInfo.title}</p>
              <p className="text-xs text-muted-foreground truncate">{offlinePlayInfo.subtitle} {offlinePlayInfo.quality && offlinePlayInfo.quality !== "Auto" ? `• ${offlinePlayInfo.quality}` : ""}</p>
            </div>
            <button onClick={() => {
              if (offlinePlaySrc) URL.revokeObjectURL(offlinePlaySrc);
              setOfflinePlaySrc(null);
              setOfflinePlayInfo(null);
            }} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center hover:bg-destructive/80 transition-all ml-2">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 bg-black flex items-center justify-center">
            <video
              src={offlinePlaySrc}
              controls
              autoPlay
              playsInline
              className="w-full h-full"
              style={{ objectFit: "contain" }}
            />
          </div>
          {/* Other downloaded episodes navigation */}
          {downloadedEpisodes.length > 1 && (
            <div className="bg-card border-t border-border/30 p-3 max-h-[180px] overflow-y-auto">
              <p className="text-xs font-bold text-foreground mb-2">অন্যান্য ডাউনলোড</p>
              <div className="space-y-1">
                {downloadedEpisodes.filter(ep => ep.id !== offlinePlayInfo.id).map((ep) => (
                  <button
                    key={ep.id}
                    onClick={async () => {
                      if (offlinePlaySrc) URL.revokeObjectURL(offlinePlaySrc);
                      const { getVideoBlob } = await import("@/lib/downloadStore");
                      const blob = await getVideoBlob(ep.id);
                      if (blob) {
                        const blobUrl = URL.createObjectURL(blob);
                        setOfflinePlaySrc(blobUrl);
                        setOfflinePlayInfo(ep);
                      }
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg bg-secondary/50 hover:bg-primary/10 transition-all"
                  >
                    {ep.poster && <img src={ep.poster} alt="" className="w-12 h-8 rounded object-cover flex-shrink-0" />}
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-[11px] font-semibold text-foreground truncate">{ep.subtitle || ep.title}</p>
                      <p className="text-[9px] text-muted-foreground">{ep.quality} • {(ep.size / (1024 * 1024)).toFixed(1)} MB</p>
                    </div>
                    <Play className="w-4 h-4 text-primary flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default memo(VideoPlayer);
