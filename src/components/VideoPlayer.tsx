import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import Hls from "hls.js";
import { useBranding } from "@/hooks/useBranding";
import { toast } from "sonner";
import AdsterraAdManager from "@/components/AdsterraAdManager";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, Settings, X, Lock, Unlock, ArrowLeft,
  ChevronRight, ChevronDown, FastForward, Rewind, Crop, Check, ExternalLink, Loader2, Download, PauseCircle, PlayCircle, Search, Server, Subtitles, Languages, Info, Star, Tv, Share2, Bookmark, FolderDown, RefreshCw
} from "lucide-react";
import type { AnimeItem, Season } from "@/data/animeData";
import { db, ref, onValue, set, remove, update, get } from "@/lib/firebase";
import logoImg from "@/assets/logo.png";
import { createUnlockLinksForAllServices, createTelegramBotUnlockLink, getCurrentDeviceFreeAccessExpiry, getLocalUserId, isAdGateCooldownActive, markAdGateShownNow, type AdService } from "@/lib/unlockAccess";
import { isUnlockBlockActive } from "@/lib/unlockBlock";
import VideoEngagement from "@/components/VideoEngagement";
import VideoReactionsBar from "@/components/VideoReactionsBar";
import { fireAdOnly } from "@/lib/adEngagement";

import { guestStore, isGuest } from "@/lib/guestStore";
import { startAdGuard, stopAdGuard } from "@/lib/adGuard";
import { optimizedImageUrl } from "@/lib/imageCache";
import { contentCategoryLabels, normalizeCastFrom, normalizeDirectorsFrom, normalizeOverviewFrom } from "@/lib/contentMetadata";
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
  /** Per-server proxy. Empty => this server plays direct (HTTPS servers). */
  proxy?: string;
  locked?: boolean;
}

import { buildVideoDownloadUrl, buildVideoDownloadUrlCandidates, triggerBackgroundVideoDownload, triggerBulkBackgroundDownloads, unwrapManagedVideoUrl } from "@/lib/videoDownload";
import { normalizeFunctionEndpointUrl } from "@/lib/edgeFunctionRouter";
import { resolveServerProxyForUrl, readCachedProxyServers } from "@/lib/serverProxy";
import { wrapWithIosProtection } from "@/lib/iosProtection";
import { fromOpaqueUrlToken, toOpaqueUrlToken, wrapAnHlsPlaybackUrl } from "@/lib/anPlaybackProxy";
import { supabase } from "@/integrations/supabase/client";

const buildProxyPlaybackUrl = (proxyBase: string, targetUrl: string, apiKey?: string): string => {
  const base = proxyBase.trim();
  const encoded = encodeURIComponent(targetUrl);
  if (!base) return targetUrl;
  let url: string;
  // Support {url} placeholder: https://proxy.example.com/?url={url}
  if (base.includes('{url}')) url = base.split('{url}').join(encoded);
  // Existing Cloudflare Worker deployments accept `?url=` while Lovable-hosted
  // function copies accept opaque `?src=`.
  else if (/\.workers\.dev(?:\/)?$/i.test(base.replace(/\?.*$/, ""))) url = `${base.replace(/\/+$/, '')}?url=${encoded}`;
  // Default: append an opaque src token, not the raw upstream URL.
  else url = `${base.replace(/\/$/, '')}?src=${encodeURIComponent(toOpaqueUrlToken(targetUrl))}`;
  // Append API key if provided
  if (apiKey) {
    url += (url.includes('?') ? '&' : '?') + `apikey=${encodeURIComponent(apiKey)}`;
  }
  return url;
};

const unwrapProxyPlaybackTarget = (value: string): string => {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.searchParams.get("url") || fromOpaqueUrlToken(parsed.searchParams.get("src") || "") || "";
  } catch {
    return "";
  }
};

const isVideoProxyPlaybackUrl = (value: string, configuredBase?: string): boolean => {
  const raw = String(value || "");
  if (/\/functions\/v1\/video-proxy\?/i.test(raw) || /\/video-proxy\?/i.test(raw) || /video-proxy\.[^/]+\.workers\.dev\//i.test(raw)) return true;
  try {
    if (!configuredBase) return false;
    const u = new URL(raw);
    const b = new URL(configuredBase);
    return u.origin === b.origin
      && u.pathname.replace(/\/+$/, "") === b.pathname.replace(/\/+$/, "")
      && (u.searchParams.has("url") || u.searchParams.has("src"));
  } catch { return false; }
};

const VIDEO_SERVERS_CACHE_KEY = "rs_video_servers_cache_v2";
const VIDEO_PROXY_CACHE_KEY = "rs_video_proxy_url_cache_v1";

// iOS / iPadOS detection used across the playback pipeline. Safari (even when
// hls.js reports MSE support on iPadOS) is far more reliable on its NATIVE HLS
// pipeline, so every HLS decision below prefers native on iOS.
export const IS_IOS_DEVICE =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    ((navigator as any).platform === "MacIntel" && (navigator as any).maxTouchPoints > 1));
const RS_VALID_SOURCE_TTL_MS = 10 * 60 * 1000;
const RS_SEEK_GRACE_MS = 60_000;
const RS_SEEK_PROXY_RESCUE_MS = 18_000;
const RS_NORMAL_RELOAD_LIMIT = 2;
const RS_SEEK_RELOAD_LIMIT = 2;

const normalizeVideoServersValue = (val: unknown): VideoServerOption[] => {
  let servers: VideoServerOption[] = [];
  if (val && Array.isArray(val)) {
    servers = val.filter((s: any) => s && s.domain);
  } else if (val && typeof val === "object") {
    servers = Object.values(val).filter((s: any) => s && s.domain) as VideoServerOption[];
  }
  return servers.map((server) => ({
    name: String(server.name || "").trim(),
    domain: String(server.domain || "").trim(),
    proxy: String((server as any).proxy || "").trim(),
    locked: !!server.locked,
  })).filter((server) => !!server.domain);
};

const readCachedVideoServers = (): VideoServerOption[] => {
  try {
    if (typeof localStorage === "undefined") return [];
    return normalizeVideoServersValue(JSON.parse(localStorage.getItem(VIDEO_SERVERS_CACHE_KEY) || "[]"));
  } catch { return []; }
};

const isDataHlsUrl = (url: string): boolean => {
  const normalized = String(url || "").trim().toLowerCase();
  return normalized.startsWith("data:application/vnd.apple.mpegurl");
};

