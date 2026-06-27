import { useEffect, useMemo, useRef, useState } from "react";
import { db, ref, set, get, onValue, remove } from "@/lib/firebase";
import { useAnimeSaltData } from "@/hooks/useAnimeSaltData";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";
import { toast } from "sonner";
import {
  Database, Zap, RefreshCw, Edit3, Search, X, Save, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Trash2,
} from "lucide-react";

interface Props {
  glassCard: string;
  btnPrimary: string;
  btnSecondary: string;
  inputClass: string;
}

type EpisodeRow = {
  slug: string;
  number: number;
  title: string;
  directUrl: string;
  links: { url: string; label: string; height?: number }[];
  audio: { uri: string; name: string; language: string }[];
  broken?: boolean;
  updatedAt?: number;
};

type StoredSeries = {
  meta?: { title?: string; poster?: string; type?: string; storyline?: string; updatedAt?: number };
  episodes?: Record<string, any>;
};

const FETCH_TIMEOUT_MS = 18000;

async function resolveBase(): Promise<string> {
  const url = await getEdgeFunctionUrl("an-api");
  return String(url || "").replace(/\/+$/, "");
}

async function fetchJson(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<any | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const normalizeEpisode = (slug: string, number: number, raw: any): EpisodeRow => {
  const links = Array.isArray(raw?.links) ? raw.links : [];
  const sources = Array.isArray(raw?.sources) ? raw.sources : [];
  // Flatten sources → streams/audio if links not present.
  const flatLinks: EpisodeRow["links"] = links.length
    ? links.map((l: any) => ({ url: String(l.url || l), label: String(l.label || l.resolution || "auto"), height: l.height }))
    : sources.flatMap((s: any) =>
        (s?.streams || []).map((q: any) => ({ url: String(q.url || ""), label: String(q.label || q.resolution || "auto"), height: q.height }))
      );
  const flatAudio: EpisodeRow["audio"] = sources.flatMap((s: any) =>
    (s?.audio || []).map((a: any) => ({ uri: String(a.uri || ""), name: String(a.name || a.language || "Audio"), language: String(a.language || "") }))
  );
  return {
    slug,
    number,
    title: raw?.title || `Episode ${number}`,
    directUrl: raw?.directUrl || "",
    links: flatLinks,
    audio: flatAudio,
    broken: !!raw?.broken,
    updatedAt: raw?.updatedAt,
  };
};

const AnSeriesManager = ({ glassCard, btnPrimary, btnSecondary, inputClass }: Props) => {
  // Catalog comes from AN API directly (every available series), not from animesaltSelected.
  // This way the admin sees the full list and can click Fetch on any one to import into Firebase.
  const { items: apiItems, loading: saltLoading } = useAnimeSaltData();
  const saltItems = useMemo(
    () =>
      (apiItems || []).map((it: any) => ({
        slug: String(it.slug || ""),
        title: it.title || it.slug,
        poster: it.poster || "",
        type: it.type === "movie" ? "movie" : "series",
      })),
    [apiItems],
  );
  const [stored, setStored] = useState<Record<string, StoredSeries>>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const [editRows, setEditRows] = useState<EpisodeRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const stopRef = useRef(false);

  useEffect(() => {
    const u = onValue(ref(db, "anSeries"), (snap) => {
      setStored(snap.val() || {});
    });
    return () => { u(); };
  }, []);

  // Counts
  const addedSlugs = useMemo(() => new Set(Object.keys(stored).filter((k) => stored[k]?.meta)), [stored]);
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return saltItems;
    return saltItems.filter((it) => it.title.toLowerCase().includes(q) || String(it.slug || "").toLowerCase().includes(q));
  }, [saltItems, search]);
  const addedCount = saltItems.filter((it) => addedSlugs.has(String(it.slug || ""))).length;
  const pendingCount = saltItems.length - addedCount;

  const fetchSeries = async (slug: string, type: "series" | "movies") => {
    const base = await resolveBase();
    if (!base) {
      toast.error("AN API URL not configured in EGD Router");
      return false;
    }
    setBusy(slug);
    try {
      const detail = await fetchJson(`${base}/anime?slug=${encodeURIComponent(slug)}&type=${type}`);
      if (!detail) {
        toast.error(`Detail fetch failed for ${slug}`);
        return false;
      }

      const episodes: { slug: string; number: number }[] = [];
      for (const season of detail.seasons || []) {
        for (const ep of season.episodes || []) {
          if (ep?.slug) episodes.push({ slug: ep.slug, number: ep.number });
        }
      }
      // For movie types with no seasons, treat the series slug itself as the single episode.
      if (episodes.length === 0 && type === "movies") episodes.push({ slug, number: 1 });

      // Write meta first so the user-panel card unlocks.
      await set(ref(db, `anSeries/${slug}/meta`), {
        title: detail.title || slug,
        poster: detail.poster || "",
        type,
        storyline: detail.storyline || "",
        episodeCount: episodes.length,
        updatedAt: Date.now(),
      });

      // Concurrent extract
      let i = 0;
      const CONC = 4;
      const workers = Array.from({ length: CONC }, async () => {
        while (true) {
          const idx = i++;
          if (idx >= episodes.length) return;
          const ep = episodes[idx];
          const payload = await fetchJson(`${base}/episode?slug=${encodeURIComponent(ep.slug)}`, 20000);
          const hasPlayable = !!(payload && (payload.directUrl || (Array.isArray(payload.links) && payload.links.length)));
          await set(ref(db, `anSeries/${slug}/episodes/${ep.slug}`), {
            slug: ep.slug,
            number: ep.number,
            title: payload?.title || `Episode ${ep.number}`,
            directUrl: payload?.directUrl || "",
            links: Array.isArray(payload?.links) ? payload.links : [],
            sources: Array.isArray(payload?.sources) ? payload.sources : [],
            defaultAudioIdx: payload?.defaultAudioIdx ?? 0,
            preferredAudio: payload?.preferredAudio || "",
            broken: !hasPlayable,
            updatedAt: Date.now(),
          });
        }
      });
      await Promise.all(workers);
      toast.success(`✓ ${detail.title || slug} — ${episodes.length} episodes saved`);
      return true;
    } finally {
      setBusy(null);
    }
  };

  const fetchAllPending = async () => {
    stopRef.current = false;
    setBulkRunning(true);
    const pending = saltItems.filter((it) => !addedSlugs.has(String(it.slug || "")));
    setBulkProgress({ done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i++) {
      if (stopRef.current) break;
      const it = pending[i];
      const type = it.type === "movie" ? "movies" : "series";
      try { await fetchSeries(String(it.slug), type); } catch {}
      setBulkProgress({ done: i + 1, total: pending.length });
    }
    setBulkRunning(false);
    toast.success("Bulk fetch complete");
  };

  const openEditor = async (slug: string) => {
    const node = stored[slug];
    if (!node?.meta) {
      toast.error("Fetch this series first");
      return;
    }
    const eps = node.episodes || {};
    const rows: EpisodeRow[] = Object.entries(eps)
      .map(([epSlug, raw]) => normalizeEpisode(epSlug, Number((raw as any)?.number || 0), raw))
      .sort((a, b) => (a.number || 0) - (b.number || 0));
    setEditRows(rows);
    setEditing(slug);
    setExpanded({});
  };

  const refetchEpisode = async (slug: string, epSlug: string) => {
    const base = await resolveBase();
    if (!base) return toast.error("AN API URL not configured");
    setBusy(epSlug);
    try {
      const payload = await fetchJson(`${base}/episode?slug=${encodeURIComponent(epSlug)}`, 20000);
      if (!payload) return toast.error("Refetch failed");
      const hasPlayable = !!(payload.directUrl || (Array.isArray(payload.links) && payload.links.length));
      await set(ref(db, `anSeries/${slug}/episodes/${epSlug}`), {
        ...payload,
        slug: epSlug,
        broken: !hasPlayable,
        updatedAt: Date.now(),
      });
      setEditRows((rows) => rows.map((r) => (r.slug === epSlug ? normalizeEpisode(epSlug, r.number, payload) : r)));
      toast.success("Episode refetched");
    } finally {
      setBusy(null);
    }
  };

  const refetchSeries = async (slug: string) => {
    const node = stored[slug];
    const type = (node?.meta?.type === "movies" ? "movies" : "series") as "series" | "movies";
    await fetchSeries(slug, type);
    await openEditor(slug);
  };

  const saveEdits = async () => {
    if (!editing) return;
    setBusy("save");
    try {
      const updates: any = {};
      for (const r of editRows) {
        updates[`anSeries/${editing}/episodes/${r.slug}`] = {
          slug: r.slug,
          number: r.number,
          title: r.title,
          directUrl: r.directUrl,
          links: r.links,
          sources: [{ streams: r.links, audio: r.audio }],
          broken: !(r.directUrl || r.links.length),
          updatedAt: Date.now(),
        };
      }
      // Apply each path
      await Promise.all(Object.entries(updates).map(([path, val]) => set(ref(db, path), val)));
      toast.success("Saved");
      setEditing(null);
    } finally {
      setBusy(null);
    }
  };

  const deleteSeriesData = async (slug: string) => {
    if (!confirm(`Remove "${stored[slug]?.meta?.title || slug}" from Firebase? Users will stop seeing the card.`)) return;
    await remove(ref(db, `anSeries/${slug}`));
    toast.success("Removed");
  };

  // ============== EDITOR VIEW ==============
  if (editing) {
    const node = stored[editing];
    return (
      <div className={`${glassCard} p-4 sm:p-5 rounded-2xl`}>
        <div className="flex items-start gap-3 mb-4">
          <img src={node?.meta?.poster || ""} alt="" className="w-16 h-24 rounded-lg object-cover bg-black/40 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs opacity-60">Editing AN Series</div>
            <h3 className="text-base sm:text-lg font-semibold truncate">{node?.meta?.title || editing}</h3>
            <div className="text-xs opacity-70 mt-1">
              {editRows.length} episode{editRows.length !== 1 ? "s" : ""} from AN API · slug: <code className="opacity-80">{editing}</code>
            </div>
          </div>
          <button onClick={() => setEditing(null)} className={`${btnSecondary} !p-2`} title="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => refetchSeries(editing)} disabled={!!busy} className={`${btnSecondary} flex items-center gap-2 disabled:opacity-50`}>
            <RefreshCw className={`w-4 h-4 ${busy === editing ? "animate-spin" : ""}`} /> Refresh from AN
          </button>
          <button onClick={saveEdits} disabled={!!busy} className={`${btnPrimary} flex items-center gap-2 disabled:opacity-50 ml-auto`}>
            {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save All
          </button>
        </div>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {editRows.length === 0 ? (
            <div className="text-center text-xs opacity-60 py-8">No episodes stored. Click "Refresh from AN" to fetch.</div>
          ) : editRows.map((r, idx) => {
            const open = !!expanded[r.slug];
            return (
              <div key={r.slug} className="bg-black/30 border border-white/10 rounded-xl">
                <button
                  onClick={() => setExpanded((p) => ({ ...p, [r.slug]: !open }))}
                  className="w-full flex items-center gap-3 p-3 text-left"
                >
                  <span className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-300 grid place-items-center text-xs font-bold flex-shrink-0">
                    {r.number || idx + 1}
                  </span>
                  <span className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.title}</div>
                    <div className="text-[11px] opacity-60 truncate">{r.links.length}q · {r.audio.length}a · {r.slug}</div>
                  </span>
                  {r.broken ? <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" /> :
                    (r.directUrl || r.links.length) ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : null}
                  {open ? <ChevronUp className="w-4 h-4 opacity-60" /> : <ChevronDown className="w-4 h-4 opacity-60" />}
                </button>

                {open && (
                  <div className="px-3 pb-3 space-y-2 border-t border-white/5">
                    <div className="flex justify-end pt-2">
                      <button
                        onClick={() => refetchEpisode(editing, r.slug)}
                        disabled={busy === r.slug}
                        className={`${btnSecondary} !py-1 !px-2 text-[11px] flex items-center gap-1`}
                      >
                        <RefreshCw className={`w-3 h-3 ${busy === r.slug ? "animate-spin" : ""}`} /> Refetch
                      </button>
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-wider opacity-60 mb-1 block">Default / Master URL</label>
                      <input
                        value={r.directUrl}
                        onChange={(e) => setEditRows((rows) => rows.map((x) => x.slug === r.slug ? { ...x, directUrl: e.target.value } : x))}
                        className={`${inputClass} text-xs font-mono`}
                        placeholder="https://...m3u8"
                      />
                    </div>

                    <div>
                      <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1 flex items-center justify-between">
                        <span>Quality URLs ({r.links.length})</span>
                        <button
                          onClick={() => setEditRows((rows) => rows.map((x) => x.slug === r.slug ? { ...x, links: [...x.links, { url: "", label: "auto" }] } : x))}
                          className="text-indigo-300 hover:text-indigo-200 normal-case"
                        >+ Add</button>
                      </div>
                      {r.links.length === 0 && <div className="text-[11px] opacity-50 italic">No quality variants</div>}
                      {r.links.map((q, qi) => (
                        <div key={qi} className="flex gap-1.5 mb-1.5">
                          <input
                            value={q.label}
                            onChange={(e) => setEditRows((rows) => rows.map((x) => x.slug === r.slug ? { ...x, links: x.links.map((l, li) => li === qi ? { ...l, label: e.target.value } : l) } : x))}
                            className={`${inputClass} text-xs w-20 flex-shrink-0`}
                            placeholder="720p"
                          />
                          <input
                            value={q.url}
                            onChange={(e) => setEditRows((rows) => rows.map((x) => x.slug === r.slug ? { ...x, links: x.links.map((l, li) => li === qi ? { ...l, url: e.target.value } : l) } : x))}
                            className={`${inputClass} text-xs font-mono flex-1 min-w-0`}
                            placeholder="https://...m3u8"
                          />
                          <button
                            onClick={() => setEditRows((rows) => rows.map((x) => x.slug === r.slug ? { ...x, links: x.links.filter((_, li) => li !== qi) } : x))}
                            className="text-red-400 px-2 flex-shrink-0"
                          ><Trash2 className="w-3 h-3" /></button>
                        </div>
                      ))}
                    </div>

                    <div>
                      <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1 flex items-center justify-between">
                        <span>Audio Tracks ({r.audio.length})</span>
                        <button
                          onClick={() => setEditRows((rows) => rows.map((x) => x.slug === r.slug ? { ...x, audio: [...x.audio, { uri: "", name: "Audio", language: "" }] } : x))}
                          className="text-indigo-300 hover:text-indigo-200 normal-case"
                        >+ Add</button>
                      </div>
                      {r.audio.length === 0 && <div className="text-[11px] opacity-50 italic">No external audio tracks</div>}
                      {r.audio.map((a, ai) => (
                        <div key={ai} className="flex gap-1.5 mb-1.5">
                          <input
                            value={a.name}
                            onChange={(e) => setEditRows((rows) => rows.map((x) => x.slug === r.slug ? { ...x, audio: x.audio.map((au, li) => li === ai ? { ...au, name: e.target.value } : au) } : x))}
                            className={`${inputClass} text-xs w-24 flex-shrink-0`}
                            placeholder="Hindi"
                          />
                          <input
                            value={a.uri}
                            onChange={(e) => setEditRows((rows) => rows.map((x) => x.slug === r.slug ? { ...x, audio: x.audio.map((au, li) => li === ai ? { ...au, uri: e.target.value } : au) } : x))}
                            className={`${inputClass} text-xs font-mono flex-1 min-w-0`}
                            placeholder="https://...m3u8"
                          />
                          <button
                            onClick={() => setEditRows((rows) => rows.map((x) => x.slug === r.slug ? { ...x, audio: x.audio.filter((_, li) => li !== ai) } : x))}
                            className="text-red-400 px-2 flex-shrink-0"
                          ><Trash2 className="w-3 h-3" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ============== LIST VIEW ==============
  return (
    <div className={`${glassCard} p-4 sm:p-5 rounded-2xl`}>
      <div className="flex items-center gap-2 mb-3">
        <Database className="w-5 h-5 text-emerald-400" />
        <h3 className="text-base sm:text-lg font-semibold">AN Series</h3>
        <span className="ml-auto text-xs opacity-70">
          Added <b className="text-emerald-400">{addedCount}</b> / {saltItems.length} · Pending <b className="text-amber-400">{pendingCount}</b>
        </span>
      </div>

      <p className="text-xs opacity-70 mb-4 leading-relaxed">
        Click <b>Fetch</b> on a series to extract every episode's playback URLs from AN and store them permanently at <code>anSeries/{`{slug}`}</code>.
        After fetching, the card appears in the user panel and plays instantly from Firebase like an RS series.
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={fetchAllPending}
          disabled={bulkRunning || pendingCount === 0 || saltLoading}
          className={`${btnPrimary} flex items-center gap-2 disabled:opacity-50`}
        >
          {bulkRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {bulkRunning ? `Fetching ${bulkProgress.done}/${bulkProgress.total}…` : `Fetch All Pending (${pendingCount})`}
        </button>
        {bulkRunning && (
          <button onClick={() => (stopRef.current = true)} className={`${btnSecondary} flex items-center gap-2 text-red-300`}>
            <X className="w-4 h-4" /> Stop
          </button>
        )}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className={`${inputClass} pl-9`} />
        </div>
      </div>

      {bulkRunning && (
        <div className="h-1.5 bg-white/10 rounded overflow-hidden mb-3">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }} />
        </div>
      )}

      {saltLoading ? (
        <div className="text-center text-xs opacity-60 py-8">Loading catalog…</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center text-xs opacity-60 py-8">
          {saltItems.length === 0 ? "No AN selections yet. Add some via Animesalt Manager first." : "No matching series"}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {filteredItems.map((it) => {
            const slug = String(it.slug || "");
            const isAdded = addedSlugs.has(slug);
            const node = stored[slug];
            const epCount = node?.episodes ? Object.keys(node.episodes).length : 0;
            const isBusy = busy === slug;
            return (
              <div key={slug} className="bg-[#1A1A2E] border border-white/10 rounded-xl overflow-hidden hover:border-emerald-500/40 transition">
                <div className="relative aspect-[2/3] bg-black/40">
                  {it.poster && <img src={it.poster} alt="" className="w-full h-full object-cover" loading="lazy" />}
                  {isAdded && (
                    <div className="absolute top-1.5 right-1.5 bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 font-semibold">
                      <CheckCircle2 className="w-3 h-3" /> {epCount}
                    </div>
                  )}
                  {!isAdded && (
                    <div className="absolute top-1.5 right-1.5 bg-amber-500/90 text-black text-[10px] px-1.5 py-0.5 rounded-full font-semibold">
                      Pending
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <div className="text-[12px] font-semibold leading-tight line-clamp-2 min-h-[2.2em]">{it.title}</div>
                  <div className="text-[10px] opacity-60 mt-0.5 truncate">{slug}</div>
                  <div className="flex gap-1 mt-2">
                    {isAdded ? (
                      <>
                        <button onClick={() => openEditor(slug)} disabled={isBusy} className={`${btnSecondary} !py-1.5 !px-2 text-[10px] flex-1 flex items-center justify-center gap-1 disabled:opacity-50`}>
                          <Edit3 className="w-3 h-3" /> Edit
                        </button>
                        <button onClick={() => deleteSeriesData(slug)} className="bg-red-500/15 text-red-400 hover:bg-red-500/25 rounded-lg px-2 py-1.5 flex-shrink-0">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => fetchSeries(slug, it.type === "movie" ? "movies" : "series")}
                        disabled={isBusy || bulkRunning}
                        className={`${btnPrimary} !py-1.5 !px-2 text-[10px] w-full flex items-center justify-center gap-1 disabled:opacity-50`}
                      >
                        {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                        {isBusy ? "Fetching…" : "Fetch"}
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
  );
};

export default AnSeriesManager;
