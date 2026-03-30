import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, Settings, X, Lock, Unlock,
  ChevronRight, ChevronDown, FastForward, Rewind, Crop, Check, ExternalLink, Loader2, Download, PauseCircle, PlayCircle, Search
} from "lucide-react";
import type { AnimeItem, Season } from "@/data/animeData";
import { db, ref, onValue, set, remove, update } from "@/lib/firebase";
import logoImg from "@/assets/logo.png";
import animeCharImg from "@/assets/anime-loading-char.png";
import { createUnlockLinkForCurrentUser, getLocalUserId } from "@/lib/unlockAccess";

interface QualityOption {
  label: string;
  src: string;
}

// Cloudflare CDN proxy for fast video streaming
import { CLOUDFLARE_CDN_URL } from "@/lib/siteConfig";
const CLOUDFLARE_CDN = CLOUDFLARE_CDN_URL;

const buildProxyPlaybackUrl = (proxyBase: string, targetUrl: string, apiKey?: string): string => {
  const base = proxyBase.trim();
  const encoded = encodeURIComponent(targetUrl);
  if (!base) return targetUrl;
  let url: string;
  // Support {url} placeholder: https://proxy.example.com/?url={url}
  if (base.includes('{url}')) url = base.split('{url}').join(encoded);
  // Support ending with = or ?url= or &url=
  else if (/[?&]url=$/.test(base) || base.endsWith('=')) url = `${base}${encoded}`;
  else if (base.includes('?url=') || base.includes('&url=')) url = `${base}${encoded}`;
  // Default: append ?url=
  else url = `${base.replace(/\/$/, '')}?url=${encoded}`;
  // Append API key if provided
  if (apiKey) {
    url += (url.includes('?') ? '&' : '?') + `apikey=${encodeURIComponent(apiKey)}`;
  }
  return url;
};

