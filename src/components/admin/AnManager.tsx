import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { db, ref, onValue, set, remove, update } from "@/lib/firebase";
import { toast } from "sonner";
import {
  RefreshCw,
  Trash2,
  Plus,
  CheckSquare,
  Square,
  ImageIcon,
  Search,
  Edit3,
  X,
  Loader2,
  Power,
  Film,
  Layers,
  Tv,

} from "lucide-react";
import { animeSaltApi, isAnimeSaltAllowedAnime } from "@/lib/animeSaltApi";
import { AN_DEDUPE_SETTING_PATH, normalizeAnTitleKey, subscribeAnDedupeEnabled, subscribeRsTitleKeys } from "@/lib/anDedupe";

import { TMDB_API_KEY, TMDB_BASE_URL, TMDB_IMG_BASE } from "@/lib/siteConfig";
import CachedImg, { preloadCachedImages } from "@/components/CachedImg";

/**
 * AN Manager — pure API-driven curation.
 *
 * Browse list comes from `animeSaltApi.browseAll()` (cached 30 min).
 * "Save" stores slug + TMDB-enriched metadata to `animesaltSelected/{slug}`.
 * Short-lived playback URLs are cached later by the user panel in
 * `anPlaybackCache/*` with an expiry timer for smooth episode switching.
 */

type AnType = "series" | "movies";
type ApiItem = { slug: string; title: string; poster: string; year: string; type: AnType };
type SavedItem = ApiItem & {
  tmdbId?: number;
  rating?: string;
  overview?: string;
  backdrop?: string;
  genres?: string[];
  category?: string;
  directors?: string[];
  cast?: { name: string; character?: string; photo?: string }[];
  savedAt?: number;
};

const AN_MANAGER_CACHE_KEY = "rs_an_manager_cards_v1";
const AN_MANAGER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let anManagerCardsCache: ApiItem[] = [];
let anManagerCardsLoadedAt = 0;
let anManagerLoadPromise: Promise<ApiItem[]> | null = null;

const TMDB_KEY_STORAGE = "rs_admin_tmdb_api_key";
let runtimeTmdbApiKey = "";

const getTmdbApiKey = () => {
  if (runtimeTmdbApiKey.trim()) return runtimeTmdbApiKey.trim();
  if (TMDB_API_KEY.trim()) return TMDB_API_KEY.trim();
  try { return String(localStorage.getItem(TMDB_KEY_STORAGE) || "").trim(); } catch { return ""; }
};

const setRuntimeTmdbKey = (value: string) => {
  runtimeTmdbApiKey = String(value || "").trim();
  try {
    if (runtimeTmdbApiKey) localStorage.setItem(TMDB_KEY_STORAGE, runtimeTmdbApiKey);
    else localStorage.removeItem(TMDB_KEY_STORAGE);
  } catch {}
};

const normalizeType = (v: unknown): AnType =>
  String(v || "").toLowerCase().includes("movie") ? "movies" : "series";

const normalizeItem = (raw: any): ApiItem => ({
  slug: String(raw?.slug || "").trim(),
  title: String(raw?.title || raw?.name || raw?.slug || "Untitled").trim(),
  poster: String(raw?.poster || raw?.image || raw?.thumb || "").trim(),
  year: String(raw?.year || "").trim(),
  type: normalizeType(raw?.type),
});

