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
  if (seasonIdx !== undefined) params.set("s", String(seasonIdx + 1));
  if (epIdx !== undefined) params.set("e", String(epIdx + 1));
  const qs = params.toString();
  return `${window.location.origin}/watch/${encodeURIComponent(animeId)}${qs ? `?${qs}` : ""}`;
};

const parseWatchRouteIndices = (search: string) => {
  const params = new URLSearchParams(search);
  const sRaw = params.get("s");
  const eRaw = params.get("e") ?? params.get("ep");
  const legacyZeroBased = sRaw !== null && Number(sRaw) <= 0;
  const parseIdx = (raw: string | null, legacy = false) => {
    if (raw === null) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    if (legacy) return Math.max(0, Math.floor(n));
    return Math.max(0, Math.floor(n) - 1);
  };
  return {
    seasonIdx: parseIdx(sRaw, legacyZeroBased),
    epIdx: parseIdx(eRaw, legacyZeroBased),
  };
};

const isAnimeSaltRouteItem = (anime?: AnimeItem | null) => !!anime && (
  anime.source === "animesalt"
  || String(anime.id || "").startsWith("as_")
  || String(anime.id || "").startsWith("an_")
  || String(anime.id || "").startsWith("an_mv_")
  || !!anime.anSlug
  || !!anime.animeSaltSlug
);

const AN_AUDIO_LANGUAGE_PREF_KEY = "rs_an_audio_language_pref";

const getSavedAnAudioLanguagePref = () => {
  try { return localStorage.getItem(AN_AUDIO_LANGUAGE_PREF_KEY) || ""; } catch { return ""; }
};

const isInvalidPlaybackUrl = (url?: string | null) => {
  const normalized = String(url || "").trim().toLowerCase().split("?")[0].split("#")[0];
  if (!normalized) return true;
  if (/\.key$/i.test(normalized) || /(?:^|[?&])key=/i.test(String(url || ""))) return true;
  return /\.(avif|gif|jpe?g|png|svg|webp|bmp)$/i.test(normalized);
};

