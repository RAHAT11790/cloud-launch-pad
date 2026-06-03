import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useBranding } from "@/hooks/useBranding";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, Settings, X, Lock, Unlock,
  ChevronRight, ChevronDown, FastForward, Rewind, Crop, Check, ExternalLink, Loader2, Download, PauseCircle, PlayCircle, Search, Server, Info, Star, Calendar, Globe,
  ArrowLeft, Share2, Bookmark, MessageCircle, Send, Grid3x3, Tv, FolderDown, HelpCircle
} from "lucide-react";
import type { AnimeItem, Season, AudioLanguage } from "@/data/animeData";
import { db, ref, onValue, set, remove, update } from "@/lib/firebase";
import { getDeviceId } from "@/lib/premiumDevice";
import {
  createUnlockLinkForCurrentUser,
  getLocalUserId,
  getLocalFreeAccessExpiry,
  setLocalFreeAccessExpiry,
  clearLocalFreeAccess,
  isFreeAccessGrantValidForCurrentBrowser,
} from "@/lib/unlockAccess";
import { useFreeAccessDurationHours, formatFreeAccessDuration } from "@/lib/freeAccessConfig";
import { subscribeVideoServers, rewriteUrlWithServer, type VideoServer } from "@/lib/videoServers";
import { toast } from "sonner";
import {
  isGuestUser,
  hasGuestWatchlistItem,
  setGuestWatchlistItemNotify,
  removeGuestWatchlistItemNotify,
  subscribeGuestWatchlist,
} from "@/lib/guestSession";
import CommentSection from "@/components/CommentSection";
import { isUnlockBlockActive } from "@/lib/unlockBlock";

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

