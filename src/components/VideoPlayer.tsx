import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useBranding } from "@/hooks/useBranding";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, Settings, X, Lock, Unlock,
  ChevronRight, FastForward, Rewind, Crop, Check, ExternalLink, Loader2, Download, PauseCircle, PlayCircle, Server
} from "lucide-react";
import type { AnimeItem, Season } from "@/data/animeData";
import { db, ref, onValue, set, remove } from "@/lib/firebase";
import { createUnlockLinksForAllServices, createTelegramBotUnlockLink, getLocalUserId, type AdService } from "@/lib/unlockAccess";
import { isUnlockBlockActive } from "@/lib/unlockBlock";
import { CLOUDFLARE_CDN_URL, SUPABASE_URL } from "@/lib/siteConfig";

const isShortenerEnabled = async () => true;
const CLOUDFLARE_CDN = CLOUDFLARE_CDN_URL;
const BUILTIN_STREAM_PROXY = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/stream-proxy?url=` : "";

interface QualityOption {
  label: string;
  src: string;
}

// ============================================
// PROXY FUNCTIONS - Supports both {url} placeholder and direct append
// ============================================
const buildProxyPlaybackUrl = (proxyBase: string, targetUrl: string, apiKey?: string): string => {
  const base = proxyBase.trim();
  const encoded = encodeURIComponent(targetUrl);
  
  if (!base) return targetUrl;
  
  let url: string;
  
  // Type 1: {url} placeholder
  if (base.includes('{url}')) {
    url = base.split('{url}').join(encoded);
  }
  // Type 2: Already has ?url= or &url= or ends with = or ?url
  else if (base.includes('?url=') || base.includes('&url=') || base.endsWith('?url') || base.endsWith('=')) {
    if (base.endsWith('?url')) {
      url = `${base}=${encoded}`;
    } else {
      url = `${base}${encoded}`;
    }
  }
  // Default: append ?url=
  else {
    url = `${base.replace(/\/$/, '')}?url=${encoded}`;
  }
  
  if (apiKey) {
    url += (url.includes('?') ? '&' : '?') + `apikey=${encodeURIComponent(apiKey)}`;
  }
  
  return url;
};

const shouldUseEmbedPlayback = (url: string): boolean => {
  if (!url) return false;
  try {
    const { hostname, pathname } = new URL(url);
    const isHfHost = /(^|\.)hf\.space$/i.test(hostname) || /huggingface/i.test(hostname);
    return isHfHost && /^\/watch(?:\/|$)/i.test(pathname);
  } catch {
    return false;
  }
};

const buildPlaybackCandidates = (url: string, cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string): string[] => {
  if (!url) return [];

  const candidates: string[] = [];
  const addCandidate = (candidate?: string | null) => {
    if (!candidate || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  const isHttp = url.trim().toLowerCase().startsWith("http://");
  const isHttps = url.trim().toLowerCase().startsWith("https://");
  
  // Hugging Face embed mode
  if (shouldUseEmbedPlayback(url)) {
    addCandidate(url);
    return candidates;
  }

  // HTTPS: Direct play (NO proxy)
  if (isHttps) {
    addCandidate(url);
    return candidates;
  }

  // HTTP: Must use proxy (mixed-content bypass)
  if (isHttp) {
    const encoded = encodeURIComponent(url);
    
    // Cloudflare CDN proxy
    const cloudflareCandidate = CLOUDFLARE_CDN ? `${CLOUDFLARE_CDN}/video-proxy?url=${encoded}` : null;
    if (cdnEnabled && cloudflareCandidate) addCandidate(cloudflareCandidate);
    
    // Custom proxy from admin settings
    const customProxyCandidate = proxyUrl ? buildProxyPlaybackUrl(proxyUrl, url, proxyApiKey) : null;
    if (customProxyCandidate) addCandidate(customProxyCandidate);
    
    // Built-in Supabase proxy fallback
    if (BUILTIN_STREAM_PROXY) {
      const builtinCandidate = buildProxyPlaybackUrl(BUILTIN_STREAM_PROXY, url);
      if (builtinCandidate) addCandidate(builtinCandidate);
    }
    
    if (candidates.length === 0) addCandidate(url);
    return candidates;
  }

  addCandidate(url);
  return candidates;
};

const getPrimaryPlaybackSrc = (url: string, cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string): string => {
  return buildPlaybackCandidates(url, cdnEnabled, proxyUrl, proxyApiKey)[0] || url;
};

const formatTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

interface VideoPlayerProps {
  src: string;
  title: string;
  subtitle?: string;
  poster?: string;
  onClose: () => void;
  onNextEpisode?: () => void;
  episodeList?: { number: number; title?: string; active: boolean; onClick: () => void }[];
  qualityOptions?: QualityOption[];
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
}

const VideoPlayer = ({
  src,
  title,
  subtitle,
  poster,
  onClose,
  onNextEpisode,
  episodeList,
  qualityOptions,
  animeId,
  onSaveProgress,
  hideDownload,
  noProxy,
  noServerSwitch,
  seasons,
  currentSeasonIdx,
  onSeasonChange,
  suggestedAnime,
  onSuggestedClick
}: VideoPlayerProps) => {
  const branding = useBranding();
  const videoRef = useRef<HTMLVideoElement>(null);
  const embedIframeRef = useRef<HTMLIFrameElement>(null);
  const embedTimeRef = useRef({ currentTime: 0, duration: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const rafId = useRef<number>(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isSeeking = useRef(false);
  const lastTap = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const premiumServerApplied = useRef(false);
  const adGateActiveRef = useRef(false);

  // State
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [boostedVolume, setBoostedVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [skipIndicator, setSkipIndicator] = useState<{ side: "left" | "right" | "center"; text: string } | null>(null);
  const [brightness, setBrightness] = useState(1);
  const [swipeState, setSwipeState] = useState<{ startX: number; startY: number; type: string | null } | null>(null);
  const [cropIndex, setCropIndex] = useState(0);
  const [settingsTab, setSettingsTab] = useState<"speed" | "quality">("speed");
  const [currentQuality, setCurrentQuality] = useState<string>("Auto");
  const [cdnEnabled, setCdnEnabled] = useState(true);
  const [proxyUrl, setProxyUrl] = useState<string>('');
  const [proxyApiKey, setProxyApiKey] = useState<string>('');
  const [playbackRouteReady, setPlaybackRouteReady] = useState(false);
  const [currentSrc, setCurrentSrc] = useState('');
  const [activeRawSrc, setActiveRawSrc] = useState(src);
  const [isServerSwitching, setIsServerSwitching] = useState(false);
  const [videoServers, setVideoServers] = useState<{ name: string; domain: string; locked?: boolean }[]>([]);
  const [activeServerIndex, setActiveServerIndex] = useState(0);
  const [manualServerSelected, setManualServerSelected] = useState(false);
  const [showServerPanel, setShowServerPanel] = useState(false);
  const [isPremium, setIsPremium] = useState<boolean | null>(null);
  const [adGateActive, setAdGateActive] = useState(false);
  const [adLinks, setAdLinks] = useState<{ service: AdService; shortUrl: string }[]>([]);
  const [shortenLoading, setShortenLoading] = useState(false);
  const [showQualityPanel, setShowQualityPanel] = useState(false);
  const [showDownloadQualityPicker, setShowDownloadQualityPicker] = useState(false);
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<any[]>([]);
  const [offlinePlaySrc, setOfflinePlaySrc] = useState<string | null>(null);
  const [offlinePlayInfo, setOfflinePlayInfo] = useState<any>(null);
  const [videoError, setVideoError] = useState(false);
  const [qualityFailMsg, setQualityFailMsg] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(true);
  const [showFixedLoader, setShowFixedLoader] = useState(true);
  const [tutorialLink, setTutorialLink] = useState<string | null>(null);
  const [tutorialVideos, setTutorialVideos] = useState<{ title: string; url: string }[]>([]);
  const [showTutorialVideo, setShowTutorialVideo] = useState(false);
  const [activeTutorialIdx, setActiveTutorialIdx] = useState(0);
  const [showNextEpOverlay, setShowNextEpOverlay] = useState(false);
  const [nextEpCountdown, setNextEpCountdown] = useState(0);
  const nextEpCancelledRef = useRef(false);
  const [activeDownloads, setActiveDownloads] = useState<Map<string, any>>(new Map());
  const [globalFreeAccess, setGlobalFreeAccess] = useState<boolean>(false);
  const [deviceBlocked, setDeviceBlocked] = useState(false);
  const [userFreeAccessExpiresAt, setUserFreeAccessExpiresAt] = useState(0);
  const [freeAccessLoaded, setFreeAccessLoaded] = useState(false);
  const [unlockBlocked, setUnlockBlocked] = useState(false);
  const failedSrcsRef = useRef<Set<string>>(new Set());
  const loaderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cropModes = ["contain", "cover", "fill"] as const;
  const cropLabels = ["Fit", "Crop", "Stretch"];
  const isEmbedPlayback = useMemo(() => shouldUseEmbedPlayback(activeRawSrc), [activeRawSrc]);

  const availableQualities: QualityOption[] = useMemo(() => {
    const list: QualityOption[] = [{ label: "Auto", src }];
    if (qualityOptions?.length) qualityOptions.forEach(q => { if (q.src) list.push({ ...q }); });
    return list;
  }, [src, qualityOptions]);

  const resolvePlaybackSrc = useCallback((rawUrl: string) => {
    return getPrimaryPlaybackSrc(rawUrl, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
  }, [cdnEnabled, proxyUrl, proxyApiKey]);

  const applyServerDomain = useCallback((rawUrl: string, serverIndex: number) => {
    const server = videoServers[serverIndex];
    if (!server?.domain) return rawUrl;
    try {
      const url = new URL(rawUrl);
      return `${server.domain.replace(/\/$/, "")}${url.pathname}${url.search}${url.hash}`;
    } catch {
      const match = rawUrl.match(/^https?:\/\/[^\/]+(\/.*)/);
      return `${server.domain.replace(/\/$/, "")}${match ? match[1] : rawUrl}`;
    }
  }, [videoServers]);

  // ============================================
  // IFRAME EMBED BRIDGE (Hugging Face)
  // ============================================
  const sendEmbedCmd = useCallback((cmd: string, payload?: Record<string, unknown>) => {
    const w = embedIframeRef.current?.contentWindow;
    if (!w) return;
    try {
      w.postMessage({ target: "rs-embed", cmd, ...(payload || {}) }, "*");
    } catch { }
  }, []);

  const syncUiProgress = useCallback((nextTime: number, nextDuration: number) => {
    setCurrentTime(nextTime);
    if (Number.isFinite(nextDuration) && nextDuration >= 0) setDuration(nextDuration);
    if (progressRef.current && nextDuration > 0) {
      progressRef.current.style.width = `${(nextTime / nextDuration) * 100}%`;
    }
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = nextDuration > 0
        ? `${formatTime(nextTime)} / ${formatTime(nextDuration)}`
        : formatTime(nextTime);
    }
  }, []);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const d = ev.data as { source?: string; type?: string; currentTime?: number; duration?: number; code?: number } | null;
      if (!d || d.source !== "rs-embed") return;

      switch (d.type) {
        case "ready":
          sendEmbedCmd("mute", { muted });
          sendEmbedCmd("volume", { volume: muted ? 0 : Math.min(1, boostedVolume / 100) });
          sendEmbedCmd("rate", { rate: playbackRate });
          if (pendingSeek.current !== null) {
            sendEmbedCmd("seek", { time: pendingSeek.current });
            embedTimeRef.current.currentTime = pendingSeek.current;
          }
          if (!adGateActiveRef.current) sendEmbedCmd("play");
          break;
        case "meta":
          embedTimeRef.current = { currentTime: embedTimeRef.current.currentTime, duration: d.duration ?? 0 };
          syncUiProgress(embedTimeRef.current.currentTime, d.duration ?? 0);
          setIsServerSwitching(false);
          break;
        case "time":
          embedTimeRef.current = { currentTime: d.currentTime ?? 0, duration: d.duration ?? embedTimeRef.current.duration ?? 0 };
          syncUiProgress(embedTimeRef.current.currentTime, embedTimeRef.current.duration);
          break;
        case "canplay":
          setVideoError(false);
          setIsBuffering(false);
          setShowFixedLoader(false);
          setIsServerSwitching(false);
          if (pendingSeek.current !== null) {
            sendEmbedCmd("seek", { time: pendingSeek.current });
            embedTimeRef.current.currentTime = pendingSeek.current;
            pendingSeek.current = null;
          }
          if (!adGateActiveRef.current) sendEmbedCmd("play");
          break;
        case "playing":
          setPlaying(true);
          setVideoError(false);
          setIsBuffering(false);
          setShowFixedLoader(false);
          setIsServerSwitching(false);
          break;
        case "pause":
          setPlaying(false);
          break;
        case "waiting":
          setIsBuffering(true);
          break;
        case "ended":
          syncUiProgress(embedTimeRef.current.duration, embedTimeRef.current.duration);
          setPlaying(false);
          if (onNextEpisode) onNextEpisode();
          break;
        case "error":
          setPlaying(false);
          setIsBuffering(false);
          setShowFixedLoader(false);
          setIsServerSwitching(false);
          setVideoError(true);
          break;
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [boostedVolume, muted, onNextEpisode, playbackRate, sendEmbedCmd, syncUiProgress]);

  // ============================================
  // LOAD FIREBASE SETTINGS
  // ============================================
  useEffect(() => {
    const unsub = onValue(ref(db, "settings/videoServers"), (snap) => {
      const val = snap.val();
      let servers: { name: string; domain: string; locked?: boolean }[] = [];
      if (val && Array.isArray(val)) {
        servers = val.filter((s: any) => s && s.domain);
      } else if (val && typeof val === "object") {
        servers = Object.values(val).filter((s: any) => s && s.domain) as any[];
      }
      setVideoServers(servers);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (noProxy) {
      setCdnEnabled(false);
      setProxyUrl('');
      setProxyApiKey('');
      setPlaybackRouteReady(true);
      return;
    }
    setPlaybackRouteReady(true);
    const unsub1 = onValue(ref(db, "settings/cdnEnabled"), (snap) => {
      setCdnEnabled(snap.val() !== false);
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
    return () => { unsub1(); unsub2(); };
  }, [noProxy]);

  // Premium check
  useEffect(() => {
    const getUserId = (): string | null => {
      try { const u = localStorage.getItem("rsanime_user"); if (u) return JSON.parse(u).id; } catch { return null; }
    };
    const uid = getUserId();
    if (!uid) { setIsPremium(false); return; }
    const premRef = ref(db, `users/${uid}/premium`);
    const unsub = onValue(premRef, (snap) => {
      const data = snap.val();
      setIsPremium(!!(data && data.active === true && data.expiresAt > Date.now()));
    });
    return () => unsub();
  }, []);

  // Auto-switch to premium server
  useEffect(() => {
    if (isPremium && videoServers.length > 0 && !premiumServerApplied.current) {
      const premIdx = videoServers.findIndex(s => s.locked);
      if (premIdx >= 0 && premIdx !== activeServerIndex) {
        premiumServerApplied.current = true;
        setTimeout(() => switchServer(premIdx), 300);
      }
    }
  }, [isPremium, videoServers]);

  // Ad gate
  useEffect(() => {
    if (isPremium === null) return;
    if (!freeAccessLoaded) return;
    const uid = getLocalUserId();
    if (!uid) { setAdGateActive(false); return; }
    if (unlockBlocked) { setAdGateActive(false); return; }
    if (isPremium || (globalFreeAccess || userFreeAccessExpiresAt > Date.now())) {
      setAdGateActive(false);
      return;
    }
    isShortenerEnabled().then((on) => {
      if (!on) { setAdGateActive(false); return; }
      setAdGateActive(true);
      setShortenLoading(true);
      createUnlockLinksForAllServices().then((result) => {
        setShortenLoading(false);
        if (result.ok && result.links.length > 0) setAdLinks(result.links);
        else setAdGateActive(false);
      }).catch(() => { setShortenLoading(false); setAdGateActive(false); });
    });
  }, [isPremium, globalFreeAccess, userFreeAccessExpiresAt, unlockBlocked, freeAccessLoaded]);

  useEffect(() => {
    adGateActiveRef.current = adGateActive;
  }, [adGateActive]);

  // Watch history restore
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
            }
          }
        });
      });
    } catch { }
  }, [animeId]);

  // Save progress
  useEffect(() => {
    if (!onSaveProgress) return;
    const saveNow = () => {
      if (isEmbedPlayback) {
        const { currentTime: time, duration: total } = embedTimeRef.current;
        if (time > 0 && total > 0) onSaveProgress(time, total);
      } else {
        const v = videoRef.current;
        if (v && v.currentTime > 0 && v.duration > 0) onSaveProgress(v.currentTime, v.duration);
      }
    };
    const interval = setInterval(saveNow, 10000);
    return () => { clearInterval(interval); saveNow(); };
  }, [isEmbedPlayback, onSaveProgress]);

  // Load free access status
  useEffect(() => {
    const uid = getLocalUserId();
    if (!uid) {
      setUserFreeAccessExpiresAt(0);
      setUnlockBlocked(false);
      setFreeAccessLoaded(true);
      return;
    }
    const unsubAccess = onValue(ref(db, `users/${uid}/freeAccess`), async (snap) => {
      const data = snap.val();
      if (data?.active && Number(data.expiresAt) > Date.now()) {
        const { ensureFreeAccessDeviceAllowed } = await import("@/lib/freeAccessDevice");
        const allowed = await ensureFreeAccessDeviceAllowed(uid, data);
        setUserFreeAccessExpiresAt(allowed ? Number(data.expiresAt) : 0);
      } else {
        setUserFreeAccessExpiresAt(0);
      }
      setFreeAccessLoaded(true);
    }, () => setFreeAccessLoaded(true));
    const unsubBlocked = onValue(ref(db, `users/${uid}/security/unlockBlocked`), (snap) => {
      setUnlockBlocked(isUnlockBlockActive(snap.val()));
    });
    return () => { unsubAccess(); unsubBlocked(); };
  }, []);

  useEffect(() => {
    const unsub = onValue(ref(db, "globalFreeAccess"), (snap) => {
      const data = snap.val();
      setGlobalFreeAccess(!!(data?.active && data?.expiresAt > Date.now()));
    });
    return () => unsub();
  }, []);

  // Download manager
  useEffect(() => {
    let unsub: (() => void) | undefined;
    import("@/lib/downloadManager").then(({ downloadManager }) => {
      unsub = downloadManager.subscribe(setActiveDownloads);
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    import("@/lib/downloadStore").then(({ getAllDownloads }) => {
      getAllDownloads().then((all) => {
        setDownloadedEpisodes(all.filter(d => d.title === title));
      });
    });
  }, [title, activeDownloads]);

  // Switch server function
  const switchServer = useCallback((serverIndex: number) => {
    if (serverIndex === activeServerIndex || !videoServers[serverIndex]) return;
    if (videoServers[serverIndex].locked && !isPremium) return;

    const savedTime = isEmbedPlayback
      ? (embedTimeRef.current.currentTime || currentTime || 0)
      : (videoRef.current?.currentTime || 0);
    const newRawSrc = applyServerDomain(src, serverIndex);
    const resolved = resolvePlaybackSrc(newRawSrc);

    setShowServerPanel(false);
    setIsServerSwitching(true);
    setVideoError(false);
    setIsBuffering(true);
    setShowFixedLoader(true);
    setManualServerSelected(true);
    setActiveServerIndex(serverIndex);
    setActiveRawSrc(newRawSrc);
    pendingSeek.current = savedTime;
    embedTimeRef.current = { currentTime: savedTime, duration: embedTimeRef.current.duration || duration || 0 };
    setCurrentSrc(resolved);
  }, [activeServerIndex, applyServerDomain, currentTime, duration, isEmbedPlayback, isPremium, resolvePlaybackSrc, src, videoServers]);

  // Reset when src changes
  useEffect(() => {
    if (!playbackRouteReady) return;
    setActiveRawSrc(src);
    const resolvedSrc = resolvePlaybackSrc(src);
    pendingSeek.current = null;
    embedTimeRef.current = { currentTime: 0, duration: 0 };
    setCurrentSrc(resolvedSrc);
    setCurrentQuality("Auto");
    setManualServerSelected(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsBuffering(true);
    setShowFixedLoader(true);
    setIsServerSwitching(false);
    setVideoError(false);
    setQualityFailMsg(null);
    failedSrcsRef.current.clear();
  }, [src, playbackRouteReady, resolvePlaybackSrc]);

  // Loader timeout
  useEffect(() => {
    if (loaderTimeoutRef.current) clearTimeout(loaderTimeoutRef.current);
    if (!currentSrc) { setShowFixedLoader(false); return; }
    setShowFixedLoader(true);
    loaderTimeoutRef.current = setTimeout(() => {
      setShowFixedLoader(false);
      loaderTimeoutRef.current = null;
    }, 800);
    const v = videoRef.current;
    if (v && !isEmbedPlayback) {
      const hideLoader = () => {
        setShowFixedLoader(false);
        if (loaderTimeoutRef.current) clearTimeout(loaderTimeoutRef.current);
      };
      v.addEventListener("canplay", hideLoader, { once: true });
      v.addEventListener("playing", hideLoader, { once: true });
    }
    return () => { if (loaderTimeoutRef.current) clearTimeout(loaderTimeoutRef.current); };
  }, [currentSrc, isEmbedPlayback]);

  // Volume sync
  useEffect(() => {
    if (isEmbedPlayback) {
      sendEmbedCmd("mute", { muted });
      sendEmbedCmd("volume", { volume: muted ? 0 : Math.min(1, boostedVolume / 100) });
    } else {
      const v = videoRef.current;
      if (v) { v.muted = muted; v.volume = muted ? 0 : Math.min(1, boostedVolume / 100); }
    }
  }, [boostedVolume, muted, isEmbedPlayback, sendEmbedCmd]);

  // Video event handlers (non-embed)
  useEffect(() => {
    if (isEmbedPlayback || !videoRef.current || !currentSrc || adGateActive) return;
    const v = videoRef.current;
    let lastKnownTime = 0;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    const onLoaded = () => {
      setDuration(v.duration);
      if (pendingSeek.current !== null) { v.currentTime = pendingSeek.current; pendingSeek.current = null; }
      if (!adGateActive) v.play().catch(() => { });
    };
    const onPlay = () => {
      setPlaying(true);
      const tick = () => {
        if (!v.paused && !v.ended) {
          const ct = v.currentTime;
          if (ct > 0) lastKnownTime = ct;
          const dur = v.duration;
          if (progressRef.current && dur > 0) progressRef.current.style.width = `${(ct / dur) * 100}%`;
          if (timeDisplayRef.current && dur > 0) timeDisplayRef.current.textContent = `${formatTime(ct)} / ${formatTime(dur)}`;
          setCurrentTime(ct);
          rafId.current = requestAnimationFrame(tick);
        }
      };
      rafId.current = requestAnimationFrame(tick);
    };
    const onPause = () => { setPlaying(false); cancelAnimationFrame(rafId.current); };
    const onEnded = () => { setPlaying(false); cancelAnimationFrame(rafId.current); if (onNextEpisode) onNextEpisode(); };
    const onError = () => {
      if (retryCount >= MAX_RETRIES) {
        failedSrcsRef.current.add(currentSrc);
        const nextOption = availableQualities.find((q) => {
          const candidateSrc = getPrimaryPlaybackSrc(q.src, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
          return !failedSrcsRef.current.has(candidateSrc) && candidateSrc !== currentSrc;
        });
        if (nextOption) {
          setQualityFailMsg(`Switching to ${nextOption.label}...`);
          setTimeout(() => setQualityFailMsg(null), 4000);
          pendingSeek.current = lastKnownTime || v.currentTime || 0;
          setCurrentSrc(getPrimaryPlaybackSrc(nextOption.src, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined));
          setCurrentQuality(nextOption.label);
        } else {
          setVideoError(true);
        }
        return;
      }
      retryCount++;
      setTimeout(() => { v.load(); }, retryCount * 500);
    };
    const onCanPlay = () => {
      setVideoError(false);
      setIsBuffering(false);
      if (pendingSeek.current !== null && v.duration > 0) { v.currentTime = pendingSeek.current; pendingSeek.current = null; }
      if (v.paused && !adGateActive) v.play().catch(() => { });
    };
    let waitingTimer: ReturnType<typeof setTimeout> | null = null;
    const onWaiting = () => { if (waitingTimer) clearTimeout(waitingTimer); waitingTimer = setTimeout(() => setIsBuffering(true), 500); };
    const onPlaying = () => { if (waitingTimer) clearTimeout(waitingTimer); setIsBuffering(false); };

    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onError);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.load();

    return () => {
      cancelAnimationFrame(rafId.current);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onError);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.pause();
      v.src = '';
      v.load();
    };
  }, [currentSrc, adGateActive, availableQualities, cdnEnabled, proxyUrl, proxyApiKey, isEmbedPlayback, onNextEpisode]);

  // Fullscreen events
  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(!!document.fullscreenElement);
      if (!document.fullscreenElement) try { (screen.orientation as any).unlock?.(); } catch { }
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  // Controls timer
  const clearHideTimer = useCallback(() => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } }, []);
  const scheduleHideTimer = useCallback(() => {
    clearHideTimer();
    if (adGateActive || showSettings || showQualityPanel || showServerPanel || showDownloadQualityPicker) return;
    hideTimer.current = setTimeout(() => setShowControls(false), locked ? 1400 : 2600);
  }, [adGateActive, clearHideTimer, locked, showDownloadQualityPicker, showQualityPanel, showServerPanel, showSettings]);
  const resetHideTimer = useCallback(() => { setShowControls(true); scheduleHideTimer(); }, [scheduleHideTimer]);

  useEffect(() => { if (showControls) scheduleHideTimer(); else clearHideTimer(); return clearHideTimer; }, [showControls, scheduleHideTimer, clearHideTimer]);

  // MediaSession
  useEffect(() => {
    if ('mediaSession' in navigator) {
      const artworkSrc = (() => {
        if (!poster) return `${window.location.origin}/favicon.ico`;
        try { return poster.startsWith("http") ? poster : new URL(poster, window.location.origin).toString(); } catch { return `${window.location.origin}/favicon.ico`; }
      })();
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: subtitle || 'RS ANIME', album: 'RS ANIME', artwork: [{ src: artworkSrc, sizes: "512x512" }] });
      navigator.mediaSession.setActionHandler('play', () => togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => togglePlay());
      navigator.mediaSession.setActionHandler('seekbackward', () => seek(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => seek(10));
      navigator.mediaSession.setActionHandler('stop', stopAndClosePlayer);
      if (onNextEpisode) navigator.mediaSession.setActionHandler('nexttrack', onNextEpisode);
    }
    return () => { if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; } };
  }, [title, subtitle, poster, onNextEpisode]);

  const stopAndClosePlayer = useCallback(async () => {
    clearHideTimer();
    setShowControls(false);
    setLocked(false);
    setShowSettings(false);
    setShowQualityPanel(false);
    setShowServerPanel(false);
    try { if (document.fullscreenElement) { try { (screen.orientation as any).unlock?.(); } catch { } await document.exitFullscreen(); } } catch { }
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = ""; videoRef.current.load(); }
    if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
    onClose();
  }, [clearHideTimer, onClose]);

  const togglePlay = useCallback(() => {
    if (isEmbedPlayback) { sendEmbedCmd(playing ? "pause" : "play"); setPlaying(!playing); resetHideTimer(); return; }
    const v = videoRef.current;
    if (v) { if (v.paused) v.play(); else v.pause(); resetHideTimer(); }
  }, [isEmbedPlayback, playing, resetHideTimer, sendEmbedCmd]);

  const seek = useCallback((seconds: number) => {
    if (isEmbedPlayback) {
      const total = embedTimeRef.current.duration || duration || 0;
      const nextTime = Math.min(Math.max((embedTimeRef.current.currentTime || currentTime) + seconds, 0), total);
      embedTimeRef.current.currentTime = nextTime;
      sendEmbedCmd("seek", { time: nextTime });
      syncUiProgress(nextTime, total);
    } else {
      const v = videoRef.current;
      if (v) v.currentTime = Math.min(Math.max(v.currentTime + seconds, 0), v.duration);
    }
    setSkipIndicator({ side: seconds > 0 ? "right" : "left", text: `${Math.abs(seconds)}s` });
    setTimeout(() => setSkipIndicator(null), 600);
    resetHideTimer();
  }, [currentTime, duration, isEmbedPlayback, resetHideTimer, sendEmbedCmd, syncUiProgress]);

  const toggleFullscreen = useCallback(async () => {
    const el = videoContainerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        try { (screen.orientation as any).unlock?.(); } catch { }
        await document.exitFullscreen();
      } else {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
        try { await (screen.orientation as any).lock?.('landscape'); } catch { }
      }
    } catch (e) { console.log('Fullscreen not supported'); }
  }, []);

  const setSpeed = useCallback((rate: number) => {
    if (isEmbedPlayback) sendEmbedCmd("rate", { rate });
    else if (videoRef.current) videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSettings(false);
  }, [isEmbedPlayback, sendEmbedCmd]);

  const switchQuality = useCallback((option: QualityOption) => {
    if (option.label === currentQuality) { setShowSettings(false); return; }
    const savedTime = isEmbedPlayback ? (embedTimeRef.current.currentTime || currentTime || 0) : (videoRef.current?.currentTime || 0);
    setActiveRawSrc(option.src);
    const newSrc = resolvePlaybackSrc(option.src);
    pendingSeek.current = savedTime;
    setIsBuffering(true);
    setCurrentSrc(newSrc);
    setCurrentQuality(option.label);
    setShowSettings(false);
  }, [currentQuality, currentTime, isEmbedPlayback, resolvePlaybackSrc]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (isEmbedPlayback) {
      const total = embedTimeRef.current.duration || duration || 0;
      const target = pct * total;
      embedTimeRef.current.currentTime = target;
      sendEmbedCmd("seek", { time: target });
      syncUiProgress(target, total);
    } else {
      const v = videoRef.current;
      if (v) v.currentTime = pct * v.duration;
    }
    resetHideTimer();
  }, [duration, isEmbedPlayback, resetHideTimer, sendEmbedCmd, syncUiProgress]);

  const handleProgressTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isSeeking.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    if (isEmbedPlayback) {
      const total = embedTimeRef.current.duration || duration || 0;
      const target = pct * total;
      embedTimeRef.current.currentTime = target;
      sendEmbedCmd("seek", { time: target });
      syncUiProgress(target, total);
    } else {
      const v = videoRef.current;
      if (v) v.currentTime = pct * v.duration;
    }
    resetHideTimer();
  }, [duration, isEmbedPlayback, resetHideTimer, sendEmbedCmd, syncUiProgress]);

  const handleProgressTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!isSeeking.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    if (isEmbedPlayback) {
      const total = embedTimeRef.current.duration || duration || 0;
      const target = pct * total;
      embedTimeRef.current.currentTime = target;
      sendEmbedCmd("seek", { time: target });
      syncUiProgress(target, total);
    } else {
      const v = videoRef.current;
      if (v && v.duration > 0) {
        const target = pct * v.duration;
        v.currentTime = target;
        if (progressRef.current) progressRef.current.style.width = `${(target / v.duration) * 100}%`;
        if (timeDisplayRef.current) timeDisplayRef.current.textContent = `${formatTime(target)} / ${formatTime(v.duration)}`;
      }
    }
  }, [duration, isEmbedPlayback, sendEmbedCmd, syncUiProgress]);

  const handleProgressTouchEnd = useCallback(() => { isSeeking.current = false; }, []);

  const handleVideoClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (locked) return;
    const now = Date.now();
    const clientX = "touches" in e ? e.changedTouches[0].clientX : e.clientX;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;
    if (now - lastTap.current.time < 250) {
      if (relX < 0.33) seek(-10);
      else if (relX > 0.66) seek(10);
      else { togglePlay(); setSkipIndicator({ side: "center", text: playing ? "⏸" : "▶" }); setTimeout(() => setSkipIndicator(null), 600); }
      lastTap.current = { time: 0, x: 0 };
    } else {
      lastTap.current = { time: now, x: clientX };
      toggleControls();
    }
  }, [locked, seek, togglePlay, playing, toggleControls]);

  const toggleControls = useCallback(() => {
    setShowControls((prev) => { const next = !prev; if (!next) clearHideTimer(); else setTimeout(() => scheduleHideTimer(), 0); return next; });
  }, [clearHideTimer, scheduleHideTimer]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => { const t = e.touches[0]; setSwipeState({ startX: t.clientX, startY: t.clientY, type: null }); }, []);
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
      const newBoosted = Math.min(100, Math.max(0, boostedVolume - dy * 0.8));
      const effectiveMuted = newBoosted <= 0;
      setBoostedVolume(newBoosted);
      setMuted(effectiveMuted);
      if (isEmbedPlayback) {
        sendEmbedCmd("mute", { muted: effectiveMuted });
        sendEmbedCmd("volume", { volume: effectiveMuted ? 0 : Math.min(1, newBoosted / 100) });
      } else if (videoRef.current) {
        videoRef.current.muted = effectiveMuted;
        videoRef.current.volume = effectiveMuted ? 0 : Math.min(1, newBoosted / 100);
      }
      setSwipeState({ ...swipeState, startY: t.clientY });
    } else if (swipeState.type === "brightness") {
      setBrightness(Math.min(1.5, Math.max(0.3, brightness - dy * 0.003)));
      setSwipeState({ ...swipeState, startY: t.clientY });
    }
  }, [swipeState, locked, brightness, boostedVolume, isEmbedPlayback, sendEmbedCmd]);

  const handleTouchEnd = useCallback(() => setSwipeState(null), []);

  // Auto next episode overlay
  useEffect(() => {
    if (!onNextEpisode || duration <= 0 || currentTime <= 0) return;
    if (nextEpCancelledRef.current) return;
    const remaining = duration - currentTime;
    const inLast60 = remaining <= 60 && remaining > 0;
    if (inLast60 && !showNextEpOverlay) { setShowNextEpOverlay(true); setNextEpCountdown(Math.ceil(remaining)); }
    else if (inLast60 && showNextEpOverlay) setNextEpCountdown(Math.ceil(remaining));
    else if (!inLast60 && showNextEpOverlay) { setShowNextEpOverlay(false); setNextEpCountdown(0); }
  }, [currentTime, duration, onNextEpisode, showNextEpOverlay]);

  useEffect(() => { setShowNextEpOverlay(false); setNextEpCountdown(0); nextEpCancelledRef.current = false; }, [src, currentSrc]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const showLoaderOverlay = !!currentSrc && !videoError && showFixedLoader && !isServerSwitching;

  // Download functions
  const normalizeKeyPart = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const createUrlHash = (value: string) => { let hash = 0; for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0; return hash.toString(36); };
  const createDownloadId = (videoTitle: string, videoSubtitle: string | undefined, quality: string, url: string) => {
    const base = [videoTitle, videoSubtitle].filter(Boolean).map((part) => normalizeKeyPart(part as string)).join("__") || "video";
    return `${base}__${normalizeKeyPart(quality || "Auto")}__${createUrlHash(url)}`;
  };

  const startDownloadWithQuality = async (quality: string, qualitySrc: string) => {
    const dlId = createDownloadId(title, subtitle, quality, qualitySrc);
    const proxiedUrl = getPrimaryPlaybackSrc(qualitySrc, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
    const { downloadManager } = await import("@/lib/downloadManager");
    downloadManager.startDownload({ id: dlId, url: proxiedUrl, title, subtitle, poster, quality });
    setShowDownloadQualityPicker(false);
    const { toast } = await import("sonner");
    toast.info(`${quality} ডাউনলোড শুরু হয়েছে`);
  };

  const playOffline = async (episodeData?: any) => {
    const ep = episodeData || downloadedEpisodes.find(d => d.subtitle === subtitle);
    if (!ep) return;
    const { getVideoBlob } = await import("@/lib/downloadStore");
    const blob = await getVideoBlob(ep.id);
    if (blob) { setOfflinePlaySrc(URL.createObjectURL(blob)); setOfflinePlayInfo(ep); }
    else { const { toast } = await import("sonner"); toast.error("ভিডিও ফাইল পাওয়া যায়নি"); }
  };

  const handleOpenAdLink = useCallback(async (url: string, service?: AdService) => {
    const { openExternalBrowser } = await import("@/lib/openExternal");
    try {
      const fb = await import("@/lib/firebase");
      const isMiniMode = service?.mode === "miniapp";
      let globalMini = false;
      if (!isMiniMode) {
        const miniSnap = await fb.get(fb.ref(fb.db, "settings/unlockViaTelegramMini"));
        globalMini = miniSnap.val() === true;
      }
      if (isMiniMode || globalMini) {
        const botSnap = await fb.get(fb.ref(fb.db, "settings/telegramMiniBotUsername"));
        const botUsername = String(botSnap.val() || "RS_ANIME_ACCESS_BOT").replace(/^@/, "").trim();
        const uid = getLocalUserId();
        if (botUsername && uid) {
          const isStandaloneApp = window.matchMedia?.("(display-mode: standalone)")?.matches || (window.navigator as any).standalone === true;
          const sourceTag = isStandaloneApp ? "app" : "web";
          const panelTag = window.location.pathname.startsWith("/admin") ? "admin" : "user";
          window.location.href = `https://t.me/${botUsername}?startapp=u_${uid}_src_${sourceTag}_panel_${panelTag}`;
          return;
        }
      }
      const snap = await fb.get(fb.ref(fb.db, "settings/unlockViaTelegramBot"));
      if (snap.val() === true) {
        const r = await createTelegramBotUnlockLink();
        if (r.ok && r.deepLink) { window.location.href = r.deepLink; return; }
      }
    } catch { }
    if (url && url !== "miniapp://telegram") openExternalBrowser(url);
  }, []);

  // ============================================
  // RENDER
  // ============================================
  return (
    <div className={`fixed inset-0 z-[300] bg-background/[0.98] flex flex-col items-center ${isFullscreen ? '' : 'overflow-y-auto'}`} ref={containerRef}>
      {!isFullscreen && (
        <button onClick={stopAndClosePlayer} className="absolute top-5 right-5 z-[310] w-10 h-10 rounded-full gradient-primary flex items-center justify-center transition-all">
          <X className="w-5 h-5" />
        </button>
      )}

      <div className={`w-full ${isFullscreen ? 'h-full p-0' : 'max-w-full p-5'}`}>
        {!isFullscreen && (
          <>
            <div className="text-center mb-2.5">
              <h1 className="text-2xl font-extrabold text-primary tracking-wider">{branding.playerName}</h1>
            </div>
            <div className="text-center mb-5">
              <p className="text-lg font-semibold">{title}</p>
              {subtitle && <p className="text-sm text-secondary-foreground">{subtitle}</p>}
            </div>
          </>
        )}

        {/* Video Container */}
        <div
          ref={videoContainerRef}
          className={`relative bg-black overflow-hidden ${isFullscreen ? "w-screen h-screen rounded-none" : "w-full rounded-xl aspect-video"}`}
          style={{ filter: `brightness(${brightness})`, margin: isFullscreen ? 0 : undefined }}
          onContextMenu={(e) => e.preventDefault()}
          onClick={handleVideoClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Hugging Face Embed Mode */}
          {isEmbedPlayback ? (
            <iframe
              ref={embedIframeRef}
              key={activeRawSrc}
              src={`/req.html?src=${encodeURIComponent(activeRawSrc)}`}
              className="w-full h-full bg-black border-0"
              style={{ pointerEvents: "none" }}
              allow="autoplay; fullscreen; encrypted-media"
              allowFullScreen
              referrerPolicy="no-referrer"
              title="player"
            />
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

          {/* Error Overlay */}
          {videoError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
              <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center mb-4">
                <X className="w-8 h-8 text-destructive" />
              </div>
              <p className="text-base font-semibold text-foreground mb-1">Video Unavailable</p>
              <p className="text-xs text-muted-foreground mb-4 text-center px-6">Server is not responding. Try another episode or quality.</p>
              <button onClick={() => { setVideoError(false); setIsBuffering(true); setShowFixedLoader(true); if (!isEmbedPlayback && videoRef.current) videoRef.current.load(); else sendEmbedCmd("load", { src: activeRawSrc }); }} className="px-4 py-2 rounded-lg gradient-primary text-sm font-semibold btn-glow">
                Retry
              </button>
            </div>
          )}

          {/* Loader */}
          {showLoaderOverlay && (
            <div className="absolute inset-0 flex items-center justify-center z-[6] pointer-events-none">
              <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
          )}

          {/* Skip Indicator */}
          {skipIndicator && (
            <div className={`absolute top-1/2 -translate-y-1/2 skip-indicator w-16 h-16 flex items-center justify-center text-foreground text-xl font-bold ${skipIndicator.side === "left" ? "left-[15%]" : skipIndicator.side === "right" ? "right-[15%]" : "left-1/2 -translate-x-1/2"}`}>
              {skipIndicator.side === "left" ? <Rewind className="w-6 h-6" /> : skipIndicator.side === "right" ? <FastForward className="w-6 h-6" /> : <span className="text-2xl">{skipIndicator.text}</span>}
              {skipIndicator.side !== "center" && <span className="text-xs mt-1 absolute -bottom-5">{skipIndicator.text}</span>}
            </div>
          )}

          {/* Next Episode Overlay */}
          {showNextEpOverlay && onNextEpisode && !videoError && (
            <div className="absolute bottom-20 right-3 z-30 animate-in slide-in-from-right-5 duration-500" onClick={(e) => e.stopPropagation()}>
              <div className="player-glass rounded-xl p-3 pr-4 flex items-center gap-3 shadow-lg border border-primary/30">
                <div className="relative w-10 h-10 flex items-center justify-center">
                  <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="16" fill="none" stroke="hsla(176,65%,48%,0.15)" strokeWidth="2" />
                    <circle cx="18" cy="18" r="16" fill="none" stroke="hsl(176,65%,48%)" strokeWidth="2.5" strokeDasharray={`${(nextEpCountdown / 60) * 100} 100`} strokeLinecap="round" className="transition-all duration-1000" />
                  </svg>
                  <span className="absolute text-[10px] font-bold text-primary">{nextEpCountdown}s</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Up Next</span>
                  <span className="text-xs font-semibold text-foreground">Next Episode</span>
                </div>
                <div className="flex gap-1.5 ml-1">
                  <button onClick={() => { nextEpCancelledRef.current = true; setShowNextEpOverlay(false); }} className="text-[9px] text-muted-foreground hover:text-foreground px-2 py-1 rounded bg-foreground/10">Cancel</button>
                  <button onClick={() => onNextEpisode()} className="text-[10px] font-bold px-3 py-1 rounded-lg gradient-primary btn-glow flex items-center gap-1">Play <ChevronRight className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
          )}

          {/* Quality Fail Message */}
          {qualityFailMsg && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 player-glass px-4 py-2.5 rounded-xl text-center max-w-[85%] animate-in fade-in slide-in-from-top-2 duration-300">
              <p className="text-xs font-semibold text-accent">⚠ {qualityFailMsg}</p>
            </div>
          )}

          {/* Swipe Indicator */}
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

          {/* Controls Overlay */}
          {showControls && !locked && (
            <div className="absolute inset-0 flex flex-col justify-between text-white" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 30%, transparent 60%, rgba(0,0,0,0.7) 70%)" }}>
              {/* Top controls */}
              <div className="flex justify-end gap-2 p-3">
                <button onClick={(e) => { e.stopPropagation(); setCropIndex((cropIndex + 1) % 3); }} className="player-glass h-7 px-2.5 rounded-full flex items-center justify-center gap-1">
                  <Crop className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium">{cropLabels[cropIndex]}</span>
                </button>
                {videoServers.length > 1 && !noServerSwitch && (
                  <div className="relative">
                    <button onClick={(e) => { e.stopPropagation(); setShowServerPanel(!showServerPanel); }} className={`player-glass h-7 px-2.5 rounded-full flex items-center justify-center gap-1 ${manualServerSelected ? 'ring-1 ring-primary' : ''}`}>
                      <Server className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-medium">{manualServerSelected ? (videoServers[activeServerIndex]?.name || `S${activeServerIndex + 1}`) : "Default"}</span>
                    </button>
                    {showServerPanel && (
                      <div className="absolute top-9 right-0 player-glass rounded-xl p-2 z-30 min-w-[140px] shadow-lg" onClick={(e) => e.stopPropagation()}>
                        <p className="text-[9px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Server</p>
                        {!isPremium && (
                          <button onClick={() => {
                            setShowServerPanel(false);
                            setManualServerSelected(false);
                            setActiveRawSrc(src);
                            setCurrentSrc(resolvePlaybackSrc(src));
                          }} className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between gap-2 ${!manualServerSelected ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"}`}>
                            <span>Default</span> {!manualServerSelected && <Check className="w-3 h-3" />}
                          </button>
                        )}
                        {videoServers.map((srv, idx) => {
                          const isLocked = srv.locked && !isPremium;
                          return (
                            <button key={idx} onClick={() => { if (!isLocked) switchServer(idx); }} className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between gap-2 ${activeServerIndex === idx ? "gradient-primary font-bold text-white" : isLocked ? "opacity-50 cursor-not-allowed" : "hover:bg-foreground/10"}`}>
                              <span className="flex items-center gap-1.5">{srv.locked && <Lock className="w-3 h-3 text-accent" />}{srv.name || `Server ${idx + 1}`}</span>
                              {isLocked && <span className="text-[8px] text-accent font-medium">Premium</span>}
                              {!isLocked && activeServerIndex === idx && <Check className="w-3 h-3" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={(e) => { e.stopPropagation(); setLocked(true); resetHideTimer(); }} className="player-glass w-8 h-8 rounded-full flex items-center justify-center">
                  <Lock className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Center play */}
              <div className="flex items-center justify-center gap-8">
                <button onClick={(e) => { e.stopPropagation(); seek(-10); }} className="w-10 h-10 rounded-full bg-foreground/20 flex items-center justify-center backdrop-blur">
                  <SkipBack className="w-5 h-5" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="w-14 h-14 rounded-full gradient-primary flex items-center justify-center">
                  {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-1" />}
                </button>
                <button onClick={(e) => { e.stopPropagation(); seek(10); }} className="w-10 h-10 rounded-full bg-foreground/20 flex items-center justify-center backdrop-blur">
                  <SkipForward className="w-5 h-5" />
                </button>
              </div>

              {/* Bottom controls */}
              <div className="px-3 pb-3">
                <div ref={progressBarRef} className="w-full h-6 flex items-center cursor-pointer mb-2 relative touch-none" onClick={(e) => { e.stopPropagation(); handleProgressClick(e); }} onTouchStart={handleProgressTouchStart} onTouchMove={handleProgressTouchMove} onTouchEnd={handleProgressTouchEnd}>
                  <div className="w-full h-1.5 bg-foreground/20 rounded-full relative">
                    <div ref={progressRef} className="h-full gradient-primary rounded-full relative" style={{ width: `${progress}%` }}>
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary shadow-[0_0_10px_hsla(355,85%,55%,0.6)]" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span ref={timeDisplayRef} className="text-[11px] font-medium">{formatTime(currentTime)} / {formatTime(duration)}</span>
                    <button onClick={(e) => { e.stopPropagation(); if (isEmbedPlayback) { sendEmbedCmd("mute", { muted: !muted }); setMuted(!muted); } else { setMuted(!muted); } }} className="w-6 h-6 flex items-center justify-center">
                      {muted || boostedVolume <= 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-foreground/20 px-2 py-0.5 rounded">{playbackRate}x</span>
                    {availableQualities.length > 1 && (
                      <div className="relative">
                        <button onClick={(e) => { e.stopPropagation(); setShowQualityPanel(!showQualityPanel); }} className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-all ${currentQuality !== "Auto" ? "gradient-primary text-white" : "bg-foreground/20"}`}>
                          {currentQuality}
                        </button>
                        {showQualityPanel && (
                          <div className="absolute bottom-8 right-0 player-glass rounded-xl p-2 z-30 min-w-[120px] shadow-lg" onClick={(e) => e.stopPropagation()}>
                            <p className="text-[9px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Quality</p>
                            {availableQualities.map((opt) => (
                              <button key={opt.label} onClick={() => { switchQuality(opt); setShowQualityPanel(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between ${currentQuality === opt.label ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"}`}>
                                <span>{opt.label}</span>
                                {currentQuality === opt.label && <Check className="w-3 h-3" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {onNextEpisode && (
                      <button onClick={(e) => { e.stopPropagation(); onNextEpisode(); }} className="text-[10px] bg-primary/30 px-2 py-0.5 rounded flex items-center gap-1">
                        Next <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); setSettingsTab("speed"); }} className="player-glass w-7 h-7 rounded-full flex items-center justify-center">
                      <Settings className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="player-glass w-7 h-7 rounded-full flex items-center justify-center">
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
              <button onClick={() => { setLocked(false); setShowControls(true); scheduleHideTimer(); }} className="player-glass w-10 h-10 rounded-full flex items-center justify-center">
                <Unlock className="w-4 h-4 text-primary" />
              </button>
            </div>
          )}
          {locked && !showControls && (
            <div className="absolute inset-0" onClick={() => { setShowControls(true); scheduleHideTimer(); }} />
          )}

          {/* Settings panel */}
          {showSettings && (
            <div className="absolute bottom-16 right-3 player-glass rounded-xl p-3 z-20 min-w-[180px] max-h-[250px] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setShowSettings(false)} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-foreground/20 flex items-center justify-center hover:bg-foreground/30 transition-all">
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="flex gap-1.5 mb-3 pr-7">
                <button onClick={() => setSettingsTab("speed")} className={`text-[11px] px-3 py-1.5 rounded-full font-medium transition-all ${settingsTab === "speed" ? "gradient-primary text-white" : "bg-foreground/10 hover:bg-foreground/20"}`}>Speed</button>
                <button onClick={() => setSettingsTab("quality")} className={`text-[11px] px-3 py-1.5 rounded-full font-medium transition-all ${settingsTab === "quality" ? "gradient-primary text-white" : "bg-foreground/10 hover:bg-foreground/20"}`}>Quality</button>
              </div>
              {settingsTab === "speed" && (
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Playback Speed</p>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <button key={r} onClick={() => setSpeed(r)} className={`block w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${playbackRate === r ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"}`}>{r}x {r === 1 && "(Normal)"}</button>
                  ))}
                </div>
              )}
              {settingsTab === "quality" && (
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Video Quality</p>
                  {availableQualities.map((opt) => (
                    <button key={opt.label} onClick={() => switchQuality(opt)} className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between ${currentQuality === opt.label ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"}`}>
                      <span>{opt.label}</span>
                      {currentQuality === opt.label && <Check className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Ad Gate Overlay */}
        {adGateActive && !deviceBlocked && !unlockBlocked && (
          <div className="fixed inset-0 z-[400] bg-black/90 flex items-center justify-center backdrop-blur-sm">
            <div className="bg-card rounded-2xl p-6 max-w-sm w-[90%] text-center space-y-4 shadow-2xl border border-border">
              <h3 className="text-lg font-bold text-foreground">Unlock Free Access</h3>
              <p className="text-sm text-muted-foreground">Click any link below to get free streaming access</p>
              {shortenLoading ? (
                <div className="flex items-center justify-center gap-2 py-3">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Preparing links...</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {adLinks.map((link, i) => (
                    <button key={link.service.id || i} onClick={() => handleOpenAdLink(link.shortUrl, link.service)} className="w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all hover:scale-105 text-white" style={{ background: link.service.color || (i === 0 ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "linear-gradient(135deg, #f59e0b, #ef4444)") }}>
                      <ExternalLink className="w-4 h-4" /> {link.service.icon || "🔓"} {link.service.name || `Unlock ${i + 1}`}
                      {link.service.mode === "miniapp" ? <span className="text-[10px] opacity-80 ml-1">(Telegram)</span> : link.service.durationHours ? <span className="text-[10px] opacity-80 ml-1">({link.service.durationHours}h access)</span> : null}
                    </button>
                  ))}
                </div>
              )}
              {tutorialVideos.length > 0 ? (
                <div className="space-y-2">
                  {tutorialVideos.map((vid, idx) => (
                    <button key={idx} onClick={() => { setActiveTutorialIdx(idx); setShowTutorialVideo(true); }} className="w-full py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium flex items-center justify-center gap-2 transition-all hover:scale-105 text-sm">
                      <Play className="w-3.5 h-3.5" /> {vid.title || `Tutorial ${idx + 1}`}
                    </button>
                  ))}
                </div>
              ) : tutorialLink ? (
                <button onClick={() => { setActiveTutorialIdx(-1); setShowTutorialVideo(true); }} className="w-full py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium flex items-center justify-center gap-2 transition-all hover:scale-105 text-sm">
                  <Play className="w-3.5 h-3.5" /> How to open my link
                </button>
              ) : null}
            </div>
          </div>
        )}

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
          const activeVid = activeTutorialIdx >= 0 && tutorialVideos[activeTutorialIdx] ? tutorialVideos[activeTutorialIdx] : tutorialLink ? { title: "How to open my link", url: tutorialLink } : null;
          if (!activeVid) return null;
          return (
            <div className="fixed inset-0 z-[500] bg-black/95 flex items-center justify-center backdrop-blur-sm" onClick={() => setShowTutorialVideo(false)}>
              <div className="w-full max-w-xs mx-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-semibold text-foreground">📖 {activeVid.title}</h3>
                  <button onClick={() => setShowTutorialVideo(false)} className="w-8 h-8 rounded-full bg-foreground/20 flex items-center justify-center hover:bg-foreground/30 transition-all"><X className="w-4 h-4" /></button>
                </div>
                <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '9/16' }}>
                  <video src={getPrimaryPlaybackSrc(activeVid.url, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined)} className="w-full h-full" controls autoPlay playsInline style={{ objectFit: 'contain' }} controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback onContextMenu={(e) => e.preventDefault()} />
                </div>
              </div>
            </div>
          );
        })()}

        {/* Download Section */}
        {!isFullscreen && !adGateActive && !hideDownload && (() => {
          const relatedDownloads = Array.from(activeDownloads.values()).filter((item: any) => item.title === title && (!subtitle || item.subtitle === subtitle));
          const dl = relatedDownloads.find((item: any) => item.status === "downloading") ?? relatedDownloads.find((item: any) => item.status === "paused") ?? relatedDownloads.find((item: any) => item.status === "complete");
          const isDownloading = dl?.status === "downloading";
          const isPaused = dl?.status === "paused";
          const isComplete = dl?.status === "complete";
          const savedEpisode = downloadedEpisodes.find(d => d.subtitle === subtitle);
          const isAlreadySaved = !!savedEpisode;

          return (
            <div className="mt-5 w-full max-w-md mx-auto space-y-3">
              <div className="relative">
                {isAlreadySaved && !isDownloading && !isPaused ? (
                  <button onClick={() => playOffline()} className="relative w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all bg-primary text-primary-foreground hover:scale-[1.02]">
                    <Play className="w-4 h-4" /> Play Offline
                    {savedEpisode?.quality && savedEpisode.quality !== "Auto" && <span className="text-[10px] opacity-80">• {savedEpisode.quality}</span>}
                  </button>
                ) : (
                  <button onClick={async () => {
                    if (isDownloading || isComplete) return;
                    if (isPaused && dl) { const { downloadManager } = await import("@/lib/downloadManager"); downloadManager.resumeDownload(dl.id); const { toast } = await import("sonner"); toast.info("Download resumed"); return; }
                    if (availableQualities.length > 1) setShowDownloadQualityPicker(true);
                    else startDownloadWithQuality(currentQuality, src);
                  }} disabled={isDownloading || isComplete} className={`relative w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all overflow-hidden ${isComplete ? "bg-primary text-primary-foreground" : isDownloading ? "bg-secondary text-foreground border border-primary/30" : isPaused ? "bg-secondary text-foreground border border-accent/30" : "gradient-primary text-primary-foreground btn-glow hover:scale-[1.02]"}`}>
                    {isDownloading && dl && <div className="absolute inset-0 gradient-primary opacity-80 transition-all duration-300 ease-linear" style={{ width: `${dl.percent}%` }} />}
                    <span className="relative z-10 flex items-center gap-2">
                      {isComplete ? <><Check className="w-4 h-4" /> Downloaded</> : isDownloading && dl ? <><Loader2 className="w-4 h-4 animate-spin" /> <span className="font-mono">{dl.percent}%</span> <span className="text-xs opacity-80">{dl.loadedMB.toFixed(1)}/{dl.totalMB > 0 ? dl.totalMB.toFixed(1) : "??"} MB</span> {dl.quality !== "Auto" && <span className="text-[10px] opacity-80">• {dl.quality}</span>}</> : isPaused && dl ? <><PlayCircle className="w-4 h-4" /> <span>Resume</span> <span className="font-mono text-xs opacity-80">{dl.percent}%</span></> : <><Download className="w-4 h-4" /> Download</>}
                    </span>
                  </button>
                )}
                {isDownloading && dl && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex items-center gap-1">
                    <button onClick={async () => { const { downloadManager } = await import("@/lib/downloadManager"); downloadManager.pauseDownload(dl.id); }} className="w-8 h-8 rounded-full bg-accent/80 hover:bg-accent flex items-center justify-center transition-all"><PauseCircle className="w-4 h-4 text-white" /></button>
                    <button onClick={async () => { const { downloadManager } = await import("@/lib/downloadManager"); downloadManager.cancelDownload(dl.id); }} className="w-8 h-8 rounded-full bg-destructive/80 hover:bg-destructive flex items-center justify-center transition-all"><X className="w-4 h-4 text-white" /></button>
                  </div>
                )}
              </div>
              {showDownloadQualityPicker && (
                <div className="bg-card border border-border rounded-xl p-3 shadow-xl animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-foreground">কোয়ালিটি সিলেক্ট করুন</p>
                    <button onClick={() => setShowDownloadQualityPicker(false)} className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center"><X className="w-3 h-3" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {availableQualities.map((opt) => (
                      <button key={opt.label} onClick={() => startDownloadWithQuality(opt.label, opt.src)} className="py-2.5 px-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-1.5 bg-secondary hover:bg-primary hover:text-primary-foreground border border-border hover:border-primary">
                        <Download className="w-3.5 h-3.5" /> {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {downloadedEpisodes.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-3">
                  <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5"><Download className="w-3.5 h-3.5 text-primary" /> ডাউনলোড করা ({downloadedEpisodes.length})</p>
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {downloadedEpisodes.map((ep) => (
                      <button key={ep.id} onClick={() => playOffline(ep)} className={`w-full flex items-center gap-2.5 p-2 rounded-lg transition-all hover:bg-primary/10 ${ep.subtitle === subtitle ? "bg-primary/15 border border-primary/30" : "bg-secondary/50"}`}>
                        {ep.poster && <img src={ep.poster} alt="" className="w-12 h-8 rounded object-cover flex-shrink-0" />}
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-[11px] font-semibold text-foreground truncate">{ep.subtitle || ep.title}</p>
                          <p className="text-[9px] text-muted-foreground">{ep.quality && ep.quality !== "Auto" ? ep.quality : ""} • {(ep.size / (1024 * 1024)).toFixed(1)} MB</p>
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

        {/* Episode List */}
        {episodeList && episodeList.length > 0 && (
          <div className="mt-4 bg-background rounded-xl p-4">
            {seasons && seasons.length > 1 && onSeasonChange && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-muted-foreground">{seasons.length} Seasons</span>
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {seasons.map((s, idx) => (
                    <button key={idx} onClick={() => onSeasonChange(idx)} className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${idx === (currentSeasonIdx ?? 0) ? 'gradient-primary text-primary-foreground border-primary/30 shadow-[0_2px_12px_hsla(170,75%,45%,0.25)]' : 'bg-secondary border-border/40 text-muted-foreground hover:border-primary/30'}`}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-5 gap-2 pb-2">
              {episodeList.map((ep) => (
                <button key={ep.number} onClick={() => { if (ep.active) return; setVideoError(false); setIsBuffering(true); setShowFixedLoader(true); setIsServerSwitching(true); setPlaying(false); pendingSeek.current = null; embedTimeRef.current = { currentTime: 0, duration: 0 }; ep.onClick(); }} className={`w-full h-12 rounded-xl flex items-center justify-center transition-all border text-center ${ep.active ? "gradient-primary border-primary/40 text-primary-foreground shadow-[0_0_12px_hsla(170,75%,45%,0.3)]" : "bg-secondary/70 border-border/40 hover:border-primary/30 text-foreground"}`}>
                  <span className="text-sm font-bold">{ep.number}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Suggested Videos */}
        {suggestedAnime && suggestedAnime.length > 0 && onSuggestedClick && (
          <div className="mt-4 bg-background rounded-xl p-4">
            <h3 className="text-sm font-bold mb-3 flex items-center gap-1.5 text-foreground"><Play className="w-3.5 h-3.5 text-primary" /> Suggested for you</h3>
            <div className="grid grid-cols-3 gap-2.5">
              {suggestedAnime.map((anime) => (
                <div key={anime.id} onClick={() => onSuggestedClick(anime)} className="w-full cursor-pointer group">
                  <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-card mb-1.5">
                    <img src={anime.poster} alt={anime.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 40%, transparent 70%)" }} />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><div className="w-8 h-8 rounded-full bg-primary/80 flex items-center justify-center"><Play className="w-4 h-4 text-primary-foreground" fill="currentColor" /></div></div>
                    <div className="absolute top-1 right-1 flex flex-col items-end gap-0.5 z-10">
                      {anime.year && <span className="text-[8px] font-bold bg-black/60 px-1.5 py-0.5 rounded text-white">{anime.year}</span>}
                      <span className={`px-1 py-0.5 rounded text-[7px] font-black tracking-wider ${anime.source === "animesalt" ? "bg-accent/85 text-accent-foreground" : "bg-primary/85 text-primary-foreground"}`}>{anime.source === "animesalt" ? "AN" : "RS"}</span>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-1.5"><p className="text-[10px] font-semibold leading-tight line-clamp-2 text-white">{anime.title}</p></div>
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
            <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-foreground truncate">{offlinePlayInfo.title}</p><p className="text-xs text-muted-foreground truncate">{offlinePlayInfo.subtitle} {offlinePlayInfo.quality && offlinePlayInfo.quality !== "Auto" ? `• ${offlinePlayInfo.quality}` : ""}</p></div>
            <button onClick={() => { if (offlinePlaySrc) URL.revokeObjectURL(offlinePlaySrc); setOfflinePlaySrc(null); setOfflinePlayInfo(null); }} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center hover:bg-destructive/80 transition-all ml-2"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 bg-black flex items-center justify-center"><video src={offlinePlaySrc} controls autoPlay playsInline className="w-full h-full" style={{ objectFit: "contain" }} /></div>
          {downloadedEpisodes.length > 1 && (
            <div className="bg-card border-t border-border/30 p-3 max-h-[180px] overflow-y-auto">
              <p className="text-xs font-bold text-foreground mb-2">অন্যান্য ডাউনলোড</p>
              <div className="space-y-1">
                {downloadedEpisodes.filter(ep => ep.id !== offlinePlayInfo.id).map((ep) => (
                  <button key={ep.id} onClick={async () => { if (offlinePlaySrc) URL.revokeObjectURL(offlinePlaySrc); const { getVideoBlob } = await import("@/lib/downloadStore"); const blob = await getVideoBlob(ep.id); if (blob) { setOfflinePlaySrc(URL.createObjectURL(blob)); setOfflinePlayInfo(ep); } }} className="w-full flex items-center gap-2.5 p-2 rounded-lg bg-secondary/50 hover:bg-primary/10 transition-all">
                    {ep.poster && <img src={ep.poster} alt="" className="w-12 h-8 rounded object-cover flex-shrink-0" />}
                    <div className="flex-1 min-w-0 text-left"><p className="text-[11px] font-semibold text-foreground truncate">{ep.subtitle || ep.title}</p><p className="text-[9px] text-muted-foreground">{ep.quality} • {(ep.size / (1024 * 1024)).toFixed(1)} MB</p></div>
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