const cleanTitleForTmdb = (title: string) =>
  title
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/season\s*\d+/gi, " ")
    .replace(/part\s*\d+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

type TmdbResult = {
  id: number;
  title: string;
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
  vote_average?: number;
  first_air_date?: string;
  release_date?: string;
  genre_ids?: number[];
};

const tmdbSearchOne = async (title: string, isSeries: boolean): Promise<TmdbResult[]> => {
  const key = getTmdbApiKey();
  if (!key || !title) return [];
  const kind = isSeries ? "tv" : "movie";
  try {
    const r = await fetch(
      `${TMDB_BASE_URL}/search/${kind}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(title)}&include_adult=false&language=en-US&page=1`,
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (j?.results || []).slice(0, 5).map((x: any) => ({
      id: x.id,
      title: x.name || x.title || "",
      poster_path: x.poster_path,
      backdrop_path: x.backdrop_path,
      overview: x.overview,
      vote_average: x.vote_average,
      first_air_date: x.first_air_date,
      release_date: x.release_date,
    }));
  } catch {
    return [];
  }
};

// Try cleaned title, then progressive truncations until TMDB returns results.
const tmdbSearch = async (title: string, isSeries: boolean): Promise<TmdbResult[]> => {
  const variants = new Set<string>();
  variants.add(title);
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length > 3) variants.add(words.slice(0, 3).join(" "));
  if (words.length > 2) variants.add(words.slice(0, 2).join(" "));
  for (const v of variants) {
    const out = await tmdbSearchOne(v, isSeries);
    if (out.length) return out;
  }
  // As a last resort, try the opposite kind (e.g. movies API for a series slug
  // mistakenly tagged) so the user at least gets metadata.
  return tmdbSearchOne(title, !isSeries);
};

const tmdbDetails = async (id: number, isSeries: boolean) => {
  const key = getTmdbApiKey();
  if (!key || !id) return null;
  try {
    const r = await fetch(
      `${TMDB_BASE_URL}/${isSeries ? "tv" : "movie"}/${id}?api_key=${encodeURIComponent(key)}&language=en-US&append_to_response=credits`,
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
};

const tmdbFetchById = async (id: number, isSeries: boolean): Promise<TmdbResult | null> => {
  const det = await tmdbDetails(id, isSeries);
  if (!det?.id) return null;
  return {
    id: det.id,
    title: det.name || det.title || det.original_name || det.original_title || "",
    poster_path: det.poster_path,
    backdrop_path: det.backdrop_path,
    overview: det.overview,
    vote_average: det.vote_average,
    first_air_date: det.first_air_date,
    release_date: det.release_date,
  };
};

const buildEnriched = async (item: ApiItem, tmdb?: TmdbResult | null): Promise<SavedItem> => {
  const base: SavedItem = { ...item, savedAt: Date.now() };
  if (!tmdb) return base;
  const isSeries = item.type === "series";
  const det = await tmdbDetails(tmdb.id, isSeries);
  const genres = Array.isArray(det?.genres)
    ? det.genres.map((g: any) => String(g?.name || "").trim()).filter(Boolean)
    : [];
  const directors = Array.isArray(det?.credits?.crew)
    ? det.credits.crew
        .filter((c: any) => /director/i.test(String(c?.job || "")))
        .map((c: any) => String(c?.name || "").trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const cast = Array.isArray(det?.credits?.cast)
    ? det.credits.cast
        .map((c: any) => ({
          name: String(c?.name || "").trim(),
          character: String(c?.character || "").trim(),
          photo: c?.profile_path ? `${TMDB_IMG_BASE}w185${c.profile_path}` : "",
        }))
        .filter((c: any) => c.name)
        .slice(0, 10)
    : [];
  const releaseDate = tmdb.first_air_date || tmdb.release_date || det?.first_air_date || det?.release_date || "";
  return {
    ...base,
    tmdbId: tmdb.id,
    rating: (tmdb.vote_average || det?.vote_average) ? Number(tmdb.vote_average || det?.vote_average).toFixed(1) : "",
    overview: tmdb.overview || det?.overview || "",
    backdrop: tmdb.backdrop_path ? `${TMDB_IMG_BASE}original${tmdb.backdrop_path}` : (det?.backdrop_path ? `${TMDB_IMG_BASE}original${det.backdrop_path}` : ""),
    poster: tmdb.poster_path ? `${TMDB_IMG_BASE}w500${tmdb.poster_path}` : (det?.poster_path ? `${TMDB_IMG_BASE}w500${det.poster_path}` : item.poster),
    genres,
    year: item.year || String(releaseDate || "").slice(0, 4),
    ...(directors.length ? { directors } as any : {}),
    ...(cast.length ? { cast } as any : {}),
  };
};

const SELECTED_PATH = "animesaltSelected";
const SETTINGS_PATH = "settings/animeSaltEnabled";
const GENERIC_CATEGORIES = new Set(["", "anime", "animesalt"]);

const normalizeGenres = (genres?: string[]) =>
  Array.isArray(genres) ? genres.map((g) => String(g || "").trim()).filter(Boolean) : [];

const autoCategoryFromGenres = (genres?: string[]) => normalizeGenres(genres).join(", ");

const resolveSavedCategory = (manualCategory: string | undefined, genres?: string[], fallback = "Anime") => {
  const manual = String(manualCategory || "").trim();
  if (manual && !GENERIC_CATEGORIES.has(manual.toLowerCase())) return manual;
  return autoCategoryFromGenres(genres) || manual || fallback;
};

const hasRealCategory = (item: Pick<SavedItem, "category" | "genres">) => {
  const cat = String(item.category || "").trim().toLowerCase();
  return (!!cat && !GENERIC_CATEGORIES.has(cat)) || normalizeGenres(item.genres).length > 0;
};

const PLAYABLE_CACHE_PREFIX = "rs_an_playable_v2:";
const PLAYABLE_OK_TTL = 24 * 60 * 60 * 1000;
const PLAYABLE_FAIL_TTL = 2 * 60 * 60 * 1000;
const playableCacheKey = (item: Pick<ApiItem, "type" | "slug">) => `${PLAYABLE_CACHE_PREFIX}${item.type}:${item.slug}`;

const readPlayableCache = (item: ApiItem, force = false): boolean | null => {
  if (force) return null;
  try {
    const raw = localStorage.getItem(playableCacheKey(item));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ttl = parsed?.ok ? PLAYABLE_OK_TTL : PLAYABLE_FAIL_TTL;
    if (!parsed?.ts || Date.now() - Number(parsed.ts) > ttl) {
      localStorage.removeItem(playableCacheKey(item));
      return null;
    }
    return parsed.ok === true;
  } catch { return null; }
};

const writePlayableCache = (item: ApiItem, ok: boolean) => {
  try { localStorage.setItem(playableCacheKey(item), JSON.stringify({ ok, ts: Date.now() })); } catch {}
};

const playbackHasMedia = (payload: any) => {
  const data = payload?.data || payload;
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const links = Array.isArray(data?.links) ? data.links : [];
  const audio = Array.isArray(data?.audio) ? data.audio : [];
  const sourceStreams = Array.isArray(data?.sources)
    ? data.sources.flatMap((s: any) => Array.isArray(s?.streams) ? s.streams : [])
    : [];
  const sourceAudio = Array.isArray(data?.sources)
    ? data.sources.flatMap((s: any) => Array.isArray(s?.audio) ? s.audio : [])
    : [];
  const hlsLinks = links.filter((l: any) => /\.m3u8(?:$|\?)/i.test(String(l?.url || l || "")));
  const hasVideo = streams.length > 0 || sourceStreams.length > 0 || hlsLinks.length > 0 || /\.m3u8(?:$|\?)/i.test(String(data?.directUrl || data?.videoSource || data?.securedLink || ""));
  const declaredAudio = audio.length + sourceAudio.length;
  // Admin list must contain only titles whose real video stream is resolved.
  // Embed-only pages are rejected because they may fail later in the player.
  const hasAudio = declaredAudio > 0 || !Array.isArray(data?.audio);
  return !!hasVideo && !!hasAudio && data?.success !== false;
};

const verifyAnPlayable = async (item: ApiItem, force = false): Promise<boolean> => {
  const cached = readPlayableCache(item, force);
  if (cached !== null) return cached;
  let ok = false;
  try {
    if (item.type === "movies") {
      const movie = await animeSaltApi.getMovie(item.slug, force);
      ok = playbackHasMedia(movie?.data || movie);
    } else {
      const series: any = await animeSaltApi.getSeries(item.slug, force);
      const seasons = series?.data?.seasons || series?.seasons || [];
      const epSlugs = seasons
        .flatMap((s: any) => Array.isArray(s?.episodes) ? s.episodes : [])
        .map((ep: any) => String(ep?.slug || ep?.episodeSlug || "").trim())
        .filter(Boolean)
        .slice(0, 3);
      for (const epSlug of epSlugs) {
        const ep = await animeSaltApi.getEpisode(epSlug, force).catch(() => null);
        if (playbackHasMedia(ep)) { ok = true; break; }
      }
    }
  } catch {
    ok = false;
  }
  writePlayableCache(item, ok);
  return ok;
};

// Admin AN Manager only fetches the anime card list — no playability probe.
// Playback URLs are resolved on-demand from the user panel when a card is opened.
const filterPlayableItems = async (items: ApiItem[], _force = false, onProgress?: (done: number, total: number) => void): Promise<ApiItem[]> => {
  onProgress?.(items.length, items.length);
  return items;
};

export default function AnManager({
  categoryList,
  glassCard,
  inputClass,
  btnPrimary,
  btnSecondary,
  selectClass,
}: {
  categoryList: { id: string; name: string }[];
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
  selectClass: string;
}) {
  const [apiItems, setApiItems] = useState<ApiItem[]>(() => anManagerCardsCache);
  const [saved, setSaved] = useState<Record<string, SavedItem>>({});
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "series" | "movies" | "saved">("all");
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [verifyProgress, setVerifyProgress] = useState({ done: 0, total: 0 });
  const [category, setCategory] = useState("");
  const [imgVersion, setImgVersion] = useState(0);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [dedupeOn, setDedupeOn] = useState(false);
  const [rsKeys, setRsKeys] = useState<Set<string>>(() => new Set());

  const [tmdbPicker, setTmdbPicker] = useState<{ item: ApiItem; results: TmdbResult[] } | null>(null);
  const [editing, setEditing] = useState<SavedItem | null>(null);
  const [tmdbKeyInput, setTmdbKeyInput] = useState(() => getTmdbApiKey());
  const [tmdbBusySlug, setTmdbBusySlug] = useState<string | null>(null);
  const [tmdbKeyVersion, setTmdbKeyVersion] = useState(0);
  const [quickTmdbIds, setQuickTmdbIds] = useState<Record<string, string>>({});

  const hasTmdbKey = useMemo(() => !!getTmdbApiKey(), [tmdbKeyVersion]);

  // Load API list only when cache is missing/stale or admin presses Refresh.
  const loadFromApi = async (forceRefresh = false): Promise<ApiItem[]> => {
    try {
      if (forceRefresh) {
        try { localStorage.removeItem("rs_cache_animesalt_api_cards_v2"); localStorage.removeItem("rs_cache_animesalt_api_cards_v3"); localStorage.removeItem("animesalt_all_v3"); } catch {}
        anManagerCardsLoadedAt = 0;
      }
      if (!forceRefresh && anManagerCardsCache.length && Date.now() - anManagerCardsLoadedAt < AN_MANAGER_CACHE_TTL_MS) return anManagerCardsCache;
      if (!forceRefresh && anManagerLoadPromise) return anManagerLoadPromise;
      const promise = (async () => {
      const r = await animeSaltApi.browseAll(forceRefresh);
      const mapped = (r?.items || []).map(normalizeItem).filter((x) => x.slug && x.title && isAnimeSaltAllowedAnime(x));
      // de-dup by slug, prefer series flavour
      const dedup = new Map<string, ApiItem>();
      mapped.forEach((x) => { if (!dedup.has(x.slug)) dedup.set(x.slug, x); });
      const candidates = Array.from(dedup.values());
      setVerifyProgress({ done: 0, total: candidates.length });
      let lastProgress = 0;
      const playable = await filterPlayableItems(candidates, forceRefresh, (done, total) => {
        if (done === total || done - lastProgress >= 6) {
          lastProgress = done;
          startTransition(() => setVerifyProgress({ done, total }));
        }
      });
      anManagerCardsCache = playable;
      anManagerCardsLoadedAt = Date.now();
      try { localStorage.setItem(AN_MANAGER_CACHE_KEY, JSON.stringify({ ts: anManagerCardsLoadedAt, items: playable })); } catch {}
      void preloadCachedImages(playable.map((item) => item.poster), 120);
      return playable;
      })();
      anManagerLoadPromise = promise.finally(() => { anManagerLoadPromise = null; });
      return anManagerLoadPromise;
    } catch (e: any) {
      toast.error("AN API load failed: " + (e?.message || "unknown"));
      return anManagerCardsCache;
    } finally {
      setVerifyProgress({ done: 0, total: 0 });
    }
  };

  // Instant paint from localStorage snapshot, then background refresh.
  useEffect(() => {
    try {
      const cached = localStorage.getItem(AN_MANAGER_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
        const ts = Number(parsed?.ts || 0) || Date.now();
        if (Array.isArray(items) && items.length) {
          anManagerCardsCache = items;
          anManagerCardsLoadedAt = ts;
          setApiItems(items);
          void preloadCachedImages(items.map((item: ApiItem) => item.poster), 120);
          setLoading(false);
        }
      }
    } catch {}
    (async () => {
      const hadCachedCards = anManagerCardsCache.length > 0;
      if (!hadCachedCards) setLoading(true);
      const items = await loadFromApi(false);
      if (items.length) startTransition(() => setApiItems((prev) => prev === items || (prev.length === items.length && prev[0]?.slug === items[0]?.slug) ? prev : items));
      setLoading(false);
    })();
  }, []);

  // Persist snapshot for next visit — zero-latency reopen.
  useEffect(() => {
    if (!apiItems.length) return;
    anManagerCardsCache = apiItems;
    anManagerCardsLoadedAt = Date.now();
    try { localStorage.setItem(AN_MANAGER_CACHE_KEY, JSON.stringify({ ts: anManagerCardsLoadedAt, items: apiItems })); } catch {}
  }, [apiItems]);

  // Saved listener
  useEffect(() => {
    const unsub = onValue(ref(db, SELECTED_PATH), (snap) => {
      startTransition(() => setSaved((snap.val() as Record<string, SavedItem>) || {}));
    });
    return () => unsub();
  }, []);

  // Global toggle listener
  useEffect(() => {
    const unsub = onValue(ref(db, SETTINGS_PATH), (snap) => {
      startTransition(() => setGlobalEnabled(snap.val() !== false));
    });
    return () => unsub();
  }, []);

  // RS duplicate auto-disable listeners
  useEffect(() => {
    const u1 = subscribeAnDedupeEnabled((v) => startTransition(() => setDedupeOn(v)));
    const u2 = subscribeRsTitleKeys((keys) => startTransition(() => setRsKeys(keys)));
    return () => { try { u1(); } catch {} u2(); };
  }, []);


  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const merged = new Map<string, ApiItem | SavedItem>();
    apiItems.forEach((it) => merged.set(it.slug, it));
    Object.values(saved).forEach((it) => {
      if (!it?.slug) return;
      // Normal AN Manager list stays strictly playability-verified. Saved cards
      // that are no longer fetchable only appear under the Saved filter so they
      // can still be deleted/checked without polluting the curation list.
      if (typeFilter !== "saved" && !merged.has(it.slug)) return;
      merged.set(it.slug, { ...(merged.get(it.slug) || {}), ...it });
    });
    return Array.from(merged.values()).filter((it) => {
      if (typeFilter === "series" && it.type !== "series") return false;
      if (typeFilter === "movies" && it.type !== "movies") return false;
      if (typeFilter === "saved" && !saved[it.slug]) return false;
      if (q && !it.title.toLowerCase().includes(q) && !it.slug.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [apiItems, deferredQuery, typeFilter, saved]);

  const stats = useMemo(() => {
    const seriesCount = apiItems.filter((x) => x.type === "series").length;
    const movieCount = apiItems.filter((x) => x.type === "movies").length;
    return {
      total: apiItems.length,
      series: seriesCount,
      movies: movieCount,
      saved: Object.keys(saved).length,
      filtered: filtered.length,
    };
  }, [apiItems, saved, filtered]);

  const visibleFiltered = useMemo(() => filtered.slice(0, 96), [filtered]);

  // Saved AN slugs whose title already exists in the RS library.
  const rsDuplicateSlugs = useMemo(() => {
    const out = new Set<string>();
    if (rsKeys.size === 0) return out;
    Object.values(saved).forEach((it) => {
      if (!it?.slug) return;
      if (rsKeys.has(normalizeAnTitleKey(it.title))) out.add(it.slug);
    });
    return out;
  }, [saved, rsKeys]);


  const missingCategoryItems = useMemo(() =>
    Object.values(saved)
      .filter((item) => !hasRealCategory(item))
      .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""))),
    [saved],
  );

  const toggleSelect = (slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  };

  const selectAllVisible = () => setSelectedSlugs(new Set(visibleFiltered.map((x) => x.slug)));
  const clearSelection = () => setSelectedSlugs(new Set());

  // Save one (with TMDB auto-pick if exactly 1 result; otherwise opens picker)
  const saveOne = async (item: ApiItem, opts: { skipPicker?: boolean } = {}) => {
    // No playability probe here — admin only stores the card. Real HLS URLs are
    // resolved by the user panel on click via the AN playback API.
    if (!getTmdbApiKey()) throw new Error("TMDB API key required — AN details fallback is disabled");
    const cleaned = cleanTitleForTmdb(item.title);
    const isSeries = item.type === "series";
    const results = await tmdbSearch(cleaned, isSeries);
    if (!opts.skipPicker && results.length > 1) {
      setTmdbPicker({ item, results });
      return;
    }
    const pick = results[0] || null;
    if (!pick) throw new Error("TMDB match not found — use manual TMDB ID fetch");
    const enriched = await buildEnriched(item, pick);
    enriched.category = resolveSavedCategory(category, enriched.genres, enriched.category || "Anime");
    await set(ref(db, `${SELECTED_PATH}/${item.slug}`), enriched);
  };

  const onAddOne = async (item: ApiItem) => {
    try {
      await saveOne(item);
      if (saved[item.slug]) toast.success(`Updated: ${item.title}`);
      else toast.success(`Saved: ${item.title}`);
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || "unknown"));
    }
  };

  const onDeleteOne = async (slug: string) => {
    try {
      await remove(ref(db, `${SELECTED_PATH}/${slug}`));
      toast.success("Removed");
    } catch (e: any) {
      toast.error("Delete failed: " + (e?.message || "unknown"));
    }
  };

  const onBulkAdd = async () => {
    const targets =
      selectedSlugs.size > 0
        ? filtered.filter((x) => selectedSlugs.has(x.slug))
        : filtered;
    if (targets.length === 0) return toast.error("Nothing to add");
    if (!confirm(`Add ${targets.length} item(s) to user panel?`)) return;
    setBulkBusy(true);
    setBulkProgress({ done: 0, total: targets.length });
    let ok = 0;
    let fail = 0;
    // limit concurrency to 4
    const queue = [...targets];
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const it = queue.shift()!;
        try {
          await saveOne(it, { skipPicker: true });
          ok++;
        } catch {
          fail++;
        }
        setBulkProgress((p) => ({ done: p.done + 1, total: p.total }));
      }
    });
    await Promise.all(workers);
    setBulkBusy(false);
    setSelectedSlugs(new Set());
    toast.success(`Bulk add complete — ${ok} ok, ${fail} failed`);
  };

  const onDeleteAllSaved = async () => {
    const n = Object.keys(saved).length;
    if (n === 0) return toast.error("Nothing saved");
    if (!confirm(`Delete ALL ${n} saved AN items and AN playback cache? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      await Promise.all([
        remove(ref(db, SELECTED_PATH)),
        remove(ref(db, "anPlaybackCache")),
      ]);
      toast.success("All saved AN items deleted");
    } catch (e: any) {
      toast.error("Delete all failed: " + (e?.message || "unknown"));
    }
    setBulkBusy(false);
  };

  const onReload = async () => {
    setReloading(true);
    await loadFromApi(true);
    setReloading(false);
    toast.success("AN API reloaded");
  };

  const onClearLoadedCards = () => {
    setApiItems([]);
    anManagerCardsCache = [];
    anManagerCardsLoadedAt = 0;
    setSelectedSlugs(new Set());
    try {
      localStorage.removeItem("rs_cache_animesalt_api_cards_v2");
      localStorage.removeItem("rs_cache_animesalt_api_cards_v3");
      localStorage.removeItem("animesalt_all_v3");
      localStorage.removeItem(AN_MANAGER_CACHE_KEY);
      Object.keys(localStorage).filter((k) => k.startsWith("rs_an_playable_")).forEach((k) => localStorage.removeItem(k));
    } catch {}
    toast.success("Loaded AN cards cleared");
  };

  const refreshSavedDetails = async (it: SavedItem) => {
    if (!getTmdbApiKey()) throw new Error("TMDB API key required");
    const isSeries = (it.type || "series") === "series";
    const pick = it.tmdbId
      ? await tmdbFetchById(Number(it.tmdbId), isSeries)
      : (await tmdbSearch(cleanTitleForTmdb(it.title || ""), isSeries))[0] || null;
    if (!pick) throw new Error("TMDB match not found");
    const enriched = await buildEnriched(it as any, pick);
    const nextCategory = resolveSavedCategory(it.category, enriched.genres, it.category || category || "Anime");
    await update(ref(db, `${SELECTED_PATH}/${it.slug}`), {
      ...(enriched.tmdbId ? { tmdbId: enriched.tmdbId } : {}),
      title: enriched.title || it.title,
      rating: enriched.rating || it.rating || "",
      overview: enriched.overview || it.overview || "",
      backdrop: enriched.backdrop || it.backdrop || "",
      poster: enriched.poster || it.poster,
      genres: enriched.genres || it.genres || [],
      category: nextCategory,
      year: enriched.year || it.year || "",
      directors: enriched.directors || it.directors || [],
      cast: enriched.cast || it.cast || [],
      refreshedAt: Date.now(),
    });
  };

  const onRefreshOneDetails = async (it: SavedItem) => {
    if (!it?.slug) return;
    if (!getTmdbApiKey()) return toast.error("TMDB API key required — উপরের key box-এ key বসান");
    setTmdbBusySlug(it.slug);
    try {
      await refreshSavedDetails(it);
      toast.success(`Details refreshed: ${it.title}`);
    } catch (e: any) {
      toast.error("Refresh failed: " + (e?.message || "unknown"));
    } finally {
      setTmdbBusySlug(null);
    }
  };

  /**
   * Bulk TMDB enrichment for saved AN items only.
   * Walks `animesaltSelected/*`, runs `tmdbSearch` + `tmdbDetails`, and writes
   * back rating, year, overview, poster, backdrop, genres, category, cast, etc.
   */
  const onLoadAllDetails = async () => {
    const entries = Object.values(saved);
    if (entries.length === 0) return toast.error("Nothing saved yet");
    if (!getTmdbApiKey()) return toast.error("TMDB API key required — AN API details fallback is disabled");
    if (!confirm(`Refresh details for ${entries.length} saved AN item(s) only? Rating/year/category/description/cast update হবে।`)) return;

    setBulkBusy(true);
    setBulkProgress({ done: 0, total: entries.length });
    let ok = 0, fail = 0;
    const queue = [...entries];
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const it = queue.shift()!;
        try {
          await refreshSavedDetails(it);
          ok++;
        } catch {
          fail++;
        }
        setBulkProgress((p) => ({ done: p.done + 1, total: p.total }));
      }
    });
    await Promise.all(workers);
    setBulkBusy(false);
    toast.success(`Details refresh done — ${ok} updated, ${fail} failed`);
  };

  const quickFetchTmdbById = async (item: ApiItem) => {
    const id = Number(quickTmdbIds[item.slug] || 0);
    if (!id) return toast.error("আগে card-এর TMDB ID বক্সে ID দিন");
    if (!getTmdbApiKey()) return toast.error("TMDB API key লাগবে — উপরের TMDB API Key বক্সে key বসিয়ে Save Key চাপুন");
    setTmdbBusySlug(item.slug);
    try {
      const base = (saved[item.slug] || item) as SavedItem;
      const pick = await tmdbFetchById(id, item.type === "series");
      if (!pick) return toast.error("এই TMDB ID দিয়ে details পাওয়া যায়নি");
      const enriched = await buildEnriched({ ...base, tmdbId: id } as any, pick);
      enriched.category = resolveSavedCategory(base.category || category, enriched.genres, "Anime");
      await set(ref(db, `${SELECTED_PATH}/${item.slug}`), enriched);
      toast.success(`TMDB details loaded: ${item.title}`);
    } catch (e: any) {
      toast.error("TMDB fetch failed: " + (e?.message || "unknown"));
    } finally {
      setTmdbBusySlug(null);
    }
  };


  const onRefreshImages = async () => {
    try { localStorage.removeItem("rs_img_seen_v1"); } catch {}
    try {
      if (typeof caches !== "undefined") await caches.delete("rs-img-v1");
    } catch {}
    setImgVersion((v) => v + 1);
    toast.success("Image cache cleared");
  };

  const toggleGlobal = async () => {
    const next = !globalEnabled;
    try {
      await set(ref(db, SETTINGS_PATH), next);
      toast.success(`AN ${next ? "ON" : "OFF"}`);
    } catch (e: any) {
      toast.error("Toggle failed: " + (e?.message || "unknown"));
    }
  };

  const toggleDedupe = async () => {
    const next = !dedupeOn;
    try {
      await set(ref(db, AN_DEDUPE_SETTING_PATH), next);
      toast.success(
        next
          ? `Auto-disable ON — ${rsDuplicateSlugs.size} AN card(s) hidden (already in RS)`
          : "Auto-disable OFF — all AN cards visible again",
      );
    } catch (e: any) {
      toast.error("Toggle failed: " + (e?.message || "unknown"));
    }
  };


  const setManualCategory = async (slug: string, value: string) => {
    const next = String(value || "").trim();
    if (!slug || !next) return;
    try {
      await update(ref(db, `${SELECTED_PATH}/${slug}`), { category: next });
      toast.success("Category updated");
    } catch (e: any) {
      toast.error("Category save failed: " + (e?.message || "unknown"));
    }
  };

  const pickTmdb = async (result: TmdbResult) => {
    if (!tmdbPicker) return;
    try {
      const enriched = await buildEnriched(tmdbPicker.item, result);
      enriched.category = resolveSavedCategory(category, enriched.genres, enriched.category || "Anime");
      await set(ref(db, `${SELECTED_PATH}/${tmdbPicker.item.slug}`), enriched);
      toast.success(`Saved: ${tmdbPicker.item.title}`);
      setTmdbPicker(null);
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || "unknown"));
    }
  };

  const saveTmdbKey = () => {
    setRuntimeTmdbKey(tmdbKeyInput);
    setTmdbKeyVersion((v) => v + 1);
    toast.success(getTmdbApiKey() ? "TMDB API key saved" : "TMDB API key cleared");
  };

  const fetchTmdbForEditing = async () => {
    if (!editing) return;
    if (!getTmdbApiKey()) return toast.error("আগে TMDB API Key বসিয়ে Save Key চাপুন");
    const id = Number(editing.tmdbId || 0);
    if (!id) return toast.error("TMDB ID দিন, তারপর Fetch চাপুন");
    setTmdbBusySlug(editing.slug);
    try {
      const pick = await tmdbFetchById(id, editing.type === "series");
      if (!pick) return toast.error("এই TMDB ID দিয়ে details পাওয়া যায়নি");
      const enriched = await buildEnriched(editing, pick);
      setEditing({
        ...editing,
        tmdbId: enriched.tmdbId,
        title: enriched.title || editing.title,
        poster: enriched.poster || editing.poster,
        backdrop: enriched.backdrop || editing.backdrop,
        rating: enriched.rating || editing.rating,
        overview: enriched.overview || editing.overview,
        genres: enriched.genres || editing.genres,
        directors: enriched.directors || editing.directors,
        cast: enriched.cast || editing.cast,
        year: enriched.year || editing.year,
      });
      toast.success("TMDB details loaded");
    } catch (e: any) {
      toast.error("TMDB fetch failed: " + (e?.message || "unknown"));
    } finally {
      setTmdbBusySlug(null);
    }
  };

  const searchTmdbForEditing = async () => {
    if (!editing) return;
    if (!getTmdbApiKey()) return toast.error("আগে TMDB API Key বসিয়ে Save Key চাপুন");
    setTmdbBusySlug(editing.slug);
    try {
      const results = await tmdbSearch(cleanTitleForTmdb(editing.title || ""), editing.type === "series");
      if (!results.length) return toast.error("TMDB match পাওয়া যায়নি — manual TMDB ID দিয়ে Fetch করুন");
      setTmdbPicker({ item: editing, results });
    } catch (e: any) {
      toast.error("TMDB search failed: " + (e?.message || "unknown"));
    } finally {
      setTmdbBusySlug(null);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await update(ref(db, `${SELECTED_PATH}/${editing.slug}`), {
        tmdbId: editing.tmdbId || null,
        title: editing.title,
        poster: editing.poster,
        backdrop: editing.backdrop || "",
        rating: editing.rating || "",
        overview: editing.overview || "",
        category: resolveSavedCategory(editing.category, editing.genres, "Anime"),
        year: editing.year || "",
        genres: editing.genres || [],
        directors: editing.directors || [],
        cast: editing.cast || [],
      });
      toast.success("Saved");
      setEditing(null);
    } catch (e: any) {
      toast.error("Edit save failed: " + (e?.message || "unknown"));
    }
  };

  return (
    <div className="space-y-4">
      {/* === Top bar === */}
      <div className={`${glassCard} p-4 flex flex-wrap items-center gap-3`}>
        <button
          onClick={toggleGlobal}
          className={`px-3 py-2 rounded-lg flex items-center gap-2 font-semibold text-xs ${
            globalEnabled ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
          }`}
        >
          <Power size={14} /> AN {globalEnabled ? "ON" : "OFF"}
        </button>

        <button onClick={onReload} disabled={reloading} className={`${btnSecondary} px-3 py-2 text-xs flex items-center gap-1.5`}>
          {reloading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh API
        </button>

        <button
          onClick={onClearLoadedCards}
          disabled={bulkBusy || reloading}
          className="px-3 py-2 text-xs flex items-center gap-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 disabled:opacity-50"
        >
          <Trash2 size={14} /> Clear Loaded Cards
        </button>

        <button onClick={onRefreshImages} className={`${btnSecondary} px-3 py-2 text-xs flex items-center gap-1.5`}>
          <ImageIcon size={14} /> Refresh Images
        </button>

        <div className="ml-auto text-[11px] text-[#D1C4E9] flex gap-3 flex-wrap">
          <span className="flex items-center gap-1"><Tv size={12} /> Series {stats.series}</span>
          <span className="flex items-center gap-1"><Film size={12} /> Movies {stats.movies}</span>
          <span className="text-emerald-300">Saved {stats.saved}</span>
          <span className={missingCategoryItems.length ? "text-amber-200" : "text-emerald-300"}>Missing category {missingCategoryItems.length}</span>
          <span>Total {stats.total}</span>
        </div>
      </div>

      {/* === RS duplicate auto-disable === */}
      <div className={`${glassCard} p-4 flex flex-wrap items-center gap-3`}>
        <button
          onClick={toggleDedupe}
          className={`px-3 py-2 rounded-lg flex items-center gap-2 font-semibold text-xs border transition ${
            dedupeOn
              ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/40"
              : "bg-white/5 text-[#D1C4E9] border-white/15 hover:bg-white/10"
          }`}
        >
          <Layers size={14} />
          Auto-disable RS duplicates: {dedupeOn ? "ON" : "OFF"}
        </button>

        <span
          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${
            dedupeOn && rsDuplicateSlugs.size
              ? "bg-amber-400/15 text-amber-200 border-amber-400/40"
              : "bg-white/5 text-[#D1C4E9] border-white/10"
          }`}
        >
          {rsDuplicateSlugs.size} matched with RS {dedupeOn ? "— hidden now" : "— will hide when ON"}
        </span>

        <p className="basis-full text-[11px] leading-relaxed text-[#D1C4E9]/80">
          When ON, every AN card (series or movie) whose title already exists in the RS library is hidden from the user
          panel automatically — including any new RS title added later. Nothing is deleted; turning it OFF restores all cards.
        </p>
      </div>


      {/* === Bulk actions === */}
      <div className={`${glassCard} p-4 space-y-3`}>
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={selectAllVisible} className={`${btnSecondary} px-3 py-2 text-xs flex items-center gap-1.5`}>
            <CheckSquare size={14} /> Select All ({stats.filtered})
          </button>
          <button onClick={clearSelection} className={`${btnSecondary} px-3 py-2 text-xs flex items-center gap-1.5`}>
            <Square size={14} /> Clear ({selectedSlugs.size})
          </button>
          <button
            onClick={onBulkAdd}
            disabled={bulkBusy}
            className={`${btnPrimary} px-3 py-2 text-xs flex items-center gap-1.5 disabled:opacity-50`}
          >
            {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add {selectedSlugs.size > 0 ? `Selected (${selectedSlugs.size})` : `All Filtered`}
          </button>
          <button
            onClick={onDeleteAllSaved}
            disabled={bulkBusy}
            className="px-3 py-2 text-xs flex items-center gap-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 disabled:opacity-50"
          >
            <Trash2 size={14} /> Delete All Saved
          </button>
          <button
            onClick={onLoadAllDetails}
            disabled={bulkBusy}
            className="px-3 py-2 text-xs flex items-center gap-1.5 rounded-lg bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50"
            title="Fetch rating, year, overview, genres, directors from TMDB for every saved item"
          >
            {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            TMDB Details Load
          </button>
        </div>

        {bulkBusy && (
          <div className="text-[11px] text-emerald-300">
            Progress: {bulkProgress.done} / {bulkProgress.total}
            <div className="w-full h-1 bg-white/10 rounded mt-1 overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{ width: `${bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#D1C4E9]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title or slug…"
              className={`${inputClass} pl-8`}
            />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className={selectClass}>
            <option value="all">All ({stats.total})</option>
            <option value="series">Series only ({stats.series})</option>
            <option value="movies">Movies only ({stats.movies})</option>
            <option value="saved">Saved only ({stats.saved})</option>
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectClass}>
            <option value="">Default category (Anime)</option>
            {categoryList.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>


      {/* === Grid === */}
      <div className={`${glassCard} p-4`}>
        {loading ? (
          <div className="text-center py-12 text-[#D1C4E9] flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading AN cards…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-[#D1C4E9]">No items match your filters.</div>
        ) : (
          <>
          {filtered.length > visibleFiltered.length && (
            <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">
              Showing first {visibleFiltered.length} of {filtered.length}. Use search/type filters for more precise results.
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {visibleFiltered.map((it) => {
              const isSaved = !!saved[it.slug];
              const display = (saved[it.slug] || it) as SavedItem;
              const isSelected = selectedSlugs.has(it.slug);
              const isRsDup = rsDuplicateSlugs.has(it.slug);
              const isAutoHidden = dedupeOn && isRsDup;
              return (
                <div
                  key={it.slug}
                  className={`relative rounded-xl overflow-hidden border bg-white/5 transition ${
                    isSelected ? "border-purple-400 ring-2 ring-purple-400/50" : isAutoHidden ? "border-amber-400/60" : isSaved ? "border-emerald-500/50" : "border-white/10"
                  } ${isAutoHidden ? "opacity-60" : ""}`}
                >
                  <button
                    onClick={() => toggleSelect(it.slug)}
                    className="absolute top-1.5 left-1.5 z-10 w-6 h-6 rounded bg-black/60 backdrop-blur flex items-center justify-center text-white"
                    title="Select"
                  >
                    {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                  <span className="absolute top-1.5 left-8 z-10 text-[9px] px-1.5 py-0.5 rounded bg-purple-600/90 text-white font-black border border-white/20">
                    AN
                  </span>
                  {isRsDup && (
                    <span
                      className={`absolute bottom-1.5 left-1.5 z-10 text-[9px] px-1.5 py-0.5 rounded font-bold border ${
                        isAutoHidden
                          ? "bg-amber-400/90 text-black border-amber-200"
                          : "bg-black/70 text-amber-200 border-amber-400/40"
                      }`}
                      title="This title already exists in the RS library"
                    >
                      {isAutoHidden ? "IN RS — HIDDEN" : "IN RS"}
                    </span>
                  )}
                  {isSaved && (
                    <span className="absolute top-1.5 right-1.5 z-10 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/90 text-white font-bold">
                      SAVED
                    </span>
                  )}

                  <div className="aspect-[2/3] bg-black/40">
                    {display.poster ? (
                      <CachedImg
                        key={it.slug}
                        src={display.poster}
                        alt={display.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-[#D1C4E9]">No image</div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-semibold leading-tight line-clamp-2 min-h-[2.4em]">
                      {display.title}
                    </div>
                    <div className="text-[9px] text-[#D1C4E9] mt-1 flex justify-between">
                      <span className="uppercase">{it.type}</span>
                      <span>{display.year}</span>
                    </div>
                    {isSaved && (
                      <div className="mt-1 space-y-1">
                        <div className="flex items-center gap-1 text-[9px] text-amber-200">
                          <span>★ {display.rating || "—"}</span>
                          {display.tmdbId ? <span className="text-cyan-300">TMDB {display.tmdbId}</span> : <span className="text-rose-300">No TMDB ID</span>}
                        </div>
                        <div className="text-[9px] text-zinc-400 line-clamp-2 min-h-[2.3em]">
                          {display.overview || "Description empty — Edit থেকে TMDB ID দিয়ে Fetch করুন"}
                        </div>
                      </div>
                    )}
                    <div className="mt-1.5 flex gap-1">
                      <input
                        value={quickTmdbIds[it.slug] || ""}
                        onChange={(e) => setQuickTmdbIds((p) => ({ ...p, [it.slug]: e.target.value.replace(/\D/g, "") }))}
                        placeholder="TMDB ID"
                        className="min-w-0 flex-1 rounded bg-black/30 border border-cyan-400/25 px-1.5 py-1 text-[10px] outline-none focus:border-cyan-300"
                      />
                      <button
                        onClick={() => quickFetchTmdbById(it)}
                        disabled={tmdbBusySlug === it.slug}
                        className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-400/30 text-[9px] font-bold disabled:opacity-50"
                        title="Card থেকেই TMDB ID দিয়ে details fetch করুন"
                      >
                        {tmdbBusySlug === it.slug ? "..." : "Fetch"}
                      </button>
                    </div>
                    <div className="flex gap-1 mt-1.5">
                      {isSaved ? (
                        <>
                          <button
                            onClick={() => setEditing(saved[it.slug])}
                            className="flex-1 text-[10px] py-1 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center gap-1"
                          >
                            <Edit3 size={10} /> Edit
                          </button>
                          <button
                            onClick={() => onRefreshOneDetails(saved[it.slug])}
                            disabled={tmdbBusySlug === it.slug}
                            className="flex-1 text-[10px] py-1 rounded bg-amber-500/25 hover:bg-amber-500/40 text-amber-100 flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            {tmdbBusySlug === it.slug ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Details
                          </button>
                          <button
                            onClick={() => onDeleteOne(it.slug)}
                            className="flex-1 text-[10px] py-1 rounded bg-rose-500/30 hover:bg-rose-500/50 flex items-center justify-center gap-1"
                          >
                            <Trash2 size={10} /> Del
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => onAddOne(it)}
                          className="flex-1 text-[10px] py-1 rounded bg-purple-500/40 hover:bg-purple-500/60 flex items-center justify-center gap-1"
                        >
                          <Plus size={10} /> Add
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>

      {/* === TMDB picker modal === */}
      {tmdbPicker && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setTmdbPicker(null)}>
          <div className="bg-[#1a1530] rounded-2xl p-4 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">TMDB match for: {tmdbPicker.item.title}</h3>
              <button onClick={() => setTmdbPicker(null)} className="p-1 hover:bg-white/10 rounded"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {tmdbPicker.results.map((r) => (
                <button key={r.id} onClick={() => pickTmdb(r)} className="text-left rounded-lg overflow-hidden bg-white/5 border border-white/10 hover:border-purple-400">
                  <div className="aspect-[2/3] bg-black/40">
                    {r.poster_path && (
                      <img src={`${TMDB_IMG_BASE}w342${r.poster_path}`} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-semibold line-clamp-2">{r.title}</div>
                    <div className="text-[9px] text-[#D1C4E9] mt-1">
                      {(r.first_air_date || r.release_date || "").slice(0, 4)} · ★ {r.vote_average?.toFixed(1) || "—"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={async () => {
                const it = tmdbPicker.item;
                setTmdbPicker(null);
                const enriched = await buildEnriched(it, null);
                enriched.category = resolveSavedCategory(category, enriched.genres, "Anime");
                await set(ref(db, `${SELECTED_PATH}/${it.slug}`), enriched);
                toast.success(`Saved without TMDB: ${it.title}`);
              }}
              className={`${btnSecondary} w-full mt-3 py-2 text-xs`}
            >
              Skip TMDB & save as-is
            </button>
          </div>
        </div>
      )}

      {/* === Edit modal === */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-[#1a1530] rounded-2xl p-4 max-w-3xl w-full max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Edit: {editing.title}</h3>
              <button onClick={() => setEditing(null)} className="p-1 hover:bg-white/10 rounded"><X size={16} /></button>
            </div>
            <div className="space-y-2">
              <div className="rounded-xl border border-purple-400/25 bg-purple-500/10 p-3">
                <label className="text-[10px] text-purple-200 mb-1 block font-semibold">TMDB ID Fetch</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={editing.tmdbId || ""}
                    onChange={(e) => setEditing({ ...editing, tmdbId: Number(e.target.value) || undefined })}
                    placeholder="TMDB ID দিন (যেমন: 37854)"
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    onClick={fetchTmdbForEditing}
                    disabled={tmdbBusySlug === editing.slug}
                    className={`${btnPrimary} px-3 py-2 text-xs whitespace-nowrap disabled:opacity-50`}
                  >
                    {tmdbBusySlug === editing.slug ? <Loader2 size={13} className="animate-spin inline mr-1" /> : null}
                    Fetch by ID
                  </button>
                  <button
                    onClick={searchTmdbForEditing}
                    disabled={tmdbBusySlug === editing.slug}
                    className={`${btnSecondary} px-3 py-2 text-xs whitespace-nowrap disabled:opacity-50`}
                  >
                    Auto Search
                  </button>
                </div>
                <p className="text-[10px] text-zinc-400 mt-1">RS-এর মতো এখান থেকে সরাসরি TMDB ID দিয়ে poster, backdrop, year, rating, description, genres, cast load হবে।</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-3">
                <div className="rounded-xl overflow-hidden bg-black/30 border border-white/10">
                  {editing.poster ? <CachedImg src={editing.poster} alt={editing.title} className="w-full aspect-[2/3] object-cover" /> : <div className="aspect-[2/3] flex items-center justify-center text-xs text-zinc-400">No Poster</div>}
                </div>
                <div className="space-y-2">
              <div>
                <label className="text-[10px] text-[#D1C4E9] mb-1 block">Title</label>
                <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="text-[10px] text-[#D1C4E9] mb-1 block">Poster URL</label>
                <input value={editing.poster} onChange={(e) => setEditing({ ...editing, poster: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="text-[10px] text-[#D1C4E9] mb-1 block">Backdrop URL</label>
                <input value={editing.backdrop || ""} onChange={(e) => setEditing({ ...editing, backdrop: e.target.value })} className={inputClass} />
              </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[#D1C4E9] mb-1 block">Rating</label>
                  <input value={editing.rating || ""} onChange={(e) => setEditing({ ...editing, rating: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="text-[10px] text-[#D1C4E9] mb-1 block">Year</label>
                  <input value={editing.year || ""} onChange={(e) => setEditing({ ...editing, year: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-[#D1C4E9] mb-1 block">Category</label>
                <select value={editing.category || "Anime"} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className={selectClass}>
                  <option value="Anime">Anime</option>
                  {categoryList.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-[#D1C4E9] mb-1 block">Overview</label>
                <textarea
                  value={editing.overview || ""}
                  onChange={(e) => setEditing({ ...editing, overview: e.target.value })}
                  rows={4}
                  className={`${inputClass} resize-none`}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[#D1C4E9] mb-1 block">Genres (comma separated)</label>
                  <input
                    value={(editing.genres || []).join(", ")}
                    onChange={(e) => setEditing({ ...editing, genres: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#D1C4E9] mb-1 block">Directors</label>
                  <input
                    value={(editing.directors || []).join(", ")}
                    onChange={(e) => setEditing({ ...editing, directors: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                    className={inputClass}
                  />
                </div>
              </div>
              {(editing.cast || []).length > 0 && (
                <div>
                  <label className="text-[10px] text-[#D1C4E9] mb-1 block">Voice/Cast Artists</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {(editing.cast || []).slice(0, 10).map((c, idx) => (
                      <div key={`${c.name}-${idx}`} className="rounded-lg bg-white/5 border border-white/10 p-2 text-center">
                        {c.photo ? <CachedImg src={c.photo} alt={c.name} className="w-12 h-12 rounded-full object-cover mx-auto mb-1" /> : <div className="w-12 h-12 rounded-full bg-white/10 mx-auto mb-1" />}
                        <div className="text-[10px] font-semibold line-clamp-1">{c.name}</div>
                        <div className="text-[9px] text-zinc-400 line-clamp-1">{c.character || "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={saveEdit} className={`${btnPrimary} w-full py-2 mt-2`}>Save changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
