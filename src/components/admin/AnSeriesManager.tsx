import { useEffect, useMemo, useState } from "react";
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
};

type RsEpisode = {
  episodeNumber: number;
  title: string;
  link: string;
  link480?: string;
  link720?: string;
  link1080?: string;
  link4k?: string;
  audioTracks?: { language: string; label: string; link: string; link480?: string; link720?: string; link1080?: string; link4k?: string }[];
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

// HLS URLs from AnimeSalt are plain HTTPS and play directly through hls.js /
// native HLS. We deliberately do NOT wrap them in the AN-API /hls relay any
// more — direct playback is faster and removes a fragile hop. If an old URL
// is already proxied, strip the wrapper back to the original URL so playback
// goes straight to the CDN.
const reliableHls = (_base: string, url?: string | null) => {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const proxyMatch = raw.match(/\/an-api\/hls\?url=([^&]+)/i);
  if (proxyMatch) {
    try { return decodeURIComponent(proxyMatch[1]); } catch { return raw; }
  }
  return raw;
};

const encodeMaster = (content: string) => `data:application/vnd.apple.mpegurl;base64,${btoa(unescape(encodeURIComponent(content)))}`;

const buildSyntheticMaster = (
  _base: string,
  stream: { url: string; label?: string; height?: number; bandwidth?: number; resolution?: string },
  audio: Array<{ uri?: string; name?: string; language?: string }>,
  defaultAudioIdx = 0,
) => {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6"];
  audio.forEach((track, index) => {
    const uri = reliableHls(_base, track?.uri);
    if (!uri) return;
    const name = String(track?.name || track?.language || `Audio ${index + 1}`).replace(/"/g, "").trim();
    const lang = String(track?.language || name || `aud${index + 1}`).replace(/"/g, "").trim().toLowerCase();
    lines.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="${name}",LANGUAGE="${lang}",DEFAULT=${index === defaultAudioIdx ? "YES" : "NO"},AUTOSELECT=YES,URI="${uri}"`);
  });
  const audioRef = audio.some((track) => String(track?.uri || "").trim()) ? ',AUDIO="aud"' : "";
  const height = Number(stream?.height || String(stream?.label || "").match(/\d{3,4}/)?.[0] || 720);
  lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${stream.bandwidth || Math.max(height * 5000, 1_500_000)},RESOLUTION=${stream.resolution || `${Math.round((height * 16) / 9)}x${height}`}${audioRef}`);
  lines.push(reliableHls(_base, stream.url));
  return encodeMaster(lines.join("\n"));
};

const pickDefaultAudioIdx = (audio: Array<{ language?: string; name?: string }>) => {
  const hindi = audio.findIndex((track) => /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${track?.language || ""} ${track?.name || ""}`));
  return hindi >= 0 ? hindi : 0;
};

const qualityField = (label?: string, height?: number): "link480" | "link720" | "link1080" | "link4k" | null => {
  const text = `${label || ""} ${height || ""}`.toLowerCase();
  if (/2160|4k/.test(text)) return "link4k";
  if (/1080/.test(text)) return "link1080";
  if (/720/.test(text)) return "link720";
  if (/480/.test(text)) return "link480";
  return null;
};

const normalizePlaybackPayload = (payload: any) => payload?.data && !payload?.sources ? payload.data : payload;

const extractStreams = (payload: any) => {
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
  const direct = String(payload?.directUrl || payload?.streamUrl || payload?.videoUrl || payload?.file || "").trim();
  return [...sourceStreams, ...linkStreams, direct ? { url: direct, label: "Auto" } : null]
    .filter((entry: any) => entry?.url)
    .map((entry: any, index: number) => ({
      url: String(entry.url).trim(),
      label: String(entry.label || (entry.height ? `${entry.height}p` : index === 0 ? "Auto" : `Source ${index + 1}`)),
      height: Number(entry.height || String(entry.label || "").match(/\d{3,4}/)?.[0] || 0) || undefined,
      bandwidth: Number(entry.bandwidth || 0) || undefined,
      resolution: entry.resolution,
    }));
};

const extractAudio = (payload: any) => {
  const fromSources = Array.isArray(payload?.sources)
    ? payload.sources.flatMap((source: any) => Array.isArray(source?.audio) ? source.audio : [])
    : [];
  const seen = new Set<string>();
  return fromSources
    .map((track: any) => ({
      uri: String(track?.uri || track?.url || "").trim(),
      name: String(track?.name || track?.label || track?.language || "Audio").trim(),
      language: String(track?.language || track?.name || track?.label || "Audio").trim(),
    }))
    .filter((track) => {
      const key = `${track.language.toLowerCase()}|${track.uri}`;
      if (!track.uri || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const playbackToRsEpisode = (base: string, rawPayload: any, fallback: { number: number; title: string; slug?: string }): RsEpisode => {
  const payload = normalizePlaybackPayload(rawPayload);
  const streams = extractStreams(payload);
  const audio = extractAudio(payload);
  const defaultAudioIdx = typeof payload?.defaultAudioIdx === "number" ? payload.defaultAudioIdx : pickDefaultAudioIdx(audio);
  const preferredStream = streams.find((stream) => Number(stream.height) === 1080) || streams.find((stream) => Number(stream.height) >= 720) || streams[0];
  const makeUrl = (stream?: any, audioIdx = defaultAudioIdx) => {
    if (!stream?.url) return "";
    const raw = String(stream.url || "").trim();
    const isHls = /\.m3u8(?:[?#].*)?$/i.test(raw);
    if (!isHls) return raw;
    return audio.length ? buildSyntheticMaster(base, stream, audio, audioIdx) : reliableHls(base, raw);
  };
  const episode: RsEpisode = {
    episodeNumber: fallback.number,
    title: String(payload?.title || fallback.title || `Episode ${fallback.number}`).trim(),
    link: "",
  };
  streams.forEach((stream) => {
    const field = qualityField(stream.label, stream.height);
    if (field && !episode[field]) episode[field] = makeUrl(stream);
  });
  if (audio.length) {
    episode.audioTracks = audio.map((track, index) => {
      const label = String(track.name || track.language || `Audio ${index + 1}`).trim();
      const mapped: NonNullable<RsEpisode["audioTracks"]>[number] = {
        language: String(track.language || label).trim(),
        label,
        link: makeUrl(preferredStream, index),
      };
      streams.forEach((stream) => {
        const field = qualityField(stream.label, stream.height);
        if (field && !(mapped as any)[field]) (mapped as any)[field] = makeUrl(stream, index);
      });
      return mapped;
    });
  }
  // Admin editor has separate fields for Default, 1080p, 480p, 720p and 4K.
  // The requested behavior is: the Default field must contain the 1080p AN URL
  // whenever 1080p exists, not a generic/auto/first URL. Keep the explicit
  // 1080p field populated with the same playable source as well.
  episode.link = makeUrl(streams.find((stream) => Number(stream.height) === 1080) || preferredStream);
  if (episode.audioTracks?.length) {
    episode.audioTracks = episode.audioTracks.map((track) => ({
      ...track,
      link: track.link1080 || track.link,
    }));
  }
  return episode;
};

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
      const detailResult: any = isMovie ? await animeSaltApi.getMovie(item.slug) : await animeSaltApi.getSeries(item.slug);
      const detail = detailResult?.data || detailResult;
      const apiSeasons = !isMovie && Array.isArray(detail?.seasons) ? detail.seasons : [];
      const rawSeasons = apiSeasons.length
        ? apiSeasons
        : [{ name: "Season 1", episodes: [{ number: 1, title: detail?.title || item.title, slug: item.slug, _moviePayload: detail }] }];

      const seasons: RsSeason[] = [];
      const anSeriesEpisodes: Record<string, any> = {};
      const detectedLanguages = new Set<string>();

      await Promise.all(rawSeasons.map(async (season: any, sIdx: number) => {
        const fetched = await mapLimit(season.episodes || [], 16, async (ep: any, eIdx: number) => {
          const epSlug = String(ep?.slug || "").trim();
          const fallback = { number: Number(ep?.number || ep?.episodeNumber || eIdx + 1), title: ep?.title || `Episode ${eIdx + 1}`, slug: epSlug };
          const playbackPayload = ep?._moviePayload || (epSlug ? await animeSaltApi.getEpisode(epSlug) : null);
          const payload = normalizePlaybackPayload(playbackPayload || {});
          const rsEpisode = playbackToRsEpisode(base, payload, fallback);
          return { epSlug, rsEpisode, payload, fallback };
        });
        const episodes: RsEpisode[] = [];
        fetched.forEach(({ epSlug, rsEpisode, payload, fallback }) => {
          if (!rsEpisode?.link) return;
          episodes.push(rsEpisode);
          (rsEpisode.audioTracks || []).forEach((track) => detectedLanguages.add(track.label || track.language));
          if (epSlug) {
            anSeriesEpisodes[epSlug] = {
              ...payload,
              slug: epSlug,
              number: fallback.number,
              title: rsEpisode.title,
              broken: !rsEpisode.link,
              updatedAt: Date.now(),
            };
          }
        });
        seasons[sIdx] = {
          name: season?.name || `Season ${sIdx + 1}`,
          seasonNumber: Number(season?.seasonNumber || sIdx + 1),
          episodes,
        };
      }));

      const languages = Array.from(detectedLanguages).filter(Boolean);
      const baseLanguage = languages.find((lang) => /hindi/i.test(lang)) || languages[0] || "Hindi";
      const savedAt = Date.now();
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
          language: languages.length > 2 ? "Multiple" : languages.length === 2 ? "Dual" : baseLanguage,
          baseLanguage,
          availableLanguages: languages.length ? languages : [baseLanguage],
          audioTracks: movieEp.audioTracks || [],
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
        language: languages.length > 2 ? "Multiple" : languages.length === 2 ? "Dual" : baseLanguage,
        baseLanguage,
        selectedAdminLanguage: baseLanguage,
        availableLanguages: languages.length ? languages : [baseLanguage],
        seasons,
        seasonsByLanguage: { [baseLanguage]: seasons },
        audioTracks: (languages.length ? languages : [baseLanguage]).map((lang) => ({ language: lang, label: lang, link: "" })),
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
                  <img src={item.poster || ""} alt="" className="w-20 h-[115px] rounded-[10px] object-cover flex-shrink-0 bg-black/40" loading="lazy" />
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