const isHlsLikeUrl = (url: string): boolean => {
  const value = String(url || "").trim().toLowerCase();
  if (!value) return false;
  // Zero-latency AN detection: AnimeSalt CDN URLs are always /hls/<token>.
  // Do not parse, probe, decode, or inspect nested proxy URLs here; those extra
  // checks were slowing RS routes. The player only needs this instant marker.
  return isDataHlsUrl(value)
    || value.includes("/hls/")
    || value.includes("%2fhls%2f")
    || /\.m3u8(?:[?#].*)?$/.test(value)
    || /\.m3u8(?:%3f|%23|$)/.test(value);
};

const isAnApiHlsProxyUrl = (url: string): boolean => /\/(?:an-api|an-playback)\/hls\?/i.test(String(url || ""));

const sanitizeAnimeDownloadTitle = (value: string): string => {
  return String(value || "")
    .replace(/\b1\s*[x×]\s*1\b/gi, "")
    .replace(/\bone\s*x\s*one\b/gi, "")
    .replace(/one\s*x\s*one/gi, "")
    .replace(/anime\s*salt/gi, "")
    .replace(/anime\s*slate/gi, "")
    .replace(/animesalt/gi, "")
    .replace(/watch\s*now\s*in\s*[^|•—-]+/gi, "")
    .replace(/\s*[•|]+\s*/g, " ")
    .replace(/\s*[—-]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

const AN_AUDIO_LANGUAGE_PREF_KEY = "rs_an_audio_language_pref";
const saveAnAudioLanguagePref = (value?: string) => {
  const label = String(value || "").trim();
  if (!label) return;
  try { localStorage.setItem(AN_AUDIO_LANGUAGE_PREF_KEY, label); } catch {}
};

const isInsecureHttpSource = (url: string): boolean => {
  return String(url || "").trim().toLowerCase().startsWith("http://");
};

const isBypassSource = (url: string): boolean => {
  const normalized = String(url || "").trim().toLowerCase();
  return normalized.startsWith("blob:") || normalized.startsWith("data:") || normalized.startsWith("mediasource:");
};

  const buildPlaybackCandidates = (url: string, _cdnEnabled: boolean, fallbackProxyUrl?: string, proxyApiKey?: string, preferProxy = false): string[] => {
    // iOS detection - iOS and iPadOS both need specific handling for HTTP/HTTPS switching
    const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  if (!url) return [];

  // PER-SERVER PROXY: the proxy is resolved from the host of THIS url, so every
  // server plays through its own proxy. Only urls whose host is not in the admin
  // server list may use the caller-supplied fallback.
  const perServerProxy = resolveServerProxyForUrl(url);
  const knownServerHost = (() => {
    try {
      const host = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).host.toLowerCase();
      return readCachedProxyServers().some((s) => {
        try { return new URL(/^https?:\/\//i.test(s.domain) ? s.domain : `http://${s.domain}`).host.toLowerCase() === host; } catch { return false; }
      });
    } catch { return false; }
  })();
  const proxyUrl = perServerProxy || (knownServerHost ? "" : fallbackProxyUrl);

  const candidates: string[] = [];
  const addCandidate = (candidate?: string | null) => {
    if (!candidate || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  if (isBypassSource(url)) {
    addCandidate(url);
    return candidates;
  }

  if (/^data:/i.test(url)) {
    addCandidate(url);
    return candidates;
  }

  if (isHlsLikeUrl(url)) {
    addCandidate(url);
    return candidates;
  }

  // Protocol is detected PURELY from the URL — no server number is hardcoded.
  // http:// sources must use video-proxy because an HTTPS app cannot play raw HTTP.
  // HTTPS RS files play DIRECT first; testing showed proxying MP4 seek makes the
  // browser walk sequential byte windows and delays playback even more.
  const isHttp = isInsecureHttpSource(url);

  if (isHttp) {
    const customProxyCandidate = proxyUrl ? buildProxyPlaybackUrl(proxyUrl, url, proxyApiKey) : null;
    if (customProxyCandidate) addCandidate(customProxyCandidate);
    // Never hand raw http:// media to the browser from an HTTPS app on iOS or desktop.
    // However, on Android some browsers might handle it, but we prefer consistency.
    return candidates;
  }

  // iOS/Safari cannot decode Matroska and also blocks ".mkv" URLs even when the
  // bytes inside are really MP4. The iOS Protection gateway fixes the MIME and
  // serves MP4-contained ".mkv" as video/mp4, so on iOS it is tried FIRST for
  // Matroska links. If the gateway is not configured we fall back to the
  // server's own range-aware proxy; with neither we return zero candidates so
  // the failover chain jumps to the next server instead of parking Safari on a
  // permanently blocked source.
  if (isIOS && !isHttp) {
    const isMatroska = /\.mkv(?:$|[?#])/i.test(url);
    const customProxyCandidate = proxyUrl ? buildProxyPlaybackUrl(proxyUrl, url, proxyApiKey) : null;
    const iosGatewayCandidate = wrapWithIosProtection(url) || null;
    if (isMatroska) {
      if (iosGatewayCandidate) addCandidate(iosGatewayCandidate);
      if (customProxyCandidate) addCandidate(customProxyCandidate);
      return candidates;
    }
    // MP4 / HLS are natively supported — always direct-first on iOS, because
    // Safari's byte-range handling through a proxy stalls initial playback.
    addCandidate(url);
    if (iosGatewayCandidate) addCandidate(iosGatewayCandidate);
    if (customProxyCandidate) addCandidate(customProxyCandidate);
    return candidates;
  }

  addCandidate(url);
  const customProxyCandidate = proxyUrl ? buildProxyPlaybackUrl(proxyUrl, url, proxyApiKey) : null;
  if (customProxyCandidate && preferProxy) addCandidate(customProxyCandidate);
  if (customProxyCandidate) addCandidate(customProxyCandidate);
  return candidates;
};

const getPrimaryPlaybackSrc = (url: string, cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string, preferProxy = false): string => {
  return buildPlaybackCandidates(url, cdnEnabled, proxyUrl, proxyApiKey, preferProxy)[0] || (isInsecureHttpSource(url) ? "" : url);
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
  audioUrl?: string;
  rawAudioUrl?: string;
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
  external?: boolean;
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
  audioTracks?: { language: string; label: string; link: string; audioUrl?: string; rawAudioUrl?: string; link480?: string; link720?: string; link1080?: string; link4k?: string }[];
  subtitleTracks?: { language?: string; label: string; url: string }[];
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
  const cleanTitle = sanitizeAnimeDownloadTitle(animeTitle) || "Anime";
  const seasonPart = String(seasonLabel || "Season 01").trim();
  const episodePart = `Episode ${String(episodeNumber || 1).padStart(2, "0")}`;
  return [cleanTitle, seasonPart, episodePart].map((part) => String(part || "").trim()).filter(Boolean).join(" - ");
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
  // Custom / dubber names (e.g. "Atomic Dubber Hindi") — keep every word, title-cased
  if (/\s/.test(s)) {
    return s
      .split(/\s+/)
      .map((w) => (w.length > 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  }
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

const normalizeDownloadQualityKey = (label: string) => {
  const value = String(label || "").trim().toLowerCase();
  if (/4k|2160|uhd/.test(value)) return "4k";
  if (/1080|fhd/.test(value)) return "1080p";
  if (/720|hd/.test(value)) return "720p";
  if (/480|sd/.test(value)) return "480p";
  return value || "default";
};

const VideoPlayer = ({ src, title, subtitle, poster, anime, selectedLanguage, onClose, onLanguageChange, onNextEpisode, episodeList, qualityOptions, audioTracks: propAudioTracks, subtitleTracks: propSubtitleTracks, animeId, onSaveProgress, hideDownload, noProxy, noServerSwitch, seasons, currentSeasonIdx, currentEpisodeIdx, onSeasonChange, suggestedAnime, onSuggestedClick, nextEpisodeSrc, forceEmbedMode, initialSeekTime, shareLink, buildShareLinkForEpisode, onInfoClick, onLibraryClick, preferProxy = false }: VideoPlayerProps) => {
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
  const [speedHoldActive, setSpeedHoldActive] = useState(false);
  const speedHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedHoldPointerRef = useRef<number | null>(null);
  const speedHoldActiveRef = useRef(false);
  const previousSpeedRef = useRef(1);
  const suppressNextClickRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const closingRef = useRef(false);
  const userPlaybackIntentRef = useRef(true);
  const lastPlaybackPositionRef = useRef(0);
  const [skipIndicator, setSkipIndicator] = useState<{ side: "left" | "right" | "center"; text: string; total?: number } | null>(null);
  const skipAccumRef = useRef<{ side: "left" | "right" | null; total: number; timer: ReturnType<typeof setTimeout> | null }>({ side: null, total: 0, timer: null });
  const [brightness, setBrightness] = useState(1);
  const [swipeState, setSwipeState] = useState<{ startX: number; startY: number; type: string | null } | null>(null);
  const [fullscreenSwipeY, setFullscreenSwipeY] = useState(0);
  const fullscreenGestureFiredRef = useRef(false);
  const cropModes = ["contain", "cover", "fill"] as const;
  const cropLabels = ["Fit", "Crop", "Stretch"];
  const [cropIndex, setCropIndex] = useState(0);
  const [settingsTab, setSettingsTab] = useState<"speed" | "quality" | "audio">("speed");
  const [currentQuality, setCurrentQuality] = useState<string>("Auto");
  const currentQualityRef = useRef("Auto");
  const manualQualitySelectedRef = useRef(false);
  useEffect(() => { currentQualityRef.current = currentQuality; }, [currentQuality]);
  const [cdnEnabled, setCdnEnabled] = useState(true);
  const [proxyUrl, setProxyUrl] = useState<string>("");
  const [proxyApiKey, setProxyApiKey] = useState<string>('');
  const [playbackRouteReady, setPlaybackRouteReady] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(''); // resolved playback src
  const currentSrcRef = useRef('');
  useEffect(() => { currentSrcRef.current = currentSrc; }, [currentSrc]);
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
  const [videoServers, setVideoServers] = useState<VideoServerOption[]>(() => readCachedVideoServers());
  const [videoServersLoaded, setVideoServersLoaded] = useState(() => readCachedVideoServers().length > 0);
  const [activeServerIndex, setActiveServerIndex] = useState(0);
  const [manualServerSelected, setManualServerSelected] = useState(false);
  const manualServerSelectedRef = useRef(false);
  const preferredServerIndexRef = useRef<number | null>(null);
  const [showServerPanel, setShowServerPanel] = useState(false);
  const premiumServerApplied = useRef(false);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/videoServers"), (snap) => {
      const servers = normalizeVideoServersValue(snap.val());
      setVideoServers(servers);
      setVideoServersLoaded(true);
      try { localStorage.setItem(VIDEO_SERVERS_CACHE_KEY, JSON.stringify(servers)); } catch {}
    });
    return () => unsub();
  }, []);

  const effectiveVideoServers = useMemo(() => {
    if (noServerSwitch) return [];
    // STRICT SERVER ISOLATION: only admin-configured servers are shown/used.
    // No built-in mirror generation, so one dead server cannot contaminate the
    // routing for the others.
    return videoServers;
  }, [noServerSwitch, videoServers]);

  const videoServerFingerprint = useMemo(
    () => effectiveVideoServers.map((s) => `${s.domain || ""}:${s.proxy || ""}:${s.locked ? "1" : "0"}`).join("|"),
    [effectiveVideoServers],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const origins = new Set<string>();
    const addOrigin = (value?: string) => {
      try {
        const u = new URL(String(value || ""));
        if (u.protocol === "http:" || u.protocol === "https:") origins.add(u.origin);
      } catch {}
    };
    addOrigin(src);
    effectiveVideoServers.slice(0, 2).forEach((server) => addOrigin(server.domain));
    if (proxyUrl) addOrigin(proxyUrl);
    document.querySelectorAll('link[data-rs-video-preconnect="true"]').forEach((node) => node.remove());
    origins.forEach((origin) => {
      const preconnect = document.createElement("link");
      preconnect.rel = "preconnect";
      preconnect.href = origin;
      preconnect.crossOrigin = "anonymous";
      preconnect.dataset.rsVideoPreconnect = "true";
      document.head.appendChild(preconnect);
      const dns = document.createElement("link");
      dns.rel = "dns-prefetch";
      dns.href = origin;
      dns.dataset.rsVideoPreconnect = "true";
      document.head.appendChild(dns);
    });
    return () => {
      document.querySelectorAll('link[data-rs-video-preconnect="true"]').forEach((node) => node.remove());
    };
  }, [effectiveVideoServers, proxyUrl, src]);

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
    () => !!currentSrc && isHlsLikeUrl(currentSrc),
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


  
  // PER-SERVER PROXY ONLY. There is no global player proxy anymore: each server
  // in Admin → Video Servers carries its own proxy URL, resolved by host.
  // `proxyUrl` here is just the resolved proxy of the CURRENT source (used for
  // preconnect + proxy-detection); candidate building resolves per url itself.
  useEffect(() => {
    let cancelled = false;
    const applyProxyRoute = () => {
      if (cancelled) return;
      const isAnHls = isAnApiHlsProxyUrl(src || "");
      if (isAnHls || noProxy) { setProxyUrl(""); setProxyApiKey(""); setPlaybackRouteReady(true); return; }
      const finalUrl = resolveServerProxyForUrl(src || "");
      setProxyUrl(finalUrl);
      setProxyApiKey('');
      setPlaybackRouteReady(true);
      try {
        if (finalUrl) localStorage.setItem(VIDEO_PROXY_CACHE_KEY, finalUrl);
        else localStorage.removeItem(VIDEO_PROXY_CACHE_KEY);
      } catch {}
    };

    const unsub1 = onValue(ref(db, "settings/cdnEnabled"), (snap) => {
      const val = snap.val();
      setCdnEnabled(val !== false);
    });

    applyProxyRoute();

    return () => { cancelled = true; unsub1(); };
  }, [noProxy, preferProxy, src, videoServerFingerprint]);
  const [isPremium, setIsPremium] = useState<boolean | null>(null); // null = loading
  const [adGateBusy, setAdGateBusy] = useState(false);
  const downloadAdPassedRef = useRef(false);

  const [adGateActive, setAdGateActive] = useState(false);
  const adGateActiveRef = useRef(false);
  const resumeRetryTimerRef = useRef<number | null>(null);
  useEffect(() => { adGateActiveRef.current = adGateActive; }, [adGateActive]);
  const selectedLanguageRef = useRef(selectedLanguage);
  useEffect(() => { selectedLanguageRef.current = selectedLanguage; }, [selectedLanguage]);
  const [adLinks, setAdLinks] = useState<{ service: AdService; shortUrl: string }[]>([]);
  const [shortenLoading, setShortenLoading] = useState(false);
  const [adGateError, setAdGateError] = useState("");
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
  const [activePlaybackLanguage, setActivePlaybackLanguage] = useState<string>("");
  const [selectedDownloadLanguageLabel, setSelectedDownloadLanguageLabel] = useState<string>("");
  const [selectedDownloadQuality, setSelectedDownloadQuality] = useState<string>("");
  const [downloadSizeCache, setDownloadSizeCache] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem("rs_dl_size_cache_v1");
      const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      const filtered: Record<string, number> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        const n = Number(value || 0);
        // Keep positive sizes AND known-unknown marker (-1) so UI stops probing forever
        if (Number.isFinite(n) && (n > 512 * 1024 || n === -1)) filtered[key] = n;
      });
      return filtered;
    } catch { return {}; }
  });
  const getCachedDownloadSize = useCallback((url?: string) => {
    const n = Number(url ? downloadSizeCache[url] || 0 : 0);
    return Number.isFinite(n) && n > 512 * 1024 ? n : 0;
  }, [downloadSizeCache]);
  const hasProbedDownloadSize = useCallback((url?: string) => {
    if (!url) return false;
    return Object.prototype.hasOwnProperty.call(downloadSizeCache, url);
  }, [downloadSizeCache]);

  
  const [offlinePlaySrc, setOfflinePlaySrc] = useState<string | null>(null);
  const [offlinePlayInfo, setOfflinePlayInfo] = useState<any>(null);
  const [videoError, setVideoError] = useState(false);
  const failedSrcsRef = useRef<Set<string>>(new Set());
  // Throttle React state updates from native <video> RAF loop to ~1 Hz
  const lastNativeSyncRef = useRef(0);
  // Persistent retry counter (per-src) so we don't retry-storm across re-renders
  const retryAttemptsRef = useRef<Map<string, number>>(new Map());
  const sourceHealthRef = useRef<Map<string, number>>(new Map());
  const seekRecoveryUntilRef = useRef(0);
  const seekRescueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSeekTargetRef = useRef<number | null>(null);
  const slowSeekEventsRef = useRef<number[]>([]);
  const autoQualityShiftCountRef = useRef(0);
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
    () => anime?.source === "animesalt" || anime?.sourceName === "AnimeSalt" || !!anime?.anSlug || !!anime?.animeSaltSlug || /^as_|^an_/i.test(String(anime?.id || "")),
    [anime?.anSlug, anime?.animeSaltSlug, anime?.id, anime?.source, anime?.sourceName],
  );

  const buildReliableHlsSource = useCallback((rawUrl: string) => {
    // Runtime playback still reads Firebase-stored URLs only. AnimeSalt CDN does
    // not send CORS headers for hls.js, so synthetic masters may contain the
    // `/an-api/hls?url=...` or `/an-playback/hls?url=...` runtime wrapper. Do not unwrap it here; that wrapper
    // is required for video-only + separate audio playlists to load together.
    const clean = String(rawUrl || "").trim();
    if (!clean) return clean;
    if (isDataHlsUrl(clean)) {
      try {
        const comma = clean.indexOf(",");
        if (comma > 0) {
          const meta = clean.slice(0, comma).toLowerCase();
          const payload = clean.slice(comma + 1);
          const decoded = meta.includes(";base64") ? decodeURIComponent(escape(atob(payload))) : decodeURIComponent(payload);
          const remasked = isAnimeSaltContent
            ? decoded
                .split(/\r?\n/)
                .map((line) => {
                  const trimmed = line.trim();
                  if (!trimmed) return line;
                  if (trimmed.startsWith("#")) {
                    return line.replace(/URI="([^"]+)"/gi, (_m, uri) => `URI="${wrapAnHlsPlaybackUrl(uri)}"`);
                  }
                  return /^https?:\/\//i.test(trimmed) ? wrapAnHlsPlaybackUrl(trimmed) : line;
                })
                .join("\n")
            : decoded;
          return `data:application/vnd.apple.mpegurl;base64,${btoa(unescape(encodeURIComponent(remasked)))}`;
        }
      } catch {}
    }
    return clean;
  }, [isAnimeSaltContent]);

  const currentLangLabel = useMemo(() => {
    // AnimeSalt: lock to Hindi as the visible label whenever AN content is
    // playing. AN's default audio policy is Hindi-first (Index.tsx forces it
    // via pickAnDefaultAudioIdx), so showing anything else would just flash
    // before the player swaps back. Only honor an explicit user override.
    if (isAnimeSaltContent) {
      if (selectedLanguageLabel && propAudioTracks?.length) {
        const match = propAudioTracks.find((t) => {
          const lbl = getPrimaryLanguageToken(t.label || t.language || "") || "";
          return lbl.toLowerCase() === selectedLanguageLabel.trim().toLowerCase();
        });
        if (match) return getPrimaryLanguageToken(match.label || match.language || "") || selectedLanguageLabel;
      }
      return "Hindi";
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
    // AnimeSalt keeps the stored API/admin audio order; RS/non-AN stays sorted.
    if (isAnimeSaltContent) return Array.from(labels);
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
      audioUrl: undefined as string | undefined,
      rawAudioUrl: undefined as string | undefined,
      link480: anime?.movieLink480,
      link720: anime?.movieLink720,
      link1080: anime?.movieLink1080,
      link4k: anime?.movieLink4k,
    };
    const languageEpisodeTracks = Object.entries(anime?.seasonsByLanguage || {}).flatMap(([language, languageSeasons]: [string, any]) => {
      const season = Array.isArray(languageSeasons) ? languageSeasons[currentSeasonIdx ?? 0] : null;
      const episode = season?.episodes?.[currentEpisodeIdx ?? 0];
      if (!episode) return [];
      const link = String(episode.link1080 || episode.link720 || episode.link480 || episode.link4k || episode.link || "").trim();
      if (!link) return [];
      return [{
        language,
        label: language,
        link,
        link480: episode.link480,
        link720: episode.link720,
        link1080: episode.link1080,
        link4k: episode.link4k,
      }];
    });
    const pool = [baseTrack, ...languageEpisodeTracks, ...(propAudioTracks || [])];
    const unique = new Map<string, typeof baseTrack>();
    pool.forEach((track) => {
      const label = getPrimaryLanguageToken(track.label || track.language || fallbackLanguage) || fallbackLanguage;
      if (!label || unique.has(label.toLowerCase())) return;
      const anyTrack = track as any;
      unique.set(label.toLowerCase(), {
        language: getPrimaryLanguageToken(track.language || label) || label,
        label,
        link: String(track.link || anyTrack.audioUrl || anyTrack.rawAudioUrl || src || "").trim(),
        audioUrl: anyTrack.audioUrl,
        rawAudioUrl: anyTrack.rawAudioUrl,
        link480: track.link480,
        link720: track.link720,
        link1080: track.link1080,
        link4k: track.link4k,
      });
    });
    return Array.from(unique.values());
  }, [anime?.baseLanguage, anime?.language, anime?.movieLink1080, anime?.movieLink4k, anime?.movieLink480, anime?.movieLink720, anime?.seasonsByLanguage, currentEpisodeIdx, currentLangLabel, currentSeasonIdx, propAudioTracks, src]);

  const activeLanguageTrack = useMemo(() => {
    const selectedKey = currentLangLabel.trim().toLowerCase();
    return normalizedLanguageTracks.find((track) => track.label.trim().toLowerCase() === selectedKey)
      || normalizedLanguageTracks[0]
      || null;
  }, [currentLangLabel, normalizedLanguageTracks]);

  const currentDownloadLanguageLabel = useMemo(() => {
    if (selectedDownloadLanguageLabel) return selectedDownloadLanguageLabel;
    return currentLangLabel || "";
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
    const fallbackTrack = activeDownloadLanguageTrack || normalizedLanguageTracks[0] || null;
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
  }, [activeDownloadLanguageTrack, anime?.movieLink, anime?.movieLink1080, anime?.movieLink4k, anime?.movieLink480, anime?.movieLink720, normalizedLanguageTracks, src]);

  const infoCast = useMemo(() => normalizeCastFrom(anime, 24), [anime]);

  const infoDirectors = useMemo(() => {
    const directors = normalizeDirectorsFrom(anime);
    return directors.length ? directors : [];
  }, [anime]);

  const infoStoryline = normalizeOverviewFrom(anime) || "No storyline available yet.";

  const infoCategories = useMemo(() => contentCategoryLabels(anime).slice(0, 6), [anime]);

  const infoMetaItems = useMemo(() => {
    const items = [
      anime?.rating ? `★ ${anime.rating}` : "",
      anime?.year ? String(anime.year) : "",
      infoCategories.length ? infoCategories.join(", ") : (anime?.category ? String(anime.category) : ""),
      anime?.type === "webseries" ? "Anime" : "Movie",
    ].filter(Boolean);
    return items;
  }, [anime?.category, anime?.rating, anime?.type, anime?.year, infoCategories]);

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
    const tracks: any[] = Array.isArray(ep?.audioTracks) ? ep.audioTracks : [];
    const matchingTrack = tracks.find((entry: any) => {
      const trackLabel = String(entry?.label || entry?.language || "").trim().toLowerCase();
      return !!trackLabel && trackLabel === selectedKey;
    });

    let result: Record<string, string> = {};
    if (matchingTrack) {
      result = getTrackQualityLinks(matchingTrack, selectedKey === baseKey ? ep : null);
    } else if (selectedKey === baseKey) {
      result = getTrackQualityLinks(undefined, ep);
    }

    // AN-style fallback: if the structured quality map is empty but the
    // episode (or any audio track) carries a playable link, surface it as
    // "Default" so the download panel still renders quality buttons.
    if (Object.keys(result).length === 0) {
      const epLink = String(ep?.link || ep?.src || ep?.url || "").trim();
      const trackLink = String((matchingTrack || tracks[0])?.link || "").trim();
      const fallback = epLink || trackLink;
      if (fallback) result = { Default: fallback };
    }

    // AN qualityLinks (Record<quality,url>) — merge them in if present.
    const qualityMap = (matchingTrack?.qualityLinks && typeof matchingTrack.qualityLinks === "object")
      ? matchingTrack.qualityLinks
      : (ep?.qualityLinks && typeof ep.qualityLinks === "object" ? ep.qualityLinks : null);
    if (qualityMap) {
      Object.entries(qualityMap).forEach(([k, v]) => {
        const url = String(v || "").trim();
        if (!url) return;
        const key = String(k).trim();
        if (!result[key]) result[key] = url;
      });
    }

    return result;
  }, [getTrackQualityLinks, primarySeriesLanguageLabel]);

  const availableDownloadQualities = useMemo(() => {
    const order = ["Default", "480P", "720P", "1080P", "4K"];
    const season = seasons?.[downloadPanelSeasonIdx];
    if (season?.episodes?.length) {
      const qualitySet = new Set<string>();
      season.episodes.forEach((ep: any) => {
        Object.keys(getEpisodeDownloadLinksForLanguage(ep, currentDownloadLanguageLabel)).forEach((quality) => qualitySet.add(quality));
      });
      const known = order.filter((quality) => qualitySet.has(quality));
      const extras = Array.from(qualitySet).filter((q) => !order.includes(q));
      return [...known, ...extras];
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

  const selectedSeasonHas480p = useMemo(() => {
    const season = seasons?.[downloadPanelSeasonIdx];
    if (!season?.episodes?.length) return availableDownloadQualities.some((q) => normalizeDownloadQualityKey(q) === "480p");
    return season.episodes.some((ep: any) => {
      const links = getEpisodeDownloadLinksForLanguage(ep, currentDownloadLanguageLabel);
      return Object.keys(links).some((q) => normalizeDownloadQualityKey(q) === "480p" && String(links[q] || "").trim());
    });
  }, [availableDownloadQualities, currentDownloadLanguageLabel, downloadPanelSeasonIdx, getEpisodeDownloadLinksForLanguage, seasons]);

  const preferredDownloadQuality = useMemo(() => {
    const ordered = ["480P", "Default", "720P", "1080P", "4K"];
    if (!isPremium) {
      const freePreferred = selectedSeasonHas480p
        ? availableDownloadQualities.find((q) => normalizeDownloadQualityKey(q) === "480p")
        : availableDownloadQualities.find((q) => normalizeDownloadQualityKey(q) !== "480p");
      if (freePreferred) return freePreferred;
    }
    return ordered.find((quality) => availableDownloadQualities.includes(quality))
      || availableDownloadQualities[0]
      || "";
  }, [availableDownloadQualities, isPremium, selectedSeasonHas480p]);

  const hasEpisodeTree = useMemo(
    () => !!(seasons && seasons.some((s: any) => (s?.episodes?.length || 0) > 0)),
    [seasons],
  );

  const isDownloadAllowedForFree = useCallback((quality: string, episodeIndex?: number) => {
    if (isPremium) return true;
    const key = normalizeDownloadQualityKey(quality);
    if (key === "480p") return true;
    // Movies have no episode list: allow the only available quality when the
    // title simply has no 480P file (same spirit as the Episode 1–2 rule).
    if (!hasEpisodeTree) return !selectedSeasonHas480p;
    if (typeof episodeIndex !== "number") return false;
    return !selectedSeasonHas480p && episodeIndex < 2;
  }, [hasEpisodeTree, isPremium, selectedSeasonHas480p]);


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
        const pick = preferredMatch || propAudioTracks.find((t: any) => t?.isDefault) || propAudioTracks[0];
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
    const selectedBlocked = !!selectedDownloadQuality && !isPremium && normalizeDownloadQualityKey(selectedDownloadQuality) !== "480p" && selectedSeasonHas480p;
    if (!selectedDownloadQuality || !availableDownloadQualities.includes(selectedDownloadQuality) || selectedBlocked) {
      setSelectedDownloadQuality(preferredDownloadQuality);
      setDlSelectedEpisodes(new Set());
    }
  }, [availableDownloadQualities, isPremium, preferredDownloadQuality, selectedDownloadQuality, selectedSeasonHas480p]);

  useEffect(() => {
    if (!showDownloadQualityPicker) return;
    const quality = selectedDownloadQuality;
    if (!quality) return;
    const urls: string[] = [];
    downloadEpisodes.forEach((ep) => {
      const u = ep.qualityLinks[quality];
      if (u && !hasProbedDownloadSize(u)) urls.push(u);
    });
    if (!hasEpisodeTree) {
      // Movies: probe EVERY quality so the panel can show a size per quality
      // (same experience as series) instead of only the selected one.
      Object.values(movieQualityLinks).forEach((movieUrl) => {
        const u = String(movieUrl || "").trim();
        if (u && !hasProbedDownloadSize(u) && !urls.includes(u)) urls.push(u);
      });
    }
    if (!urls.length) return;


    let cancelled = false;
    const probe = async (u: string): Promise<[string, number] | null> => {
      if (isHlsLikeUrl(u)) return [u, -1]; // HLS: mark known, size N/A
      const withTimeout = async (input: string, init: RequestInit, ms = 4000) => {
        const ac = new AbortController();
        const t = window.setTimeout(() => ac.abort(), ms);
        try { return await fetch(input, { ...init, signal: ac.signal }); }
        finally { window.clearTimeout(t); }
      };
      const isValidSizeResponse = (r: Response) => {
        if (!r.ok && r.status !== 206) return false;
        const ct = String(r.headers.get("content-type") || "").toLowerCase();
        return !/json|text\/html/.test(ct);
      };
      const acceptBytes = (n: number) => Number.isFinite(n) && n > 128 * 1024;
      const proxiedCandidates = buildVideoDownloadUrlCandidates(u, "probe.mp4");
      for (const proxied of proxiedCandidates) {
        try {
          const r2 = await withTimeout(proxied, { method: "GET", headers: { Range: "bytes=0-0" }, mode: "cors" });
          if (!isValidSizeResponse(r2)) { try { await r2.body?.cancel(); } catch {}; continue; }
          const cr = r2.headers.get("content-range");
          if (cr) {
            const m = /\/(\d+)\s*$/.exec(cr);
            if (m) {
              try { await r2.body?.cancel(); } catch {}
              const total = Number(m[1]);
              if (acceptBytes(total)) return [u, total];
            }
          }
          const len = Number(r2.headers.get("content-length") || 0);
          try { await r2.body?.cancel(); } catch {}
          if (acceptBytes(len)) return [u, len];
        } catch {}
        try {
          const r = await withTimeout(proxied, { method: "HEAD", mode: "cors" });
          if (!isValidSizeResponse(r)) { try { await r.body?.cancel(); } catch {}; continue; }
          const len = Number(r.headers.get("content-length") || 0);
          try { await r.body?.cancel(); } catch {}
          if (acceptBytes(len)) return [u, len];
        } catch {}
      }
      // Nothing worked — mark as "known-unknown" so UI stops showing "Ready" forever
      return [u, -1];
    };
    (async () => {
      // High concurrency: 8 in parallel keeps every episode resolving in ~1s
      const chunk = 8;
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
  }, [showDownloadQualityPicker, selectedDownloadQuality, downloadEpisodes, hasProbedDownloadSize, hasEpisodeTree, movieQualityLinks]);



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

  // Download opens instantly. A single pop-under fires alongside it (optional,
  // never blocking) so the sponsor still gets a chance to count.
  const openDownloadWithAd = useCallback(() => {
    if (!isPremium && !downloadAdPassedRef.current) {
      downloadAdPassedRef.current = true;
      fireAdOnly("download", isPremium);
    }
    openInlineSheet("download", "download");
  }, [isPremium, openInlineSheet]);



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
  }, [title]);

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

  const loadAdGateLinks = useCallback(async (isCancelled: () => boolean = () => false) => {
    setShortenLoading(true);
    setAdGateError("");
    try {
      const result = await createUnlockLinksForAllServices();
      if (isCancelled()) return;
      setShortenLoading(false);
      if (result.ok && result.links.length > 0) {
        setAdLinks(result.links);
        setAdGateError("");
      } else {
        setAdLinks([]);
        setAdGateError(
          result.error === "no_services"
            ? "No ad/unlock service is enabled in Admin."
            : "Ad link network is blocked right now. Please retry.",
        );
      }
    } catch {
      if (isCancelled()) return;
      setShortenLoading(false);
      setAdLinks([]);
      setAdGateError("Ad link network is blocked right now. Please retry.");
    }
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

  // Ad-blocker / ad-DNS guard — arms only for non-premium users.
  useEffect(() => {
    if (isPremium === null) return;
    startAdGuard({ isPremium: !!isPremium });
    return () => { stopAdGuard(); };
  }, [isPremium]);

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
      setAdGateError("");
      if (videoRef.current) {
        videoRef.current.pause();
      }
      return;
    }

    if (isPremium || has24hAccess()) {
      setAdGateActive(false);
      setAdGateError("");
      return;
    }
    if (isAdGateCooldownActive()) {
      setAdGateActive(false);
      setAdGateError("");
      return;
    }
    // Shortener master toggle: if admin disabled it, give free users instant access
    isShortenerEnabled().then((on) => {
      if (!on) { setAdGateActive(false); return; }
      // No access - block video and show ad gate
      markAdGateShownNow();
      setAdGateActive(true);
      setAdLinks([]);
      setAdGateError("");
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        setShortenLoading(false);
        setAdGateError("Ad link network is taking too long. Please retry.");
      }, 15000);
      loadAdGateLinks(() => cancelled).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
    });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isPremium, has24hAccess, unlockBlocked, freeAccessLoaded, loadAdGateLinks]);

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

  const handleOpenAdLink = useCallback(async (url: string, service?: AdService) => {
    const { openExternalBrowser, openTelegramDeepLink } = await import("@/lib/openExternal");
    const isTelegramUnlock = service?.mode === "miniapp" || url.startsWith("miniapp://") || url.startsWith("telegram://");
    if (!isTelegramUnlock && url) {
      openExternalBrowser(url);
      return;
    }
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
      if (botUsername) {
        window.location.href = `https://t.me/${botUsername}`;
        return;
      }
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

  // Screen Wake Lock — keeps mobile screen awake while the player is mounted.
  // Re-acquired automatically when the tab returns to the foreground.
  useEffect(() => {
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    if (!nav?.wakeLock?.request) return;
    let sentinel: any = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (cancelled || document.visibilityState !== "visible") return;
        sentinel = await nav.wakeLock.request("screen");
        sentinel?.addEventListener?.("release", () => { sentinel = null; });
      } catch {}
    };
    const onVisibility = () => { if (document.visibilityState === "visible" && !sentinel) void acquire(); };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      try { sentinel?.release?.(); } catch {}
      sentinel = null;
    };
  }, []);

  // Hard reset playback position when the user navigates to a DIFFERENT
  // episode/season/anime without an explicit resume time. Fixes the bug
  // where episode 2 (or a different anime) continued from the previous
  // episode's timestamp.
  const prevEpKeyRef = useRef<string>("");
  const initialMountKeyRef = useRef<string>("");
  useEffect(() => {
    const key = `${animeId ?? "-"}::${currentSeasonIdx ?? "-"}::${currentEpisodeIdx ?? "-"}`;
    if (!initialMountKeyRef.current) initialMountKeyRef.current = key;
    const isFirstMount = !prevEpKeyRef.current;
    const changed = prevEpKeyRef.current && prevEpKeyRef.current !== key;
    prevEpKeyRef.current = key;
    if (isFirstMount || !changed) return;
    // Episode changed via Next button (or season/episode switch). ALWAYS start
    // from 0 — stale `initialSeekTime` from the previous episode must NOT
    // resume the new episode at the same timestamp.
    pendingSeek.current = 0;
    mediaRecoverySeekRef.current = 0;
    lastPlaybackPositionRef.current = 0;
    try {
      const prevKey = playbackCheckpointKeyRef.current;
      if (prevKey) sessionStorage.removeItem(prevKey);
    } catch {}
    const v = videoRef.current;
    if (v) { try { v.currentTime = 0; } catch {} }
  }, [animeId, currentEpisodeIdx, currentSeasonIdx]);

  // Per-anime isolation: when switching to a DIFFERENT anime, reset the
  // quality / manual-selection state so preferences from the previous anime
  // don't leak in (e.g. picking 4K on anime A then switching to anime B was
  // starting B at 4K too). We do NOT force server back to index 0 — instead
  // we clear the manual flag so premium users auto-land on the premium server
  // and free users fall through to the default (server 1).
  const prevAnimeIdRef = useRef<string | undefined>(animeId);
  useEffect(() => {
    if (prevAnimeIdRef.current === animeId) return;
    prevAnimeIdRef.current = animeId;
    manualQualitySelectedRef.current = false;
    currentQualityRef.current = "Auto";
    setCurrentQuality("Auto");
    manualServerSelectedRef.current = false;
    setManualServerSelected(false);
    preferredServerIndexRef.current = null;
    premiumServerApplied.current = false;
    failedSrcsRef.current = new Set();
    pendingSeek.current = 0;
    mediaRecoverySeekRef.current = 0;
    lastPlaybackPositionRef.current = 0;
    rsSoftRetriesRef.current = 0;
    hlsFatalRetriesRef.current = 0;
    seekRecoveryUntilRef.current = 0;
    slowSeekEventsRef.current = [];
    autoQualityShiftCountRef.current = 0;
  }, [animeId]);



  // Restore watch position (per-account) — ONLY on first mount for this
  // episode. When the user hits Next, we start the new episode at 0.
  useEffect(() => {
    if (!animeId) return;
    const key = `${animeId ?? "-"}::${currentSeasonIdx ?? "-"}::${currentEpisodeIdx ?? "-"}`;
    // "First mount" = the very first episode key this player instance saw.
    // Any later episode change (Next/Prev/season switch) is a fresh switch and
    // must start at 0 — never re-apply the previous episode's initialSeekTime.
    const isFreshEpisodeSwitch = initialMountKeyRef.current !== "" && initialMountKeyRef.current !== key;
    const hasExplicitResume = typeof initialSeekTime === "number" && initialSeekTime > 0;
    pendingSeek.current = hasExplicitResume && !isFreshEpisodeSwitch
      ? initialSeekTime!
      : 0;
    if (isFreshEpisodeSwitch) return;
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
            const storedSeasonIdx = data?.episodeInfo?.seasonIdx ?? (typeof data?.episodeInfo?.season === "number" ? data.episodeInfo.season - 1 : undefined);
            const storedEpisodeIdx = data?.episodeInfo?.epIdx ?? (typeof data?.episodeInfo?.episode === "number" ? data.episodeInfo.episode - 1 : undefined);
            const episodeMatches = currentSeasonIdx === undefined && currentEpisodeIdx === undefined
              ? storedSeasonIdx === undefined && storedEpisodeIdx === undefined
              : storedSeasonIdx === currentSeasonIdx && storedEpisodeIdx === currentEpisodeIdx;
            const resumeFrom = hasExplicitResume ? initialSeekTime! : (episodeMatches ? data.currentTime : 0);
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
    return getPrimaryPlaybackSrc(trimmed, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined, preferProxy);
  }, [cdnEnabled, noProxy, proxyUrl, proxyApiKey, preferProxy]);

  const applyServerDomain = useCallback((rawUrl: string, serverIndex: number) => {
    if (isBypassSource(rawUrl)) return rawUrl;
    // AN / HLS playback MUST run on its own origin. Swapping the host with the
    // admin RS server domain (e.g. bot-hosting.net) makes the player fetch the
    // m3u8 from a server that doesn't host it, so playback fails and the UI
    // shows the RS server name on an AN video. HLS links go straight to <video>.
    if (isHlsLikeUrl(rawUrl)) return rawUrl;
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

  const markPlaybackSourceHealthy = useCallback((extraSource?: string) => {
    const now = Date.now();
    rsSoftRetriesRef.current = 0;
    [extraSource, currentSrc, activeSourceBaseRef.current, sourceBaseRef.current]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .forEach((key) => sourceHealthRef.current.set(key, now));
  }, [currentSrc]);

  const isCurrentPlaybackSourceValid = useCallback(() => {
    const now = Date.now();
    const v = videoRef.current;
    if (v && v.readyState >= 2 && Number.isFinite(v.duration) && v.duration > 0 && !v.error) return true;
    return [currentSrc, activeSourceBaseRef.current, sourceBaseRef.current]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .some((key) => now - (sourceHealthRef.current.get(key) || 0) < RS_VALID_SOURCE_TTL_MS);
  }, [currentSrc]);

  const shouldAllowAutoQualityShift = useCallback(() => {
    if (manualQualitySelectedRef.current) return false;
    const connection = (navigator as any)?.connection || (navigator as any)?.mozConnection || (navigator as any)?.webkitConnection;
    const effectiveType = String(connection?.effectiveType || "").toLowerCase();
    const downlink = Number(connection?.downlink || 0);
    if (connection?.saveData || /(^|-)2g$|slow-2g/.test(effectiveType) || (downlink > 0 && downlink < 1.25)) return true;
    const recentSlowSeeks = slowSeekEventsRef.current.filter((ts) => Date.now() - ts < 2 * 60 * 1000);
    slowSeekEventsRef.current = recentSlowSeeks;
    return recentSlowSeeks.length >= 3 && autoQualityShiftCountRef.current < 1;
  }, []);

  const clearSeekRescueTimer = useCallback(() => {
    if (seekRescueTimerRef.current) {
      clearTimeout(seekRescueTimerRef.current);
      seekRescueTimerRef.current = null;
    }
  }, []);

  const finishSeekRecoveryIfReady = useCallback((v?: HTMLVideoElement | null) => {
    const target = activeSeekTargetRef.current;
    if (target === null) {
      clearSeekRescueTimer();
      seekRecoveryUntilRef.current = 0;
      return true;
    }
    const media = v || videoRef.current;
    if (!media) return false;
    const reached = Math.abs((media.currentTime || 0) - target) <= 3;
    const hasFutureData = media.readyState >= 3;
    if (reached && hasFutureData) {
      activeSeekTargetRef.current = null;
      clearSeekRescueTimer();
      seekRecoveryUntilRef.current = 0;
      return true;
    }
    return false;
  }, [clearSeekRescueTimer]);

  const preloadLinkRef = useRef<HTMLLinkElement | null>(null);
  const serverSwitchingRef = useRef(false);
  const instantSwitchRef = useRef(false);
  const [serverSwitching, setServerSwitching] = useState(false);

  // NOTE: Aggressive next-episode preload removed — it caused CORS fetches
  // and wasted bandwidth that slowed the *current* video load. Browser will
  // naturally prefetch via the video element when user switches.

  const switchServer = useCallback((serverIndex: number, manual = true) => {
    if (serverIndex === activeServerIndex || !effectiveVideoServers[serverIndex]) return;
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

    if (manual) {
      manualServerSelectedRef.current = true;
      preferredServerIndexRef.current = serverIndex;
    }
    setManualServerSelected((prev) => (manual ? true : prev));
    setActiveServerIndex(serverIndex);
    activeSourceBaseRef.current = newRawSrc;
    pendingSeek.current = savedTime;

    if (manual) {
      failedSrcsRef.current.clear();
    } else {
      failedSrcsRef.current = new Set([...failedSrcsRef.current].filter((key) => key.startsWith("__server_failover_")));
    }
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

    window.setTimeout(() => {
      serverSwitchingRef.current = false;
      setServerSwitching(false);
    }, 180);
  }, [activeServerIndex, effectiveVideoServers, resolvePlaybackSrc, getServerScopedSource, isEmbedPlayback, isPremium, playing]);

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
      switchServer(premIdx, false);
    }, 250);
    return () => window.clearTimeout(t);
  }, [isPremium, effectiveVideoServers, activeServerIndex, switchServer, manualServerSelected]);

  const tryNextPlaybackRoute = useCallback((lastKnownTime = 0) => {
    if (isAnimeSaltContent) {
      // Do NOT immediately show "Link expired" on AN — the synthetic HLS master
      // with separate audio/video playlists can throw transient network errors
      // during startup that hls.js recovers from on its own. Only surface the
      // error banner after multiple fatal retries have already been consumed.
      // A single transient fetch failure is not proof the link is dead.
      if (hlsFatalRetriesRef.current < 3) {
        // Let hls.js keep retrying; do not poison the UI.
        return false;
      }
      setVideoError(true);
      return false;
    }

    const v = videoRef.current;
    const savedTime = lastKnownTime || v?.currentTime || lastPlaybackPositionRef.current || 0;
    const isSeekRecovery = Date.now() < seekRecoveryUntilRef.current;
    if (isSeekRecovery && isCurrentPlaybackSourceValid()) {
      // A far seek on non-faststart MP4 can legitimately take 15-30s while the
      // browser walks MP4 byte ranges. Treat it as buffering, not expired. Route
      // switching here aborts the in-flight range and creates the endless loader.
      return false;
    }
    const reloadCurrentHealthyRoute = (limit: number, delayBase = 220) => {
      rsSoftRetriesRef.current = (rsSoftRetriesRef.current || 0) + 1;
      if (rsSoftRetriesRef.current > limit || !v) return false;
      pendingSeek.current = savedTime;
      mediaRecoverySeekRef.current = savedTime;
      const retrySrc = currentSrc || resolvePlaybackSrc(activeSourceBaseRef.current || sourceBaseRef.current || src);
      window.setTimeout(() => {
        try {
          if (retrySrc && v.src !== retrySrc) v.src = retrySrc;
          v.load();
          const restore = () => {
            try { if (savedTime > 0) v.currentTime = savedTime; } catch {}
            if (userPlaybackIntentRef.current && !adGateActiveRef.current) v.play().catch(() => {});
          };
          if (v.readyState >= 1) restore();
          else v.addEventListener("loadedmetadata", restore, { once: true });
        } catch {}
      }, delayBase * rsSoftRetriesRef.current);
      return true;
    };

    // RS rule: a source that already played or produced media metadata is VALID.
    // Normal stalls can soft-reload, but seek stalls must NOT call load() on the
    // same URL: that aborts the exact range request the browser is waiting for
    // and restarts from byte 0, which is the endless spinner users see after drag seek.
    if (isCurrentPlaybackSourceValid() && !isSeekRecovery) {
      if (reloadCurrentHealthyRoute(RS_NORMAL_RELOAD_LIMIT, 350)) return true;
    }

    const failedKey = currentSrc || activeSourceBaseRef.current || sourceBaseRef.current;
    if (!failedKey) return false;

    console.log('Video failed after retries. URL:', failedKey);
    failedSrcsRef.current.add(failedKey);

    // Same quality, alternate route first (proxy ↔ direct) before touching quality/server.
    const sameQualityRouteFallback = buildPlaybackCandidates(
      activeSourceBaseRef.current,
      cdnEnabled,
      proxyUrl || undefined,
      proxyApiKey || undefined,
      preferProxy
    ).find((candidateSrc) => !failedSrcsRef.current.has(candidateSrc) && candidateSrc !== currentSrc && candidateSrc !== failedKey);

    if (sameQualityRouteFallback) {
      pendingSeek.current = activeSeekTargetRef.current ?? (lastKnownTime || videoRef.current?.currentTime || 0);
      mediaRecoverySeekRef.current = pendingSeek.current;
      seekRecoveryUntilRef.current = Date.now() + RS_SEEK_GRACE_MS;
      rsSoftRetriesRef.current = 0;
      setCurrentSrc(sameQualityRouteFallback);
      setVideoError(false);
      setIsBuffering(true);
      return true;
    }

    // Auto mode must not die on the default/1080 file when lower qualities for
    // the same episode are still present. Some RS Server 2 files return a valid
    // HEAD/content-length but close the GET stream; when that happens, try the
    // next playable quality on the SAME configured server before showing expired.
    if (shouldAllowAutoQualityShift() && availableQualities.length > 1) {
      const qualityRank = (label: string) => {
        const value = label.toLowerCase();
        if (value.includes("720")) return 1;
        if (value.includes("480") || value.includes("360")) return 2;
        if (value.includes("1080")) return 3;
        if (is4KLabel(label)) return 4;
        return 9;
      };
      const qualityFallback = availableQualities
        .filter((option) => option.label !== "Auto" && option.src && (!is4KLabel(option.label) || isPremium))
        .sort((a, b) => qualityRank(a.label) - qualityRank(b.label))
        .find((option) => {
          const raw = getServerScopedSource(option.src, activeServerIndex);
          const resolved = buildPlaybackCandidates(raw, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined, preferProxy)[0];
          return !!resolved
            && resolved !== currentSrc
            && resolved !== failedKey
            && raw !== activeSourceBaseRef.current
            && !failedSrcsRef.current.has(resolved)
            && !failedSrcsRef.current.has(raw);
        });

      if (qualityFallback) {
        const nextRaw = getServerScopedSource(qualityFallback.src, activeServerIndex);
        const nextResolved = buildPlaybackCandidates(nextRaw, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined, preferProxy)[0];
        if (nextResolved) {
          pendingSeek.current = lastKnownTime || videoRef.current?.currentTime || 0;
          sourceBaseRef.current = qualityFallback.src;
          activeSourceBaseRef.current = nextRaw;
          currentQualityRef.current = qualityFallback.label;
          setCurrentQuality(qualityFallback.label);
          setCurrentSrc(nextResolved);
          setVideoError(false);
          setIsBuffering(true);
          retryAttemptsRef.current.clear();
          rsSoftRetriesRef.current = 0;
          autoQualityShiftCountRef.current += 1;
          return true;
        }
      }
    }

    // Proxy/direct upstream is down/closed (for example bot-hosting silently
    // closes old Telegram file IDs). Even if the user manually tapped that
    // server, don't trap playback on a dead origin and show "Link expired" —
    // move through the next admin-configured RS servers with the same episode
    // path/query. This is explicit server failover, not hidden mirror swapping.
    if (!isSeekRecovery && effectiveVideoServers.length > 1) {
      failedSrcsRef.current.add(`__server_failover_${activeServerIndex}`);
      for (let offset = 1; offset < effectiveVideoServers.length; offset += 1) {
        const nextIndex = (activeServerIndex + offset) % effectiveVideoServers.length;
        const nextServer = effectiveVideoServers[nextIndex];
        if (!nextServer || (nextServer.locked && !isPremium)) continue;
        if (failedSrcsRef.current.has(`__server_failover_${nextIndex}`)) continue;
        const nextRaw = getServerScopedSource(sourceBaseRef.current || activeSourceBaseRef.current, nextIndex);
        const nextResolved = buildPlaybackCandidates(
          nextRaw,
          cdnEnabled,
          proxyUrl || undefined,
          proxyApiKey || undefined,
          preferProxy
        )[0];
        if (!nextResolved || failedSrcsRef.current.has(nextResolved)) continue;
        pendingSeek.current = lastKnownTime || videoRef.current?.currentTime || 0;
        activeSourceBaseRef.current = nextRaw;
        setActiveServerIndex(nextIndex);
        setCurrentSrc(nextResolved);
        setVideoError(false);
        setIsBuffering(true);
        retryAttemptsRef.current.clear();
        return true;
      }
    }

    // No alternate route left. Before declaring the link expired, give the
    // current URL a couple of soft reload attempts — RS/direct-MP4 URLs often
    // fail once on a transient CDN/proxy hiccup (429, cold cache miss, network
    // stall) and recover on the very next request. Marking them expired on the
    // first failure is what caused RS "Link expired" to appear even on healthy
    // links.
    rsSoftRetriesRef.current = (rsSoftRetriesRef.current || 0) + 1;
    if (rsSoftRetriesRef.current <= RS_NORMAL_RELOAD_LIMIT && videoRef.current) {
      const v = videoRef.current;
      const resumeAt = savedTime || v.currentTime || 0;
      pendingSeek.current = resumeAt;
      // Force the video element to re-request the same URL. Clear the failed
      // key so buildPlaybackCandidates can re-consider it after the retry.
      failedSrcsRef.current.delete(failedKey);
      const delay = 400 * rsSoftRetriesRef.current;
      window.setTimeout(() => {
        try {
          v.load();
          v.play().catch(() => {});
        } catch {}
      }, delay);
      return true;
    }

    // All soft retries exhausted → really expired.
    setVideoError(true);
    return false;
  }, [activeServerIndex, availableQualities, cdnEnabled, currentSrc, effectiveVideoServers, getServerScopedSource, isAnimeSaltContent, isPremium, isCurrentPlaybackSourceValid, noProxy, preferProxy, proxyApiKey, proxyUrl, resolvePlaybackSrc, shouldAllowAutoQualityShift, src]);

  const tryNextPlaybackRouteRef = useRef(tryNextPlaybackRoute);
  useEffect(() => {
    tryNextPlaybackRouteRef.current = tryNextPlaybackRoute;
  }, [tryNextPlaybackRoute]);

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
  const rsSoftRetriesRef = useRef(0);
  const hlsSubtitleMetaRef = useRef<HlsSubtitleOption[]>([]);
  const subtitleCueListRef = useRef<Array<{ start: number; end: number; text: string }>>([]);
  const subtitlePollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subtitleSwitchingUntilRef = useRef(0);

  const externalSubtitleOptions = useMemo<HlsSubtitleOption[]>(() => {
    return (propSubtitleTracks || [])
      .map((track, index) => ({
        id: 10000 + index,
        label: String(track?.label || track?.language || `Subtitle ${index + 1}`).trim(),
        language: String(track?.language || "und").trim() || "und",
        url: String(track?.url || "").trim(),
        external: true,
      }))
      .filter((track) => !!track.url);
  }, [propSubtitleTracks]);
  const externalSubtitleOptionsRef = useRef<HlsSubtitleOption[]>([]);
  useEffect(() => { externalSubtitleOptionsRef.current = externalSubtitleOptions; }, [externalSubtitleOptions]);

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

  const manualSeekUntilRef = useRef(0);
  const mediaRecoverySeekRef = useRef<number | null>(null);
  const playbackCheckpointKeyRef = useRef("");
  const checkpointWriteAtRef = useRef(0);

  useEffect(() => {
    playbackCheckpointKeyRef.current = animeId
      ? `rs_player_checkpoint:${animeId}:${currentSeasonIdx ?? "movie"}:${currentEpisodeIdx ?? "movie"}`
      : "";
    try {
      const raw = playbackCheckpointKeyRef.current ? sessionStorage.getItem(playbackCheckpointKeyRef.current) : null;
      const saved = raw ? JSON.parse(raw) : null;
      const savedTime = Number(saved?.time || 0);
      const savedAt = Number(saved?.savedAt || 0);
      if (savedTime > 1 && (!savedAt || Date.now() - savedAt < 12 * 60 * 60 * 1000)) {
        lastPlaybackPositionRef.current = Math.max(lastPlaybackPositionRef.current || 0, savedTime);
        mediaRecoverySeekRef.current = Math.max(mediaRecoverySeekRef.current || 0, savedTime);
        pendingSeek.current = Math.max(Number(pendingSeek.current || 0), savedTime);
        setCurrentTime((prev) => Math.max(prev || 0, savedTime));
      }
    } catch {}
  }, [animeId, currentEpisodeIdx, currentSeasonIdx]);

  const persistResumeCheckpoint = useCallback((time: number, duration?: number) => {
    if (!Number.isFinite(time) || time <= 1) return;
    const key = playbackCheckpointKeyRef.current;
    if (!key) return;
    try {
      sessionStorage.setItem(key, JSON.stringify({
        time,
        duration: Number.isFinite(duration || 0) ? duration || 0 : 0,
        savedAt: Date.now(),
      }));
    } catch {}
  }, []);

  const preserveResumePoint = useCallback((candidate = 0) => {
    const v = videoRef.current;
    const live = v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
    const last = Number.isFinite(lastPlaybackPositionRef.current) ? lastPlaybackPositionRef.current : 0;
    const target = Math.max(candidate || 0, live || 0, last || 0);
    if (target > 1) {
      lastPlaybackPositionRef.current = target;
      mediaRecoverySeekRef.current = target;
      pendingSeek.current = target;
      persistResumeCheckpoint(target, v?.duration);
    }
    return target;
  }, [persistResumeCheckpoint]);

  const repairUnexpectedReset = useCallback((targetVideo?: HTMLVideoElement | null) => {
    const v = targetVideo || videoRef.current;
    if (!v || Date.now() < manualSeekUntilRef.current) return false;
    const target = Math.max(
      Number(pendingSeek.current || 0),
      Number(mediaRecoverySeekRef.current || 0),
      Number(lastPlaybackPositionRef.current || 0),
    );
    if (target <= 5) return false;
    if (Number.isFinite(v.duration) && v.duration > 0 && target >= v.duration - 1) return false;
    if (v.currentTime > 3 || v.currentTime >= target - 2) return false;
    try {
      v.currentTime = target;
      pendingSeek.current = null;
      setCurrentTime(target);
      return true;
    } catch {
      pendingSeek.current = target;
      return false;
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

  const isPlayerInteractiveTarget = useCallback((target: EventTarget | null) => {
    return target instanceof HTMLElement && !!target.closest("[data-player-panel='true'],button,a,input,select,textarea,[role='button']");
  }, []);

  useEffect(() => {
    const hasActiveSubtitleMeta = hlsSubtitleMetaRef.current.some((track) => track.id === currentHlsSubtitle);
    if (currentHlsSubtitle < 0 || (!isHlsSrc && !hasActiveSubtitleMeta)) {
      clearSubtitlePolling();
      setSubtitleOverlayText("");
      if (!isHlsSrc && !hasActiveSubtitleMeta) {
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
    const activeExternalSubtitleOptions = externalSubtitleOptionsRef.current;
    if (!v || !currentSrc || !isHlsSrc || isEmbedPlayback) {
      // Tear down any existing instance when not in HLS mode
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch {}
        hlsRef.current = null;
      }
      // Non-HLS MP4/direct sources can still have admin-provided external
      // subtitle tracks. Keep those tracks available for the CC panel instead
      // of hiding the button completely.
      setHlsAudioOptions([]);
      setCurrentHlsAudio(-1);
      if (activeExternalSubtitleOptions.length > 0 && currentSrc && !isEmbedPlayback) {
        hlsSubtitleMetaRef.current = activeExternalSubtitleOptions;
        setHlsSubtitleOptions(activeExternalSubtitleOptions);
        setCurrentHlsSubtitle((prev) => activeExternalSubtitleOptions.some((track) => track.id === prev) ? prev : -1);
      } else {
        hlsSubtitleMetaRef.current = [];
        setHlsSubtitleOptions([]);
        setCurrentHlsSubtitle(-1);
      }
      return;
    }

    let hlsObjectUrl: string | null = null;
    let hlsSource = buildReliableHlsSource(currentSrc);
    if (isDataHlsUrl(hlsSource)) {
      try {
        const comma = hlsSource.indexOf(",");
        const meta = hlsSource.slice(0, comma).toLowerCase();
        const payload = hlsSource.slice(comma + 1);
        const text = meta.includes(";base64") ? decodeURIComponent(escape(atob(payload))) : decodeURIComponent(payload);
        hlsObjectUrl = URL.createObjectURL(new Blob([text], { type: "application/vnd.apple.mpegurl" }));
        hlsSource = hlsObjectUrl;
      } catch {}
    }

    // Safari: native HLS — still expose subtitle tracks via TextTrackList
    if (v.canPlayType("application/vnd.apple.mpegurl") && !Hls.isSupported()) {
      v.src = hlsSource;
      return () => { if (hlsObjectUrl) URL.revokeObjectURL(hlsObjectUrl); };
    }

    if (!Hls.isSupported()) {
      if (hlsObjectUrl) URL.revokeObjectURL(hlsObjectUrl);
      return;
    }

    // Fresh instance per source change
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }

    // Reset retry accounting for every source/quality switch. Without this, a
    // previous 480p/old-source error can poison the next manual 720p/1080p load
    // and immediately trigger fallback, which looked like the player was
    // "switching back" to 480p even when the selected URL was healthy.
    hlsFatalRetriesRef.current = 0;
    rsSoftRetriesRef.current = 0;

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      testBandwidth: true,
      abrEwmaDefaultEstimate: 5_000_000,
      abrBandWidthFactor: 0.9,
      abrBandWidthUpFactor: 0.7,
      abrMaxWithRealBitrate: true,
      backBufferLength: 90,
      maxBufferLength: 60,
      maxMaxBufferLength: 600,
      maxBufferSize: 200 * 1024 * 1024,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
      nudgeMaxRetry: 8,
      nudgeOffset: 0.1,
      maxFragLookUpTolerance: 0.25,
      startLevel: -1,
      startFragPrefetch: true,
      progressive: true,
      manifestLoadingTimeOut: 7000,
      manifestLoadingMaxRetry: 4,
      manifestLoadingRetryDelay: 250,
      levelLoadingTimeOut: 7000,
      levelLoadingMaxRetry: 4,
      levelLoadingRetryDelay: 250,
      fragLoadingTimeOut: 16000,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 250,
      appendErrorMaxRetry: 4,
      capLevelToPlayerSize: true,
      renderTextTracksNatively: false,
    });
    hlsRef.current = hls;

    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      hls.loadSource(hlsSource);
    });
    hls.attachMedia(v);

    const applyPreferredHlsAudio = () => {
      const tracks = hls.audioTracks || [];
      if (tracks.length === 0) return;
      // AN opens Hindi by default, but after the user selects English/another
      // available track, episode changes must keep that user-selected language.
      const hindiIdx = tracks.findIndex((track: any) => {
        const blob = `${track?.lang || ""} ${track?.name || ""}`.toLowerCase();
        return /hindi|हिन्दी|हिंदी|\bhin\b/.test(blob);
      });
      const preferredLanguage = selectedLanguageRef.current;
      const preferredToken = String(getPrimaryLanguageToken(preferredLanguage) || preferredLanguage || "").toLowerCase();
      const preferredIdx = preferredToken
        ? tracks.findIndex((track: any) => {
            const blob = `${track?.lang || ""} ${track?.name || ""}`.toLowerCase();
            return blob.includes(preferredToken);
          })
        : -1;
      const defaultIdx = tracks.findIndex((track: any) => track?.default);
      const wanted = preferredIdx >= 0 ? preferredIdx : (hindiIdx >= 0 ? hindiIdx : (defaultIdx >= 0 ? defaultIdx : 0));
      try { hls.audioTrack = wanted; } catch {}
    };

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
      const manifestSubtitleOptions = sTracks.map((t, i) => ({
        id: i,
        label: t.name || t.lang || `Subtitle ${i + 1}`,
        language: t.lang || "und",
        url: t.url,
      }));
      const seenSubtitleUrls = new Set(manifestSubtitleOptions.map((track) => String(track.url || "").trim()).filter(Boolean));
      const nextSubtitleOptions = [
        ...manifestSubtitleOptions,
        ...activeExternalSubtitleOptions.filter((track) => !seenSubtitleUrls.has(String(track.url || "").trim())),
      ];
      hlsSubtitleMetaRef.current = nextSubtitleOptions;
      setHlsSubtitleOptions(nextSubtitleOptions);
      if (nextSubtitleOptions.length === 0) {
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
      if (mediaRecoverySeekRef.current && mediaRecoverySeekRef.current > 1) {
        pendingSeek.current = Math.max(pendingSeek.current || 0, mediaRecoverySeekRef.current);
      }
      // Select Hindi/preferred audio before first play so AN opens already in
      // the correct language instead of visibly switching 4-5 seconds later.
      applyPreferredHlsAudio();
      refreshHlsAudio();
      refreshHlsSubs();
      try { hls.startLoad(pendingSeek.current && pendingSeek.current > 0 ? pendingSeek.current : -1); } catch {}
      if (userPlaybackIntentRef.current && !adGateActiveRef.current) v.play().catch(() => {});
    });
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      applyPreferredHlsAudio();
      refreshHlsAudio();
    });
    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, refreshHlsAudio);
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, refreshHlsSubs);
    hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_e, d: any) => {
      if (typeof d?.id === "number") {
        setCurrentHlsSubtitle(d.id);
      }
    });

    hls.on(Hls.Events.ERROR, (_evt, data) => {
      console.warn("[HLS] playback error", {
        type: data.type,
        details: data.details,
        fatal: data.fatal,
        code: data.response?.code,
      });
      if (!data.fatal) return;
      const savedBeforeRecovery = preserveResumePoint(videoRef.current?.currentTime || 0);
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
      const fatalRetryLimit = isAnimeSaltContent ? 8 : (manualQualitySelectedRef.current ? 5 : 2);
      if (hlsFatalRetriesRef.current > fatalRetryLimit) {
        try { hls.destroy(); } catch {}
        hlsRef.current = null;
        if (!isAnimeSaltContent || [403, 410].includes(Number(data.response?.code || 0))) {
          tryNextPlaybackRouteRef.current(savedBeforeRecovery);
        } else {
          setVideoError(false);
          setIsBuffering(false);
        }
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
      if (hlsObjectUrl) URL.revokeObjectURL(hlsObjectUrl);
    };
  }, [currentSrc, isHlsSrc, isEmbedPlayback, buildReliableHlsSource, preserveResumePoint]);

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
    const meta = hlsSubtitleMetaRef.current.find((track) => track.id === idx);
    subtitleSwitchingUntilRef.current = Date.now() + 1600;
    setSubtitleOverlayText("");
    setSubtitleStatusTone(idx >= 0 ? "neutral" : "success");
    setSubtitleStatusMessage(idx >= 0 ? "Loading subtitles..." : "Subtitles turned off.");
    if (hls) {
      if (idx >= 0 && !meta?.external) {
        hls.subtitleDisplay = true;
        hls.subtitleTrack = idx;
      } else {
        try { hls.subtitleDisplay = false; hls.subtitleTrack = -1; } catch {}
      }
    }
    setCurrentHlsSubtitle(idx);
    setIsBuffering(false);
  }, []);

  const switchHlsAudio = useCallback((idx: number) => {
    const hls = hlsRef.current;
    if (hls && idx >= 0) {
      try { hls.audioTrack = idx; } catch {}
    }
    const track = hlsAudioOptions[idx];
    if (track) {
      const label = track.label || track.language || `Audio ${idx + 1}`;
      setCurrentAudioTrack(label);
      setActivePlaybackLanguage(label);
      setSelectedLanguageLabel(getPrimaryLanguageToken(label) || label);
      if (isAnimeSaltContent) saveAnAudioLanguagePref(getPrimaryLanguageToken(label) || label);
    }
    setCurrentHlsAudio(idx);
    setShowCcPanel(false);
  }, [hlsAudioOptions, isAnimeSaltContent]);


  // Build one authoritative list for both RS language variants and AN audio
  // renditions. RS often stores languages in seasonsByLanguage rather than on
  // episode.audioTracks, so relying on propAudioTracks hid the button on the
  // initial Hindi source.
  useEffect(() => {
    const tracks: AudioTrackOption[] = normalizedLanguageTracks.map((track) => ({
      language: track.language,
      label: track.label,
      src: track.link,
      audioUrl: track.audioUrl,
      rawAudioUrl: track.rawAudioUrl,
      src480: track.link480,
      src720: track.link720,
      src1080: track.link1080,
      src4k: track.link4k,
    }));
    
    // Always update options immediately
    setAudioTrackOptions(tracks);
    
    // Auto-detect which track matches the active resource language (e.g. Hindi)
    if (tracks.length > 0) {
      const resourceLang = selectedLanguageLabel || selectedLanguage || anime?.language || "";
      const matched = tracks.find(t => {
        const lbl = (t.label || t.language || "").toLowerCase();
        const res = resourceLang.toLowerCase();
        return lbl && res && (lbl.includes(res) || res.includes(lbl));
      });
      const initialLabel = matched ? (matched.label || matched.language || "") : (tracks[0].label || tracks[0].language || "");
      setCurrentAudioTrack(initialLabel);
      setActivePlaybackLanguage(initialLabel);
    } else {
      // Clear language if no multi-audio tracks are available (standard content)
      setCurrentAudioTrack("");
      setActivePlaybackLanguage("");
    }
  }, [anime?.language, normalizedLanguageTracks, selectedLanguage, selectedLanguageLabel]);

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

    // AN/HLS streams expose audio renditions inside the same HLS master.
    if (isAnimeSaltContent && hlsRef.current) {
      const aTracks = hlsRef.current.audioTracks || [];
      if (aTracks.length > 0) {
        const normalize = (value?: string) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
        const wanted = normalize(track.label || track.language);
        const wantedToken = normalize(getPrimaryLanguageToken(track.label || track.language || ""));
        
        const matchedIdx = aTracks.findIndex((opt: any) => {
          const optFull = normalize(opt.name || opt.lang);
          const optToken = normalize(getPrimaryLanguageToken(opt.name || opt.lang || ""));
          return !!wanted && (optFull === wanted || optToken === wanted || (!!wantedToken && optToken === wantedToken));
        });

        if (matchedIdx >= 0) {
          try { hlsRef.current.audioTrack = matchedIdx; } catch {}
          setCurrentHlsAudio(matchedIdx);
          setCurrentAudioTrack(track.label);
          setActivePlaybackLanguage(track.label || track.language || "");
          setSelectedLanguageLabel(track.label || track.language || "");
          saveAnAudioLanguagePref(getPrimaryLanguageToken(track.label || track.language || "") || track.label || track.language || "");
          setShowAudioPanel(false);
          return;
        }
      }
    }

    if (track.hlsAudioIndex !== undefined && hlsRef.current) {
      hlsRef.current.audioTrack = track.hlsAudioIndex;
      setCurrentAudioTrack(track.label);
      setActivePlaybackLanguage(track.label || track.language || "");
      setSelectedLanguageLabel(track.label || track.language || "");
      saveAnAudioLanguagePref(getPrimaryLanguageToken(track.label || track.language || "") || track.label || track.language || "");
    } else if (track.nativeIndex !== undefined) {
      const audioTracks = (v as any).audioTracks;
      if (audioTracks) {
        for (let i = 0; i < audioTracks.length; i++) {
          audioTracks[i].enabled = i === track.nativeIndex;
        }
      }
      setCurrentAudioTrack(track.label);
      setActivePlaybackLanguage(track.label || track.language || "");
      setSelectedLanguageLabel(track.label || track.language || "");
      saveAnAudioLanguagePref(getPrimaryLanguageToken(track.label || track.language || "") || track.label || track.language || "");
    } else if (track.src) {
      // RS / Multi-quality audio switching
      let audioUrl = track.src;
      const q = currentQuality.toLowerCase();
      if (q.includes('4k') || q.includes('2160') || q.includes('uhd')) audioUrl = track.src4k || track.src1080 || track.src;
      else if (q.includes('1080')) audioUrl = track.src1080 || track.src;
      else if (q.includes('720')) audioUrl = track.src720 || track.src;
      else if (q.includes('480')) audioUrl = track.src480 || track.src;
      
      // Update UI state immediately
      setCurrentAudioTrack(track.label);
      setActivePlaybackLanguage(track.label || track.language || "");
      setSelectedLanguageLabel(track.label || track.language || "");
      saveAnAudioLanguagePref(getPrimaryLanguageToken(track.label || track.language || "") || track.label || track.language || "");

      // Force reload for source change
      sourceBaseRef.current = audioUrl;
      // Language URLs already represent the chosen episode source. Keep the
      // currently selected server index explicitly instead of allowing the
      // default resolver to reset/jump servers.
      const finalAudioUrl = getServerScopedSource(audioUrl, activeServerIndex);
      const proxiedSrc = resolvePlaybackSrc(finalAudioUrl);
      activeSourceBaseRef.current = finalAudioUrl;
      pendingSeek.current = savedTime;
      
      try {
        v.pause();
        setCurrentSrc(proxiedSrc);
        v.src = proxiedSrc;
        v.load();
        const restoreTime = () => {
          try {
            if (v.duration > 0) {
              v.currentTime = savedTime;
              if (wasPlaying) v.play().catch(() => {});
              v.removeEventListener("loadedmetadata", restoreTime);
            }
          } catch {}
        };
        v.addEventListener("loadedmetadata", restoreTime);
      } catch {}
    }
    setShowAudioPanel(false);
  }, [activeServerIndex, currentQuality, hlsAudioOptions, resolvePlaybackSrc, getServerScopedSource, isAnimeSaltContent]);

  const selectAudioTrack = useCallback((track: AudioTrackOption) => {
    const label = track.label || track.language || "";
    // RS language variants are complete episode sources. Let the parent resolve
    // the matching seasons/episode while VideoPlayer remains mounted; this keeps
    // the selected server index and avoids treating a language as a server swap.
    if (!isAnimeSaltContent && onLanguageChange && anime?.seasonsByLanguage && label) {
      setCurrentAudioTrack(label);
      setActivePlaybackLanguage(label);
      setSelectedLanguageLabel(label);
      setShowAudioPanel(false);
      onLanguageChange(label);
      return;
    }
    switchAudioTrack(track);
  }, [anime?.seasonsByLanguage, isAnimeSaltContent, onLanguageChange, switchAudioTrack]);

  const resetToDefaultAudio = useCallback(() => {
    if (audioTrackOptions.length === 0) return;
    switchAudioTrack(audioTrackOptions[0]);
  }, [audioTrackOptions, switchAudioTrack]);

  // Track the last `src` we actually reacted to. Without this guard the effect
  // re-runs whenever qualityOptions / resolvePlaybackSrc identity changes
  // (every parent re-render), which would clobber a user-selected quality back
  // to "Auto" within ~1s of switching. We only want a true episode change to
  // reset the player state.
  const lastSourceFingerprintRef = useRef<string>("");
  const lastEpisodeKeyRef = useRef<string>("");
  useEffect(() => {
    if (!playbackRouteReady) return;
    if (!noServerSwitch && !isHlsLikeUrl(src) && isInsecureHttpSource(src) && !effectiveVideoServers.length && !videoServersLoaded) return;
    const episodeKey = `${(anime as any)?.id ?? ""}__${currentSeasonIdx ?? "movie"}__${currentEpisodeIdx ?? "movie"}`;
    const nextFingerprint = `${src}__${episodeKey}`;
    if (lastSourceFingerprintRef.current === nextFingerprint) return; // same episode/movie source
    // If only `src` changed for the SAME episode, preserve playback position so
    // pause→resume / parent re-render never restarts from 0.
    const sameEpisodeUrlRefresh =
      lastSourceFingerprintRef.current !== "" && lastEpisodeKeyRef.current === episodeKey;
    lastSourceFingerprintRef.current = nextFingerprint;
    lastEpisodeKeyRef.current = episodeKey;
    instantSwitchRef.current = true;
    const nextQualityOptions: QualityOption[] = [{ label: "Auto", src }, ...(qualityOptions || []).filter((q) => q.src)];
    // Per-anime quality memory only: preserve the user's manual pick within
    // the same series/anime (episode switches). On a brand-new anime the
    // per-anime reset effect (animeId change) has already cleared this ref,
    // so we always fall back to Auto — no global localStorage carry-over,
    // no forced low-quality auto-start.
    const preservedQuality = manualQualitySelectedRef.current && currentQuality !== "Auto"
      ? nextQualityOptions.find((q) => q.label === currentQuality && (!is4KLabel(q.label) || isPremium))
      : null;
    const autoStartQuality = null as QualityOption | null;
    const baseRawSrc = preservedQuality?.src || src;
    const isFastHlsSource = isHlsLikeUrl(baseRawSrc);
    const hadManualServer = manualServerSelectedRef.current;
    const rememberedServerIndex = typeof preferredServerIndexRef.current === "number" ? preferredServerIndexRef.current : activeServerIndex;
    const targetServerIndex = !isFastHlsSource && hadManualServer && effectiveVideoServers.length
      ? Math.min(Math.max(rememberedServerIndex, 0), effectiveVideoServers.length - 1)
      : 0;

    // Snapshot current playhead BEFORE swapping src so we can restore it for
    // URL refreshes on the same episode.
    const _v = videoRef.current;
    const livePosition = _v && Number.isFinite(_v.currentTime) ? _v.currentTime : 0;
    const preservedTime = sameEpisodeUrlRefresh
      ? Math.max(livePosition || 0, lastPlaybackPositionRef.current || 0)
      : 0;

    // AN runtime source refresh is completely disabled. Admin-saved data is the
    // source of truth; same-episode prop URL changes must never rebuild HLS or
    // reset the playhead after pause/ad/overlay state changes.
    if (sameEpisodeUrlRefresh && isAnimeSaltContent) {
      pendingSeek.current = preservedTime > 0 ? preservedTime : null;
      return;
    }

    sourceBaseRef.current = baseRawSrc;
    activeSourceBaseRef.current = baseRawSrc;
    premiumServerApplied.current = !isFastHlsSource && hadManualServer;
    const initialRawSrc = isFastHlsSource ? baseRawSrc : getServerScopedSource(baseRawSrc, targetServerIndex);
    const resolvedSrc = resolvePlaybackSrc(initialRawSrc);
    activeSourceBaseRef.current = initialRawSrc;
    
    // React owns the media src. Imperatively assigning src + load() here raced
    // the rendered src on Safari and eventually left iOS in a blocked pipeline.
    setCurrentSrc(resolvedSrc);
    currentQualityRef.current = preservedQuality?.label || autoStartQuality?.label || "Auto";
    setCurrentQuality(preservedQuality?.label || autoStartQuality?.label || "Auto");
    if (isFastHlsSource || !hadManualServer) {
      manualServerSelectedRef.current = false;
      preferredServerIndexRef.current = null;
      setManualServerSelected(false);
    }
    setActiveServerIndex(targetServerIndex);
    retryAttemptsRef.current.clear();
    setVideoError(false);
    failedSrcsRef.current.clear();
    sourceHealthRef.current.clear();
    seekRecoveryUntilRef.current = 0;
    slowSeekEventsRef.current = [];
    autoQualityShiftCountRef.current = 0;
    const explicitSeek = typeof initialSeekTime === "number" && initialSeekTime > 0 ? initialSeekTime : 0;
    const seekTarget = explicitSeek || preservedTime || 0;
    pendingSeek.current = seekTarget;
    if (_v) {
      if (seekTarget > 0) {
        const onMetaSeek = () => {
          try { _v.currentTime = seekTarget; } catch {}
          _v.removeEventListener("loadedmetadata", onMetaSeek);
        };
        _v.addEventListener("loadedmetadata", onMetaSeek);
      } else if (!sameEpisodeUrlRefresh) {
        try { _v.currentTime = 0; } catch {}
        const onMetaReset = () => {
          try { if (pendingSeek.current === 0 || pendingSeek.current === null) _v.currentTime = 0; } catch {}
          _v.removeEventListener("loadedmetadata", onMetaReset);
        };
        _v.addEventListener("loadedmetadata", onMetaReset);
      }
    }
    setSwitchingEpisode(true);
    const t = setTimeout(() => {
      instantSwitchRef.current = false;
      setSwitchingEpisode(false);
    }, 80);
    return () => clearTimeout(t);
  }, [src, qualityOptions, noProxy, noServerSwitch, playbackRouteReady, resolvePlaybackSrc, getServerScopedSource, initialSeekTime, currentSeasonIdx, currentEpisodeIdx, currentQuality, activeServerIndex, effectiveVideoServers.length, videoServersLoaded, anime, isAnimeSaltContent]);

  useEffect(() => {
    if (!playbackRouteReady || !activeSourceBaseRef.current) return;
    if (activeSeekTargetRef.current !== null) return;
    if (isHlsLikeUrl(activeSourceBaseRef.current)) return;
    if (!noServerSwitch && isInsecureHttpSource(activeSourceBaseRef.current) && !effectiveVideoServers.length && !videoServersLoaded) return;
    const nextResolved = resolvePlaybackSrc(activeSourceBaseRef.current);
    setCurrentSrc((prev) => (prev === nextResolved ? prev : nextResolved));
  }, [playbackRouteReady, proxyUrl, proxyApiKey, cdnEnabled, noServerSwitch, effectiveVideoServers.length, videoServersLoaded, resolvePlaybackSrc]);

  // If Firebase videoServers arrive after the player has already mounted, rebuild
  // the active URL with that admin server domain. This is critical for HTTP
  // RSFR/bot-hosting servers because the proxy can only be applied after the
  // domain swap has produced the final http:// URL.
  useEffect(() => {
    if (!playbackRouteReady || !effectiveVideoServers.length) return;
    if (activeSeekTargetRef.current !== null) return;
    if (isHlsLikeUrl(sourceBaseRef.current || src)) return;
    const safeServerIndex = Math.min(activeServerIndex, effectiveVideoServers.length - 1);
    if (safeServerIndex !== activeServerIndex) setActiveServerIndex(safeServerIndex);

    const scopedRaw = getServerScopedSource(sourceBaseRef.current || src, safeServerIndex);
    activeSourceBaseRef.current = scopedRaw;
    const resolved = resolvePlaybackSrc(scopedRaw);
    setCurrentSrc((prev) => (prev === resolved ? prev : resolved));
    retryAttemptsRef.current.clear();
    setVideoError(false);
  }, [activeServerIndex, effectiveVideoServers.length, getServerScopedSource, playbackRouteReady, resolvePlaybackSrc, src, videoServerFingerprint]);

  useEffect(() => {
    if (!playbackRouteReady || !currentSrc || isEmbedPlayback || adGateActive) return;
    // AN/HLS startup can legitimately take longer while hls.js mounts the
    // synthetic master + separate audio/video playlists. Do not let the generic
    // direct-MP4 watchdog mark it as expired before hls.js has recovered/retried.
    if (isAnimeSaltContent || isHlsSrc) return;
    const raw = activeSourceBaseRef.current || getServerScopedSource(sourceBaseRef.current || src, activeServerIndex);
    const delay = manualQualitySelectedRef.current || isInsecureHttpSource(raw)
      ? 12000
      : /^https:\/\//i.test(raw)
        ? 10000
        : 9000;
    const timer = window.setTimeout(() => {
      const v = videoRef.current;
      if (!v || currentSrc !== v.currentSrc && currentSrc !== v.src) return;
      if (activeSeekTargetRef.current !== null && isCurrentPlaybackSourceValid()) return;
      if (v.readyState < 2) {
        tryNextPlaybackRoute(v.currentTime || 0);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeServerIndex, adGateActive, currentSrc, getServerScopedSource, isAnimeSaltContent, isEmbedPlayback, isHlsSrc, playbackRouteReady, src, tryNextPlaybackRoute]);

  // Fast-detect cloud-blocked HTTP proxies (RSFR/bot-hosting style). The proxy
  // can fail with a quick 502 while the video element waits much longer before
  // firing a media error. Probe one byte and move to the direct/failover route
  // immediately when the proxy endpoint itself reports failure.
  useEffect(() => {
    if (!playbackRouteReady || !currentSrc || isEmbedPlayback || adGateActive) return;
    if (!isVideoProxyPlaybackUrl(currentSrc, proxyUrl)) return;
    const nested = unwrapProxyPlaybackTarget(currentSrc);
    if (!/^http:\/\//i.test(nested)) return;
    const ac = new AbortController();
    const t = window.setTimeout(() => ac.abort(), 6500);
    fetch(currentSrc, { headers: { Range: "bytes=0-0" }, signal: ac.signal })
      .then((res) => {
        const proxyFallback = res.headers.get("x-rs-proxy-fallback") === "1"
          || /application\/json/i.test(res.headers.get("content-type") || "");
        if (proxyFallback || res.status >= 500 || res.status === 403 || res.status === 404) {
          tryNextPlaybackRoute(videoRef.current?.currentTime || 0);
        }
        try { res.body?.cancel(); } catch {}
      })
      .catch((err) => {
        // Timeout is not proof that the server is blocked; let the real video
        // element/watchdog decide. Only immediate network/proxy failures should
        // trigger the route scanner.
        if ((err as any)?.name === "AbortError") return;
        tryNextPlaybackRoute(videoRef.current?.currentTime || 0);
      })
      .finally(() => window.clearTimeout(t));
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [adGateActive, currentSrc, isEmbedPlayback, playbackRouteReady, proxyUrl, tryNextPlaybackRoute]);

  // If the active admin server resolves to http:// but THAT server has no proxy
  // URL saved (Admin → Video Servers), there is no legal browser route (HTTPS
  // pages block raw HTTP). Do not leave the player on a blank src forever —
  // immediately continue the same quality scan/server failover chain.
  useEffect(() => {
    if (!playbackRouteReady || adGateActive || isEmbedPlayback) return;
    const raw = activeSourceBaseRef.current || getServerScopedSource(sourceBaseRef.current || src, activeServerIndex);
    if (!raw || !isInsecureHttpSource(raw) || resolveServerProxyForUrl(raw)) return;
    const t = window.setTimeout(() => {
      tryNextPlaybackRoute(videoRef.current?.currentTime || 0);
    }, 80);
    return () => window.clearTimeout(t);
  }, [activeServerIndex, adGateActive, getServerScopedSource, isEmbedPlayback, playbackRouteReady, proxyUrl, src, tryNextPlaybackRoute, videoServerFingerprint]);

  const applyPendingSeek = useCallback((targetVideo?: HTMLVideoElement | null) => {
    const v = targetVideo || videoRef.current;
    const pendingTarget = pendingSeek.current;
    const recoveryTarget = mediaRecoverySeekRef.current;
    if (!v || (pendingTarget === null && recoveryTarget === null)) return false;
    const target = Math.max(Number(pendingTarget ?? 0), Number(recoveryTarget ?? 0));
    if (!Number.isFinite(target) || target < 0) {
      pendingSeek.current = null;
      mediaRecoverySeekRef.current = null;
      return false;
    }

    const hasSeekContext = v.readyState >= 1 || (Number.isFinite(v.duration) && v.duration > 0);
    if (!hasSeekContext) return false;

    // CRITICAL: never seek BACKWARD on a buffering hiccup. If the video is already
    // playing past the saved point, the user has moved on — clear the pending seek
    // instead of yanking them back. Only restore when the player genuinely reset to 0.
    const current = Number(v.currentTime) || 0;
    if (current >= target - 1.5) {
      pendingSeek.current = null;
      mediaRecoverySeekRef.current = null;
      return false;
    }
    // Only honor a backward jump when the player has actually reset near zero.
    if (current > 2.5) {
      pendingSeek.current = null;
      mediaRecoverySeekRef.current = null;
      return false;
    }

    const maxTarget = Number.isFinite(v.duration) && v.duration > 0
      ? Math.max(0, v.duration - 0.25)
      : target;
    const seekTo = Math.max(0, Math.min(target, maxTarget));

    try {
      v.currentTime = seekTo;
      if (seekTo === 0 || Math.abs(v.currentTime - seekTo) <= 1.5) {
        pendingSeek.current = null;
        mediaRecoverySeekRef.current = null;
        if (seekTo > 0) lastPlaybackPositionRef.current = seekTo;
        setCurrentTime(seekTo);
      }
      return true;
    } catch {
      return false;
    }
  }, []);


  useEffect(() => {
    const v = videoRef.current;
    if (!v || isEmbedPlayback || (pendingSeek.current === null && mediaRecoverySeekRef.current === null)) return;
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
    if (closingRef.current) return;
    closingRef.current = true;
    clearHideTimer();

    const v = videoRef.current;
    const iframe = embedIframeRef.current;
    const hls = hlsRef.current;

    // Close the React layer first. Clearing src/HLS before unmount caused the
    // visible black-back flash the user reported.
    onClose();

    // Heavy / async cleanup deferred to next tick so it never blocks close.
    setTimeout(() => {
      try { v?.pause(); } catch {}
      try { hls?.destroy(); } catch {}
      if (hlsRef.current === hls) hlsRef.current = null;
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
          ['play', 'pause', 'seekbackward', 'seekforward', 'stop', 'nexttrack', 'previoustrack'].forEach((action) => {
            try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, null); } catch {}
          });
        } catch {}
      }
    }, 0);
  }, [clearHideTimer, closeInlineSheets, onClose]);

  // Back button is two-stage in fullscreen/landscape:
  //   1st press → leave fullscreen (back to portrait/windowed player)
  //   2nd press → close the player and return to the page.
  const toggleFullscreenRef = useRef<(() => void | Promise<void>) | null>(null);
  const resetHideTimerRef = useRef<(() => void) | null>(null);
  const handleBackPress = useCallback(() => {
    const inFullscreen =
      Boolean(document.fullscreenElement) ||
      Boolean((document as any).webkitFullscreenElement) ||
      isFullscreen;
    if (inFullscreen) {
      try { (screen.orientation as any).unlock?.(); } catch {}
      void toggleFullscreenRef.current?.();
      setIsFullscreen(false);
      resetHideTimerRef.current?.();
      return;
    }
    stopAndClosePlayer();
  }, [isFullscreen, stopAndClosePlayer]);


  // Pause when user leaves the page/app. Never clear src here: ad popups / app
  // switching can fire pagehide, and wiping the media source restarts playback.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        const v = videoRef.current;
        if (v) { preserveResumePoint(v.currentTime || 0); try { v.pause(); } catch {} }
      }
    };
    const onPageHide = () => {
      const v = videoRef.current;
      if (v) { preserveResumePoint(v.currentTime || 0); try { v.pause(); } catch {} }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [preserveResumePoint]);

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
        try {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.playbackState = 'none';
          ['play', 'pause', 'seekbackward', 'seekforward', 'stop', 'nexttrack', 'previoustrack'].forEach((action) => {
            try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, null); } catch {}
          });
        } catch {}
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

  const stopControlPress = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const toggleServerPanelFast = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    stopControlPress(e);
    setShowServerPanel((p) => !p);
    setShowQualityPanel(false);
    setShowAudioPanel(false);
    setShowCcPanel(false);
    setShowSettings(false);
    resetHideTimer();
  }, [resetHideTimer, stopControlPress]);

  const toggleCcPanelFast = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    stopControlPress(e);
    setShowCcPanel((p) => !p);
    setCcTab(hlsSubtitleOptions.length > 0 ? "subtitle" : "audio");
    setShowAudioPanel(false);
    setShowQualityPanel(false);
    setShowSettings(false);
    setShowServerPanel(false);
    resetHideTimer();
  }, [hlsSubtitleOptions.length, resetHideTimer, stopControlPress]);

  const toggleQualityPanelFast = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    stopControlPress(e);
    setShowQualityPanel((p) => !p);
    setShowAudioPanel(false);
    setShowCcPanel(false);
    setShowSettings(false);
    setShowServerPanel(false);
    resetHideTimer();
  }, [resetHideTimer, stopControlPress]);

  const toggleAudioPanelFast = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    stopControlPress(e);
    setShowAudioPanel((p) => !p);
    setShowQualityPanel(false);
    setShowCcPanel(false);
    setShowSettings(false);
    setShowServerPanel(false);
    resetHideTimer();
  }, [resetHideTimer, stopControlPress]);

  const toggleSettingsPanelFast = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    stopControlPress(e);
    setShowSettings((p) => !p);
    setSettingsTab("speed");
    setShowAudioPanel(false);
    setShowQualityPanel(false);
    setShowCcPanel(false);
    setShowServerPanel(false);
    resetHideTimer();
  }, [resetHideTimer, stopControlPress]);

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

  // Only show the small player spinner during native media startup/switching.
  // AN/details navigation uses only the top "Loading details..." toast from Index.
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
      clearStartupTimer();
      markPlaybackSourceHealthy();
      setDuration(v.duration);
      applyPendingSeek(v);
      repairUnexpectedReset(v);
      try { window.dispatchEvent(new Event("rs:force-close-details-loader")); } catch {}
      // Only autoplay if ad gate is not active
      if (!adGateActiveRef.current && userPlaybackIntentRef.current) {
        // Keep native audio path; do not force muted autoplay fallback
        v.play().catch(() => {});
      }
    };
    const onLoadedData = () => {
      clearStartupTimer();
      markPlaybackSourceHealthy();
      applyPendingSeek(v);
    };
    const onPlay = () => {
      userPlaybackIntentRef.current = true;
      setPlaying(true);
      // Start RAF loop for smooth progress
      const tick = () => {
        if (!v.paused && !v.ended) {
          const ct = v.currentTime;
          if (ct > 0) lastKnownTime = ct;
          if (ct > 0) lastPlaybackPositionRef.current = ct;
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
      userPlaybackIntentRef.current = false;
      preserveResumePoint(v.currentTime || lastKnownTime || 0);
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
    const MAX_RETRIES = manualQualitySelectedRef.current ? 4 : 1;
    // Opt-in faststart retry: if the current source is a video-proxy URL and
    // the browser can't decode the initial bytes (moov-at-end MP4), reload
    // once with `&faststart=1` so the edge rewrites the container. Skipping
    // this by default keeps TTFB near-zero for well-authored files.
    const tryFaststartProxyRetry = (savedTimeForRetry: number): boolean => {
      const cur = currentSrc || "";
      if (!isVideoProxyPlaybackUrl(cur, proxyUrl)) return false;
      if (/[?&]faststart=1(?:&|$)/.test(cur)) return false;
      const boosted = cur + (cur.includes("?") ? "&" : "?") + "faststart=1";
      try {
        v.src = boosted;
        v.load();
        v.addEventListener("loadedmetadata", () => {
          if (savedTimeForRetry > 0) v.currentTime = savedTimeForRetry;
          v.play().catch(() => {});
        }, { once: true });
        return true;
      } catch { return false; }
    };
    const onError = () => {
      const errSrc = currentSrc;
      const savedTimeForRetry = preserveResumePoint(lastKnownTime || v?.currentTime || 0);
      const prev = retryAttemptsRef.current.get(errSrc) || 0;
      const next = prev + 1;
      retryAttemptsRef.current.set(errSrc, next);
      if (next > MAX_RETRIES) {
        // Last resort before switching route: give proxy MP4 a faststart pass.
        if (tryFaststartProxyRetry(savedTimeForRetry)) return;
        tryNextPlaybackRoute(savedTimeForRetry);
        return;
      }
      console.log(`Video error, retry ${next}/${MAX_RETRIES}...`);
      // Exponential backoff: 500ms, 1000ms
      const delay = next * 500;
      setTimeout(() => {
        if (v) {
          const savedTime = preserveResumePoint(savedTimeForRetry || v.currentTime || lastKnownTime);
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
      markPlaybackSourceHealthy();
      finishSeekRecoveryIfReady(v);
      setVideoError(false);
      setIsBuffering(false);
      try { window.dispatchEvent(new Event("rs:force-close-details-loader")); } catch {}
      // Also apply pending seek here in case loadedmetadata didn't fire
      applyPendingSeek(v);
      repairUnexpectedReset(v);
      if (v.paused && !adGateActiveRef.current && userPlaybackIntentRef.current) {
        // Keep native audio path; manual user interaction will start playback if autoplay is blocked
        v.play().catch(() => {});
      }
    };
    const onCanPlayThrough = () => {
      markPlaybackSourceHealthy();
      finishSeekRecoveryIfReady(v);
      setIsBuffering(false);
    };
    let waitingTimer: ReturnType<typeof setTimeout> | null = null;
    let stalledTimer: ReturnType<typeof setTimeout> | null = null;
    let hardStallTimer: ReturnType<typeof setTimeout> | null = null;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStartupTimer = () => {
      if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
    };
    const clearStallRecoveryTimers = () => {
      if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = null; }
      if (stalledTimer) { clearTimeout(stalledTimer); stalledTimer = null; }
      if (hardStallTimer) { clearTimeout(hardStallTimer); hardStallTimer = null; }
      clearStartupTimer();
    };

    // Startup watchdog: if the current source produces NO metadata / no first
    // frame within STARTUP_TIMEOUT, treat it as a dead link and fail over to
    // the next quality/server instead of showing the endless spinner. HLS and
    // AN synthetic sources are excluded — hls.js has its own recovery chain.
    const STARTUP_TIMEOUT_MS = 9000;
    const armStartupWatchdog = () => {
      clearStartupTimer();
      if (isAnimeSaltContent) return;
      const srcNow = currentSrc;
      if (!srcNow || /\.m3u8(?:$|[?#])/i.test(srcNow)) return;
      startupTimer = setTimeout(() => {
        if (!v || adGateActiveRef.current) return;
        // Already produced metadata or is playing — nothing to do.
        if (v.readyState >= 2 || !v.paused) return;
        // User paused intentionally — don't yank the source.
        if (!userPlaybackIntentRef.current) return;
        tryNextPlaybackRoute(lastKnownTime || v.currentTime || 0);
      }, STARTUP_TIMEOUT_MS);
    };

    const scheduleHardStallRecovery = (delay: number) => {
      if (hardStallTimer) clearTimeout(hardStallTimer);
      hardStallTimer = setTimeout(() => {
        if (adGateActiveRef.current || v.paused || !userPlaybackIntentRef.current) return;
        const seekTarget = activeSeekTargetRef.current;
        const seekStillStuck = seekTarget !== null && !finishSeekRecoveryIfReady(v);
        const playbackStillStuck = v.readyState < 3;
        if (!seekStillStuck && !playbackStillStuck) return;
        if (seekStillStuck) {
          slowSeekEventsRef.current = [...slowSeekEventsRef.current.filter((ts) => Date.now() - ts < 2 * 60 * 1000), Date.now()];
        }
        tryNextPlaybackRoute(seekTarget ?? (lastKnownTime || v.currentTime || 0));
      }, delay);
    };

    // Debounce waiting briefly to avoid flashing on tiny buffer hiccups
    const onWaiting = () => {
      if (subtitleSwitchingUntilRef.current > Date.now()) return;
      preserveResumePoint(lastKnownTime || v.currentTime || 0);
      if (waitingTimer) clearTimeout(waitingTimer);
      // Short debounce — show loader quickly on real stalls but stay calm on micro-hiccups
      waitingTimer = setTimeout(() => {
        if (v.readyState < 3) setIsBuffering(true);
      }, 400);
      scheduleHardStallRecovery(activeSeekTargetRef.current !== null ? 45_000 : 9000);
    };
    const onPlaying = () => {
      markPlaybackSourceHealthy();
      finishSeekRecoveryIfReady(v);
      clearStallRecoveryTimers();
      setIsBuffering(false);
      try { window.dispatchEvent(new Event("rs:force-close-details-loader")); } catch {}
    };
    const onLoadStart = () => {
      if (subtitleSwitchingUntilRef.current > Date.now()) return;
      // Only show loader if we genuinely don't have data yet
      if (v.readyState < 2) setIsBuffering(true);
      armStartupWatchdog();
    };
    const onSeeked = () => {
      markPlaybackSourceHealthy();
      finishSeekRecoveryIfReady(v);
      if (finishSeekRecoveryIfReady(v)) clearStallRecoveryTimers();
      setIsBuffering(false);
    };
    const onStalled = () => {
      if (subtitleSwitchingUntilRef.current > Date.now()) return;
      if (stalledTimer) clearTimeout(stalledTimer);
      stalledTimer = setTimeout(() => {
        if (v.readyState < 3) setIsBuffering(true);
      }, 1500);
      const raw = activeSourceBaseRef.current || sourceBaseRef.current || currentSrc;
      const stallDelay = activeSeekTargetRef.current !== null
        ? 45_000
        : isVideoProxyPlaybackUrl(currentSrc, proxyUrl)
          ? 5500
          : manualQualitySelectedRef.current || isInsecureHttpSource(raw)
            ? 8000
            : 6500;
      scheduleHardStallRecovery(stallDelay);
    };
    const onTimeUpdate = () => {
      const ct = v.currentTime;
      const dur = v.duration;
      repairUnexpectedReset(v);
      if (ct > 0) lastKnownTime = ct;
      if (ct > 0) lastPlaybackPositionRef.current = ct;
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
    v.addEventListener("loadeddata", onLoadedData);
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
    // iOS/Safari fix: Ensure load() is called when the source is set.
    // Some iOS versions ignore source updates without an explicit load().
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && !isHlsSrc && v.getAttribute("src") !== currentSrc) {
      try {
        v.setAttribute("src", currentSrc);
        v.load();
      } catch {}
    }

    return () => {
      cancelAnimationFrame(rafId.current);
      clearStallRecoveryTimers();
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("loadeddata", onLoadedData);
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
  }, [applyPendingSeek, clearSeekRescueTimer, currentSrc, finishSeekRecoveryIfReady, markPlaybackSourceHealthy, playbackRouteReady, preserveResumePoint, repairUnexpectedReset, tryNextPlaybackRoute]);

  // Unmount-only teardown: stop background playback when the player is removed.
  useEffect(() => {
    return () => {
      clearSeekRescueTimer();
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
      const fullscreenElement = document.fullscreenElement;
      const nativeVideoFullscreen = document.documentElement.classList.contains("tv-mode")
        && fullscreenElement instanceof HTMLVideoElement;
      if (nativeVideoFullscreen) {
        // Keep Android TV inside the app's theater workspace instead of its
        // native video-only surface, which hides episodes and suggestions.
        try { document.exitFullscreen?.().catch(() => {}); } catch {}
        setIsFullscreen(false);
        return;
      }
      const fs = !!fullscreenElement;
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
        preserveResumePoint(v.currentTime || 0);
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
  }, [preserveResumePoint]);

  // Resilient resume. A single v.play() can silently reject (AbortError after a
  // pause/seek race) or resolve while the buffer stays stalled — that is what made
  // the player look "stuck paused". We retry, and nudge the buffer if needed.
  const resumePlayback = useCallback((target?: HTMLVideoElement | null) => {
    const v = target || videoRef.current;
    if (!v) return;
    userPlaybackIntentRef.current = true;
    if (resumeRetryTimerRef.current) {
      window.clearTimeout(resumeRetryTimerRef.current);
      resumeRetryTimerRef.current = null;
    }
    const attempt = (n: number) => {
      if (!videoRef.current || videoRef.current !== v) return;
      if (!userPlaybackIntentRef.current) return;
      try {
        const p = v.play();
        if (p && typeof (p as Promise<void>).catch === "function") {
          (p as Promise<void>).catch(() => {
            if (n < 4) resumeRetryTimerRef.current = window.setTimeout(() => attempt(n + 1), 200 + n * 150);
          });
        }
      } catch {
        if (n < 4) resumeRetryTimerRef.current = window.setTimeout(() => attempt(n + 1), 200 + n * 150);
        return;
      }
      resumeRetryTimerRef.current = window.setTimeout(() => {
        if (!videoRef.current || videoRef.current !== v) return;
        if (!v.paused || !userPlaybackIntentRef.current) return;
        if (n === 2) {
          // Buffer stall rescue: a tiny seek re-arms the media pipeline / HLS loader.
          try { v.currentTime = Math.max(0, (v.currentTime || 0) - 0.05); } catch {}
        }
        if (n < 4) attempt(n + 1);
      }, 420);
    };
    attempt(0);
  }, []);

  useEffect(() => () => {
    if (resumeRetryTimerRef.current) window.clearTimeout(resumeRetryTimerRef.current);
  }, []);

  const togglePlay = useCallback(() => {
    if (isEmbedPlayback) {
      userPlaybackIntentRef.current = !playing;
      sendEmbedCmd(playing ? "pause" : "play");
      setPlaying((p) => !p);
      resetHideTimer();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      userPlaybackIntentRef.current = true;
      repairUnexpectedReset(v);
      resumePlayback(v);
    } else {
      userPlaybackIntentRef.current = false;
      if (resumeRetryTimerRef.current) {
        window.clearTimeout(resumeRetryTimerRef.current);
        resumeRetryTimerRef.current = null;
      }
      preserveResumePoint(v.currentTime || 0);
      try { v.pause(); } catch {}
      setPlaying(false);
    }
    resetHideTimer();
  }, [isEmbedPlayback, playing, preserveResumePoint, repairUnexpectedReset, resetHideTimer, resumePlayback, sendEmbedCmd]);

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

  const isTimeBuffered = useCallback((v: HTMLVideoElement, time: number, margin = 0.75) => {
    try {
      const ranges = v.buffered;
      for (let i = 0; i < ranges.length; i += 1) {
        if (time >= ranges.start(i) - margin && time <= ranges.end(i) + margin) return true;
      }
    } catch {}
    return false;
  }, []);

  const fastSeekTo = useCallback((v: HTMLVideoElement, target: number) => {
    const wasPlaying = !v.paused || userPlaybackIntentRef.current;
    const buffered = isTimeBuffered(v, target);
    clearSeekRescueTimer();
    activeSeekTargetRef.current = buffered ? null : target;
    seekRecoveryUntilRef.current = Date.now() + RS_SEEK_GRACE_MS;
    if (!buffered) setIsBuffering(true);
    const directSrcAtSeek = currentSrc;
    const rawSourceAtSeek = activeSourceBaseRef.current || sourceBaseRef.current || src;
    try {
      if ("fastSeek" in v && typeof v.fastSeek === "function") v.fastSeek(target);
      else v.currentTime = target;
    } catch {
      try { v.currentTime = target; } catch {}
    }
    if (wasPlaying && !adGateActiveRef.current) {
      window.setTimeout(() => { v.play().catch(() => {}); }, 0);
    }
    if (!buffered && proxyUrl && rawSourceAtSeek && isInsecureHttpSource(rawSourceAtSeek) && !isHlsLikeUrl(rawSourceAtSeek) && !isVideoProxyPlaybackUrl(directSrcAtSeek, proxyUrl)) {
      seekRescueTimerRef.current = setTimeout(() => {
        const liveVideo = videoRef.current;
        if (!liveVideo || currentSrcRef.current !== directSrcAtSeek) return;
        if (finishSeekRecoveryIfReady(liveVideo)) return;
        const proxyCandidate = buildPlaybackCandidates(rawSourceAtSeek, cdnEnabled, proxyUrl || undefined, proxyApiKey || undefined, true)
          .find((candidate) => candidate && candidate !== directSrcAtSeek && isVideoProxyPlaybackUrl(candidate, proxyUrl));
        if (!proxyCandidate) return;
        slowSeekEventsRef.current = [...slowSeekEventsRef.current.filter((ts) => Date.now() - ts < 2 * 60 * 1000), Date.now()];
        pendingSeek.current = target;
        mediaRecoverySeekRef.current = target;
        retryAttemptsRef.current.clear();
        rsSoftRetriesRef.current = 0;
        setCurrentSrc(proxyCandidate);
        setIsBuffering(true);
      }, RS_SEEK_PROXY_RESCUE_MS);
    }
  }, [cdnEnabled, clearSeekRescueTimer, currentSrc, finishSeekRecoveryIfReady, isTimeBuffered, proxyApiKey, proxyUrl, src]);

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

    manualSeekUntilRef.current = Date.now() + 3500;
    const nextTime = getSafeSeekTime(v, v.currentTime + seconds);
    pendingSeek.current = null;
    mediaRecoverySeekRef.current = null;
    lastPlaybackPositionRef.current = nextTime;
    fastSeekTo(v, nextTime);
    if (progressRef.current && v.duration > 0) progressRef.current.style.width = `${(nextTime / v.duration) * 100}%`;
    if (timeDisplayRef.current && v.duration > 0) timeDisplayRef.current.textContent = `${formatTime(nextTime)} / ${formatTime(v.duration)}`;
    setCurrentTime(nextTime);

    showSkipPill(seconds);
    resetHideTimer();
  }, [fastSeekTo, getSafeSeekTime, isEmbedPlayback, resetHideTimer, sendEmbedCmd, showSkipPill]);

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

  toggleFullscreenRef.current = toggleFullscreen;
  resetHideTimerRef.current = resetHideTimer;


  const applyPlaybackRateNow = useCallback((rate: number) => {
    if (isEmbedPlayback) {
      sendEmbedCmd("rate", { rate });
    } else if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
    setPlaybackRate(rate);
  }, [isEmbedPlayback, resetHideTimer, sendEmbedCmd]);

  const setSpeed = useCallback((rate: number) => {
    applyPlaybackRateNow(rate);
    setShowSettings(false);
    resetHideTimer();
  }, [applyPlaybackRateNow, resetHideTimer]);


  const switchQuality = useCallback((option: QualityOption) => {
    // Block 4K for non-premium users
    if (is4KLabel(option.label) && !isPremium) return;
    // Quality choice is remembered only in-memory for the CURRENT anime via
    // manualQualitySelectedRef + currentQuality. The per-anime reset effect
    // clears both when animeId changes, so a new anime always starts at Auto.

    if (option.label === currentQuality) { setShowSettings(false); return; }

    sourceBaseRef.current = option.src;
    currentQualityRef.current = option.label;
    manualQualitySelectedRef.current = option.label !== "Auto";
    failedSrcsRef.current.clear();
    retryAttemptsRef.current.clear();
    const finalOptionSrc = getServerScopedSource(option.src);
    activeSourceBaseRef.current = finalOptionSrc;
    const newSrc = resolvePlaybackSrc(finalOptionSrc);

    if (newSrc === currentSrc) {
      currentQualityRef.current = option.label;
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
    currentQualityRef.current = option.label;
    setCurrentQuality(option.label);
    setShowSettings(false);

  }, [currentQuality, currentSrc, isPremium, resolvePlaybackSrc, getServerScopedSource, isEmbedPlayback]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    manualSeekUntilRef.current = Date.now() + 3500;
    const target = getSafeSeekTime(v, pct * v.duration);
    pendingSeek.current = null;
    mediaRecoverySeekRef.current = null;
    lastPlaybackPositionRef.current = target;
    fastSeekTo(v, target);
    if (progressRef.current && v.duration > 0) progressRef.current.style.width = `${pct * 100}%`;
    if (timeDisplayRef.current && v.duration > 0) timeDisplayRef.current.textContent = `${formatTime(target)} / ${formatTime(v.duration)}`;
    setCurrentTime(target);
    resetHideTimer();
  }, [fastSeekTo, getSafeSeekTime, resetHideTimer]);

  // Touch drag seeking on progress bar
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isSeeking = useRef(false);
  const pendingTouchSeekRef = useRef<number | null>(null);

  const handleProgressTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isSeeking.current = true;
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    manualSeekUntilRef.current = Date.now() + 3500;
    const target = getSafeSeekTime(v, pct * v.duration);
    pendingSeek.current = null;
    mediaRecoverySeekRef.current = null;
    lastPlaybackPositionRef.current = target;
    pendingTouchSeekRef.current = target;
    if (progressRef.current && v.duration > 0) {
      progressRef.current.style.width = `${pct * 100}%`;
    }
    if (timeDisplayRef.current && v.duration > 0) {
      timeDisplayRef.current.textContent = `${formatTime(target)} / ${formatTime(v.duration)}`;
    }
    setCurrentTime(target);
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
    manualSeekUntilRef.current = Date.now() + 3500;
    pendingSeek.current = null;
    mediaRecoverySeekRef.current = null;
    lastPlaybackPositionRef.current = target;
    pendingTouchSeekRef.current = target;

    if (progressRef.current && v.duration > 0) {
      progressRef.current.style.width = `${(target / v.duration) * 100}%`;
    }
    if (timeDisplayRef.current && v.duration > 0) {
      timeDisplayRef.current.textContent = `${formatTime(target)} / ${formatTime(v.duration)}`;
    }
    setCurrentTime(target);
  }, [getSafeSeekTime]);

  const handleProgressTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isSeeking.current = false;
    const v = videoRef.current;
    const target = pendingTouchSeekRef.current;
    pendingTouchSeekRef.current = null;
    if (v && target !== null) {
      manualSeekUntilRef.current = Date.now() + 3500;
      pendingSeek.current = null;
      mediaRecoverySeekRef.current = null;
      lastPlaybackPositionRef.current = target;
      fastSeekTo(v, target);
    }
    resetHideTimer();
  }, [fastSeekTo, resetHideTimer]);

  const lastTap = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    if (skipIndicatorTimerRef.current) clearTimeout(skipIndicatorTimerRef.current);
  }, []);

  const handleVideoClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (suppressNextClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressNextClickRef.current = false;
      return;
    }
    if (locked) return;

    if (showServerPanel || showQualityPanel || showAudioPanel || showCcPanel || showSettings) {
      setShowServerPanel(false);
      setShowQualityPanel(false);
      setShowAudioPanel(false);
      setShowCcPanel(false);
      setShowSettings(false);
      return;
    }

    const now = Date.now();
    const clientX = "touches" in e ? e.changedTouches[0].clientX : e.clientX;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;

    if (now - lastTap.current.time < 300) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      if (relX < 0.3) seek(-10);
      else if (relX > 0.7) seek(10);
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
      if (!showControls) {
        setShowControls(true);
        scheduleHideTimer();
        return;
      }
      singleTapTimerRef.current = setTimeout(() => {
        toggleControls();
        singleTapTimerRef.current = null;
      }, 120);
    }
  }, [locked, scheduleHideTimer, seek, showAudioPanel, showCcPanel, showControls, showQualityPanel, showServerPanel, showSettings, togglePlay, playing, toggleControls]);

  const clearSpeedHoldTimer = useCallback(() => {
    if (speedHoldTimerRef.current) {
      clearTimeout(speedHoldTimerRef.current);
      speedHoldTimerRef.current = null;
    }
  }, []);

  const startSpeedHold = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (locked || isPlayerInteractiveTarget(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    if (relX < 0.28 || relX > 0.72 || relY > 0.82) return;
    speedHoldPointerRef.current = e.pointerId;
    clearSpeedHoldTimer();
    speedHoldTimerRef.current = setTimeout(() => {
      previousSpeedRef.current = playbackRate || 1;
      speedHoldActiveRef.current = true;
      setSpeedHoldActive(true);
      applyPlaybackRateNow(2);
      setShowControls(false);
    }, 320);
  }, [applyPlaybackRateNow, clearSpeedHoldTimer, isPlayerInteractiveTarget, locked, playbackRate]);

  const endSpeedHold = useCallback((e?: React.PointerEvent<HTMLDivElement>) => {
    if (e && speedHoldPointerRef.current !== null && e.pointerId !== speedHoldPointerRef.current) return;
    speedHoldPointerRef.current = null;
    clearSpeedHoldTimer();
    if (!speedHoldActiveRef.current) return;
    speedHoldActiveRef.current = false;
    setSpeedHoldActive(false);
    applyPlaybackRateNow(previousSpeedRef.current || 1);
    suppressNextClickRef.current = true;
    window.setTimeout(() => { suppressNextClickRef.current = false; }, 260);
    resetHideTimer();
  }, [applyPlaybackRateNow, clearSpeedHoldTimer, resetHideTimer]);

  useEffect(() => () => {
    clearSpeedHoldTimer();
    if (speedHoldActiveRef.current) applyPlaybackRateNow(previousSpeedRef.current || 1);
  }, [applyPlaybackRateNow, clearSpeedHoldTimer]);


  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isPlayerInteractiveTarget(e.target)) return;
    const t = e.touches[0];
    fullscreenGestureFiredRef.current = false;
    setFullscreenSwipeY(0);
    setSwipeState({ startX: t.clientX, startY: t.clientY, type: null });
  }, [isPlayerInteractiveTarget]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isPlayerInteractiveTarget(e.target)) return;
    if (!swipeState || locked) return;
    const t = e.touches[0];
    const dy = t.clientY - swipeState.startY;
    const dx = t.clientX - swipeState.startX;
    // YouTube-style center swipe: stop page scrolling immediately, let the
    // player follow the finger a little, then enter/exit fullscreen at threshold.
    if ((!swipeState.type || swipeState.type === "fullscreen") && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const relX = (swipeState.startX - rect.left) / rect.width;
      if (relX >= 0.3 && relX <= 0.7) {
        e.preventDefault();
        e.stopPropagation();
        const previewY = dy < 0
          ? Math.max(-26, dy * 0.24)
          : Math.min(18, dy * 0.18);
        setFullscreenSwipeY(previewY);
        if (swipeState.type !== "fullscreen") setSwipeState({ ...swipeState, type: "fullscreen" });
        if (Math.abs(dy) > 54 && !fullscreenGestureFiredRef.current && dy < 0 && !isFullscreen) {
          fullscreenGestureFiredRef.current = true;
          setFullscreenSwipeY(-30);
          toggleFullscreen();
        } else if (Math.abs(dy) > 54 && !fullscreenGestureFiredRef.current && dy > 0 && isFullscreen) {
          fullscreenGestureFiredRef.current = true;
          setFullscreenSwipeY(18);
          toggleFullscreen();
        }
        return;
      }
    }
    if (!swipeState.type && Math.abs(dy) > 26 && Math.abs(dy) > Math.abs(dx) * 1.4) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const startRelX = (swipeState.startX - rect.left) / rect.width;
      const currRelX = (t.clientX - rect.left) / rect.width;
      // STRICT: brightness only on LEFT 30%, volume only on RIGHT 30%.
      // Middle 40% is a hard dead-zone — must be true for BOTH start and current
      // finger position so a stray middle swipe never triggers brightness.
      if (startRelX < 0.30 && currRelX < 0.35) {
        setSwipeState({ ...swipeState, type: "brightness" });
      } else if (startRelX > 0.70 && currRelX > 0.65) {
        setSwipeState({ ...swipeState, type: "volume" });
      } else {
        return;
      }
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
  }, [swipeState, locked, brightness, boostedVolume, muted, applyPlayerVolume, isPlayerInteractiveTarget, isFullscreen, toggleFullscreen]);


  const handleTouchEnd = useCallback((e?: React.TouchEvent) => {
    if (e && isPlayerInteractiveTarget(e.target)) return;
    setFullscreenSwipeY(0);
    window.setTimeout(() => { fullscreenGestureFiredRef.current = false; }, 220);
    setSwipeState(null);
  }, [isPlayerInteractiveTarget]);
  const stopPanelPointerPropagation = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
  }, []);

  const keepPanelScrollActive = useCallback((e: React.TouchEvent | React.UIEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  const stopPanelWheelPropagation = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  const panelBaseClass = "player-menu-panel rounded-xl p-2 z-[80] overflow-y-auto overscroll-contain touch-pan-y [scrollbar-width:thin]";
  const panelBaseStyle = { WebkitOverflowScrolling: "touch" as const, overscrollBehavior: "contain" as const, touchAction: "pan-y" as const };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const handlePlayerRemoteKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!document.documentElement.classList.contains("tv-mode")) return;
    const target = e.target as HTMLElement | null;
    if (target && target !== e.currentTarget && target.matches("button, a, input, select, textarea, [role='button'], [tabindex]")) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      togglePlay();
      resetHideTimer();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      seek(-10);
      resetHideTimer();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      seek(10);
      resetHideTimer();
      return;
    }
    if (e.key === "MediaPlayPause") {
      e.preventDefault();
      togglePlay();
      resetHideTimer();
      return;
    }
    if (e.key === "Escape" || e.key === "Backspace" || e.key === "BrowserBack") {
      e.preventDefault();
      handleBackPress();
    }
  }, [handleBackPress, resetHideTimer, seek, togglePlay]);

  // Android TV: the remote BACK key must always be able to leave fullscreen so the
  // episode / season / download / suggestion rows below the player come back,
  // even when focus currently sits on a control inside the player shell.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!document.documentElement.classList.contains("tv-mode")) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Backspace" && e.key !== "BrowserBack" && e.key !== "GoBack") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (isFullscreen) {
        e.preventDefault();
        e.stopPropagation();
        void toggleFullscreen();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [isFullscreen, toggleFullscreen]);

  // Crop scale tuned to fully eliminate the small black side-bars left by AN's
  // letterboxed iframe. Slightly higher than before in both windowed + fullscreen.
  const embedTransform = cropIndex === 1
    ? (isFullscreen ? "scale(1.16)" : "scale(1.08)")
    : cropIndex === 2
      ? (isFullscreen ? "scaleX(1.42) scaleY(1.14)" : "scaleX(1.28) scaleY(1.08)")
      : "scale(1)";

  return (
    <div data-player-fs={isFullscreen ? "on" : "off"} className={`rs-video-player-root fixed inset-0 z-[300] bg-background/[0.98] flex flex-col items-center ${isFullscreen ? '' : 'overflow-y-auto'}`} ref={containerRef}>
      {/* Back arrow lives inside the controls overlay below, so it hides/shows with controls */}


      <div className={`w-full ${isFullscreen ? 'h-full p-0' : 'max-w-full px-0 pb-6 pt-0'}`}>

        {/* Video Container - will-change for GPU compositing */}
        <div
          ref={videoContainerRef}
          tabIndex={0}
          role="region"
          aria-label="Video player"
          className={`rs-video-player-shell relative bg-black overflow-hidden ${
            isFullscreen 
              ? "w-screen h-screen rounded-none player-fs-enter" 
              : "w-full rounded-none aspect-video sticky top-0 z-40"
          }`}
          style={{
            margin: isFullscreen ? 0 : undefined,
            transform: fullscreenSwipeY ? `translate3d(0, ${fullscreenSwipeY}px, 0) scale(${fullscreenSwipeY < 0 ? 1.012 : 0.992})` : undefined,
            transition: fullscreenSwipeY ? "none" : "transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
            touchAction: "none",
            overscrollBehavior: "contain",
          }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={handlePlayerRemoteKey}
          onClick={handleVideoClick}
          onPointerDown={startSpeedHold}
          onPointerUp={endSpeedHold}
          onPointerCancel={endSpeedHold}
          onPointerLeave={endSpeedHold}
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
              style={{ transform: embedTransform, transformOrigin: "center center", filter: brightness === 1 ? undefined : `brightness(${brightness})` }}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="no-referrer"
              title="player"
            />
          ) : (
            <video
              ref={videoRef}
              src={(isHlsSrc && Hls.isSupported()) ? undefined : currentSrc}
              crossOrigin={undefined}
                className="w-full h-full bg-black pointer-events-none"
              style={{ objectFit: cropModes[cropIndex], WebkitTouchCallout: "none", userSelect: "none", filter: brightness === 1 ? undefined : `brightness(${brightness})` }}
              playsInline
              controls={false}
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

          {/* Video Error Banner — compact, non-blocking */}
          {videoError && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[5] pointer-events-none px-3 max-w-[92%]">
              <div className="player-glass rounded-full px-3 py-1.5 flex items-center gap-2 pointer-events-auto shadow-lg border border-destructive/40 bg-black/75 backdrop-blur">
                <div className="w-5 h-5 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
                  <X className="w-3 h-3 text-destructive" />
                </div>
                <p className="text-[11px] font-medium text-white/90 whitespace-nowrap">
                  Link expired <span className="text-white/50">or</span> check your internet connection
                </p>
                <button onClick={(e) => { e.stopPropagation(); failedSrcsRef.current.clear(); retryAttemptsRef.current.clear(); rsSoftRetriesRef.current = 0; setVideoError(false); setIsBuffering(true); const v = videoRef.current; if (v) { v.load(); v.play().catch(() => {}); } }} className="px-2 py-0.5 rounded-full gradient-primary text-[10px] font-semibold shrink-0">
                  Retry
                </button>
              </div>
            </div>
          )}


          {/* Loading spinner on top of thumbnail */}
          {showLoaderOverlay && (
            <div className="absolute inset-0 flex items-center justify-center z-[6] pointer-events-none">
              <div className="player-loader-shell" aria-hidden="true">
                {Array.from({ length: 12 }).map((_, i) => <span key={i} className="player-loader-petal" />)}
              </div>
            </div>
          )}

          {/* Removed the large title-based suggestion loader overlay. */}

          {skipIndicator && (
            skipIndicator.side === "center" ? (
              <div className="absolute top-1/2 left-1/2 skip-pill skip-pill--center" aria-hidden="true">
                <span className="text-lg leading-none font-bold">{skipIndicator.text}</span>
              </div>
            ) : (
              <div
                key={skipIndicator.side + skipIndicator.text}
                className={`skip-youtube ${skipIndicator.side === "left" ? "skip-youtube--left" : "skip-youtube--right"}`}
                aria-hidden="true"
              >
                <div className="skip-youtube__inner">
                  <div className="skip-youtube__arrows">{skipIndicator.side === "left" ? "‹‹" : "››"}</div>
                  <div className="skip-youtube__time">{skipIndicator.text}</div>
                </div>
              </div>
            )
          )}

          {speedHoldActive && (
            <div className="player-speed-hold-hud" aria-hidden="true">
              <FastForward className="w-4 h-4" />
              <span>2x</span>
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

          {(swipeState?.type === "volume" || swipeState?.type === "brightness") && (
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
              <button onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleBackPress(); }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} className="player-touch-button w-9 h-9 rounded-full flex items-center justify-center bg-black/70 backdrop-blur" aria-label="Back">
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
                className={`player-controls-layer absolute inset-0 z-[70] flex flex-col justify-between text-white transition-opacity duration-150 ease-out ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
              >
              {/* Top controls */}
              <div className="flex justify-between items-start gap-1 px-2.5 pt-2.5">
                <button onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleBackPress(); }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} className="player-touch-button h-[40px] w-[40px] rounded-full flex items-center justify-center transition-transform duration-150 active:scale-90" aria-label="Back">
                  <ArrowLeft className="w-[22px] h-[22px]" />
                </button>
                <div className="flex max-w-[calc(100%-46px)] items-center justify-end gap-1 overflow-x-auto scrollbar-hide pb-1">
                <button onClick={(e) => { e.stopPropagation(); setCropIndex((cropIndex + 1) % 3); }} className="player-touch-button h-[30px] px-2 rounded-full flex items-center justify-center gap-1 transition-transform duration-150 active:scale-95 shrink-0">
                  <Crop className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-semibold">{cropLabels[cropIndex]}</span>
                </button>
                {isHlsSrc ? (
                    <button className="player-touch-button h-[30px] px-2 rounded-full flex items-center justify-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Server className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-semibold">HLS</span>
                  </button>
                ) : effectiveVideoServers.length >= 1 && !noServerSwitch ? (
                  <div className="relative">
                    <button
                      onPointerDown={toggleServerPanelFast}
                      onClick={stopControlPress}
                      className={`player-touch-button h-[30px] px-2 rounded-full flex items-center justify-center gap-1 transition-transform duration-150 active:scale-95 shrink-0 ${manualServerSelected ? 'ring-1 ring-primary bg-primary/25' : ''}`}
                    >
                      <Server className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-semibold whitespace-nowrap max-w-[78px] truncate">{effectiveVideoServers[activeServerIndex]?.name || `Server ${activeServerIndex + 1}`}</span>
                    </button>
                  </div>
                ) : null}
                {(isHlsSrc || hlsSubtitleOptions.length > 0) && (hlsAudioOptions.length > 0 || hlsSubtitleOptions.length > 0) && (
                  <div className="relative">
                    <button
                      onPointerDown={toggleCcPanelFast}
                      onClick={stopControlPress}
                      className={`player-touch-button h-[30px] px-2 rounded-full flex items-center justify-center gap-1 transition-transform duration-150 active:scale-95 shrink-0 ${currentHlsSubtitle >= 0 ? "ring-1 ring-primary" : ""}`}
                    >
                      <Subtitles className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-semibold">CC</span>
                    </button>
                  </div>
                )}
                <button onClick={(e) => { e.stopPropagation(); setLocked(true); resetHideTimer(); }} className="player-touch-button w-[30px] h-[30px] rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95 shrink-0">
                  <Lock className="w-3.5 h-3.5" />
                </button>
                </div>
              </div>

              {/* Center play */}
              <div className="flex items-center justify-center gap-8">
                <button onClick={(e) => { e.stopPropagation(); seek(-10); }} className="player-touch-button w-[46px] h-[46px] rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                  <SkipBack className="w-6 h-6" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="player-touch-button player-touch-button--primary rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95" style={{ width: 58, height: 58 }}>
                  {playing ? <Pause className="w-8 h-8" fill="currentColor" /> : <Play className="w-8 h-8 ml-0.5" fill="currentColor" />}
                </button>
                <button onClick={(e) => { e.stopPropagation(); seek(10); }} className="player-touch-button w-[46px] h-[46px] rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95">
                  <SkipForward className="w-6 h-6" />
                </button>
              </div>

              {/* Bottom controls */}
              <div className="px-2 pb-2.5">
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
                <div className="flex items-center justify-between gap-1.5 min-w-0">
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      ref={timeDisplayRef}
                      className="text-[11px] font-bold whitespace-nowrap tabular-nums leading-none text-white"
                      style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85), 0 0 6px rgba(0,0,0,0.55)" }}
                    >{formatTime(currentTime)} / {formatTime(duration)}</span>
                    <button onClick={(e) => {
                      e.stopPropagation();
                      applyPlayerVolume(boostedVolume, !muted);
                    }} className="w-6 h-6 flex items-center justify-center shrink-0 rounded-full ring-1 ring-white/25 bg-white/10 active:scale-90 transition-transform" aria-label="Toggle mute">
                      {muted || boostedVolume <= 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-end gap-1 flex-nowrap min-w-0 flex-1 overflow-x-auto scrollbar-hide pl-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const rates = [1, 1.25, 1.5, 1.75, 2, 0.75];
                        const idx = rates.indexOf(playbackRate);
                        const next = rates[(idx + 1) % rates.length] ?? 1;
                        setSpeed(next);
                      }}
                      className={`h-7 px-1.5 text-[10px] rounded-md shrink-0 leading-none font-semibold transition-all inline-flex items-center justify-center min-w-[28px] ${playbackRate !== 1 ? "gradient-primary text-white" : "player-control-chip"}`}
                      aria-label="Playback speed"
                    >{playbackRate}x</button>
                    {availableQualities.length > 1 && (
                      <button
                        onPointerDown={toggleQualityPanelFast}
                        onClick={stopControlPress}
                        className={`h-7 px-2 text-[11px] rounded-md font-semibold transition-all shrink-0 inline-flex items-center justify-center max-w-[54px] ${
                          currentQuality !== "Auto" ? "gradient-primary text-white" : "player-control-chip"
                        }`}
                      >
                        <span className="truncate">{currentQuality}</span>
                      </button>
                    )}
                    {/* Bottom CC button removed — single CC lives in the top server row */}
                    {audioTrackOptions.length > 1 && (
                      <button
                        onPointerDown={toggleAudioPanelFast}
                        onClick={stopControlPress}
                        className={`h-7 px-1.5 text-[10px] rounded-md font-semibold transition-all inline-flex items-center gap-0.5 max-w-[62px] shrink-0 ${
                          activePlaybackLanguage ? "gradient-primary text-white" : "player-control-chip"
                        }`}
                        aria-label="Audio track"
                      >
                        <span className="truncate">🎧 {activePlaybackLanguage || "Audio"}</span>
                      </button>
                    )}
                    {onNextEpisode && (
                      <button onClick={(e) => { e.stopPropagation(); onNextEpisode(); }} className="player-control-chip h-7 px-1.5 text-[10px] rounded-md inline-flex items-center justify-center gap-0.5 transition-transform duration-150 active:scale-95 shrink-0 font-semibold">
                        Next <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                    <button onPointerDown={toggleSettingsPanelFast} onClick={stopControlPress} className="player-touch-button w-6 h-6 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95 shrink-0">
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="player-touch-button w-6 h-6 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95 shrink-0">
                      {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!isEmbedPlayback && showServerPanel && effectiveVideoServers.length >= 1 && !noServerSwitch && (
            <div data-player-panel="true" className={`absolute top-14 right-3 ${panelBaseClass} min-w-[152px] max-w-[86vw] max-h-[min(70dvh,320px)]`} style={panelBaseStyle} onClick={stopPanelPointerPropagation} onTouchStart={keepPanelScrollActive} onTouchMove={keepPanelScrollActive} onTouchEnd={stopPanelPointerPropagation} onScroll={keepPanelScrollActive} onWheel={stopPanelWheelPropagation}>
              <p className="text-[9px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Server</p>
              {effectiveVideoServers.map((srv, idx) => {
                const isLocked = srv.locked && !isPremium;
                const isActive = activeServerIndex === idx;
                return (
                  <button
                    key={`${srv.name || "server"}-${idx}`}
                    onClick={() => { if (!isLocked) switchServer(idx); }}
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

          {!isEmbedPlayback && showCcPanel && (isHlsSrc || hlsSubtitleOptions.length > 0) && (hlsAudioOptions.length > 0 || hlsSubtitleOptions.length > 0) && (
            <div
              data-player-panel="true"
              className={`absolute bottom-16 right-3 ${panelBaseClass} w-[230px] max-w-[88vw] max-h-[min(72dvh,360px)] z-[95]`}
              style={panelBaseStyle}
              onClick={stopPanelPointerPropagation}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onTouchStart={keepPanelScrollActive}
              onTouchMove={keepPanelScrollActive}
              onTouchEnd={stopPanelPointerPropagation}
              onScroll={keepPanelScrollActive}
              onWheel={stopPanelWheelPropagation}
            >
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
                      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground"><span>Caption size</span><span>{captionFontScale.toFixed(1)}x</span></div>
                      <input type="range" min={0.8} max={1.8} step={0.1} value={captionFontScale} onChange={(e) => setCaptionFontScale(Number(e.target.value))} className="w-full accent-primary" />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground"><span>Caption position</span><span>{captionVerticalOffset}%</span></div>
                      <input type="range" min={4} max={28} step={1} value={captionVerticalOffset} onChange={(e) => setCaptionVerticalOffset(Number(e.target.value))} className="w-full accent-primary" />
                    </div>
                  </div>
                  {!!subtitleStatusMessage && (
                    <div className={`mt-1 rounded-lg px-2 py-1.5 text-[10px] leading-relaxed ${subtitleStatusTone === "warning" ? "bg-destructive/15 text-destructive" : subtitleStatusTone === "success" ? "bg-primary/15 text-primary" : "bg-foreground/10 text-muted-foreground"}`}>{subtitleStatusMessage}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {!isEmbedPlayback && showQualityPanel && availableQualities.length > 1 && (
            <div data-player-panel="true" className={`absolute bottom-16 right-12 ${panelBaseClass} min-w-[132px] max-w-[82vw] max-h-[min(70dvh,320px)]`} style={panelBaseStyle} onClick={stopPanelPointerPropagation} onTouchStart={keepPanelScrollActive} onTouchMove={keepPanelScrollActive} onTouchEnd={stopPanelPointerPropagation} onScroll={keepPanelScrollActive} onWheel={stopPanelWheelPropagation}>
              <p className="text-[10px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Quality</p>
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

          {!isEmbedPlayback && showAudioPanel && audioTrackOptions.length > 1 && (
            <div data-player-panel="true" className={`absolute bottom-16 right-3 ${panelBaseClass} w-[190px] max-w-[82vw] max-h-[min(70dvh,320px)]`} style={panelBaseStyle} onClick={stopPanelPointerPropagation} onTouchStart={keepPanelScrollActive} onTouchMove={keepPanelScrollActive} onTouchEnd={stopPanelPointerPropagation} onScroll={keepPanelScrollActive} onWheel={stopPanelWheelPropagation}>
              <p className="text-[10px] text-muted-foreground mb-1.5 px-2 uppercase tracking-wider font-medium">Audio Track</p>
              {audioTrackOptions.map((track, idx) => {
                const label = track.label || track.language || `Track ${idx + 1}`;
                const isActive = activePlaybackLanguage === label;
                return (
                  <button key={`${track.language}-${idx}`} onClick={() => selectAudioTrack(track)}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-[12px] transition-all flex items-center justify-between gap-1 ${
                      isActive ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                    }`}>
                    <span className="truncate flex-1 min-w-0">{label}</span>
                    {isActive && <Check className="w-3 h-3 shrink-0" />}
                  </button>
                );
              })}
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
                {audioTrackOptions.length > 1 && (
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
                  {audioTrackOptions.map((track, idx) => {
                    const label = track.label || track.language || `Track ${idx + 1}`;
                    const isActive = activePlaybackLanguage === label;
                    const qualityCount = [track.src480, track.src720, track.src1080, track.src4k].filter(Boolean).length;
                    return (
                    <button key={idx} onClick={() => switchAudioTrack(track)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between ${
                        isActive ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
                      }`}>
                      <span className="flex items-center gap-1.5">
                        🎧 {label}
                        {qualityCount > 0 && <span className="text-[9px] opacity-60 ml-1">({qualityCount + 1} qualities)</span>}
                      </span>
                      {isActive && <Check className="w-3.5 h-3.5" />}
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
                {(anime?.rating || animeMeta?.rating) ? (
                  <>
                    <span className="text-foreground/25 flex-shrink-0">|</span>
                    <span className="flex items-center gap-0.5 flex-shrink-0"><Star className="w-3 h-3 text-primary fill-primary flex-shrink-0" />{anime?.rating || animeMeta?.rating}</span>
                  </>
                ) : null}
                {currentLangLabel ? <><span className="text-foreground/25 flex-shrink-0">|</span><span className="truncate">{currentLangLabel}</span></> : null}
                <span className="text-foreground/25 flex-shrink-0">|</span>
                <span className="truncate capitalize">{((seasons && seasons.length > 0) || anime?.type === "webseries") ? "Webseries" : "Movie"}</span>
                {seasons && seasons.length > 0 ? <><span className="text-foreground/25 flex-shrink-0">|</span><span className="truncate">{activeSeasonLabel}</span></> : null}
              </div>
            </button>

            {animeId && <VideoReactionsBar animeId={animeId} className="mt-3" />}



            <div className={`grid ${isAnimeSaltContent ? 'grid-cols-3' : 'grid-cols-4'} gap-1.5 mt-3`}>
              <button onClick={() => { closeInlineSheets(); handleToggleWatchlist(); }} className={`flex items-center justify-center gap-1 py-2 px-1 rounded-full text-[10px] font-medium transition-colors border ${saved ? 'bg-primary/15 text-primary border-primary/30' : 'bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border-border'}`}>
                <Bookmark className={`w-3 h-3 flex-shrink-0 ${saved ? 'fill-primary' : ''}`} />
                <span className="whitespace-nowrap truncate">{saved ? 'Saved' : 'Add'}</span>
              </button>
              <button onClick={() => { void handleShare(currentSeasonIdx ?? 0, activeEpisodeIdx); }} className="flex items-center justify-center gap-1 py-2 px-1 rounded-full text-[10px] font-medium border transition-colors bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border-border">
                <Share2 className="w-3 h-3 flex-shrink-0" />
                <span>Share</span>
              </button>
              {!isAnimeSaltContent && (
                <button onClick={() => { openDownloadWithAd(); }} className={`flex items-center justify-center gap-1 py-2 px-1 rounded-full text-[10px] font-medium border active:scale-95 transition-all disabled:opacity-60 ${showDownloadQualityPicker ? 'bg-primary/15 text-primary border-primary/30' : 'bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/10 border-border'}`}>
                  <Download className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">Download</span>
                </button>

              )}
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
              ) : adGateError ? (
                <div className="space-y-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3">
                  <p className="text-sm text-red-200">{adGateError}</p>
                  <button
                    onClick={() => loadAdGateLinks()}
                    className="w-full py-2.5 rounded-xl bg-red-500 text-white font-semibold flex items-center justify-center gap-2 transition-all hover:scale-105 text-sm"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry ad link
                  </button>
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
                <p className="text-[12px] leading-5 text-white/70">{infoStoryline}</p>
                {!!infoDirectors.length && (
                  <p className="text-[11px] leading-5 text-white/55">
                    <span className="text-white/75 font-semibold">Director:</span> {infoDirectors.join(", ")}
                  </p>
                )}
              </div>

              {!!infoCast.length && (
                <div className="space-y-2">
                  <h5 className="text-[13px] font-semibold">Voice/Cast Artists ({infoCast.length})</h5>
                  <div className="grid grid-cols-4 gap-2.5">
                    {infoCast.map((person, index) => (
                      <div key={`${person.name}-${index}`} className="min-w-0">
                        <div className="aspect-[3/4] overflow-hidden rounded-[8px] bg-white/[0.06]">
                          {person.photo ? <img src={optimizedImageUrl(person.photo, "avatar")} alt={person.name} className="w-full h-full object-cover" loading="lazy" decoding="async" /> : <div className="w-full h-full flex items-center justify-center text-[9px] text-white/35">No photo</div>}
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
                        selectAudioTrack({ language: track.language, label: track.label, src: track.link, src480: track.link480, src720: track.link720, src1080: track.link1080, src4k: track.link4k });
                      } else if (seasons?.length && onLanguageChange) {
                        onLanguageChange(label);
                      } else if (track) selectAudioTrack({ language: track.language, label: track.label, src: track.link, src480: track.link480, src720: track.link720, src1080: track.link1080, src4k: track.link4k });
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

        
        {/* Download Button (single) + Multi-Episode Picker + Offline Playback */}
        {!isFullscreen && !adGateActive && !hideDownload && !isEmbedPlayback && (() => {
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
              // Download must follow the currently selected server only. Do
              // not silently mix in every other admin server; if the user chose
              // HTTP, that HTTP domain is used, and HTTPS choices stay direct.
              push(applyServerDomain(rawUrl, activeServerIndex));
            } else {
              push(rawUrl);
            }
            return ordered;
          };
          const buildDownloadFileName = (label: string, quality?: string) => {
            const parts = [sanitizeAnimeDownloadTitle(label), quality && quality !== "Auto" ? quality : ""]
              .map((part) => String(part || "").trim())
              .filter(Boolean);
            return `${parts.join(" - ") || "video"}.mp4`;
          };
          const getDownloadUrl = (u: string, quality: string, sub?: string, fallbackUrls: string[] = []): string => {
            const candidates = [...deriveServerDownloadCandidates(u), ...fallbackUrls]
              .filter(Boolean)
              .filter((candidate) => !String(candidate).includes("/functions/v1/video-proxy?"));

            const managedAlready = [u, ...candidates].find((candidate) => String(candidate).includes("/functions/v1/video-download"));
            if (managedAlready) {
              const unwrapped = unwrapManagedVideoUrl(managedAlready);
              if (unwrapped && isDirectDownloadCandidate(unwrapped)) {
                return buildVideoDownloadUrl(unwrapped, buildDownloadFileName(String(sub || title), quality)) || unwrapped;
              }
            }

            const directCandidates = [u, ...candidates]
              .map((candidate) => String(candidate).includes("/functions/v1/video-") ? unwrapManagedVideoUrl(candidate) : candidate)
              .filter((candidate) => isDirectDownloadCandidate(candidate));
            const directCandidate = directCandidates[0] || "";
            if (!directCandidate) return "";

            return buildVideoDownloadUrl(
              directCandidate,
              buildDownloadFileName(String(sub || title), quality),
              directCandidates.slice(1),
            ) || "";
          };

          const pickEpUrlForQuality = (ep: DownloadEpisodeOption, quality: string): string => {
            return ep.qualityLinks[quality] || "";
          };

          const hasMultiEpisodes = !!(seasons && seasons.length > 0 && seasons.some((s) => (s.episodes?.length || 0) > 0));
          const panelSeason = seasons && seasons[downloadPanelSeasonIdx] ? seasons[downloadPanelSeasonIdx] : null;
          const panelEpisodes = downloadEpisodes;

          const toggleEpisode = (idx: number) => {
            if (activeQuality && !isDownloadAllowedForFree(activeQuality, idx)) {
              toast.error("Free users can download this quality only for Episode 1–2 when 480P is missing.");
              return;
            }
            setDlSelectedEpisodes((prev) => {
              const next = new Set(prev);
              if (next.has(idx)) next.delete(idx); else next.add(idx);
              return next;
            });
          };

          const toggleAll = () => {
            setDlSelectedEpisodes((prev) => {
              const allowedEpisodes = panelEpisodes.filter((episode) => !activeQuality || isDownloadAllowedForFree(activeQuality, episode.index));
              if (allowedEpisodes.length === 0) return new Set();
              if (allowedEpisodes.every((episode) => prev.has(episode.index))) return new Set();
              return new Set(allowedEpisodes.map((episode) => episode.index));
            });
          };

          const closePanel = () => {
            closeInlineSheets();
            setDlSelectedEpisodes(new Set());
          };

          const startMovieDownload = async (quality: string) => {
            if (!isDownloadAllowedForFree(quality)) {
              toast.error("Free downloads are limited to 480P. Buy premium for higher quality.");
              return;
            }
            const movieLabel = String(title || subtitle || "video").trim();
            // Movies follow the exact same flow as episodes: pick the selected
            // quality first, then any other stored movie link, then the current
            // playback source as the last resort.
            const linkPool = [
              movieQualityLinks[quality],
              ...Object.values(movieQualityLinks),
              anime?.movieLink,
              src,
            ].map((v) => String(v || "").trim()).filter(Boolean);
            const rawMovieUrl = linkPool[0] || "";
            if (!rawMovieUrl) { toast.error("Download not available"); return; }
            const directMovieUrl = unwrapManagedVideoUrl(rawMovieUrl) || rawMovieUrl;
            if (!isDirectDownloadCandidate(directMovieUrl)) { toast.error("This movie has no downloadable file"); return; }
            const directFallbacks = linkPool.slice(1)
              .map((candidate) => unwrapManagedVideoUrl(candidate) || candidate)
              .filter((candidate) => isDirectDownloadCandidate(candidate));
            const started = triggerBackgroundVideoDownload(directMovieUrl, buildDownloadFileName(movieLabel, quality), directFallbacks);
            if (started) toast.success("Download sent to browser");
            else toast.error("Could not start the download");
            closePanel();
          };


          const startSelectedDownloads = async (quality: string) => {
            if (!panelSeason || dlSelectedEpisodes.size === 0) {
              toast.error("Select at least one episode");
              return;
            }
            const orderedIdxs = Array.from(dlSelectedEpisodes).sort((a, b) => a - b);
            const browserBatch: Array<{ url: string; fileName: string }> = [];
            for (const idx of orderedIdxs) {
              const ep = panelEpisodes.find((episode) => episode.index === idx);
              if (!ep) continue;
              if (!isDownloadAllowedForFree(quality, ep.index)) continue;
              const seasonLabel = getShortSeasonLabel(panelSeason?.name, downloadPanelSeasonIdx);
              const episodeLabel = buildEpisodeDownloadName(title, seasonLabel, ep.episodeNumber);
              const epUrl = getDownloadUrl(
                pickEpUrlForQuality(ep, quality),
                quality,
                episodeLabel,
                Object.values(ep.qualityLinks),
              );
              if (!epUrl) continue;
              if (isHlsLikeUrl(epUrl)) continue;
              browserBatch.push({
                url: epUrl,
                fileName: buildDownloadFileName(episodeLabel, quality),
              });
            }
            const startedCount = triggerBulkBackgroundDownloads(browserBatch);
            closePanel();
            if (startedCount === 0) toast.error("No free downloadable links found for this selection");
            else toast.success(`Sent ${startedCount} download${startedCount > 1 ? "s" : ""} to browser`);
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

          // Always render the standard quality slots so a missing file reads as
          // "Not available" instead of silently disappearing. "Default" is kept
          // first when present (AN HLS master carries every quality).
          const STANDARD_QUALITIES = ["480P", "720P", "1080P", "4K"];
          const explicitChoices = availableDownloadQualities.filter((q) => q !== "Default");
          const extraChoices = explicitChoices.filter((q) => !STANDARD_QUALITIES.includes(q));
          const qualityChoices = Array.from(new Set([
            ...(availableDownloadQualities.includes("Default") ? ["Default"] : []),
            ...STANDARD_QUALITIES,
            ...extraChoices,
          ]));
          const isQualityAvailable = (label: string) => availableDownloadQualities.includes(label);
          const firstAvailableQuality = qualityChoices.find(isQualityAvailable) || "";
          const activeQuality = selectedDownloadQuality && isQualityAvailable(selectedDownloadQuality)
            ? selectedDownloadQuality
            : firstAvailableQuality;


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
                            const available = isQualityAvailable(label);
                            const is4K = is4KLabel(label);
                            const locked4K = is4K && !isPremium;
                            const lockedByFreeRule = !isPremium && normalizeDownloadQualityKey(label) !== "480p" && selectedSeasonHas480p;
                            const lockedQuality = available && (locked4K || lockedByFreeRule);
                            const isActive = available && label === activeQuality;
                            return (
                              <button
                                key={label}
                                disabled={!available || lockedQuality}
                                onClick={() => {
                                  if (!available || lockedQuality) return;
                                  setSelectedDownloadQuality(label);
                                  setDlSelectedEpisodes(new Set());
                                }}
                                className={`h-9 rounded-[8px] text-[11px] font-semibold border transition-all ${!available ? 'bg-white/[0.02] text-white/20 border-white/5 line-through' : lockedQuality ? 'bg-white/[0.03] text-white/25 opacity-50 border-white/5' : isActive ? 'bg-gradient-to-r from-cyan-500 to-emerald-400 text-black border-emerald-300 shadow-[0_4px_14px_-2px_rgba(16,185,129,0.55)]' : 'bg-white/[0.07] text-white border-white/10'}`}
                                title={available ? label : `${label} not available`}
                              >
                                <span className="inline-flex items-center justify-center gap-1">{available && lockedQuality && <Lock className="w-3 h-3" />}{label}</span>
                              </button>
                            );
                          })}
                        </div>

                        {!isPremium && (
                          <p className="mt-2 text-[10px] leading-snug text-white/45">
                            Free: all 480P episodes. If 480P is missing, only Episode 1–2 can be downloaded in higher quality.
                          </p>
                        )}
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
                              const lockedByRule = !!qualityUrl && activeQuality ? !isDownloadAllowedForFree(activeQuality, ep.index) : false;
                              const sizeBytes = getCachedDownloadSize(qualityUrl);
                              const sizeLabel = fmtSize(sizeBytes);
                              return (
                                <button key={`${downloadPanelSeasonIdx}-${ep.index}`} disabled={!qualityUrl || lockedByRule} onClick={() => toggleEpisode(ep.index)} className={`w-full flex items-start gap-2.5 text-left ${lockedByRule ? 'opacity-55' : ''}`}>
                                  <span className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border-2 ${lockedByRule ? 'border-amber-400/50 text-amber-300' : selected ? 'border-primary bg-primary text-primary-foreground' : 'border-white/35 text-transparent'}`}>
                                    {lockedByRule ? <Lock className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-[13px] font-medium text-white">S{String(downloadPanelSeasonIdx + 1).padStart(2, '0')} E{String(ep.episodeNumber).padStart(2, '0')}</span>
                                    <span className="block text-[11px] text-white/55 mt-0.5 truncate">{lockedByRule ? `${ep.metaText} • Premium required` : qualityUrl ? ep.metaText : `${ep.metaText} • No ${activeQuality || 'selected'} file`}</span>
                                  </span>
                                  <span className="shrink-0 self-center text-right text-[11px] font-semibold tabular-nums text-emerald-300/90 min-w-[54px]">
                                    {lockedByRule ? <span className="text-amber-300/80 font-semibold">LOCK</span> : qualityUrl ? (sizeLabel ? sizeLabel : hasProbedDownloadSize(qualityUrl) ? <span className="text-white/40 font-normal">N/A</span> : <span className="text-white/45 font-normal">…</span>) : <span className="text-white/30 font-normal">Not available</span>}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {!hasMultiEpisodes && (() => {
                      const fmtSize = (bytes: number) => {
                        if (!bytes || bytes <= 0) return "";
                        const mb = bytes / (1024 * 1024);
                        if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
                        return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
                      };
                      return (
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                          <div className="rounded-[10px] border border-white/10 bg-white/[0.04] p-2">
                            <h4 className="text-[11px] font-bold text-white/80 uppercase tracking-wider px-1 pb-1.5">Movie file</h4>
                            <div className="space-y-1">
                              {qualityChoices.map((label) => {
                                const url = String(movieQualityLinks[label] || "").trim();
                                const available = !!url;
                                const locked = available && !isDownloadAllowedForFree(label);
                                const sizeBytes = available ? getCachedDownloadSize(url) : 0;
                                const sizeLabel = fmtSize(sizeBytes);
                                const isActive = available && label === activeQuality;
                                return (
                                  <button
                                    key={`movie-${label}`}
                                    disabled={!available || locked}
                                    onClick={() => { if (available && !locked) setSelectedDownloadQuality(label); }}
                                    className={`w-full flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left border ${isActive ? 'border-emerald-400/60 bg-emerald-400/10' : 'border-white/8 bg-white/[0.03]'} ${!available ? 'opacity-45' : locked ? 'opacity-60' : ''}`}
                                  >
                                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${locked ? 'border-amber-400/50 text-amber-300' : isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-white/35 text-transparent'}`}>
                                      {locked ? <Lock className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-[13px] font-medium text-white">{label === "Default" ? "Full Movie" : label}</span>
                                      <span className="block text-[11px] text-white/50 mt-0.5 truncate">
                                        {available ? (locked ? "Premium required" : "Ready to download") : "This quality is not available"}
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-right text-[11px] font-semibold tabular-nums text-emerald-300/90">
                                      {!available ? <span className="text-white/30 font-normal">—</span>
                                        : locked ? <span className="text-amber-300/80">LOCK</span>
                                        : sizeLabel ? sizeLabel
                                        : hasProbedDownloadSize(url) ? <span className="text-white/40 font-normal">N/A</span>
                                        : <span className="text-white/45 font-normal">…</span>}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  )}



                  {(() => {
                    const fmtSize = (bytes: number) => {
                      if (!bytes || bytes <= 0) return "";
                      const mb = bytes / (1024 * 1024);
                      if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
                      return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
                    };
                    const selectedList = hasMultiEpisodes
                      ? panelEpisodes.filter((ep) => dlSelectedEpisodes.has(ep.index) && (!activeQuality || isDownloadAllowedForFree(activeQuality, ep.index)))
                      : [];
                    const totalBytes = selectedList.reduce((sum, ep) => {
                      const u = activeQuality ? pickEpUrlForQuality(ep, activeQuality) : "";
                      return sum + getCachedDownloadSize(u);
                    }, 0);
                    const movieBytes = !hasMultiEpisodes && activeQuality ? getCachedDownloadSize(movieQualityLinks[activeQuality] || "") : 0;
                    const totalLabel = hasMultiEpisodes
                      ? (selectedList.length > 0 ? fmtSize(totalBytes) : "")
                      : fmtSize(movieBytes);

                    const allowedForActive = panelEpisodes.filter((ep) => !activeQuality || isDownloadAllowedForFree(activeQuality, ep.index));
                    const allAllowedSelected = allowedForActive.length > 0 && allowedForActive.every((ep) => dlSelectedEpisodes.has(ep.index));
                    return (
                      <div className="p-3 border-t border-white/10 bg-black">
                        <div className="flex items-center gap-2.5">
                          <button onClick={toggleAll} className={`flex items-center gap-1.5 text-[11px] ${allAllowedSelected ? 'text-white' : 'text-white/55'}`}>
                            <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${allAllowedSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-white/35 text-transparent'}`}><Check className="w-3 h-3" /></span>
                            <span>All</span>
                          </button>
                          <button
                            onClick={() => {
                              const preferred = activeQuality || preferredDownloadQuality || qualityChoices[0];
                              if (!preferred) return;
                              fireAdOnly("download-start", isPremium);
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
