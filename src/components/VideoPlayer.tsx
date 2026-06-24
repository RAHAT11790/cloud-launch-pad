import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import Hls from "hls.js";
import { useBranding } from "@/hooks/useBranding";
import { toast } from "sonner";
import AdsterraAdManager from "@/components/AdsterraAdManager";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, Settings, X, Lock, Unlock, ArrowLeft,
  ChevronRight, ChevronDown, FastForward, Rewind, Crop, Check, ExternalLink, Loader2, Download, PauseCircle, PlayCircle, Search, Server, Subtitles, Languages, Info, Star, Tv, Share2, Bookmark, FolderDown
} from "lucide-react";
import type { AnimeItem, Season } from "@/data/animeData";
import { db, ref, onValue, set, remove, update, get } from "@/lib/firebase";
import logoImg from "@/assets/logo.png";
import { createUnlockLinksForAllServices, createTelegramBotUnlockLink, getCurrentDeviceFreeAccessExpiry, getLocalUserId, isAdGateCooldownActive, markAdGateShownNow, type AdService } from "@/lib/unlockAccess";
import { isUnlockBlockActive } from "@/lib/unlockBlock";
import VideoEngagement from "@/components/VideoEngagement";
import { guestStore, isGuest } from "@/lib/guestStore";
import { optimizedImageUrl } from "@/lib/imageCache";
// Shortener / Unlock-gate master toggle — admin can disable from Firebase (settings/unlockGateEnabled).
// When OFF: free users get instant access, NO ad gate, NO unlock popup, NO verification flash.
const isShortenerEnabled = async (): Promise<boolean> => {
  try {
    const snap = await get(ref(db, "settings/unlockGateEnabled"));
    const v = snap.val();
    // Default true (gate ON) only when explicitly true or unset; explicit false = OFF.
    return v !== false;
  } catch {
    return true;
  }
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
import { downloadManager } from "@/lib/downloadManager";
import { buildVideoDownloadUrl, triggerBulkBackgroundDownloads } from "@/lib/videoDownload";
const CLOUDFLARE_CDN = CLOUDFLARE_CDN_URL;

// Built-in ultra-fast HTTPS streaming proxy (Supabase edge function).
// Auto-applied to plain http:// sources (e.g. Server 1 bot-hosting.net) to bypass
// browser mixed-content blocks. HTTPS sources stay direct (zero overhead).
const BUILTIN_STREAM_PROXY = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/video-proxy?url={url}`
  : "";

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

const isDataHlsUrl = (url: string): boolean => {
  const normalized = String(url || "").trim().toLowerCase();
  return normalized.startsWith("data:application/vnd.apple.mpegurl");
};

const isInsecureHttpSource = (url: string): boolean => {
  return String(url || "").trim().toLowerCase().startsWith("http://");
};

const isBypassSource = (url: string): boolean => {
  const normalized = String(url || "").trim().toLowerCase();
  return normalized.startsWith("blob:") || normalized.startsWith("data:") || normalized.startsWith("mediasource:");
};

const isManagedServerSource = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("onrender.com") || host.includes("hf.space") || host.includes("bot-hosting.net");
  } catch {
    return false;
  }
};

const VIDEO_MIRROR_ORIGINS = [
  "https://rahat1102-video-hosting-bot.hf.space",
  "http://fi3.bot-hosting.net:22854",
  "https://rs-stream-bot-1.onrender.com",
];

const buildManagedMirrorSources = (rawUrl: string): string[] => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.host.toLowerCase();
    if (!isManagedServerSource(rawUrl)) return [];
    return VIDEO_MIRROR_ORIGINS
      .filter((origin) => {
        try { return new URL(origin).host.toLowerCase() !== host; } catch { return false; }
      })
      .map((origin) => `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`);
  } catch {
    return [];
  }
};

const buildFallbackServers = (rawUrl: string): VideoServerOption[] => {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const canMirror = hostname.includes("bot-hosting.net") || /sttv|sttvs/.test(hostname);
    if (!canMirror) return [];

    const port = parsed.port ? `:${parsed.port}` : "";
    const protocol = parsed.protocol || "http:";
    const builtInMirrors = VIDEO_MIRROR_ORIGINS.map((domain, index) => ({
      name: index === 0 ? "RS FR 01" : index === 1 ? "RS FR 02" : "RS Backup",
      domain,
    }));
    const legacyMirrors = Array.from({ length: PROXY_SERVER_LIMIT }, (_, index) => ({
      name: `Server ${index + 1}`,
      domain: `${protocol}//fi${index + 1}.bot-hosting.net${port}`,
    }));
    return [...builtInMirrors, ...legacyMirrors].filter((server, index, all) =>
      all.findIndex((item) => item.domain === server.domain) === index,
    );
  } catch {
    return [];
  }
};

