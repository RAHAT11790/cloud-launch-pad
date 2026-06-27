import { useState, useMemo, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import type { Episode, Season, SubtitleTrack } from "@/data/animeData";
import logoImg from "@/assets/logo.png";
import SplashLoader from "@/components/SplashLoader";
import { Lock, ExternalLink, Loader2 } from "lucide-react";
import { TELEGRAM_CHANNEL_URL } from "@/lib/siteConfig";
import type { AnNativeResolvedData } from "@/components/AnNativeView";

const buildEpisodeDeepLink = (animeId: string, seasonIdx?: number, epIdx?: number) => {
  const params = new URLSearchParams();
  if (seasonIdx !== undefined) params.set("s", String(seasonIdx));
  if (epIdx !== undefined) params.set("e", String(epIdx));
  const qs = params.toString();
  return `${window.location.origin}/watch/${encodeURIComponent(animeId)}${qs ? `?${qs}` : ""}`;
};

const isInvalidPlaybackUrl = (url?: string | null) => {
  const normalized = String(url || "").trim().toLowerCase().split("?")[0].split("#")[0];
  if (!normalized) return true;
  return /\.(avif|gif|jpe?g|png|svg|webp|bmp)$/i.test(normalized);
};

const isDirectMediaPlaybackUrl = (url?: string | null) => {
  const normalized = String(url || "").trim().toLowerCase();
  // AnimeSalt native playback builds a synthetic HLS master as a data: URL.
  // This is still direct media for hls.js; treating it as non-media forces the
  // broken iframe path and makes AN appear fully blocked.
  if (normalized.startsWith("data:application/vnd.apple.mpegurl")) return true;
  return /\.(m3u8|mp4|webm|ogg|mov|mkv)(?:[?#].*)?$/.test(normalized);
};

const buildAnHlsPlaybackUrl = (url: string) => {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  // AN playback must be direct HTTPS/HLS only — no proxy wrapper.
  const proxyMatch = raw.match(/\/an-api\/hls\?url=([^&]+)/i);
  if (proxyMatch) {
    try { return decodeURIComponent(proxyMatch[1]); } catch { return raw; }
  }
  return raw;
};

const buildAnAudioHlsPlaybackUrl = (url: string) => {
  return buildAnHlsPlaybackUrl(url);
};

// Prefer Hindi as the default audio track for AnimeSalt content.
// Falls back to the first track when no Hindi variant exists.
const pickAnDefaultAudioIdx = (audio: Array<{ language?: string; name?: string; uri?: string }>) => {
  const idx = audio.findIndex((t) => {
    const blob = `${t?.language || ""} ${t?.name || ""}`.toLowerCase();
    return /hindi|हिन्दी|हिंदी|\bhin\b/.test(blob);
  });
  return idx >= 0 ? idx : 0;
};

const pickAnPreferredQualityIdx = (streams: Array<{ height?: number }>) => {
  const preferred = streams.findIndex((x) => Number(x?.height) === 1080);
  const fallback = streams.findIndex((x) => Number(x?.height) >= 720);
  return preferred >= 0 ? preferred : (fallback >= 0 ? fallback : 0);
};

const buildAnSyntheticMaster = (
  stream: { url: string; bandwidth?: number; resolution?: string; height?: number },
  audio: Array<{ language?: string; name?: string; uri?: string }>,
  defaultAudioIdx?: number,
) => {
  const resolvedDefault = typeof defaultAudioIdx === "number" ? defaultAudioIdx : pickAnDefaultAudioIdx(audio);
  if (!audio.length || String(stream?.url || "").trim().startsWith("data:application/vnd.apple.mpegurl")) {
    return buildAnHlsPlaybackUrl(stream.url);
  }
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6"];
  audio.forEach((track, index) => {
    const rawName = String(track?.name || track?.language || `Audio ${index + 1}`).replace(/"/g, "").trim();
    const rawLanguage = String(track?.language || rawName || `aud${index + 1}`).trim().toLowerCase();
    const uri = String(track?.uri || "").trim();
    if (!uri) return;
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="${rawName}",LANGUAGE="${rawLanguage || `aud${index + 1}`}",DEFAULT=${index === resolvedDefault ? "YES" : "NO"},AUTOSELECT=YES,URI="${buildAnAudioHlsPlaybackUrl(uri)}"`,
    );
  });
  const audioRef = audio.some((track) => String(track?.uri || "").trim()) ? ',AUDIO="aud"' : "";
  lines.push(
    `#EXT-X-STREAM-INF:BANDWIDTH=${stream.bandwidth || Math.max((stream.height || 720) * 5000, 2560000)},RESOLUTION=${stream.resolution || `${Math.round(((stream.height || 720) * 16) / 9)}x${stream.height || 720}`}${audioRef}`,
  );
  lines.push(buildAnHlsPlaybackUrl(stream.url));
  return `data:application/vnd.apple.mpegurl;base64,${btoa(unescape(encodeURIComponent(lines.join("\n"))))}`;
};

const normalizeAnAudioTracks = (
  audio: Array<{ language?: string; name?: string; uri?: string }> | undefined,
  streams: Array<{ label?: string; url?: string; height?: number }> | undefined,
) => {
  if (!Array.isArray(audio) || audio.length === 0) return undefined;

  const qualityMap = new Map<string, string>();
  (streams || []).forEach((stream) => {
    const label = String(stream?.label || "").trim().toLowerCase();
    const url = String(stream?.url || "").trim();
    if (!label || !url) return;
    qualityMap.set(label, url);
  });

  const seen = new Set<string>();
  return audio
    .map((track, trackIndex) => {
      const pickStreamUrl = (qualityLabel: string) => {
        const direct = qualityMap.get(qualityLabel);
        if (!direct) return undefined;
        return buildAnSyntheticMaster({
          url: direct,
          height: Number(qualityLabel.replace(/\D/g, "")) || undefined,
        }, audio, trackIndex);
      };
      const rawLabel = String(track?.name || track?.language || "Audio").trim();
      const rawLang = String(track?.language || rawLabel).trim();
      const normalized = normalizeLanguageName(rawLang) || normalizeLanguageName(rawLabel) || rawLabel;
      const key = normalized.toLowerCase();
      if (seen.has(key)) return null;
      const uri = String(track?.uri || "").trim();
      if (!uri) return null;
      seen.add(key);
      const defaultStreamUrl = String(
        streams?.find((stream: any) => Number(stream?.height) === 1080)?.url ||
        streams?.find((stream: any) => Number(stream?.height) >= 720)?.url ||
        streams?.[0]?.url ||
        "",
      ).trim() || uri;
      return {
        language: normalized,
        label: normalized,
        link: buildAnSyntheticMaster({ url: defaultStreamUrl }, audio, trackIndex),
        link480: pickStreamUrl("480p"),
        link720: pickStreamUrl("720p"),
        link1080: pickStreamUrl("1080p"),
        link4k: pickStreamUrl("4k") || pickStreamUrl("2160p"),
      };
    })
    .filter(Boolean) as { language: string; label: string; link: string; link480?: string; link720?: string; link1080?: string; link4k?: string }[];
};

const buildAnimeSaltDirectPlaybackState = async (payload: any) => {
  const resolvedPayload = payload?.data && !Array.isArray(payload?.sources) ? payload.data : payload;
  const sourceList = Array.isArray(resolvedPayload?.sources) ? resolvedPayload.sources : [];
  const primarySource = sourceList.find((entry: any) => Array.isArray(entry?.streams) && entry.streams.length > 0) || sourceList[0];
  const linkStreams = Array.isArray(resolvedPayload?.links)
    ? resolvedPayload.links.map((entry: any, index: number) => ({
        url: String(entry?.url || entry?.src || "").trim(),
        label: String(entry?.label || entry?.quality || entry?.resolution || (index === 0 ? "Auto" : `Source ${index + 1}`)).trim(),
        height: Number(entry?.height || String(entry?.label || entry?.quality || "").match(/\d{3,4}/)?.[0] || 0) || undefined,
        bandwidth: Number(entry?.bandwidth || 0) || undefined,
        resolution: entry?.resolution,
      }))
    : [];
  const directUrl = String(resolvedPayload?.directUrl || resolvedPayload?.master || resolvedPayload?.videoSource || resolvedPayload?.securedLink || resolvedPayload?.streamUrl || resolvedPayload?.videoUrl || resolvedPayload?.file || "").trim();
  const streams = (
    Array.isArray(primarySource?.streams) && primarySource.streams.length
      ? primarySource.streams
      : (linkStreams.length ? linkStreams : (directUrl ? [{ url: directUrl, label: "Auto" }] : []))
  ).filter((entry: any) => String(entry?.url || "").trim());
  const storedAudio = Array.isArray(resolvedPayload?.audioTracks)
    ? resolvedPayload.audioTracks
        .map((track: any) => ({
          language: track?.language || track?.label || track?.name,
          name: track?.label || track?.name || track?.language,
          uri: track?.rawAudioUrl || track?.audioUrl || track?.uri || track?.url,
        }))
        .filter((entry: any) => String(entry?.uri || "").trim())
    : [];
  const audio = (
    Array.isArray(primarySource?.audio) && primarySource.audio.length
      ? primarySource.audio
      : (Array.isArray(resolvedPayload?.audio) && resolvedPayload.audio.length ? resolvedPayload.audio : storedAudio)
  ).filter((entry: any) => String(entry?.uri || "").trim());

  if (streams.length === 0) return null;

  const defaultAudioIdx = typeof resolvedPayload?.defaultAudioIdx === "number" ? resolvedPayload.defaultAudioIdx : pickAnDefaultAudioIdx(audio);
  const preferredQualityIdx = pickAnPreferredQualityIdx(streams);
  const qualityOptions = streams.map((stream: any) => ({
    label: String(stream?.label || (stream?.height ? `${stream.height}p` : "Auto")).trim() || "Auto",
    src: buildAnSyntheticMaster(stream, audio, defaultAudioIdx),
  }));
  qualityOptions.sort((a, b) => {
    const ah = Number(String(a.label).match(/\d{3,4}/)?.[0] || 0);
    const bh = Number(String(b.label).match(/\d{3,4}/)?.[0] || 0);
    if (ah === 1080) return -1;
    if (bh === 1080) return 1;
    return bh - ah;
  });

  // Reorder audioTracks so Hindi (when present) is first → VideoPlayer picks
  // it as the default language pill and matching HLS audio track.
  const normalized = normalizeAnAudioTracks(audio, streams);
  const existingAudioTracks = Array.isArray(resolvedPayload?.audioTracks)
    ? resolvedPayload.audioTracks
        .map((track: any) => ({
          language: String(track?.language || track?.label || "").trim(),
          label: String(track?.label || track?.language || "").trim(),
          link: String(track?.link1080 || track?.link || "").trim(),
          link480: track?.link480,
          link720: track?.link720,
          link1080: track?.link1080,
          link4k: track?.link4k,
        }))
        .filter((track: any) => track.label && track.link)
    : undefined;
  let audioTracks = normalized?.length ? normalized : existingAudioTracks;
  if (normalized && normalized.length > 1) {
    const hindiIdx = normalized.findIndex((t) =>
      /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${t.language} ${t.label}`),
    );
    if (hindiIdx > 0) {
      audioTracks = [normalized[hindiIdx], ...normalized.filter((_, i) => i !== hindiIdx)];
    }
  }

  return {
    src: qualityOptions[preferredQualityIdx]?.src || qualityOptions[0]?.src || buildAnHlsPlaybackUrl(streams[preferredQualityIdx]?.url || streams[0]?.url || ""),
    qualityOptions: qualityOptions.length > 1 ? qualityOptions : undefined,
    audioTracks,
    subtitleTracks: undefined,
    preferredLanguage: audio[defaultAudioIdx]
      ? (String(audio[defaultAudioIdx]?.name || audio[defaultAudioIdx]?.language || "Hindi").trim() || "Hindi")
      : undefined,
    anNativeData: {
      streams,
      audio,
      preferredQualityIdx,
      defaultAudioIdx,
    } as AnNativeResolvedData,
  };
};

const animeSaltDirectStateCache = new Map<string, Promise<Awaited<ReturnType<typeof buildAnimeSaltDirectPlaybackState>> | null>>();

const getAnimeSaltDirectState = async (episodeSlug: string, forceRefresh = false) => {
  const key = String(episodeSlug || "").trim();
  if (!key) return null;
  if (forceRefresh) animeSaltDirectStateCache.delete(key);
  const existing = animeSaltDirectStateCache.get(key);
  if (existing) return existing;

  // Derive the series slug from the episode slug (e.g. "naruto-1x5" → "naruto").
  const seriesSlug = key.replace(/-\d+x\d+$/i, "").replace(/-\d+$/i, "");

  const request = (async () => {
    // Runtime is Firebase-only. The AN API is allowed only in Admin fetch/save.
    try {
      const snap = await get(ref(db, `anSeries/${seriesSlug}/episodes/${key}`));
      const cached = snap.val();
      if (!forceRefresh && cached && !cached.broken && (cached.directUrl || (Array.isArray(cached.links) && cached.links.length) || (Array.isArray(cached.sources) && cached.sources.length))) {
        const built = await buildAnimeSaltDirectPlaybackState(cached);
        if (built?.src) return built;
      }
    } catch {}
    return null;
  })();
  animeSaltDirectStateCache.set(key, request);
  request.then((value) => {
    if (!value?.src) {
      animeSaltDirectStateCache.delete(key);
    }
  }).catch(() => animeSaltDirectStateCache.delete(key));
  return request;
};

// Helper: get best available src from episode (fallback if default link is empty)
const getEpisodeSrc = (ep?: Episode | null): string => {
  if (!ep) return "";
  return [ep.link, ep.link480, ep.link720, ep.link1080, ep.link4k].find((url) => !isInvalidPlaybackUrl(url)) || "";
};

const getMovieSrc = (anime: AnimeItem): string => {
  return [anime.movieLink, anime.movieLink480, anime.movieLink720, anime.movieLink1080, anime.movieLink4k].find((url) => !isInvalidPlaybackUrl(url)) || "";
};

const hasStoredFirebasePlayback = (anime: AnimeItem): boolean => {
  if (getMovieSrc(anime)) return true;
  const seasons = resolveAnimeSeasonsForLanguage(anime, anime.baseLanguage || anime.language);
  return !!seasons?.some((season) => season?.episodes?.some((ep) => !!getEpisodeSrc(ep as Episode)));
};

const getMovieQualityOptions = (anime: AnimeItem): { label: string; src: string }[] => {
  const qualityOptions: { label: string; src: string }[] = [];
  if (!isInvalidPlaybackUrl(anime.movieLink480)) qualityOptions.push({ label: "480p", src: anime.movieLink480! });
  if (!isInvalidPlaybackUrl(anime.movieLink720)) qualityOptions.push({ label: "720p", src: anime.movieLink720! });
  if (!isInvalidPlaybackUrl(anime.movieLink1080)) qualityOptions.push({ label: "1080p", src: anime.movieLink1080! });
  if (!isInvalidPlaybackUrl(anime.movieLink4k)) qualityOptions.push({ label: "4K", src: anime.movieLink4k! });
  return qualityOptions;
};

const getEpisodeQualityOptions = (ep: Episode): { label: string; src: string }[] => {
  const qualityOptions: { label: string; src: string }[] = [];
  if (!isInvalidPlaybackUrl(ep.link480)) qualityOptions.push({ label: "480p", src: ep.link480! });
  if (!isInvalidPlaybackUrl(ep.link720)) qualityOptions.push({ label: "720p", src: ep.link720! });
  if (!isInvalidPlaybackUrl(ep.link1080)) qualityOptions.push({ label: "1080p", src: ep.link1080! });
  if (!isInvalidPlaybackUrl(ep.link4k)) qualityOptions.push({ label: "4K", src: ep.link4k! });
  return qualityOptions;
};

const splitLanguageTokens = (value: string | undefined | null) =>
  String(value || "")
    .split(/[,/|]/)
    .map((item) => item.trim())
    .filter(Boolean);

const getPrimaryLanguageToken = (value: string | undefined | null) => splitLanguageTokens(value)[0] || "";

const getLanguageBadgeLabel = (anime: AnimeItem): string => {
  const set = new Set<string>();
  const push = (raw?: string) => splitLanguageTokens(raw).forEach((label) => set.add(label));
  (anime.availableLanguages || []).forEach((lang) => push(lang));
  push(anime.baseLanguage || anime.language);
  if (anime.seasonsByLanguage && typeof anime.seasonsByLanguage === "object") {
    Object.keys(anime.seasonsByLanguage).forEach((lang) => push(lang));
  }
  if (anime.seasons) {
    anime.seasons.forEach((season: any) => {
      (season.episodes || []).forEach((ep: any) => {
        (ep.audioTracks || []).forEach((at: any) => push(at.language || at.label));
      });
    });
  }
  const arr = Array.from(set).filter(Boolean);
  if (arr.length === 0) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return "Dual";
  return "Multiple";
};

const resolveAnimeSeasonsForLanguage = (anime: AnimeItem, language?: string | null) => {
  const requested = String(language || "").trim().toLowerCase();
  const byLanguage = anime.seasonsByLanguage && typeof anime.seasonsByLanguage === "object" ? anime.seasonsByLanguage : undefined;
  if (byLanguage) {
    const entries = Object.entries(byLanguage);
    const exact = requested
      ? entries.find(([lang]) => String(lang || "").trim().toLowerCase() === requested)?.[1]
      : undefined;
    if (exact) return exact;
    const fallbackLanguage = String(anime.baseLanguage || anime.language || "").trim().toLowerCase();
    const fallback = entries.find(([lang]) => String(lang || "").trim().toLowerCase() === fallbackLanguage)?.[1];
    if (fallback) return fallback;
  }
  return anime.seasons || [];
};

const resolvePlayableLanguage = (anime: AnimeItem, preferred?: string | null) => {
  const normalizedPreferred = normalizeLanguageName(preferred);
  const byLanguage = anime.seasonsByLanguage && typeof anime.seasonsByLanguage === "object"
    ? Object.entries(anime.seasonsByLanguage)
    : [];

  const hasPlayableEpisodes = (seasons?: Season[]) => !!seasons?.some((season) => season?.episodes?.some((ep) => getEpisodeSrc(ep as Episode)));

  if (byLanguage.length > 0) {
    const normalizedEntries = byLanguage.map(([lang, seasons]) => ({
      label: normalizeLanguageName(lang),
      seasons: seasons as Season[],
    }));
    const exact = normalizedPreferred
      ? normalizedEntries.find((entry) => entry.label.toLowerCase() === normalizedPreferred.toLowerCase() && hasPlayableEpisodes(entry.seasons))
      : undefined;
    if (exact) return exact.label;
    const hindi = normalizedEntries.find((entry) => entry.label.toLowerCase() === "hindi" && hasPlayableEpisodes(entry.seasons));
    if (hindi) return hindi.label;
    const firstPlayable = normalizedEntries.find((entry) => hasPlayableEpisodes(entry.seasons));
    if (firstPlayable) return firstPlayable.label;
  }

  return normalizedPreferred || normalizeLanguageName(anime.baseLanguage || anime.language) || normalizeLanguageName(anime.language) || "";
};
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import HeroSlider from "@/components/HeroSlider";
import CategoryPills from "@/components/CategoryPills";
import AnimeSection from "@/components/AnimeSection";
import VideoPlayer, { normalizeLanguageName } from "@/components/VideoPlayer";
import NotificationsPage from "@/pages/NotificationsPage";
import ProfilePage from "@/components/ProfilePage";
import SearchPage from "@/components/SearchPage";
import NewEpisodeReleases from "@/components/NewEpisodeReleases";
import LoginPage from "@/components/LoginPage";
import { useFirebaseData } from "@/hooks/useFirebaseData";
import { useSelectedAnimeSalt } from "@/hooks/useSelectedAnimeSalt";
import LiveSupportChat from "@/components/LiveSupportChat";
import LiveTvPage from "@/components/LiveTvPage";
import { initializeUiTheme } from "@/lib/uiTheme";
import { useBranding } from "@/hooks/useBranding";
import { guestStore } from "@/lib/guestStore";
import { clearActiveDisplayName, clearActiveProfilePhoto, writeDisplayName, writeProfilePhoto } from "@/lib/localUser";
import { optimizedImageUrl } from "@/lib/imageCache";

const warmedImageUrls = new Set<string>();
const AN_DETAILS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const DETAILS_LOADING_TOAST_ID = "rs-an-details-loading-toast";

const preloadImage = (src?: string | null) => {
  const url = String(src || "").trim();
  if (!url || warmedImageUrls.has(url) || typeof window === "undefined") return Promise.resolve();
  warmedImageUrls.add(url);
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
};

const PosterGridCard = ({ anime, onClick }: { anime: AnimeItem; onClick: (anime: AnimeItem) => void }) => (
  <div key={anime.id} data-anime-card="true" className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover" onClick={() => onClick(anime)}>
    <img src={optimizedImageUrl(anime.poster, "poster")} alt={anime.title} className="poster-img w-full h-full object-cover" loading="eager" decoding="async" />
    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.90) 0%, rgba(0,0,0,0.22) 42%, transparent 72%)" }} />
    <span className="absolute top-1.5 right-1.5 gradient-primary px-2 py-0.5 rounded text-[9px] font-bold">{anime.year}</span>
    {(anime as any).dubType === "fandub" && <span className="absolute top-1.5 left-1.5 bg-orange-600 px-1.5 py-0.5 rounded text-[8px] font-bold text-white">FAN</span>}
    <div className="absolute bottom-0 left-0 right-0 p-2">
      <p className="text-[11px] font-semibold leading-tight line-clamp-2 text-white" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}>{anime.title}</p>
    </div>
  </div>
);

const anDetailsCacheKey = (id: string) => `rs_an_details:${String(id || "").replace(/[^a-z0-9_-]/gi, "_")}`;

const isUsableAnDetailsCache = (data: any): boolean => {
  if (!data) return false;
  const isStoredUrl = (url?: string | null) => {
    const value = String(url || "").trim();
    return !!value && !value.startsWith("animesalt://") && !value.startsWith("animesalt_movie://");
  };
  if ([data.movieLink, data.movieLink480, data.movieLink720, data.movieLink1080, data.movieLink4k].some(isStoredUrl)) return true;
  return Array.isArray(data.seasons) && data.seasons.some((season: any) =>
    Array.isArray(season?.episodes) && season.episodes.some((ep: any) =>
      [ep?.link, ep?.link480, ep?.link720, ep?.link1080, ep?.link4k].some(isStoredUrl),
    ),
  );
};

const readCachedAnDetails = (id: string): AnimeItem | null => {
  try {
    const raw = localStorage.getItem(anDetailsCacheKey(id));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.ts || !cached?.data || Date.now() - Number(cached.ts) > AN_DETAILS_CACHE_TTL) {
      localStorage.removeItem(anDetailsCacheKey(id));
      return null;
    }
    if (!isUsableAnDetailsCache(cached.data)) {
      localStorage.removeItem(anDetailsCacheKey(id));
      return null;
    }
    return cached.data as AnimeItem;
  } catch { return null; }
};

const writeCachedAnDetails = (id: string, data: AnimeItem) => {
  if (!isUsableAnDetailsCache(data)) return;
  try { localStorage.setItem(anDetailsCacheKey(id), JSON.stringify({ ts: Date.now(), data })); } catch {}
};
import { db, ref, set, onValue, get } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";
import { toast } from "sonner";
// FCM removed — push notifications no longer used
import { isUnlockBlockActive } from "@/lib/unlockBlock";
import { getCurrentDeviceFreeAccessExpiry, isAdGateCooldownActive, markAdGateShownNow } from "@/lib/unlockAccess";
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
const TAB_GRID_INITIAL_COUNT = 48;
const TAB_GRID_BATCH_COUNT = 48;

// Public URL paths for each main page — gives real router routes
// (back-button works, share-friendly URLs) without dismantling the swipe strip.
const MAIN_PAGE_PATH: Record<MainPage, string> = {
  home: "/",
  series: "/series",
  livetv: "/live-tv",
  movies: "/movies",
};
const pathToMainPage = (path: string): MainPage | null => {
  if (path === "/" || path === "") return "home";
  if (path === "/series" || path.startsWith("/series/")) return "series";
  if (path === "/live-tv" || path.startsWith("/live-tv/")) return "livetv";
  if (path === "/movies" || path.startsWith("/movies/")) return "movies";
  return null;
};

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
  const displaySiteName = brandingConfig.siteName || "RS ANIME";

  // --- Splash hold ---
  // Always show the original splash on a fresh website entry/reload, then
  // release after the first visible assets are warm. Route/page navigation does
  // not remount this component, so the splash still won't interrupt browsing.
  const [splashHold, setSplashHold] = useState<boolean>(true);
  const splashAssetTargetsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!splashHold) return;
    let cancelled = false;
    const release = () => {
      if (cancelled) return;
      cancelled = true;
      setSplashHold(false);
    };
    const cap = window.setTimeout(release, 4000);
    const min = new Promise<void>((r) => window.setTimeout(r, 900));
    const waitForAssets = async () => {
      await new Promise((r) => window.setTimeout(r, 60));
      const targets = splashAssetTargetsRef.current.slice(0, 14).filter(Boolean);
      if (targets.length === 0) return;
      await Promise.all(targets.map((u) => preloadImage(u)));
    };
    Promise.all([min, waitForAssets()]).then(release).catch(release);
    return () => { cancelled = true; window.clearTimeout(cap); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- In-player suggestion switch ---
  // When the user picks a suggestion from within the running player, we want
  // the player to STAY mounted and just swap its content. stopAllPlayback()
  // ordinarily nukes <video>/<iframe> sources, which causes the player to
  // close and re-open with a flash. While this ref is true, the stop helper
  // skips that teardown so React can diff new props onto the same player.
  const keepPlayerAliveRef = useRef(false);
  const inPlayerSwitchRef = useRef(false);


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
    // All Series must be RS/Firebase only. AN-generated cards stay in AN areas / continue watching, not mixed here.
    return webseries.filter(i => i.source !== 'animesalt' && i.sourceName !== 'AnimeSalt' && !i.anSlug && !i.animeSaltSlug && !String(i.id || '').startsWith('as_') && !String(i.id || '').startsWith('an_'));
  }, [webseries]);

  const allMovies = useMemo(() => {
    // All Movies must be RS/Firebase only. AN movies are managed separately.
    return movies.filter(i => i.source !== 'animesalt' && i.sourceName !== 'AnimeSalt' && !i.anSlug && !i.animeSaltSlug && !String(i.id || '').startsWith('as_') && !String(i.id || '').startsWith('an_'));
  }, [movies]);
  
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
        clearActiveDisplayName();
        clearActiveProfilePhoto();
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
    // Guest playback is allowed. Account-level unlock gating applies only to logged-in users.
    if (!isLoggedIn) return true;

    // AnimeSalt (AN) content always plays — for everyone, logged-in or guest.
    // Logged-in users get the SAME zero-friction playback as guests so the
    // "File not found / can't play" asymmetry never happens again.
    if (anime?.source === "animesalt" || String(anime?.id || "").startsWith("as_")) {
      return true;
    }

    if (unlockBlocked) {
      toast.error("This account is blocked because the same unlock token was misused.");
      return false;
    }

    if (saltIsPremium) return true;

    if (hasFreeAccess()) return true;

    if (isAdGateCooldownActive()) return true;

    // If admin disabled the shortener system entirely, free users get instant access (no ad-gate).
    const shortenerOn = await isShortenerEnabled();
    if (!shortenerOn) return true;

    if (anime) {
      markAdGateShownNow();
      redirectToUnlockRequired(anime, seasonIdx, epIdx);
    }
    return false;
  }, [isLoggedIn, unlockBlocked, saltIsPremium, hasFreeAccess, redirectToUnlockRequired]);

  const [activePage, setActivePage] = useState<MainPage>(() => {
    // Priority: URL path → sessionStorage → "home". This makes /series, /movies,
    // /live-tv real routes — refresh, share, browser-back all work correctly.
    try {
      const fromPath = pathToMainPage(window.location.pathname);
      if (fromPath) return fromPath;
      const savedPage = sessionStorage.getItem("rs_activePage") || "home";
      return isMainPage(savedPage) ? savedPage : "home";
    } catch {
      return "home";
    }
  });
  const pageScrollPositions = useRef<Record<MainPage, number>>({ home: 0, series: 0, livetv: 0, movies: 0 });
  const [tabGridVisibleCount, setTabGridVisibleCount] = useState<Record<"series" | "movies", number>>({
    series: TAB_GRID_INITIAL_COUNT,
    movies: TAB_GRID_INITIAL_COUNT,
  });
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
  const getDefaultWatchTarget = useCallback((anime: AnimeItem) => {
    const resolvedLanguage = resolvePlayableLanguage(anime, anime.baseLanguage || anime.language);
    const resolvedSeasons = resolveAnimeSeasonsForLanguage(anime, resolvedLanguage);
    if (anime.type === "webseries" && resolvedSeasons?.length) {
      return { seasonIdx: 0, epIdx: 0 };
    }
    return { seasonIdx: undefined, epIdx: undefined };
  }, []);
  const buildShareLink = useCallback((animeId: string, seasonIdx?: number, epIdx?: number) => {
    return buildEpisodeDeepLink(animeId, seasonIdx, epIdx);
  }, []);
  const stopAllPlayback = useCallback(() => {
    // Skip teardown when the suggestion-switch flow wants to keep the player
    // alive so React can swap props in-place (no flash / no reopen).
    if (keepPlayerAliveRef.current) return;
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
    selectedLanguage?: string;
    seasonIdx?: number;
    epIdx?: number;
    qualityOptions?: { label: string; src: string }[];
    audioTracks?: { language: string; label: string; link: string; link480?: string; link720?: string; link1080?: string; link4k?: string }[];
    subtitleTracks?: SubtitleTrack[];
    nextEpisodeSrc?: string;
    resumeTime?: number;
    anNativeData?: AnNativeResolvedData | null;
  } | null>(() => {
    try {
      const saved = sessionStorage.getItem("rs_playerState");
      if (saved) {
        const parsed = JSON.parse(saved);
        const isAnimeSalt = parsed?.anime?.source === "animesalt" || String(parsed?.anime?.id || "").startsWith("as_");
        if (isAnimeSalt) return parsed;
      }
    } catch {}
    return null;
  });
  const playerStateRef = useRef(playerState);
  // Sync synchronously during render so the route-watch effect never sees a
  // stale value — prevents handlePlay from firing twice and the RS player
  // from flashing Hindi ↔ English while playerState catches up.
  playerStateRef.current = playerState;

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
    resumeTime?: number;
    anNativeData?: AnNativeResolvedData | null;
  } | null>(() => {
    try {
      const saved = sessionStorage.getItem("rs_saltPlayerState");
      if (saved) {
        const parsed = JSON.parse(saved);
        const isAnimeSalt = parsed?.anime?.source === "animesalt" || String(parsed?.anime?.id || "").startsWith("as_");
        if (!isAnimeSalt) return parsed;
      }
    } catch {}
    return null;
  });

  // Persist player states to sessionStorage for refresh recovery
  useEffect(() => {
    try {
      const isAnimeSalt = playerState?.anime?.source === "animesalt" || String(playerState?.anime?.id || "").startsWith("as_");
      if (playerState && !isAnimeSalt) {
        const { qualityOptions, ...rest } = playerState;
        sessionStorage.setItem("rs_playerState", JSON.stringify(rest));
      } else {
        sessionStorage.removeItem("rs_playerState");
      }
    } catch {}
  }, [playerState]);

  useEffect(() => {
    try {
      const isAnimeSalt = saltPlayerState?.anime?.source === "animesalt" || String(saltPlayerState?.anime?.id || "").startsWith("as_");
      if (saltPlayerState && isAnimeSalt) {
        const { loading, ...rest } = saltPlayerState;
        sessionStorage.setItem("rs_saltPlayerState", JSON.stringify(rest));
      } else {
        sessionStorage.removeItem("rs_saltPlayerState");
      }
    } catch {}
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
    // Fixed-ID fallback: if Sonner already recycled the toast id or the user
    // opens AN from persisted Continue Watching cache, this still force-closes
    // the exact loading notification. The X button uses this same path.
    try { toast.dismiss(DETAILS_LOADING_TOAST_ID); } catch {}
  }, []);

  const showDetailsLoadingToast = useCallback(() => {
    // Disabled: AN data is now pre-fetched to Firebase (anSeries/*), so episodes
    // open instantly like RS. The "Loading details..." notification is removed
    // per user request — anything still relying on the returned id is a no-op.
    dismissDetailsLoadingToast();
    return null as unknown as string | number;
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
    const forceClose = () => dismissDetailsLoadingToast();
    window.addEventListener("rs:force-close-details-loader", forceClose);
    return () => window.removeEventListener("rs:force-close-details-loader", forceClose);
  }, [dismissDetailsLoadingToast]);

  useEffect(() => {
    // Keep the "Loading details..." toast visible while the salt player is
    // still resolving the embed URL — only dismiss once playback is actually
    // ready, so users see continuous feedback (no premature silent gap, and
    // by the time the player paints the default Hindi audio is already
    // selected — no visible language switch).
    const saltReady = saltPlayerState && saltPlayerState.loading === false;
    if (playerState || saltReady || selectedAnime) {
      dismissDetailsLoadingToast();
    }
  }, [playerState, saltPlayerState, selectedAnime, dismissDetailsLoadingToast]);

  // Create a blob URL wrapper that embeds the video in a full-screen iframe (no proxy needed)
  const getCleanEmbedUrl = useCallback((embedUrl: string): string => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body,html{width:100%;height:100%;overflow:hidden;background:#000}iframe{width:100%;height:100%;border:none}</style></head><body><iframe src="${embedUrl}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="no-referrer"></iframe></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, []);

  // Continue watching data (per-account, NOT per-device). Seeded from localStorage cache for instant render.
  const [continueWatching, setContinueWatching] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem("rs_continueCache") || "[]"); } catch { return []; }
  });

  // Load continue watching from Firebase - per ACCOUNT
  useEffect(() => {
    if (!isLoggedIn) return;
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (!u.id) return;
      const whRef = ref(db, `users/${u.id}/watchHistory`);
      const unsub = onValue(whRef, (snapshot) => {
        const data = snapshot.val() || {};
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        // Skip legacy per-device nested keys (objects without `id` field)
        const items = Object.values(data).filter((v: any) => v && typeof v === "object" && v.id) as any[];
        const localRaw = localStorage.getItem("rs_continueCache");
        let localItems: any[] = [];
        try {
          const parsed = JSON.parse(localRaw || "[]");
          localItems = Array.isArray(parsed) ? parsed : [];
        } catch {}
        const merged = new Map<string, any>();
        // One Continue Watching card PER SERIES — pick latest watchedAt, but
        // never lose progress: if the newer entry lacks currentTime/duration
        // (e.g. user just re-opened the card), keep the older entry that
        // actually has playback progress so the % bar + resume time stay.
        [...localItems, ...items].forEach((entry: any) => {
          if (!entry?.id) return;
          const key = String(entry.id);
          const current = merged.get(key);
          if (!current) { merged.set(key, entry); return; }
          const entryHasProgress = Number(entry?.currentTime) > 0 && Number(entry?.duration) > 0;
          const currentHasProgress = Number(current?.currentTime) > 0 && Number(current?.duration) > 0;
          const entryNewer = Number(entry?.watchedAt || 0) >= Number(current?.watchedAt || 0);
          if (entryNewer && entryHasProgress) { merged.set(key, entry); return; }
          if (entryNewer && !entryHasProgress && currentHasProgress) {
            // Keep older progress data but bump the watchedAt timestamp
            merged.set(key, { ...current, watchedAt: entry.watchedAt || current.watchedAt });
            return;
          }
          if (!entryNewer && entryHasProgress && !currentHasProgress) {
            merged.set(key, { ...entry, watchedAt: current.watchedAt || entry.watchedAt });
          }
        });
        const withProgress = Array.from(merged.values()).filter((i: any) => {
          // Respect 30-day retention window
          if (i.watchedAt && now - i.watchedAt > THIRTY_DAYS) return false;
          if (i.id?.startsWith('as_')) return true;
          return i.currentTime && i.duration && (i.currentTime / i.duration) < 0.95;
        });
        withProgress.sort((a: any, b: any) => (b.watchedAt || 0) - (a.watchedAt || 0));
        // Secondary dedup: collapse any duplicates that share the same
        // normalized title (handles legacy entries whose id was per-episode
        // or differed between AN/RS sources). Keep the most recently
        // watched one — its episodeInfo is the user's last watched episode.
        const byTitle = new Map<string, any>();
        const final: any[] = [];
        for (const item of withProgress) {
          const tkey = String(item.title || "").trim().toLowerCase();
          if (!tkey) { final.push(item); continue; }
          if (byTitle.has(tkey)) continue;
          byTitle.set(tkey, item);
          final.push(item);
        }
        setContinueWatching(final);
        // Mirror to localStorage so guests/offline still see the list
        try { localStorage.setItem("rs_continueCache", JSON.stringify(final.slice(0, 50))); } catch {}
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

    // Deep-link from Telegram / share URLs: read ?s= and ?e= so we open
    // the player DIRECTLY at the requested episode instead of bouncing
    // through the details page (kills the 10-15s perceived latency).
    let deepSIdx: number | undefined;
    let deepEIdx: number | undefined;
    try {
      const params = new URLSearchParams(window.location.search);
      const s = params.get("s");
      const e = params.get("e") ?? params.get("ep");
      if (s !== null) {
        const n = Number(s);
        if (Number.isFinite(n) && n >= 0) deepSIdx = n;
      }
      if (e !== null) {
        const n = Number(e);
        if (Number.isFinite(n) && n >= 0) deepEIdx = n;
      }
    } catch {}

    const found = allAnime.find((a) => a.id === pendingAnimeId);
    if (found) {
      handleCardClick(found, deepSIdx, deepEIdx);
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
        handleCardClick(stub, deepSIdx, deepEIdx);
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

  useEffect(() => {
    setTabGridVisibleCount({ series: TAB_GRID_INITIAL_COUNT, movies: TAB_GRID_INITIAL_COUNT });
  }, [activeCategory, dubFilter]);

  useEffect(() => {
    if (activePage !== "series" && activePage !== "movies") return;
    const total = activePage === "series" ? filteredSeries.length : filteredMovies.length;
    const current = tabGridVisibleCount[activePage];
    if (current >= total) return;
    const timer = window.setTimeout(() => {
      setTabGridVisibleCount((prev) => ({
        ...prev,
        [activePage]: Math.min(total, prev[activePage] + TAB_GRID_BATCH_COUNT),
      }));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activePage, filteredSeries.length, filteredMovies.length, tabGridVisibleCount]);

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
    const timer = setInterval(() => { setHeroRotation(prev => prev + 1); }, 60000);
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
    
    const buildEpInfo = (item: any) => {
      if (item.type === "movie") return "Movie";
      if (!item.seasons || item.seasons.length === 0) return "";
      const total = item.seasons.reduce((s: number, ss: any) => s + ((ss.episodes || []).length), 0);
      if (total === 0) return "";
      return item.seasons.length > 1 ? `${item.seasons.length}S · ${total} EP` : `${total} EP`;
    };
    const buildLangInfo = (item: any) => {
      const set = new Set<string>();
      const push = (raw?: string) => { if (!raw) return; String(raw).split(/[,/|]+/).forEach((s) => { const t = s.trim(); if (t) set.add(t); }); };
      (item.availableLanguages || []).forEach((lang: string) => push(lang));
      push(item.baseLanguage || item.language);
      (item.seasons || []).forEach((s: any) => (s.episodes || []).forEach((ep: any) => (ep.audioTracks || []).forEach((at: any) => push(at.language || at.label))));
      const arr = Array.from(set).filter(Boolean);
      if (arr.length === 0) return "";
      if (arr.length === 1) return arr[0];
      if (arr.length === 2) return "Dual";
      return "Multiple";
    };

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
      episodeInfo: buildEpInfo(item),
      languageInfo: buildLangInfo(item),
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const warmHomeAssets = () => {
      const heroTargets = heroSlides.slice(0, 4).map((slide) => optimizedImageUrl(slide.backdrop, "backdrop"));
      const cardTargets = [
        ...continueWatching.slice(0, 8).map((item: any) => optimizedImageUrl(item.poster, "poster")),
        ...trendingSeries.slice(0, 10).map((item) => optimizedImageUrl(item.poster, "poster")),
        ...filteredMovies.slice(0, 10).map((item) => optimizedImageUrl(item.poster, "poster")),
        ...allAnimeSaltUnique.slice(0, 18).map((item) => optimizedImageUrl(item.poster, "poster")),
      ];
      const allTargets = heroTargets.concat(cardTargets).filter(Boolean) as string[];
      splashAssetTargetsRef.current = allTargets;
      allTargets.forEach((src) => { void preloadImage(src); });

      // Do not prefetch AnimeSalt detail APIs on the home screen; it adds
      // background network/JS pressure while users are scrolling.
    };

    const idle = (window as any).requestIdleCallback;
    if (typeof idle === "function") {
      const id = idle(warmHomeAssets, { timeout: 1200 });
      return () => {
        try { (window as any).cancelIdleCallback?.(id); } catch {}
      };
    }
    const timer = window.setTimeout(warmHomeAssets, 120);
    return () => window.clearTimeout(timer);
  }, [heroSlides, continueWatching, trendingSeries, filteredMovies, allAnimeSaltUnique]);

  async function openPlayerFromAnime(anime: AnimeItem, overrides?: { seasonIdx?: number; epIdx?: number }) {
    const target = {
      ...getDefaultWatchTarget(anime),
      ...(overrides || {}),
    };
    await handlePlay(anime, target.seasonIdx, target.epIdx);
  }

  const handleCardClick = async (anime: AnimeItem, sIdx?: number, eIdx?: number) => {
    // Cancel any stale in-flight AnimeSalt details requests when switching content
    detailsRequestRef.current += 1;
    const switchingInPlayer = keepPlayerAliveRef.current;

    // Track click for trending popularity (fire-and-forget)
    try {
      import("@/lib/firebase").then(({ runTransaction, ref: fbRef, db: fbDb }) => {
        runTransaction(fbRef(fbDb, `analytics/totals/clicks/${anime.id}`), (curr: any) => {
          const base = curr && typeof curr === "object" ? curr : { count: 0 };
          return { count: (base.count || 0) + 1, title: anime.title || base.title || "", lastClick: Date.now() };
        }).catch(() => {});
      });
    } catch {}


    // AN public playback is Firebase-only. Admin fetch/save is the only place
    // allowed to call the AN API; runtime must use stored RS-style URLs.
    if (anime.source === "animesalt") {
      if (hasStoredFirebasePlayback(anime)) {
        await openPlayerFromAnime(anime, { seasonIdx: sIdx, epIdx: eIdx });
      } else {
        toast.error("AN video/audio is not saved in Firebase yet. Fetch it from Admin first.");
      }
      return;
    }

    // Reflect details view in the URL so back-button works as a real route.
    // Use replace when coming from a routed overlay (search/notifications) to
    // avoid stacking duplicate entries; push from anywhere else.
    const watchTarget = getDefaultWatchTarget(anime);
    const targetRoute = buildWatchRoute(anime.id, watchTarget.seasonIdx, watchTarget.epIdx);
    if (location.pathname !== targetRoute) {
      const fromRoutedOverlay = isSearchRoute || isNotificationsRoute;
      navigate(targetRoute, { replace: fromRoutedOverlay });
    }

    await openPlayerFromAnime(anime, { seasonIdx: sIdx, epIdx: eIdx });
  };

  const handlePlay = async (anime: AnimeItem, seasonIdx?: number, epIdx?: number) => {
    if (unlockBlocked) {
      toast.error("This account is blocked due to token misuse.");
      return;
    }

    if (!freeAccessLoaded) {
      return;
    }

    const fallbackTarget = getDefaultWatchTarget(anime);
    const resolvedSeasonIdx = seasonIdx ?? fallbackTarget.seasonIdx;
    const resolvedEpIdx = epIdx ?? fallbackTarget.epIdx;

    const isInlineSwitch = keepPlayerAliveRef.current;
    stopAllPlayback();
    const targetWatchRoute = buildWatchRoute(anime.id, resolvedSeasonIdx, resolvedEpIdx);
    if (location.pathname !== targetWatchRoute || location.search !== new URL(targetWatchRoute, window.location.origin).search) {
      navigate(targetWatchRoute, { replace: isInlineSwitch || inPlayerSwitchRef.current });
    }

    const isAnimeSaltContent = anime.source === "animesalt" || String(anime.id || "").startsWith("as_");

    if (!hasFreeAccess() && !saltIsPremium && !isAnimeSaltContent) {
      // If admin disabled the unlock gate entirely, skip redirect and play directly
      const shortenerOn = await isShortenerEnabled();
      if (shortenerOn) {
        redirectToUnlockRequired(anime, resolvedSeasonIdx, resolvedEpIdx);
        return;
      }
    }

    const resolvedLanguage = resolvePlayableLanguage(anime, anime.baseLanguage || anime.language);
    const resolvedSeasons = resolveAnimeSeasonsForLanguage(anime, resolvedLanguage);
    let src = "";
    let subtitle = "";
    let qualityOptions: { label: string; src: string }[] = [];
    let audioTracks: { language: string; label: string; link: string; link480?: string; link720?: string; link1080?: string; link4k?: string }[] | undefined;
    if (anime.type === "webseries" && resolvedSeasons && resolvedSeasonIdx !== undefined && resolvedEpIdx !== undefined) {
      const season = resolvedSeasons[resolvedSeasonIdx];
      const episode = season.episodes[resolvedEpIdx];
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
        qualityOptions = getMovieQualityOptions(anime);
        if (anime.audioTracks?.length) audioTracks = anime.audioTracks;
    }

    // Handle AnimeSalt video - check ad-gate first
    if (src.startsWith("animesalt://")) {
      const hasAccess = await checkAndShowAdGate(anime, resolvedSeasonIdx, resolvedEpIdx);
      if (!hasAccess) return;
      const epSlug = src.replace("animesalt://", "");
      try {
        const directState = await getAnimeSaltDirectState(epSlug);
        if (directState?.src) {
          addToWatchHistory(anime, resolvedSeasonIdx, resolvedEpIdx, true);
          setPlayerState({
            src: directState.src,
            title: anime.title,
            subtitle: subtitle || `Episode`,
            anime,
            selectedLanguage: directState.preferredLanguage || "Hindi",
            seasonIdx: resolvedSeasonIdx,
            epIdx: resolvedEpIdx,
            qualityOptions: directState.qualityOptions,
            audioTracks: directState.audioTracks,
            subtitleTracks: directState.subtitleTracks,
            nextEpisodeSrc:
              anime.type === "webseries" && anime.seasons && resolvedSeasonIdx !== undefined && resolvedEpIdx !== undefined
                ? getEpisodeSrc(anime.seasons[resolvedSeasonIdx]?.episodes?.[resolvedEpIdx + 1] as Episode)
                : undefined,
          } as any);
          setSelectedAnime(null);
          inPlayerSwitchRef.current = false;
        } else {
          console.warn("[AN] no Firebase-saved source for episode", epSlug);
          inPlayerSwitchRef.current = false;
          toast.error("Episode source is not saved in Firebase. Refresh this series from Admin.");
        }
      } catch (e) {
        console.warn("[AN] episode load failed", epSlug, e);
        inPlayerSwitchRef.current = false;
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
        const directState = await getAnimeSaltDirectState(movieSlug);
        if (directState?.src) {
          addToWatchHistory(anime, undefined, undefined, true);
          setPlayerState({
            src: directState.src,
            title: anime.title,
            subtitle: "Movie",
            anime,
            selectedLanguage: directState.preferredLanguage || "Hindi",
            qualityOptions: directState.qualityOptions,
            audioTracks: directState.audioTracks,
            subtitleTracks: directState.subtitleTracks,
          } as any);
          setSelectedAnime(null);
          inPlayerSwitchRef.current = false;
        } else {
          inPlayerSwitchRef.current = false;
          toast.error("Movie source is not saved in Firebase. Refresh this movie from Admin.");
        }
      } catch {
        inPlayerSwitchRef.current = false;
        toast.error("Failed to load movie");
      }
      return;
    }

    if (src) {
      addToWatchHistory(anime, resolvedSeasonIdx, resolvedEpIdx);
      setPlayerState({
        src,
        title: anime.title,
        subtitle,
        // Override baseLanguage/language with the resolved language so the
        // VideoPlayer never sees a mismatch between the requested track
        // (e.g. "Hindi") and the anime's stored default (e.g. "English").
        // For RS we just want to play seasonsByLanguage[resolvedLanguage]
        // directly with no audio-track switching loop.
        anime: { ...anime, seasons: resolvedSeasons, baseLanguage: resolvedLanguage, language: resolvedLanguage },
        selectedLanguage: resolvedLanguage,
        seasonIdx: resolvedSeasonIdx,
        epIdx: resolvedEpIdx,
        qualityOptions,
        // RS content is NOT multi-audio HLS — never feed propAudioTracks
        // unless the episode actually defines them, otherwise the player's
        // language sheet hallucinates extra options and flips back and forth.
        audioTracks,
        subtitleTracks: anime.type === "webseries" ? (resolvedSeasons?.[resolvedSeasonIdx ?? 0]?.episodes?.[resolvedEpIdx ?? 0] as any)?.subtitleTracks : (anime as any).subtitleTracks,
        nextEpisodeSrc:
          anime.type === "webseries" && resolvedSeasons && resolvedSeasonIdx !== undefined && resolvedEpIdx !== undefined
            ? getEpisodeSrc(resolvedSeasons[resolvedSeasonIdx]?.episodes?.[resolvedEpIdx + 1] as Episode)
            : undefined,
      });
      setSelectedAnime(null);
      inPlayerSwitchRef.current = false;
    }
  };

  useEffect(() => {
    if (!isWatchRoute) {
      if (keepPlayerAliveRef.current || inPlayerSwitchRef.current) return;
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
    const params = new URLSearchParams(location.search);
    const legacyAnimeId = params.get("anime");
    const legacySeason = params.get("s");
    const legacyEpisode = params.get("e");
    if (!legacyAnimeId) return;

    if (legacySeason !== null || legacyEpisode !== null) {
      const sIdx = legacySeason !== null ? Number(legacySeason) : undefined;
      const eIdx = legacyEpisode !== null ? Number(legacyEpisode) : undefined;
      navigate(buildWatchRoute(legacyAnimeId, sIdx, eIdx), { replace: true });
      return;
    }

    navigate(buildAnimeRoute(legacyAnimeId), { replace: true });
  }, [location.search, navigate, buildAnimeRoute, buildWatchRoute]);

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
      const userId = user ? JSON.parse(user).id : null;
      const cacheRaw = localStorage.getItem("rs_continueCache");
      const cached = cacheRaw ? JSON.parse(cacheRaw) : [];
      const cachedMatch = Array.isArray(cached)
        ? cached.find((item: any) => item?.id === anime.id && ((item?.episodeInfo?.seasonIdx ?? item?.episodeInfo?.season) === (seasonIdx ?? item?.episodeInfo?.seasonIdx ?? item?.episodeInfo?.season)) && ((item?.episodeInfo?.epIdx ?? item?.episodeInfo?.episode) === (epIdx ?? item?.episodeInfo?.epIdx ?? item?.episodeInfo?.episode)))
        : null;
      const guestMatch = guestStore.continue.list().find((item) => item.animeId === anime.id && item.seasonIdx === seasonIdx && item.epIdx === epIdx);

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
      historyItem.language = getPrimaryLanguageToken((anime as any)?.selectedLanguage || anime.baseLanguage || anime.language) || anime.language || "";

      try {
        guestStore.continue.upsert({
          animeId: anime.id,
          seasonIdx,
          epIdx,
          position: preserveProgress ? Number(guestMatch?.position || 0) : 0,
          duration: preserveProgress ? Number(guestMatch?.duration || 0) : 0,
          title: anime.title,
          poster: anime.poster,
          updatedAt: Date.now(),
        });

        // One cache entry per series — replace any prior episode of the same series.
        const nextCache = [
          {
            ...historyItem,
            currentTime: preserveProgress ? Number(cachedMatch?.currentTime || 0) : 0,
            duration: preserveProgress ? Number(cachedMatch?.duration || 0) : 0,
          },
          ...(Array.isArray(cached) ? cached.filter((item: any) => item?.id !== anime.id) : []),
        ].slice(0, 50);
        localStorage.setItem("rs_continueCache", JSON.stringify(nextCache));
      } catch {}

      if (!userId) return;

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
      const userId = user ? JSON.parse(user).id : null;
      if (!playerState.anime.id) return;

      const updates: any = { currentTime, duration, watchedAt: Date.now() };
      if (playerState.seasonIdx !== undefined && playerState.epIdx !== undefined && playerState.anime.seasons) {
        const season = playerState.anime.seasons[playerState.seasonIdx];
        const episode = season?.episodes?.[playerState.epIdx];
        if (season && episode) {
          updates.episodeInfo = {
            season: playerState.seasonIdx + 1,
            episode: playerState.epIdx + 1,
            seasonName: season.name,
            episodeNumber: episode.episodeNumber,
            seasonIdx: playerState.seasonIdx,
            epIdx: playerState.epIdx,
          };
        }
      }
      if (userId) {
        const histRef = ref(db, `users/${userId}/watchHistory/${playerState.anime.id}`);
        import("@/lib/firebase").then(({ update }) => {
          update(histRef, updates).catch(() => {});
        });
      }

      try {
        const raw = localStorage.getItem("rs_continueCache");
        const cached = raw ? JSON.parse(raw) : [];
        const nextItem = {
          id: playerState.anime.id,
          source: playerState.anime.source || "firebase",
          title: playerState.anime.title,
          poster: playerState.anime.poster,
          year: playerState.anime.year,
          rating: playerState.anime.rating,
          type: playerState.anime.type,
          language: playerState.selectedLanguage || getPrimaryLanguageToken(playerState.anime.baseLanguage || playerState.anime.language) || playerState.anime.language || "",
          watchedAt: Date.now(),
          currentTime,
          duration,
          episodeInfo: updates.episodeInfo,
        };
        const nextCache = [
          nextItem,
          ...(Array.isArray(cached)
            ? cached.filter((item: any) => item?.id !== playerState.anime.id)
            : []),
        ].slice(0, 50);
        localStorage.setItem("rs_continueCache", JSON.stringify(nextCache));
        guestStore.continue.upsert({
          animeId: playerState.anime.id,
          seasonIdx: playerState.seasonIdx,
          epIdx: playerState.epIdx,
          position: currentTime,
          duration,
          title: playerState.anime.title,
          poster: playerState.anime.poster,
          updatedAt: Date.now(),
        });
      } catch {}
    } catch {}
  }, [playerState]);

  const handleContinueWatching = async (item: any) => {
    if (unlockBlocked) {
      toast.error("This account is blocked due to token misuse.");
      return;
    }

    const preferredSource = item.source || "firebase";
    const anime =
      allAnime.find(a => a.id === item.id && (a.source || "firebase") === preferredSource) ||
      allAnime.find(a => a.id === item.id && (a.source || "firebase") === "firebase") ||
      allAnime.find(a => a.id === item.id);
    if (!anime) return;

    if (anime.source === "animesalt" && !hasStoredFirebasePlayback(anime)) {
      toast.error("AN video/audio is not saved in Firebase yet. Refresh it from Admin first.");
      return;
    }

    // Use preserveProgress=true so we don't overwrite currentTime/duration
      if (item.episodeInfo) {
      const sIdx = item.episodeInfo.seasonIdx ?? (item.episodeInfo.season - 1);
      const eIdx = item.episodeInfo.epIdx ?? (item.episodeInfo.episode - 1);
      let src = "";
      let subtitle = "";
      let episode: Episode | undefined;
      let qualityOptions: { label: string; src: string }[] = [];
        const selectedLanguage = resolvePlayableLanguage(anime, item.language || anime.baseLanguage || anime.language || "");
        const resolvedSeasons = resolveAnimeSeasonsForLanguage(anime, selectedLanguage);
        if (resolvedSeasons) {
          const season = resolvedSeasons[sIdx];
        episode = season.episodes[eIdx];
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
        const nextState = {
          src,
          title: anime.title,
          subtitle,
          anime: { ...anime, seasons: resolvedSeasons },
          selectedLanguage,
          seasonIdx: sIdx,
          epIdx: eIdx,
          audioTracks: episode?.audioTracks,
          subtitleTracks: (episode as any)?.subtitleTracks,
          resumeTime: item.currentTime || 0,
          qualityOptions: qualityOptions.length > 0 ? qualityOptions : undefined,
          nextEpisodeSrc: getEpisodeSrc(resolvedSeasons?.[sIdx]?.episodes?.[eIdx + 1] as Episode),
        };
        playerStateRef.current = nextState;
        setPlayerState(nextState);
        const targetWatchRoute = buildWatchRoute(anime.id, sIdx, eIdx);
        if (`${location.pathname}${location.search}` !== targetWatchRoute) {
          navigate(targetWatchRoute);
        }
        addToWatchHistory(anime, sIdx, eIdx, true);
        setSelectedAnime(null);
      }
    } else {
      if (anime.movieLink) {
        const hasAccess = await checkAndShowAdGate(anime);
        if (!hasAccess) return;
        const nextState = {
          src: getMovieSrc(anime),
          title: anime.title,
          subtitle: "Movie",
          anime,
          audioTracks: anime.audioTracks,
          subtitleTracks: (anime as any).subtitleTracks,
          qualityOptions: getMovieQualityOptions(anime),
          resumeTime: item.currentTime || 0,
        };
        if (!nextState.src) {
          handleCardClick(anime);
          return;
        }
        playerStateRef.current = nextState;
        setPlayerState(nextState);
        const targetWatchRoute = buildWatchRoute(anime.id);
        if (`${location.pathname}${location.search}` !== targetWatchRoute) {
          navigate(targetWatchRoute);
        }
        addToWatchHistory(anime, undefined, undefined, true);
        setSelectedAnime(null);
      }
    }
  };

  const handleHeroPlay = useCallback((index: number) => {
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
  }, [heroSlides, allAnime, handlePlay, handleCardClick]);

  const handleHeroInfo = useCallback((index: number) => {
    const slide = heroSlides[index];
    if (!slide) return;
    if (slide.isCustom) {
      setCustomPostDetail({ title: slide.title, backdrop: slide.backdrop, description: slide.description || "" });
      return;
    }
    const anime = allAnime.find(a => a.id === slide.id);
    if (anime) handleCardClick(anime);
  }, [heroSlides, allAnime, handleCardClick]);

  const handleLogin = (userId: string) => {
    setIsLoggedIn(true);
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;

    const syncProfileFromRemote = async () => {
      try {
        const raw = localStorage.getItem("rsanime_user");
        const user = raw ? JSON.parse(raw) : null;
        const userId = user?.id;
        if (!userId) return;

        const snap = await get(ref(db, `users/${userId}`));
        if (!snap.exists() || cancelled) return;
        const data = snap.val() || {};

        const remotePhoto = String(data.profilePhoto || data.photoUrl || data.avatar || "").trim();
        const remoteName = String(data.name || "").trim();

        if (remotePhoto) {
          writeProfilePhoto(remotePhoto, userId);
        }
        if (remoteName && remoteName !== "Guest User") {
          writeDisplayName(remoteName, userId);
          localStorage.setItem("rsanime_user", JSON.stringify({
            ...user,
            name: remoteName,
          }));
        }
      } catch {}
    };

    void syncProfileFromRemote();
    window.addEventListener("focus", syncProfileFromRemote);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", syncProfileFromRemote);
    };
  }, [isLoggedIn]);

  const handleLogout = async () => {
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (u?.id) {
        const { unregisterCurrentDevice } = await import("@/lib/premiumDevice");
        await unregisterCurrentDevice(u.id);
      }
    } catch {}
    localStorage.removeItem("rsanime_user");
    clearActiveDisplayName();
    clearActiveProfilePhoto();
    localStorage.removeItem("rs_session_started_at");
    setIsLoggedIn(false);
    try { window.dispatchEvent(new Event("rs_auth_changed")); } catch {}
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
    clearActiveDisplayName();
    clearActiveProfilePhoto();
    localStorage.removeItem("rs_session_started_at");
    setDeviceLimitWarning(null);
    setUserFreeAccessExpiresAt(0);
    setIsLoggedIn(false);
    try { window.dispatchEvent(new Event("rs_auth_changed")); } catch {}
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
      let nextAudioTracks = clickedEp.audioTracks;
      let nextSubtitleTracks = (clickedEp as any).subtitleTracks;
      let preferredLanguage = (playerState as any)?.selectedLanguage;
      if (playerState?.anime.source === "animesalt" && String(clickedEp.link || "").startsWith("animesalt://")) {
        const epSlug = String(clickedEp.link).replace("animesalt://", "");
        try {
          const directState = await getAnimeSaltDirectState(epSlug);
          if (directState?.src) {
            nextSrc = directState.src;
            qOpts = directState.qualityOptions || [];
            nextAudioTracks = directState.audioTracks;
            nextSubtitleTracks = directState.subtitleTracks;
            preferredLanguage = directState.preferredLanguage || (nextAudioTracks?.find((t: any) => /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${t.language || ""} ${t.label || ""}`))?.label) || preferredLanguage;
          }
        } catch {}
      }
      addToWatchHistory(playerState!.anime, playerState!.seasonIdx, i);
      const nextState = {
        ...playerState!,
        src: nextSrc,
        subtitle: `${season.name} - Episode ${clickedEp.episodeNumber}`,
        epIdx: i,
        resumeTime: 0,
        selectedLanguage: preferredLanguage,
        audioTracks: nextAudioTracks,
        subtitleTracks: nextSubtitleTracks,
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
    let nextAudioTracks = ep.audioTracks;
    let nextSubtitleTracks = (ep as any).subtitleTracks;
    let preferredLanguage = (playerState as any)?.selectedLanguage;
    if (playerState.anime.source === "animesalt" && String(ep.link || "").startsWith("animesalt://")) {
      const epSlug = String(ep.link).replace("animesalt://", "");
      try {
        const directState = await getAnimeSaltDirectState(epSlug);
        if (directState?.src) {
          nextSrc = directState.src;
          qOpts = directState.qualityOptions || [];
          nextAudioTracks = directState.audioTracks;
          nextSubtitleTracks = directState.subtitleTracks;
          preferredLanguage = directState.preferredLanguage || (nextAudioTracks?.find((t: any) => /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${t.language || ""} ${t.label || ""}`))?.label) || preferredLanguage;
        }
      } catch {}
    }
    addToWatchHistory(playerState.anime, newSeasonIdx, 0);
    const nextState = {
      ...playerState,
      src: nextSrc,
      subtitle: `${season.name} - Episode ${ep.episodeNumber}`,
      seasonIdx: newSeasonIdx,
      epIdx: 0,
      resumeTime: 0,
      audioTracks: nextAudioTracks,
      subtitleTracks: nextSubtitleTracks,
      qualityOptions: qOpts.length > 0 ? qOpts : undefined,
      selectedLanguage: preferredLanguage,
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
    const matched = scored.filter(s => s.score > 0).map(s => s.anime);
    if (matched.length >= 15) return matched.slice(0, 15);
    // Fill up to 15 with random other items so the row is always full
    const matchedIds = new Set(matched.map(a => a.id));
    const fillers = candidates.filter(a => !matchedIds.has(a.id)).sort(() => Math.random() - 0.5);
    return [...matched, ...fillers].slice(0, 15);
  }, [playerState?.anime, saltPlayerState?.anime, allAnime]);

  const suggestedAnimeImmediate = useMemo(() => suggestedAnime.slice(0, 15), [suggestedAnime]);

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

  const [showLogin, setShowLogin] = useState(false);

  const handleNavigate = useCallback((page: string) => {
    if (page === "profile") {
      if (!isLoggedIn) {
        setShowProfile(false);
        setShowLogin(true);
      } else {
        setShowLogin(false);
        setShowProfile(true);
      }
      return;
    }
    const nextPage = isMainPage(page) ? page : "home";

    // Push real URL so each tab has its own router route (back-button friendly).
    const targetPath = MAIN_PAGE_PATH[nextPage];
    if (window.location.pathname !== targetPath) {
      navigate(targetPath);
    }

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
    setActivePage(nextPage);
    queueStripTransform(nextIdx, 0, true);

    const onDone = () => {
      isSwipeAnimatingRef.current = false;
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
  }, [activePage, showProfile, queueStripTransform, restorePageScroll, isLoggedIn, navigate]);

  // Browser back/forward + direct URL → sync activePage from pathname.
  // Skip while a routed overlay (anime details, watch, search, notifications) is open.
  useEffect(() => {
    if (isRoutedOverlay) return;
    const fromPath = pathToMainPage(pathname);
    if (fromPath && fromPath !== activePage) {
      setActivePage(fromPath);
      setVisualPage(fromPath);
    }
  }, [pathname, isRoutedOverlay, activePage]);

  // Set initial position without animation
  useLayoutEffect(() => {
    if (showProfile) return;
    applyStripTransform(activePageIdx, 0, false);
  }, [activePage, applyStripTransform, activePageIdx, showProfile]);

  useEffect(() => {
    return () => { if (swipeRafRef.current !== null) cancelAnimationFrame(swipeRafRef.current); };
  }, []);

  // Memoized page contents for the horizontal strip



  // Login wall removed — guests browse freely with localStorage-only state.
  // LoginPage now opens as an on-demand overlay (from Header / Profile).

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

          <p className="text-[10px] text-muted-foreground mt-6">{displaySiteName} • Please wait</p>
        </div>
      </div>
    );
  }

  if ((loading || splashHold) && !playerState && !saltPlayerState && !isSearchRoute && !isNotificationsRoute && !isAnimeRoute && !isWatchRoute) {
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
        {filteredSeries.slice(0, tabGridVisibleCount.series).map((anime) => (
          <PosterGridCard key={anime.id} anime={anime} onClick={handleCardClick} />
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
        {filteredMovies.slice(0, tabGridVisibleCount.movies).map((anime) => (
          <PosterGridCard key={anime.id} anime={anime} onClick={handleCardClick} />
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
                <PosterGridCard key={anime.id} anime={anime} onClick={handleCardClick} />
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
                {continueWatching.slice(0, 10).map((item: any) => {
                  const pct = (item.currentTime && item.duration) ? Math.min(100, Math.round((item.currentTime / item.duration) * 100)) : 0;
                  const sn = item.episodeInfo?.season;
                  const ep = item.episodeInfo?.episodeNumber || item.episodeInfo?.episode;
                  const languageLabel = getPrimaryLanguageToken(item.language) || "";
                  const wt = item.watchedAt || item.updatedAt;
                  let agoLabel = "";
                  if (wt) {
                    const d = Date.now() - wt;
                    const m = Math.floor(d / 60000);
                    if (m < 1) agoLabel = "now";
                    else if (m < 60) agoLabel = `${m}m`;
                    else if (m < 1440) agoLabel = `${Math.floor(m / 60)}h`;
                    else agoLabel = `${Math.floor(m / 1440)}d`;
                  }
                  const idStr = String(item.id || "");
                  const isAn = idStr.startsWith("as_") || idStr.startsWith("an_") || item.source === "animesalt" || item.sourceName === "AnimeSalt" || !!item.anSlug || !!item.animeSaltSlug;
                  return (
                    <div key={item.id} onClick={() => handleContinueWatching(item)}
                      className="flex-shrink-0 w-[130px] cursor-pointer">
                      <div data-anime-card="true" className="relative aspect-[2/3] rounded-xl overflow-hidden poster-hover mb-1">
                        <img src={optimizedImageUrl(item.poster, "poster")} alt={item.title} className="poster-img w-full h-full object-cover" loading="eager" decoding="async" />
                        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.25) 45%, transparent 75%)" }} />
                        <span className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider z-10 ${isAn ? "bg-accent/85 text-accent-foreground" : "bg-primary/85 text-primary-foreground"}`}>{isAn ? "AN" : "RS"}</span>
                        {agoLabel && (
                          <span className="absolute top-1.5 left-1.5 bg-black/65 text-white text-[8px] font-semibold px-1.5 py-0.5 rounded z-10">{agoLabel} ago</span>
                        )}
                        {languageLabel && (
                          <span className="absolute right-1.5 top-6 z-10 rounded-md bg-black/70 px-1.5 py-0.5 text-[8px] font-semibold text-white">{languageLabel}</span>
                        )}
                        {pct > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-foreground/25">
                            <div className="h-full bg-primary rounded-r" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        <div className="absolute bottom-1.5 left-1.5 right-1.5">
                          <p className="text-[10px] font-semibold leading-tight line-clamp-2 text-white" style={{ textShadow: "0 2px 6px rgba(0,0,0,0.9)" }}>{item.title}</p>
                          <div className="flex items-center justify-between mt-0.5">
                            {(sn || ep) ? (
                              <p className="text-[8px] text-primary font-bold">
                                {sn ? `S${sn} ` : ""}{ep ? `EP ${ep}` : ""}
                              </p>
                            ) : <span className="text-[8px] text-white/60">Resume</span>}
                            {pct > 0 && <span className="text-[8px] text-white/70 font-semibold">{pct}%</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <NewEpisodeReleases allAnime={allAnime} onCardClick={(anime, seasonIdx, epIdx) => void handlePlay(anime, seasonIdx, epIdx)} />
          {trendingSeries.length > 0 && (
            <AnimeSection title="🔥 Popular Anime" items={trendingSeries.slice(0, 10)} onCardClick={handleCardClick} onViewAll={() => navigate("/series")} />
          )}
          {Object.entries(categoryGroups).map(([cat, items]) => (
            <AnimeSection key={cat} title={cat} items={items.slice(0, 10)} onCardClick={handleCardClick} />
          ))}
          {allAnime.length > 0 && (
            <AnimeSection title="All Anime" items={allAnime.slice(0, 10)} onCardClick={handleCardClick} />
          )}
        </>
      )}
      <footer className="text-center py-8 pb-24 px-4 border-t border-border/30 mt-8">
        <div className="text-2xl font-black text-primary text-glow tracking-wide mb-2">{displaySiteName}</div>
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
      <div className="fixed inset-0 z-[100] bg-black animate-in fade-in zoom-in-95 duration-300 ease-out">
        <VideoPlayer
          src={playerState.src}
          title={playerState.title}
          subtitle={playerState.subtitle}
          poster={playerState.anime.poster}
          anime={playerState.anime}
          onClose={hardCloseToHome}
          qualityOptions={playerState.qualityOptions}
          audioTracks={playerState.audioTracks}
          subtitleTracks={playerState.subtitleTracks}
          animeId={playerState.anime.id}
          initialSeekTime={typeof playerState.resumeTime === "number" ? playerState.resumeTime : undefined}
          currentEpisodeIdx={playerState.epIdx}
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
                  let nextAudioTracks = nextEp.audioTracks;
                  let preferredLanguage = (playerState as any)?.selectedLanguage;
                  if (playerState.anime.source === "animesalt" && String(nextEp.link || "").startsWith("animesalt://")) {
                    const epSlug = String(nextEp.link).replace("animesalt://", "");
                    try {
                      const directState = await getAnimeSaltDirectState(epSlug);
                      if (directState?.src) {
                        nextSrc = directState.src;
                        qOpts = directState.qualityOptions || [];
                        nextAudioTracks = directState.audioTracks;
                        preferredLanguage = directState.preferredLanguage || (nextAudioTracks?.find((t: any) => /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${t.language || ""} ${t.label || ""}`))?.label) || preferredLanguage;
                      }
                    } catch {}
                  }
                  addToWatchHistory(playerState.anime, playerState.seasonIdx, nextIdx);
                  const nextState = {
                    ...playerState,
                    src: nextSrc,
                    subtitle: `${season.name} - Episode ${nextEp.episodeNumber}`,
                    epIdx: nextIdx,
                     resumeTime: 0,
                     audioTracks: nextAudioTracks,
                       selectedLanguage: preferredLanguage,
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
          selectedLanguage={(playerState as any).selectedLanguage || playerState.anime.baseLanguage || playerState.anime.language}
          onLanguageChange={async (label) => {
            const anime = playerState.anime;
            const resolvedLabel = resolvePlayableLanguage(anime, label);
            const newSeasons = resolveAnimeSeasonsForLanguage(anime, resolvedLabel);
            if (!newSeasons || newSeasons.length === 0) return;
            const seasonIdx = Math.min(playerState.seasonIdx ?? 0, newSeasons.length - 1);
            const epIdx = Math.min(playerState.epIdx ?? 0, (newSeasons[seasonIdx]?.episodes?.length || 1) - 1);
            const ep = newSeasons[seasonIdx]?.episodes?.[epIdx];
            if (!ep) return;
            let nextSrc = getEpisodeSrc(ep);
            let qOpts = getEpisodeQualityOptions(ep);
            let nextAudioTracks = ep.audioTracks || anime.audioTracks;

            if (anime.source === "animesalt" && String(ep.link || "").startsWith("animesalt://")) {
              const epSlug = String(ep.link).replace("animesalt://", "");
              try {
                const directState = await getAnimeSaltDirectState(epSlug);
                if (directState?.src) {
                  nextSrc = directState.src;
                  qOpts = directState.qualityOptions || [];
                  nextAudioTracks = directState.audioTracks;
                }
              } catch {}
            }

            const newAnime = { ...anime, seasons: newSeasons, baseLanguage: resolvedLabel, language: resolvedLabel };
            const nextState = {
              ...playerState,
              anime: newAnime,
              src: nextSrc,
              subtitle: `${newSeasons[seasonIdx].name} - Episode ${ep.episodeNumber}`,
              seasonIdx,
              epIdx,
              resumeTime: 0,
              audioTracks: nextAudioTracks,
              qualityOptions: qOpts.length > 0 ? qOpts : undefined,
              selectedLanguage: resolvedLabel,
            } as any;
            playerStateRef.current = nextState;
            setPlayerState(nextState);
          }}
          onSuggestedClick={(anime) => {
            // In-place suggestion switch: keep VideoPlayer mounted so the new
            // anime's source slides in without a player close/reopen flash.
            keepPlayerAliveRef.current = true;
            inPlayerSwitchRef.current = true;
            navigate(buildWatchRoute(anime.id), { replace: true });
            void (async () => {
              try { await handleCardClick(anime); }
              finally {
                // Re-enable normal teardown shortly after the new src is loaded.
                window.setTimeout(() => {
                  keepPlayerAliveRef.current = false;
                  inPlayerSwitchRef.current = false;
                }, 400);
              }
            })();
          }}
          nextEpisodeSrc={playerState.nextEpisodeSrc}
          forceEmbedMode={playerState.anime.source === "animesalt" && !isDirectMediaPlaybackUrl(playerState.src)}
          noServerSwitch={playerState.anime.source === "animesalt"}
          shareLink={buildShareLink(playerState.anime.id, playerState.seasonIdx, playerState.epIdx)}
          buildShareLinkForEpisode={(seasonIdx, epIdx) => buildShareLink(playerState.anime.id, seasonIdx, epIdx)}
          onLibraryClick={(animeId) => {
            if (!animeId) return;
            const targetAnime = allAnime.find((item) => item.id === animeId);
            if (!targetAnime) return;
            keepPlayerAliveRef.current = true;
            inPlayerSwitchRef.current = true;
            navigate(buildWatchRoute(targetAnime.id), { replace: true });
            void (async () => {
              try { await handleCardClick(targetAnime); }
              finally {
                window.setTimeout(() => {
                  keepPlayerAliveRef.current = false;
                  inPlayerSwitchRef.current = false;
                }, 400);
              }
            })();
          }}
          suggestedAnime={suggestedAnimeImmediate}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" style={customBgImage ? { backgroundImage: `url(${customBgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
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
          {MAIN_PAGE_ORDER.map((page, idx) => {
            // Idle: only current tab is mounted. During a tab slide, mount only
            // the pages crossed by the animation so there is no black gap.
            const visualIdx = MAIN_PAGE_ORDER.indexOf(visualPage);
            const shouldRender = idx >= Math.min(activePageIdx, visualIdx) && idx <= Math.max(activePageIdx, visualIdx);
            return (
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
                WebkitOverflowScrolling: "touch",
                contain: page === activePage ? "none" : "layout paint style",
              }}
            >
              {shouldRender && page === "home" && getPageContent_home()}
              {shouldRender && page === "series" && getPageContent_series()}
              {shouldRender && page === "livetv" && <LiveTvPage isActive={activePage === "livetv"} onExitPlayer={() => navigate("/")} />}
              {shouldRender && page === "movies" && getPageContent_movies()}
            </div>
            );
          })}
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
          <ProfilePage onClose={() => setShowProfile(false)} allAnime={allAnime} onCardClick={handleCardClick} onContinueWatching={handleContinueWatching} onLogout={handleLogout} onLoginClick={() => setShowLogin(true)} />
        )}
      </AnimatePresence>

      {/* On-demand login overlay (no more login wall on first visit) */}
      {showLogin && (
        <div className="fixed inset-0 z-[400]">
          <LoginPage
            onLogin={(uid) => { handleLogin(uid); setShowLogin(false); }}
            onGuest={() => setShowLogin(false)}
          />
          <button
            onClick={() => setShowLogin(false)}
            aria-label="Close"
            className="fixed top-4 right-4 z-[410] w-10 h-10 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/80 transition"
          >
            ✕
          </button>
        </div>
      )}

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
          shareLink: `${window.location.origin}/anime/${encodeURIComponent(a.id)}`,
          seasonCount: a.seasons?.length,
          episodeCount: a.seasons?.reduce((sum, s) => sum + (s.episodes?.length || 0), 0),
        }))}
      />

    </div>
  );
};

export default Index;