const buildCdnProxyUrl = (targetUrl: string): string | null => {
  const base = CLOUDFLARE_CDN.trim().replace(/\/$/, "");
  if (!base) return null;

  // Admin/env may contain either a worker base URL OR the full proxy endpoint.
  // Avoid producing .../video-proxy/video-proxy?url=..., which causes 500s.
  const isProxyEndpoint = /\/video-proxy(?:$|[/?#])/.test(base) || base.includes("{url}") || /[?&]url=?/.test(base) || base.endsWith("=");
  return isProxyEndpoint
    ? buildProxyPlaybackUrl(base, targetUrl)
    : `${base}/video-proxy?url=${encodeURIComponent(targetUrl)}`;
};

const buildPlaybackCandidates = (url: string, cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string): string[] => {
  if (!url) return [];

  const candidates: string[] = [];
  const addCandidate = (candidate?: string | null) => {
    if (!candidate || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  const cloudflareCandidate = cdnEnabled ? buildCdnProxyUrl(url) : null;
  const customProxyCandidate = proxyUrl ? buildProxyPlaybackUrl(proxyUrl, url, proxyApiKey) : null;
  const isHttps = url.startsWith('https://');

  // Preferred order: CDN (if enabled) → custom proxy → direct (https only)
  // We always include every viable route as a fallback so the player can
  // recover automatically. http:// targets cannot be played directly on
  // https pages (mixed-content), so they only get proxy/CDN candidates.
  if (cdnEnabled && cloudflareCandidate) addCandidate(cloudflareCandidate);
  if (customProxyCandidate) addCandidate(customProxyCandidate);
  if (isHttps) addCandidate(url);

  // Last-resort fallback: original URL even if http (browser may block, but
  // covers the case where the page itself is served over http during dev).
  if (candidates.length === 0) addCandidate(url);

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
  episodeList?: { number: number; title?: string; active: boolean; onClick: () => void; link?: string; link480?: string; link720?: string; link1080?: string; link4k?: string }[];
  qualityOptions?: QualityOption[];
  animeId?: string;
  onSaveProgress?: (currentTime: number, duration: number) => void;
  hideDownload?: boolean;
  seasons?: Season[];
  currentSeasonIdx?: number;
  onSeasonChange?: (idx: number) => void;
  suggestedAnime?: AnimeItem[];
  onSuggestedClick?: (anime: AnimeItem) => void;
  description?: string;
  animeMeta?: { title?: string; poster?: string; year?: string | number; rating?: string | number; language?: string; type?: string };
  // Compatibility props accepted from the host page (anime-stream-sync wiring)
  audioTracks?: { label: string; src: string; language?: string }[];
  initialSeekTime?: number;
  nextEpisodeSrc?: string;
  forceEmbedMode?: boolean;
  noProxy?: boolean;
  noServerSwitch?: boolean;
  // Per-series audio language switching
  audioLanguages?: AudioLanguage[];
  activeLangId?: string;
  onLanguageChange?: (id: string) => void;
}

const formatTime = (t: number) => {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const total = Math.floor(t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
};

const VideoPlayer = ({ src, title, subtitle, poster, onClose, onNextEpisode, episodeList, qualityOptions, animeId, onSaveProgress, hideDownload, seasons, currentSeasonIdx, onSeasonChange, suggestedAnime, onSuggestedClick, description, animeMeta, audioTracks: _audioTracks, initialSeekTime, nextEpisodeSrc: _nextEpisodeSrc, forceEmbedMode: _forceEmbedMode, audioLanguages, activeLangId, onLanguageChange }: VideoPlayerProps) => {

  const branding = useBranding();
  const freeAccessHours = useFreeAccessDurationHours();
  const freeAccessLabelEn = formatFreeAccessDuration(freeAccessHours, "en");

  // Per-series audio language list (normalized) + active language object.
  const langList: AudioLanguage[] = useMemo(
    () => (Array.isArray(audioLanguages) ? audioLanguages : Object.values(audioLanguages || {})) as AudioLanguage[],
    [audioLanguages]
  );
  const activeLang = useMemo(
    () => langList.find((l) => l.id === activeLangId) || langList.find((l) => l.isDefault) || langList[0],
    [langList, activeLangId]
  );
  const currentLangLabel = activeLang?.name || animeMeta?.language || "";
  const hasMultipleLangs = langList.length > 0;
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const rafId = useRef<number>(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const bufferingHardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sticky resume time across server/quality switches.
  const resumeTimeRef = useRef<number>(0);
  const resumeShouldPlayRef = useRef<boolean>(true);

  const [showInfoSheet, setShowInfoSheet] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [infoTab, setInfoTab] = useState<"details" | "episodes" | "foryou" | "comments">("details");
  const [showAllEpisodes, setShowAllEpisodes] = useState(false);
  
  const [saved, setSaved] = useState(() => (animeId ? hasGuestWatchlistItem(animeId) : false));

  // Sync saved state with watchlist (guest path) + initial firebase check
  useEffect(() => {
    if (!animeId) return;
    setSaved(hasGuestWatchlistItem(animeId));
    if (isGuestUser()) {
      const unsub = subscribeGuestWatchlist(() => setSaved(hasGuestWatchlistItem(animeId)));
      return () => unsub();
    }
    // Logged in: check firebase
    try {
      const uid = getLocalUserId();
      if (!uid) return;
      const wlRef = ref(db, `users/${uid}/watchlist/${animeId}`);
      const unsub = onValue(wlRef, (snap) => setSaved(snap.exists()));
      return () => unsub();
    } catch { /* ignore */ }
  }, [animeId]);
  const [commentText, setCommentText] = useState("");
  const [localComments, setLocalComments] = useState<{ id: string; text: string; at: number }[]>([]);
  const [bottomTab, setBottomTab] = useState<"foryou" | "comments">("foryou");
  const [commentCount, setCommentCount] = useState(0);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [boostedVolume, setBoostedVolume] = useState(100); // display value
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const showControlsRef = useRef(true);
  const controlsOverlayRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [holdSpeedActive, setHoldSpeedActive] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRateRef = useRef<number>(1);

  const startHoldSpeed = useCallback((e: React.PointerEvent) => {
    if (locked) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      prevRateRef.current = v.playbackRate || 1;
      v.playbackRate = 2;
      setHoldSpeedActive(true);
    }, 280);
  }, [locked]);

  const endHoldSpeed = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (holdSpeedActive) {
      const v = videoRef.current;
      if (v) v.playbackRate = prevRateRef.current || 1;
      setHoldSpeedActive(false);
    }
  }, [holdSpeedActive]);

  const [showSettings, setShowSettings] = useState(false);
  const [skipIndicator, setSkipIndicator] = useState<{ side: "left" | "right" | "center"; text: string } | null>(null);
  const [brightness, setBrightness] = useState(1);
  const brightnessRef = useRef(1);
  const boostedVolumeRef = useRef(100);
  const gestureStateSyncRef = useRef(0);
  const swipeStateRef = useRef<{ startX: number; startY: number; type: string | null } | null>(null);
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
  const [showServerPanel, setShowServerPanel] = useState(false);
  const [videoServers, setVideoServers] = useState<VideoServer[]>([]);
  const [activeServerIndex, setActiveServerIndex] = useState(-1);
  const preloadVideoRef = useRef<HTMLVideoElement | null>(null);
  const serverSwitchingRef = useRef(false);
  const [showDownloadQualityPicker, setShowDownloadQualityPicker] = useState(false);
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<any[]>([]);
  const [offlinePlaySrc, setOfflinePlaySrc] = useState<string | null>(null);
  const [offlinePlayInfo, setOfflinePlayInfo] = useState<any>(null);
  const [videoError, setVideoError] = useState(false);
  const [qualityFailMsg, setQualityFailMsg] = useState<string | null>(null);
  const failedSrcsRef = useRef<Set<string>>(new Set());
  const [isBuffering, setIsBuffering] = useState(true);

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
  const [showSeasonPicker, setShowSeasonPicker] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  // Inline download panel: open right under the action pills (no scroll-to-bottom)
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [dlSelectedEpisodes, setDlSelectedEpisodes] = useState<Set<number>>(new Set());
  const [dlSelectedQuality, setDlSelectedQuality] = useState<string | null>(null);
  // Download panel keeps its OWN season + language selection completely
  // isolated from the active video player season/language.
  const [dlSeasonIdx, setDlSeasonIdx] = useState<number>(currentSeasonIdx ?? 0);
  const [dlActiveLangId, setDlActiveLangId] = useState<string | undefined>(activeLangId);
  const [showDlSeasonPicker, setShowDlSeasonPicker] = useState(false);
  const [showDlLangPicker, setShowDlLangPicker] = useState(false);

  // Resolve the download-panel's own language + seasons (independent of player).
  const dlActiveLang = useMemo(
    () => langList.find((l) => l.id === dlActiveLangId) || langList.find((l) => l.isDefault) || langList[0],
    [langList, dlActiveLangId]
  );
  const dlSeasons: Season[] = useMemo(() => {
    const fromLang = dlActiveLang?.seasons;
    if (Array.isArray(fromLang) && fromLang.length) return fromLang as Season[];
    return seasons || [];
  }, [dlActiveLang, seasons]);
  const dlLangLabel = dlActiveLang?.name || currentLangLabel;

  // Episode list used by the download panel — built from the download's
  // own selected season + language so changing it never switches the player.
  const dlEpisodeList = useMemo(() => {
    if (dlSeasons && dlSeasons[dlSeasonIdx]?.episodes?.length) {
      return dlSeasons[dlSeasonIdx].episodes.map((ep) => ({
        number: ep.episodeNumber,
        title: ep.title,
        active: false,
        onClick: () => {},
        link: ep.link,
        link480: ep.link480,
        link720: ep.link720,
        link1080: ep.link1080,
        link4k: ep.link4k,
      }));
    }
    return episodeList || [];
  }, [dlSeasons, dlSeasonIdx, episodeList]);
  // Pre-captured file sizes (bytes). -1 = fetch failed / size unknown.
  const [dlSizesByUrl, setDlSizesByUrl] = useState<Record<string, number>>({});
  const dlSizeFetchingRef = useRef<Set<string>>(new Set());

  // When the download panel opens, pick the lowest available quality.
  // We DO NOT auto-seed the episode selection here — users explicitly
  // pick which episodes to download (Clear all / Select all controls
  // that, plus per-episode taps). This prevents the "clear all → snaps
  // back to all selected" bug.
  const dlSeedKeyRef = useRef<string>("");
  useEffect(() => {
    if (!showDownloadPanel || !dlEpisodeList || dlEpisodeList.length === 0) {
      if (!showDownloadPanel) dlSeedKeyRef.current = "";
      return;
    }
    const QUALS: { label: string; key: "link480" | "link720" | "link1080" | "link4k" }[] = [
      { label: "480p", key: "link480" },
      { label: "720p", key: "link720" },
      { label: "1080p", key: "link1080" },
      { label: "4K", key: "link4k" },
    ];
    const lowest = QUALS.find((q) => dlEpisodeList.some((ep) => !!(ep as any)[q.key]));
    if (!dlSelectedQuality || dlSelectedQuality === "Auto" || !QUALS.some((q) => q.label === dlSelectedQuality && dlEpisodeList.some((ep) => !!(ep as any)[q.key]))) {
      if (lowest) setDlSelectedQuality(lowest.label);
    }
    // Seed empty selection exactly once per (open, season) so user starts
    // with nothing selected and explicitly chooses episodes.
    const seedKey = `${dlSeasonIdx}`;
    if (dlSeedKeyRef.current !== seedKey) {
      dlSeedKeyRef.current = seedKey;
      setDlSelectedEpisodes(new Set());
    }
  }, [showDownloadPanel, dlEpisodeList, dlSelectedQuality, dlSeasonIdx]);

  // Seed/refresh the download panel's language to mirror the player's active
  // language only when the user hasn't explicitly picked one yet.
  useEffect(() => {
    if (!dlActiveLangId && activeLangId) setDlActiveLangId(activeLangId);
  }, [activeLangId, dlActiveLangId]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    import("@/lib/downloadManager").then(({ downloadManager }) => {
      unsub = downloadManager.subscribe((snap) => setActiveDownloads(snap.downloads as any));
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

  // Pre-capture file sizes for the download panel.
  // When the panel opens (or the quality changes), fire HEAD requests for
  // every episode link of the currently selected quality through the proxy.
  // Sizes are cached in dlSizesByUrl so re-opening is instant, and the
  // Download button can fire immediately without waiting for sizes.
  useEffect(() => {
    if (!showDownloadPanel || !dlEpisodeList || dlEpisodeList.length === 0) return;
    const QUALS: { label: string; key: "link480" | "link720" | "link1080" | "link4k" }[] = [
      { label: "480p", key: "link480" },
      { label: "720p", key: "link720" },
      { label: "1080p", key: "link1080" },
      { label: "4K", key: "link4k" },
    ];
    const qKey = QUALS.find((q) => q.label === dlSelectedQuality)?.key;
    const urls: { key: string; candidates: string[] }[] = [];
    const unknownSizes: Record<string, number> = {};
    for (const ep of dlEpisodeList) {
      const raw = (qKey && (ep as any)[qKey]) || ep.link;
      if (!raw) continue;
      const proxied = getPrimaryPlaybackSrc(raw, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
      const key = proxied || raw;
      if (!key || (key in dlSizesByUrl) || dlSizeFetchingRef.current.has(key)) continue;
      if (raw.startsWith("http://")) {
        // Do not send HEAD probes for http-origin videos through the proxy.
        // Some proxy deployments crash on HEAD and report a 500 runtime error.
        unknownSizes[key] = -1;
        continue;
      }
      // Only probe direct https URLs. Never probe proxy endpoints for size:
      // crashing HEAD requests there were the source of the reported 500s.
      const candidates: string[] = [];
      if (raw.startsWith("https://")) candidates.push(raw);
      if (candidates.length === 0) {
        unknownSizes[key] = -1;
        continue;
      }
      urls.push({ key, candidates });
    }
    if (Object.keys(unknownSizes).length > 0) {
      setDlSizesByUrl((prev) => ({ ...prev, ...unknownSizes }));
    }
    if (urls.length === 0) return;
    let cancelled = false;
    const probe = async (u: string): Promise<number> => {
      try {
        const r = await fetch(u, { method: "HEAD" });
        if (r.ok) {
          const len = Number(r.headers.get("Content-Length") || r.headers.get("content-length") || 0);
          if (len > 0) return len;
        }
        // Skip ranged GET if HEAD 5xx'd — proxy clearly can't reach origin.
        if (r.status >= 500) return 0;
        const r2 = await fetch(u, { method: "GET", headers: { Range: "bytes=0-0" } });
        if (!r2.ok && r2.status !== 206) return 0;
        const cr = r2.headers.get("Content-Range") || r2.headers.get("content-range") || "";
        const m = cr.match(/\/(\d+)$/);
        return m ? Number(m[1]) : 0;
      } catch {
        return 0;
      }
    };
    const fetchOne = async (item: { key: string; candidates: string[] }) => {
      dlSizeFetchingRef.current.add(item.key);
      try {
        let len = 0;
        for (const c of item.candidates) {
          len = await probe(c);
          if (len > 0) break;
        }
        if (cancelled) return;
        setDlSizesByUrl((prev) => ({ ...prev, [item.key]: len > 0 ? len : -1 }));
      } finally {
        dlSizeFetchingRef.current.delete(item.key);
      }
    };
    let idx = 0;
    const worker = async () => {
      while (!cancelled && idx < urls.length) {
        const i = idx++;
        await fetchOne(urls[i]);
      }
    };
    Promise.all([worker(), worker(), worker(), worker()]);
    return () => { cancelled = true; };
  }, [showDownloadPanel, dlSelectedQuality, dlEpisodeList, cdnEnabled, proxyUrl, proxyApiKey]);


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

  // Re-subscribe to free-access / unlock-blocked whenever the active
  // account changes (login, logout, switch). Otherwise an old account's
  // grant could leak into a freshly-logged-in session.
  const [activeAccountId, setActiveAccountId] = useState<string | null>(() => getLocalUserId());
  useEffect(() => {
    // Lazy import to avoid circular issues
    import("@/lib/accountScope").then(({ subscribeAccountChange }) => {
      const unsub = subscribeAccountChange((id) => setActiveAccountId(id));
      (window as any).__rs_vp_acc_unsub = unsub;
    });
    return () => { (window as any).__rs_vp_acc_unsub?.(); };
  }, []);

  useEffect(() => {
    const uid = activeAccountId || getLocalUserId();
    if (!uid) {
      setUserFreeAccessExpiresAt(0);
      setUnlockBlocked(false);
      return;
    }

    const unsubAccess = onValue(ref(db, `users/${uid}/freeAccessDevices/${getDeviceId()}`), (snap) => {
      const data = snap.val();
      if (isFreeAccessGrantValidForCurrentBrowser(data, uid)) {
        setUserFreeAccessExpiresAt(Number(data.expiresAt));
      } else {
        setUserFreeAccessExpiresAt(0);
        clearLocalFreeAccess(uid);
      }
    });

    // Skip the cross-account unlock-block check for the shared guest account —
    // one guest device's misuse must not block other guest browsers/phones.
    if (isGuestUser()) {
      setUnlockBlocked(false);
      return () => { unsubAccess(); };
    }

    const unsubBlocked = onValue(ref(db, `users/${uid}/security/unlockBlocked`), (snap) => {
      setUnlockBlocked(isUnlockBlockActive(snap.val()));
    });

    return () => {
      unsubAccess();
      unsubBlocked();
    };
  }, [activeAccountId]);

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
          // Extend the CURRENT account's free-access window only.
          const expiry = getLocalFreeAccessExpiry();
          if (expiry) {
            setLocalFreeAccessExpiry(expiry + maint.lastPauseDuration);
          }
          localStorage.setItem(appliedKey, "true");
        }
      }
    });
    return () => unsub();
  }, []);

  const grant24hAccess = useCallback(() => {
    const expiry = Date.now() + 24 * 60 * 60 * 1000;
    // Always scope by the active account so other accounts on the same
    // browser are not silently unlocked.
    setLocalFreeAccessExpiry(expiry);
  }, []);

  // Premium check (device limit is now enforced at login time)
  useEffect(() => {
    const uid = activeAccountId || getLocalUserId();
    if (!uid) { setIsPremium(false); return; }

    const premRef = ref(db, `users/${uid}/premium`);
    const unsub = onValue(premRef, (snap) => {
      const data = snap.val();
      const isPrem = !!(data && data.active === true && data.expiresAt > Date.now());
      setIsPremium(isPrem);
    });
    return () => unsub();
  }, [activeAccountId]);

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

  const selectedQualitySource = useMemo(() => {
    return availableQualities.find((q) => q.label === currentQuality)?.src || src;
  }, [availableQualities, currentQuality, src]);


  // Reset transient state when src or proxy/CDN settings change.
  // currentSrc itself is computed by the activeServerIndex effect below.
  useEffect(() => {
    if (!playbackRouteReady) return;
    setCurrentQuality("Auto");
    setVideoError(false);
    setQualityFailMsg(null);
    failedSrcsRef.current.clear();
  }, [src, qualityOptions, cdnEnabled, proxyUrl, proxyApiKey, playbackRouteReady]);

  // Subscribe to admin-defined video servers. The player serial is now
  // 1:1 with admin order — S1 = videoServers[0], S2 = videoServers[1], etc.
  // If admin has no servers, fall back to the original episode src.
  // The server flagged isDefault auto-plays first.
  useEffect(() => {
    return subscribeVideoServers((servers) => {
      setVideoServers(servers);
    });
  }, []);

  // Pick default server index whenever src changes or server list loads.
  // -1 means original episode URL, shown as Default.
  useEffect(() => {
    const defaultIdx = videoServers.findIndex((s) => s.isDefault);
    if (defaultIdx < 0) {
      setActiveServerIndex(-1);
      return;
    }
    const defaultServer = videoServers[defaultIdx];
    setActiveServerIndex(defaultServer?.premiumOnly && !isPremium ? -1 : defaultIdx);
  }, [src, videoServers, isPremium]);

  const resolvePlaybackSrc = useCallback((rawUrl: string) => {
    return getPrimaryPlaybackSrc(rawUrl, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
  }, [cdnEnabled, proxyUrl, proxyApiKey]);

  const getRawSourceForServer = useCallback((rawUrl: string, serverIndex: number) => {
    if (serverIndex < 0 || videoServers.length === 0) return rawUrl;
    const server = videoServers[serverIndex];
    return server?.domain ? rewriteUrlWithServer(rawUrl, server.domain) : rawUrl;
  }, [videoServers]);

  // Recompute currentSrc when active server changes
  useEffect(() => {
    if (!playbackRouteReady) return;
    const base = getRawSourceForServer(selectedQualitySource, activeServerIndex);
    activeSourceBaseRef.current = base;
    setCurrentSrc(resolvePlaybackSrc(base));
  }, [activeServerIndex, selectedQualitySource, playbackRouteReady, resolvePlaybackSrc, getRawSourceForServer]);

  // serverIndex: -1 = original src; 0+ = videoServers[serverIndex].
  const switchServer = useCallback((serverIndex: number, preserveFailures = false) => {
    if (serverSwitchingRef.current) return;

    let newBase: string;
    if (serverIndex < 0 || videoServers.length === 0) {
      newBase = selectedQualitySource;
    } else {
      const server = videoServers[serverIndex];
      if (!server?.domain) return;
      if (server.premiumOnly && !isPremium) {
        toast.error("👑 Premium subscribers only");
        return;
      }
      newBase = rewriteUrlWithServer(selectedQualitySource, server.domain);
    }
    const finalSrc = resolvePlaybackSrc(newBase);

    if (serverIndex === activeServerIndex && finalSrc === currentSrc && !videoError) {
      setShowServerPanel(false);
      return;
    }

    const v = videoRef.current;
    // Preserve current playback position across server switch so video
    // resumes from where the user was watching, not from 0.
    const savedTime = v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
    const wasPlaying = v ? !v.paused : true;

    setShowServerPanel(false);
    setIsBuffering(true);
    setVideoError(false);
    if (!preserveFailures) failedSrcsRef.current.clear();
    serverSwitchingRef.current = true;
    // Mark intent so onPlay/canplay can resume. pendingSeek is consumed by
    // loadedmetadata; resumeTimeRef is a sticky fallback.
    pendingSeek.current = savedTime;
    resumeTimeRef.current = savedTime;
    resumeShouldPlayRef.current = wasPlaying;

    try {
      if (preloadVideoRef.current) {
        preloadVideoRef.current.pause();
        preloadVideoRef.current.src = "";
        preloadVideoRef.current.remove();
        preloadVideoRef.current = null;
      }
    } catch {}
    activeSourceBaseRef.current = newBase;
    pendingSeek.current = savedTime;
    setActiveServerIndex(serverIndex);
    setCurrentSrc(finalSrc);
    serverSwitchingRef.current = false;
  }, [activeServerIndex, videoServers, resolvePlaybackSrc, selectedQualitySource, isPremium, currentSrc, videoError]);


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
        artist: subtitle || 'ICF ANIME',
        album: 'ICF ANIME',
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

  const applyControlsVisibility = useCallback((visible: boolean) => {
    showControlsRef.current = visible;
    const overlay = controlsOverlayRef.current;
    if (overlay) {
      overlay.style.opacity = visible ? "1" : "0";
      overlay.style.pointerEvents = visible ? "auto" : "none";
    }
    setShowControls((prev) => (prev === visible ? prev : visible));
  }, []);

  const resetHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    applyControlsVisibility(true);
    hideTimer.current = setTimeout(() => applyControlsVisibility(false), 2500);
  }, [applyControlsVisibility]);

  const toggleControls = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const next = !showControlsRef.current;
    applyControlsVisibility(next);
    if (next) hideTimer.current = setTimeout(() => applyControlsVisibility(false), 2500);
  }, [applyControlsVisibility]);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [resetHideTimer]);

  useEffect(() => {
    return () => {
      if (bufferingHardTimeoutRef.current) {
        clearTimeout(bufferingHardTimeoutRef.current);
        bufferingHardTimeoutRef.current = null;
      }
    };
  }, []);

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
        const introUntil = Number((window as any).__icfWatchIntroUntil || 0);
        const delay = Math.max(0, introUntil - Date.now());
        window.setTimeout(() => v.play().catch(() => {}), delay);
      }
    };
    const onPlay = () => {
      setPlaying(true);
      // Start RAF loop for smooth progress.
      // CRITICAL: Direct DOM updates only inside the per-frame loop —
      // calling setCurrentTime every frame re-renders the entire 2k-line
      // component 60×/sec and is the #1 source of player lag on low-end
      // phones. We throttle the React state update to ~once/sec so other
      // consumers (overlays, next-ep timer) still see fresh time, while
      // playback stays jank-free.
      let lastReactSync = 0;
      const tick = () => {
        if (!v.paused && !v.ended) {
          const ct = v.currentTime;
          if (ct > 0) lastKnownTime = ct;
          const dur = v.duration;
          if (progressRef.current && dur > 0) {
            progressRef.current.style.width = `${(ct / dur) * 100}%`;
          }
          if (timeDisplayRef.current && dur > 0) {
            timeDisplayRef.current.textContent = `${formatTime(ct)} / ${formatTime(dur)}`;
          }
          const now = performance.now();
          if (now - lastReactSync > 1000) {
            lastReactSync = now;
            setCurrentTime(ct);
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
    let retryCount = 0;
    const MAX_RETRIES = 1;
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
          const candidateRaw = getRawSourceForServer(q.src, activeServerIndex);
          const candidateSrc = getPrimaryPlaybackSrc(candidateRaw, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
          return !failedSrcsRef.current.has(candidateSrc) && candidateSrc !== currentSrc;
        });

        if (nextOption) {
          setQualityFailMsg(`"${failedQualityLabel}" quality not available. Switching to "${nextOption.label}"...`);
          setTimeout(() => setQualityFailMsg(null), 4000);
          pendingSeek.current = lastKnownTime || v?.currentTime || 0;
          const nextRaw = getRawSourceForServer(nextOption.src, activeServerIndex);
          const newFallbackSrc = getPrimaryPlaybackSrc(nextRaw, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
          activeSourceBaseRef.current = nextRaw;
          if (newFallbackSrc === currentSrc) {
            v.currentTime = pendingSeek.current;
            pendingSeek.current = null;
            v.load();
          } else {
            setCurrentSrc(newFallbackSrc);
          }
          setCurrentQuality(nextOption.label);
        } else {
          if (videoServers.length >= 1) {
            const availableServerIndexes = videoServers
              .map((srv, idx) => ({ srv, idx }))
              .filter(({ srv }) => !srv.premiumOnly || !!isPremium)
              .map(({ idx }) => idx);
            const orderedIndexes = activeServerIndex < 0
              ? availableServerIndexes
              : [...availableServerIndexes.filter((idx) => idx > activeServerIndex), ...availableServerIndexes.filter((idx) => idx < activeServerIndex)];
            const nextServerIdx = orderedIndexes.find((idx) => !failedSrcsRef.current.has(`__server_failover_${idx}`));
            if (nextServerIdx !== undefined) {
              failedSrcsRef.current.add(`__server_failover_${nextServerIdx}`);
              const srv = videoServers[nextServerIdx];
              setQualityFailMsg(`Video server issue. Switching to S${nextServerIdx + 1} ${srv?.name || ""}...`);
              setTimeout(() => setQualityFailMsg(null), 3500);
              switchServer(nextServerIdx, true);
              return;
            }
          }
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
      // Apply pending seek here in case loadedmetadata didn't fire.
      if (pendingSeek.current !== null && v.duration > 0) {
        v.currentTime = pendingSeek.current;
        pendingSeek.current = null;
      }
      // Sticky resume — covers server/quality switches where the source
      // changes but the user expects to continue from the same spot.
      if (resumeTimeRef.current > 0 && v.duration > 0 && Math.abs(v.currentTime - resumeTimeRef.current) > 1.5) {
        try { v.currentTime = Math.min(resumeTimeRef.current, v.duration - 0.5); } catch {}
      }
      resumeTimeRef.current = 0;
      if (v.paused && !adGateActive && resumeShouldPlayRef.current) {
        const introUntil = Number((window as any).__icfWatchIntroUntil || 0);
        const delay = Math.max(0, introUntil - Date.now());
        window.setTimeout(() => v.play().catch(() => {}), delay);
      }
    };
    const onCanPlayThrough = () => {};
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
      if (v.readyState >= 3 && !v.paused) {
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
    if (v.src !== currentSrc) v.src = currentSrc;
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
      // Pause on source/effect cleanup; React will remove the element on unmount.
      v.pause();
      if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
    };
  }, [currentSrc, adGateActive, availableQualities, currentQuality, cdnEnabled, proxyUrl, proxyApiKey, playbackRouteReady, activeServerIndex, videoServers, isPremium, switchServer, getRawSourceForServer]);

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

  const switchQuality = useCallback((option: QualityOption) => {
    // Block 4K for non-premium users
    if (is4KLabel(option.label) && !isPremium) return;
    if (option.label === currentQuality) { setShowSettings(false); return; }

    const serverAdjustedRaw = getRawSourceForServer(option.src, activeServerIndex);
    activeSourceBaseRef.current = serverAdjustedRaw;
    const newSrc = getPrimaryPlaybackSrc(serverAdjustedRaw, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);

    if (newSrc === currentSrc) {
      setCurrentQuality(option.label);
      setShowSettings(false);
      return;
    }
    const v = videoRef.current;
    const savedTime = v?.currentTime || 0;
    pendingSeek.current = savedTime;
    resumeTimeRef.current = savedTime;
    resumeShouldPlayRef.current = v ? !v.paused : true;
    setIsBuffering(true);
    setCurrentSrc(newSrc);
    setCurrentQuality(option.label);
    setShowSettings(false);
  }, [currentQuality, currentSrc, cdnEnabled, proxyUrl, proxyApiKey, isPremium, activeServerIndex, getRawSourceForServer]);

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
      toggleControls();
    }
  }, [locked, seek, togglePlay, playing, toggleControls]);


  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    const next = { startX: t.clientX, startY: t.clientY, type: null as string | null };
    swipeStateRef.current = next;
    setSwipeState(next);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const state = swipeStateRef.current;
    if (!state || locked) return;
    const t = e.touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;
    // If user moves the finger, cancel any pending 2x-speed hold so
    // brightness/volume gestures aren't interrupted by speed-up.
    if (!state.type && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    }
    // While 2x hold is active, block brightness/volume gestures entirely.
    if (holdSpeedActive) return;
    if (!state.type && Math.abs(dy) > 20) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const relX = (state.startX - rect.left) / rect.width;
      state.type = relX > 0.5 ? "volume" : "brightness";
      setSwipeState({ ...state });
      return;
    }
    const now = performance.now();
    if (state.type === "volume") {
      const newBoosted = Math.min(100, Math.max(0, boostedVolumeRef.current - dy * 0.5));
      boostedVolumeRef.current = newBoosted;
      if (videoRef.current) videoRef.current.volume = Math.min(1, newBoosted / 100);
      if (now - gestureStateSyncRef.current > 80) {
        gestureStateSyncRef.current = now;
        setBoostedVolume(newBoosted);
        setVolume(Math.min(1, newBoosted / 100));
      }
      state.startY = t.clientY;
    } else if (state.type === "brightness") {
      const newBr = Math.min(1.5, Math.max(0.3, brightnessRef.current - dy * 0.003));
      brightnessRef.current = newBr;
      if (videoContainerRef.current) videoContainerRef.current.style.filter = `brightness(${newBr})`;
      if (now - gestureStateSyncRef.current > 80) {
        gestureStateSyncRef.current = now;
        setBrightness(newBr);
      }
      state.startY = t.clientY;
    }
  }, [locked, holdSpeedActive]);

  const handleTouchEnd = useCallback(() => {
    swipeStateRef.current = null;
    setBoostedVolume(boostedVolumeRef.current);
    setVolume(Math.min(1, boostedVolumeRef.current / 100));
    setBrightness(brightnessRef.current);
    setSwipeState(null);
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`fixed inset-0 z-[300] bg-background flex flex-col items-center ${isFullscreen ? '' : 'overflow-y-auto'}`} ref={containerRef}>
      <div className={`w-full ${isFullscreen ? 'h-full p-0' : 'max-w-full pb-5'}`}>
        {/* Video Container - sticky at top while user scrolls info below */}
        <div
          ref={videoContainerRef}
          className={`relative bg-black overflow-hidden ${
            isFullscreen
              ? "w-screen h-screen rounded-none"
              : "w-full rounded-none aspect-video sticky top-0 z-[35]"
          }`}
          style={{ filter: `brightness(${brightness})`, willChange: "transform", margin: isFullscreen ? 0 : undefined, touchAction: "none", overscrollBehavior: "contain" }}
          onContextMenu={(e) => e.preventDefault()}
          onClick={handleVideoClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => { handleTouchEnd(); endHoldSpeed(); }}
          onPointerDown={startHoldSpeed}
          onPointerUp={endHoldSpeed}
          onPointerLeave={endHoldSpeed}
          onPointerCancel={endHoldSpeed}
        >
          <video
            ref={videoRef}
            src={currentSrc}
            className="w-full h-full"
            style={{ objectFit: cropModes[cropIndex], willChange: "transform", WebkitTouchCallout: "none", userSelect: "none" }}
            playsInline
            preload="metadata"
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

          {/* Loading/Buffering Overlay */}
          {isBuffering && !videoError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-15 pointer-events-none">
              <div className="flex flex-col items-center gap-2.5">
                <div className="player-loader-shell player-loader-shell--force-motion">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span key={i} className="player-loader-petal" />
                  ))}
                </div>
                <span className="text-[11px] font-medium text-white/90 tracking-wide">Loading…</span>
              </div>
            </div>
          )}

          {holdSpeedActive && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-black/40 backdrop-blur-sm text-white text-[10px] font-semibold px-2 py-1 rounded-full flex items-center gap-1 pointer-events-none">
              <FastForward className="w-3 h-3" /> 2x
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
            <div className="absolute bottom-20 right-3 z-30" onClick={(e) => e.stopPropagation()}>
              <div className="player-glass rounded-xl p-3 pr-4 flex items-center gap-3 shadow-lg border border-primary/30" style={{ boxShadow: "0 0 20px hsla(176, 65%, 48%, 0.2)" }}>
                <div className="relative w-10 h-10 flex items-center justify-center">
                  {/* Circular countdown */}
                  <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="16" fill="none" stroke="hsla(176,65%,48%,0.15)" strokeWidth="2" />
                    <circle cx="18" cy="18" r="16" fill="none" stroke="hsl(176,65%,48%)" strokeWidth="2.5"
                      strokeDasharray={`${(nextEpCountdown / 60) * 100} 100`}
                      strokeLinecap="round" className="" />
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
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 player-glass px-4 py-2.5 rounded-xl text-center max-w-[85%]">
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

          {/* Controls Overlay - always rendered, opacity-driven for smooth fade */}
          {!locked && (
            <div
              ref={controlsOverlayRef}
              className={`absolute inset-0 flex flex-col justify-between text-white transition-opacity duration-150 ease-out will-change-[opacity] [transform:translateZ(0)] ${
                showControls ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
              style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 30%, transparent 60%, rgba(0,0,0,0.7) 70%)", willChange: "opacity" }}
            >
              {/* Top controls */}
              <div className="flex justify-between items-center gap-2 p-3">
                {/* Left: back + S/E + title */}
                {!isFullscreen && (
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const v = videoRef.current;
                        if (v) { v.pause(); v.src = ''; v.load(); }
                        if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
                        onClose();
                      }}
                      className="w-9 h-9 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
                    >
                      <ArrowLeft className="w-5 h-5 text-white" />
                    </button>
                    <div className="flex flex-col min-w-0 flex-1 leading-tight">
                      <span className="text-sm font-semibold text-white truncate">
                        {animeMeta?.title || title}
                      </span>
                      {(() => {
                        const parts: string[] = [];
                        if (seasons && currentSeasonIdx !== undefined) parts.push(`S${currentSeasonIdx + 1}`);
                        const activeEp = episodeList?.find(ep => ep.active);
                        if (activeEp) parts.push(`E${activeEp.number}`);
                        const label = parts.join(' · ');
                        return label ? (
                          <span className="text-[10px] font-medium text-white/70 truncate mt-0.5">{label}</span>
                        ) : null;
                      })()}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-shrink-0">

                {videoServers.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowServerPanel(!showServerPanel); resetHideTimer(); }}
                      className="player-glass h-7 px-2.5 rounded-full flex items-center justify-center gap-1"
                    >
                      <Server className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-medium">
                        {activeServerIndex >= 0
                          ? `S${activeServerIndex + 1} ${videoServers[activeServerIndex]?.name || ""}`
                          : "Default"}
                      </span>
                      <ChevronDown className="w-3 h-3 opacity-70" />
                    </button>
                    {showServerPanel && (
                      <div className="absolute top-9 right-0 player-glass rounded-xl p-2 z-30 min-w-[200px] max-h-[260px] overflow-y-auto shadow-lg" onClick={(e) => e.stopPropagation()}>
                        <p className="text-[9px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Video Servers</p>
                        <button
                          onClick={() => switchServer(-1)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between ${activeServerIndex === -1 ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"}`}
                        >
                          <span>Default</span>
                          {activeServerIndex === -1 && <Check className="w-3 h-3" />}
                        </button>
                        {videoServers.map((s, i) => {
                          const lockedSrv = !!s.premiumOnly && !isPremium;
                          return (
                            <button
                              key={s.id}
                              onClick={() => { if (!lockedSrv) switchServer(i); }}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-2 ${
                                lockedSrv ? "opacity-60 cursor-not-allowed" :
                                activeServerIndex === i ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                              }`}
                            >
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="opacity-70 shrink-0">S{i + 1}</span>
                                <span className="truncate">{s.name}</span>
                              </span>
                              <span className="flex items-center gap-1 shrink-0">
                                {s.premiumOnly ? (
                                  <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">👑</span>
                                ) : (
                                  <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">FREE</span>
                                )}
                                {!lockedSrv && activeServerIndex === i && <Check className="w-3 h-3" />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={(e) => { e.stopPropagation(); setCropIndex((cropIndex + 1) % 3); }} className="player-glass h-7 px-2.5 rounded-full flex items-center justify-center gap-1">
                  <Crop className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium">{cropLabels[cropIndex]}</span>
                </button>
                <button onClick={(e) => { e.stopPropagation(); setLocked(true); resetHideTimer(); }} className="player-glass w-8 h-8 rounded-full flex items-center justify-center">
                  <Lock className="w-3.5 h-3.5" />
                </button>
                </div>
              </div>


              {/* Center play */}
              <div className="flex items-center justify-center gap-8">
                <button onClick={(e) => { e.stopPropagation(); seek(-10); }} className="w-10 h-10 rounded-full bg-foreground/20 flex items-center justify-center ">
                  <SkipBack className="w-5 h-5" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="w-14 h-14 rounded-full gradient-primary flex items-center justify-center btn-glow">
                  {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-1" />}
                </button>
                <button onClick={(e) => { e.stopPropagation(); seek(10); }} className="w-10 h-10 rounded-full bg-foreground/20 flex items-center justify-center ">
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
                    {/* server selector moved to top bar */}
                    {availableQualities.length > 1 && (
                      <div className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowQualityPanel(!showQualityPanel); }}
                          className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
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
                                  className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
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
              <button onClick={() => setShowSettings(false)} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-foreground/20 flex items-center justify-center hover:bg-foreground/30">
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="flex gap-1.5 mb-3 pr-7">
                <button onClick={() => setSettingsTab("speed")} className={`text-[11px] px-3 py-1.5 rounded-full font-medium ${settingsTab === "speed" ? "gradient-primary text-white" : "bg-foreground/10 hover:bg-foreground/20"}`}>
                  Speed
                </button>
                <button onClick={() => setSettingsTab("quality")} className={`text-[11px] px-3 py-1.5 rounded-full font-medium ${settingsTab === "quality" ? "gradient-primary text-white" : "bg-foreground/10 hover:bg-foreground/20"}`}>
                  Quality
                </button>
              </div>

              {settingsTab === "speed" && (
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Playback Speed</p>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <button key={r} onClick={() => setSpeed(r)}
                      className={`block w-full text-left px-3 py-2 rounded-lg text-xs ${playbackRate === r ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"}`}>
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
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
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

        {/* MovieBox-style watch page info (below player, edge-to-edge layout) */}
        {!isFullscreen && !adGateActive && !deviceBlocked && !unlockBlocked && (
          <div className="w-full px-5 pt-4 pb-2">
            {/* Title + Info tap area */}
            <button
              type="button"
              onClick={() => { if (description || animeMeta) { setInfoTab('details'); setInfoExpanded(false); setShowInfoSheet(true); } }}
              className="w-full text-left active:opacity-70 transition-opacity"
            >
              <div className="flex items-start gap-2">
                <h2 className="text-[15px] font-bold text-foreground leading-snug flex-1 truncate">
                  {animeMeta?.title || title}
                </h2>
                <div className="flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-semibold text-muted-foreground flex-shrink-0 mt-1">
                  Info <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
              {/* Metadata row */}
              <div className="flex items-center gap-1.5 flex-nowrap mt-1.5 text-[12px] text-muted-foreground overflow-hidden">
                <Tv className="w-3.5 h-3.5 text-foreground/60 flex-shrink-0" />
                {animeMeta?.rating && (<><span className="text-foreground/25 flex-shrink-0">|</span><span className="flex items-center gap-0.5 flex-shrink-0"><Star className="w-3 h-3 text-primary fill-primary flex-shrink-0" />{animeMeta.rating}</span></>)}
                {animeMeta?.year && (<><span className="text-foreground/25 flex-shrink-0">|</span><span className="truncate">{animeMeta.year}</span></>)}
                {animeMeta?.language && (<><span className="text-foreground/25 flex-shrink-0">|</span><span className="truncate">{animeMeta.language}</span></>)}
                {animeMeta?.type && (<><span className="text-foreground/25 flex-shrink-0">|</span><span className="capitalize truncate">{animeMeta.type}</span></>)}
                {seasons && seasons.length > 0 && (<><span className="text-foreground/25 flex-shrink-0">|</span><span className="truncate">{seasons.length} season{seasons.length > 1 ? 's' : ''}</span></>)}
              </div>
            </button>

            {/* 4 action pills */}
            <div className="grid grid-cols-4 gap-2 mt-4">
              <button
                onClick={() => {
                  if (!animeId) { toast.error("Cannot save: missing anime id"); return; }
                  const item = {
                    id: animeId,
                    title: animeMeta?.title || title,
                    poster: animeMeta?.poster || poster,
                    year: animeMeta?.year,
                    rating: animeMeta?.rating,
                    type: animeMeta?.type,
                    addedAt: Date.now(),
                  };
                  const guest = isGuestUser();
                  if (saved) {
                    if (guest) removeGuestWatchlistItemNotify(animeId);
                    else {
                      try { const uid = getLocalUserId(); if (uid) remove(ref(db, `users/${uid}/watchlist/${animeId}`)); } catch {}
                    }
                    setSaved(false);
                    toast.success("Removed from watchlist");
                  } else {
                    if (guest) setGuestWatchlistItemNotify(animeId, item);
                    else {
                      try { const uid = getLocalUserId(); if (uid) set(ref(db, `users/${uid}/watchlist/${animeId}`), item); } catch {}
                    }
                    setSaved(true);
                    toast.success("Saved to watchlist");
                  }
                }}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-full text-[11px] font-medium transition-colors border ${saved ? 'bg-primary/15 text-primary border-primary/30' : 'bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border-border'}`}
              >
                <Bookmark className={`w-3.5 h-3.5 flex-shrink-0 ${saved ? 'fill-primary' : ''}`} />
                <span className="whitespace-nowrap truncate">{saved ? 'Saved' : 'Add to list'}</span>
              </button>
              <button
                onClick={async () => {
                  const u = typeof window !== 'undefined' ? window.location.href : '';
                  const shareData = { title: animeMeta?.title || title, text: animeMeta?.title || title, url: u };
                  try {
                    if ((navigator as any).share && (!(navigator as any).canShare || (navigator as any).canShare(shareData))) {
                      await (navigator as any).share(shareData);
                      return;
                    }
                  } catch (err: any) {
                    if (err?.name === "AbortError") return;
                  }
                  try {
                    await navigator.clipboard?.writeText(u);
                    toast.success("Link copied");
                  } catch {
                    toast.error("Sharing not supported");
                  }
                }}
                className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-full text-[11px] font-medium bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border border-border"
              >
                <Share2 className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Share</span>
              </button>
              <button
                onClick={() => {
                  // Open inline download panel right here (no scroll-to-bottom)
                  setShowDownloadPanel((v) => {
                    if (!v) setDlSeasonIdx(currentSeasonIdx ?? 0);
                    return !v;
                  });
                  setDlSelectedQuality((q) => {
                    if (q && q !== "Auto") return q;
                    const QUALS = [
                      { label: "480p", key: "link480" },
                      { label: "720p", key: "link720" },
                      { label: "1080p", key: "link1080" },
                      { label: "4K", key: "link4k" },
                    ] as const;
                    const lowest = QUALS.find((qq) => dlEpisodeList?.some((ep) => !!(ep as any)[qq.key]));
                    return lowest?.label || null;
                  });
                  // Pre-select the currently playing episode for convenience
                  setDlSelectedEpisodes((prev) => {
                    if (prev.size > 0) return prev;
                    const activeEp = dlEpisodeList?.find((ep) => ep.active);
                    return new Set(activeEp ? [activeEp.number] : []);
                  });
                }}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-full text-[11px] font-medium border active:scale-95 transition-all ${showDownloadPanel ? 'bg-primary/15 text-primary border-primary/30' : 'bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border-border'}`}
              >
                <Download className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Download</span>
              </button>

              <button
                onClick={() => { window.dispatchEvent(new CustomEvent('open-downloads')); }}
                className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-full text-[11px] font-medium bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border border-border"
              >
                <FolderDown className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="whitespace-nowrap truncate">Library</span>
              </button>
            </div>

            {/* Inline Download Panel (MovieBox style) — opens right under the pills */}
            {showDownloadPanel && (
              <div className="mt-3 rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-3.5 shadow-sm animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <Download className="w-4 h-4 text-primary" />
                    <h4 className="text-sm font-bold text-foreground">Download</h4>
                    {dlSelectedEpisodes.size > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold">{dlSelectedEpisodes.size}</span>
                    )}
                  </div>
                  <button onClick={() => setShowDownloadPanel(false)} className="w-7 h-7 rounded-full bg-foreground/10 hover:bg-foreground/15 flex items-center justify-center">
                    <X className="w-3.5 h-3.5 text-foreground/70" />
                  </button>
                </div>

                {/* Season + Language chips */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {dlSeasons && dlSeasons.length > 0 && (
                    <button onClick={() => setShowDlSeasonPicker(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-foreground/[0.06] text-[11px] font-semibold text-foreground/85 border border-border hover:bg-foreground/10">
                      {dlSeasons[dlSeasonIdx]?.name || `Season ${dlSeasonIdx + 1}`}
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  )}
                  {(langList.length > 0 || dlLangLabel) && (
                    <button onClick={() => setShowDlLangPicker(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-foreground/[0.06] text-[11px] font-semibold text-foreground/85 border border-border hover:bg-foreground/10">
                      {dlLangLabel}
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  )}
                </div>



                {/* Per-season qualities: only show qualities that have ≥1 episode */}
                {dlEpisodeList && dlEpisodeList.length > 0 && (() => {
                  const QUALS: { label: string; key: "link480" | "link720" | "link1080" | "link4k" }[] = [
                    { label: "480p", key: "link480" },
                    { label: "720p", key: "link720" },
                    { label: "1080p", key: "link1080" },
                    { label: "4K", key: "link4k" },
                  ];
                  const seasonQualities = QUALS.filter((q) => dlEpisodeList.some((ep) => !!(ep as any)[q.key]));
                  const hasAnyPerEpQuality = seasonQualities.length > 0;
                  // Always show all 4 qualities; mark unavailable ones disabled.
                  const effectiveQualities = hasAnyPerEpQuality
                    ? QUALS.map((q) => ({ label: q.label, key: q.key as string, available: seasonQualities.some((s) => s.label === q.label) }))
                    : availableQualities.filter((q) => q.label !== "Auto").map((q) => ({ label: q.label, key: "" as string, available: true }));
                  const selectedQualityKey = effectiveQualities.find((q) => q.label === dlSelectedQuality)?.key || "";

                  // Episodes available in the currently selected quality
                  const epsForQuality = selectedQualityKey
                    ? dlEpisodeList.filter((ep) => !!(ep as any)[selectedQualityKey])
                    : dlEpisodeList;
                  const allSelected = epsForQuality.length > 0 && epsForQuality.every((ep) => dlSelectedEpisodes.has(ep.number));
                  // Map episode -> pre-captured bytes (0 = loading, -1 = unknown)
                  const epBytes = (ep: any): number => {
                    const raw = (selectedQualityKey && ep[selectedQualityKey]) || ep.link;
                    if (!raw) return -1;
                    const proxied = getPrimaryPlaybackSrc(raw, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
                    return dlSizesByUrl[proxied] ?? 0;
                  };
                  const fmtMB = (bytes: number) => {
                    if (bytes <= 0) return "";
                    const mb = bytes / (1024 * 1024);
                    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
                    return `${mb.toFixed(0)} MB`;
                  };
                  const totalSelectedBytes = dlEpisodeList
                    .filter((ep) => dlSelectedEpisodes.has(ep.number))
                    .reduce((sum, ep) => { const b = epBytes(ep); return sum + (b > 0 ? b : 0); }, 0);
                  return (
                    <>
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Episodes</p>
                          <button
                            onClick={() => {
                              if (allSelected) setDlSelectedEpisodes(new Set());
                              else setDlSelectedEpisodes(new Set(epsForQuality.map((e) => e.number)));
                            }}
                            className="text-[11px] font-semibold text-primary hover:underline"
                          >
                            {allSelected ? 'Clear all' : 'Select all'}
                          </button>
                        </div>
                        <div className="grid grid-cols-5 gap-1.5 max-h-[220px] overflow-y-auto pr-1">
                          {dlEpisodeList.map((ep) => {
                            const sel = dlSelectedEpisodes.has(ep.number);
                            const hasQuality = selectedQualityKey ? !!(ep as any)[selectedQualityKey] : true;
                            const bytes = hasQuality ? epBytes(ep) : -1;
                            const sizeLabel = bytes > 0 ? fmtMB(bytes) : bytes === 0 ? "…" : "";
                            return (
                              <button
                                key={ep.number}
                                disabled={!hasQuality}
                                onClick={() => {
                                  setDlSelectedEpisodes((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(ep.number)) next.delete(ep.number); else next.add(ep.number);
                                    return next;
                                  });
                                }}
                                className={`rounded-md py-1.5 px-1 flex flex-col items-center justify-center gap-0.5 leading-none transition-colors ${!hasQuality ? 'opacity-30 cursor-not-allowed bg-foreground/[0.04] text-muted-foreground border border-border' : sel ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/10 border border-border'}`}
                              >
                                <span className="text-[12px] font-bold">{ep.number}</span>
                                {sizeLabel && <span className="text-[9px] opacity-80 font-medium">{sizeLabel}</span>}
                              </button>
                            );
                          })}
                        </div>
                        {dlSelectedEpisodes.size > 0 && totalSelectedBytes > 0 && (
                          <p className="mt-2 text-[10px] text-muted-foreground">
                            Total: <span className="font-semibold text-foreground/85">{fmtMB(totalSelectedBytes)}</span>
                          </p>
                        )}
                      </div>


                      {/* Quality selector — only qualities that have ≥1 episode in this season */}
                      {effectiveQualities.length > 0 && (
                        <div className="mb-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Quality</p>
                          <div className="flex flex-wrap gap-1.5">
                            {effectiveQualities.map((opt) => {
                              const sel = dlSelectedQuality === opt.label;
                              const locked4K = is4KLabel(opt.label) && !isPremium;
                              const unavailable = !opt.available;
                              const disabled = locked4K || unavailable;
                              return (
                                <button
                                  key={opt.label}
                                  disabled={disabled}
                                  onClick={() => {
                                    if (disabled) return;
                                    setDlSelectedQuality(opt.label);
                                    if (opt.key) {
                                      setDlSelectedEpisodes((prev) => {
                                        const next = new Set<number>();
                                        dlEpisodeList.forEach((ep) => {
                                          if (prev.has(ep.number) && (ep as any)[opt.key]) next.add(ep.number);
                                        });
                                        return next;
                                      });
                                    }
                                  }}
                                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border flex items-center gap-1 ${disabled ? 'opacity-40 cursor-not-allowed bg-foreground/[0.04] text-muted-foreground border-border' : sel ? 'bg-primary text-primary-foreground border-primary' : 'bg-foreground/[0.06] text-foreground/85 border-border hover:bg-foreground/10'}`}
                                >
                                  {opt.label}
                                  {locked4K && <Lock className="w-3 h-3" />}
                                </button>
                              );
                            })}

                          </div>
                        </div>
                      )}

                      {/* Confirm */}
                      <button
                        disabled={dlSelectedEpisodes.size === 0 || !dlSelectedQuality}
                        onClick={async () => {
                          if (!dlEpisodeList || !dlSelectedQuality) return;
                          const quality = dlSelectedQuality;
                          const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
                          const qKey = effectiveQualities.find((q) => q.label === quality)?.key || "";
                          const fallbackQOpt = availableQualities.find((q) => q.label === quality);
                          const { downloadManager } = await import("@/lib/downloadManager");
                          const selected = dlEpisodeList
                            .filter((ep) => dlSelectedEpisodes.has(ep.number))
                            .slice()
                            .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

                          const animeTitle = animeMeta?.title || title;
                          const seasonNum = dlSeasonIdx + 1;
                          let started = 0;
                          for (const ep of selected) {
                            const epSrc: string = (qKey && (ep as any)[qKey]) || (ep as any).link || "";
                            if (!epSrc) continue;
                            let h = 0; for (let i = 0; i < epSrc.length; i++) h = (h * 31 + epSrc.charCodeAt(i)) >>> 0;
                            // Filename pattern: "{Anime Title} - S{n}E{m} - {quality}-{stamp}.mp4"
                            const epSub = `S${seasonNum}E${ep.number}`;
                            const dlId = `${[animeTitle, epSub].filter(Boolean).map((p) => norm(p as string)).join("__") || "video"}__${norm(quality) || "auto"}__${h.toString(36)}`;
                            const downloadRoutes = buildPlaybackCandidates(epSrc, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
                            await downloadManager.enqueueDownload({ id: dlId, url: downloadRoutes[0] || epSrc, urls: downloadRoutes, fallbackUrl: epSrc, title: animeTitle, subtitle: epSub, poster, quality });
                            started++;
                          }
                          if (started > 0) toast.success(`${started} ${started > 1 ? 'episodes' : 'episode'} • ${quality} downloading`);
                          else toast.error("No matching sources for selected episodes");
                          setShowDownloadPanel(false);
                          setDlSelectedEpisodes(new Set());
                        }}
                        className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 gradient-primary text-primary-foreground btn-glow disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Download className="w-4 h-4" />
                        Download {dlSelectedEpisodes.size > 0 ? `(${dlSelectedEpisodes.size})` : ''}
                      </button>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Resources section */}
            {episodeList && episodeList.length > 0 && (
              <div className="mt-5">
                <div className="flex items-baseline gap-2 mb-3">
                  <h3 className="text-[15px] font-bold text-foreground">Resources</h3>
                </div>
                {/* Dub + Season pickers (inline YouTube-style dropdowns — never overlay the player) */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {currentLangLabel && (
                    <button
                      onClick={() => { setShowLangPicker((v) => !v); setShowSeasonPicker(false); }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border active:scale-95 transition-all ${showLangPicker ? 'bg-primary/15 text-primary border-primary/40' : 'bg-foreground/[0.06] text-foreground/85 border-border hover:bg-foreground/10'}`}
                    >
                      {currentLangLabel}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showLangPicker ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                  {seasons && seasons.length > 0 && (
                    <button
                      onClick={() => { setShowSeasonPicker((v) => !v); setShowLangPicker(false); }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border active:scale-95 transition-all ${showSeasonPicker ? 'bg-primary/15 text-primary border-primary/40' : 'bg-foreground/[0.06] text-foreground/85 border-border hover:bg-foreground/10'}`}
                    >
                      {seasons[currentSeasonIdx ?? 0]?.name || `Season ${(currentSeasonIdx ?? 0) + 1}`}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSeasonPicker ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>

                {/* Season + Language pickers now open as MovieBox-style bottom sheets
                    (see modals at end of component). Keep the inline area minimal here. */}


                {/* Episodes horizontal scroll — "All" stays sticky on the left while episodes scroll */}
                <div className="relative -mx-5">
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 pl-5 pr-5">
                    <button
                      onClick={() => setShowAllEpisodes(true)}
                      className={`sticky left-0 z-10 flex-shrink-0 min-w-[56px] px-3 py-2.5 rounded-lg text-sm font-bold border shadow-[6px_0_8px_-6px_rgba(0,0,0,0.25)] transition-all ${
                        showAllEpisodes
                          ? 'bg-gradient-to-br from-primary to-primary/70 text-primary-foreground border-primary/50'
                          : 'bg-background border-border hover:bg-foreground/10'
                      }`}
                    >
                      All
                    </button>
                    {episodeList.map((ep) => (
                      <button
                        key={ep.number}
                        onClick={ep.onClick}
                        className={`flex-shrink-0 min-w-[56px] px-3 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                          ep.active
                            ? 'bg-gradient-to-br from-primary/25 to-primary/10 text-primary border border-primary/40'
                            : 'bg-foreground/[0.06] text-foreground/85 border border-border hover:bg-foreground/10'
                        }`}
                      >
                        {ep.number}
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            )}

            {/* For you / Comments tabs */}
            {(suggestedAnime && suggestedAnime.length > 0) || animeId ? (
              <div className="mt-5">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                  <button
                    onClick={() => setBottomTab("foryou")}
                    className={`text-[13px] font-bold px-3 py-1.5 rounded-full transition-colors ${bottomTab === "foryou" ? "bg-primary text-primary-foreground" : "bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/10"}`}
                  >
                    For you
                  </button>
                  {animeId && (
                    <button
                      onClick={() => setBottomTab("comments")}
                      className={`text-[13px] font-bold px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 ${bottomTab === "comments" ? "bg-primary text-primary-foreground" : "bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/10"}`}
                    >
                      <span>Comments</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${bottomTab === "comments" ? "bg-primary-foreground/20" : "bg-primary/15 text-primary"}`}>
                        {commentCount}
                      </span>
                    </button>
                  )}
                </div>

                {bottomTab === "foryou" && suggestedAnime && suggestedAnime.length > 0 && (
                  <div className="grid grid-cols-3 gap-2.5">
                    {suggestedAnime.map((a) => (
                      <button key={a.id} onClick={() => onSuggestedClick?.(a)} className="group text-left">
                        <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-foreground/5">
                          {a.poster ? (
                            <img src={a.poster} alt={a.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No image</div>
                          )}
                          {a.language && (
                            <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-semibold text-white">
                              {a.language}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-medium text-foreground line-clamp-2 leading-tight mt-1.5">{a.title}</p>
                      </button>
                    ))}
                  </div>
                )}

                {bottomTab === "comments" && animeId && (
                  <CommentSection animeId={animeId} embedded hideHeader onCountChange={setCommentCount} />
                )}
              </div>
            ) : null}

            {/* Hidden mount keeps comment count live even when tab not active */}
            {animeId && bottomTab !== "comments" && (
              <div className="hidden">
                <CommentSection animeId={animeId} embedded hideHeader onCountChange={setCommentCount} />
              </div>
            )}

          </div>
        )}

        {/* Device limit is now enforced at login time - no overlay needed */}



        {/* Ad Gate Overlay */}
        {adGateActive && !deviceBlocked && !unlockBlocked && (
          <div className="fixed inset-0 z-[400] bg-black/90 flex items-center justify-center ">
            <div className="bg-card rounded-2xl p-6 max-w-sm w-[90%] text-center space-y-4 shadow-2xl border border-border">
              <h3 className="text-lg font-bold text-foreground">Unlock {freeAccessLabelEn} Access</h3>
              <p className="text-sm text-muted-foreground">Click the link below to get {freeAccessLabelEn} of free access to all videos</p>
              {shortenLoading ? (
                <div className="flex items-center justify-center gap-2 py-3">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Preparing link...</span>
                </div>
              ) : (
                <button onClick={handleOpenAdLink} className="w-full py-3 rounded-xl gradient-primary text-white font-semibold flex items-center justify-center gap-2 btn-glow">
                  <ExternalLink className="w-4 h-4" />
                  Unlock Now
                </button>
              )}
              <button
                onClick={() => {
                  if (tutorialLink) { setShowTutorialVideo(true); } else { alert("Tutorial video not available yet. Please contact admin."); }
                }}
                className="w-full py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium flex items-center justify-center gap-2 text-sm"
              >
                <Play className="w-3.5 h-3.5" />
                How to open my link
              </button>
            </div>
          </div>
        )}

        {unlockBlocked && (
          <div className="fixed inset-0 z-[450] bg-black/90 flex items-center justify-center  p-5">
            <div className="bg-card rounded-2xl p-6 max-w-sm w-full text-center space-y-3 border border-border shadow-2xl">
              <h3 className="text-lg font-bold text-foreground">Access Blocked</h3>
              <p className="text-sm text-muted-foreground">একই unlock token একাধিক আইডিতে ব্যবহার করার কারণে এই অ্যাকাউন্টে ভিডিও অ্যাক্সেস ব্লক করা হয়েছে।</p>
              <button onClick={onClose} className="w-full py-2.5 rounded-xl gradient-primary text-primary-foreground font-semibold">Close Player</button>
            </div>
          </div>
        )}

        {/* Tutorial Video Modal */}
        {showTutorialVideo && tutorialLink && (
          <div className="fixed inset-0 z-[500] bg-black/95 flex items-center justify-center " onClick={() => setShowTutorialVideo(false)}>
            <div className="w-full max-w-xs mx-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-semibold text-foreground">📖 How to open my link</h3>
                <button onClick={() => setShowTutorialVideo(false)} className="w-8 h-8 rounded-full bg-foreground/20 flex items-center justify-center hover:bg-foreground/30">
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
        <div id="vp-download-block" />

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
            const downloadRoutes = buildPlaybackCandidates(qualitySrc, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined);
            const { downloadManager } = await import("@/lib/downloadManager");
            downloadManager.startDownload({
              id: dlId,
              url: downloadRoutes[0] || qualitySrc,
              urls: downloadRoutes,
              fallbackUrl: qualitySrc,
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
              <div className="relative hidden">

                {isAlreadySaved && !isDownloading && !isPaused ? (
                  /* Already downloaded - show play offline button */
                  <button
                    onClick={() => playOffline()}
                    className="relative w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 bg-primary text-primary-foreground"
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
                    className={`relative w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 overflow-hidden ${
                      isComplete
                        ? "bg-primary text-primary-foreground"
                        : isDownloading
                          ? "bg-secondary text-foreground border border-primary/30"
                          : isPaused
                            ? "bg-secondary text-foreground border border-accent/30"
                            : "gradient-primary text-primary-foreground btn-glow"
                    }`}
                  >
                    {isDownloading && dl && (
                      <div
                        className="absolute inset-0 gradient-primary opacity-80 ease-linear"
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
                      className="w-8 h-8 rounded-full bg-accent/80 hover:bg-accent flex items-center justify-center"
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
                      className="w-8 h-8 rounded-full bg-destructive/80 hover:bg-destructive flex items-center justify-center"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                )}
              </div>

              {/* Quality Picker Dropdown */}
              {showDownloadQualityPicker && (
                <div className="bg-card border border-border rounded-xl p-3 shadow-xl">
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
                          className={`py-2.5 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 ${
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
                        className={`w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-primary/10 ${
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

        {/* (Old duplicate Season+Episode list removed — Resources section above is canonical) */}


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
            }} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center hover:bg-destructive/80 ml-2">
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
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg bg-secondary/50 hover:bg-primary/10"
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

      {/* ============================================================
          MovieBox-style bottom sheets
          - Season picker
          - Language picker
          - Info sheet (poster + title + meta + description)
         ============================================================ */}

      {/* Season picker bottom sheet */}
      {showSeasonPicker && seasons && seasons.length > 0 && !isFullscreen && (
        <div
          className="fixed inset-0 z-[320] flex items-end justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowSeasonPicker(false)}
        >
          <div
            className="w-full max-w-2xl bg-background rounded-t-2xl border-t border-border shadow-2xl max-h-[70vh] flex flex-col animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
              <h3 className="text-base font-bold text-foreground">{seasons.length} season{seasons.length > 1 ? 's' : ''}</h3>
              <button onClick={() => setShowSeasonPicker(false)} className="w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 flex items-center justify-center">
                <X className="w-4 h-4 text-foreground" />
              </button>
            </div>
            <div className="px-4 pb-6 overflow-y-auto flex flex-col gap-2">
              {seasons.map((s, idx) => {
                const active = idx === (currentSeasonIdx ?? 0);
                return (
                  <button
                    key={idx}
                    onClick={() => { onSeasonChange?.(idx); setShowSeasonPicker(false); setShowAllEpisodes(false); }}
                    className={`w-full py-4 rounded-xl text-sm font-semibold transition-all ${
                      active
                        ? 'gradient-primary text-primary-foreground shadow-[0_4px_14px_-4px_hsla(355,85%,55%,0.5)]'
                        : 'bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border border-border'
                    }`}
                  >
                    {s.name || `Season ${String(idx + 1).padStart(2, '0')}`}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}



      {/* Download-only Season picker — completely isolated from the player */}
      {showDlSeasonPicker && dlSeasons && dlSeasons.length > 0 && !isFullscreen && (
        <div
          className="fixed inset-0 z-[320] flex items-end justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowDlSeasonPicker(false)}
        >
          <div
            className="w-full max-w-2xl bg-background rounded-t-2xl border-t border-border shadow-2xl max-h-[70vh] flex flex-col animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
              <h3 className="text-base font-bold text-foreground">Download season</h3>
              <button onClick={() => setShowDlSeasonPicker(false)} className="w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 flex items-center justify-center">
                <X className="w-4 h-4 text-foreground" />
              </button>
            </div>
            <div className="px-4 pb-6 overflow-y-auto flex flex-col gap-2">
              {dlSeasons.map((s, idx) => {
                const active = idx === dlSeasonIdx;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setDlSeasonIdx(idx);
                      setDlSelectedEpisodes(new Set());
                      setDlSelectedQuality(null);
                      setShowDlSeasonPicker(false);
                    }}
                    className={`w-full py-4 rounded-xl text-sm font-semibold transition-all ${
                      active
                        ? 'gradient-primary text-primary-foreground shadow-[0_4px_14px_-4px_hsla(355,85%,55%,0.5)]'
                        : 'bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border border-border'
                    }`}
                  >
                    {s.name || `Season ${String(idx + 1).padStart(2, '0')}`}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Download-only Language picker — isolated from the active player */}
      {showDlLangPicker && !isFullscreen && (
        <div
          className="fixed inset-0 z-[320] flex items-end justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowDlLangPicker(false)}
        >
          <div
            className="w-full max-w-2xl bg-background rounded-t-2xl border-t border-border shadow-2xl max-h-[70vh] flex flex-col animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
              <h3 className="text-base font-bold text-foreground">Download language</h3>
              <button onClick={() => setShowDlLangPicker(false)} className="w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 flex items-center justify-center">
                <X className="w-4 h-4 text-foreground" />
              </button>
            </div>
            <div className="px-4 pb-6 overflow-y-auto flex flex-col gap-2">
              {langList.length > 0 ? (
                langList.map((l) => {
                  const active = l.id === (dlActiveLang?.id);
                  return (
                    <button
                      key={l.id}
                      onClick={() => {
                        // Only update the download panel's own language —
                        // never touch the active player's language/episode.
                        setDlActiveLangId(l.id);
                        setDlSeasonIdx(0);
                        setDlSelectedEpisodes(new Set());
                        setDlSelectedQuality(null);
                        setShowDlLangPicker(false);
                      }}
                      className={`w-full py-4 rounded-xl text-sm font-semibold transition-all ${
                        active
                          ? 'gradient-primary text-primary-foreground shadow-[0_4px_14px_-4px_hsla(355,85%,55%,0.5)]'
                          : 'bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border border-border'
                      }`}
                    >
                      {l.name}{l.isDefault ? ' ★' : ''}
                    </button>
                  );
                })
              ) : (
                <>
                  <button
                    onClick={() => setShowDlLangPicker(false)}
                    className="w-full py-4 rounded-xl text-sm font-semibold gradient-primary text-primary-foreground shadow-[0_4px_14px_-4px_hsla(355,85%,55%,0.5)]"
                  >
                    {dlLangLabel || "Default"}
                  </button>
                  <p className="text-[11px] text-muted-foreground text-center mt-1">More dubs will appear when available.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}


      {/* Language picker bottom sheet */}
      {showLangPicker && currentLangLabel && !isFullscreen && (
        <div
          className="fixed inset-0 z-[320] flex items-end justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowLangPicker(false)}
        >
          <div
            className="w-full max-w-2xl bg-background rounded-t-2xl border-t border-border shadow-2xl max-h-[70vh] flex flex-col animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
              <h3 className="text-base font-bold text-foreground">Select language</h3>
              <button onClick={() => setShowLangPicker(false)} className="w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 flex items-center justify-center">
                <X className="w-4 h-4 text-foreground" />
              </button>
            </div>
            <div className="px-4 pb-6 overflow-y-auto flex flex-col gap-2">
              {hasMultipleLangs ? (
                langList.map((l) => {
                  const active = l.id === (activeLang?.id);
                  return (
                    <button
                      key={l.id}
                      onClick={() => {
                        if (l.id !== activeLang?.id) onLanguageChange?.(l.id);
                        setShowLangPicker(false);
                      }}
                      className={`w-full py-4 rounded-xl text-sm font-semibold transition-all ${
                        active
                          ? 'gradient-primary text-primary-foreground shadow-[0_4px_14px_-4px_hsla(355,85%,55%,0.5)]'
                          : 'bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border border-border'
                      }`}
                    >
                      {l.name}
                    </button>
                  );
                })
              ) : (
                <>
                  <button
                    onClick={() => setShowLangPicker(false)}
                    className="w-full py-4 rounded-xl text-sm font-semibold gradient-primary text-primary-foreground shadow-[0_4px_14px_-4px_hsla(355,85%,55%,0.5)]"
                  >
                    {currentLangLabel}
                  </button>
                  <p className="text-[11px] text-muted-foreground text-center mt-1">More dubs will appear when available.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* All episodes bottom sheet */}
      {showAllEpisodes && episodeList && episodeList.length > 0 && !isFullscreen && (
        <div
          className="fixed inset-0 z-[320] flex items-end justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowAllEpisodes(false)}
        >
          <div
            className="w-full max-w-2xl bg-background rounded-t-2xl border-t border-border shadow-2xl max-h-[78vh] flex flex-col animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-foreground/20" />
            </div>
            <div className="flex items-center justify-between px-5 pt-1 pb-3 flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-foreground truncate">
                  {seasons?.[currentSeasonIdx ?? 0]?.name || 'Episodes'}
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">{episodeList.length} episodes</p>
              </div>
              <button onClick={() => setShowAllEpisodes(false)} className="w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 flex items-center justify-center flex-shrink-0">
                <X className="w-4 h-4 text-foreground" />
              </button>
            </div>
            <div className="px-5 pb-6 overflow-y-auto">
              <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
                {episodeList.map((ep) => (
                  <button
                    key={ep.number}
                    onClick={() => { ep.onClick?.(); setShowAllEpisodes(false); }}
                    className={`aspect-square rounded-xl text-sm font-bold flex items-center justify-center transition-all active:scale-95 ${
                      ep.active
                        ? 'gradient-primary text-primary-foreground shadow-[0_4px_14px_-4px_hsla(355,85%,55%,0.55)] ring-2 ring-primary/30'
                        : 'bg-foreground/[0.06] text-foreground/85 border border-border hover:bg-foreground/10 hover:text-primary hover:border-primary/30'
                    }`}
                    aria-label={ep.title || `Episode ${ep.number}`}
                  >
                    {ep.number}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Info bottom sheet — MovieBox "More details" style */}
      {showInfoSheet && !isFullscreen && (
        <div
          className="fixed inset-0 z-[320] flex items-end justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowInfoSheet(false)}
        >
          <div
            className="w-full max-w-2xl bg-background rounded-t-2xl border-t border-border shadow-2xl max-h-[85vh] flex flex-col animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-foreground/20" />
            </div>
            <div className="px-5 pt-1 pb-3 flex items-center justify-between flex-shrink-0">
              <h3 className="text-base font-bold text-foreground">More details</h3>
              <button onClick={() => setShowInfoSheet(false)} className="w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 flex items-center justify-center">
                <X className="w-4 h-4 text-foreground" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-6">
              {/* Poster + title + meta row */}
              <div className="flex gap-3 items-start">
                {(animeMeta?.poster || poster) && (
                  <img
                    src={animeMeta?.poster || poster}
                    alt={animeMeta?.title || title}
                    className="w-[88px] h-[120px] rounded-lg object-cover flex-shrink-0 border border-border"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-foreground leading-snug">
                    {animeMeta?.title || title}
                  </h2>
                  <div className="flex items-center flex-wrap gap-1.5 mt-2 text-[12px] text-muted-foreground">
                    <Tv className="w-3.5 h-3.5 text-foreground/60" />
                    {animeMeta?.rating && (<><span className="text-foreground/25">|</span><span className="flex items-center gap-0.5"><Star className="w-3 h-3 text-primary fill-primary" />{animeMeta.rating}</span></>)}
                    {animeMeta?.year && (<><span className="text-foreground/25">|</span><span>{animeMeta.year}</span></>)}
                    {animeMeta?.language && (<><span className="text-foreground/25">|</span><span>{animeMeta.language}</span></>)}
                    {animeMeta?.type && (<><span className="text-foreground/25">|</span><span className="capitalize">{animeMeta.type}</span></>)}
                  </div>
                  {seasons && seasons.length > 0 && (
                    <p className="text-[12px] text-muted-foreground mt-1">
                      {seasons.length} season{seasons.length > 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <h4 className="text-sm font-bold text-foreground mb-2">Info</h4>
                {description ? (
                  <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
                    {description}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No description available.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default memo(VideoPlayer);