const buildPlaybackCandidates = (url: string, _cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string, preferProxy = false): string[] => {
  if (!url) return [];

  const candidates: string[] = [];
  const addCandidate = (candidate?: string | null) => {
    if (!candidate || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  if (isBypassSource(url)) {
    addCandidate(url);
    return candidates;
  }

  const isHttp = isInsecureHttpSource(url);
  const customProxyCandidate = proxyUrl ? buildProxyPlaybackUrl(proxyUrl, url, proxyApiKey) : null;
  const builtinProxyCandidate = BUILTIN_STREAM_PROXY ? buildProxyPlaybackUrl(BUILTIN_STREAM_PROXY, url) : null;

  // STRICT SERVER ISOLATION: each server in the admin panel uses ONLY its own
  // configured URL. We never silently mirror across servers — that previously
  // caused the "Premium" tab to play from a free origin when its own server
  // (e.g. Render) was down, hiding the failure. Per-server failover is handled
  // explicitly by switchServer() using the admin-defined server list.

  if (preferProxy) {
    // Live TV / fragile HLS streams should use the admin-selected proxy first,
    // then fall back to direct only if proxy is unavailable.
    if (customProxyCandidate) addCandidate(customProxyCandidate);
    if (builtinProxyCandidate) addCandidate(builtinProxyCandidate);
    addCandidate(url);
    return candidates;
  }

  if (isHttp) {
    // HTTP source — MUST use admin proxy only. No direct playback (mixed-content block).
    if (customProxyCandidate) addCandidate(customProxyCandidate);
    if (builtinProxyCandidate) addCandidate(builtinProxyCandidate);

    // If no proxy is configured, we have to fallback to the original URL but it will likely fail.
    if (candidates.length === 0) addCandidate(url);
  } else {
    // HTTPS source — direct first for speed, then proxy fallback for hosts that
    // block browser playback/CORS/hotlinking (Render, Hugging Face, etc.).
    addCandidate(url);
    if (customProxyCandidate) addCandidate(customProxyCandidate);
    if (builtinProxyCandidate) addCandidate(builtinProxyCandidate);
  }

  return candidates;
};

const getPrimaryPlaybackSrc = (url: string, cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string, preferProxy = false): string => {
  return buildPlaybackCandidates(url, cdnEnabled, proxyUrl, proxyApiKey, preferProxy)[0] || url;
};

const isDirectDownloadCandidate = (url: string): boolean => {
  const value = String(url || "").trim().toLowerCase();
  if (!value) return false;
  if (!(value.startsWith("http://") || value.startsWith("https://"))) return false;
  if (value.includes(".m3u8") || value.includes(".mpd")) return false;
  if (value.includes("/embed/") || value.includes("iframe")) return false;
  return true;
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
  hlsAudioIndex?: number; // If set, switch hls.js audio track
}

interface HlsSubtitleOption {
  id: number;
  label: string;
  language: string;
  url?: string;
}

interface VideoPlayerProps {
  src: string;
  title: string;
  subtitle?: string;
  poster?: string;
  anime?: AnimeItem;
  selectedLanguage?: string;
  onClose: () => void;
  onLanguageChange?: (language: string) => void;
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
  currentEpisodeIdx?: number;
  onSeasonChange?: (idx: number) => void;
  suggestedAnime?: AnimeItem[];
  onSuggestedClick?: (anime: AnimeItem) => void;
  nextEpisodeSrc?: string;
  forceEmbedMode?: boolean;
  initialSeekTime?: number;
  shareLink?: string;
  buildShareLinkForEpisode?: (seasonIdx?: number, epIdx?: number) => string;
  onInfoClick?: () => void;
  onLibraryClick?: (animeId?: string) => void;
  preferProxy?: boolean;
}

type DownloadEpisodeOption = {
  index: number;
  episodeNumber: number;
  title: string;
  metaText: string;
  qualityLinks: Record<string, string>;
};

const getShortSeasonLabel = (seasonName: string | undefined, index: number) => {
  const normalized = String(seasonName || "").trim();
  const explicitSeasonNumber = normalized.match(/season\s*(\d+)/i)?.[1];
  if (explicitSeasonNumber) return `Season ${String(explicitSeasonNumber).padStart(2, "0")}`;
  return `Season ${String(index + 1).padStart(2, "0")}`;
};

const buildEpisodeDownloadName = (animeTitle: string, seasonLabel: string | undefined, episodeNumber: number | undefined) => {
  const seasonPart = String(seasonLabel || "Season 01").trim();
  const episodePart = `Episode ${String(episodeNumber || 1).padStart(2, "0")}`;
  return [animeTitle, seasonPart, episodePart].map((part) => String(part || "").trim()).filter(Boolean).join(" - ");
};

const LANGUAGE_NAME_MAP: Record<string, string> = {
  hi: "Hindi", hin: "Hindi", hindi: "Hindi",
  en: "English", eng: "English", english: "English",
  ja: "Japanese", jp: "Japanese", jpn: "Japanese", japanese: "Japanese",
  bn: "Bengali", ben: "Bengali", bengali: "Bengali", bangla: "Bengali",
  ta: "Tamil", tam: "Tamil", tamil: "Tamil",
  te: "Telugu", tel: "Telugu", telugu: "Telugu",
  ml: "Malayalam", mal: "Malayalam", malayalam: "Malayalam",
  kn: "Kannada", kan: "Kannada", kannada: "Kannada",
  mr: "Marathi", mar: "Marathi", marathi: "Marathi",
  gu: "Gujarati", guj: "Gujarati", gujarati: "Gujarati",
  pa: "Punjabi", pan: "Punjabi", punjabi: "Punjabi",
  ur: "Urdu", urd: "Urdu", urdu: "Urdu",
  ko: "Korean", kor: "Korean", korean: "Korean",
  zh: "Chinese", chi: "Chinese", zho: "Chinese", chinese: "Chinese", mandarin: "Chinese",
  fr: "French", fra: "French", fre: "French", french: "French",
  de: "German", ger: "German", deu: "German", german: "German",
  es: "Spanish", spa: "Spanish", spanish: "Spanish",
  it: "Italian", ita: "Italian", italian: "Italian",
  pt: "Portuguese", por: "Portuguese", portuguese: "Portuguese",
  ru: "Russian", rus: "Russian", russian: "Russian",
  ar: "Arabic", ara: "Arabic", arabic: "Arabic",
  tr: "Turkish", tur: "Turkish", turkish: "Turkish",
};

export const normalizeLanguageName = (raw: string | undefined | null): string => {
  const s = String(raw || "").trim();
  if (!s) return "";
  const key = s.toLowerCase().replace(/[^a-z]/g, "");
  if (LANGUAGE_NAME_MAP[key]) return LANGUAGE_NAME_MAP[key];
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

const splitLanguageTokens = (value: string | undefined | null) => {
  const seen = new Set<string>();
  const out: string[] = [];
  String(value || "")
    .split(/[,/|]/)
    .map((item) => normalizeLanguageName(item))
    .filter(Boolean)
    .forEach((name) => {
      const k = name.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(name); }
    });
  return out;
};

const getPrimaryLanguageToken = (value: string | undefined | null) => splitLanguageTokens(value)[0] || "";

const collectDownloadQualityLinks = (
  primary?: { link?: string; link480?: string; link720?: string; link1080?: string; link4k?: string } | null,
  fallback?: { link?: string; link480?: string; link720?: string; link1080?: string; link4k?: string } | null,
) => {
  const map: Record<string, string> = {};
  const pushExplicit = (label: string, value?: string | null) => {
    const clean = String(value || "").trim();
    if (!clean || map[label]) return;
    map[label] = clean;
  };

  [primary, fallback].forEach((source) => {
    pushExplicit("480P", source?.link480);
    pushExplicit("720P", source?.link720);
    pushExplicit("1080P", source?.link1080);
    pushExplicit("4K", source?.link4k);
  });

  if (Object.keys(map).length === 0) {
    const defaultLink = [primary?.link, fallback?.link]
      .map((value) => String(value || "").trim())
      .find(Boolean);
    if (defaultLink) map.Default = defaultLink;
  }

  return map;
};

const formatTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const VideoPlayer = ({ src, title, subtitle, poster, anime, selectedLanguage, onClose, onLanguageChange, onNextEpisode, episodeList, qualityOptions, audioTracks: propAudioTracks, animeId, onSaveProgress, hideDownload, noProxy, noServerSwitch, seasons, currentSeasonIdx, currentEpisodeIdx, onSeasonChange, suggestedAnime, onSuggestedClick, nextEpisodeSrc, forceEmbedMode, initialSeekTime, shareLink, buildShareLinkForEpisode, onInfoClick, onLibraryClick, preferProxy = false }: VideoPlayerProps) => {
  const branding = useBranding();
  const playerLoaderLogo = branding.playerLogoUrl || branding.logoUrl;
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
  const downloadPanelRef = useRef<HTMLDivElement>(null);

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
  const [skipIndicator, setSkipIndicator] = useState<{ side: "left" | "right" | "center"; text: string; total?: number } | null>(null);
  const skipAccumRef = useRef<{ side: "left" | "right" | null; total: number; timer: ReturnType<typeof setTimeout> | null }>({ side: null, total: 0, timer: null });
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
  const [shareFallback, setShareFallback] = useState<{ url: string; title: string } | null>(null);

  // ===== AN iframe minimal overlay auto-hide =====
  // Buttons start visible, then auto-hide after 3s. Tapping the iframe area
  // toggles them (mirrors AN's own controls show/hide behaviour).
  const [showAnOverlay, setShowAnOverlay] = useState(true);
  const anOverlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAnOverlayHide = useCallback(() => {
    if (anOverlayTimer.current) clearTimeout(anOverlayTimer.current);
    anOverlayTimer.current = setTimeout(() => setShowAnOverlay(false), 3000);
  }, []);
  const toggleAnOverlay = useCallback(() => {
    setShowAnOverlay((prev) => {
      const next = !prev;
      if (anOverlayTimer.current) clearTimeout(anOverlayTimer.current);
      if (next) {
        anOverlayTimer.current = setTimeout(() => setShowAnOverlay(false), 3000);
      }
      return next;
    });
  }, []);


  // ===== SERVER CHANGER =====
  const [videoServers, setVideoServers] = useState<VideoServerOption[]>([]);
  const [activeServerIndex, setActiveServerIndex] = useState(0);
  const [manualServerSelected, setManualServerSelected] = useState(false);
  const [showServerPanel, setShowServerPanel] = useState(false);
  const premiumServerApplied = useRef(false);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/videoServers"), (snap) => {
      const val = snap.val();
      let servers: VideoServerOption[] = [];
      if (val && Array.isArray(val)) {
        servers = val.filter((s: any) => s && s.domain);
      } else if (val && typeof val === "object") {
        servers = Object.values(val).filter((s: any) => s && s.domain) as any[];
      }
      setVideoServers(servers);
    });
    return () => unsub();
  }, []);

  const isRawHlsSource = useMemo(() => /\.m3u8(\?|#|$)/i.test(String(src || "")), [src]);

  const effectiveVideoServers = useMemo(() => {
    if (noServerSwitch || isRawHlsSource) return [];
    const list = videoServers.length > 0 ? videoServers : buildFallbackServers(src);
    // Show ALL configured servers so the user can switch between them.
    return list;
  }, [isRawHlsSource, noServerSwitch, src, videoServers]);

  // ===== EMBED IFRAME BRIDGE (Server 2 / hf.space) =====
  // The branded `req.html` page on the embed server posts video events to us
  // and accepts commands (play/pause/seek/etc). We mirror those events into
  // a hidden HTMLVideoElement-like surface so the rest of the player UI
  // (progress bar, time display, server switcher, ad-gate, etc.) keeps
  // working unchanged.
  const sendEmbedCmd = useCallback((cmd: string, payload?: Record<string, unknown>) => {
    const w = embedIframeRef.current?.contentWindow;
    if (!w) return;
    try {
      w.postMessage({ target: "rs-embed", cmd, ...(payload || {}) }, "*");
    } catch { /* noop */ }
  }, []);

  // HLS / m3u8 detection — these MUST go through native <video>+hls.js, never iframe,
  // so the player controls (audio track / subtitle / quality / seek) keep working.
  const isHlsSrc = useMemo(
    () => !!currentSrc && (/\.m3u8(\?|#|$)/i.test(currentSrc) || isDataHlsUrl(currentSrc)),
    [currentSrc],
  );

  // Iframe playback is only for explicitly forced embed pages (AnimeSalt etc.).
  // RS direct servers, including hf.space/render HTTPS file URLs, must stay in
  // the native <video> element; loading those URLs in an iframe can trigger a
  // browser download instead of playback.
  const isEmbedPlayback = useMemo(
    () => !!currentSrc && !isHlsSrc && !!forceEmbedMode,
    [currentSrc, forceEmbedMode, isHlsSrc],
  );

  // Initial 3s show + iframe-tap detection via window blur (iframe steals focus
  // → window blurs). This mirrors AN's own controls open/close behaviour.
  useEffect(() => {
    if (!isEmbedPlayback) return;
    setShowAnOverlay(true);
    scheduleAnOverlayHide();
    const onBlur = () => {
      setTimeout(() => {
        if (document.activeElement?.tagName === "IFRAME") {
          toggleAnOverlay();
          (document.activeElement as HTMLElement)?.blur?.();
          window.focus();
        }
      }, 0);
    };
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      if (anOverlayTimer.current) clearTimeout(anOverlayTimer.current);
    };
  }, [isEmbedPlayback, scheduleAnOverlayHide, toggleAnOverlay]);

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


  
  // Load CDN + proxy settings from Firebase. noProxy keeps normal RS playback
  // direct, but Live TV can still pass preferProxy to use admin proxy first.
  useEffect(() => {
    if (noProxy && !preferProxy) {
      setCdnEnabled(false);
      setProxyUrl('');
      setProxyApiKey('');
      setPlaybackRouteReady(true);
      return;
    }

    // Wait for BOTH cdn + proxy snapshots before marking route ready,
    // so the first <video> src already uses the admin-configured proxy
    // and we don't trigger a wasted reload after Firebase resolves.
    let gotCdn = false;
    let gotProxy = false;
    const maybeReady = () => { if (gotCdn && gotProxy) setPlaybackRouteReady(true); };

    // Safety: never block playback longer than 1.2s waiting on Firebase.
    const safety = window.setTimeout(() => setPlaybackRouteReady(true), 1200);

    const unsub1 = onValue(ref(db, "settings/cdnEnabled"), (snap) => {
      const val = snap.val();
      setCdnEnabled(val !== false);
      gotCdn = true;
      maybeReady();
    });

    // Live TV uses a dedicated proxy (settings/liveTvProxy). Fall back to the
    // normal proxy (settings/proxyServer) when no Live TV proxy is configured.
    const proxyPath = preferProxy ? "settings/liveTvProxy" : "settings/proxyServer";
    const unsub2 = onValue(ref(db, proxyPath), (snap) => {
      const val = snap.val();
      if (val && val.url) {
        setProxyUrl(String(val.url));
        setProxyApiKey(String(val.apiKey || ''));
      } else if (preferProxy) {
        // No Live TV proxy set — fall back to the regular proxy so playback still works.
        get(ref(db, "settings/proxyServer")).then((s) => {
          const v = s.val();
          if (v && v.url) {
            setProxyUrl(String(v.url));
            setProxyApiKey(String(v.apiKey || ''));
          } else {
            setProxyUrl('');
            setProxyApiKey('');
          }
        }).catch(() => { setProxyUrl(''); setProxyApiKey(''); });
      } else {
        setProxyUrl('');
        setProxyApiKey('');
      }
      gotProxy = true;
      maybeReady();
    });

    return () => {
      window.clearTimeout(safety);
      unsub1();
      unsub2();
    };
  }, [noProxy, preferProxy, src]);
  const [isPremium, setIsPremium] = useState<boolean | null>(null); // null = loading
  const [adGateActive, setAdGateActive] = useState(false);
  const [adLinks, setAdLinks] = useState<{ service: AdService; shortUrl: string }[]>([]);
  const [shortenLoading, setShortenLoading] = useState(false);
  const [showQualityPanel, setShowQualityPanel] = useState(false);
  const [showDownloadQualityPicker, setShowDownloadQualityPicker] = useState(false);
  const [showInfoSheet, setShowInfoSheet] = useState(false);
  const [showLanguageSheet, setShowLanguageSheet] = useState(false);
  const [showSeasonSheet, setShowSeasonSheet] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [showAddToListSheet, setShowAddToListSheet] = useState(false);
  const [showLibrarySheet, setShowLibrarySheet] = useState(false);
  const [showAllEpisodesSheet, setShowAllEpisodesSheet] = useState(false);
  const [sheetOrigin, setSheetOrigin] = useState<"resource" | "download" | "share">("resource");
  const [downloadPanelSeasonIdx, setDownloadPanelSeasonIdx] = useState<number>(0);
  const [sharePanelSeasonIdx, setSharePanelSeasonIdx] = useState<number>(currentSeasonIdx ?? 0);
  const [sharePanelEpisodeIdx, setSharePanelEpisodeIdx] = useState<number>(0);
  const [dlSelectedEpisodes, setDlSelectedEpisodes] = useState<Set<number>>(new Set());
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<any[]>([]);
  const [saved, setSaved] = useState(() => (animeId ? guestStore.watchlist.has(animeId) : false));
  const [watchlistItems, setWatchlistItems] = useState<any[]>([]);
  const [bottomTab, setBottomTab] = useState<"foryou" | "comments">("foryou");
  // Tracks the suggestion the user just tapped so we can show instant feedback
  // (highlight on the card + a loading overlay on the player) until the new
  // anime's src actually mounts. Cleared when the player's `anime.id` changes.
  const [pendingSuggestion, setPendingSuggestion] = useState<AnimeItem | null>(null);
  useEffect(() => {
    // New anime loaded → clear the pending overlay. Small delay lets the
    // buffering loader take over seamlessly.
    if (!pendingSuggestion) return;
    if (anime?.id && anime.id !== pendingSuggestion.id) return; // wait for switch
    if (anime?.id === pendingSuggestion.id) {
      const t = window.setTimeout(() => setPendingSuggestion(null), 250);
      return () => window.clearTimeout(t);
    }
  }, [anime?.id, pendingSuggestion]);
  // Safety: never let the pending overlay get stuck.
  useEffect(() => {
    if (!pendingSuggestion) return;
    const t = window.setTimeout(() => setPendingSuggestion(null), 8000);
    return () => window.clearTimeout(t);
  }, [pendingSuggestion]);
  const [commentCount, setCommentCount] = useState(0);
  const [selectedLanguageLabel, setSelectedLanguageLabel] = useState<string>("");
  const [selectedDownloadLanguageLabel, setSelectedDownloadLanguageLabel] = useState<string>("");
  const [selectedDownloadQuality, setSelectedDownloadQuality] = useState<string>("");
  const [downloadSizeCache, setDownloadSizeCache] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem("rs_dl_size_cache_v1");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  
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
  const [activeDownloads, setActiveDownloads] = useState<Map<string, any>>(new Map());
  const [globalFreeAccess, setGlobalFreeAccess] = useState<boolean>(false);
  const [deviceBlocked, setDeviceBlocked] = useState(false);
  const [deviceBlockInfo, setDeviceBlockInfo] = useState<{ maxDevices: number; currentCount: number } | null>(null);
  const [userFreeAccessExpiresAt, setUserFreeAccessExpiresAt] = useState(0);
  const [freeAccessLoaded, setFreeAccessLoaded] = useState(false); // prevents unlock-button flash before Firebase responds
  const [unlockBlocked, setUnlockBlocked] = useState(false);
  const activeEpisodeIdx = useMemo(() => {
    const idx = episodeList?.findIndex((episode) => episode.active) ?? -1;
    return idx >= 0 ? idx : 0;
  }, [episodeList]);

  const animeMeta = useMemo(() => {
    const match = title.match(/^(.*?)(?:\s*[—-]\s*(.+))?$/);
    return {
      title,
      poster,
      rating: undefined as string | number | undefined,
      year: undefined as string | number | undefined,
      language: undefined as string | undefined,
      type: undefined as string | undefined,
      subtitleLabel: match?.[2] || subtitle,
    };
  }, [poster, subtitle, title]);

  const isAnimeSaltContent = useMemo(
    () => anime?.source === "animesalt" || String(anime?.id || "").startsWith("as_"),
    [anime?.id, anime?.source],
  );

  const currentLangLabel = useMemo(() => {
    // AnimeSalt: before HLS exposes tracks, fall back to the real available
    // track list only — never invent a language pill that does not exist.
    if (isAnimeSaltContent && propAudioTracks?.length) {
      if (selectedLanguageLabel) {
        const match = propAudioTracks.find((t) => {
          const lbl = getPrimaryLanguageToken(t.label || t.language || "") || "";
          return lbl.toLowerCase() === selectedLanguageLabel.trim().toLowerCase();
        });
        if (match) return getPrimaryLanguageToken(match.label || match.language || "") || selectedLanguageLabel;
      }
      const hindi = propAudioTracks.find((t) =>
        /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${t.language || ""} ${t.label || ""}`),
      );
      const pick = hindi || propAudioTracks[0];
      return getPrimaryLanguageToken(pick.label || pick.language || "") || pick.label || pick.language || "Hindi";
    }
    if (selectedLanguageLabel) return selectedLanguageLabel;
    if (selectedLanguage) return getPrimaryLanguageToken(selectedLanguage) || selectedLanguage;
    const explicit = propAudioTracks?.[0]?.language || propAudioTracks?.[0]?.label;
    if (explicit) return getPrimaryLanguageToken(explicit) || explicit;
    const fallback = getPrimaryLanguageToken(anime?.baseLanguage || anime?.language);
    if (fallback) return fallback;
    return "Unknown";
  }, [anime?.baseLanguage, anime?.language, isAnimeSaltContent, propAudioTracks, selectedLanguage, selectedLanguageLabel]);


  const languageOptions = useMemo(() => {
    const labels = new Set<string>();
    const add = (raw: string | undefined | null) => {
      splitLanguageTokens(raw).forEach((l) => labels.add(l));
    };
    if (isAnimeSaltContent) {
      (propAudioTracks || []).forEach((track) => add(String(track.label || track.language || "")));
    } else {
      add(anime?.baseLanguage || anime?.language);
      (anime?.availableLanguages || []).forEach((label) => add(label));
      if (anime?.seasonsByLanguage && typeof anime.seasonsByLanguage === "object") {
        Object.keys(anime.seasonsByLanguage).forEach((k) => add(k));
      }
      (propAudioTracks || []).forEach((track) => add(String(track.label || track.language || "")));
    }
    if (labels.size === 0 && currentLangLabel) add(currentLangLabel);
    // Sort: Hindi first, then alphabetical
    return Array.from(labels).sort((a, b) => {
      const ah = a.toLowerCase() === "hindi" ? 0 : 1;
      const bh = b.toLowerCase() === "hindi" ? 0 : 1;
      if (ah !== bh) return ah - bh;
      return a.localeCompare(b);
    });
  }, [anime?.availableLanguages, anime?.baseLanguage, anime?.language, anime?.seasonsByLanguage, currentLangLabel, isAnimeSaltContent, propAudioTracks]);

  const activeSeasonLabel = useMemo(() => getShortSeasonLabel(seasons?.[currentSeasonIdx ?? 0]?.name, currentSeasonIdx ?? 0), [currentSeasonIdx, seasons]);

  const normalizedLanguageTracks = useMemo(() => {
    const fallbackLanguage = String(anime?.baseLanguage || anime?.language || "").trim() || currentLangLabel;
    const baseTrack = {
      language: fallbackLanguage,
      label: fallbackLanguage,
      link: src,
      link480: anime?.movieLink480,
      link720: anime?.movieLink720,
      link1080: anime?.movieLink1080,
      link4k: anime?.movieLink4k,
    };
    const pool = [baseTrack, ...(propAudioTracks || [])];
    const unique = new Map<string, typeof baseTrack>();
    pool.forEach((track) => {
      const label = getPrimaryLanguageToken(track.label || track.language || fallbackLanguage) || fallbackLanguage;
      if (!label || unique.has(label.toLowerCase())) return;
      unique.set(label.toLowerCase(), {
        language: getPrimaryLanguageToken(track.language || label) || label,
        label,
        link: String(track.link || src || "").trim(),
        link480: track.link480,
        link720: track.link720,
        link1080: track.link1080,
        link4k: track.link4k,
      });
    });
    return Array.from(unique.values());
  }, [anime?.baseLanguage, anime?.language, anime?.movieLink1080, anime?.movieLink4k, anime?.movieLink480, anime?.movieLink720, currentLangLabel, propAudioTracks, src]);

  const activeLanguageTrack = useMemo(() => {
    const selectedKey = currentLangLabel.trim().toLowerCase();
    return normalizedLanguageTracks.find((track) => track.label.trim().toLowerCase() === selectedKey)
      || normalizedLanguageTracks[0]
      || null;
  }, [currentLangLabel, normalizedLanguageTracks]);

  const currentDownloadLanguageLabel = useMemo(() => {
    if (selectedDownloadLanguageLabel) return selectedDownloadLanguageLabel;
    return currentLangLabel;
  }, [currentLangLabel, selectedDownloadLanguageLabel]);

  const primarySeriesLanguageLabel = useMemo(() => {
    return getPrimaryLanguageToken(anime?.language) || normalizedLanguageTracks[0]?.label || currentLangLabel;
  }, [anime?.language, currentLangLabel, normalizedLanguageTracks]);

  const activeDownloadLanguageTrack = useMemo(() => {
    const selectedKey = currentDownloadLanguageLabel.trim().toLowerCase();
    return normalizedLanguageTracks.find((track) => track.label.trim().toLowerCase() === selectedKey)
      || normalizedLanguageTracks[0]
      || null;
  }, [currentDownloadLanguageLabel, normalizedLanguageTracks]);

  const movieQualityLinks = useMemo(() => {
    const fallbackTrack = normalizedLanguageTracks[0] || null;
    return collectDownloadQualityLinks(
      fallbackTrack,
      {
        link: anime?.movieLink || src,
        link480: anime?.movieLink480,
        link720: anime?.movieLink720,
        link1080: anime?.movieLink1080,
        link4k: anime?.movieLink4k,
      },
    );
  }, [anime?.movieLink, anime?.movieLink1080, anime?.movieLink4k, anime?.movieLink480, anime?.movieLink720, normalizedLanguageTracks, src]);

  const infoCast = useMemo(() => {
    if (!anime?.cast?.length) return [];
    return anime.cast.filter((person) => person?.name || person?.character || person?.photo).slice(0, 12);
  }, [anime]);

  const infoMetaItems = useMemo(() => {
    const items = [
      anime?.rating ? `★ ${anime.rating}` : "",
      anime?.year ? String(anime.year) : "",
      anime?.category ? String(anime.category) : "",
      anime?.type === "webseries" ? "Anime" : "Movie",
    ].filter(Boolean);
    return items;
  }, [anime?.category, anime?.rating, anime?.type, anime?.year]);

  const downloadLanguageChoices = useMemo(() => {
    const labels = new Set<string>();
    normalizedLanguageTracks.forEach((track) => {
      const label = String(track.label || track.language || "").trim();
      if (label) labels.add(label);
    });
    return Array.from(labels);
  }, [normalizedLanguageTracks]);

  const getTrackQualityLinks = useCallback((
    primary?: { link?: string; link480?: string; link720?: string; link1080?: string; link4k?: string } | null,
    fallback?: { link?: string; link480?: string; link720?: string; link1080?: string; link4k?: string } | null,
  ) => collectDownloadQualityLinks(primary, fallback), []);

  const getEpisodeDownloadLinksForLanguage = useCallback((ep: any, languageLabel: string) => {
    const selectedKey = String(languageLabel || "").trim().toLowerCase();
    const baseKey = String(primarySeriesLanguageLabel || "").trim().toLowerCase();
    const matchingTrack = ep?.audioTracks?.find((entry: any) => {
      const trackLabel = String(entry?.label || entry?.language || "").trim().toLowerCase();
      return !!trackLabel && trackLabel === selectedKey;
    });

    if (matchingTrack) {
      return getTrackQualityLinks(matchingTrack, selectedKey === baseKey ? ep : null);
    }

    if (selectedKey === baseKey) {
      return getTrackQualityLinks(undefined, ep);
    }

    return {};
  }, [getTrackQualityLinks, primarySeriesLanguageLabel]);

  const availableDownloadQualities = useMemo(() => {
    const season = seasons?.[downloadPanelSeasonIdx];
    if (season?.episodes?.length) {
      const qualitySet = new Set<string>();
      season.episodes.forEach((ep: any) => {
        Object.keys(getEpisodeDownloadLinksForLanguage(ep, currentDownloadLanguageLabel)).forEach((quality) => qualitySet.add(quality));
      });
      return ["Default", "480P", "720P", "1080P", "4K"].filter((quality) => qualitySet.has(quality));
    }
    const movieQualities = Object.keys(collectDownloadQualityLinks(activeDownloadLanguageTrack, {
      link: anime?.movieLink || src,
      link480: anime?.movieLink480,
      link720: anime?.movieLink720,
      link1080: anime?.movieLink1080,
      link4k: anime?.movieLink4k,
    }));
    return movieQualities.length > 0 ? movieQualities : Object.keys(movieQualityLinks);
  }, [activeDownloadLanguageTrack, anime?.movieLink, anime?.movieLink1080, anime?.movieLink4k, anime?.movieLink480, anime?.movieLink720, currentDownloadLanguageLabel, downloadPanelSeasonIdx, getEpisodeDownloadLinksForLanguage, movieQualityLinks, seasons, src]);

  const downloadEpisodes = useMemo<DownloadEpisodeOption[]>(() => {
    const season = seasons?.[downloadPanelSeasonIdx];
    if (!season?.episodes?.length) return [];
    return season.episodes.map((ep: any, index: number) => {
      const qualityLinks = getEpisodeDownloadLinksForLanguage(ep, currentDownloadLanguageLabel);
      return {
        index,
        episodeNumber: ep.episodeNumber || index + 1,
        title: ep.title || `Episode ${ep.episodeNumber || index + 1}`,
        metaText: ep.title ? ep.title : `Episode ${ep.episodeNumber || index + 1}`,
        qualityLinks,
      };
    });
  }, [currentDownloadLanguageLabel, downloadPanelSeasonIdx, getEpisodeDownloadLinksForLanguage, seasons]);

  const preferredDownloadQuality = useMemo(() => {
    return ["Default", "480P", "720P", "1080P", "4K"].find((quality) => availableDownloadQualities.includes(quality))
      || availableDownloadQualities[0]
      || "";
  }, [availableDownloadQualities]);

  const shareSeason = useMemo(() => {
    return seasons?.[sharePanelSeasonIdx] || null;
  }, [seasons, sharePanelSeasonIdx]);

  const shareEpisodes = useMemo(() => {
    if (!shareSeason?.episodes?.length) return [];
    return shareSeason.episodes.map((episode, index) => ({
      index,
      number: episode.episodeNumber || index + 1,
      title: episode.title || `Episode ${episode.episodeNumber || index + 1}`,
      active: index === activeEpisodeIdx && sharePanelSeasonIdx === (currentSeasonIdx ?? 0),
    }));
  }, [activeEpisodeIdx, currentSeasonIdx, sharePanelSeasonIdx, shareSeason]);

  useEffect(() => {
    if (!animeId) return;
    if (isGuest()) {
      setSaved(guestStore.watchlist.has(animeId));
      return;
    }
    const uid = getLocalUserId();
    if (!uid) {
      setSaved(guestStore.watchlist.has(animeId));
      return;
    }
    const unsub = onValue(ref(db, `users/${uid}/watchlist/${animeId}`), (snap) => {
      setSaved(snap.exists());
    });
    return () => unsub();
  }, [animeId]);

  useEffect(() => {
    if (isGuest()) {
      const items = guestStore.watchlist.list().slice().sort((a, b) => Number(b?.addedAt || 0) - Number(a?.addedAt || 0));
      setWatchlistItems(items);
      return;
    }

    const uid = getLocalUserId();
    if (!uid) {
      setWatchlistItems(guestStore.watchlist.list());
      return;
    }

    const unsub = onValue(ref(db, `users/${uid}/watchlist`), (snap) => {
      const data = snap.val();
      const items = Array.isArray(data) ? data : data && typeof data === "object" ? Object.values(data) : [];
      setWatchlistItems(items.sort((a: any, b: any) => Number(b?.addedAt || 0) - Number(a?.addedAt || 0)));
    });
    return () => unsub();
  }, [animeId, saved]);

  useEffect(() => {
    if (isAnimeSaltContent && propAudioTracks?.length) {
      setSelectedLanguageLabel((existing) => {
        const existingToken = getPrimaryLanguageToken(existing);
        if (existingToken && propAudioTracks.some((t) => {
          const label = getPrimaryLanguageToken(t.label || t.language || "") || "";
          return label.toLowerCase() === existingToken.toLowerCase();
        })) return existing;
        const preferred = getPrimaryLanguageToken(selectedLanguage);
        const preferredMatch = preferred
          ? propAudioTracks.find((t) => {
              const label = getPrimaryLanguageToken(t.label || t.language || "") || "";
              return label.toLowerCase() === preferred.toLowerCase();
            })
          : null;
        const hindi = propAudioTracks.find((t) =>
          /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${t.language || ""} ${t.label || ""}`),
        );
        const pick = preferredMatch || hindi || propAudioTracks[0];
        const nextLabel = getPrimaryLanguageToken(pick.label || pick.language || "") || pick.label || pick.language || "";
        return nextLabel || existing;
      });
      return;
    }
    // RS / non-AN: trust the parent-supplied selectedLanguage prop.
    // Use functional setState so this effect does NOT depend on
    // selectedLanguageLabel — that dep used to create a self-firing loop
    // (set label → re-run effect → set label again → flash Hindi/English).
    const nextLabel =
      getPrimaryLanguageToken(selectedLanguage || anime?.baseLanguage || anime?.language) ||
      propAudioTracks?.[0]?.label ||
      propAudioTracks?.[0]?.language ||
      "";
    if (!nextLabel) return;
    setSelectedLanguageLabel((prev) => (prev === nextLabel ? prev : nextLabel));
  }, [anime?.baseLanguage, anime?.language, isAnimeSaltContent, propAudioTracks, selectedLanguage]);

  useEffect(() => {
    if (!normalizedLanguageTracks.length) {
      setSelectedLanguageLabel((prev) => (prev === "" ? prev : ""));
      return;
    }
    setSelectedLanguageLabel((prev) => {
      const stillExists = normalizedLanguageTracks.some(
        (track) => track.label.trim().toLowerCase() === prev.trim().toLowerCase(),
      );
      if (stillExists) return prev;
      // Prefer the parent-supplied language before falling back to tracks[0],
      // otherwise RS would flip to whatever happens to be first in the list.
      const preferred = getPrimaryLanguageToken(selectedLanguage);
      if (preferred) {
        const match = normalizedLanguageTracks.find(
          (t) => t.label.trim().toLowerCase() === preferred.toLowerCase(),
        );
        if (match) return match.label;
      }
      return normalizedLanguageTracks[0]?.label || normalizedLanguageTracks[0]?.language || "";
    });
  }, [normalizedLanguageTracks, selectedLanguage]);

  useEffect(() => {
    const nextSeasonIdx = currentSeasonIdx ?? 0;
    setDownloadPanelSeasonIdx(nextSeasonIdx);
  }, [currentSeasonIdx]);

  useEffect(() => {
    setSharePanelSeasonIdx(currentSeasonIdx ?? 0);
  }, [currentSeasonIdx]);

  useEffect(() => {
    setSharePanelEpisodeIdx(activeEpisodeIdx);
  }, [activeEpisodeIdx]);

  useEffect(() => {
    if (!availableDownloadQualities.length) {
      setSelectedDownloadQuality("");
      return;
    }
    if (!selectedDownloadQuality || !availableDownloadQualities.includes(selectedDownloadQuality)) {
      setSelectedDownloadQuality(preferredDownloadQuality);
    }
  }, [availableDownloadQualities, preferredDownloadQuality, selectedDownloadQuality]);

  // Probe file sizes for download picker — parallel HEAD with localStorage persistence
  useEffect(() => {
    if (!showDownloadQualityPicker) return;
    const quality = selectedDownloadQuality;
    if (!quality) return;
    const urls: string[] = [];
    downloadEpisodes.forEach((ep) => {
      const u = ep.qualityLinks[quality];
      if (u && !downloadSizeCache[u]) urls.push(u);
    });
    if (!urls.length) return;
    let cancelled = false;
    const probe = async (u: string): Promise<[string, number] | null> => {
      const proxied = buildVideoDownloadUrl(u, "probe.mp4");
      if (!proxied) return null;
      try {
        const r = await fetch(proxied, { method: "HEAD" });
        const len = Number(r.headers.get("content-length") || 0);
        if (len > 0) return [u, len];
      } catch {}
      try {
        const r2 = await fetch(proxied, { method: "GET", headers: { Range: "bytes=0-0" } });
        const cr = r2.headers.get("content-range");
        if (cr) {
          const m = /\/(\d+)\s*$/.exec(cr);
          if (m) return [u, Number(m[1])];
        }
        const len = Number(r2.headers.get("content-length") || 0);
        if (len > 0) return [u, len];
      } catch {}
      return null;
    };
    (async () => {
      // Parallel probes (max 6 at a time) for fast size reveal
      const chunk = 6;
      for (let i = 0; i < urls.length; i += chunk) {
        if (cancelled) return;
        const results = await Promise.all(urls.slice(i, i + chunk).map(probe));
        if (cancelled) return;
        const updates = results.filter(Boolean) as [string, number][];
        if (!updates.length) continue;
        setDownloadSizeCache((prev) => {
          const next = { ...prev };
          updates.forEach(([u, n]) => { if (!next[u]) next[u] = n; });
          try { localStorage.setItem("rs_dl_size_cache_v1", JSON.stringify(next)); } catch {}
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
  }, [showDownloadQualityPicker, selectedDownloadQuality, downloadEpisodes, downloadSizeCache]);


  useEffect(() => {
    if (!animeId) return;
    return onValue(ref(db, `comments/${animeId}`), (snap) => {
      const data = snap.val();
      setCommentCount(data && typeof data === "object" ? Object.keys(data).length : 0);
    });
  }, [animeId]);

  const closeInlineSheets = useCallback(() => {
    setShowInfoSheet(false);
    setShowLanguageSheet(false);
    setShowSeasonSheet(false);
    setShowShareSheet(false);
    setShowAddToListSheet(false);
    setShowLibrarySheet(false);
    setShowDownloadQualityPicker(false);
    setShowAllEpisodesSheet(false);
    setSheetOrigin("resource");
  }, []);

  const openInlineSheet = useCallback((sheet: "info" | "language" | "season" | "download" | "library" | "share" | "addToList" | "allEpisodes", origin: "resource" | "download" | "share" = "resource") => {
    if (sheet === "download") {
      const initialSeasonIdx = currentSeasonIdx ?? 0;
      const activeIdx = episodeList?.findIndex((episode) => episode.active) ?? -1;
      setDownloadPanelSeasonIdx(initialSeasonIdx);
      setSelectedDownloadLanguageLabel(currentLangLabel);
      setDlSelectedEpisodes(activeIdx >= 0 ? new Set([activeIdx]) : new Set());
      setSelectedDownloadQuality(preferredDownloadQuality);
    }
    setShowInfoSheet(sheet === "info");
    setShowLanguageSheet(sheet === "language");
    setShowSeasonSheet(sheet === "season");
    setShowShareSheet(sheet === "share");
    setShowAddToListSheet(sheet === "addToList");
    setShowLibrarySheet(sheet === "library");
    setShowDownloadQualityPicker(sheet === "download");
    setShowAllEpisodesSheet(sheet === "allEpisodes");
    setSheetOrigin(origin);
  }, [currentLangLabel, currentSeasonIdx, episodeList, preferredDownloadQuality]);

  const handleInlineSheetClose = useCallback((event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    closeInlineSheets();
  }, [closeInlineSheets]);

  const inlineSheetOpen = showInfoSheet || showLanguageSheet || showSeasonSheet || showShareSheet || showAddToListSheet || showLibrarySheet || showDownloadQualityPicker || showAllEpisodesSheet;

  // Track the bottom edge of the video player so inline overlays (Info / Library /
  // Language / Season / Download) can be anchored *just below* the player and
  // cover everything underneath (For You, Comments, Resources strip, etc).
  const [videoBottomPx, setVideoBottomPx] = useState(0);
  useEffect(() => {
    const el = videoContainerRef.current;
    if (!el) return;
    let raf = 0;
    let last = -1;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const v = Math.max(0, Math.round(rect.bottom));
      if (v !== last) { last = v; setVideoBottomPx(v); }
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("orientationchange", schedule, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, []);

  // When any inline overlay opens, snap the outer scroll back to the top so the
  // fixed overlay aligns precisely with the player's bottom edge.
  useEffect(() => {
    if (inlineSheetOpen && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [inlineSheetOpen]);

  const inlineSheetFixedClass =
    "fixed left-0 right-0 bottom-0 z-[260] border-t border-white/10 bg-black text-white overflow-y-auto overscroll-contain";
  const inlineSheetStyle = { top: videoBottomPx } as React.CSSProperties;

  useEffect(() => {
    const unsub = downloadManager.subscribe((snapshot) => {
      setActiveDownloads(new Map(snapshot.downloads));
    });
    return () => unsub?.();
  }, []);

  // Check IndexedDB for already downloaded episodes matching this title
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      import("@/lib/downloadStore").then(({ getAllDownloads }) => {
        getAllDownloads().then((all) => {
          if (cancelled) return;
          const matching = all.filter(d => d.title === title);
          const epNum = (s?: string) => {
            const m = String(s || "").match(/episode\s*(\d+)|ep\s*(\d+)|\b(\d+)\b/i);
            return m ? parseInt(m[1] || m[2] || m[3], 10) : 9999;
          };
          matching.sort((a, b) => epNum(a.subtitle) - epNum(b.subtitle));
          setDownloadedEpisodes(matching);
        });
      });
    };
    refresh();
    return () => { cancelled = true; };
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

    const unsubAccess = onValue(ref(db, `users/${uid}/freeAccess`), (snap) => {
      const data = snap.val();
      if (data?.active && Number(data.expiresAt) > Date.now()) {
        setUserFreeAccessExpiresAt(getCurrentDeviceFreeAccessExpiry(data));
      } else {
        setUserFreeAccessExpiresAt(0);
      }
      setFreeAccessLoaded(true);
    }, () => {
      // On error, mark loaded so UI doesn't hang forever
      setFreeAccessLoaded(true);
    });

    const unsubBlocked = onValue(ref(db, `users/${uid}/security/unlockBlocked`), (snap) => {
      setUnlockBlocked(isUnlockBlockActive(snap.val()));
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
    if (isPremium === null) return; // still loading premium status
    if (!freeAccessLoaded) return; // wait for Firebase freeAccess snapshot — prevents unlock-button flash
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

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
    if (isAdGateCooldownActive()) {
      setAdGateActive(false);
      return;
    }
    // Shortener master toggle: if admin disabled it, give free users instant access
    isShortenerEnabled().then((on) => {
      if (!on) { setAdGateActive(false); return; }
      // No access - block video and show ad gate
      markAdGateShownNow();
      setAdGateActive(true);
      setShortenLoading(true);
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        setShortenLoading(false);
        setAdGateActive(false);
      }, 2000);
      createUnlockLinksForAllServices().then((result) => {
        if (cancelled) return;
        if (timeoutId) clearTimeout(timeoutId);
        setShortenLoading(false);
        if (result.ok && result.links.length > 0) setAdLinks(result.links);
        else setAdGateActive(false);
      }).catch(() => {
        if (cancelled) return;
        if (timeoutId) clearTimeout(timeoutId);
        setShortenLoading(false);
        setAdGateActive(false);
      });
    });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isPremium, has24hAccess, unlockBlocked, freeAccessLoaded]);

  const handleToggleWatchlist = useCallback(() => {
    if (!animeId) {
      toast.error("Cannot save this item right now.");
      return;
    }

    const payload = {
      id: animeId,
      title,
      poster,
      addedAt: Date.now(),
    };

    if (isGuest()) {
      const nowSaved = guestStore.watchlist.toggle(payload);
      setSaved(nowSaved);
      toast.success(nowSaved ? "Saved to My List" : "Removed from My List");
      return;
    }

    const uid = getLocalUserId();
    if (!uid) {
      const nowSaved = guestStore.watchlist.toggle(payload);
      setSaved(nowSaved);
      return;
    }

    if (saved) {
      remove(ref(db, `users/${uid}/watchlist/${animeId}`)).catch(() => {});
      setSaved(false);
      toast.success("Removed from My List");
      return;
    }

    set(ref(db, `users/${uid}/watchlist/${animeId}`), payload).catch(() => {});
    setSaved(true);
    toast.success("Saved to My List");
  }, [animeId, poster, saved, title]);

  const handleShare = useCallback(async (seasonIdx?: number, epIdx?: number) => {
    const hasEpisodeContext = seasonIdx !== undefined || epIdx !== undefined;
    const url = hasEpisodeContext
      ? buildShareLinkForEpisode?.(seasonIdx, epIdx) || shareLink || (typeof window !== "undefined" ? window.location.href : "")
      : shareLink || (typeof window !== "undefined" ? window.location.href : "");
    const shareTitle = hasEpisodeContext
      ? `${title} • S${String((seasonIdx ?? 0) + 1).padStart(2, "0")} E${String((epIdx ?? 0) + 1).padStart(2, "0")}`
      : title;
    const shareData = { title: shareTitle, text: shareTitle, url };
    try {
      const nav: any = navigator;
      if (nav?.share && (!nav.canShare || nav.canShare(shareData))) {
        await nav.share(shareData);
        return;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
    }
    // No native share API — open a custom share menu (Telegram / WhatsApp / FB / X / Copy)
    setShareFallback({ url, title: shareTitle });
  }, [buildShareLinkForEpisode, shareLink, title]);

  const handleOpenAdLink = useCallback(async (url: string, _service?: AdService) => {
    const { openExternalBrowser, openTelegramDeepLink } = await import("@/lib/openExternal");
    try {
      const fb = await import("@/lib/firebase");
      const { createTelegramBotUnlockLink } = await import("@/lib/unlockAccess");
      const r = await createTelegramBotUnlockLink();
      if (r.ok && r.deepLink) {
        openTelegramDeepLink(r.deepLink);
        return;
      }

      const botSnap = await fb.get(fb.ref(fb.db, "settings/telegramVerifyBotUsername"));
      const botUsername = String(botSnap.val() || "").replace(/^@/, "").trim();
      window.location.href = `https://t.me/${botUsername}`;
      return;
    } catch {}
    if (url) {
      openExternalBrowser(url);
    }
  }, []);

  // Save progress for both native video and embed playback.
  useEffect(() => {
    if (!onSaveProgress) return;
    const v = videoRef.current;
    const saveNow = () => {
      if (isEmbedPlayback) {
        const cur = embedTimeRef.current.currentTime || 0;
        const dur = embedTimeRef.current.duration || 0;
        if (cur > 0 && dur > 0) onSaveProgress(cur, dur);
        return;
      }
      if (v && v.currentTime > 0 && v.duration > 0) {
        onSaveProgress(v.currentTime, v.duration);
      }
    };

    const saveInterval = setInterval(saveNow, 5000);
    if (v) v.addEventListener("pause", saveNow);
    window.addEventListener("pagehide", saveNow);

    return () => {
      clearInterval(saveInterval);
      if (v) v.removeEventListener("pause", saveNow);
      window.removeEventListener("pagehide", saveNow);
      saveNow();
    };
  }, [currentSrc, isEmbedPlayback, onSaveProgress]);

  // Restore watch position (per-account)
  useEffect(() => {
    if (!animeId) return;
    pendingSeek.current = typeof initialSeekTime === "number" ? Math.max(0, initialSeekTime) : 0;
    if (typeof initialSeekTime === "number" && initialSeekTime > 0) {
      pendingSeek.current = initialSeekTime;
    }
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
            const hasExplicitResume = typeof initialSeekTime === "number" && initialSeekTime > 0;
            const storedSeasonIdx = data?.episodeInfo?.seasonIdx ?? (typeof data?.episodeInfo?.season === "number" ? data.episodeInfo.season - 1 : undefined);
            const storedEpisodeIdx = data?.episodeInfo?.epIdx ?? (typeof data?.episodeInfo?.episode === "number" ? data.episodeInfo.episode - 1 : undefined);
            const episodeMatches = currentSeasonIdx === undefined && currentEpisodeIdx === undefined
              ? storedSeasonIdx === undefined && storedEpisodeIdx === undefined
              : storedSeasonIdx === currentSeasonIdx && storedEpisodeIdx === currentEpisodeIdx;
            const resumeFrom = hasExplicitResume ? initialSeekTime : (episodeMatches ? data.currentTime : 0);
            if (resumeFrom && data.duration && (resumeFrom / data.duration) < 0.95) {
              pendingSeek.current = resumeFrom;
            }
          }
        });
      });
    } catch {}
  }, [animeId, currentEpisodeIdx, currentSeasonIdx, initialSeekTime]);

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
    return getPrimaryPlaybackSrc(trimmed, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined, preferProxy || isManagedServerSource(trimmed));
  }, [cdnEnabled, proxyUrl, proxyApiKey, preferProxy]);

  const applyServerDomain = useCallback((rawUrl: string, serverIndex: number) => {
    const server = effectiveVideoServers[serverIndex];
    if (!server?.domain) return rawUrl;
    const domainTrim = server.domain.trim().replace(/\/$/, "");

    // Universal domain swap — keep path + query + hash (channel id / file id / hash) intact.
    // Works for ANY server in admin settings: render.com (https), hf.space (https),
    // bot-hosting.net (http via proxy), etc. Each server is independent.
    try {
      const url = new URL(rawUrl);
      return `${domainTrim}${url.pathname}${url.search}${url.hash}`;
    } catch {
      const match = rawUrl.match(/^https?:\/\/[^/]+(\/.*)/);
      return `${domainTrim}${match ? match[1] : rawUrl}`;
    }
  }, [effectiveVideoServers]);

  const getServerScopedSource = useCallback((rawUrl: string, serverIndex = activeServerIndex) => {
    if (!effectiveVideoServers.length) return rawUrl;
    return applyServerDomain(rawUrl, serverIndex);
  }, [activeServerIndex, applyServerDomain, effectiveVideoServers]);

  const preloadLinkRef = useRef<HTMLLinkElement | null>(null);
  const serverSwitchingRef = useRef(false);
  const instantSwitchRef = useRef(false);
  const [serverSwitching, setServerSwitching] = useState(false);

  // NOTE: Aggressive next-episode preload removed — it caused CORS fetches
  // and wasted bandwidth that slowed the *current* video load. Browser will
  // naturally prefetch via the video element when user switches.

  const switchServer = useCallback((serverIndex: number) => {
    if ((serverIndex === activeServerIndex && manualServerSelected) || !effectiveVideoServers[serverIndex]) return;
    if (effectiveVideoServers[serverIndex].locked && !isPremium) return;
    if (serverSwitchingRef.current) return;
    const v = videoRef.current;

    const liveTime = isEmbedPlayback ? (embedTimeRef.current.currentTime || 0) : (v?.currentTime || 0);
    // Preserve a higher pending resume (e.g. Continue-Watching seek that hasn't
    // been applied yet because the video just mounted) so the premium / failover
    // auto-switch doesn't clobber it back to 0.
    const pendingResume = typeof pendingSeek.current === "number" && pendingSeek.current > 0 ? pendingSeek.current : 0;
    const savedTime = Math.max(liveTime, pendingResume);
    const wasPlaying = isEmbedPlayback ? playing : !!v && !v.paused;
    const newRawSrc = getServerScopedSource(sourceBaseRef.current, serverIndex);
    const resolved = resolvePlaybackSrc(newRawSrc);

    setShowServerPanel(false);
    serverSwitchingRef.current = true;
    setServerSwitching(true);
    setIsBuffering(true);
    setVideoError(false);

    setManualServerSelected(true);
    setActiveServerIndex(serverIndex);
    setCurrentQuality("Auto");
    activeSourceBaseRef.current = newRawSrc;
    pendingSeek.current = savedTime;

    failedSrcsRef.current.clear();
    retryAttemptsRef.current.clear();

    // Server swap must force a fresh media pipeline. Some hosts keep the old
    // range request alive unless load() is called, which makes the UI look like
    // it switched while the browser is still attached to the previous server.
    setCurrentSrc(resolved);
    if (v) {
      try {
        v.pause();
        if (v.src !== resolved) v.src = resolved;
        v.load();
        if (savedTime > 0) {
          const onMeta = () => { try { v.currentTime = savedTime; } catch {} v.removeEventListener("loadedmetadata", onMeta); };
          v.addEventListener("loadedmetadata", onMeta);
        }
        if (wasPlaying) v.play().catch(() => {});
      } catch {}
    }

    // Auto-failover only if server truly dead (5s, no data at all)
    window.setTimeout(() => {
      const vv = videoRef.current;
      if (!vv || isEmbedPlayback) return;
      if (vv.readyState < 1 && vv.networkState === 3) {
        const nextIdx = effectiveVideoServers.findIndex((s, i) => i !== serverIndex && (!s.locked || isPremium));
        if (nextIdx >= 0 && nextIdx !== serverIndex) {
          serverSwitchingRef.current = false;
          setServerSwitching(false);
          switchServer(nextIdx);
        }
      }
    }, 2500);

    window.setTimeout(() => {
      serverSwitchingRef.current = false;
      setServerSwitching(false);
    }, 180);
  }, [activeServerIndex, effectiveVideoServers, resolvePlaybackSrc, getServerScopedSource, isEmbedPlayback, isPremium, playing, manualServerSelected]);

  // Auto-switch to premium server for premium users (only if user hasn't picked one)
  useEffect(() => {
    if (!isPremium || effectiveVideoServers.length === 0) return;
    if (premiumServerApplied.current || manualServerSelected) return;
    const premIdx = effectiveVideoServers.findIndex(s => s.locked);
    if (premIdx < 0 || premIdx === activeServerIndex) return;
    // Mark BEFORE the async switch so a manual click during the delay
    // doesn't get clobbered by a late auto-switch.
    premiumServerApplied.current = true;
    const t = window.setTimeout(() => {
      if (manualServerSelected) return;
      switchServer(premIdx);
    }, 250);
    return () => window.clearTimeout(t);
  }, [isPremium, effectiveVideoServers, activeServerIndex, switchServer, manualServerSelected]);

  const [audioTrackOptions, setAudioTrackOptions] = useState<AudioTrackOption[]>([]);
  const [hlsAudioOptions, setHlsAudioOptions] = useState<AudioTrackOption[]>([]);
  const [currentHlsAudio, setCurrentHlsAudio] = useState<number>(-1);
  const [hlsSubtitleOptions, setHlsSubtitleOptions] = useState<HlsSubtitleOption[]>([]);
  const [currentHlsSubtitle, setCurrentHlsSubtitle] = useState<number>(-1); // -1 = off
  const [showCcPanel, setShowCcPanel] = useState(false);
  const [ccTab, setCcTab] = useState<"audio" | "subtitle">("audio");
  const [subtitleOverlayText, setSubtitleOverlayText] = useState("");
  const [subtitleStatusMessage, setSubtitleStatusMessage] = useState("");
  const [subtitleStatusTone, setSubtitleStatusTone] = useState<"neutral" | "success" | "warning">("neutral");
  const [subtitleCueVersion, setSubtitleCueVersion] = useState(0);
  const [captionFontScale, setCaptionFontScale] = useState(1);
  const [captionVerticalOffset, setCaptionVerticalOffset] = useState(10);
  const hlsRef = useRef<Hls | null>(null);
  const hlsFatalRetriesRef = useRef(0);
  const hlsSubtitleMetaRef = useRef<HlsSubtitleOption[]>([]);
  const subtitleCueListRef = useRef<Array<{ start: number; end: number; text: string }>>([]);
  const subtitlePollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subtitleSwitchingUntilRef = useRef(0);

  const decodeSubtitleEntities = useCallback((value: string) => {
    return value
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"');
  }, []);

  const sanitizeSubtitleText = useCallback((rawText: string) => {
    return decodeSubtitleEntities(
      rawText
        .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
        .replace(/<\/?.*?>/g, "")
        .split("\n")
        .map((line) =>
          line
            .replace(/^[\u200B-\u200F\uFEFF]+|[\u200B-\u200F\uFEFF]+$/g, "")
            .replace(/^[♪♫♬【】「」『』〈〉《》〔〕]+\s*/g, "")
            .replace(/\s*[♪♫♬【】「」『』〈〉《》〔〕]+$/g, "")
            .trim(),
        )
        .filter(Boolean)
        .join("\n"),
    ).trim();
  }, [decodeSubtitleEntities]);

  const parseVttToCues = useCallback((vttText: string) => {
    const normalized = vttText.replace(/\r/g, "");
    const blocks = normalized.split(/\n\n+/);
    const toSeconds = (raw: string) => {
      const clean = raw.trim().replace(",", ".");
      const parts = clean.split(":").map(Number);
      if (parts.some((part) => Number.isNaN(part))) return NaN;
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return Number.NaN;
    };

    return blocks.flatMap((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex === -1) return [];
      const timingLine = lines[timingIndex];
      const [startRaw, endRaw] = timingLine.split("-->").map((part) => part.trim().split(/\s+/)[0]);
      const start = toSeconds(startRaw || "");
      const end = toSeconds(endRaw || "");
      const text = sanitizeSubtitleText(lines.slice(timingIndex + 1).join("\n"));
      if (!text || Number.isNaN(start) || Number.isNaN(end)) return [];
      return [{ start, end, text }];
    });
  }, [sanitizeSubtitleText]);

  const clearSubtitlePolling = useCallback(() => {
    if (subtitlePollTimerRef.current) {
      clearInterval(subtitlePollTimerRef.current);
      subtitlePollTimerRef.current = null;
    }
  }, []);

  const syncSubtitleOverlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || currentHlsSubtitle < 0) {
      setSubtitleOverlayText("");
      return;
    }

    const activeText = subtitleCueListRef.current
      .filter((cue) => v.currentTime >= cue.start && v.currentTime <= cue.end)
      .map((cue) => cue.text)
      .join("\n")
      .trim();

    setSubtitleOverlayText(activeText);
  }, [currentHlsSubtitle]);

  const fetchSubtitleText = useCallback(async (targetUrl: string) => {
    const response = await fetch(targetUrl, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }, []);

  const applyCueOffset = useCallback((cues: Array<{ start: number; end: number; text: string }>, offsetSeconds: number) => {
    if (!offsetSeconds) return cues;
    return cues.map((cue) => ({
      ...cue,
      start: cue.start + offsetSeconds,
      end: cue.end + offsetSeconds,
    }));
  }, []);

  const extractSubtitleSegments = useCallback((playlistText: string, playlistUrl: string) => {
    const normalized = playlistText.replace(/\r/g, "").trim();
    if (!normalized) return [] as Array<{ url: string; offset: number; duration: number }>;
    if (/^WEBVTT\b/i.test(normalized)) {
      return [{ url: playlistUrl, offset: 0, duration: 0 }];
    }

    const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
    let nextDuration = 0;
    let cumulativeOffset = 0;

    return lines.flatMap((line) => {
      if (line.startsWith("#EXTINF:")) {
        nextDuration = Number.parseFloat(line.slice(8).split(",")[0] || "0") || 0;
        return [];
      }
      if (!line || line.startsWith("#")) return [];

      const segment = {
        url: new URL(line, playlistUrl).toString(),
        offset: cumulativeOffset,
        duration: nextDuration,
      };
      cumulativeOffset += nextDuration;
      nextDuration = 0;
      return [segment];
    });
  }, []);

  const loadSubtitleTrackCues = useCallback(async (trackUrl: string, depth = 0): Promise<Array<{ start: number; end: number; text: string }>> => {
    if (depth > 3) throw new Error("Subtitle nesting too deep");

    const payload = await fetchSubtitleText(trackUrl);
    const normalized = payload.replace(/\r/g, "").trim();
    if (!normalized) return [];
    if (/^WEBVTT\b/i.test(normalized)) return parseVttToCues(payload);
    if (!/^#EXTM3U\b/i.test(normalized)) return parseVttToCues(payload);

    const segments = extractSubtitleSegments(payload, trackUrl);
    if (segments.length === 0) throw new Error("No subtitle media file found");

    const allSegments = await Promise.all(
      segments.map(async (segment) => {
        const segmentText = await fetchSubtitleText(segment.url);
        const trimmedSegment = segmentText.replace(/\r/g, "").trim();
        const parsedSegmentCues = /^#EXTM3U\b/i.test(trimmedSegment)
          ? await loadSubtitleTrackCues(segment.url, depth + 1)
          : parseVttToCues(segmentText);

        const maxCueEnd = parsedSegmentCues.reduce((max, cue) => Math.max(max, cue.end), 0);
        const looksRelative = segment.offset > 0 && maxCueEnd <= Math.max(segment.duration + 2, 120);

        return looksRelative ? applyCueOffset(parsedSegmentCues, segment.offset) : parsedSegmentCues;
      }),
    );

    const deduped = new Map<string, { start: number; end: number; text: string }>();
    allSegments
      .flat()
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .forEach((cue) => {
        const key = `${cue.start.toFixed(3)}:${cue.end.toFixed(3)}:${cue.text}`;
        if (!deduped.has(key)) deduped.set(key, cue);
      });

    return Array.from(deduped.values());
  }, [applyCueOffset, extractSubtitleSegments, fetchSubtitleText, parseVttToCues]);

  const loadSubtitleCues = useCallback(async (selectedIdx: number) => {
    if (selectedIdx < 0) {
      subtitleCueListRef.current = [];
      setSubtitleCueVersion((value) => value + 1);
      setSubtitleStatusTone("success");
      setSubtitleStatusMessage("Subtitles turned off.");
      setSubtitleOverlayText("");
      clearSubtitlePolling();
      return;
    }

    const targetMeta = hlsSubtitleMetaRef.current.find((track) => track.id === selectedIdx);
    if (!targetMeta?.url) {
      subtitleCueListRef.current = [];
      setSubtitleCueVersion((value) => value + 1);
      setSubtitleStatusTone("warning");
      setSubtitleStatusMessage("Subtitle track was found, but its file URL is missing.");
      setSubtitleOverlayText("");
      clearSubtitlePolling();
      return;
    }

    try {
      setSubtitleStatusTone("neutral");
      setSubtitleStatusMessage("Loading subtitles...");
      const cues = await loadSubtitleTrackCues(targetMeta.url);
      subtitleCueListRef.current = cues;
      setSubtitleCueVersion((value) => value + 1);
      syncSubtitleOverlay();
      clearSubtitlePolling();
      subtitlePollTimerRef.current = setInterval(syncSubtitleOverlay, 250);

      if (cues.length > 0) {
        setSubtitleStatusTone("success");
        setSubtitleStatusMessage("Subtitles are working.");
      } else {
        setSubtitleStatusTone("warning");
        setSubtitleStatusMessage("Subtitle file loaded, but it contains no usable captions.");
      }
    } catch (error) {
      subtitleCueListRef.current = [];
      setSubtitleCueVersion((value) => value + 1);
      setSubtitleOverlayText("");
      setSubtitleStatusTone("warning");
      setSubtitleStatusMessage("This subtitle track could not be loaded from the stream.");
      clearSubtitlePolling();
    }
  }, [clearSubtitlePolling, loadSubtitleTrackCues, syncSubtitleOverlay]);

  const isPlayerPanelTarget = useCallback((target: EventTarget | null) => {
    return target instanceof HTMLElement && !!target.closest("[data-player-panel='true']");
  }, []);

  useEffect(() => {
    if (!isHlsSrc || currentHlsSubtitle < 0) {
      clearSubtitlePolling();
      setSubtitleOverlayText("");
      if (!isHlsSrc) {
        setSubtitleStatusMessage("");
        setSubtitleStatusTone("neutral");
      }
      return;
    }

    loadSubtitleCues(currentHlsSubtitle);

    return () => {
      clearSubtitlePolling();
    };
  }, [clearSubtitlePolling, currentHlsSubtitle, isHlsSrc, loadSubtitleCues]);

  // ===== HLS.js attachment =====
  // For any .m3u8 source we own playback via hls.js so the manifest's
  // audio + subtitle renditions are exposed to our control panel. Safari
  // (native HLS) only gets used when hls.js can't run.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !currentSrc || !isHlsSrc || isEmbedPlayback || adGateActive) {
      // Tear down any existing instance when not in HLS mode
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch {}
        hlsRef.current = null;
      }
      // Clear HLS-only track UI so CC button hides for non-HLS sources
      setHlsAudioOptions([]);
      setHlsSubtitleOptions([]);
      setCurrentHlsAudio(-1);
      setCurrentHlsSubtitle(-1);
      return;
    }

    // Safari: native HLS — still expose subtitle tracks via TextTrackList
    if (v.canPlayType("application/vnd.apple.mpegurl") && !Hls.isSupported()) {
      v.src = currentSrc;
      return;
    }

    if (!Hls.isSupported()) return;

    // Fresh instance per source change
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      // Ultra-fast start: skip Hls.js's initial bandwidth probe and assume a
      // healthy bitrate so playback begins on the first fragment instead of
      // waiting ~3-5s for the bandwidth test to finish.
      testBandwidth: false,
      abrEwmaDefaultEstimate: 5_000_000,
      // Smaller buffers → faster first frame & faster seek response. The big
      // 180s buffer here was forcing the player to fetch ~3 minutes of video
      // before signalling canplay on slow connections.
      backBufferLength: 30,
      maxBufferLength: 20,
      maxMaxBufferLength: 60,
      maxBufferSize: 60 * 1000 * 1000,
      // Start at the lowest quality so the very first fragment lands in <1s,
      // then ABR climbs to the best level the user's bandwidth supports.
      startLevel: 0,
      startFragPrefetch: true,
      // Aggressive but bounded retries so a single dead fragment never stalls
      // playback for tens of seconds.
      manifestLoadingTimeOut: 8000,
      manifestLoadingMaxRetry: 2,
      manifestLoadingRetryDelay: 500,
      levelLoadingTimeOut: 8000,
      levelLoadingMaxRetry: 3,
      fragLoadingTimeOut: 15000,
      fragLoadingMaxRetry: 4,
      fragLoadingRetryDelay: 500,
      capLevelToPlayerSize: false,
      // Keep subtitle handling inside our custom overlay so the native track UI
      // does not silently hide cues on Android Chrome.
      renderTextTracksNatively: false,
    });
    hlsRef.current = hls;

    hls.loadSource(currentSrc);
    hls.attachMedia(v);

    const refreshHlsAudio = () => {
      const aTracks = hls.audioTracks || [];
      const opts: AudioTrackOption[] = aTracks.map((t, i) => ({
        language: t.lang || `aud${i + 1}`,
        label: t.name || t.lang || `Audio ${i + 1}`,
        hlsAudioIndex: i,
      }));
      setHlsAudioOptions(opts);
      const active = typeof hls.audioTrack === "number" ? hls.audioTrack : -1;
      const resolvedActive = active >= 0 ? active : (opts.length > 0 ? 0 : -1);
      setCurrentHlsAudio(resolvedActive);
      const activeTrack = resolvedActive >= 0 ? opts[resolvedActive] : opts[0];
      const activeLabel = activeTrack
        ? (getPrimaryLanguageToken(activeTrack.label || activeTrack.language || "") || activeTrack.label || activeTrack.language || "")
        : "";
      if (activeLabel) setSelectedLanguageLabel(activeLabel);
    };

    const refreshHlsSubs = () => {
      const sTracks = hls.subtitleTracks || [];
      const nextSubtitleOptions = sTracks.map((t, i) => ({
        id: i,
        label: t.name || t.lang || `Subtitle ${i + 1}`,
        language: t.lang || "und",
        url: t.url,
      }));
      hlsSubtitleMetaRef.current = nextSubtitleOptions;
      setHlsSubtitleOptions(nextSubtitleOptions);
      if (sTracks.length === 0) {
        setCurrentHlsSubtitle(-1);
        return;
      }
      hls.subtitleDisplay = true;
      const defS = sTracks.findIndex((t) => (t as any).default);
      if (defS >= 0) {
        hls.subtitleTrack = defS;
        setCurrentHlsSubtitle(defS);
      }
    };

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      hlsFatalRetriesRef.current = 0;
      refreshHlsAudio();
      refreshHlsSubs();
      v.play().catch(() => {});
    });
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, refreshHlsAudio);
    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, refreshHlsAudio);
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, refreshHlsSubs);
    hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_e, d: any) => {
      if (typeof d?.id === "number") {
        setCurrentHlsSubtitle(d.id);
      }
    });

    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return;
      const recoverableTrackDetails = new Set([
        Hls.ErrorDetails.SUBTITLE_LOAD_ERROR,
        Hls.ErrorDetails.SUBTITLE_TRACK_LOAD_TIMEOUT,
        Hls.ErrorDetails.AUDIO_TRACK_LOAD_ERROR,
        Hls.ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT,
      ]);

      if (recoverableTrackDetails.has(data.details as any)) {
        if (data.details === Hls.ErrorDetails.SUBTITLE_LOAD_ERROR || data.details === Hls.ErrorDetails.SUBTITLE_TRACK_LOAD_TIMEOUT) {
          setSubtitleStatusTone("warning");
          setSubtitleStatusMessage("This subtitle track could not be loaded from the stream.");
          setSubtitleOverlayText("");
        }
        return;
      }

      hlsFatalRetriesRef.current += 1;
      if (hlsFatalRetriesRef.current > 2) {
        try { hls.destroy(); } catch {}
        hlsRef.current = null;
        setVideoError(true);
        return;
      }

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        try { hls.startLoad(); } catch {}
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try { hls.recoverMediaError(); } catch {}
      } else {
        try { hls.destroy(); } catch {}
        hlsRef.current = null;
      }
    });

    return () => {
      try { hls.destroy(); } catch {}
      if (hlsRef.current === hls) hlsRef.current = null;
    };
  }, [currentSrc, isHlsSrc, isEmbedPlayback, adGateActive]);

  // Hard cleanup on full unmount — eliminates the "player keeps leaking" bug
  // users reported when returning to home. Detaches HLS, clears <video>, kills timers.
  useEffect(() => {
    return () => {
      try { hlsRef.current?.destroy(); } catch {}
      hlsRef.current = null;
      const v = videoRef.current;
      if (v) {
        try {
          v.pause();
          v.removeAttribute("src");
          v.load();
        } catch {}
      }
    };
  }, []);


  const switchHlsSubtitle = useCallback((idx: number) => {
    const hls = hlsRef.current;
    subtitleSwitchingUntilRef.current = Date.now() + 1600;
    setSubtitleOverlayText("");
    setSubtitleStatusTone(idx >= 0 ? "neutral" : "success");
    setSubtitleStatusMessage(idx >= 0 ? "Loading subtitles..." : "Subtitles turned off.");
    if (hls) {
      hls.subtitleDisplay = idx >= 0;
      hls.subtitleTrack = idx;
    }
    setCurrentHlsSubtitle(idx);
    setIsBuffering(false);
  }, []);

  const switchHlsAudio = useCallback((idx: number) => {
    const hls = hlsRef.current;
    if (hls && idx >= 0) {
      try { hls.audioTrack = idx; } catch {}
    }
    setCurrentHlsAudio(idx);
  }, []);


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

    if (track.hlsAudioIndex !== undefined && hlsRef.current) {
      // Switch HLS.js audio rendition (preserves time + playing state automatically)
      hlsRef.current.audioTrack = track.hlsAudioIndex;
      setCurrentAudioTrack(track.label);
      setSelectedLanguageLabel(track.label || track.language || "");
    } else if (track.nativeIndex !== undefined) {
      // Switch native audio track
      const audioTracks = (v as any).audioTracks;
      if (audioTracks) {
        for (let i = 0; i < audioTracks.length; i++) {
          audioTracks[i].enabled = i === track.nativeIndex;
        }
      }
      setCurrentAudioTrack(track.label);
      setSelectedLanguageLabel(track.label || track.language || "");
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
      const finalAudioUrl = getServerScopedSource(audioUrl);
      const proxiedSrc = resolvePlaybackSrc(finalAudioUrl);
      activeSourceBaseRef.current = finalAudioUrl;
      setCurrentSrc(proxiedSrc);
      setCurrentAudioTrack(track.label);
      setSelectedLanguageLabel(track.label || track.language || "");
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
  }, [currentQuality, resolvePlaybackSrc, getServerScopedSource]);

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
    const fallbackLanguage = propAudioTracks?.[0]?.label || propAudioTracks?.[0]?.language || anime?.language || "Unknown";
    setCurrentAudioTrack("Default");
    setSelectedLanguageLabel(fallbackLanguage);
    setShowAudioPanel(false);

    const finalDefaultSrc = getServerScopedSource(defaultRawSrc);
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

  }, [anime?.language, currentSrc, getServerScopedSource, propAudioTracks, resolvePlaybackSrc, src]);

  // Track the last `src` we actually reacted to. Without this guard the effect
  // re-runs whenever qualityOptions / resolvePlaybackSrc identity changes
  // (every parent re-render), which would clobber a user-selected quality back
  // to "Auto" within ~1s of switching. We only want a true episode change to
  // reset the player state.
  const lastSourceFingerprintRef = useRef<string>("");
  useEffect(() => {
    if (!playbackRouteReady) return;
    const nextFingerprint = `${src}__${currentSeasonIdx ?? "movie"}__${currentEpisodeIdx ?? "movie"}`;
    if (lastSourceFingerprintRef.current === nextFingerprint) return; // same episode/movie source
    lastSourceFingerprintRef.current = nextFingerprint;
    // Ultra-fast episode switch: do NOT pause/blank the player. Just swap src
    // and let the video element load the new source while keeping the UI alive.
    instantSwitchRef.current = true;
    sourceBaseRef.current = src;
    activeSourceBaseRef.current = src;
    premiumServerApplied.current = false;
    const initialRawSrc = getServerScopedSource(src, 0);
    const resolvedSrc = resolvePlaybackSrc(initialRawSrc);
    activeSourceBaseRef.current = initialRawSrc;
    setCurrentSrc(resolvedSrc);
    setCurrentQuality("Auto");
    setManualServerSelected(false);
    setActiveServerIndex(0);
    retryAttemptsRef.current.clear();
    setVideoError(false);
    failedSrcsRef.current.clear();
    const seekTarget = typeof initialSeekTime === "number" && initialSeekTime > 0 ? initialSeekTime : 0;
    pendingSeek.current = seekTarget;
    // FORCE-RESET currentTime when switching episodes with no resume requested —
    // otherwise the <video> element retains the previous episode's playhead and
    // the new episode appears to "start" 22 minutes in.
    const _v = videoRef.current;
    if (_v && seekTarget === 0) {
      try { _v.currentTime = 0; } catch {}
      const onMetaReset = () => {
        try { if (pendingSeek.current === 0 || pendingSeek.current === null) _v.currentTime = 0; } catch {}
        _v.removeEventListener("loadedmetadata", onMetaReset);
      };
      _v.addEventListener("loadedmetadata", onMetaReset);
    }
    setSwitchingEpisode(true);
    const t = setTimeout(() => {
      instantSwitchRef.current = false;
      setSwitchingEpisode(false);
    }, 80);
    return () => clearTimeout(t);
  }, [src, qualityOptions, noProxy, playbackRouteReady, resolvePlaybackSrc, getServerScopedSource, initialSeekTime, currentSeasonIdx, currentEpisodeIdx]);

  useEffect(() => {
    if (!playbackRouteReady || !activeSourceBaseRef.current) return;
    const nextResolved = resolvePlaybackSrc(activeSourceBaseRef.current);
    setCurrentSrc((prev) => (prev === nextResolved ? prev : nextResolved));
  }, [playbackRouteReady, proxyUrl, proxyApiKey, cdnEnabled, resolvePlaybackSrc]);

  const applyPendingSeek = useCallback((targetVideo?: HTMLVideoElement | null) => {
    const v = targetVideo || videoRef.current;
    const target = pendingSeek.current;
    if (!v || target === null) return false;
    if (!Number.isFinite(target) || target < 0) {
      pendingSeek.current = null;
      return false;
    }

    const hasSeekContext = v.readyState >= 1 || (Number.isFinite(v.duration) && v.duration > 0);
    if (!hasSeekContext) return false;

    const maxTarget = Number.isFinite(v.duration) && v.duration > 0
      ? Math.max(0, v.duration - 0.25)
      : target;
    const seekTo = Math.max(0, Math.min(target, maxTarget));

    try {
      v.currentTime = seekTo;
      if (seekTo === 0 || Math.abs(v.currentTime - seekTo) <= 1.5) {
        pendingSeek.current = null;
        setCurrentTime(seekTo);
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || isEmbedPlayback || pendingSeek.current === null) return;
    if (applyPendingSeek(v)) return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (applyPendingSeek(v) || attempts >= 25) {
        window.clearInterval(timer);
      }
    }, 200);

    return () => window.clearInterval(timer);
  }, [applyPendingSeek, currentSrc, isEmbedPlayback]);

  // Loader follows real buffering state but with anti-flicker guards:
  // - Show immediately when buffering starts.
  // - Once visible, keep on screen for at least 500ms so quick canplay→waiting→canplay
  //   cycles during HLS start don't make the petals (and the dark overlay covering
  //   the video area) blink on/off rapidly.
  const loaderShownAtRef = useRef<number>(0);
  useEffect(() => {
    if (loaderTimeoutRef.current) {
      clearTimeout(loaderTimeoutRef.current);
      loaderTimeoutRef.current = null;
    }

    if (!currentSrc || switchingEpisode) {
      setShowFixedLoader(false);
      return;
    }

    if (isBuffering) {
      loaderShownAtRef.current = Date.now();
      setShowFixedLoader(true);
      return;
    }

    const visibleFor = Date.now() - loaderShownAtRef.current;
    const MIN_VISIBLE = 250; // ultra-fast: drop spinner as soon as canplay fires (was 1200ms)
    if (visibleFor >= MIN_VISIBLE) {
      setShowFixedLoader(false);
    } else {
      loaderTimeoutRef.current = setTimeout(() => {
        setShowFixedLoader(false);
        loaderTimeoutRef.current = null;
      }, MIN_VISIBLE - visibleFor);
    }
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

  const stopAndClosePlayer = useCallback(() => {
    // INSTANT close: fire onClose synchronously so React unmounts the player
    // overlay immediately. All teardown happens after, off the critical path.
    clearHideTimer();
    setShowControls(false);
    setLocked(false);
    setShowSettings(false);
    setShowAudioPanel(false);
    setShowQualityPanel(false);
    setShowServerPanel(false);
    setShowInfoSheet(false);
    setShowLanguageSheet(false);
    setShowSeasonSheet(false);
    setShowLibrarySheet(false);
    setShowDownloadQualityPicker(false);

    const v = videoRef.current;
    const iframe = embedIframeRef.current;

    // Stop audio instantly (cheap) — prevents lingering sound during animation.
    try { v?.pause(); } catch {}
    try { hlsRef.current?.destroy(); } catch {}
    hlsRef.current = null;

    // Notify parent NOW — don't await anything before this call.
    onClose();

    // Heavy / async cleanup deferred to next tick so it never blocks close.
    setTimeout(() => {
      try {
        if (document.fullscreenElement) {
          try { (screen.orientation as any).unlock?.(); } catch {}
          document.exitFullscreen().catch(() => {});
        }
      } catch {}

      try {
        const embedWindow = iframe?.contentWindow;
        embedWindow?.postMessage({ target: "rs-embed", cmd: "pause" }, "*");
        embedWindow?.postMessage({ target: "rs-embed", cmd: "stop" }, "*");
      } catch {}

      if (v) {
        try { v.removeAttribute("src"); } catch {}
        try { v.src = ""; } catch {}
        try { v.load(); } catch {}
      }
      if (iframe) {
        try { iframe.src = "about:blank"; } catch {}
      }

      try {
        document.querySelectorAll("video, audio").forEach((node) => {
          const media = node as HTMLMediaElement;
          try { media.pause(); } catch {}
          try { media.removeAttribute("src"); } catch {}
          try { media.load(); } catch {}
        });
        document.querySelectorAll('iframe[title="player"], iframe[src*="hf.space"], iframe[src*="huggingface"]').forEach((node) => {
          const frame = node as HTMLIFrameElement;
          try { frame.src = "about:blank"; } catch {}
        });
      } catch {}

      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.playbackState = 'none';
        } catch {}
      }
    }, 0);
  }, [clearHideTimer, closeInlineSheets, onClose]);

  // Back-button behavior: when in fullscreen, first exit fullscreen; otherwise close the player.
  const handleBackPress = useCallback(() => {
    const inFs = !!document.fullscreenElement || isFullscreen;
    if (inFs) {
      try { (screen.orientation as any).unlock?.(); } catch {}
      try {
        const p = document.exitFullscreen?.();
        if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
      } catch {}
      setIsFullscreen(false);
      return;
    }
    stopAndClosePlayer();
  }, [isFullscreen, stopAndClosePlayer]);

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
        artist: subtitle || branding.siteName,
        album: branding.siteName,
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
    if (adGateActive || showSettings || showAudioPanel || showQualityPanel || showServerPanel || showCcPanel || showDownloadQualityPicker || showInfoSheet || showLanguageSheet || showSeasonSheet || showShareSheet || showAddToListSheet || showLibrarySheet) return;
    // Keep controls visible while a video error is showing — user must reach the server switcher
    if (videoError) return;
    hideTimer.current = setTimeout(() => {
      setShowControls(false);
    }, locked ? 2200 : 3800);
  }, [adGateActive, clearHideTimer, locked, showAddToListSheet, showAudioPanel, showCcPanel, showDownloadQualityPicker, showInfoSheet, showLanguageSheet, showLibrarySheet, showSeasonSheet, showQualityPanel, showServerPanel, showSettings, showShareSheet, videoError]);

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
  const showLoaderOverlay = !!currentSrc && !videoError && !isEmbedPlayback && (showFixedLoader || serverSwitching);

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
      applyPendingSeek(v);
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
    const MAX_RETRIES = 1;
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
          proxyApiKey || undefined,
          preferProxy || isManagedServerSource(activeSourceBaseRef.current)
        ).find((candidateSrc) => !failedSrcsRef.current.has(candidateSrc) && candidateSrc !== currentSrc);

        if (sameQualityRouteFallback) {
          pendingSeek.current = lastKnownTime || v?.currentTime || 0;
          setCurrentSrc(sameQualityRouteFallback);
          return;
        }

        const nextOption = availableQualities.find((q) => {
          const candidateRaw = getServerScopedSource(q.src);
          const candidateSrc = getPrimaryPlaybackSrc(candidateRaw, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined, preferProxy || isManagedServerSource(candidateRaw));
          return !failedSrcsRef.current.has(candidateSrc) && candidateSrc !== currentSrc;
        });

        if (nextOption) {
          pendingSeek.current = lastKnownTime || v?.currentTime || 0;
          const nextRaw = getServerScopedSource(nextOption.src);
          const newFallbackSrc = getPrimaryPlaybackSrc(nextRaw, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined, preferProxy || isManagedServerSource(nextRaw));
          activeSourceBaseRef.current = nextRaw;
          if (newFallbackSrc === currentSrc) {
            v.currentTime = pendingSeek.current;
            pendingSeek.current = null;
            v.load();
          } else {
            setCurrentSrc(newFallbackSrc);
          }
          // Keep the user-chosen quality label sticky on fallback. Only update
          // label if the user was on "Auto" (i.e. no explicit selection).
          if (currentQuality === "Auto") setCurrentQuality(nextOption.label);
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
    const onCanPlay = () => {
      setVideoError(false);
      setIsBuffering(false);
      // Also apply pending seek here in case loadedmetadata didn't fire
      applyPendingSeek(v);
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
      if (subtitleSwitchingUntilRef.current > Date.now()) return;
      if (waitingTimer) clearTimeout(waitingTimer);
      // Short debounce — show loader quickly on real stalls but stay calm on micro-hiccups
      waitingTimer = setTimeout(() => {
        if (v.readyState < 3) setIsBuffering(true);
      }, 400);
    };
    const onPlaying = () => {
      if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = null; }
      setIsBuffering(false);
    };
    const onLoadStart = () => {
      if (subtitleSwitchingUntilRef.current > Date.now()) return;
      // Only show loader if we genuinely don't have data yet
      if (v.readyState < 2) setIsBuffering(true);
    };
    const onSeeked = () => {
      setIsBuffering(false);
    };
    let stalledTimer: ReturnType<typeof setTimeout> | null = null;
    const onStalled = () => {
      if (subtitleSwitchingUntilRef.current > Date.now()) return;
      if (stalledTimer) clearTimeout(stalledTimer);
      stalledTimer = setTimeout(() => {
        if (v.readyState < 3) setIsBuffering(true);
      }, 1500);
    };
    const onTimeUpdate = () => {
      const ct = v.currentTime;
      const dur = v.duration;
      if (ct > 0) lastKnownTime = ct;
      if (progressRef.current && dur > 0) {
        progressRef.current.style.width = `${(ct / dur) * 100}%`;
      }
      if (timeDisplayRef.current && dur > 0) {
        timeDisplayRef.current.textContent = `${formatTime(ct)} / ${formatTime(dur)}`;
      }
      const now = performance.now();
      if (now - lastNativeSyncRef.current >= 1000) {
        lastNativeSyncRef.current = now;
        setCurrentTime(ct);
        if (Number.isFinite(dur) && dur > 0) setDuration(dur);
      }
    };
    const onDurationChange = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
    };
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("durationchange", onDurationChange);
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
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("durationchange", onDurationChange);
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
      // NOTE: do NOT clear v.src here. This cleanup runs on every currentSrc change
      // (server / quality / audio switch). Wiping src would discard the freshly-set
      // source React just rendered and force a restart from 0:00. Real teardown
      // happens in the unmount-only effect below.
    };
  }, [applyPendingSeek, currentSrc, adGateActive, availableQualities, currentQuality, cdnEnabled, proxyUrl, playbackRouteReady, switchServer, effectiveVideoServers, activeServerIndex, getServerScopedSource, proxyApiKey, preferProxy]);

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
    return Math.min(Math.max(target, 0), v.duration);
  }, []);

  const showSkipPill = useCallback((seconds: number) => {
    const side: "left" | "right" = seconds > 0 ? "right" : "left";
    const acc = skipAccumRef.current;
    if (acc.side !== side) { acc.total = 0; }
    acc.side = side;
    acc.total += Math.abs(seconds);
    if (acc.timer) clearTimeout(acc.timer);
    setSkipIndicator({ side, text: `${acc.total}s`, total: acc.total });
    acc.timer = setTimeout(() => {
      skipAccumRef.current = { side: null, total: 0, timer: null };
      setSkipIndicator(null);
    }, 850);
  }, []);

  const seek = useCallback((seconds: number) => {
    if (isEmbedPlayback) {
      const dur = embedTimeRef.current.duration || 0;
      const cur = embedTimeRef.current.currentTime || 0;
      const next = Math.max(0, Math.min(dur || cur + seconds, cur + seconds));
      sendEmbedCmd("seek", { time: next });
      embedTimeRef.current.currentTime = next;
      showSkipPill(seconds);
      resetHideTimer();
      return;
    }
    const v = videoRef.current;
    if (!v) return;

    const nextTime = getSafeSeekTime(v, v.currentTime + seconds);
    try {
      if ("fastSeek" in v && typeof v.fastSeek === "function") v.fastSeek(nextTime);
      else v.currentTime = nextTime;
    } catch {
      v.currentTime = nextTime;
    }

    showSkipPill(seconds);
    resetHideTimer();
  }, [getSafeSeekTime, isEmbedPlayback, resetHideTimer, sendEmbedCmd, showSkipPill]);

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
    resetHideTimer();
  }, [isEmbedPlayback, resetHideTimer, sendEmbedCmd]);


  const switchQuality = useCallback((option: QualityOption) => {
    // Block 4K for non-premium users
    if (is4KLabel(option.label) && !isPremium) return;
    if (option.label === currentQuality) { setShowSettings(false); return; }

    sourceBaseRef.current = option.src;
    const finalOptionSrc = getServerScopedSource(option.src);
    activeSourceBaseRef.current = finalOptionSrc;
    const newSrc = resolvePlaybackSrc(finalOptionSrc);

    if (newSrc === currentSrc) {
      setCurrentQuality(option.label);
      setShowSettings(false);
      return;
    }
    const v = videoRef.current;
    const liveTime = isEmbedPlayback ? (embedTimeRef.current.currentTime || 0) : (v?.currentTime || 0);
    const pendingResume = typeof pendingSeek.current === "number" && pendingSeek.current > 0 ? pendingSeek.current : 0;
    pendingSeek.current = Math.max(liveTime, pendingResume);
    setIsBuffering(true);
    setCurrentSrc(newSrc);
    setCurrentQuality(option.label);
    setShowSettings(false);

  }, [currentQuality, currentSrc, isPremium, resolvePlaybackSrc, getServerScopedSource, isEmbedPlayback]);

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
    if (progressRef.current && v.duration > 0) {
      progressRef.current.style.width = `${pct * 100}%`;
    }
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
    resetHideTimer();
  }, [resetHideTimer]);

  const lastTap = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    if (skipIndicatorTimerRef.current) clearTimeout(skipIndicatorTimerRef.current);
  }, []);

  const handleVideoClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (locked) return;

    const now = Date.now();
    const clientX = "touches" in e ? e.changedTouches[0].clientX : e.clientX;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;

    if (now - lastTap.current.time < 300) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      if (relX < 0.33) seek(-10);
      else if (relX > 0.66) seek(10);
      else {
        togglePlay();
        setSkipIndicator({ side: "center", text: playing ? "⏸" : "▶" });
        if (skipIndicatorTimerRef.current) clearTimeout(skipIndicatorTimerRef.current);
        skipIndicatorTimerRef.current = setTimeout(() => setSkipIndicator(null), 520);
      }
      lastTap.current = { time: 0, x: 0 };
    } else {
      lastTap.current = { time: now, x: clientX };
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = setTimeout(() => {
        toggleControls();
        singleTapTimerRef.current = null;
      }, 210);
    }
  }, [locked, seek, togglePlay, playing, toggleControls]);


  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isPlayerPanelTarget(e.target)) return;
    const t = e.touches[0];
    setSwipeState({ startX: t.clientX, startY: t.clientY, type: null });
  }, [isPlayerPanelTarget]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isPlayerPanelTarget(e.target)) return;
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
  }, [swipeState, locked, brightness, boostedVolume, muted, applyPlayerVolume, isPlayerPanelTarget]);

  const handleTouchEnd = useCallback((e?: React.TouchEvent) => {
    if (e && isPlayerPanelTarget(e.target)) return;
    setSwipeState(null);
  }, [isPlayerPanelTarget]);
  const stopPanelPointerPropagation = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
  }, []);

  const keepPanelScrollActive = useCallback((e: React.TouchEvent | React.UIEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  const stopPanelWheelPropagation = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  const panelBaseClass = "player-glass rounded-xl p-2 z-[60] overflow-y-auto overscroll-contain touch-pan-y [scrollbar-width:thin]";
  const panelBaseStyle = { WebkitOverflowScrolling: "touch" as const, overscrollBehavior: "contain" as const, touchAction: "pan-y" as const };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  // Crop scale tuned to fully eliminate the small black side-bars left by AN's
  // letterboxed iframe. Slightly higher than before in both windowed + fullscreen.
  const embedTransform = cropIndex === 1
    ? (isFullscreen ? "scale(1.16)" : "scale(1.08)")
    : cropIndex === 2
      ? (isFullscreen ? "scaleX(1.42) scaleY(1.14)" : "scaleX(1.28) scaleY(1.08)")
      : "scale(1)";

  return (
    <div className={`fixed inset-0 z-[300] bg-background/[0.98] flex flex-col items-center ${isFullscreen ? '' : 'overflow-y-auto'}`} ref={containerRef}>
      {/* Back arrow lives inside the controls overlay below, so it hides/shows with controls */}


      <div className={`w-full ${isFullscreen ? 'h-full p-0' : 'max-w-full px-0 pb-6 pt-0'}`}>

        {/* Video Container - will-change for GPU compositing */}
        <div
          ref={videoContainerRef}
          className={`relative bg-black overflow-hidden ${
            isFullscreen 
              ? "w-screen h-screen rounded-none" 
              : "w-full rounded-none aspect-video sticky top-0 z-40"
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
          {isEmbedPlayback ? (
            <iframe
              ref={embedIframeRef}
              src={currentSrc}
              className="absolute inset-0 w-full h-full bg-black border-0 block"
              style={{ transform: embedTransform, transformOrigin: "center center" }}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="no-referrer"
              title="player"
            />
          ) : (
            <video
              ref={videoRef}
              src={adGateActive || (isHlsSrc && Hls.isSupported()) ? undefined : currentSrc}
              crossOrigin={isHlsSrc ? "anonymous" : undefined}
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
          <AdsterraAdManager isPremium={isPremium} videoEl={videoRef.current} />

          {subtitleOverlayText && !isEmbedPlayback && (
            <div
              className="pointer-events-none absolute inset-x-3 z-[8] flex justify-center"
              style={{ bottom: `clamp(8px, ${captionVerticalOffset}%, 28%)` }}
            >
              <div
                className="max-w-[92%] px-1 text-center font-medium leading-snug text-white whitespace-pre-line"
                style={{ fontSize: `${Math.round(12 * captionFontScale)}px`, lineHeight: Math.max(1.2, 1.34 - ((captionFontScale - 1) * 0.08)) }}
              >
                {subtitleOverlayText}
              </div>
            </div>
          )}

          {/* Video Error Banner — non-blocking, controls always remain accessible above (z-40) */}
          {videoError && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[5] pointer-events-none px-3 max-w-[90%]">
              <div className="player-glass rounded-xl px-3 py-2 flex items-center gap-2 pointer-events-auto shadow-lg border border-destructive/40 bg-black/70">
                <div className="w-7 h-7 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
                  <X className="w-4 h-4 text-destructive" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-white truncate">Link expired</p>
                  <p className="text-[10px] text-white/70 truncate">All servers failed. Update this episode link.</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setVideoError(false); setIsBuffering(true); const v = videoRef.current; if (v) { v.load(); } }} className="px-2.5 py-1 rounded-md gradient-primary text-[10px] font-semibold shrink-0">
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Loading spinner on top of thumbnail */}
          {showLoaderOverlay && !pendingSuggestion && (
            <div className="absolute inset-0 flex items-center justify-center z-[6] pointer-events-none">
              <div className="player-loader-shell" aria-hidden="true">
                {Array.from({ length: 12 }).map((_, i) => <span key={i} className="player-loader-petal" />)}
              </div>
            </div>
          )}

          {/* Switching to a suggested anime — instant feedback overlay */}
          {pendingSuggestion && (
            <div className="absolute inset-0 z-[8] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
              {pendingSuggestion.poster && (
                <img
                  src={optimizedImageUrl(pendingSuggestion.poster, "poster")}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover opacity-25 blur-xl scale-110"
                />
              )}
              <div className="relative flex flex-col items-center gap-3 px-4 text-center">
                <div className="player-loader-shell" aria-hidden="true">
                  {Array.from({ length: 12 }).map((_, i) => <span key={i} className="player-loader-petal" />)}
                </div>
                <p className="text-[13px] font-semibold text-white/90 line-clamp-2 max-w-[80%]">
                  Loading <span className="text-primary">{pendingSuggestion.title}</span>…
                </p>
              </div>
            </div>
          )}

          {skipIndicator && (
            skipIndicator.side === "center" ? (
              <div className="absolute top-1/2 left-1/2 skip-pill skip-pill--center" aria-hidden="true">
                <span className="text-lg leading-none font-bold">{skipIndicator.text}</span>
              </div>
            ) : (
              <div
                key={skipIndicator.side + skipIndicator.text}
                className={`absolute top-1/2 -translate-y-1/2 skip-pill ${skipIndicator.side === "left" ? "left-[8%]" : "right-[8%]"}`}
                aria-hidden="true"
              >
                {skipIndicator.side === "left" ? <Rewind className="w-6 h-6" /> : <FastForward className="w-6 h-6" />}
                <span className="skip-pill__num">{skipIndicator.text}</span>
              </div>
            )
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

          {/* ===== EMBED-ONLY MINIMAL OVERLAY (AnimeStill iframe) =====
              AN's iframe has its own play/pause/seek/quality. We only show:
              - Server change  - Fullscreen (since AN iframe lacks one)
              Sits at top-right and does NOT cover the iframe so AN's controls remain tappable. */}
          {isEmbedPlayback && !locked && (
            <div
              className={`absolute top-2 inset-x-2 z-30 flex items-center justify-between transition-opacity duration-200 ${showAnOverlay ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
              onMouseEnter={() => { if (anOverlayTimer.current) clearTimeout(anOverlayTimer.current); }}
              onMouseLeave={scheduleAnOverlayHide}
            >
              <button onClick={(e) => { e.stopPropagation(); handleBackPress(); }} className="player-touch-button w-9 h-9 rounded-full flex items-center justify-center bg-black/70 backdrop-blur" aria-label="Back">
                <ArrowLeft className="w-4 h-4 text-white" />
              </button>
              <div className="flex items-center gap-2">
              {availableQualities.filter(opt => opt.label !== "Auto").length > 1 && (
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); setShowServerPanel(!showServerPanel); }} className={`player-touch-button h-8 px-2.5 rounded-full flex items-center justify-center gap-1 bg-black/70 backdrop-blur ${manualServerSelected ? 'ring-1 ring-primary' : ''}`}>
                    <Server className="w-3.5 h-3.5 text-white" />
                    <span className="text-[10px] font-medium text-white">{currentQuality === "Auto" ? (availableQualities.filter(opt => opt.label !== "Auto")[0]?.label || "Server 1") : currentQuality}</span>
                  </button>
                  {showServerPanel && (
                    <div data-player-panel="true" className="absolute top-10 right-0 player-glass rounded-xl p-2 z-30 min-w-[150px] max-h-[min(70dvh,320px)] overflow-y-auto overscroll-contain touch-pan-y shadow-lg [scrollbar-width:thin]" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", touchAction: "pan-y" }} onClick={(e) => e.stopPropagation()} onWheel={stopPanelWheelPropagation}>
                      <p className="text-[9px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Server</p>
                      {availableQualities.filter(opt => opt.label !== "Auto").map((opt, idx) => (
                        <button key={opt.label + opt.src} onClick={() => { switchQuality(opt); setShowServerPanel(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-xs ${currentQuality === opt.label || (currentQuality === "Auto" && idx === 0) ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button onClick={(e) => { e.stopPropagation(); setCropIndex((cropIndex + 1) % 3); }} className="player-touch-button h-8 px-2.5 rounded-full flex items-center justify-center gap-1 bg-black/70 backdrop-blur">
                <Crop className="w-3.5 h-3.5 text-white" />
                <span className="text-[10px] font-medium text-white">{cropLabels[cropIndex]}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                className="player-touch-button w-9 h-9 rounded-full flex items-center justify-center bg-black/70 backdrop-blur"
                aria-label="Fullscreen"
              >
                {isFullscreen ? <Minimize className="w-4 h-4 text-white" /> : <Maximize className="w-4 h-4 text-white" />}
              </button>
              </div>
            </div>
          )}

          {/* Controls Overlay - smooth fade in/out (RS direct video only) */}
          {!locked && !isEmbedPlayback && (
            <div
              className={`absolute inset-0 flex flex-col justify-between text-white transition-opacity duration-300 ease-out ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
              style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 30%, transparent 60%, rgba(0,0,0,0.7) 70%)" }}
            >
              {/* Top controls */}
              <div className="flex justify-between items-start gap-1.5 px-3 pt-3">
                <button onClick={(e) => { e.stopPropagation(); handleBackPress(); }} className="player-touch-button h-10 w-10 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-90" aria-label="Back">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex max-w-[calc(100%-52px)] items-center justify-end gap-1.5 overflow-x-auto scrollbar-hide pb-1">
                <button onClick={(e) => { e.stopPropagation(); setCropIndex((cropIndex + 1) % 3); }} className="player-touch-button h-9 px-3 rounded-full flex items-center justify-center gap-1.5 transition-transform duration-150 active:scale-95 shrink-0">
                  <Crop className="w-4 h-4" />
                  <span className="text-[12px] font-semibold">{cropLabels[cropIndex]}</span>
                </button>
                {isHlsSrc ? (
                  <button className="player-touch-button h-9 px-3 rounded-full flex items-center justify-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Server className="w-4 h-4" />
                    <span className="text-[12px] font-semibold">HLS</span>
                  </button>
                ) : effectiveVideoServers.length >= 1 && !noServerSwitch ? (
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowServerPanel((p) => !p); setShowQualityPanel(false); setShowAudioPanel(false); setShowCcPanel(false); setShowSettings(false); }}
                      className={`player-touch-button h-9 px-3 rounded-full flex items-center justify-center gap-1.5 transition-transform duration-150 active:scale-95 shrink-0 ${manualServerSelected ? 'ring-1 ring-primary bg-primary/25' : ''}`}
                    >
                      <Server className="w-4 h-4" />
                      <span className="text-[12px] font-semibold whitespace-nowrap max-w-[88px] truncate">{effectiveVideoServers[activeServerIndex]?.name || `Server ${activeServerIndex + 1}`}</span>
                    </button>
                    {showServerPanel && (
                      <div data-player-panel="true" className={`absolute top-9 right-0 ${panelBaseClass} min-w-[150px] max-h-[min(70dvh,320px)]`} style={panelBaseStyle} onClick={stopPanelPointerPropagation} onTouchStart={keepPanelScrollActive} onTouchMove={keepPanelScrollActive} onTouchEnd={stopPanelPointerPropagation} onScroll={keepPanelScrollActive} onWheel={stopPanelWheelPropagation}>
                        <p className="text-[9px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Server</p>
                        {effectiveVideoServers.map((srv, idx) => {
                          const isLocked = srv.locked && !isPremium;
                          const isActive = activeServerIndex === idx;
                          return (
                            <button
                              key={`${srv.name || "server"}-${idx}`}
                              onClick={() => { if (!isLocked) { switchServer(idx); } }}
                              disabled={isLocked}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between gap-1 ${
                                isActive ? "gradient-primary font-bold text-white" : isLocked ? "opacity-45 cursor-not-allowed" : "hover:bg-foreground/10"
                              }`}
                            >
                              <span className="flex items-center gap-1.5">
                                {srv.locked && <Lock className="w-3 h-3 text-accent" />}
                                {srv.name || `Server ${idx + 1}`}
                              </span>
                              {!isLocked && isActive && <Check className="w-3 h-3" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
                {isHlsSrc && (hlsAudioOptions.length > 0 || hlsSubtitleOptions.length > 0) && (
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowCcPanel((p) => !p); setCcTab(currentHlsSubtitle >= 0 ? "subtitle" : "audio"); setShowAudioPanel(false); setShowQualityPanel(false); setShowSettings(false); }}
                      className={`player-touch-button h-9 px-3 rounded-full flex items-center justify-center gap-1.5 transition-transform duration-150 active:scale-95 shrink-0 ${currentHlsSubtitle >= 0 ? "ring-1 ring-primary" : ""}`}
                    >
                      <Subtitles className="w-4 h-4" />
                      <span className="text-[12px] font-semibold">CC</span>
                    </button>
                    {showCcPanel && (
                      <div data-player-panel="true" className={`absolute top-9 right-0 ${panelBaseClass} w-[210px] max-w-[82vw] max-h-[min(75dvh,360px)]`} style={panelBaseStyle} onClick={stopPanelPointerPropagation} onTouchStart={keepPanelScrollActive} onTouchMove={keepPanelScrollActive} onTouchEnd={stopPanelPointerPropagation} onScroll={keepPanelScrollActive} onWheel={stopPanelWheelPropagation}>
                        <div className="flex gap-1 mb-2">
                          <button onClick={() => setCcTab("audio")} className={`flex-1 text-[10px] px-2 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1 ${ccTab === "audio" ? "gradient-primary text-white" : "bg-foreground/10"}`}><Languages className="w-3 h-3" /> Audio</button>
                          <button onClick={() => setCcTab("subtitle")} className={`flex-1 text-[10px] px-2 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1 ${ccTab === "subtitle" ? "gradient-primary text-white" : "bg-foreground/10"}`}><Subtitles className="w-3 h-3" /> Subtitle</button>
                        </div>
                        {ccTab === "audio" ? (
                          <div className="space-y-0.5">
                            {hlsAudioOptions.length === 0 ? <p className="text-[10px] text-muted-foreground text-center py-3">No audio tracks in stream</p> : hlsAudioOptions.map((track, i) => (
                              <button key={i} onClick={() => switchHlsAudio(i)} className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] transition-all flex items-center justify-between gap-1 ${currentHlsAudio === i ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"}`}><span className="truncate flex-1 min-w-0">{track.label || track.language || `Audio ${i + 1}`}</span>{currentHlsAudio === i && <Check className="w-3 h-3 shrink-0" />}</button>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <button onClick={() => switchHlsSubtitle(-1)} className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] transition-all flex items-center justify-between ${currentHlsSubtitle < 0 ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"}`}><span>Off</span>{currentHlsSubtitle < 0 && <Check className="w-3 h-3" />}</button>
                            {hlsSubtitleOptions.length === 0 ? <p className="text-[10px] text-muted-foreground text-center py-2">No subtitles in stream</p> : hlsSubtitleOptions.map((st) => (
                              <button key={st.id} onClick={() => switchHlsSubtitle(st.id)} className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] transition-all flex items-center justify-between gap-1 ${currentHlsSubtitle === st.id ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"}`}><span className="truncate flex-1 min-w-0">{st.label || st.language || `Subtitle ${st.id + 1}`}</span>{currentHlsSubtitle === st.id && <Check className="w-3 h-3 shrink-0" />}</button>
                            ))}
                            <div className="mt-2 space-y-2 rounded-lg bg-foreground/10 px-2 py-2">
                              <div>
                                <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                                  <span>Caption size</span>
                                  <span>{captionFontScale.toFixed(1)}x</span>
                                </div>
                                <input
                                  type="range"
                                  min={0.8}
                                  max={1.8}
                                  step={0.1}
                                  value={captionFontScale}
                                  onChange={(e) => setCaptionFontScale(Number(e.target.value))}
                                  className="w-full accent-primary"
                                />
                              </div>
                              <div>
                                <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                                  <span>Caption position</span>
                                  <span>{captionVerticalOffset}%</span>
                                </div>
                                <input
                                  type="range"
                                  min={4}
                                  max={28}
                                  step={1}
                                  value={captionVerticalOffset}
                                  onChange={(e) => setCaptionVerticalOffset(Number(e.target.value))}
                                  className="w-full accent-primary"
                                />
                              </div>
                            </div>
                            {!!subtitleStatusMessage && (
                              <div className={`mt-1 rounded-lg px-2 py-1.5 text-[10px] leading-relaxed ${subtitleStatusTone === "warning" ? "bg-destructive/15 text-destructive" : subtitleStatusTone === "success" ? "bg-primary/15 text-primary" : "bg-foreground/10 text-muted-foreground"}`}>
                                {subtitleStatusMessage}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={(e) => { e.stopPropagation(); setLocked(true); resetHideTimer(); }} className="player-touch-button w-7 h-7 rounded-lg flex items-center justify-center transition-transform duration-150 active:scale-95 shrink-0">
                  <Lock className="w-3 h-3" />
                </button>
                </div>
              </div>

              {/* Center play */}
              <div className="flex items-center justify-center gap-7">
                <button onClick={(e) => { e.stopPropagation(); seek(-10); }} className="player-touch-button w-11 h-11 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                  <SkipBack className="w-5 h-5" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="player-touch-button player-touch-button--primary w-14 h-14 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                  {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-0.5" />}
                </button>
                <button onClick={(e) => { e.stopPropagation(); seek(10); }} className="player-touch-button w-11 h-11 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                  <SkipForward className="w-5 h-5" />
                </button>
              </div>

              {/* Bottom controls */}
              <div className="px-2.5 pb-2.5">
                {/* Progress bar - GPU accelerated with will-change */}
                <div
                  ref={progressBarRef}
                  className="w-full h-4 flex items-center cursor-pointer mb-1.5 relative touch-none"
                  onClick={(e) => { e.stopPropagation(); handleProgressClick(e); }}
                  onTouchStart={handleProgressTouchStart}
                  onTouchMove={handleProgressTouchMove}
                  onTouchEnd={handleProgressTouchEnd}
                >
                  <div className="w-full h-1 bg-foreground/20 rounded-full relative">
                    <div
                      ref={progressRef}
                      className="h-full gradient-primary rounded-full relative"
                      style={{ width: `${progress}%` }}
                    >
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary shadow-[0_0_10px_hsla(355,85%,55%,0.6)]" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-between items-center gap-3 flex-nowrap">
                  <div className="flex items-center gap-2 shrink-0 min-w-0">
                    <span ref={timeDisplayRef} className="text-[10px] font-semibold whitespace-nowrap tabular-nums leading-none">{formatTime(currentTime)} / {formatTime(duration)}</span>
                    <button onClick={(e) => {
                      e.stopPropagation();
                      applyPlayerVolume(boostedVolume, !muted);
                    }} className="w-6 h-6 flex items-center justify-center shrink-0">
                      {muted || boostedVolume <= 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 justify-end flex-nowrap min-w-0 overflow-x-auto scrollbar-hide pb-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const rates = [1, 1.25, 1.5, 1.75, 2, 0.75];
                        const idx = rates.indexOf(playbackRate);
                        const next = rates[(idx + 1) % rates.length] ?? 1;
                        setSpeed(next);
                      }}
                      className={`text-[10px] px-2 py-1 rounded-md shrink-0 leading-none font-semibold transition-all ${playbackRate !== 1 ? "gradient-primary text-white" : "player-control-chip"}`}
                      aria-label="Playback speed"
                    >{playbackRate}x</button>
                    {availableQualities.length > 1 && (
                      <div className="relative shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowQualityPanel(!showQualityPanel); setShowAudioPanel(false); setShowCcPanel(false); setShowSettings(false); setShowServerPanel(false); }}
                          className={`text-[10px] px-2 py-1 rounded-md font-semibold transition-all shrink-0 ${
                            currentQuality !== "Auto" ? "gradient-primary text-white" : "player-control-chip"
                          }`}
                        >
                          {currentQuality}
                        </button>
                        {showQualityPanel && (
                          <div data-player-panel="true" className={`absolute bottom-8 right-0 ${panelBaseClass} min-w-[120px] max-h-[min(70dvh,320px)]`} style={panelBaseStyle} onClick={stopPanelPointerPropagation} onTouchStart={keepPanelScrollActive} onTouchMove={keepPanelScrollActive} onTouchEnd={stopPanelPointerPropagation} onScroll={keepPanelScrollActive} onWheel={stopPanelWheelPropagation}>
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
                      <div className="relative shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowAudioPanel(!showAudioPanel); setShowQualityPanel(false); setShowCcPanel(false); setShowSettings(false); setShowServerPanel(false); }}
                           className={`text-[10px] px-2 py-1 rounded-md font-semibold transition-all flex items-center gap-1 max-w-[86px] shrink-0 ${
                            currentAudioTrack !== "Default" ? "gradient-primary text-white" : "player-control-chip"
                          }`}
                        >
                          <span className="truncate">🎧 {currentAudioTrack === "Default" ? "Audio" : currentAudioTrack}</span>
                        </button>
                        {showAudioPanel && (
                          <div data-player-panel="true" className={`absolute bottom-8 right-0 ${panelBaseClass} w-[180px] max-w-[78vw] max-h-[min(70dvh,320px)]`} style={panelBaseStyle} onClick={stopPanelPointerPropagation} onTouchStart={keepPanelScrollActive} onTouchMove={keepPanelScrollActive} onTouchEnd={stopPanelPointerPropagation} onScroll={keepPanelScrollActive} onWheel={stopPanelWheelPropagation}>
                            <p className="text-[9px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Audio Track</p>
                            <button onClick={resetToDefaultAudio}
                              className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] transition-all flex items-center justify-between ${
                                currentAudioTrack === "Default" ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                              }`}>
                              <span>Default</span>
                              {currentAudioTrack === "Default" && <Check className="w-3 h-3" />}
                            </button>
                            {audioTrackOptions.map((track, idx) => (
                              <button key={idx} onClick={() => switchAudioTrack(track)}
                                className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] transition-all flex items-center justify-between gap-1 ${
                                  currentAudioTrack === track.label ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                                }`}>
                                <span className="truncate flex-1 min-w-0">{track.label}</span>
                                {currentAudioTrack === track.label && <Check className="w-3 h-3 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {onNextEpisode && (
                      <button onClick={(e) => { e.stopPropagation(); onNextEpisode(); }} className="player-control-chip text-[10px] px-2 py-1 rounded-md flex items-center gap-1 transition-transform duration-150 active:scale-95 shrink-0 font-semibold">
                        Next <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); setSettingsTab("speed"); setShowAudioPanel(false); setShowQualityPanel(false); setShowCcPanel(false); setShowServerPanel(false); }} className="player-touch-button w-7 h-7 rounded-lg flex items-center justify-center transition-transform duration-150 active:scale-95 shrink-0">
                      <Settings className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="player-touch-button w-7 h-7 rounded-lg flex items-center justify-center transition-transform duration-150 active:scale-95 shrink-0">
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
            <div data-player-panel="true" className={`absolute bottom-16 right-3 ${panelBaseClass} z-20 w-[180px] max-w-[72vw] max-h-[min(70dvh,320px)]`} style={panelBaseStyle} onClick={stopPanelPointerPropagation} onTouchStart={keepPanelScrollActive} onTouchMove={keepPanelScrollActive} onTouchEnd={stopPanelPointerPropagation} onScroll={keepPanelScrollActive} onWheel={stopPanelWheelPropagation}>
              <button onClick={() => setShowSettings(false)} className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-foreground/20 flex items-center justify-center hover:bg-foreground/30 transition-all">
                <X className="w-3 h-3" />
              </button>
              <div className="flex gap-1 mb-2 pr-6 flex-wrap">
                <button onClick={() => setSettingsTab("speed")} className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-all ${settingsTab === "speed" ? "gradient-primary text-white" : "bg-foreground/10 hover:bg-foreground/20"}`}>
                  Speed
                </button>
                <button onClick={() => setSettingsTab("quality")} className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-all ${settingsTab === "quality" ? "gradient-primary text-white" : "bg-foreground/10 hover:bg-foreground/20"}`}>
                  Quality
                </button>
                {audioTrackOptions.length > 0 && (
                  <button onClick={() => setSettingsTab("audio")} className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-all ${settingsTab === "audio" ? "gradient-primary text-white" : "bg-foreground/10 hover:bg-foreground/20"}`}>
                    Audio
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

        {!isFullscreen && !adGateActive && !deviceBlocked && !unlockBlocked && (
          <div className="w-full px-5 pt-4 pb-2">
            <button
              type="button"
              onClick={() => openInlineSheet("info")}
              className="w-full text-left active:opacity-80 transition-opacity"
            >
              <div className="flex items-start gap-2">
                <h2 className="text-[15px] font-bold text-foreground leading-snug flex-1 truncate">{animeMeta.title}</h2>
                <div className="flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-semibold text-muted-foreground flex-shrink-0 mt-1">
                  Info <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-nowrap mt-1.5 text-[12px] text-muted-foreground overflow-hidden">
                <Tv className="w-3.5 h-3.5 text-foreground/60 flex-shrink-0" />
                <span className="text-foreground/25 flex-shrink-0">|</span>
                <span className="flex items-center gap-0.5 flex-shrink-0"><Star className="w-3 h-3 text-primary fill-primary flex-shrink-0" />9.0</span>
                {currentLangLabel ? <><span className="text-foreground/25 flex-shrink-0">|</span><span className="truncate">{currentLangLabel}</span></> : null}
                <span className="text-foreground/25 flex-shrink-0">|</span>
                <span className="truncate capitalize">{seasons && seasons.length > 0 ? "Webseries" : "Movie"}</span>
                {seasons && seasons.length > 0 ? <><span className="text-foreground/25 flex-shrink-0">|</span><span className="truncate">{activeSeasonLabel}</span></> : null}
              </div>
            </button>

            <div className="grid grid-cols-4 gap-1.5 mt-3">
              <button onClick={() => { closeInlineSheets(); handleToggleWatchlist(); }} className={`flex items-center justify-center gap-1 py-2 px-1 rounded-full text-[10px] font-medium transition-colors border ${saved ? 'bg-primary/15 text-primary border-primary/30' : 'bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border-border'}`}>
                <Bookmark className={`w-3 h-3 flex-shrink-0 ${saved ? 'fill-primary' : ''}`} />
                <span className="whitespace-nowrap truncate">{saved ? 'Saved' : 'Add'}</span>
              </button>
              <button onClick={() => { void handleShare(currentSeasonIdx ?? 0, activeEpisodeIdx); }} className="flex items-center justify-center gap-1 py-2 px-1 rounded-full text-[10px] font-medium border transition-colors bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border-border">
                <Share2 className="w-3 h-3 flex-shrink-0" />
                <span>Share</span>
              </button>
              <button onClick={() => openInlineSheet("download", "download")} className={`flex items-center justify-center gap-1 py-2 px-1 rounded-full text-[10px] font-medium border active:scale-95 transition-all ${showDownloadQualityPicker ? 'bg-primary/15 text-primary border-primary/30' : 'bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border-border'}`}>
                <Download className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">Download</span>
              </button>
              <button onClick={() => openInlineSheet("library")} className={`flex items-center justify-center gap-1 py-2 px-1 rounded-full text-[10px] font-medium border active:scale-95 transition-all ${showLibrarySheet ? 'bg-primary/15 text-primary border-primary/30' : 'bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border-border'}`}>
                <FolderDown className="w-3 h-3 flex-shrink-0" />
                <span className="whitespace-nowrap truncate">Library</span>
              </button>
            </div>

            {episodeList && episodeList.length > 0 && (
              <div className="mt-5">
                <div className="flex items-baseline gap-2 mb-3">
                  <h3 className="text-[15px] font-bold text-foreground">Resources</h3>
                </div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <button onClick={() => openInlineSheet("language")} className="inline-flex min-w-[116px] items-center justify-between gap-1.5 px-3 py-2 rounded-[10px] text-xs font-semibold border bg-foreground/[0.06] text-foreground/85 border-border">
                    {currentLangLabel}
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  {seasons && seasons.length > 0 && (
                    <button onClick={() => openInlineSheet("season")} className="inline-flex min-w-[140px] items-center justify-between gap-1.5 px-3 py-2 rounded-[10px] text-xs font-semibold border bg-foreground/[0.06] text-foreground/85 border-border">
                      {activeSeasonLabel}
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="relative -mx-5">
                  <div
                    aria-hidden="true"
                    className="absolute left-0 top-0 z-10 h-11 w-[68px] bg-background pointer-events-none"
                  />
                  {/* Hard left mask: episode cards can only enter from the right side of All; once behind it they never reappear from left/top/bottom. */}
                  <button
                    onClick={() => openInlineSheet("allEpisodes")}
                    className="absolute left-5 top-0 z-20 w-12 h-11 rounded-lg text-[12px] font-bold bg-background text-foreground border border-border transition-transform active:scale-95 flex items-center justify-center"
                    aria-label="All episodes"
                  >
                    All
                  </button>
                  <div
                    className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1 pr-5"
                    style={{ paddingLeft: 76, scrollPaddingLeft: 76, WebkitOverflowScrolling: "touch" }}
                  >
                    {episodeList.map((ep) => (
                      <button
                        key={ep.number}
                        onClick={ep.onClick}
                        className={`flex-shrink-0 w-12 h-11 rounded-lg text-[12px] font-bold transition-colors flex items-center justify-center ${
                          ep.active
                            ? 'bg-gradient-to-br from-amber-400/30 to-yellow-500/15 text-amber-300 border border-amber-400/60'
                            : 'bg-white/[0.07] text-white border border-white/15 active:scale-95'
                        }`}
                      >
                        {String(ep.number).padStart(2, '0')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {!inlineSheetOpen && ((suggestedAnime && suggestedAnime.length > 0) || animeId) && (
              <div className="mt-5">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                  <button onClick={() => setBottomTab("foryou")} className={`text-[13px] font-bold px-3 py-1.5 rounded-full transition-colors ${bottomTab === "foryou" ? "bg-primary text-primary-foreground" : "bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/10"}`}>
                    For you
                  </button>
                  {animeId && (
                    <button onClick={() => setBottomTab("comments")} className={`text-[13px] font-bold px-3 py-1.5 rounded-full transition-colors ${bottomTab === "comments" ? "bg-primary text-primary-foreground" : "bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/10"}`}>
                      Comments
                    </button>
                  )}
                </div>

                {bottomTab === "foryou" && suggestedAnime && suggestedAnime.length > 0 && (
                  <div className="grid grid-cols-3 gap-2.5">
                    {suggestedAnime.slice(0, 15).map((anime, idx) => {
                      const isPending = pendingSuggestion?.id === anime.id;
                      return (
                        <button
                          key={anime.id}
                          onClick={() => {
                            if (pendingSuggestion) return; // ignore rapid double-taps
                            setPendingSuggestion(anime);
                            // Scroll player into view so the user sees the loader
                            try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
                            onSuggestedClick?.(anime);
                          }}
                          disabled={!!pendingSuggestion && !isPending}
                          className={`group text-left transition-transform duration-150 ${isPending ? "scale-95" : "active:scale-95"} ${pendingSuggestion && !isPending ? "opacity-50" : ""}`}
                        >
                          <div className={`relative aspect-[2/3] rounded-lg overflow-hidden bg-foreground/5 ${isPending ? "magic-card-pulse" : ""}`}>
                            {anime.poster ? (
                              <img src={optimizedImageUrl(anime.poster, "poster")} alt={anime.title} loading={idx < 9 ? "eager" : "lazy"} decoding="async" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No image</div>
                            )}
                            {anime.language && <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-semibold text-white">{anime.language}</span>}
                            {/* Gemini-style border pulse handled by magic-card-pulse class on the wrapper above — no extra spinner here */}

                          </div>
                          <p className={`text-xs font-medium line-clamp-2 leading-tight mt-1.5 ${isPending ? "text-primary" : "text-foreground"}`}>{anime.title}</p>
                        </button>
                      );
                    })}
                  </div>
                )}

                {bottomTab === "comments" && animeId && (
                  <div className="min-w-0 overflow-hidden">
                    <VideoEngagement animeId={animeId} title={title} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Device limit is now enforced at login time - no overlay needed */}

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
                    <button
                      key={link.service.id || i}
                      onClick={() => handleOpenAdLink(link.shortUrl, link.service)}
                      className="w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all hover:scale-105 text-white"
                      style={{ background: link.service.color || (i === 0 ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "linear-gradient(135deg, #f59e0b, #ef4444)") }}
                    >
                      <ExternalLink className="w-4 h-4" />
                      {link.service.icon || "🔓"} {link.service.name || `Unlock ${i + 1}`}
                      {link.service.durationHours ? (
                        <span className="text-[10px] opacity-80 ml-1">({link.service.durationHours}h access)</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
              {/* Tutorial Video Buttons */}
              {tutorialVideos.length > 0 ? (
                <div className="space-y-2">
                  {tutorialVideos.map((vid, idx) => (
                    <button key={idx}
                      onClick={() => { setActiveTutorialIdx(idx); setShowTutorialVideo(true); }}
                      className="w-full py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium flex items-center justify-center gap-2 transition-all hover:scale-105 text-sm"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {vid.title || `Tutorial ${idx + 1}`}
                    </button>
                  ))}
                </div>
              ) : tutorialLink ? (
                <button
                  onClick={() => { setActiveTutorialIdx(-1); setShowTutorialVideo(true); }}
                  className="w-full py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium flex items-center justify-center gap-2 transition-all hover:scale-105 text-sm"
                >
                  <Play className="w-3.5 h-3.5" />
                  How to open my link
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

        {!isFullscreen && showInfoSheet && (
          <div className={inlineSheetFixedClass} style={inlineSheetStyle} data-player-panel="true">
            <div className="sticky top-0 z-10 bg-black flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
              <h3 className="text-[15px] font-bold tracking-tight">More details</h3>
              <button onClick={handleInlineSheetClose} className="h-8 w-8 flex items-center justify-center text-white/70 active:scale-95">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="h-px bg-white/10" />
            <div className="px-4 pt-3 pb-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-[60px] h-[84px] shrink-0 overflow-hidden rounded-[8px] bg-white/5">
                  {anime?.poster ? <img src={optimizedImageUrl(anime.poster, "poster")} alt={anime?.title || title} className="w-full h-full object-cover" loading="eager" decoding="async" /> : null}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <h4 className="text-[14px] font-bold leading-tight">{anime?.title || title}</h4>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-white/65">
                    {infoMetaItems.map((item, i) => (
                      <span key={item} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-white/25">|</span>}
                        <span>{item}</span>
                      </span>
                    ))}
                    {!!seasons?.length && (
                      <span className="flex items-center gap-1.5">
                        <span className="text-white/25">|</span>
                        <span>{seasons.length} season{seasons.length > 1 ? 's' : ''}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <h5 className="text-[13px] font-semibold">Info</h5>
                <p className="text-[12px] leading-5 text-white/70">{anime?.storyline || 'No storyline available yet.'}</p>
              </div>

              {!!infoCast.length && (
                <div className="space-y-2">
                  <h5 className="text-[13px] font-semibold">Starring ({anime?.cast?.length || infoCast.length})</h5>
                  <div className="grid grid-cols-4 gap-2.5">
                    {infoCast.map((person, index) => (
                      <div key={`${person.name}-${index}`} className="min-w-0">
                        <div className="aspect-[3/4] overflow-hidden rounded-[8px] bg-white/[0.06]">
                          {person.photo ? <img src={person.photo} alt={person.name} className="w-full h-full object-cover" loading="lazy" /> : null}
                        </div>
                        <p className="mt-1.5 text-[11px] font-medium text-white line-clamp-2">{person.name}</p>
                        {person.character ? <p className="mt-0.5 text-[10px] leading-4 text-white/55 line-clamp-2">{person.character}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

{/* Add to list & Share now act as direct toggles — no inline sheet */}

        {!isFullscreen && showLibrarySheet && (
          <div className={inlineSheetFixedClass} style={inlineSheetStyle} data-player-panel="true">
            <div className="sticky top-0 z-10 bg-black flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
              <h3 className="text-[15px] font-bold tracking-tight">My list</h3>
              <button onClick={handleInlineSheetClose} className="h-8 w-8 flex items-center justify-center text-white/70 active:scale-95">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="h-px bg-white/10" />
            <div className="px-3 pt-3 pb-6">
              {watchlistItems.length === 0 ? (
                <div className="rounded-[10px] bg-white/[0.05] px-3 py-6 text-center text-[12px] text-white/60">
                  No items in your list yet.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  {watchlistItems.slice(0, 18).map((item: any) => (
                    <button
                      key={String(item?.id || item?.title)}
                      onClick={() => {
                        closeInlineSheets();
                        onLibraryClick?.(String(item?.id || ""));
                      }}
                      className="text-left"
                    >
                      <div className="aspect-[2/3] overflow-hidden rounded-[10px] bg-white/[0.06] border border-white/10">
                        {item?.poster ? <img src={optimizedImageUrl(item.poster, "poster")} alt={item?.title || "Saved item"} className="w-full h-full object-cover" loading="eager" decoding="async" /> : null}
                      </div>
                      <p className="mt-1.5 text-[11px] font-medium leading-4 text-white line-clamp-2">{item?.title || "Untitled"}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!isFullscreen && showLanguageSheet && (
          <div className={inlineSheetFixedClass} style={inlineSheetStyle} data-player-panel="true">
            <div className="sticky top-0 z-10 bg-black flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
              <h3 className="text-[15px] font-bold tracking-tight">Select language</h3>
              <button onClick={handleInlineSheetClose} className="h-8 w-8 flex items-center justify-center text-white/70 active:scale-95">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="h-px bg-white/10" />
            <div className="px-3 pt-3 pb-6 space-y-2">
              {(sheetOrigin === "download" ? downloadLanguageChoices : languageOptions).map((label) => {
                const active = label === (sheetOrigin === "download" ? currentDownloadLanguageLabel : currentLangLabel);
                const track = normalizedLanguageTracks.find((item) => item.label === label);
                return (
                  <button
                    key={label}
                    onClick={() => {
                      if (sheetOrigin === "download") {
                        setSelectedDownloadLanguageLabel(label);
                      } else if (isAnimeSaltContent && track) {
                        switchAudioTrack({ language: track.language, label: track.label, src: track.link, src480: track.link480, src720: track.link720, src1080: track.link1080, src4k: track.link4k });
                      } else if (seasons?.length && onLanguageChange) {
                        onLanguageChange(label);
                      } else if (track) switchAudioTrack({ language: track.language, label: track.label, src: track.link, src480: track.link480, src720: track.link720, src1080: track.link1080, src4k: track.link4k });
                      else setSelectedLanguageLabel(label);
                      if (sheetOrigin === "download") {
                        setShowLanguageSheet(false);
                        setShowDownloadQualityPicker(true);
                        return;
                      }
                      if (sheetOrigin === "share") {
                        setShowLanguageSheet(false);
                        setShowShareSheet(true);
                        return;
                      }
                      closeInlineSheets();
                    }}
                    className={`w-full rounded-[10px] px-3 py-3 text-center text-[13px] font-semibold transition-all active:scale-[0.99] ${
                      active
                        ? 'bg-gradient-to-r from-cyan-500/25 via-teal-500/20 to-emerald-500/25 text-cyan-300'
                        : 'bg-white/[0.07] text-white/85 hover:bg-white/[0.1]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!isFullscreen && showSeasonSheet && !!seasons?.length && (
          <div className={inlineSheetFixedClass} style={inlineSheetStyle} data-player-panel="true">
            <div className="sticky top-0 z-10 bg-black flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
              <h3 className="text-[15px] font-bold tracking-tight">{seasons.length} season{seasons.length > 1 ? 's' : ''}</h3>
              <button onClick={handleInlineSheetClose} className="h-8 w-8 flex items-center justify-center text-white/70 active:scale-95">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="h-px bg-white/10" />
            <div className="px-3 pt-3 pb-6 space-y-2">
              {seasons.map((_, idx) => {
                const label = getShortSeasonLabel(seasons[idx]?.name, idx);
                const activeSeasonIndex = sheetOrigin === "share"
                  ? sharePanelSeasonIdx
                  : sheetOrigin === "download"
                    ? downloadPanelSeasonIdx
                    : (currentSeasonIdx ?? 0);
                const active = idx === activeSeasonIndex;
                return (
                  <button
                    key={`${label}-${idx}`}
                    onClick={() => {
                      if (sheetOrigin === "share") {
                        setSharePanelSeasonIdx(idx);
                        setSharePanelEpisodeIdx(0);
                        setShowSeasonSheet(false);
                        setShowShareSheet(true);
                        return;
                      }
                      setDownloadPanelSeasonIdx(idx);
                      setDlSelectedEpisodes(new Set([0]));
                      if (sheetOrigin === "download") {
                        setShowSeasonSheet(false);
                        setShowDownloadQualityPicker(true);
                        return;
                      }
                      onSeasonChange?.(idx);
                      closeInlineSheets();
                    }}
                    className={`w-full rounded-[10px] px-3 py-3 text-center text-[13px] font-semibold transition-all active:scale-[0.99] ${
                      active
                        ? 'bg-gradient-to-r from-cyan-500/25 via-teal-500/20 to-emerald-500/25 text-cyan-300'
                        : 'bg-white/[0.07] text-white/85 hover:bg-white/[0.1]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!isFullscreen && showAllEpisodesSheet && episodeList && episodeList.length > 0 && (
          <div className={inlineSheetFixedClass} style={inlineSheetStyle} data-player-panel="true">
            <div className="sticky top-0 z-10 bg-black flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
              <h3 className="text-[15px] font-bold tracking-tight">All episodes</h3>
              <button onClick={handleInlineSheetClose} className="h-8 w-8 flex items-center justify-center text-white/70 active:scale-95">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="h-px bg-white/10" />
            <div className="px-4 pt-4 pb-8">
              <div className="grid grid-cols-6 gap-2">
                {episodeList.map((ep) => (
                  <button
                    key={ep.number}
                    onClick={() => { ep.onClick(); closeInlineSheets(); }}
                    className={`aspect-square rounded-lg text-sm font-bold transition-colors flex items-center justify-center ${
                      ep.active
                        ? 'bg-gradient-to-br from-amber-400/30 to-yellow-500/20 text-amber-300 border border-amber-400/70 shadow-[0_0_14px_-2px_hsl(45_95%_55%/0.5)]'
                        : 'bg-white/[0.06] text-white/85 border border-white/10 active:scale-95'
                    }`}
                  >
                    {String(ep.number).padStart(2, '0')}
                  </button>
                ))}
              </div>
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

        {/* AN Download Not-Available overlay (always rendered, even in embed mode) */}
        {!isFullscreen && !adGateActive && showDownloadQualityPicker && anime?.source === "animesalt" && (
          <div
            className="fixed left-0 right-0 bottom-0 z-[260] border-t border-white/10 bg-black text-white flex flex-col overflow-hidden"
            style={inlineSheetStyle}
            data-player-panel="true"
          >
            <div className="sticky top-0 z-10 bg-black flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
              <p className="text-[15px] font-bold tracking-tight text-white truncate">Download</p>
              <button
                onClick={() => { closeInlineSheets(); }}
                className="h-8 w-8 flex items-center justify-center text-white/70 active:scale-95 flex-shrink-0 ml-3"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 pt-7 pb-8 flex flex-col items-center text-center gap-4 flex-1 overflow-y-auto">
              <div className="w-16 h-16 rounded-full bg-amber-400/15 border border-amber-400/40 flex items-center justify-center">
                <Download className="w-7 h-7 text-amber-300" />
              </div>
              <h3 className="text-[17px] font-bold text-white">Download not available</h3>
              <p className="text-[13px] leading-relaxed text-white/75 max-w-sm">
                Sorry — <span className="font-bold text-amber-300">AN</span> videos can&apos;t be downloaded.
                Only <span className="font-bold text-amber-300">RS</span> videos support offline download.
                Please look for the <span className="font-bold text-amber-300">RS</span> version of this title to enjoy it offline.
              </p>
              <p className="text-[12px] text-white/55">Thanks for visiting 💛</p>
              <button
                onClick={() => { closeInlineSheets(); }}
                className="mt-2 px-7 py-2.5 rounded-full bg-white text-black text-[13px] font-bold active:scale-95 transition-transform inline-flex items-center gap-2"
              >
                <X className="w-4 h-4" /> Close
              </button>
            </div>
          </div>
        )}

        {/* Download Button (single) + Multi-Episode Picker + Offline Playback */}
        {!isFullscreen && !adGateActive && !hideDownload && !isEmbedPlayback && anime?.source !== "animesalt" && (() => {
          // Check if this episode is already saved in IndexedDB
          const savedEpisode = downloadedEpisodes.find(d => d.subtitle === subtitle);
          const isAlreadySaved = !!savedEpisode;

          const deriveServerDownloadCandidates = (rawUrl: string) => {
            const seen = new Set<string>();
            const ordered: string[] = [];
            const push = (value?: string | null) => {
              const clean = String(value || "").trim();
              if (!clean || seen.has(clean)) return;
              seen.add(clean);
              ordered.push(clean);
            };
            if (effectiveVideoServers.length > 0) {
              push(applyServerDomain(rawUrl, activeServerIndex));
              effectiveVideoServers.forEach((_, index) => push(applyServerDomain(rawUrl, index)));
            }
            push(rawUrl);
            return ordered;
          };
          const buildDownloadFileName = (label: string, quality?: string) => {
            const parts = [label, quality && quality !== "Auto" ? quality : ""]
              .map((part) => String(part || "").trim())
              .filter(Boolean);
            return `${parts.join(" - ") || "video"}.mp4`;
          };
          const getDownloadUrl = (u: string, quality: string, sub?: string, fallbackUrls: string[] = []): string => {
            const candidates = [...deriveServerDownloadCandidates(u), ...fallbackUrls]
              .filter(Boolean)
              .filter((candidate) => !String(candidate).includes("/functions/v1/video-proxy?"));

            const managedAlready = [u, ...candidates].find((candidate) => String(candidate).includes("/functions/v1/video-download?"));
            if (managedAlready) return managedAlready;

            const directCandidate = [u, ...candidates].find((candidate) => isDirectDownloadCandidate(candidate));
            if (!directCandidate) return "";

            return buildVideoDownloadUrl(directCandidate, buildDownloadFileName(String(sub || title), quality)) || "";
          };

          const buildDlId = (q: string, sub: string) =>
            `${animeId || title}::${sub || "movie"}::${q || "Auto"}`
              .replace(/\s+/g, "_")
              .toLowerCase();

          const pickEpUrlForQuality = (ep: DownloadEpisodeOption, quality: string): string => {
            return ep.qualityLinks[quality] || "";
          };

          const hasMultiEpisodes = !!(seasons && seasons.length > 0 && seasons.some((s) => (s.episodes?.length || 0) > 0));
          const panelSeason = seasons && seasons[downloadPanelSeasonIdx] ? seasons[downloadPanelSeasonIdx] : null;
          const panelEpisodes = downloadEpisodes;

          const toggleEpisode = (idx: number) => {
            setDlSelectedEpisodes((prev) => {
              const next = new Set(prev);
              if (next.has(idx)) next.delete(idx); else next.add(idx);
              return next;
            });
          };

          const toggleAll = () => {
            setDlSelectedEpisodes((prev) => {
              if (prev.size === panelEpisodes.length) return new Set();
              return new Set(panelEpisodes.map((episode) => episode.index));
            });
          };

          const closePanel = () => {
            closeInlineSheets();
            setDlSelectedEpisodes(new Set());
          };

          const startMovieDownload = async (quality: string) => {
            const { toast } = await import("sonner");
            const movieLabel = String(title || subtitle || "video").trim();
            const directHttpsUrl = getDownloadUrl(src, quality, movieLabel, [src]);
            if (!directHttpsUrl) { toast.error("Download not available"); return; }
            downloadManager.startDownload({
              id: buildDlId(quality, movieLabel),
              url: directHttpsUrl,
              title,
              subtitle: movieLabel,
              poster,
              quality,
              fileName: buildDownloadFileName(movieLabel, quality),
            });
            closePanel();
          };

          const startSelectedDownloads = async (quality: string) => {
            if (!panelSeason || dlSelectedEpisodes.size === 0) {
              toast.error("Select at least one episode");
              return;
            }
            const orderedIdxs = Array.from(dlSelectedEpisodes).sort((a, b) => a - b);
            const batchItems: Array<{ url: string; fileName: string }> = [];
            // Register every selected episode in the download-manager UI so
            for (const idx of orderedIdxs) {
              const ep = panelEpisodes.find((episode) => episode.index === idx);
              if (!ep) continue;
              const seasonLabel = getShortSeasonLabel(panelSeason?.name, downloadPanelSeasonIdx);
              const episodeLabel = buildEpisodeDownloadName(title, seasonLabel, ep.episodeNumber);
              const epUrl = getDownloadUrl(
                pickEpUrlForQuality(ep, quality),
                quality,
                episodeLabel,
                Object.values(ep.qualityLinks),
              );
              if (!epUrl) continue;
              const fileName = buildDownloadFileName(episodeLabel, quality);
              batchItems.push({ url: epUrl, fileName });
              downloadManager.registerExternalDownload({
                id: buildDlId(quality, episodeLabel),
                url: epUrl,
                title,
                subtitle: episodeLabel,
                poster,
                quality,
                fileName,
              });
            }
            const fired = triggerBulkBackgroundDownloads(batchItems);
            closePanel();
            if (fired === 0) toast.error("No downloadable links found");
            else toast.success(`Started ${fired} downloads`);
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
              toast.error("Video file not found");
            }
          };

          // "Default" বাটন hide — শুধু explicit quality (480/720/1080/4K) বাটন থাকবে
          const qualityChoices = availableDownloadQualities.filter((q) => q !== "Default");
          const activeQuality = selectedDownloadQuality && qualityChoices.includes(selectedDownloadQuality)
            ? selectedDownloadQuality
            : (qualityChoices.find((q) => q !== "Default") || "");

          return (
            <div className="w-full">
              {/* ============ Download Picker Overlay ============ */}
              {showDownloadQualityPicker && (
                <div
                  ref={downloadPanelRef}
                  className="fixed left-0 right-0 bottom-0 z-[260] border-t border-white/10 bg-black text-white flex flex-col overflow-hidden"
                  style={inlineSheetStyle}
                  data-player-panel="true"
                >
                  {/* Header */}
                  <div className="sticky top-0 z-10 bg-black flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
                    <p className="text-[15px] font-bold tracking-tight text-white truncate">Download</p>
                    <button
                      onClick={closePanel}
                      className="h-8 w-8 flex items-center justify-center text-white/70 active:scale-95 flex-shrink-0 ml-3"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Picker body */}
                  {(

                  <div className="px-3 pt-3 pb-2 flex flex-col gap-2.5 min-h-0 flex-1">
                    <div className="rounded-[10px] border border-white/10 bg-white/[0.05] p-3">
                      <h4 className="text-[11px] font-bold text-white/80 uppercase tracking-wider mb-2">Resources</h4>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => { openInlineSheet("language", "download"); }} className="h-10 rounded-[8px] border border-white/10 bg-white/[0.07] px-2.5 text-left text-[12px] text-white flex items-center justify-between">
                          <span className="truncate">{currentDownloadLanguageLabel}</span>
                          <ChevronDown className="w-4 h-4 text-white/55 shrink-0" />
                        </button>
                        {hasMultiEpisodes ? (
                          <button onClick={() => { openInlineSheet("season", "download"); }} className="h-10 rounded-[8px] border border-white/10 bg-white/[0.07] px-2.5 text-left text-[12px] text-white flex items-center justify-between">
                            <span className="truncate">{getShortSeasonLabel(panelSeason?.name, downloadPanelSeasonIdx)}</span>
                            <ChevronDown className="w-4 h-4 text-white/55 shrink-0" />
                          </button>
                        ) : (
                          <div className="h-10 rounded-[8px] border border-white/10 bg-white/[0.07] px-2.5 text-left text-[12px] text-white/70 flex items-center">Movie</div>
                        )}
                      </div>
                      <div className="mt-2.5 border-t border-white/10 pt-2.5">
                        <div className="grid grid-cols-4 gap-2">
                          {qualityChoices.map((label) => {
                            const is4K = is4KLabel(label);
                            const locked4K = is4K && !isPremium;
                            const isActive = label === activeQuality;
                            return (
                              <button
                                key={label}
                                disabled={locked4K}
                                onClick={() => {
                                  if (locked4K) return;
                                  setSelectedDownloadQuality(label);
                                }}
                                className={`h-9 rounded-[8px] text-[12px] font-semibold border transition-all ${locked4K ? 'bg-white/[0.03] text-white/25 opacity-50 border-white/5' : isActive ? 'bg-gradient-to-r from-cyan-500 to-emerald-400 text-black border-emerald-300 shadow-[0_4px_14px_-2px_rgba(16,185,129,0.55)]' : 'bg-white/[0.07] text-white border-white/10'}`}
                              >
                                {label}
                              </button>
                            );
                          }).slice(0, 4)}
                        </div>
                      </div>
                    </div>

                    {hasMultiEpisodes && panelSeason && (() => {
                      const fmtSize = (bytes: number) => {
                        if (!bytes || bytes <= 0) return "";
                        const mb = bytes / (1024 * 1024);
                        if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
                        return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
                      };
                      return (
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                          <div className="space-y-2.5">
                            {panelEpisodes.map((ep) => {
                              const selected = dlSelectedEpisodes.has(ep.index);
                              const qualityUrl = activeQuality ? pickEpUrlForQuality(ep, activeQuality) : "";
                              const sizeBytes = qualityUrl ? downloadSizeCache[qualityUrl] || 0 : 0;
                              const sizeLabel = fmtSize(sizeBytes);
                              return (
                                <button key={`${downloadPanelSeasonIdx}-${ep.index}`} onClick={() => toggleEpisode(ep.index)} className="w-full flex items-start gap-2.5 text-left">
                                  <span className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-white/35 text-transparent'}`}>
                                    <Check className="w-3 h-3" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-[13px] font-medium text-white">S{String(downloadPanelSeasonIdx + 1).padStart(2, '0')} E{String(ep.episodeNumber).padStart(2, '0')}</span>
                                    <span className="block text-[11px] text-white/55 mt-0.5 truncate">{qualityUrl ? ep.metaText : `${ep.metaText} • No ${activeQuality || 'selected'} file`}</span>
                                  </span>
                                  <span className="shrink-0 self-center text-right text-[11px] font-semibold tabular-nums text-emerald-300/90 min-w-[54px]">
                                    {qualityUrl ? (sizeLabel || <span className="text-white/35 font-normal">…</span>) : <span className="text-white/30 font-normal">—</span>}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  )}



                  {(() => {
                    const fmtSize = (bytes: number) => {
                      if (!bytes || bytes <= 0) return "0 MB";
                      const mb = bytes / (1024 * 1024);
                      if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
                      return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
                    };
                    const selectedList = hasMultiEpisodes
                      ? panelEpisodes.filter((ep) => dlSelectedEpisodes.has(ep.index))
                      : [];
                    const totalBytes = selectedList.reduce((sum, ep) => {
                      const u = activeQuality ? pickEpUrlForQuality(ep, activeQuality) : "";
                      return sum + (u ? (downloadSizeCache[u] || 0) : 0);
                    }, 0);
                    const totalLabel = hasMultiEpisodes && selectedList.length > 0 ? fmtSize(totalBytes) : "";
                    return (
                      <div className="p-3 border-t border-white/10 bg-black">
                        <div className="flex items-center gap-2.5">
                          <button onClick={toggleAll} className={`flex items-center gap-1.5 text-[11px] ${dlSelectedEpisodes.size === panelEpisodes.length && panelEpisodes.length > 0 ? 'text-white' : 'text-white/55'}`}>
                            <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${dlSelectedEpisodes.size === panelEpisodes.length && panelEpisodes.length > 0 ? 'border-primary bg-primary text-primary-foreground' : 'border-white/35 text-transparent'}`}><Check className="w-3 h-3" /></span>
                            <span>All</span>
                          </button>
                          <button
                            onClick={() => {
                              const preferred = activeQuality || preferredDownloadQuality || qualityChoices[0];
                              if (!preferred) return;
                              if (hasMultiEpisodes) startSelectedDownloads(preferred);
                              else startMovieDownload(preferred);
                            }}
                            className="flex-1 h-10 rounded-[10px] bg-gradient-to-r from-cyan-500 to-green-400 text-black text-[13px] font-semibold flex items-center justify-center gap-1.5 px-3"
                          >
                            <Download className="w-4 h-4" />
                            <span className="truncate">
                              {activeQuality ? `Download • ${activeQuality}` : 'Download'}
                              {totalLabel ? ` • ${totalLabel}` : ''}
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })()}



      </div>

      {/* ============ Share Fallback Menu ============ */}
      {shareFallback && (() => {
        const u = encodeURIComponent(shareFallback.url);
        const t = encodeURIComponent(shareFallback.title);
        const targets = [
          { name: "WhatsApp", color: "from-green-500 to-emerald-500", href: `https://api.whatsapp.com/send?text=${t}%20${u}` },
          { name: "Telegram", color: "from-sky-500 to-blue-500", href: `https://t.me/share/url?url=${u}&text=${t}` },
          { name: "Facebook", color: "from-blue-600 to-indigo-600", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
          { name: "X / Twitter", color: "from-slate-700 to-black", href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
          { name: "Messenger", color: "from-blue-500 to-purple-500", href: `https://www.facebook.com/dialog/send?link=${u}&app_id=140586622674265&redirect_uri=${u}` },
          { name: "Email", color: "from-amber-500 to-orange-500", href: `mailto:?subject=${t}&body=${u}` },
        ];
        return (
          <div className="fixed inset-0 z-[600] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShareFallback(null)}>
            <div className="w-full sm:max-w-sm bg-zinc-950 border-t sm:border border-white/10 rounded-t-2xl sm:rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-[14px] font-bold text-white">Share to</h3>
                <button onClick={() => setShareFallback(null)} className="h-8 w-8 flex items-center justify-center text-white/70 active:scale-95">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-[11px] text-white/55 truncate">{shareFallback.title}</p>
              <div className="grid grid-cols-3 gap-2.5">
                {targets.map((t) => (
                  <a
                    key={t.name}
                    href={t.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setTimeout(() => setShareFallback(null), 50)}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-[10px] bg-gradient-to-br ${t.color} text-white text-[11px] font-semibold py-3 active:scale-95`}
                  >
                    <Share2 className="w-4 h-4" />
                    <span>{t.name}</span>
                  </a>
                ))}
              </div>
              <button
                onClick={async () => {
                  try { await navigator.clipboard?.writeText(shareFallback.url); toast.success("Link copied"); } catch { toast.error("Copy failed"); }
                  setShareFallback(null);
                }}
                className="w-full h-10 rounded-[10px] bg-white/[0.08] text-white text-[12px] font-semibold border border-white/10 active:scale-[0.98]"
              >
                Copy link
              </button>
            </div>
          </div>
        );
      })()}

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
              <p className="text-xs font-bold text-foreground mb-2">Other downloads</p>
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
