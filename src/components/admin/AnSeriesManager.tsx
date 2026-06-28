import { useEffect, useMemo, useState } from "react";
import CachedImg from "@/components/CachedImg";
import { db, ref, set, get, onValue, remove } from "@/lib/firebase";
import { animeSaltApi } from "@/lib/animeSaltApi";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";
import { toast } from "sonner";
import { CheckCircle2, Database, Edit, Loader2, RefreshCw, Search, Trash2, Zap } from "lucide-react";

interface Props {
  glassCard: string;
  btnPrimary: string;
  btnSecondary: string;
  inputClass: string;
  onEditSeries?: (id: string) => void;
  onEditMovie?: (id: string) => void;
  mode?: "series" | "movie";
}

type SelectedAnItem = {
  slug: string;
  title: string;
  poster: string;
  backdrop?: string;
  year?: string;
  rating?: string;
  category?: string;
  storyline?: string;
  type?: "series" | "movies" | "movie";
  tmdbId?: string | number | null;
  addedAt?: number;
  customSeasons?: any[];
};

type RsEpisode = {
  episodeNumber: number;
  title: string;
  link: string;
  link480?: string;
  link720?: string;
  link1080?: string;
  link4k?: string;
  qualityLinks?: { default: string; p480: string; p720: string; p1080: string; p4k: string };
  audioTracks: { language: string; label: string; link: string; audioUrl?: string; rawAudioUrl?: string; isDefault?: boolean }[];
  defaultAudio?: { language: string; label: string; link: string; audioUrl?: string; rawAudioUrl?: string; isDefault?: boolean } | null;
};

type RsSeason = { name: string; seasonNumber: number; episodes: RsEpisode[] };

const sanitizeKey = (value: string) => String(value || "").replace(/[.#$/\[\]]/g, "_").slice(0, 180);
const webseriesIdForSlug = (slug: string) => `an_${sanitizeKey(slug)}`;
const movieIdForSlug = (slug: string) => `an_mv_${sanitizeKey(slug)}`;

const normalizeAnApiBaseUrl = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    const endpointNames = new Set(["raw", "search", "anime", "episode", "embed", "hls", "subs"]);
    const parts = url.pathname.split("/").filter(Boolean);
    while (parts.length && endpointNames.has(parts[parts.length - 1].toLowerCase())) parts.pop();
    url.pathname = `/${parts.join("/")}`.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/(?:raw|search|anime|episode|embed|hls|subs)(?:\?.*)?$/i, "").replace(/\/+$/, "");
  }
};

const getAnApiBase = async () => normalizeAnApiBaseUrl(await getEdgeFunctionUrl("an-api"));

// Store direct HTTPS HLS URLs in Firebase. Runtime playback must behave like RS:
// player reads the already-saved Firebase URLs and never calls the AN API.
const reliableHls = (_base: string, url?: string | null) => {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const proxyMatch = raw.match(/\/an-api\/hls\?url=([^&]+)/i);
  if (proxyMatch) {
    try { return decodeURIComponent(proxyMatch[1]); } catch { return raw; }
  }
  return raw;
};