const isDirectMediaPlaybackUrl = (url?: string | null) => {
  const normalized = String(url || "").trim().toLowerCase();
  // AnimeSalt native playback builds a synthetic HLS master as a data: URL.
  // This is still direct media for hls.js; treating it as non-media forces the
  // broken iframe path and makes AN appear fully blocked.
  if (normalized.startsWith("data:application/vnd.apple.mpegurl")) return true;
  if (normalized.includes("/hls/")) return true;
  return /\.(m3u8|mp4|webm|ogg|mov|mkv)(?:[?#].*)?$/.test(normalized);
};

const buildAnHlsPlaybackUrl = (url: string) => wrapAnHlsPlaybackUrl(url);

const isAnPlayableHlsUrl = (url?: string | null) => {
  const raw = String(url || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (/\.key(?:[?#]|$)/i.test(lower) || /(?:^|[?&])key=/.test(lower) || /\b(encryption|license)\b/.test(lower)) return false;
  if (/\.(?:ts|m4s|mp4|js|css|json|jpe?g|png|webp|gif|svg|ico)(?:[?#]|$)/i.test(lower)) return false;
  return lower.startsWith("data:application/vnd.apple.mpegurl")
    || /\/hls\//i.test(lower)
    || /\.m3u8(?:[?#].*)?$/i.test(lower)
    || /\/hls\/[^?#]+\.m3u8(?:[?#].*)?$/i.test(lower);
};

const getAnAudioUrlFromTrack = (track: any) => {
  const link = String(track?.link || "").trim();
  return String(track?.rawAudioUrl || track?.audioUrl || track?.uri || track?.url || (link.startsWith("data:") ? "" : link) || "").trim();
};

const buildAnAudioHlsPlaybackUrl = (url: string) => {
  return buildAnHlsPlaybackUrl(url);
};

// AN default audio policy: Hindi ALWAYS wins when present (overrides Japanese
// or any other language marked default upstream). Falls back to the first
// available track only when no Hindi track exists.
const isHindiAnTrack = (t: any) =>
  /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${t?.language || ""} ${t?.name || ""} ${t?.label || ""}`);
const pickAnDefaultAudioIdx = (audio: Array<{ language?: string; name?: string; uri?: string; isDefault?: boolean }>) => {
  const hindi = audio.findIndex(isHindiAnTrack);
  if (hindi >= 0) return hindi;
  const explicit = audio.findIndex((t) => t?.isDefault === true);
  if (explicit >= 0) return explicit;
  return 0;
};

const pickAnPreferredQualityIdx = (streams: Array<{ height?: number }>) => {
  const preferred = streams.findIndex((x) => Number(x?.height) === 1080);
  const fallback = streams.findIndex((x) => Number(x?.height) >= 720);
  return preferred >= 0 ? preferred : (fallback >= 0 ? fallback : 0);
};

const buildAnSyntheticMaster = (
  stream: { url: string; bandwidth?: number; resolution?: string; height?: number; codecs?: string },
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
  audio: Array<{ language?: string; name?: string; uri?: string; isDefault?: boolean }> | undefined,
  streams: Array<{ label?: string; url?: string; height?: number }> | undefined,
) => {
  if (!Array.isArray(audio) || audio.length === 0) return undefined;

  const qualityMap = new Map<string, string>();
  (streams || []).forEach((stream) => {
    const label = String(stream?.label || "").trim().toLowerCase();
    const url = String(stream?.url || "").trim();
    if (!label || !isAnPlayableHlsUrl(url)) return;
    qualityMap.set(label, url);
  });

  const seen = new Set<string>();
  const list = audio
    .map((track, trackIndex) => {
      const rawLabel = String(track?.name || track?.language || "Audio").trim();
      const rawLang = String(track?.language || rawLabel).trim();
      const normalized = normalizeLanguageName(rawLang) || normalizeLanguageName(rawLabel) || rawLabel;
      const key = normalized.toLowerCase();
      if (seen.has(key)) return null;
      const uri = String(track?.uri || "").trim();
      if (!isAnPlayableHlsUrl(uri)) return null;
      seen.add(key);
      return {
        language: normalized,
        label: normalized,
        // This is the raw audio HLS URL shown/saved in Admin. Runtime playback
        // uses buildAnSyntheticMaster() on the selected video quality so video
        // and audio are mounted together as one HLS master.
        link: buildAnAudioHlsPlaybackUrl(uri),
        audioUrl: buildAnAudioHlsPlaybackUrl(uri),
        rawAudioUrl: uri,
        isDefault: track?.isDefault === true,
      };
    })
    .filter(Boolean) as { language: string; label: string; link: string; audioUrl?: string; rawAudioUrl?: string; isDefault?: boolean }[];
  if (list.length) {
    // Always force Hindi as the default when present.
    const hindi = list.findIndex((t) => /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${t.language} ${t.label}`));
    const targetIdx = hindi >= 0 ? hindi : Math.max(0, list.findIndex((t) => t.isDefault));
    list.forEach((t, i) => { t.isDefault = i === targetIdx; });
  }
  return list;
};

// Helper: get best available src from episode (fallback if default link is empty)
const getEpisodeSrc = (ep?: Episode | null): string => {
  if (!ep) return "";
  return [ep.link, ep.link1080, ep.link720, ep.link480, ep.link4k].find((url) => !isInvalidPlaybackUrl(url)) || "";
};

const getMovieSrc = (anime: AnimeItem): string => {
  return [anime.movieLink, anime.movieLink1080, anime.movieLink720, anime.movieLink480, anime.movieLink4k].find((url) => !isInvalidPlaybackUrl(url)) || "";
};

const hasMovieParts = (anime: AnimeItem): boolean =>
  anime.type === "movie" && Array.isArray(anime.parts) && anime.parts.length > 0;

const getMoviePartSrc = (part: any): string =>
  [part?.link, part?.link1080, part?.link720, part?.link480, part?.link4k].find((url) => !isInvalidPlaybackUrl(url)) || "";

const getMoviePartQualityOptions = (part: any): { label: string; src: string }[] => {
  const q: { label: string; src: string }[] = [];
  if (!isInvalidPlaybackUrl(part?.link480)) q.push({ label: "480p", src: part.link480 });
  if (!isInvalidPlaybackUrl(part?.link720)) q.push({ label: "720p", src: part.link720 });
  if (!isInvalidPlaybackUrl(part?.link1080)) q.push({ label: "1080p", src: part.link1080 });
  if (!isInvalidPlaybackUrl(part?.link4k)) q.push({ label: "4K", src: part.link4k });
  return q;
};

const routeItemLoadCache = new Map<string, Promise<AnimeItem | null>>();

const loadFirebaseAnimeItemByRouteId = async (routeId: string): Promise<AnimeItem | null> => {
  const id = String(routeId || "").trim();
  if (!id || id.startsWith("as_") || id.startsWith("an_") || id.startsWith("an_mv_")) return null;
  const cached = routeItemLoadCache.get(id);
  if (cached) return cached;

  const request = (async () => {
    for (const collection of ["webseries", "movies"] as const) {
      try {
        const snap = await get(ref(db, `${collection}/${id}`));
        const row = snap.val();
        if (!row || row.visibility === "private") continue;
        return collection === "movies"
          ? mapFirebaseMovieItem(id, row, { full: true })
          : mapFirebaseWebseriesItem(id, row, { full: true });
      } catch {}
    }
    return null;
  })();

  routeItemLoadCache.set(id, request);
  request.finally(() => routeItemLoadCache.delete(id));
  return request;
};

// Convert an AN movie row into the same shape buildAnimeSaltEpisodePlaybackFromFirebase
// expects, so we get a synthetic HLS master that mounts video + Hindi audio together.
const movieToAnEpisode = (anime: AnimeItem): Episode => ({
  episodeNumber: 1,
  title: anime.title || "Movie",
  link: anime.movieLink || "",
  link480: anime.movieLink480 || undefined,
  link720: anime.movieLink720 || undefined,
  link1080: anime.movieLink1080 || anime.movieLink || undefined,
  link4k: anime.movieLink4k || undefined,
  audioTracks: anime.audioTracks as any,
});

const isAnMovie = (anime: AnimeItem) =>
  anime?.type === "movie" && (anime?.source === "animesalt" || anime?.sourceName === "AnimeSalt" || !!anime?.anSlug || !!anime?.animeSaltSlug);

const buildAnMoviePlayback = (anime: AnimeItem) => {
  if (!isAnMovie(anime)) return null;
  return buildAnimeSaltEpisodePlaybackFromFirebase(movieToAnEpisode(anime));
};

const hasStoredFirebasePlayback = (anime: AnimeItem): boolean => {
  if (getMovieSrc(anime)) return true;
  if (hasMovieParts(anime) && anime.parts?.some((part) => !!getMoviePartSrc(part))) return true;
  const seasons = resolveAnimeSeasonsForLanguage(anime, anime.baseLanguage || anime.language);
  return !!seasons?.some((season) => season?.episodes?.some((ep) => !!getEpisodeSrc(ep as Episode)));
};

const fullFirebaseItemLoadCache = new Map<string, Promise<AnimeItem | null>>();

const loadFullFirebaseAnimeItem = async (anime: AnimeItem, opts: { forceFresh?: boolean } = {}): Promise<AnimeItem | null> => {
  const collection = anime.type === "movie" ? "movies" : "webseries";
  const candidates = Array.from(new Set([
    anime.id,
    anime.type === "movie" && anime.anSlug ? `an_mv_${sanitizeFirebaseKey(anime.anSlug)}` : "",
    anime.type === "movie" && anime.animeSaltSlug ? `an_mv_${sanitizeFirebaseKey(anime.animeSaltSlug)}` : "",
    anime.type === "webseries" && anime.anSlug ? `an_${sanitizeFirebaseKey(anime.anSlug)}` : "",
    anime.type === "webseries" && anime.animeSaltSlug ? `an_${sanitizeFirebaseKey(anime.animeSaltSlug)}` : "",
  ].filter(Boolean)));
  const cacheId = candidates[0] || anime.id;
  const cached = opts.forceFresh ? null : readFullFirebaseItemCache(anime.type, cacheId);
  if (cached) return { ...anime, ...cached, id: cached.id || anime.id };

  const loadKey = `${opts.forceFresh ? "fresh" : "cached"}:${collection}:${candidates.join("|")}`;
  const pending = fullFirebaseItemLoadCache.get(loadKey);
  if (pending) return pending;

  const request = (async () => {
    for (const id of candidates) {
      try {
        const snap = await get(ref(db, `${collection}/${id}`));
        const row = snap.val();
        if (!row || row.visibility === "private") continue;
        const mapped = anime.type === "movie"
          ? mapFirebaseMovieItem(id, row, { full: true })
          : mapFirebaseWebseriesItem(id, row, { full: true });
        writeFullFirebaseItemCache(anime.type, id, mapped);
        return { ...anime, ...mapped, id: mapped.id || anime.id };
      } catch {}
    }
    return null;
  })();
  fullFirebaseItemLoadCache.set(loadKey, request);
  request.finally(() => fullFirebaseItemLoadCache.delete(loadKey));
  return request;
};

const loadAnimeSaltPremiumMeta = async (anime: AnimeItem): Promise<Partial<AnimeItem> | null> => {
  const slug = anime.anSlug || anime.animeSaltSlug || anime.slug || String(anime.id || "").replace(/^an_mv_|^an_|^as_mv_|^as_/, "");
  if (!slug) return null;
  try {
    const snap = await get(ref(db, `animesaltSelected/${slug}`));
    const row = snap.val();
    if (!row) return null;
    return {
      premium: !!row.premium,
      premiumEpisodes: row.premiumEpisodes || {},
      dubType: row.dubType || anime.dubType,
    } as Partial<AnimeItem>;
  } catch {
    return null;
  }
};

const loadFullFirebaseAnimeItemWithTimeout = async (anime: AnimeItem, timeoutMs = 1400, opts: { forceFresh?: boolean } = {}): Promise<AnimeItem | null> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      loadFullFirebaseAnimeItem(anime, opts),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const getMovieQualityOptions = (anime: AnimeItem): { label: string; src: string }[] => {
  // AN movies must wrap their video-only HLS variants together with the Hindi
  // audio track via a synthetic master. Raw HLS variant URLs play silent video.
  if (isAnMovie(anime) && (anime.audioTracks?.length || 0) > 0) {
    const built = buildAnMoviePlayback(anime);
    if (built?.qualityOptions?.length) {
      return built.qualityOptions.map((q) => ({ label: q.label, src: q.src }));
    }
  }
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

const buildAnimeSaltEpisodePlaybackFromFirebase = (ep?: Episode | null) => {
  if (!ep) return null;
  const metaByUrl = new Map<string, any>();
  const metaList = Array.isArray((ep as any).anStreamMeta) ? (ep as any).anStreamMeta : [];
  metaList.forEach((stream: any) => {
    const url = String(stream?.url || "").trim();
    if (url) metaByUrl.set(url, stream);
  });
  const pushStream = (list: any[], label: string, url?: string | null, height?: number) => {
    const clean = String(url || "").trim();
    if (!isAnPlayableHlsUrl(clean)) return;
    if (list.some((item) => item.url === clean)) return;
    const meta = metaByUrl.get(clean) || {};
    list.push({ label: meta.label || label, url: clean, height: Number(meta.height || height || 0) || height, resolution: meta.resolution, bandwidth: meta.bandwidth, codecs: meta.codecs });
  };

  const streams: any[] = [];
  pushStream(streams, "480p", ep.link480, 480);
  pushStream(streams, "720p", ep.link720, 720);
  pushStream(streams, "1080p", ep.link1080 || ep.link, 1080);
  pushStream(streams, "4K", ep.link4k, 2160);
  pushStream(streams, "Auto", ep.link, Number(String(ep.link || "").match(/(480|720|1080|2160)/)?.[1]) || undefined);
  if (streams.length === 0) return null;

  const audio = (Array.isArray((ep as any).audioTracks) ? (ep as any).audioTracks : [])
    .map((track: any, index: number) => {
      const uri = getAnAudioUrlFromTrack(track);
      if (!isAnPlayableHlsUrl(uri)) return null;
      const label = String(track?.label || track?.language || `Audio ${index + 1}`).trim();
      return {
        language: String(track?.language || label).trim(),
        name: label,
        uri,
        isDefault: track?.isDefault === true,
      };
    })
    .filter(Boolean) as Array<{ language?: string; name?: string; uri?: string }>;

  const defaultAudioIdx = pickAnDefaultAudioIdx(audio);
  const qualityOptions = streams.map((stream) => ({
    label: stream.label,
    height: stream.height,
    src: buildAnSyntheticMaster(stream, audio, defaultAudioIdx),
  }));
  // Start AN on 720p when available. 1080p remains selectable, but opening on
  // 720p fills buffer much faster on preview/mobile networks and avoids stalls.
  const preferred = qualityOptions.find((option) => Number(option.height) === 720)
    || qualityOptions.find((option) => Number(option.height) === 1080)
    || qualityOptions[0];
  const normalizedAudio = normalizeAnAudioTracks(audio, streams) || (ep as any).audioTracks;
  const defaultAudio = (normalizedAudio || []).find((track: any) => track?.isDefault) || normalizedAudio?.[0];
  return {
    src: preferred?.src || buildAnHlsPlaybackUrl(streams[0].url),
    qualityOptions,
    audioTracks: normalizedAudio,
    preferredLanguage: defaultAudio?.label || defaultAudio?.language,
  };
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
  const hasEpisodes = (seasons: any) => Array.isArray(seasons) && seasons.some((season: any) => Array.isArray(season?.episodes) && season.episodes.length > 0);
  if (byLanguage) {
    const entries = Object.entries(byLanguage);
    const exact = requested
      ? entries.find(([lang]) => String(lang || "").trim().toLowerCase() === requested)?.[1]
      : undefined;
    if (hasEpisodes(exact)) return exact;
    const fallbackLanguage = String(anime.baseLanguage || anime.language || "").trim().toLowerCase();
    const fallback = entries.find(([lang]) => String(lang || "").trim().toLowerCase() === fallbackLanguage)?.[1];
    if (hasEpisodes(fallback)) return fallback;
    const hindi = entries.find(([lang]) => /hindi|हिन्दी|हिंदी|hin/i.test(String(lang || "")))?.[1];
    if (hasEpisodes(hindi)) return hindi;
    const firstPlayable = entries.map(([, seasons]) => seasons).find(hasEpisodes);
    if (firstPlayable) return firstPlayable as Season[];
    // Nothing has episodes in the language map — fall back to any season list
    // (top-level first, then the first non-empty entry) so the episode panel
    // never disappears just because "Hindi" is missing.
    if (Array.isArray(anime.seasons) && anime.seasons.length > 0) return anime.seasons;
    const firstAny = entries.map(([, seasons]) => seasons).find((s) => Array.isArray(s) && s.length > 0);
    if (firstAny) return firstAny as Season[];
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
    // No episode carries a resolvable src yet (AN sentinels, pending links…).
    // Still prefer a language that actually has episodes over the stored base.
    const firstWithEpisodes = normalizedEntries.find((entry) => entry.seasons?.some((s) => (s?.episodes?.length || 0) > 0));
    if (firstWithEpisodes) return firstWithEpisodes.label;
  }

  return normalizedPreferred || normalizeLanguageName(anime.baseLanguage || anime.language) || normalizeLanguageName(anime.language) || "";

};
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import TelegramWelcomeModal from "@/components/TelegramWelcomeModal";
import HeroSlider from "@/components/HeroSlider";
import CategoryPills from "@/components/CategoryPills";
import AnimeSection from "@/components/AnimeSection";
import VideoPlayer, { normalizeLanguageName } from "@/components/VideoPlayer";
import ProfilePage from "@/components/ProfilePage";
import SearchPage from "@/components/SearchPage";
import NewEpisodeReleases from "@/components/NewEpisodeReleases";
import LoginPage from "@/components/LoginPage";
import { useFirebaseData } from "@/hooks/useFirebaseData";
import { useSelectedAnimeSalt } from "@/hooks/useSelectedAnimeSalt";
import {
  resolveAnEpisodePlayback,
  resolveAnMoviePlayback,
  resolveAnSeriesSeasons,
  warmAnSeriesPlaybackCache,
  isAnimeSaltSentinel,
  slugFromSentinel,
} from "@/lib/anLivePlayback";
import LiveSupportChat from "@/components/LiveSupportChat";
import LoadingDetailsOverlay from "@/components/LoadingDetailsOverlay";
import LiveTvPage from "@/components/LiveTvPage";
import { initializeUiTheme } from "@/lib/uiTheme";
import { useBranding } from "@/hooks/useBranding";
import { guestStore } from "@/lib/guestStore";
import { clearActiveDisplayName, clearActiveProfilePhoto, writeDisplayName, writeProfilePhoto } from "@/lib/localUser";
import { optimizedImageUrl } from "@/lib/imageCache";
import { mapFirebaseMovieItem, mapFirebaseWebseriesItem } from "@/lib/firebaseAnimeMapper";
import { isLegacyAnEntry } from "@/lib/legacyAn";
import { contentCategoryLabels, metadataLabelMatches } from "@/lib/contentMetadata";
import { usePremium } from "@/hooks/usePremium";
import { isEpisodeLocked, isSeriesLocked } from "@/lib/premiumAccess";
import { ensureAnPlaybackRouteWatcher, wrapAnHlsPlaybackUrl } from "@/lib/anPlaybackProxy";
import { supabase } from "@/integrations/supabase/client";

const warmedImageUrls = new Set<string>();
const AN_DETAILS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const DETAILS_LOADING_TOAST_ID = "rs-an-details-loading-toast";
const FIREBASE_FULL_ITEM_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

const sanitizeFirebaseKey = (value: string) => String(value || "").replace(/[.#$/\[\]]/g, "_").slice(0, 180);

const fullFirebaseItemCacheKey = (type: AnimeItem["type"], id: string) => `rs_full_item:${type}:${sanitizeFirebaseKey(id)}`;

const readFullFirebaseItemCache = (type: AnimeItem["type"], id: string): AnimeItem | null => {
  try {
    const raw = localStorage.getItem(fullFirebaseItemCacheKey(type, id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || Date.now() - Number(parsed.ts) > FIREBASE_FULL_ITEM_CACHE_TTL) {
      localStorage.removeItem(fullFirebaseItemCacheKey(type, id));
      return null;
    }
    return parsed.data || null;
  } catch { return null; }
};

const writeFullFirebaseItemCache = (type: AnimeItem["type"], id: string, data: AnimeItem) => {
  try { localStorage.setItem(fullFirebaseItemCacheKey(type, id), JSON.stringify({ ts: Date.now(), data })); } catch {}
};

const mergeAnimeCards = (...groups: AnimeItem[][]) => {
  const byKey = new Map<string, AnimeItem>();
  const mergeRich = (base: AnimeItem, incoming: AnimeItem): AnimeItem => ({
    ...base,
    ...incoming,
    seasons: incoming.seasons?.length ? incoming.seasons : base.seasons,
    movieLink: incoming.movieLink || base.movieLink,
    movieLink480: incoming.movieLink480 || base.movieLink480,
    movieLink720: incoming.movieLink720 || base.movieLink720,
    movieLink1080: incoming.movieLink1080 || base.movieLink1080,
    movieLink4k: incoming.movieLink4k || base.movieLink4k,
    audioTracks: incoming.audioTracks?.length ? incoming.audioTracks : base.audioTracks,
    rating: incoming.rating || base.rating,
    year: incoming.year || base.year,
    category: incoming.category || base.category,
    storyline: incoming.storyline || base.storyline,
    overview: incoming.overview || base.overview,
    description: incoming.description || base.description,
    genres: incoming.genres?.length ? incoming.genres : base.genres,
    directors: incoming.directors?.length ? incoming.directors : base.directors,
    cast: incoming.cast?.length ? incoming.cast : base.cast,
    tmdbId: incoming.tmdbId || base.tmdbId,
  });
  const keyFor = (item: AnimeItem) => {
    const slug = String(item.anSlug || item.animeSaltSlug || item.slug || "").trim().toLowerCase();
    if (slug && (item.source === "animesalt" || item.sourceName === "AnimeSalt")) return `${item.type}:an:${slug}`;
    return `${item.type}:id:${item.id}`;
  };
  const score = (item: AnimeItem) =>
    (item.seasons?.length ? 100 : 0)
    + (item.movieLink ? 100 : 0)
    + (item.id.startsWith("an_") || item.id.startsWith("an_mv_") ? 20 : 0)
    + (item.rating ? 12 : 0)
    + (item.year ? 10 : 0)
    + (item.category ? 10 : 0)
    + (item.genres?.length ? 10 : 0)
    + (item.storyline ? 8 : 0)
    + (item.cast?.length ? 8 : 0)
    + (item.directors?.length ? 4 : 0)
    + (item.poster ? 2 : 0)
    + (item.backdrop ? 1 : 0);
  groups.flat().forEach((item) => {
    if (!item?.id) return;
    const key = keyFor(item);
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, item);
    else if (score(item) >= score(prev)) byKey.set(key, mergeRich(prev, item));
    else byKey.set(key, mergeRich(item, prev));
  });
  return Array.from(byKey.values()).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
};

const splitCategoryTokens = (value?: string | null) =>
  String(value || "")
    .split(/[,/|•·]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const splitCategoryLabels = (value?: string | null) => {
  const seen = new Set<string>();
  const labels: string[] = [];
  String(value || "")
    .split(/[,/|•·]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((label) => {
      const key = label.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        labels.push(label);
      }
    });
  return labels;
};

const categoryMatches = (item: AnimeItem, activeCategory: string) => {
  if (activeCategory === "All") return true;
  return contentCategoryLabels(item).some((label) => metadataLabelMatches(label, activeCategory));
};

const normalizeRouteLookup = (value?: string | null) => String(value || "").trim().toLowerCase();

const animeRouteKeys = (item: AnimeItem) => {
  const keys = new Set<string>();
  const add = (value?: string | null) => {
    const key = normalizeRouteLookup(value);
    if (key) keys.add(key);
  };
  const slug = normalizeRouteLookup(item.anSlug || item.animeSaltSlug || item.slug);
  add(item.id);
  add(item.slug);
  add(item.anSlug);
  add(item.animeSaltSlug);
  if (slug) {
    add(`as_${slug}`);
    add(item.type === "movie" ? `an_mv_${slug}` : `an_${slug}`);
  }
  return keys;
};

const matchesAnimeRouteId = (item: AnimeItem, routeId?: string | null) => {
  const normalized = normalizeRouteLookup(routeId);
  return !!normalized && animeRouteKeys(item).has(normalized);
};

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

// Ultra-opt: warm the saved Firebase row on pointerdown for RS/admin content.
// AN playback is API-driven because AnimeSalt HLS links expire; never require
// Admin-saved media URLs for AN cards.
const prefetchAnimePlayback = (anime: AnimeItem, opts?: { forceFresh?: boolean }) => {
  if (!anime) return;
  const isAn = anime.source === "animesalt"
    || String(anime.id || "").startsWith("as_")
    || String(anime.id || "").startsWith("an_")
    || String(anime.id || "").startsWith("an_mv_")
    || !!anime.anSlug
    || !!anime.animeSaltSlug;
  if (isAn) return;
  try { loadFullFirebaseAnimeItem(anime, { forceFresh: !!opts?.forceFresh }); } catch {}
};

const getCardSourceBadge = (anime: AnimeItem | any) => {
  const isAn = anime?.source === "animesalt"
    || String(anime?.id || "").startsWith("as_")
    || String(anime?.id || "").startsWith("an_")
    || /animesalt/i.test(String(anime?.sourceName || ""))
    || !!anime?.anSlug
    || !!anime?.animeSaltSlug
    || String(anime?.displayAs || "").toLowerCase() === "an";
  return isAn ? "AN" : "RS";
};

// Expose so AnimeCard (separate file) can warm too without prop drilling.
if (typeof window !== "undefined") (window as any).__rsPrefetchAnime = prefetchAnimePlayback;

const PosterGridCard = ({ anime, onClick }: { anime: AnimeItem; onClick: (anime: AnimeItem) => void }) => (
  <button key={anime.id} type="button" data-anime-card="true" className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover text-left appearance-none border-0 p-0" onClick={() => onClick(anime)} onPointerDown={() => prefetchAnimePlayback(anime)}>
    <img src={optimizedImageUrl(anime.poster, "poster")} alt={anime.title} className="poster-img w-full h-full object-cover" loading="eager" decoding="async" />
    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.90) 0%, rgba(0,0,0,0.22) 42%, transparent 72%)" }} />
    <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 z-10">
      {anime.year && <span className="gradient-primary px-2 py-0.5 rounded text-[9px] font-bold">{anime.year}</span>}
      {(() => { const badge = getCardSourceBadge(anime); return <span className={`px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider ${badge === "AN" ? "bg-accent/85 text-accent-foreground" : "bg-primary/85 text-primary-foreground"}`}>{badge}</span>; })()}
    </div>
    {(anime as any).dubType === "fandub" && <span className="absolute top-1.5 left-1.5 bg-orange-600 px-1.5 py-0.5 rounded text-[8px] font-bold text-white">FAN</span>}
    <div className="absolute bottom-0 left-0 right-0 p-2">
      <p className="text-[11px] font-semibold leading-tight line-clamp-2 text-white" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}>{anime.title}</p>
      {(anime.rating || anime.year) && (
        <p className="mt-1 text-[8px] text-white/85 flex items-center gap-1" style={{ textShadow: "0 1px 5px rgba(0,0,0,0.9)" }}>
          {anime.rating ? <span>★ {anime.rating}</span> : null}
          {anime.rating && anime.year ? <span className="opacity-50">·</span> : null}
          {anime.year ? <span>{anime.year}</span> : null}
        </p>
      )}
    </div>
  </button>
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
const HOME_CATEGORY_GRID_LIMIT = 60;

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
  const isAnimeRoute = !!animeRouteMatch;
  const isWatchRoute = !!watchRouteMatch;
  const isRoutedOverlay = isSearchRoute || isAnimeRoute || isWatchRoute;
  const animeRouteId = animeRouteMatch?.params.animeId ? decodeURIComponent(animeRouteMatch.params.animeId) : null;
  const watchRouteAnimeId = watchRouteMatch?.params.animeId ? decodeURIComponent(watchRouteMatch.params.animeId) : null;
  const { webseries, movies, allAnime: firebaseAnime, categories, loading } = useFirebaseData();
  const { items: animeSaltItems, loading: saltLoading } = useSelectedAnimeSalt();
  const brandingConfig = useBranding();
  const displaySiteName = brandingConfig.siteName || "RS ANIME";

  useEffect(() => {
    ensureAnPlaybackRouteWatcher();
  }, []);

  // --- Splash hold ---
  // Always show the original splash on a fresh website entry/reload, then
  // release after the first visible assets are warm. Route/page navigation does
  // not remount this component, so the splash still won't interrupt browsing.
  const [splashHold, setSplashHold] = useState<boolean>(() => {
    if (isRoutedOverlay) return false;
    try { if (new URLSearchParams(window.location.search).has("anime")) return false; } catch {}
    try { return sessionStorage.getItem("rs_splash_shown") !== "1"; } catch { return true; }
  });
  const splashAssetTargetsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!splashHold) return;
    let cancelled = false;
    const release = () => {
      if (cancelled) return;
      cancelled = true;
      try { sessionStorage.setItem("rs_splash_shown", "1"); } catch {}
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

  // Strip legacy AN entries stored in Firebase. AN now runs 100% via live API.
  const cleanFirebaseAnime = useMemo(() => firebaseAnime.filter((a) => !isLegacyAnEntry(a)), [firebaseAnime]);
  const cleanWebseries = useMemo(() => webseries.filter((a) => !isLegacyAnEntry(a)), [webseries]);
  const cleanMovies = useMemo(() => movies.filter((a) => !isLegacyAnEntry(a)), [movies]);

  const allAnime = useMemo(() => mergeAnimeCards(cleanFirebaseAnime, activeSaltItems), [cleanFirebaseAnime, activeSaltItems]);

  const allSeries = useMemo(() => {
    return mergeAnimeCards(cleanWebseries, activeSaltItems.filter((item) => item.type === "webseries"));
  }, [cleanWebseries, activeSaltItems]);

  const allMovies = useMemo(() => {
    return mergeAnimeCards(cleanMovies, activeSaltItems.filter((item) => item.type === "movie"));
  }, [cleanMovies, activeSaltItems]);

  // Only admin-defined categories are shown as pills/rails on the homepage.
  // Auto-derived categories from content metadata are intentionally excluded.
  const userCategoryPills = useMemo(() => {
    return (categories || [])
      .map((cat) => String(cat || "").trim())
      .filter(Boolean);
  }, [categories]);

  
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

  // Check if user is logged in/guest (guest accounts also have a profile)
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    try {
      const u = localStorage.getItem("rsanime_user");
      if (!u) return false;
      const parsed = JSON.parse(u);
      return !!parsed.id;
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
    window.addEventListener("rs_auth_changed", syncLoginState);

    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", syncLoginState);
      window.removeEventListener("rs_auth_changed", syncLoginState);
    };
  }, []);

  // Ad-gate state for AnimeSalt player
  const [saltAdGateActive, setSaltAdGateActive] = useState(false);
  const [globalFreeAccess, setGlobalFreeAccess] = useState(false);
  const [saltIsPremium, setSaltIsPremium] = useState<boolean | null>(null);
  const [userFreeAccessExpiresAt, setUserFreeAccessExpiresAt] = useState(0);
  const [freeAccessLoaded, setFreeAccessLoaded] = useState(false);
  const [unlockBlocked, setUnlockBlocked] = useState(false);
  const { isPremium: userIsPremium } = usePremium();

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
    const sIdx = seasonIdx ?? 0;
    const eIdx = epIdx ?? 0;
    const lockMeta = anime?.source === "animesalt" || String(anime?.id || "").startsWith("an_") || String(anime?.id || "").startsWith("as_")
      ? { ...(anime || {}), ...((anime ? await loadAnimeSaltPremiumMeta(anime) : null) || {}) }
      : anime;
    if (lockMeta && (isSeriesLocked(lockMeta as any) || isEpisodeLocked(lockMeta as any, sIdx, eIdx)) && !userIsPremium) {
      navigate(`/premium-required?from=${encodeURIComponent(anime?.id || "")}`);
      return false;
    }

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
  }, [isLoggedIn, unlockBlocked, saltIsPremium, hasFreeAccess, redirectToUnlockRequired, userIsPremium, navigate]);

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
  const [loadingDetails, setLoadingDetails] = useState<{
    open: boolean;
    title?: string;
    poster?: string;
    progress: number;
    step: string;
    completed: string[];
  }>({ open: false, progress: 0, step: "", completed: [] });
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
    if (seasonIdx !== undefined) params.set("s", String(seasonIdx + 1));
    if (epIdx !== undefined) params.set("e", String(epIdx + 1));
    const qs = params.toString();
    return `/watch/${encodeURIComponent(animeId)}${qs ? `?${qs}` : ""}`;
  }, []);
  const getDefaultWatchTarget = useCallback((anime: AnimeItem) => {
    const resolvedLanguage = resolvePlayableLanguage(anime, anime.baseLanguage || anime.language);
    const resolvedSeasons = resolveAnimeSeasonsForLanguage(anime, resolvedLanguage);
    if (anime.type === "webseries" && resolvedSeasons?.length) {
      // Some admin-entered titles have empty links on the very first episode
      // (e.g. EP1 not uploaded yet). Landing on it makes the card look dead,
      // so default to the first episode that actually has a playable source.
      const hasPlayable = (ep: any): boolean => {
        if (!ep) return false;
        const direct = [ep.link, ep.link480, ep.link720, ep.link1080, ep.link4k];
        const quality = Object.values((ep.qualityLinks || {}) as Record<string, unknown>);
        const audio = (ep.audioTracks || []).flatMap((t: any) => [t?.link, t?.link480, t?.link720, t?.link1080, t?.link4k, t?.audioUrl]);
        return [...direct, ...quality, ...audio].some((v) => typeof v === "string" && v.trim().length > 0);
      };
      for (let s = 0; s < resolvedSeasons.length; s += 1) {
        const eps = resolvedSeasons[s]?.episodes || [];
        for (let e = 0; e < eps.length; e += 1) {
          if (hasPlayable(eps[e])) return { seasonIdx: s, epIdx: e };
        }
      }
      return { seasonIdx: 0, epIdx: 0 };
    }
    if (hasMovieParts(anime)) {
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
  const cleanupPlaybackAfterUnmount = useCallback(() => {
    window.requestAnimationFrame(() => window.setTimeout(stopAllPlayback, 0));
  }, [stopAllPlayback]);

  const hardCloseToHome = useCallback(() => {
    setPlayerState(null);
    setSaltPlayerState(null);
    setSelectedAnime(null);
    setShowProfile(false);
    setCustomPostDetail(null);
    navigate("/", { replace: true });
    cleanupPlaybackAfterUnmount();
  }, [cleanupPlaybackAfterUnmount, navigate]);
  const closeRouteLayer = useCallback((fallback: string = "/") => {
    if (window.history.length > 1) navigate(-1);
    else navigate(fallback, { replace: true });
    cleanupPlaybackAfterUnmount();
  }, [cleanupPlaybackAfterUnmount, navigate]);

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
          const idStr = String(i.id || "");
          if (idStr.startsWith('as_') || idStr.startsWith('an_')) return true;
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
  // Push notifications fully removed from the app.
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
    // Routed pages (/search, watch/details) own their own history entry — do NOT
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

    const isSaltLink = pendingAnimeId.startsWith("as_");
    if (isSaltLink && saltLoading) return; // wait for AN data

    // Deep-link from Telegram / share URLs: read ?s= and ?e= so we open
    // the player DIRECTLY at the requested episode instead of bouncing
    // through the details page (kills the 10-15s perceived latency).
    const { seasonIdx: deepSIdx, epIdx: deepEIdx } = parseWatchRouteIndices(window.location.search);

    const found = allAnime.find((a) => a.id === pendingAnimeId);
    if (found) {
      const capturedId = pendingAnimeId;
      if (!isSaltLink) {
        (async () => {
          const full = await loadFirebaseAnimeItemByRouteId(capturedId);
          await handleCardClick(full || found, deepSIdx, deepEIdx);
          setPendingAnimeId((current) => (current === capturedId ? null : current));
        })();
        return;
      }
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
      setPendingAnimeId(null);
      return;
    }

    const capturedId = pendingAnimeId;
    (async () => {
      const mapped = await loadFirebaseAnimeItemByRouteId(capturedId);
      if (mapped) await handleCardClick(mapped, deepSIdx, deepEIdx);
      setPendingAnimeId((current) => (current === capturedId ? null : current));
    })();
  }, [pendingAnimeId, allAnime, pathname, navigate, buildAnimeRoute, saltLoading, loading]);

  // LIVE sync: whenever an RS anime is open (details or player), subscribe to
  // its Firebase node so admin-side edits (new episode, status flip, poster
  // swap) reflect in the user UI within ~1 second instead of waiting for the
  // shallow index to refresh on the next page load.
  const liveAnimeId = playerState?.anime?.id || selectedAnime?.id || null;
  useEffect(() => {
    if (!liveAnimeId) return;
    // Skip AN/AnimeSalt — they hydrate via their own live API path.
    if (liveAnimeId.startsWith("as_") || liveAnimeId.startsWith("an_")) return;
    let cancelled = false;
    const tryPath = (collection: "webseries" | "movies") => {
      const nodeRef = ref(db, `${collection}/${liveAnimeId}`);
      return onValue(nodeRef, (snap) => {
        if (cancelled) return;
        const row = snap.val();
        if (!row) return;
        const mapped = collection === "movies"
          ? mapFirebaseMovieItem(liveAnimeId, row, { full: true })
          : mapFirebaseWebseriesItem(liveAnimeId, row, { full: true });
        setSelectedAnime((prev) => (prev && prev.id === liveAnimeId ? { ...prev, ...mapped } : prev));
        setPlayerState((prev) => (prev && prev.anime?.id === liveAnimeId
          ? { ...prev, anime: { ...prev.anime, ...mapped } }
          : prev));
      });
    };
    const activeItem = playerState?.anime || selectedAnime;
    const collection = activeItem?.type === "movie" ? "movies" : "webseries";
    const unsubscribe = tryPath(collection);
    return () => {
      cancelled = true;
      try { unsubscribe(); } catch {}
    };
  }, [liveAnimeId, playerState?.anime?.type, selectedAnime?.type]);

  const filteredAnime = useMemo(() => {
    // Home/category screens are series-first only. Movies live in the dedicated
    // Movies tab plus the single "Most Favorite Movies" rail on Home.
    if (activeCategory !== "All") return allSeries.filter(a => categoryMatches(a, activeCategory));
    return allSeries;
  }, [activeCategory, allSeries]);

  // Live popularity signals from analytics — used to rank Trending content
  const [analyticsTotals, setAnalyticsTotals] = useState<Record<string, any>>({});
  const [analyticsClicks, setAnalyticsClicks] = useState<Record<string, any>>({});
  useEffect(() => {
    const unsubT = onValue(ref(db, "analytics/totals/views"), (snap) => setAnalyticsTotals(snap.val() || {}));
    const unsubC = onValue(ref(db, "analytics/totals/clicks"), (snap) => setAnalyticsClicks(snap.val() || {}));
    return () => { unsubT(); unsubC(); };
  }, []);

  const getViewCount = useCallback((id: string): number => {
    // Prefer all-time totals counter (never reset)
    const t = analyticsTotals[id];
    let totalViews = 0;
    if (t) {
      if (typeof t === "number") totalViews = t;
      else if (typeof t === "object" && typeof t.count === "number") totalViews = t.count;
    }
    return totalViews;
  }, [analyticsTotals]);

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
    let list = activeCategory !== "All" ? allSeries.filter(a => categoryMatches(a, activeCategory)) : allSeries;
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
    let list = activeCategory !== "All" ? allSeries.filter(a => categoryMatches(a, activeCategory)) : allSeries;
    if (dubFilter !== "all") list = list.filter(a => (a.dubType || "official") === dubFilter);
    return [...list].sort((a, b) => {
      return ((b as any).updatedAt || (b as any).createdAt || 0) - ((a as any).updatedAt || (a as any).createdAt || 0);
    });
  }, [activeCategory, allSeries, dubFilter]);

  const filteredMovies = useMemo(() => {
    let list = activeCategory !== "All" ? allMovies.filter(a => categoryMatches(a, activeCategory)) : allMovies;
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

  // Hourly refresh tick: rotates content so every anime cycles through the homepage
  // rails over time. Bumped every 60 minutes.
  const [homeRefreshTick, setHomeRefreshTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setHomeRefreshTick((x) => x + 1), 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Group content by admin-defined categories.
  // Rule: an anime appears in ONLY ONE rail — the first admin category that
  // matches its own primary metadata label. Sparse rails get backfilled from
  // the AN live pool (matching the rail's category first, then any AN item)
  // and finally from any pool item, so no rail ever looks empty.
  const categoryGroups = useMemo(() => {
    const MIN_SLOTS = 6;
    const MAX_SLOTS = 10;
    const adminCats = (categories || []).map((c) => String(c || "").trim()).filter(Boolean);
    if (!adminCats.length) return [] as { key: string; title: string; items: AnimeItem[] }[];

    const rotate = <T,>(arr: T[], n: number): T[] => {
      if (!arr.length) return arr;
      const off = ((n % arr.length) + arr.length) % arr.length;
      return off === 0 ? arr : [...arr.slice(off), ...arr.slice(0, off)];
    };

    // Category rails show ONLY series (RS + AN). Movies are shown solely in
    // the dedicated "Most Favorite Movies" rail — never inside category rails.
    const pool = filteredSeries.filter((a) => a.type !== "movie");
    const rotatedPool = rotate(pool, homeRefreshTick * 3);
    const rotatedAn = rotate(activeSaltItems.filter((a) => a.type !== "movie"), homeRefreshTick * 5);

    // Pick each anime's ONE primary admin category based on its first-listed
    // matching metadata label.
    const primaryFor = new Map<string, string>();
    rotatedPool.forEach((a) => {
      const labels = contentCategoryLabels(a);
      let chosen: string | null = null;
      for (const label of labels) {
        const match = adminCats.find((cat) => metadataLabelMatches(label, cat));
        if (match) { chosen = match; break; }
      }
      if (!chosen) chosen = adminCats.find((cat) => categoryMatches(a, cat)) || null;
      if (chosen) primaryFor.set(a.id, chosen);
    });

    const groups = adminCats.map((cat) => ({ cat, items: [] as AnimeItem[], ids: new Set<string>() }));
    const byCat = new Map(groups.map((g) => [g.cat, g]));

    rotatedPool.forEach((a) => {
      const cat = primaryFor.get(a.id);
      if (!cat) return;
      const g = byCat.get(cat);
      if (g && !g.ids.has(a.id)) { g.ids.add(a.id); g.items.push(a); }
    });

    const globallyUsed = new Set<string>();
    groups.forEach((g) => g.items.forEach((i) => globallyUsed.add(i.id)));

    const tryPush = (g: { items: AnimeItem[]; ids: Set<string> }, a: AnimeItem) => {
      if (g.ids.has(a.id) || globallyUsed.has(a.id)) return;
      g.ids.add(a.id); g.items.push(a); globallyUsed.add(a.id);
    };

    groups.forEach((g) => {
      if (g.items.length >= MIN_SLOTS) return;
      for (const a of rotatedAn) {
        if (g.items.length >= MIN_SLOTS) break;
        if (categoryMatches(a, g.cat)) tryPush(g, a);
      }
      for (const a of rotatedAn) {
        if (g.items.length >= MIN_SLOTS) break;
        tryPush(g, a);
      }
      for (const a of rotatedPool) {
        if (g.items.length >= MIN_SLOTS) break;
        tryPush(g, a);
      }
    });

    return groups.map((g, i) => ({ key: `${i}-${g.cat}`, title: g.cat, items: g.items.slice(0, MAX_SLOTS) }));
  }, [filteredSeries, filteredMovies, categories, activeSaltItems, homeRefreshTick]);

  // Hero slides: stable mix from all anime with backdrop. The HeroSlider owns timing;
  // the parent must not reshuffle while the progress bar is running.
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
    const withBackdrop = allSeries.filter(a => a.backdrop);
    if (withBackdrop.length === 0) return [];
    
    // Stable seeded shuffle so live data refresh cannot cause rapid card flips.
    const shuffled = [...withBackdrop];
    let seed = 17;
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
      poster: item.poster,
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
        poster: (p as any).poster || p.backdrop,
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
  }, [allSeries, pinnedHeroPosts]);

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
        ...filteredMovies.slice(0, 6).map((item) => optimizedImageUrl(item.poster, "poster")),
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

    const routeTarget = {
      ...getDefaultWatchTarget(anime),
      ...(sIdx !== undefined ? { seasonIdx: sIdx } : {}),
      ...(eIdx !== undefined ? { epIdx: eIdx } : {}),
    };

    const isAnimeSaltCard = anime.source === "animesalt"
      || String(anime.id || "").startsWith("as_")
      || String(anime.id || "").startsWith("an_")
      || String(anime.id || "").startsWith("an_mv_")
      || !!anime.anSlug
      || !!anime.animeSaltSlug;

    let preflightFullAnime: AnimeItem | null = null;
    let preflightAnime: AnimeItem = anime;
    if (isAnimeSaltCard) {
      const meta = await loadAnimeSaltPremiumMeta(anime);
      if (meta) preflightAnime = { ...anime, ...meta };
    } else if (anime.premium === undefined && !anime.premiumEpisodes) {
      preflightFullAnime = await loadFullFirebaseAnimeItemWithTimeout(anime);
      if (preflightFullAnime) preflightAnime = preflightFullAnime;
    }

    if ((isSeriesLocked(preflightAnime as any) || isEpisodeLocked(preflightAnime as any, routeTarget.seasonIdx ?? 0, routeTarget.epIdx ?? 0)) && !userIsPremium) {
      navigate(`/premium-required?from=${encodeURIComponent(anime.id || "")}`);
      return;
    }

    const immediateRoute = buildWatchRoute(anime.id, routeTarget.seasonIdx, routeTarget.epIdx);
    if (location.pathname !== immediateRoute || location.search !== new URL(immediateRoute, window.location.origin).search) {
      const fromRoutedOverlay = isSearchRoute;
      navigate(immediateRoute, { replace: fromRoutedOverlay || switchingInPlayer });
    }

    const fullAnime = isAnimeSaltCard ? null : (preflightFullAnime || await loadFullFirebaseAnimeItemWithTimeout(preflightAnime));
    const playableAnime = fullAnime || preflightAnime;

    // AN cards are admin-curated metadata only — playback URLs are resolved
    // LIVE from the AnimeSalt API on click (CDN links expire if stored).
    if (isAnimeSaltCard || playableAnime.source === "animesalt") {
      const slug = playableAnime.anSlug || playableAnime.animeSaltSlug || playableAnime.slug || "";
      if (!slug) {
        toast.error("Missing AnimeSalt slug for this title");
        return;
      }
      setLoadingDetails({
        open: true,
        title: playableAnime.title,
        poster: playableAnime.poster || (playableAnime as any).backdrop,
        progress: 10,
        step: "Loading details",
        completed: [],
      });
      try {
        if (playableAnime.type === "movie") {
          setLoadingDetails((s) => ({ ...s, step: "Fetching movie stream", progress: 35 }));
          const resolved = await resolveAnMoviePlayback(slug);
          if (!resolved) {
            toast.error("Could not load this movie from AnimeSalt");
            return;
          }
          setLoadingDetails((s) => ({ ...s, step: "Preparing player", progress: 85, completed: Array.from(new Set([...s.completed, "Movie stream ready"])) }));
          const enriched: AnimeItem = {
            ...playableAnime,
            ...resolved.fields,
            // Preserve Admin-saved Info Modal metadata. Playback resolver only
            // owns stream fields; it must never wipe overview/cast/directors.
            title: playableAnime.title,
            poster: playableAnime.poster || (resolved.fields as any).poster,
            backdrop: playableAnime.backdrop || (resolved.fields as any).backdrop,
            rating: playableAnime.rating || (resolved.fields as any).rating,
            year: playableAnime.year || (resolved.fields as any).year,
            category: playableAnime.category || (resolved.fields as any).category,
            storyline: playableAnime.storyline || (playableAnime as any).overview || (resolved.fields as any).storyline,
            overview: (playableAnime as any).overview || playableAnime.storyline || (resolved.fields as any).overview,
            genres: playableAnime.genres?.length ? playableAnime.genres : (resolved.fields as any).genres,
            directors: playableAnime.directors?.length ? playableAnime.directors : (resolved.fields as any).directors,
            cast: playableAnime.cast?.length ? playableAnime.cast : (resolved.fields as any).cast,
            audioTracks: resolved.audioTracks as any,
          };
          await openPlayerFromAnime(enriched, { seasonIdx: sIdx, epIdx: eIdx });
        } else {
          setLoadingDetails((s) => ({ ...s, step: "Fetching episodes", progress: 30 }));
          const seasons = await resolveAnSeriesSeasons(slug);
          if (!seasons.length) {
            toast.error("Could not load episodes from AnimeSalt");
            return;
          }
          const seasonLabels = seasons.slice(0, 3).map((_, i) => `Season ${i + 1} loaded`);
          setLoadingDetails((s) => ({ ...s, progress: 55, completed: seasonLabels }));
          const targetSIdx = typeof sIdx === "number" ? Math.min(sIdx, seasons.length - 1) : 0;
          const epList = seasons[targetSIdx]?.episodes || [];
          const targetEIdx = typeof eIdx === "number" ? Math.min(eIdx, Math.max(epList.length - 1, 0)) : 0;
          const firstEp = seasons[targetSIdx]?.episodes?.[targetEIdx];
          let firstAudio: any[] | undefined;
          if (firstEp && isAnimeSaltSentinel(firstEp.link)) {
            setLoadingDetails((s) => ({ ...s, step: "Loading audio & stream", progress: 75 }));
            const epData = await resolveAnEpisodePlayback(slugFromSentinel(firstEp.link), { seriesSlug: slug });
            if (epData) {
              Object.assign(firstEp, epData);
              firstAudio = epData.audioTracks as any;
            }
          }
          void warmAnSeriesPlaybackCache(slug, seasons);
          setLoadingDetails((s) => ({ ...s, step: "Preparing player", progress: 95, completed: Array.from(new Set([...s.completed, "Audio tracks ready"])) }));
          const enriched: AnimeItem = {
            ...playableAnime,
            seasons,
            storyline: playableAnime.storyline || (playableAnime as any).overview,
            overview: (playableAnime as any).overview || playableAnime.storyline,
            audioTracks: firstAudio || (playableAnime.audioTracks as any),
          };
          await openPlayerFromAnime(enriched, { seasonIdx: targetSIdx, epIdx: targetEIdx });
        }
      } finally {
        setLoadingDetails({ open: false, progress: 0, step: "", completed: [] });
      }
      return;
    }




    // Reflect details view in the URL so back-button works as a real route.
    // Use replace when coming from a routed overlay (search/watch/details) to
    // avoid stacking duplicate entries; push from anywhere else.
    await openPlayerFromAnime(playableAnime, { seasonIdx: sIdx, epIdx: eIdx });
  };

  const handlePlay = async (anime: AnimeItem, seasonIdx?: number, epIdx?: number) => {
    if (unlockBlocked) {
      toast.error("This account is blocked due to token misuse.");
      return;
    }

    const isAnimeSaltContentEarly = anime.source === "animesalt"
      || String(anime.id || "").startsWith("as_")
      || String(anime.id || "").startsWith("an_")
      || String(anime.id || "").startsWith("an_mv_")
      || !!anime.anSlug
      || !!anime.animeSaltSlug;

    const latestPremiumMeta = isAnimeSaltContentEarly ? await loadAnimeSaltPremiumMeta(anime) : null;
    if (latestPremiumMeta) anime = { ...anime, ...latestPremiumMeta };

    const fallbackTarget = getDefaultWatchTarget(anime);
    let resolvedSeasonIdx = seasonIdx ?? fallbackTarget.seasonIdx;
    let resolvedEpIdx = epIdx ?? fallbackTarget.epIdx;

    // Premium gate — series-level or per-episode lock
    const seriesLike = anime as any;
    const sIdx = resolvedSeasonIdx ?? 0;
    const eIdx = resolvedEpIdx ?? 0;
    const locked = isSeriesLocked(seriesLike) || isEpisodeLocked(seriesLike, sIdx, eIdx);
    if (locked && !userIsPremium) {
      navigate(`/premium-required?from=${encodeURIComponent(anime.id || "")}`);
      return;
    }
    if (!freeAccessLoaded && isLoggedIn && !isAnimeSaltContentEarly) {
      return;
    }

    const isAnimeSaltContentEarlyReload = anime.source === "animesalt"
      || String(anime.id || "").startsWith("as_")
      || String(anime.id || "").startsWith("an_")
      || String(anime.id || "").startsWith("an_mv_")
      || !!anime.anSlug
      || !!anime.animeSaltSlug;
    // Critical: AN card-click resolves fresh playback URLs from the live API
    // before calling handlePlay(). Reloading the old Firebase row here replaces
    // those fresh URLs with stale animesalt:// sentinels, which caused the
    // "no saved Firebase HLS URL" toast and blocked every AN video.
    const forceFreshPlayback = !!(anime as any).__rsForceFreshPlayback;
    const alreadyRetriedFresh = !!(anime as any).__rsRetriedFreshPlayback;
    if (!isAnimeSaltContentEarlyReload) {
      const needsFullHydration = forceFreshPlayback || !hasStoredFirebasePlayback(anime);
      if (needsFullHydration) {
        anime = (await loadFullFirebaseAnimeItemWithTimeout(anime, forceFreshPlayback ? 3600 : 1400, { forceFresh: forceFreshPlayback })) || anime;
      }
      if (resolvedSeasonIdx === undefined || resolvedEpIdx === undefined) {
        const fullDefaultTarget = getDefaultWatchTarget(anime);
        resolvedSeasonIdx = resolvedSeasonIdx ?? fullDefaultTarget.seasonIdx;
        resolvedEpIdx = resolvedEpIdx ?? fullDefaultTarget.epIdx;
      }
    }

    const isInlineSwitch = keepPlayerAliveRef.current;
    stopAllPlayback();
    const targetWatchRoute = buildWatchRoute(anime.id, resolvedSeasonIdx, resolvedEpIdx);
    if (location.pathname !== targetWatchRoute || location.search !== new URL(targetWatchRoute, window.location.origin).search) {
      navigate(targetWatchRoute, { replace: isInlineSwitch || inPlayerSwitchRef.current });
    }

    const isAnimeSaltContent = anime.source === "animesalt"
      || String(anime.id || "").startsWith("as_")
      || String(anime.id || "").startsWith("an_")
      || String(anime.id || "").startsWith("an_mv_")
      || !!anime.anSlug
      || !!anime.animeSaltSlug;

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
      if (isAnimeSaltContent && isAnimeSaltSentinel(episode.link)) {
        const resolved = await resolveAnEpisodePlayback(slugFromSentinel(episode.link), { seriesSlug: anime.anSlug || anime.animeSaltSlug || anime.slug });
        if (resolved) Object.assign(episode, resolved);
      }
      src = getEpisodeSrc(episode);
      subtitle = `${season.name} - Episode ${episode.episodeNumber}`;
      if (episode.link480) qualityOptions.push({ label: "480p", src: episode.link480 });
      if (episode.link720) qualityOptions.push({ label: "720p", src: episode.link720 });
      if (episode.link1080) qualityOptions.push({ label: "1080p", src: episode.link1080 });
      if (episode.link4k) qualityOptions.push({ label: "4K", src: episode.link4k });
      if (episode.audioTracks?.length) audioTracks = episode.audioTracks;
      if (isAnimeSaltContent) {
        const directFromFirebase = buildAnimeSaltEpisodePlaybackFromFirebase(episode);
        if (directFromFirebase?.src) {
          src = directFromFirebase.src;
          qualityOptions = directFromFirebase.qualityOptions;
          audioTracks = directFromFirebase.audioTracks;
        }
      }
      } else if (hasMovieParts(anime)) {
        // Movie split into parts — pick the requested part (fallback to first)
        const partIdx = Math.max(0, resolvedEpIdx ?? 0);
        const part = (anime.parts as any[])[partIdx] || (anime.parts as any[])[0];
        src = getMoviePartSrc(part);
        subtitle = part?.title || `Part ${part?.partNumber || partIdx + 1}`;
        qualityOptions = getMoviePartQualityOptions(part);
        if (anime.audioTracks?.length) audioTracks = anime.audioTracks;
      } else if (getMovieSrc(anime)) {
        src = getMovieSrc(anime);
      subtitle = "Movie";
        qualityOptions = getMovieQualityOptions(anime);
        if (anime.audioTracks?.length) audioTracks = anime.audioTracks;
        // AN movies: wrap into synthetic master so video + Hindi audio play together
        const anMovie = buildAnMoviePlayback(anime);
        if (anMovie?.src) {
          src = anMovie.src;
          qualityOptions = anMovie.qualityOptions;
          audioTracks = anMovie.audioTracks as any;
        }
    }

    // Handle AnimeSalt video - check ad-gate first
    if (src.startsWith("animesalt://")) {
      const hasAccess = await checkAndShowAdGate(anime, resolvedSeasonIdx, resolvedEpIdx);
      if (!hasAccess) return;
      inPlayerSwitchRef.current = false;
      toast.error("Could not load this episode from AnimeSalt. Please try again.");
      return;
    }

    // Handle AnimeSalt movie playback
    if (src.startsWith("animesalt_movie://")) {
      const hasAccess = await checkAndShowAdGate(anime, seasonIdx, epIdx);
      if (!hasAccess) return;
      inPlayerSwitchRef.current = false;
      toast.error("Could not load this movie from AnimeSalt. Please try again.");
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
            : hasMovieParts(anime) && resolvedEpIdx !== undefined
              ? getMoviePartSrc((anime.parts as any[])[resolvedEpIdx + 1])
              : undefined,
      });
      setSelectedAnime(null);
      inPlayerSwitchRef.current = false;
    } else {
      inPlayerSwitchRef.current = false;
      if (!isAnimeSaltContent && !alreadyRetriedFresh) {
        const fresh = await loadFullFirebaseAnimeItemWithTimeout(anime, 3600, { forceFresh: true });
        if (fresh && hasStoredFirebasePlayback(fresh)) {
          return handlePlay({ ...(fresh as any), __rsRetriedFreshPlayback: true } as AnimeItem, resolvedSeasonIdx, resolvedEpIdx);
        }
      }
      // No src resolved anywhere. Never leave the card looking dead — tell the
      // user explicitly so a missing/not-yet-uploaded link is obvious.
      console.warn("[handlePlay] no src resolved for", anime?.title);
      if (!isAnimeSaltContent) {
        toast.error("This episode has no video link yet. Please try another episode.");
      }

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

    const { seasonIdx: nextSeasonIdx, epIdx: nextEpIdx } = parseWatchRouteIndices(location.search);
    const targetAnime = allAnime.find((item) => matchesAnimeRouteId(item, watchRouteAnimeId));

    // 🔗 BACKWARD COMPAT: old Telegram bot share links carry only the series
    // ID (no ?s= / ?e=). If the ID isn't in allAnime yet (or it's an AN slug
    // link like /watch/as_naruto), fall back to the same AN-stub construction
    // as the pendingAnimeId path so the player still opens at the default
    // episode instead of silently freezing the page.
    if (!targetAnime) {
      const isSaltLink = watchRouteAnimeId.startsWith("as_")
        || watchRouteAnimeId.startsWith("an_")
        || watchRouteAnimeId.startsWith("an_mv_");
      if (isSaltLink && !saltLoading) {
        const slug = watchRouteAnimeId.replace(/^as_|^an_mv_|^an_/, "");
        if (slug) {
          const stub: AnimeItem = {
            id: watchRouteAnimeId,
            title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            poster: "", backdrop: "", year: "", rating: "", language: "",
            category: "AnimeSalt",
            type: watchRouteAnimeId.startsWith("an_mv_") ? "movie" : "webseries",
            storyline: "", source: "animesalt", slug,
          };
          void handleCardClick(stub, nextSeasonIdx, nextEpIdx);
        }
        return;
      }
      void loadFirebaseAnimeItemByRouteId(watchRouteAnimeId).then((mapped) => {
        if (mapped) void handlePlay(mapped, nextSeasonIdx, nextEpIdx);
        else if (!loading) navigate(buildAnimeRoute(watchRouteAnimeId), { replace: true });
      });
      return;
    }

    const current = playerStateRef.current;
    const sameAnime = !!current?.anime && matchesAnimeRouteId(current.anime, watchRouteAnimeId);
    const sameSeason = (current?.seasonIdx ?? undefined) === nextSeasonIdx;
    const sameEpisode = (current?.epIdx ?? undefined) === nextEpIdx;
    if (sameAnime && sameSeason && sameEpisode && current) return;

    if (isAnimeSaltRouteItem(targetAnime)) {
      void handleCardClick(targetAnime, nextSeasonIdx, nextEpIdx);
      return;
    }

    void handlePlay(targetAnime, nextSeasonIdx, nextEpIdx);
  }, [allAnime, freeAccessLoaded, isWatchRoute, location.search, watchRouteAnimeId, saltLoading, loading]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const legacyAnimeId = params.get("anime");
    const legacySeason = params.get("s");
    const legacyEpisode = params.get("e");
    if (!legacyAnimeId) return;

    if (legacySeason !== null || legacyEpisode !== null) {
      const { seasonIdx: sIdx, epIdx: eIdx } = parseWatchRouteIndices(location.search);
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
        // Live-update the home rail so the card appears immediately (even before first timeupdate).
        setContinueWatching((prev) => {
          const first = nextCache[0];
          const filtered = Array.isArray(prev) ? prev.filter((x: any) => x?.id !== first.id) : [];
          return [first, ...filtered].slice(0, 50);
        });
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
        // Live-update the home rail so the card appears immediately (esp. for guests).
        setContinueWatching((prev) => {
          const filtered = Array.isArray(prev) ? prev.filter((x: any) => x?.id !== nextItem.id) : [];
          return [nextItem, ...filtered].slice(0, 50);
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
    let anime =
      allAnime.find(a => a.id === item.id && (a.source || "firebase") === preferredSource) ||
      allAnime.find(a => a.id === item.id && (a.source || "firebase") === "firebase") ||
      allAnime.find(a => a.id === item.id);
    if (!anime) return;
    const isAnimeSaltContinue = anime.source === "animesalt"
      || String(anime.id || "").startsWith("as_")
      || String(anime.id || "").startsWith("an_")
      || String(anime.id || "").startsWith("an_mv_")
      || !!anime.anSlug
      || !!anime.animeSaltSlug;
    if (!isAnimeSaltContinue) anime = (await loadFullFirebaseAnimeItem(anime)) || anime;

    if (isAnimeSaltContinue || anime.source === "animesalt") {
      // Route AN continue-watching through the live-API click flow so playback
      // URLs are always fresh.
      const sIdx = item.episodeInfo?.seasonIdx ?? (item.episodeInfo ? item.episodeInfo.season - 1 : undefined);
      const eIdx = item.episodeInfo?.epIdx ?? (item.episodeInfo ? item.episodeInfo.episode - 1 : undefined);
      await handleCardClick(anime, sIdx, eIdx);
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
        // AN branch handled earlier via handleCardClick — no Firebase-stored
        // AN URLs are ever consumed here.

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
      // MOVIE continue-watching. Previously gated on `anime.movieLink` which
      // silently swallowed clicks when the lightweight card object had no
      // direct link (very common for TMDB-only or quality-tiered movies).
      // Always try to build a playable source; if none, open the details page.
      const hasAccess = await checkAndShowAdGate(anime);
      if (!hasAccess) return;
      const anMovie = buildAnMoviePlayback(anime);
      const src = anMovie?.src || getMovieSrc(anime) || anime.movieLink || "";
      if (!src) {
        handleCardClick(anime);
        return;
      }
      const nextState = {
        src,
        title: anime.title,
        subtitle: "Movie",
        anime,
        audioTracks: (anMovie?.audioTracks as any) || anime.audioTracks,
        subtitleTracks: (anime as any).subtitleTracks,
        qualityOptions: anMovie?.qualityOptions || getMovieQualityOptions(anime),
        resumeTime: item.currentTime || 0,
      };
      playerStateRef.current = nextState;
      setPlayerState(nextState);
      const targetWatchRoute = buildWatchRoute(anime.id);
      if (`${location.pathname}${location.search}` !== targetWatchRoute) {
        navigate(targetWatchRoute);
      }
      addToWatchHistory(anime, undefined, undefined, true);
      setSelectedAnime(null);
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
    } else if (getMovieSrc(anime)) {
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
      let preferredLanguage = getSavedAnAudioLanguagePref() || (playerState as any)?.selectedLanguage;
      if (playerState?.anime.source === "animesalt" && isAnimeSaltSentinel(clickedEp.link)) {
        const resolved = await resolveAnEpisodePlayback(slugFromSentinel(clickedEp.link), { seriesSlug: playerState!.anime.anSlug || playerState!.anime.animeSaltSlug || playerState!.anime.slug });
        if (resolved) Object.assign(clickedEp, resolved);
      }
      if (playerState?.anime.source === "animesalt") {
        const built = buildAnimeSaltEpisodePlaybackFromFirebase(clickedEp);
        if (built?.src) {
          nextSrc = built.src;
          qOpts = built.qualityOptions || [];
          nextAudioTracks = built.audioTracks;
          preferredLanguage = preferredLanguage || built.preferredLanguage;
        }
      }
      if (!nextSrc) {
        toast.error("Could not load this episode from AnimeSalt");
        return;
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
    let preferredLanguage = getSavedAnAudioLanguagePref() || (playerState as any)?.selectedLanguage;
    if (playerState.anime.source === "animesalt" && isAnimeSaltSentinel(ep.link)) {
      const resolved = await resolveAnEpisodePlayback(slugFromSentinel(ep.link), { seriesSlug: playerState.anime.anSlug || playerState.anime.animeSaltSlug || playerState.anime.slug });
      if (resolved) Object.assign(ep, resolved);
    }
    if (playerState.anime.source === "animesalt") {
      const built = buildAnimeSaltEpisodePlaybackFromFirebase(ep);
      if (built?.src) {
        nextSrc = built.src;
        qOpts = built.qualityOptions || [];
        nextAudioTracks = built.audioTracks;
        preferredLanguage = preferredLanguage || built.preferredLanguage;
      }
    }
    if (!nextSrc) {
      toast.error("Could not load this season from AnimeSalt");
      return;
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

  const suggestedAnimeCacheRef = useRef<Map<string, AnimeItem[]>>(new Map());

  // Suggested anime: fixed, deterministic, same-category recommendations only.
  const suggestedAnime = useMemo(() => {
    const current = playerState?.anime || saltPlayerState?.anime;
    if (!current) return [];
    const cacheKey = `${current.id}:${String(current.category || "").toLowerCase().trim()}:${current.type}`;
    const cached = suggestedAnimeCacheRef.current.get(cacheKey);
    if (cached?.length) return cached;
    const currentCategoryTokens = splitCategoryTokens(current.category);
    const currentLanguage = (current.language || "").toLowerCase().trim();
    const currentTokenSet = new Set(currentCategoryTokens);

    const candidates = allAnime.filter(a => a.id !== current.id);

    const categoryMatched = currentCategoryTokens.length > 0
      ? candidates.filter((a) => splitCategoryTokens(a.category).some((token) => currentTokenSet.has(token)))
      : candidates.filter((a) => a.type === current.type);

    const scored = categoryMatched.map(a => {
      const tokens = splitCategoryTokens(a.category);
      const categoryScore = tokens.filter((token) => currentTokenSet.has(token)).length * 20;
      const lang = (a.language || "").toLowerCase().trim();
      let score = categoryScore;
      if (currentLanguage && lang === currentLanguage) score += 4;
      if (a.type === current.type) score += 2;
      score += Math.min(100, Number(a.rating) || 0) / 100;
      return { anime: a, score };
    });

    scored.sort((a, b) =>
      b.score - a.score
      || ((b.anime.updatedAt || b.anime.createdAt || 0) - (a.anime.updatedAt || a.anime.createdAt || 0))
      || String(a.anime.title || "").localeCompare(String(b.anime.title || ""))
    );
    const seen = new Set<string>([current.id]);
    const picked: AnimeItem[] = [];
    for (const s of scored) {
      if (seen.has(s.anime.id)) continue;
      seen.add(s.anime.id); picked.push(s.anime);
      if (picked.length >= 15) break;
    }
    // Fallback fill: never leave the suggestion strip empty or short.
    // Use popular / recently-updated anime across the whole catalogue.
    if (picked.length < 15) {
      const fillers = [...allAnime]
        .filter((a) => !seen.has(a.id))
        .sort((a, b) =>
          (Number(b.rating) || 0) - (Number(a.rating) || 0)
          || ((b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
        );
      for (const a of fillers) {
        if (picked.length >= 15) break;
        seen.add(a.id); picked.push(a);
      }
    }
    if (picked.length) suggestedAnimeCacheRef.current.set(cacheKey, picked);
    return picked;
  }, [playerState?.anime?.id, saltPlayerState?.anime?.id, allAnime]);

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

  // ===== SWIPE NAVIGATION — VISITED PAGES STAY MOUNTED (ZERO RE-MOUNT LAG) =====
  const [visualPage, setVisualPage] = useState<MainPage>(activePage);
  const activePageIdx = MAIN_PAGE_ORDER.indexOf(activePage);
  const swipeTrackRef = useRef<HTMLDivElement | null>(null);
  const swipeRafRef = useRef<number | null>(null);
  const isSwipeAnimatingRef = useRef(false);

  // Keep-alive set: once a tab is visited it stays mounted so revisits are instant.
  const [mountedPages, setMountedPages] = useState<Set<MainPage>>(() => new Set([activePage]));

  // Sync visualPage when activePage changes + record mount
  useEffect(() => {
    setVisualPage(activePage);
    setMountedPages((prev) => (prev.has(activePage) ? prev : new Set(prev).add(activePage)));
  }, [activePage]);


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
      setShowLogin(false);
      setShowProfile(true);
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

  if ((loading || splashHold) && !playerState && !saltPlayerState && !isSearchRoute && !isAnimeRoute && !isWatchRoute) {
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
      <CategoryPills active={activeCategory} onSelect={setActiveCategory} categories={userCategoryPills} />
      {activeCategory !== "All" ? (
        <div className="px-4 pb-6">
          <h2 className="text-base font-bold mb-3 flex items-center category-bar">{activeCategory}</h2>
          {filteredAnime.length > 0 ? (
            <div className="grid grid-cols-3 gap-2.5">
              {filteredAnime.slice(0, HOME_CATEGORY_GRID_LIMIT).map((anime) => (
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
                  const badge = getCardSourceBadge(item);
                  return (
                    <div key={item.id} role="button" tabIndex={0} onClick={() => handleContinueWatching(item)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleContinueWatching(item); } }}
                      className="flex-shrink-0 w-[130px] cursor-pointer outline-none">
                      <div data-anime-card="true" className="relative aspect-[2/3] rounded-xl overflow-hidden poster-hover mb-1">
                        <img src={optimizedImageUrl(item.poster, "poster")} alt={item.title} className="poster-img w-full h-full object-cover" loading="eager" decoding="async" />
                        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.25) 45%, transparent 75%)" }} />
                        <span className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider z-10 ${badge === "AN" ? "bg-accent/85 text-accent-foreground" : "bg-primary/85 text-primary-foreground"}`}>{badge}</span>
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
          {filteredMovies.length > 0 && (
            <AnimeSection title="🎬 Most Favorite Movies" items={filteredMovies.slice(0, 10)} onCardClick={handleCardClick} onViewAll={() => navigate("/movies")} />
          )}
          {categoryGroups
            .map(({ key, title, items }) => (
              <AnimeSection key={key} title={title} items={items.slice(0, 10)} onCardClick={handleCardClick} showWhenEmpty />
            ))}
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
      <div className="fixed inset-0 z-[100] bg-black">
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
                  let preferredLanguage = getSavedAnAudioLanguagePref() || (playerState as any)?.selectedLanguage;
                  if (playerState.anime.source === "animesalt" && isAnimeSaltSentinel(nextEp.link)) {
                    // Resolve fresh HLS URLs for the next episode on-demand.
                    const resolved = await resolveAnEpisodePlayback(slugFromSentinel(nextEp.link), { seriesSlug: playerState.anime.anSlug || playerState.anime.animeSaltSlug || playerState.anime.slug });
                    if (resolved) Object.assign(nextEp, resolved);
                  }
                  if (playerState.anime.source === "animesalt") {
                    const built = buildAnimeSaltEpisodePlaybackFromFirebase(nextEp);
                    if (built?.src) {
                      nextSrc = built.src;
                      qOpts = built.qualityOptions || [];
                      nextAudioTracks = built.audioTracks;
                      preferredLanguage = preferredLanguage || built.preferredLanguage;
                    }
                  }
                  if (!nextSrc) {
                    toast.error("Could not load next episode from AnimeSalt");
                    return;
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
            if (anime.source === "animesalt" && isAnimeSaltSentinel(ep.link)) {
              const resolved = await resolveAnEpisodePlayback(slugFromSentinel(ep.link), { seriesSlug: anime.anSlug || anime.animeSaltSlug || anime.slug });
              if (resolved) Object.assign(ep, resolved);
            }
            if (anime.source === "animesalt") {
              const built = buildAnimeSaltEpisodePlaybackFromFirebase(ep);
              if (built?.src) {
                nextSrc = built.src;
                qOpts = built.qualityOptions || [];
                nextAudioTracks = built.audioTracks;
              }
            }
            if (!nextSrc) {
              toast.error("Could not load this episode from AnimeSalt");
              return;
            }



            const newAnime = { ...anime, seasons: newSeasons, baseLanguage: resolvedLabel, language: resolvedLabel };
            const nextState = {
              ...playerState,
              anime: newAnime,
              src: nextSrc,
              subtitle: `${newSeasons[seasonIdx].name} - Episode ${ep.episodeNumber}`,
              seasonIdx,
              epIdx,
              // A language change is an audio-source change for the same
              // episode, not navigation. Preserve the playhead.
              resumeTime: playerStateRef.current?.resumeTime,
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
      <Header onSearchClick={() => navigate("/search")} onProfileClick={() => handleNavigate("profile")} onOpenContent={(id) => { const a = allAnime.find(x => x.id === id); if (a) handleCardClick(a); }} animeTitles={allAnime.map(a => a.title)} onLogoClick={() => setChatOpen(prev => !prev)} chatOpen={chatOpen} showSearch={true} />
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
            // Keep-alive: mount visited pages + any page currently crossed by the slide.
            const visualIdx = MAIN_PAGE_ORDER.indexOf(visualPage);
            const inSlide = idx >= Math.min(activePageIdx, visualIdx) && idx <= Math.max(activePageIdx, visualIdx);
            const shouldRender = inSlide || mountedPages.has(page);
            const isActive = page === activePage;
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
                contain: isActive ? "none" : "layout paint style",
                // Skip paint work for off-screen mounted tabs — huge scroll/nav win on mobile.
                contentVisibility: isActive || inSlide ? "visible" : "auto",
                containIntrinsicSize: isActive || inSlide ? undefined : "100vh",
              } as React.CSSProperties}
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
            onCardClick={(anime) => { void handleCardClick(anime); }}
          />
        )}
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

      <LoadingDetailsOverlay
        open={loadingDetails.open}
        title={loadingDetails.title}
        poster={loadingDetails.poster}
        progress={loadingDetails.progress}
        step={loadingDetails.step}
        completed={loadingDetails.completed}
      />

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
          shareLink: `${window.location.origin}/watch/${encodeURIComponent(a.id)}`,
          seasonCount: a.seasons?.length,
          episodeCount: a.seasons?.reduce((sum, s) => sum + (s.episodes?.length || 0), 0),
        }))}
      />

      {/* First-visit Telegram community popup (admin-controlled) */}
      <TelegramWelcomeModal />

    </div>
  );
};

export default Index;
