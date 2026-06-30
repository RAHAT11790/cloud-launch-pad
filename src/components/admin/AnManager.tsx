import { useEffect, useMemo, useRef, useState } from "react";
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
  Tv,
} from "lucide-react";
import { animeSaltApi } from "@/lib/animeSaltApi";
import { TMDB_API_KEY, TMDB_BASE_URL, TMDB_IMG_BASE } from "@/lib/siteConfig";
import CachedImg from "@/components/CachedImg";

/**
 * AN Manager — pure API-driven curation.
 *
 * Browse list comes from `animeSaltApi.browseAll()` (cached 30 min).
 * "Save" stores ONLY slug + TMDB-enriched metadata to `animesaltSelected/{slug}`.
 * Video URLs are NEVER saved — the user panel + player fetch them live.
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
  savedAt?: number;
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
  if (!TMDB_API_KEY || !title) return [];
  const kind = isSeries ? "tv" : "movie";
  try {
    const r = await fetch(
      `${TMDB_BASE_URL}/search/${kind}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&include_adult=false`,
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
  try {
    const r = await fetch(
      `${TMDB_BASE_URL}/${isSeries ? "tv" : "movie"}/${id}?api_key=${TMDB_API_KEY}&language=en-US&append_to_response=credits`,
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
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
  };
};

const SELECTED_PATH = "animesaltSelected";
const SETTINGS_PATH = "settings/animeSaltEnabled";

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
  const [apiItems, setApiItems] = useState<ApiItem[]>([]);
  const [saved, setSaved] = useState<Record<string, SavedItem>>({});
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "series" | "movies" | "saved">("all");
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [category, setCategory] = useState("");
  const [imgVersion, setImgVersion] = useState(0);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [tmdbPicker, setTmdbPicker] = useState<{ item: ApiItem; results: TmdbResult[] } | null>(null);
  const [editing, setEditing] = useState<SavedItem | null>(null);

  // Load API list (cached 30m inside browseAll/animeSaltApi)
  const loadFromApi = async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        try { localStorage.removeItem("rs_cache_animesalt_api_cards_v2"); localStorage.removeItem("rs_cache_animesalt_api_cards_v3"); localStorage.removeItem("animesalt_all_v3"); } catch {}
      }
      const r = await animeSaltApi.browseAll(forceRefresh);
      const mapped = (r?.items || []).map(normalizeItem).filter((x) => x.slug && x.title);
      // de-dup by slug, prefer series flavour
      const dedup = new Map<string, ApiItem>();
      mapped.forEach((x) => { if (!dedup.has(x.slug)) dedup.set(x.slug, x); });
      setApiItems(Array.from(dedup.values()));
    } catch (e: any) {
      toast.error("AN API load failed: " + (e?.message || "unknown"));
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadFromApi(false);
      setLoading(false);
    })();
  }, []);

  // Saved listener
  useEffect(() => {
    const unsub = onValue(ref(db, SELECTED_PATH), (snap) => {
      setSaved((snap.val() as Record<string, SavedItem>) || {});
    });
    return () => unsub();
  }, []);

  // Global toggle listener
  useEffect(() => {
    const unsub = onValue(ref(db, SETTINGS_PATH), (snap) => {
      setGlobalEnabled(snap.val() !== false);
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apiItems.filter((it) => {
      if (typeFilter === "series" && it.type !== "series") return false;
      if (typeFilter === "movies" && it.type !== "movies") return false;
      if (typeFilter === "saved" && !saved[it.slug]) return false;
      if (q && !it.title.toLowerCase().includes(q) && !it.slug.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [apiItems, query, typeFilter, saved]);

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

  const toggleSelect = (slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  };

  const selectAllVisible = () => setSelectedSlugs(new Set(filtered.map((x) => x.slug)));
  const clearSelection = () => setSelectedSlugs(new Set());

  // Save one (with TMDB auto-pick if exactly 1 result; otherwise opens picker)
  const saveOne = async (item: ApiItem, opts: { skipPicker?: boolean } = {}) => {
    const cleaned = cleanTitleForTmdb(item.title);
    const isSeries = item.type === "series";
    const results = TMDB_API_KEY ? await tmdbSearch(cleaned, isSeries) : [];
    if (!opts.skipPicker && results.length > 1) {
      setTmdbPicker({ item, results });
      return;
    }
    const pick = results[0] || null;
    const enriched = await buildEnriched(item, pick);
    enriched.category = category || enriched.category || "Anime";
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
    if (!confirm(`Delete ALL ${n} saved AN items? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      await remove(ref(db, SELECTED_PATH));
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

  const pickTmdb = async (result: TmdbResult) => {
    if (!tmdbPicker) return;
    try {
      const enriched = await buildEnriched(tmdbPicker.item, result);
      enriched.category = category || enriched.category || "Anime";
      await set(ref(db, `${SELECTED_PATH}/${tmdbPicker.item.slug}`), enriched);
      toast.success(`Saved: ${tmdbPicker.item.title}`);
      setTmdbPicker(null);
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || "unknown"));
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await update(ref(db, `${SELECTED_PATH}/${editing.slug}`), {
        title: editing.title,
        poster: editing.poster,
        backdrop: editing.backdrop || "",
        rating: editing.rating || "",
        overview: editing.overview || "",
        category: editing.category || "Anime",
        year: editing.year || "",
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
          Reload API
        </button>

        <button onClick={onRefreshImages} className={`${btnSecondary} px-3 py-2 text-xs flex items-center gap-1.5`}>
          <ImageIcon size={14} /> Refresh Images
        </button>

        <div className="ml-auto text-[11px] text-[#D1C4E9] flex gap-3 flex-wrap">
          <span className="flex items-center gap-1"><Tv size={12} /> Series {stats.series}</span>
          <span className="flex items-center gap-1"><Film size={12} /> Movies {stats.movies}</span>
          <span className="text-emerald-300">Saved {stats.saved}</span>
          <span>Total {stats.total}</span>
        </div>
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
            <Loader2 size={16} className="animate-spin" /> Loading from AN API…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-[#D1C4E9]">No items match your filters.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filtered.map((it) => {
              const isSaved = !!saved[it.slug];
              const isSelected = selectedSlugs.has(it.slug);
              return (
                <div
                  key={it.slug}
                  className={`relative rounded-xl overflow-hidden border bg-white/5 transition ${
                    isSelected ? "border-purple-400 ring-2 ring-purple-400/50" : isSaved ? "border-emerald-500/50" : "border-white/10"
                  }`}
                >
                  <button
                    onClick={() => toggleSelect(it.slug)}
                    className="absolute top-1.5 left-1.5 z-10 w-6 h-6 rounded bg-black/60 backdrop-blur flex items-center justify-center text-white"
                    title="Select"
                  >
                    {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                  {isSaved && (
                    <span className="absolute top-1.5 right-1.5 z-10 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/90 text-white font-bold">
                      SAVED
                    </span>
                  )}
                  <div className="aspect-[2/3] bg-black/40">
                    {it.poster ? (
                      <CachedImg
                        key={`${it.slug}-${imgVersion}`}
                        src={it.poster}
                        alt={it.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-[#D1C4E9]">No image</div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-semibold leading-tight line-clamp-2 min-h-[2.4em]">
                      {it.title}
                    </div>
                    <div className="text-[9px] text-[#D1C4E9] mt-1 flex justify-between">
                      <span className="uppercase">{it.type}</span>
                      <span>{it.year}</span>
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
                enriched.category = category || "Anime";
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
          <div className="bg-[#1a1530] rounded-2xl p-4 max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Edit: {editing.title}</h3>
              <button onClick={() => setEditing(null)} className="p-1 hover:bg-white/10 rounded"><X size={16} /></button>
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
              <button onClick={saveEdit} className={`${btnPrimary} w-full py-2 mt-2`}>Save changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