const extractLikelyHlsUrlFromText = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = raw.match(/https?:\/\/[^\s"'<>]+?\.m3u8(?:\?[^\s"'<>]*)?/i)?.[0];
  if (direct) return direct;
  const encoded = raw.match(/https?%3A%2F%2F[^\s"'<>]+?\.m3u8(?:%3F[^\s"'<>]*)?/i)?.[0];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch {}
  }
  return raw;
};

const isHindiAudioEntry = (track: any) => {
  const blob = `${track?.language || ""} ${track?.name || ""} ${track?.label || ""}`.toLowerCase();
  return /hindi|हिन्दी|हिंदी|\bhin\b/.test(blob);
};

// Default audio policy: Hindi ALWAYS wins when present. If the upstream marks
// some other language as default (e.g. Japanese), we override it here so that
// every AN series/movie stored in Firebase opens in Hindi by default. Fallback
// to the first track only when no Hindi track exists at all.
const pickDefaultAudioIdx = (audio: Array<{ language?: string; name?: string }>) => {
  const hindi = audio.findIndex(isHindiAudioEntry);
  if (hindi >= 0) return hindi;
  const explicit = audio.findIndex((track: any) => track?.default === true || track?.isDefault === true);
  return explicit >= 0 ? explicit : 0;
};

const normalizeStoredAudioTracks = (tracks: any, defaultAudio?: any): RsEpisode["audioTracks"] => {
  const list = Array.isArray(tracks)
    ? tracks
    : tracks && typeof tracks === "object"
      ? Object.values(tracks)
      : defaultAudio
        ? [defaultAudio]
        : [];
  const cleaned = list
    .map((track: any, index: number) => {
      const label = String(track?.label || track?.name || track?.language || `Audio ${index + 1}`).trim();
      const language = String(track?.language || track?.label || label).trim();
      const link = String(track?.link || track?.audioUrl || track?.rawAudioUrl || track?.uri || track?.url || "").trim();
      return {
        language,
        label,
        link,
        audioUrl: String(track?.audioUrl || link || "").trim(),
        rawAudioUrl: String(track?.rawAudioUrl || link || "").trim(),
        isDefault: track?.isDefault === true,
      };
    })
    .filter((track: any) => track.label || track.language || track.link);
  if (cleaned.length > 0) {
    // Re-assert Hindi as default whenever it exists — never let Japanese or
    // any other language sneak in as default through stored data.
    const hindiIdx = cleaned.findIndex(isHindiAudioEntry);
    const targetIdx = hindiIdx >= 0
      ? hindiIdx
      : (cleaned.findIndex((t: any) => t.isDefault) >= 0 ? cleaned.findIndex((t: any) => t.isDefault) : 0);
    cleaned.forEach((t: any, i: number) => { t.isDefault = i === targetIdx; });
  }
  return cleaned;
};

const qualityField = (label?: string, height?: number): "link480" | "link720" | "link1080" | "link4k" | null => {
  const text = `${label || ""} ${height || ""}`.toLowerCase();
  if (/2160|4k/.test(text)) return "link4k";
  if (/1080/.test(text)) return "link1080";
  if (/720/.test(text)) return "link720";
  if (/480/.test(text)) return "link480";
  return null;
};

const getStreamHeight = (stream: any) => {
  const text = `${stream?.height || ""} ${stream?.label || ""} ${stream?.resolution || ""} ${stream?.filename || ""} ${stream?.url || ""}`;
  const match = text.match(/(?:^|[^0-9])(2160|1080|720|480)(?:[^0-9]|$)/i);
  return Number(stream?.height || match?.[1] || 0) || undefined;
};

const audioLanguageKey = (value?: string | null) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const pickTrackForLanguage = (tracks: NonNullable<RsEpisode["audioTracks"]> | undefined, language: string) => {
  const wanted = audioLanguageKey(language);
  if (!wanted) return undefined;
  return (tracks || []).find((track) => audioLanguageKey(track.language) === wanted || audioLanguageKey(track.label) === wanted);
};

const cloneSeasonsForAudioLanguage = (seasons: RsSeason[], _language: string): RsSeason[] => seasons.map((season) => ({
  ...season,
  episodes: (season.episodes || []).map((episode) => stripUndefined({
    ...episode,
    // AN stores video URLs once per episode. Language selection is handled only
    // through episode.audioTracks; never replace video fields with audio URLs.
    audioTracks: Array.isArray(episode.audioTracks) ? [...episode.audioTracks] : [],
    defaultAudio: episode.defaultAudio || (Array.isArray(episode.audioTracks) ? episode.audioTracks.find((track) => track?.isDefault) || episode.audioTracks[0] || null : null),
  })),
}));

const isLikelyHlsPlaylistUrl = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  // Only save HLS playlist URLs in Firebase. Never save key files, fragments,
  // thumbnails, JS player chunks, or any random CDN asset as a video/audio URL.
  if (/\.key(?:[?#]|$)/i.test(lower) || /(?:^|[?&])key=/.test(lower) || /\b(encryption|license)\b/.test(lower)) return false;
  if (/\.(?:ts|m4s|mp4|js|css|json|jpe?g|png|webp|gif|svg|ico)(?:[?#]|$)/i.test(lower)) return false;
  return /\.m3u8(?:[?#].*)?$/i.test(lower) || /\/hls\//i.test(lower);
};

const normalizePlaybackPayload = (payload: any) => payload?.data && !payload?.sources ? payload.data : payload;

const extractStreams = (payload: any) => {
  // ONLY use the per-quality video-only streams parsed from the HLS master
  // playlist (sources[].streams[] = 480p/720p/1080p variants). Never include
  // the combined master / directUrl / "Auto" link — that one carries
  // video+all-audio muxed together and is what expires first, so storing it
  // would write broken URLs into Firebase and break playback.
  const sourceStreams = Array.isArray(payload?.sources)
    ? payload.sources.flatMap((source: any) => Array.isArray(source?.streams) ? source.streams : [])
    : [];
  const linkStreams = Array.isArray(payload?.links)
    ? payload.links.map((entry: any) => ({
        url: String(entry?.url || entry?.src || "").trim(),
        label: String(entry?.label || entry?.quality || entry?.resolution || "Auto").trim(),
        height: Number(entry?.height || String(entry?.label || entry?.quality || "").match(/\d{3,4}/)?.[0] || 0) || undefined,
      }))
    : [];
  return [...sourceStreams, ...linkStreams]
    .filter((entry: any) => entry?.url)
    .map((entry: any, index: number) => ({
      url: extractLikelyHlsUrlFromText(entry.url),
      label: String(entry.label || (entry.height ? `${entry.height}p` : `Source ${index + 1}`)),
      height: getStreamHeight(entry),
      bandwidth: Number(entry.bandwidth || 0) || undefined,
      resolution: entry.resolution,
    }))
    // Keep only the named quality variants (480/720/1080/4K). Anything without
    // a recognizable quality field is either the muxed master or junk.
    .filter((entry) => isLikelyHlsPlaylistUrl(entry.url) && qualityField(entry.label, entry.height) !== null);
};

const extractAudio = (payload: any) => {
  const fromSources = Array.isArray(payload?.sources)
    ? payload.sources.flatMap((source: any) => Array.isArray(source?.audio) ? source.audio : [])
    : [];
  const fromTopLevel = Array.isArray(payload?.audio) ? payload.audio : [];
  const fromStoredTracks = Array.isArray(payload?.audioTracks)
    ? payload.audioTracks.map((track: any) => ({
        uri: track?.rawAudioUrl || track?.audioUrl || track?.uri || track?.url || (String(track?.link || "").startsWith("data:") ? "" : track?.link),
        name: track?.label || track?.name || track?.language,
        language: track?.language || track?.label || track?.name,
      }))
    : [];
  const seen = new Set<string>();
  return [...fromSources, ...fromTopLevel, ...fromStoredTracks]
    .map((track: any) => ({
      uri: extractLikelyHlsUrlFromText(track?.uri || track?.url || ""),
      name: String(track?.name || track?.label || track?.language || "Audio").trim(),
      language: String(track?.language || track?.name || track?.label || "Audio").trim(),
      default: track?.default === true || track?.isDefault === true,
    }))
    .filter((track) => {
      const key = `${track.language.toLowerCase()}|${track.uri}`;
      if (!track.uri || seen.has(key) || !isLikelyHlsPlaylistUrl(track.uri)) return false;
      seen.add(key);
      return true;
    });
};

const playbackToRsEpisode = (base: string, rawPayload: any, fallback: { number: number; title: string; slug?: string }): RsEpisode => {
  const payload = normalizePlaybackPayload(rawPayload);
  const streams = extractStreams(payload);
  const audio = extractAudio(payload);
  const defaultAudioIdx = pickDefaultAudioIdx(audio);
  const uniqueStreams = Array.from(new Map(streams.map((stream: any) => [`${getStreamHeight(stream) || stream.label || stream.url}:${stream.url}`, { ...stream, height: getStreamHeight(stream) }])).values());
  const preferredStream = uniqueStreams.find((stream) => Number(stream.height) === 1080) || uniqueStreams.find((stream) => Number(stream.height) >= 720) || uniqueStreams[0];
  const makeUrl = (stream?: any) => {
    if (!stream?.url) return "";
    const raw = String(stream.url || "").trim();
    return reliableHls(base, raw);
  };
  const episode: RsEpisode = {
    episodeNumber: fallback.number,
    title: String(payload?.title || fallback.title || `Episode ${fallback.number}`).trim(),
    link: "",
    qualityLinks: { default: "", p480: "", p720: "", p1080: "", p4k: "" },
    audioTracks: [],
    defaultAudio: null,
  };
  uniqueStreams.forEach((stream) => {
    const field = qualityField(stream.label, stream.height);
    if (field && !episode[field]) episode[field] = makeUrl(stream);
  });
  if (audio.length) {
    episode.audioTracks = audio.map((track, index) => {
      const label = String(track.name || track.language || `Audio ${index + 1}`).trim();
      const rawAudioUrl = String(track.uri || "").trim();
      const audioUrl = reliableHls(base, rawAudioUrl);
      const mapped: NonNullable<RsEpisode["audioTracks"]>[number] = {
        language: String(track.language || label).trim(),
        label,
        // Store the raw audio HLS URL in the audio row. Video fields above stay
        // raw video-only 480/720/1080 URLs so Admin can see/edit the real links.
        link: audioUrl,
        audioUrl,
        rawAudioUrl,
        isDefault: index === defaultAudioIdx,
      };
      return mapped;
    });
  }
  // Default field MUST be the 1080p video-only URL whenever 1080p exists.
  // Fall back to 720p, then 480p — never to the muxed master/Auto URL.
  const pick1080 = uniqueStreams.find((stream) => Number(stream.height) === 1080);
  const pick720 = uniqueStreams.find((stream) => Number(stream.height) === 720);
  const pick480 = uniqueStreams.find((stream) => Number(stream.height) === 480);
  const defaultStream = pick1080 || pick720 || pick480;
  episode.link = makeUrl(defaultStream);
  if (!episode.link1080 && pick1080) episode.link1080 = makeUrl(pick1080);
  episode.qualityLinks = {
    default: episode.link || episode.link1080 || episode.link720 || episode.link480 || "",
    p480: episode.link480 || "",
    p720: episode.link720 || "",
    p1080: episode.link1080 || episode.link || "",
    p4k: episode.link4k || "",
  };
  const markedDefaultAudio = episode.audioTracks.find((track) => track?.isDefault) || episode.audioTracks[0] || null;
  episode.defaultAudio = markedDefaultAudio ? { ...markedDefaultAudio, isDefault: true } : null;
  if (episode.defaultAudio) {
    episode.audioTracks = episode.audioTracks.map((track) => ({ ...track, isDefault: track === markedDefaultAudio }));
  }
  return episode;
};

const mergeCustomEpisodeFields = (episode: RsEpisode, custom: any, fallback: { number: number; title: string }): RsEpisode => {
  const merged: RsEpisode = { ...episode, episodeNumber: fallback.number, title: custom?.title || episode.title || fallback.title };
  (["link", "link480", "link720", "link1080", "link4k"] as const).forEach((field) => {
    const value = String(custom?.[field] || "").trim();
    if (value) (merged as any)[field] = value;
  });
  if (!merged.link) merged.link = merged.link1080 || merged.link720 || merged.link480 || "";
  if (!merged.link1080 && merged.link) merged.link1080 = merged.link;
  merged.qualityLinks = {
    default: merged.link || merged.link1080 || merged.link720 || merged.link480 || "",
    p480: merged.link480 || "",
    p720: merged.link720 || "",
    p1080: merged.link1080 || merged.link || "",
    p4k: merged.link4k || "",
  };
  const customTracks = normalizeStoredAudioTracks(custom?.audioTracks, custom?.defaultAudio);
  if (customTracks.length > 0) {
    const marked = customTracks.find((track) => track?.isDefault) || customTracks[0];
    merged.audioTracks = customTracks.map((track) => ({ ...track, isDefault: track === marked }));
    merged.defaultAudio = { ...marked, isDefault: true };
  } else {
    const tracks = normalizeStoredAudioTracks(merged.audioTracks, merged.defaultAudio);
    const marked = tracks.find((track) => track?.isDefault) || tracks[0] || null;
    merged.audioTracks = marked ? tracks.map((track) => ({ ...track, isDefault: track === marked })) : tracks;
    merged.defaultAudio = marked ? { ...marked, isDefault: true } : null;
  }
  return merged;
};

const episodeQualityStreams = (episode: RsEpisode) => [
  episode.link480 ? { label: "480p", height: 480, url: episode.link480 } : null,
  episode.link720 ? { label: "720p", height: 720, url: episode.link720 } : null,
  (episode.link1080 || episode.link) ? { label: "1080p", height: 1080, url: episode.link1080 || episode.link } : null,
  episode.link4k ? { label: "4K", height: 2160, url: episode.link4k } : null,
].filter(Boolean);

const cleanStoredAnEpisodePayload = (episode: RsEpisode, payload: any, fallback: { number: number; title: string }, epSlug: string, savedAt: number) => stripUndefined({
  slug: epSlug,
  number: fallback.number,
  title: episode.title,
  directUrl: episode.link || episode.link1080 || "",
  link: episode.link || "",
  link480: episode.link480 || "",
  link720: episode.link720 || "",
  link1080: episode.link1080 || episode.link || "",
  link4k: episode.link4k || "",
  qualityLinks: episode.qualityLinks || { default: episode.link || "", p480: episode.link480 || "", p720: episode.link720 || "", p1080: episode.link1080 || episode.link || "", p4k: episode.link4k || "" },
  sources: [{ type: "video", streams: episodeQualityStreams(episode) }],
  links: episodeQualityStreams(episode),
  audioTracks: Array.isArray(episode.audioTracks) ? episode.audioTracks : [],
  defaultAudio: episode.defaultAudio || (Array.isArray(episode.audioTracks) ? episode.audioTracks.find((track) => track?.isDefault) || episode.audioTracks[0] || null : null),
  defaultAudioIdx: Math.max(0, (Array.isArray(episode.audioTracks) ? episode.audioTracks : []).findIndex((track: any) => track?.isDefault)),
  preferredAudio: episode.defaultAudio?.label || episode.defaultAudio?.language || "",
  subtitles: payload?.subtitles || payload?.subtitleTracks || [],
  broken: !episode.link,
  updatedAt: savedAt,
});

const stripUndefined = <T,>(value: T): T => {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, any>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefined(entry)]),
    ) as T;
  }
  return value;
};

const mapLimit = async <T, R,>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  }));
  return results;
};

const AnSeriesManager = ({ glassCard, btnPrimary, btnSecondary, inputClass, onEditSeries, onEditMovie, mode = "series" }: Props) => {
  const isMovieMode = mode === "movie";
  const label = isMovieMode ? "AN Movies" : "AN Series";
  const [selectedItems, setSelectedItems] = useState<SelectedAnItem[]>([]);
  const [webseries, setWebseries] = useState<Record<string, any>>({});
  const [movies, setMovies] = useState<Record<string, any>>({});
  const [search, setSearch] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubSelected = onValue(ref(db, "animesaltSelected"), (snap) => {
      const data = snap.val() || {};
      const items = Object.entries(data)
        .map(([slug, item]: [string, any]) => ({
        slug,
        title: item?.title || slug,
        poster: item?.poster || item?.tmdbPoster || item?.posterUrl || "",
        backdrop: item?.backdrop || item?.tmdbBackdrop || item?.backdropUrl || item?.poster || "",
        year: item?.year || "",
        rating: item?.rating || "",
        category: item?.category || "",
        storyline: item?.storyline || "",
        type: item?.type || "series",
        tmdbId: item?.tmdbId || null,
        addedAt: Number(item?.addedAt || item?.createdAt || 0),
        customSeasons: Array.isArray(item?.customSeasons) ? item.customSeasons : [],
      }))
        .filter((item) => isMovieMode ? (item.type === "movies" || item.type === "movie") : !(item.type === "movies" || item.type === "movie"));
      items.sort((a, b) => a.title.localeCompare(b.title));
      setSelectedItems(items);
      setLoading(false);
    });
    const unsubWeb = onValue(ref(db, "webseries"), (snap) => setWebseries(snap.val() || {}));
    const unsubMovies = onValue(ref(db, "movies"), (snap) => setMovies(snap.val() || {}));
    return () => { unsubSelected(); unsubWeb(); unsubMovies(); };
  }, [isMovieMode]);

  const targetData = isMovieMode ? movies : webseries;
  const targetIdForSlug = isMovieMode ? movieIdForSlug : webseriesIdForSlug;
  const targetBySlug = useMemo(() => {
    const map = new Map<string, { id: string; data: any }>();
    Object.entries(targetData || {}).forEach(([id, data]: [string, any]) => {
      const slug = String(data?.anSlug || data?.animeSaltSlug || "").trim();
      if (slug) map.set(slug, { id, data });
    });
    return map;
  }, [targetData]);

  // Title-based index of NON-AN (manually added in RS) series, so we can skip
  // fetching anime that the admin already maintains in RS. AN-generated entries
  // are excluded here because those legitimately belong to AN.
  const rsTitleIndex = useMemo(() => {
    const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const map = new Map<string, { id: string; data: any }>();
    Object.entries(targetData || {}).forEach(([id, data]: [string, any]) => {
      const anSlug = String(data?.anSlug || data?.animeSaltSlug || "").trim();
      if (anSlug) return; // skip AN-generated
      const title = norm(data?.title || "");
      if (title) map.set(title, { id, data });
    });
    return { map, norm };
  }, [targetData]);

  const enrichedItems = useMemo(() => selectedItems.map((item) => {
    const itemId = targetIdForSlug(item.slug);
    const existing = targetBySlug.get(item.slug) || (targetData[itemId] ? { id: itemId, data: targetData[itemId] } : null);
    const rsConflict = !existing ? rsTitleIndex.map.get(rsTitleIndex.norm(item.title)) || null : null;
    return { ...item, webseriesId: existing?.id || "", saved: existing?.data || null, rsConflict };
  }), [selectedItems, targetData, targetBySlug, targetIdForSlug, rsTitleIndex]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enrichedItems;
    return enrichedItems.filter((item) => item.title.toLowerCase().includes(q) || item.slug.toLowerCase().includes(q));
  }, [enrichedItems, search]);

  const addedCount = enrichedItems.filter((item) => item.saved).length;
  const skippedCount = enrichedItems.filter((item) => !item.saved && item.rsConflict).length;
  const pendingCount = Math.max(0, enrichedItems.length - addedCount - skippedCount);

  const fetchAndSaveSeries = async (item: SelectedAnItem, opts: { silentSkip?: boolean; force?: boolean } = {}) => {
    if (!item.slug) return;
    // Skip if a manually-added RS series with the same title already exists.
    // Admin can delete the RS entry and retry to allow AN to take over.
    const itemId = targetIdForSlug(item.slug);
    const rsConflict = !targetBySlug.get(item.slug) && !targetData[itemId]
      ? rsTitleIndex.map.get(rsTitleIndex.norm(item.title))
      : null;
    if (rsConflict && !opts.force) {
      if (!opts.silentSkip) toast.info(`Skipped "${item.title}" — already exists in RS. Delete the RS entry to fetch from AN.`);
      return;
    }
    if (!item.category) {
      if (!opts.silentSkip) toast.error(`Category missing for ${item.title}. Set it in AnimeSalt Manager first.`);
      return;
    }
    setBusySlug(item.slug);
    try {
      const base = await getAnApiBase();
      if (!base) throw new Error("AN API URL is not configured in EGD Router");
      const existing = targetBySlug.get(item.slug);
      const targetId = existing?.id || targetIdForSlug(item.slug);
      const isMovie = isMovieMode;
      const detailResult: any = isMovie ? await animeSaltApi.getMovie(item.slug, true) : await animeSaltApi.getSeries(item.slug, true);
      const detail = detailResult?.data || detailResult;
      const customSeasons = !isMovie && Array.isArray(item.customSeasons) && item.customSeasons.length > 0 ? item.customSeasons : [];
      const apiSeasons = !isMovie && Array.isArray(detail?.seasons) ? detail.seasons : [];
      const rawSeasons = customSeasons.length
        ? customSeasons
        : apiSeasons.length
        ? apiSeasons
        : [{ name: "Season 1", episodes: [{ number: 1, title: detail?.title || item.title, slug: item.slug, _moviePayload: detail }] }];

      const seasons: RsSeason[] = [];
      const anSeriesEpisodes: Record<string, any> = {};
      const detectedLanguages = new Set<string>();
      const savedAt = Date.now();

      await Promise.all(rawSeasons.map(async (season: any, sIdx: number) => {
        const fetched = await mapLimit(season.episodes || [], 4, async (ep: any, eIdx: number) => {
          const epSlug = String(ep?.slug || "").trim();
          const fallback = { number: Number(ep?.number || ep?.episodeNumber || eIdx + 1), title: ep?.title || `Episode ${eIdx + 1}`, slug: epSlug };
          const hasManualLinks = !!(ep?.link || ep?.link480 || ep?.link720 || ep?.link1080 || ep?.link4k || (Array.isArray(ep?.audioTracks) && ep.audioTracks.length));
          const playbackPayload = ep?._moviePayload || (epSlug ? await animeSaltApi.getEpisode(epSlug, true) : null);
          const payload = normalizePlaybackPayload(playbackPayload || {});
          const rsEpisode = mergeCustomEpisodeFields(playbackToRsEpisode(base, payload, fallback), hasManualLinks ? ep : {}, fallback);
          return { epSlug: epSlug || `s${sIdx}_e${eIdx}`, rsEpisode, payload, fallback };
        });
        const episodes: RsEpisode[] = [];
        fetched.forEach(({ epSlug, rsEpisode, payload, fallback }) => {
          if (!rsEpisode?.link) return;
          episodes.push(rsEpisode);
          rsEpisode.audioTracks.forEach((track) => detectedLanguages.add(track.label || track.language));
          if (epSlug) {
            anSeriesEpisodes[epSlug] = cleanStoredAnEpisodePayload(rsEpisode, payload, fallback, epSlug, savedAt);
          }
        });
        seasons[sIdx] = {
          name: season?.name || `Season ${sIdx + 1}`,
          seasonNumber: Number(season?.seasonNumber || sIdx + 1),
          episodes,
        };
      }));

      const languages = Array.from(new Set(Array.from(detectedLanguages).map((lang) => String(lang || "").trim()).filter(Boolean)));
      const baseLanguage = languages[0] || "Multi";
      const orderedLanguages = Array.from(new Set([baseLanguage, ...languages].filter(Boolean)));
      const seasonsByLanguage = Object.fromEntries(
        orderedLanguages.map((lang) => [lang, cloneSeasonsForAudioLanguage(seasons, lang)]),
      );
      const poster = item.poster || detail?.poster || "";
      const backdrop = item.backdrop || detail?.backdrop || poster;

      if (isMovieMode) {
        const movieEp = seasons[0]?.episodes?.[0];
        if (!movieEp?.link) throw new Error("No playable 1080p/direct HLS link found for this AN movie");
        const movieData = {
          ...(existing?.data || {}),
          anSlug: item.slug,
          title: detail?.title || item.title,
          poster,
          backdrop,
          year: detail?.year || item.year || "",
          rating: detail?.rating || item.rating || "",
          category: item.category,
          storyline: detail?.storyline || item.storyline || "",
          tmdbId: item.tmdbId || existing?.data?.tmdbId || null,
          language: orderedLanguages.length > 2 ? "Multiple" : orderedLanguages.length === 2 ? "Dual" : baseLanguage,
          baseLanguage,
          availableLanguages: orderedLanguages.length ? orderedLanguages : [baseLanguage],
          audioTracks: movieEp.audioTracks || [],
          defaultAudio: movieEp.defaultAudio || null,
          movieLink: movieEp.link,
          movieLink480: movieEp.link480 || "",
          movieLink720: movieEp.link720 || "",
          movieLink1080: movieEp.link1080 || movieEp.link || "",
          movieLink4k: movieEp.link4k || "",
          dubType: existing?.data?.dubType || "official",
          visibility: existing?.data?.visibility || "public",
          type: "movie",
          source: "animesalt",
          sourceName: "AnimeSalt",
          displayAs: existing?.data?.displayAs || "an",
          updatedAt: savedAt,
          createdAt: existing?.data?.createdAt || item.addedAt || savedAt,
        };
        await set(ref(db, `movies/${targetId}`), stripUndefined(movieData));
        await set(ref(db, `anSeries/${item.slug}/meta`), stripUndefined({
          title: movieData.title, poster, backdrop, type: "movies", storyline: movieData.storyline, movieId: targetId, updatedAt: savedAt,
        }));
        await set(ref(db, `anSeries/${item.slug}/episodes/${item.slug}`), cleanStoredAnEpisodePayload(movieEp, normalizePlaybackPayload(detail || {}) || {}, { number: 1, title: movieEp.title || movieData.title }, item.slug, savedAt));
        toast.success(`✓ ${movieData.title} saved as AN movie`);
        return;
      }

      const seriesData = {
        ...(existing?.data || {}),
        anSlug: item.slug,
        title: detail?.title || item.title,
        poster,
        backdrop,
        year: detail?.year || item.year || "",
        rating: detail?.rating || item.rating || "",
        category: item.category,
        storyline: detail?.storyline || item.storyline || "",
        tmdbId: item.tmdbId || existing?.data?.tmdbId || null,
        language: orderedLanguages.length > 2 ? "Multiple" : orderedLanguages.length === 2 ? "Dual" : baseLanguage,
        baseLanguage,
        selectedAdminLanguage: baseLanguage,
        availableLanguages: orderedLanguages.length ? orderedLanguages : [baseLanguage],
        seasons,
        seasonsByLanguage,
        audioTracks: (orderedLanguages.length ? orderedLanguages : [baseLanguage]).map((lang) => ({ language: lang, label: lang, link: "" })),
        dubType: existing?.data?.dubType || "official",
        visibility: existing?.data?.visibility || "public",
        type: "webseries",
        source: "animesalt",
        sourceName: "AnimeSalt",
        // Default label on the public card. Admin can flip to "rs" later.
        displayAs: existing?.data?.displayAs || "an",
        updatedAt: savedAt,
        createdAt: existing?.data?.createdAt || item.addedAt || savedAt,
      };

      await set(ref(db, `webseries/${targetId}`), stripUndefined(seriesData));
      await set(ref(db, `anSeries/${item.slug}/meta`), stripUndefined({
        title: seriesData.title,
        poster,
        backdrop,
        type: isMovie ? "movies" : "series",
        storyline: seriesData.storyline,
        episodeCount: seasons.reduce((sum, season) => sum + season.episodes.length, 0),
        webseriesId: targetId,
        updatedAt: savedAt,
      }));
      await Promise.all(Object.entries(anSeriesEpisodes).map(([epSlug, payload]) => set(ref(db, `anSeries/${item.slug}/episodes/${epSlug}`), stripUndefined(payload))));
      toast.success(`✓ ${seriesData.title} saved like RS series`);
    } catch (err: any) {
      toast.error(err?.message || `Fetch failed for ${item.title}`);
    } finally {
      setBusySlug(null);
    }
  };

  const fetchAllPending = async () => {
    const pending = enrichedItems.filter((item) => !item.saved && !item.rsConflict);
    if (!pending.length) {
      toast.info(skippedCount ? `${label}: nothing to fetch — ${skippedCount} skipped (already in RS).` : "Nothing pending.");
      return;
    }
    setBulkRunning(true);
    for (const item of pending) await fetchAndSaveSeries(item, { silentSkip: true });
    setBulkRunning(false);
    toast.success(`${label}: fetched ${pending.length}${skippedCount ? ` • Skipped ${skippedCount} (already in RS)` : ""}`);
  };

  const deleteGeneratedSeries = async (item: SelectedAnItem & { webseriesId?: string }) => {
    const targetId = item.webseriesId || targetIdForSlug(item.slug);
    if (!confirm(`Delete generated ${label} card for "${item.title}"?`)) return;
    await remove(ref(db, `${isMovieMode ? "movies" : "webseries"}/${targetId}`));
    await remove(ref(db, `anSeries/${item.slug}`));
    toast.success(`Generated ${label} card deleted`);
  };

  return (
    <div className={`${glassCard} p-4 mb-4`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Database size={14} className="text-emerald-400" /> {label}</h3>
        <button onClick={fetchAllPending} disabled={bulkRunning || pendingCount === 0} className={`${btnPrimary} px-3 py-2 text-[11px] flex items-center gap-1.5 disabled:opacity-50`}>
          {bulkRunning ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Fetch All Pending
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="bg-purple-500/15 border border-purple-500/20 rounded-xl px-2.5 py-2"><div className="text-[10px] text-purple-300">Total</div><div className="text-base font-bold">{enrichedItems.length}</div></div>
        <div className="bg-emerald-500/15 border border-emerald-500/20 rounded-xl px-2.5 py-2"><div className="text-[10px] text-emerald-300">Added</div><div className="text-base font-bold">{addedCount}</div></div>
        <div className="bg-amber-500/15 border border-amber-500/20 rounded-xl px-2.5 py-2"><div className="text-[10px] text-amber-300">Pending</div><div className="text-base font-bold">{pendingCount}</div></div>
        <div className="bg-sky-500/15 border border-sky-500/20 rounded-xl px-2.5 py-2"><div className="text-[10px] text-sky-300">In RS</div><div className="text-base font-bold">{skippedCount}</div></div>
      </div>

      <div className="sticky top-0 z-30 -mx-4 px-4 py-2 mb-3 bg-[#0D0D1A]/95 backdrop-blur-md border-y border-white/5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} pl-9`} placeholder={`Search ${label}`} />
        </div>
      </div>

      {loading ? (
        <div className="text-center text-xs text-zinc-400 py-8">{`Loading ${label}…`}</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center text-xs text-zinc-400 py-8">No selected items found here. Add matching AN content from AnimeSalt Manager first.</div>
      ) : (
        <div>
          {filteredItems.map((item) => {
            const saved = !!item.saved;
            const episodeCount = item.saved?.seasons?.reduce((sum: number, season: any) => sum + (season?.episodes?.length || 0), 0) || 0;
            const isBusy = busySlug === item.slug;
            return (
              <div key={item.slug} className="bg-[#1A1A2E] border border-white/5 rounded-[14px] p-3.5 mb-3 hover:border-purple-500/30 transition-all">
                <div className="flex gap-3.5">
                  <CachedImg src={item.poster || ""} alt="" className="w-20 h-[115px] rounded-[10px] object-cover flex-shrink-0 bg-black/40" loading="lazy" decoding="async" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <h4 className="text-sm font-semibold mb-1 truncate flex-1">{item.title || "Untitled"}</h4>
                      {saved ? <span className="text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 px-2 py-0.5 flex items-center gap-1"><CheckCircle2 size={10} /> Added</span> : item.rsConflict ? <span className="text-[10px] rounded-full bg-sky-500/20 text-sky-300 px-2 py-0.5">In RS</span> : <span className="text-[10px] rounded-full bg-amber-500/20 text-amber-300 px-2 py-0.5">Pending</span>}
                    </div>
                    <p className="text-[11px] text-[#D1C4E9] mb-2">{item.year || "N/A"} • {item.rating || "N/A"}⭐ • {item.category || "No Category"}</p>
                    <p className="text-[11px] text-[#D1C4E9]">{saved ? isMovieMode ? "Movie • AN Firebase card" : `${episodeCount} Episodes • AN Firebase card` : item.rsConflict ? "Already exists in RS — delete RS entry to fetch from AN" : isMovieMode ? "Click Fetch to save direct 1080p video/audio into Movies" : "Click Fetch to save direct 1080p video/audio into Series"}</p>
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {saved ? (
                        <>
                          <button onClick={() => (isMovieMode ? onEditMovie : onEditSeries)?.(item.webseriesId)} className={`${btnSecondary} px-3.5 py-2 text-[11px] font-semibold flex items-center gap-1.5`}>
                            <Edit size={12} /> Edit
                          </button>
                          <button onClick={() => fetchAndSaveSeries(item)} disabled={isBusy} className={`${btnSecondary} px-3.5 py-2 text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50`}>
                            {isBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
                          </button>
                          <button onClick={() => deleteGeneratedSeries(item)} className="bg-red-500/20 border border-red-500/30 text-pink-500 px-3.5 py-2 rounded-xl text-[11px] font-semibold flex items-center gap-1.5">
                            <Trash2 size={12} /> Delete
                          </button>
                        </>
                      ) : item.rsConflict ? (
                        <span className="text-[11px] text-sky-300/80 px-1 py-2">Skipped (in RS)</span>
                      ) : (
                        <button onClick={() => fetchAndSaveSeries(item)} disabled={isBusy || bulkRunning} className={`${btnPrimary} px-3.5 py-2 text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50`}>
                          {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Fetch
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AnSeriesManager;