const buildPlaybackCandidates = (url: string, cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string): string[] => {
  if (!url) return [];

  const candidates: string[] = [];
  const addCandidate = (candidate?: string | null) => {
    if (!candidate || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  const encoded = encodeURIComponent(url);
  const cloudflareCandidate = CLOUDFLARE_CDN ? `${CLOUDFLARE_CDN}/video-proxy?url=${encoded}` : null;
  const customProxyCandidate = proxyUrl ? buildProxyPlaybackUrl(proxyUrl, url, proxyApiKey) : null;

  if (cdnEnabled) {
    addCandidate(cloudflareCandidate);
    return candidates;
  }

  // http:// cannot be loaded directly on https pages (mixed content)
  if (url.startsWith('http://')) {
    addCandidate(customProxyCandidate);
    return candidates;
  }

  if (url.startsWith('https://')) {
    addCandidate(customProxyCandidate);
    addCandidate(url);
    return candidates;
  }

  addCandidate(url);
  return candidates;
};

const getPrimaryPlaybackSrc = (url: string, cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string): string => {
  return buildPlaybackCandidates(url, cdnEnabled, proxyUrl, proxyApiKey)[0] || url;
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
  seasons?: Season[];
  currentSeasonIdx?: number;
  onSeasonChange?: (idx: number) => void;
  suggestedAnime?: AnimeItem[];
  onSuggestedClick?: (anime: AnimeItem) => void;
}

const formatTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const VideoPlayer = ({ src, title, subtitle, poster, onClose, onNextEpisode, episodeList, qualityOptions, animeId, onSaveProgress, hideDownload, seasons, currentSeasonIdx, onSeasonChange, suggestedAnime, onSuggestedClick }: VideoPlayerProps) => {
  // Preload anime character image to prevent loading glitch
  useEffect(() => {
    const img = new Image();
    img.src = animeCharImg;
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const rafId = useRef<number>(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const bufferingHardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [boostedVolume, setBoostedVolume] = useState(100); // display value
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
  const [settingsTab, setSettingsTab] = useState<"speed" | "quality">("speed");
  const [currentQuality, setCurrentQuality] = useState<string>("Auto");
  const [cdnEnabled, setCdnEnabled] = useState(true);
  const [proxyUrl, setProxyUrl] = useState<string>('');
  const [proxyApiKey, setProxyApiKey] = useState<string>('');
  const [playbackRouteReady, setPlaybackRouteReady] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(''); // resolved playback src
  const activeSourceBaseRef = useRef(src); // currently selected raw source (before proxy/CDN)

  // Load CDN + proxy settings from Firebase
  useEffect(() => {
    let cdnLoaded = false;
    let proxyLoaded = false;
    setPlaybackRouteReady(false);

    const markReady = () => {
      if (cdnLoaded && proxyLoaded) setPlaybackRouteReady(true);
    };

    const unsub1 = onValue(ref(db, "settings/cdnEnabled"), (snap) => {
      const val = snap.val();
      const enabled = val !== false;
      setCdnEnabled(enabled);
      cdnLoaded = true;
      markReady();
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
      proxyLoaded = true;
      markReady();
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, []);
  const [isPremium, setIsPremium] = useState<boolean | null>(null); // null = loading
  const [adGateActive, setAdGateActive] = useState(false);
  const [shortenedLink, setShortenedLink] = useState<string | null>(null);
  const [shortenLoading, setShortenLoading] = useState(false);
  const [showQualityPanel, setShowQualityPanel] = useState(false);
  const [showDownloadQualityPicker, setShowDownloadQualityPicker] = useState(false);
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<any[]>([]);
  const [offlinePlaySrc, setOfflinePlaySrc] = useState<string | null>(null);
  const [offlinePlayInfo, setOfflinePlayInfo] = useState<any>(null);
  const [videoError, setVideoError] = useState(false);
  const [qualityFailMsg, setQualityFailMsg] = useState<string | null>(null);
  const failedSrcsRef = useRef<Set<string>>(new Set());
  const [isBuffering, setIsBuffering] = useState(true);

  // ===== ADAPTIVE BITRATE (ABR) STATE =====
  const abrEnabledRef = useRef(true); // true when user is on "Auto"
  const abrBufferCountRef = useRef(0); // buffering events in recent window
  const abrLastDowngradeRef = useRef(0); // timestamp of last downgrade
  const abrLastUpgradeRef = useRef(0);
  const abrStableStartRef = useRef(0); // when stable playback started
  const abrCurrentTierRef = useRef<number>(-1); // -1 = not set yet (use default)
  const [tutorialLink, setTutorialLink] = useState<string | null>(null);
  const [showTutorialVideo, setShowTutorialVideo] = useState(false);
  const [showNextEpOverlay, setShowNextEpOverlay] = useState(false);
  const [nextEpCountdown, setNextEpCountdown] = useState(0);
  const nextEpTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextEpCancelledRef = useRef(false);
  // Global download manager state
  const [activeDownloads, setActiveDownloads] = useState<Map<string, any>>(new Map());
  const [globalFreeAccess, setGlobalFreeAccess] = useState<boolean>(false);
  const [deviceBlocked, setDeviceBlocked] = useState(false);
  const [deviceBlockInfo, setDeviceBlockInfo] = useState<{ maxDevices: number; currentCount: number } | null>(null);
  const [userFreeAccessExpiresAt, setUserFreeAccessExpiresAt] = useState(0);
  const [unlockBlocked, setUnlockBlocked] = useState(false);

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
      return;
    }

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
  }, []);

  // ===== VIDEO VIEW TRACKING =====
  useEffect(() => {
    if (!animeId) return;
    const getUserId = (): string | null => {
      try { const u = localStorage.getItem("rsanime_user"); if (u) return JSON.parse(u).id; } catch {} return null;
    };
    const uid = getUserId();
    if (!uid) return;

    // 1. Log a view count
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const viewRef = ref(db, `analytics/views/${animeId}/${today}/${uid}`);
    set(viewRef, { timestamp: Date.now(), title: title || "" }).catch(() => {});

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

  // Load tutorial link from Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, "settings/tutorialLink"), (snap) => {
      setTutorialLink(snap.val() || null);
    });
    return () => unsub();
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

  // Ad gate - only run after premium check completes
  useEffect(() => {
    if (isPremium === null) return; // still loading premium status

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
    // No access - block video and show ad gate
    setAdGateActive(true);
    // Pause video immediately to prevent playing without access
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }
    setShortenLoading(true);
    createUnlockLinkForCurrentUser().then((result) => {
      setShortenLoading(false);
      if (result.ok && result.shortUrl) setShortenedLink(result.shortUrl);
      else setAdGateActive(false);
    }).catch(() => { setShortenLoading(false); setAdGateActive(false); });
  }, [isPremium, has24hAccess, unlockBlocked]);

  const handleOpenAdLink = useCallback(() => {
    if (shortenedLink) window.location.href = shortenedLink;
  }, [shortenedLink]);

  // Save progress every 10s
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

  // Restore watch position (per-device)
  useEffect(() => {
    if (!animeId) return;
    try {
      const user = localStorage.getItem("rsanime_user");
      if (!user) return;
      const userId = JSON.parse(user).id;
      if (!userId) return;
      import("@/lib/premiumDevice").then(({ getDeviceId }) => {
        const deviceId = getDeviceId();
        import("@/lib/firebase").then(({ get: fbGet, ref: fbRef, db: fbDb }) => {
          const histRef = fbRef(fbDb, `users/${userId}/watchHistory/${deviceId}/${animeId}`);
          fbGet(histRef).then((snap: any) => {
            if (snap.exists()) {
              const data = snap.val();
              if (data.currentTime && data.duration && (data.currentTime / data.duration) < 0.95) {
                const v = videoRef.current;
                if (v) {
                  const tryRestore = () => { if (v.duration > 0) { v.currentTime = data.currentTime; v.removeEventListener("loadedmetadata", tryRestore); } };
                  if (v.duration > 0) v.currentTime = data.currentTime;
                  else v.addEventListener("loadedmetadata", tryRestore);
                }
              }
            }
          });
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


  useEffect(() => {
    if (!playbackRouteReady) return;
    activeSourceBaseRef.current = src;
    setCurrentSrc(getPrimaryPlaybackSrc(src, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined));
    setCurrentQuality("Auto");
    setVideoError(false);
    setQualityFailMsg(null);
    failedSrcsRef.current.clear();
  }, [src, qualityOptions, cdnEnabled, proxyUrl, proxyApiKey, playbackRouteReady]);

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
      navigator.mediaSession.setActionHandler('stop', () => {
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.src = '';
        }
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        onClose();
      });
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
  }, [title, subtitle, poster, onNextEpisode, onClose]);

  const resetHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShowControls(true);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  const toggleControls = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShowControls(prev => {
      const next = !prev;
      if (next) {
        hideTimer.current = setTimeout(() => setShowControls(false), 3000);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [resetHideTimer]);

  useEffect(() => {
    if (!isBuffering) {
      if (bufferingHardTimeoutRef.current) {
        clearTimeout(bufferingHardTimeoutRef.current);
        bufferingHardTimeoutRef.current = null;
      }
      return;
    }

    if (bufferingHardTimeoutRef.current) clearTimeout(bufferingHardTimeoutRef.current);
    bufferingHardTimeoutRef.current = setTimeout(() => {
      setIsBuffering(false);
    }, 5000);

    return () => {
      if (bufferingHardTimeoutRef.current) {
        clearTimeout(bufferingHardTimeoutRef.current);
        bufferingHardTimeoutRef.current = null;
      }
    };
  }, [isBuffering, currentSrc]);

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
      // Start RAF loop for smooth progress
      const tick = () => {
        if (!v.paused && !v.ended) {
          const ct = v.currentTime;
          if (ct > 0) lastKnownTime = ct;
          const dur = v.duration;
          // Direct DOM updates for progress bar - avoids React re-renders
          if (progressRef.current && dur > 0) {
            progressRef.current.style.width = `${(ct / dur) * 100}%`;
          }
          if (timeDisplayRef.current && dur > 0) {
            timeDisplayRef.current.textContent = `${formatTime(ct)} / ${formatTime(dur)}`;
          }
          // Update React state less frequently (every ~500ms) for other consumers
          setCurrentTime(ct);
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
    let retryCount = 0;
    const MAX_RETRIES = 3;
    const onError = () => {
      if (retryCount >= MAX_RETRIES) {
        console.log('Video failed after retries. URL:', currentSrc);
        failedSrcsRef.current.add(currentSrc);
        const failedQualityLabel = currentQuality;
        
        const sameQualityRouteFallback = buildPlaybackCandidates(
          activeSourceBaseRef.current,
          cdnEnabled,
          proxyUrl || undefined,
          proxyApiKey || undefined
        ).find((candidateSrc) => !failedSrcsRef.current.has(candidateSrc) && candidateSrc !== currentSrc);

        if (sameQualityRouteFallback) {
          setQualityFailMsg(`"${failedQualityLabel}" source blocked. Trying fallback route...`);
          setTimeout(() => setQualityFailMsg(null), 3500);
          pendingSeek.current = lastKnownTime || v?.currentTime || 0;
          setCurrentSrc(sameQualityRouteFallback);
          return;
        }

        const nextOption = availableQualities.find((q) => {
          const candidateSrc = getPrimaryPlaybackSrc(q.src, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
          return !failedSrcsRef.current.has(candidateSrc) && candidateSrc !== currentSrc;
        });

        if (nextOption) {
          setQualityFailMsg(`"${failedQualityLabel}" quality not available. Switching to "${nextOption.label}"...`);
          setTimeout(() => setQualityFailMsg(null), 4000);
          pendingSeek.current = lastKnownTime || v?.currentTime || 0;
          const newFallbackSrc = getPrimaryPlaybackSrc(nextOption.src, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
          activeSourceBaseRef.current = nextOption.src;
          if (newFallbackSrc === currentSrc) {
            v.currentTime = pendingSeek.current;
            pendingSeek.current = null;
            v.load();
          } else {
            setCurrentSrc(newFallbackSrc);
          }
          setCurrentQuality(nextOption.label);
        } else {
          setVideoError(true);
        }
        return;
      }
      retryCount++;
      console.log(`Video error, retry ${retryCount}/${MAX_RETRIES}...`);
      // Exponential backoff: 500ms, 1000ms, 1500ms
      const delay = retryCount * 500;
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
    // Debounce waiting to avoid flashing loader on brief buffers
    let waitingTimer: ReturnType<typeof setTimeout> | null = null;
    const onWaiting = () => {
      if (waitingTimer) clearTimeout(waitingTimer);
      waitingTimer = setTimeout(() => setIsBuffering(true), 300);
    };
    const onPlaying = () => {
      if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = null; }
      setIsBuffering(false);
    };
    const onSeeked = () => {
      // Only clear buffering if video has enough data to play
      if (v.readyState >= 3) {
        if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = null; }
        setIsBuffering(false);
      }
    };
    // Stalled: video stopped downloading - try to recover
    let stalledTimer: ReturnType<typeof setTimeout> | null = null;
    const onStalled = () => {
      stalledTimer = setTimeout(() => {
        // Only reload if video truly hasn't loaded anything at all (readyState 0 = HAVE_NOTHING)
        if (v.currentTime === 0 && v.readyState <= 1 && v.networkState === 2) {
          console.log('Video stalled at 0:00 with no data, reloading source...');
          const savedSrc = v.src;
          v.src = '';
          v.src = savedSrc;
          v.load();
        }
      }, 10000); // Wait 10s before considering stalled - prevents premature reloads
    };

    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onError);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("canplaythrough", onCanPlayThrough);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("stalled", onStalled);
    setIsBuffering(true);
    v.load();

    return () => {
      cancelAnimationFrame(rafId.current);
      if (stalledTimer) clearTimeout(stalledTimer);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onError);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("canplaythrough", onCanPlayThrough);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("stalled", onStalled);
      // Ensure video is fully stopped on unmount (prevents background playback)
      v.pause();
      v.src = '';
      v.load();
      if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
    };
  }, [currentSrc, adGateActive, availableQualities, currentQuality, cdnEnabled, proxyUrl, playbackRouteReady]);

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
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
    resetHideTimer();
  }, [resetHideTimer]);

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
    const v = videoRef.current;
    if (!v) return;

    const nextTime = getSafeSeekTime(v, v.currentTime + seconds);
    v.currentTime = nextTime;

    setSkipIndicator({ side: seconds > 0 ? "right" : "left", text: `${Math.abs(seconds)}s` });
    setTimeout(() => setSkipIndicator(null), 600);
    resetHideTimer();
  }, [getSafeSeekTime, resetHideTimer]);

  const toggleFullscreen = useCallback(async () => {
    const el = videoContainerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        // Unlock orientation before exiting fullscreen
        try { (screen.orientation as any).unlock?.(); } catch {}
        await document.exitFullscreen();
      } else {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
        // Lock to landscape after entering fullscreen
        try { await (screen.orientation as any).lock?.('landscape'); } catch {}
      }
    } catch (e) { console.log('Fullscreen not supported'); }
  }, []);

  const setSpeed = useCallback((rate: number) => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSettings(false);
  }, []);

  // ===== ADAPTIVE BITRATE LOGIC =====
  // Quality tiers ordered: lowest → highest (480p, 720p, 1080p/Auto, 4K)
  const abrTiers = useMemo(() => {
    const tiers: { label: string; src: string; priority: number }[] = [];
    availableQualities.forEach((q) => {
      let priority = 2; // default (1080p / Auto)
      const lbl = q.label.toLowerCase();
      if (/480/.test(lbl)) priority = 0;
      else if (/720/.test(lbl)) priority = 1;
      else if (/4k|2160|uhd/i.test(lbl)) priority = 3;
      else if (lbl === "auto") priority = 2; // Auto = 1080p default
      tiers.push({ ...q, priority });
    });
    return tiers.sort((a, b) => a.priority - b.priority);
  }, [availableQualities]);

  const abrSwitchToTier = useCallback((tierIdx: number, reason: "downgrade" | "upgrade") => {
    const tier = abrTiers[tierIdx];
    if (!tier) return;
    
    const newSrc = getPrimaryPlaybackSrc(tier.src, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
    if (newSrc === currentSrc) {
      setCurrentQuality(tier.label);
      abrCurrentTierRef.current = tierIdx;
      return;
    }

    const v = videoRef.current;
    pendingSeek.current = v?.currentTime || 0;
    activeSourceBaseRef.current = tier.src;
    setIsBuffering(true);
    setCurrentSrc(newSrc);
    setCurrentQuality(tier.label);
    abrCurrentTierRef.current = tierIdx;

    if (reason === "downgrade") {
      abrLastDowngradeRef.current = Date.now();
      abrBufferCountRef.current = 0;
    } else {
      abrLastUpgradeRef.current = Date.now();
    }
  }, [abrTiers, currentSrc, cdnEnabled, proxyUrl]);

  // Monitor buffering for ABR auto-downgrade
  useEffect(() => {
    if (!abrEnabledRef.current) return;
    if (!isBuffering) {
      // Playback is smooth - track stable duration for upgrade
      if (abrStableStartRef.current === 0) abrStableStartRef.current = Date.now();
      
      // Upgrade after 30s of stable playback (no buffering)
      const stableDuration = Date.now() - abrStableStartRef.current;
      const timeSinceLastChange = Math.min(
        Date.now() - abrLastDowngradeRef.current,
        Date.now() - abrLastUpgradeRef.current
      );
      
      if (stableDuration > 30000 && timeSinceLastChange > 45000) {
        const currentTier = abrCurrentTierRef.current;
        const maxTier = abrTiers.length - 1;
        // Find next higher tier that isn't 4K (unless premium)
        let nextTier = currentTier + 1;
        while (nextTier <= maxTier) {
          if (is4KLabel(abrTiers[nextTier]?.label || "") && !isPremium) {
            nextTier++;
            continue;
          }
          break;
        }
        if (nextTier <= maxTier && nextTier !== currentTier) {
          abrStableStartRef.current = 0;
          abrSwitchToTier(nextTier, "upgrade");
        }
      }
      return;
    }

    // Buffering detected
    abrStableStartRef.current = 0;
    abrBufferCountRef.current++;

    const timeSinceDowngrade = Date.now() - abrLastDowngradeRef.current;
    
    // Downgrade if: 2+ buffering events OR first buffer lasts > 5s, with cooldown
    if (timeSinceDowngrade < 20000) return; // cooldown: don't downgrade within 20s

    const shouldDowngrade = abrBufferCountRef.current >= 2;
    if (!shouldDowngrade) {
      // Set a timer: if still buffering after 5s, downgrade
      const timer = setTimeout(() => {
        if (abrEnabledRef.current && abrCurrentTierRef.current > 0) {
          abrSwitchToTier(abrCurrentTierRef.current - 1, "downgrade");
        }
      }, 5000);
      return () => clearTimeout(timer);
    }

    const currentTier = abrCurrentTierRef.current;
    if (currentTier > 0) {
      abrSwitchToTier(currentTier - 1, "downgrade");
    }
  }, [isBuffering, abrSwitchToTier, abrTiers, isPremium]);

  // Initialize ABR tier on first load
  useEffect(() => {
    if (abrCurrentTierRef.current === -1 && abrTiers.length > 0) {
      // Find the "Auto" tier or the highest non-4K tier
      const autoIdx = abrTiers.findIndex(t => t.label === "Auto");
      if (autoIdx >= 0) {
        abrCurrentTierRef.current = autoIdx;
      } else {
        // Use highest non-4K
        for (let i = abrTiers.length - 1; i >= 0; i--) {
          if (!is4KLabel(abrTiers[i].label) || isPremium) {
            abrCurrentTierRef.current = i;
            break;
          }
        }
        if (abrCurrentTierRef.current === -1) abrCurrentTierRef.current = 0;
      }
    }
  }, [abrTiers, isPremium]);

  const switchQuality = useCallback((option: QualityOption) => {
    // Block 4K for non-premium users
    if (is4KLabel(option.label) && !isPremium) return;
    if (option.label === currentQuality) { setShowSettings(false); return; }

    // If user manually selects a quality, disable ABR (unless they pick Auto)
    if (option.label === "Auto") {
      abrEnabledRef.current = true;
      abrBufferCountRef.current = 0;
      abrStableStartRef.current = 0;
      // Reset to default high quality
      const autoIdx = abrTiers.findIndex(t => t.label === "Auto");
      if (autoIdx >= 0) abrCurrentTierRef.current = autoIdx;
    } else {
      abrEnabledRef.current = false;
    }

    activeSourceBaseRef.current = option.src;
    const newSrc = getPrimaryPlaybackSrc(option.src, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);

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
  }, [currentQuality, currentSrc, cdnEnabled, proxyUrl, isPremium, abrTiers]);

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

    if (now - lastTap.current.time < 300) {
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
      setTimeout(() => { if (lastTap.current.time === now) toggleControls(); }, 300);
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
      // Keep native volume path for stable sound on all qualities including 4K
      const newBoosted = Math.min(100, Math.max(0, boostedVolume - dy * 0.5));
      setBoostedVolume(newBoosted);
      if (videoRef.current) {
        videoRef.current.volume = Math.min(1, newBoosted / 100);
      }
      setVolume(Math.min(1, newBoosted / 100));
      setSwipeState({ ...swipeState, startY: t.clientY });
    } else if (swipeState.type === "brightness") {
      const newBr = Math.min(1.5, Math.max(0.3, brightness - dy * 0.003));
      setBrightness(newBr);
      setSwipeState({ ...swipeState, startY: t.clientY });
    }
  }, [swipeState, locked, volume, brightness]);

  const handleTouchEnd = useCallback(() => setSwipeState(null), []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`fixed inset-0 z-[300] bg-background/[0.98] flex flex-col items-center ${isFullscreen ? '' : 'overflow-y-auto'}`} ref={containerRef}>
      {/* Close button */}
      {!isFullscreen && (
        <button onClick={() => {
          // Stop video completely before closing
          const v = videoRef.current;
          if (v) { v.pause(); v.src = ''; v.load(); }
          if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
          onClose();
        }} className="absolute top-5 right-5 z-[310] w-10 h-10 rounded-full gradient-primary flex items-center justify-center btn-glow transition-all hover:rotate-90">
          <X className="w-5 h-5" />
        </button>
      )}

      <div className={`w-full ${isFullscreen ? 'h-full p-0' : 'max-w-full p-5'}`}>
        {!isFullscreen && (
          <div className="text-center mb-2.5">
            <h1 className="text-2xl font-extrabold text-primary text-glow tracking-wider">RS ANIME PLAYER</h1>
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
          style={{ filter: `brightness(${brightness})`, willChange: "transform", margin: isFullscreen ? 0 : undefined }}
          onContextMenu={(e) => e.preventDefault()}
          onClick={handleVideoClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <video
            ref={videoRef}
            src={currentSrc}
            className="w-full h-full"
            style={{ objectFit: cropModes[cropIndex], willChange: "transform", WebkitTouchCallout: "none", userSelect: "none" }}
            playsInline
            preload="auto"
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            disableRemotePlayback
            onContextMenu={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
          />

          {/* Video Error Overlay */}
          {videoError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
              <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center mb-4">
                <X className="w-8 h-8 text-destructive" />
              </div>
              <p className="text-base font-semibold text-foreground mb-1">Video Unavailable</p>
              <p className="text-xs text-muted-foreground mb-4 text-center px-6">Server is not responding. Try another episode or quality.</p>
              <button onClick={(e) => { e.stopPropagation(); setVideoError(false); setIsBuffering(true); const v = videoRef.current; if (v) { v.load(); } }} className="px-4 py-2 rounded-lg gradient-primary text-sm font-semibold btn-glow">
                Retry
              </button>
            </div>
          )}

          {/* Loading/Buffering Overlay - Anime themed */}
          {isBuffering && !videoError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/85 z-15 pointer-events-none">
              <div className="flex flex-col items-center">
                {/* RGB Spinner around anime character */}
                <div className="relative w-20 h-20 flex items-center justify-center">
                  {/* RGB spinning ring */}
                  <div className="absolute inset-0 rounded-full" style={{
                    background: "conic-gradient(from 0deg, #ff0000, #ff8800, #ffff00, #00ff00, #00ffff, #0088ff, #8800ff, #ff00ff, #ff0000)",
                    animation: "rgbSpin 1.5s linear infinite",
                    padding: "3px",
                    WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
                    mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
                    filter: "blur(0.5px) drop-shadow(0 0 8px rgba(255,0,255,0.4)) drop-shadow(0 0 15px rgba(0,255,255,0.3))"
                  }} />
                  {/* Second glow ring */}
                  <div className="absolute inset-[-4px] rounded-full opacity-40" style={{
                    background: "conic-gradient(from 180deg, #ff0000, #00ff00, #0000ff, #ff0000)",
                    animation: "rgbSpin 2.5s linear infinite reverse",
                    WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
                    mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
                    filter: "blur(3px)"
                  }} />
                  {/* Character image - preloaded to prevent glitch */}
                  <img src={animeCharImg} alt="" className="w-14 h-14 rounded-full object-cover"
                    loading="eager"
                    decoding="sync"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    style={{ animation: "charBounce 2s ease-in-out infinite", filter: "drop-shadow(0 0 6px rgba(150,100,255,0.5))" }} />
                </div>

                {/* Loading text */}
                <div className="flex items-center gap-1.5 mt-3">
                  <span className="text-[10px] font-semibold tracking-widest uppercase" style={{
                    background: "linear-gradient(90deg, #ff0066, #00ffff, #ff00ff, #00ff88)",
                    backgroundSize: "300% 100%",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    animation: "rgbTextShift 2s linear infinite"
                  }}>Loading</span>
                  <span className="flex gap-[3px]">
                    <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                </div>
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

          {qualityFailMsg && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 player-glass px-4 py-2.5 rounded-xl text-center max-w-[85%] animate-in fade-in slide-in-from-top-2 duration-300">
              <p className="text-xs font-semibold text-accent">⚠ {qualityFailMsg}</p>
            </div>
          )}

          {swipeState?.type && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 player-glass px-6 py-3 rounded-xl text-center">
              {swipeState.type === "volume" ? (
                <div className="flex items-center gap-2">
                  <Volume2 className="w-5 h-5 text-primary" />
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

          {/* Controls Overlay - always dark bg for visibility in all themes */}
          {showControls && !locked && (
            <div className="absolute inset-0 flex flex-col justify-between text-white" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 30%, transparent 60%, rgba(0,0,0,0.7) 70%)", willChange: "opacity", transition: "opacity 0.15s ease" }}>
              {/* Top controls */}
              <div className="flex justify-end gap-2 p-3">
                <button onClick={(e) => { e.stopPropagation(); setCropIndex((cropIndex + 1) % 3); }} className="player-glass h-7 px-2.5 rounded-full flex items-center justify-center gap-1">
                  <Crop className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium">{cropLabels[cropIndex]}</span>
                </button>
                <button onClick={(e) => { e.stopPropagation(); setLocked(true); resetHideTimer(); }} className="player-glass w-8 h-8 rounded-full flex items-center justify-center">
                  <Lock className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Center play */}
              <div className="flex items-center justify-center gap-8">
                <button onClick={(e) => { e.stopPropagation(); seek(-10); }} className="w-10 h-10 rounded-full bg-foreground/20 flex items-center justify-center backdrop-blur">
                  <SkipBack className="w-5 h-5" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="w-14 h-14 rounded-full gradient-primary flex items-center justify-center btn-glow">
                  {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-1" />}
                </button>
                <button onClick={(e) => { e.stopPropagation(); seek(10); }} className="w-10 h-10 rounded-full bg-foreground/20 flex items-center justify-center backdrop-blur">
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
                      style={{ width: `${progress}%`, willChange: "width" }}
                    >
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary shadow-[0_0_10px_hsla(355,85%,55%,0.6)]" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span ref={timeDisplayRef} className="text-[11px] font-medium">{formatTime(currentTime)} / {formatTime(duration)}</span>
                    <button onClick={(e) => { e.stopPropagation(); setMuted(!muted); if (videoRef.current) videoRef.current.muted = !muted; }} className="w-6 h-6 flex items-center justify-center">
                      {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-foreground/20 px-2 py-0.5 rounded">{playbackRate}x</span>
                    {availableQualities.length > 1 && (
                      <div className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowQualityPanel(!showQualityPanel); }}
                          className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-all ${
                            currentQuality !== "Auto" ? "gradient-primary text-white" : "bg-foreground/20"
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
              <button onClick={() => { setLocked(false); resetHideTimer(); }} className="player-glass w-10 h-10 rounded-full flex items-center justify-center">
                <Unlock className="w-4 h-4 text-primary" />
              </button>
            </div>
          )}
          {locked && !showControls && (
            <div className="absolute inset-0" onClick={(e) => { e.stopPropagation(); resetHideTimer(); }} />
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
            </div>
          )}
        </div>

        {/* Device limit is now enforced at login time - no overlay needed */}

        {/* Ad Gate Overlay */}
        {adGateActive && !deviceBlocked && !unlockBlocked && (
          <div className="fixed inset-0 z-[400] bg-black/90 flex items-center justify-center backdrop-blur-sm">
            <div className="bg-card rounded-2xl p-6 max-w-sm w-[90%] text-center space-y-4 shadow-2xl border border-border">
              <h3 className="text-lg font-bold text-foreground">Unlock 24 Hours Access</h3>
              <p className="text-sm text-muted-foreground">Click the link below to get 24 hours of free access to all videos</p>
              {shortenLoading ? (
                <div className="flex items-center justify-center gap-2 py-3">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Preparing link...</span>
                </div>
              ) : (
                <button onClick={handleOpenAdLink} className="w-full py-3 rounded-xl gradient-primary text-white font-semibold flex items-center justify-center gap-2 btn-glow transition-all hover:scale-105">
                  <ExternalLink className="w-4 h-4" />
                  Unlock Now
                </button>
              )}
              <button
                onClick={() => {
                  if (tutorialLink) { setShowTutorialVideo(true); } else { alert("Tutorial video not available yet. Please contact admin."); }
                }}
                className="w-full py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium flex items-center justify-center gap-2 transition-all hover:scale-105 text-sm"
              >
                <Play className="w-3.5 h-3.5" />
                How to open my link
              </button>
            </div>
          </div>
        )}

        {unlockBlocked && (
          <div className="fixed inset-0 z-[450] bg-black/90 flex items-center justify-center backdrop-blur-sm p-5">
            <div className="bg-card rounded-2xl p-6 max-w-sm w-full text-center space-y-3 border border-border shadow-2xl">
              <h3 className="text-lg font-bold text-foreground">Access Blocked</h3>
              <p className="text-sm text-muted-foreground">একই unlock token একাধিক আইডিতে ব্যবহার করার কারণে এই অ্যাকাউন্টে ভিডিও অ্যাক্সেস ব্লক করা হয়েছে।</p>
              <button onClick={onClose} className="w-full py-2.5 rounded-xl gradient-primary text-primary-foreground font-semibold">Close Player</button>
            </div>
          </div>
        )}

        {/* Tutorial Video Modal */}
        {showTutorialVideo && tutorialLink && (
          <div className="fixed inset-0 z-[500] bg-black/95 flex items-center justify-center backdrop-blur-sm" onClick={() => setShowTutorialVideo(false)}>
            <div className="w-full max-w-xs mx-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-semibold text-foreground">📖 How to open my link</h3>
                <button onClick={() => setShowTutorialVideo(false)} className="w-8 h-8 rounded-full bg-foreground/20 flex items-center justify-center hover:bg-foreground/30 transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '9/16' }}>
                <video
                  src={getPrimaryPlaybackSrc(tutorialLink, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined)}
                  className="w-full h-full"
                  controls
                  autoPlay
                  playsInline
                  style={{ objectFit: 'contain' }}
                  crossOrigin={tutorialLink.startsWith("http://") ? "anonymous" : undefined}
                  controlsList="nodownload noplaybackrate noremoteplayback"
                  disablePictureInPicture
                  disableRemotePlayback
                  onContextMenu={(e) => e.preventDefault()}
                />
              </div>
            </div>
          </div>
        )}

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

              {/* Quality Picker Dropdown */}
              {showDownloadQualityPicker && (
                <div className="bg-card border border-border rounded-xl p-3 shadow-xl animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-foreground">কোয়ালিটি সিলেক্ট করুন</p>
                    <button onClick={() => setShowDownloadQualityPicker(false)} className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center">
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
                            if (!locked4K) startDownloadWithQuality(opt.label, opt.src);
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
        {suggestedAnime && suggestedAnime.length > 0 && onSuggestedClick && (
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
