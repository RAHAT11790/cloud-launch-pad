import { useDeferredValue, useMemo, useState } from "react";
import { db, ref, get, set, update } from "@/lib/firebase";
import { toast } from "sonner";
import { RefreshCw, Loader2, Link, Check, ChevronDown, Download } from "lucide-react";
import CachedImg from "@/components/CachedImg";

const ADMIN_DROPDOWN_LIMIT = 60;

interface Props {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  webseriesData: any[];
  moviesData: any[];
}

const UrlChangerManager = ({ glassCard, inputClass, btnPrimary, webseriesData, moviesData }: Props) => {
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [oldDomain, setOldDomain] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [replaceResult, setReplaceResult] = useState<{ total: number; replaced: number } | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const deferredSearchFilter = useDeferredValue(searchFilter);
  const [showSelector, setShowSelector] = useState(false);
  const [quickPasteText, setQuickPasteText] = useState("");
  const [showQuickPaste, setShowQuickPaste] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<string>("all");
  const [selectedEpisode, setSelectedEpisode] = useState<string>("all");

  const [bulkMode, setBulkMode] = useState<"off" | "all-series" | "all-movies">("off");
  const [bulkOldDomain, setBulkOldDomain] = useState("");
  const [bulkNewDomain, setBulkNewDomain] = useState("");
  const [bulkReplacing, setBulkReplacing] = useState(false);
  const [bulkResults, setBulkResults] = useState<{ title: string; poster: string; replaced: number; total: number }[]>([]);
  const [bulkQP, setBulkQP] = useState("");
  const [showBulkQP, setShowBulkQP] = useState(false);

  const sortedSeries = useMemo(() => {
    const sorted = [...webseriesData].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    const q = deferredSearchFilter.trim().toLowerCase();
    if (!q) return sorted.slice(0, ADMIN_DROPDOWN_LIMIT);
    return sorted.filter(s => s.title?.toLowerCase().includes(q)).slice(0, ADMIN_DROPDOWN_LIMIT);
  }, [webseriesData, deferredSearchFilter]);

  const selectedSeries = webseriesData.find(s => s.id === selectedSeriesId);

  const seriesSeasons = useMemo(() => {
    if (!selectedSeries?.seasons) return [];
    if (Array.isArray(selectedSeries.seasons)) return selectedSeries.seasons;
    return Object.entries(selectedSeries.seasons).map(([k, v]: [string, any]) => ({ ...v, _key: k }));
  }, [selectedSeries]);

  const seasonEpisodes = useMemo(() => {
    if (selectedSeason === "all" || !seriesSeasons.length) return [];
    const s = seriesSeasons[Number(selectedSeason)];
    if (!s?.episodes) return [];
    if (Array.isArray(s.episodes)) return s.episodes;
    return Object.entries(s.episodes).map(([k, v]: [string, any]) => ({ ...v, _key: k }));
  }, [seriesSeasons, selectedSeason]);

  const replaceUrls = async () => {
    if (!selectedSeriesId) { toast.error("series select !"); return; }
    if (!oldDomain.trim() || !newDomain.trim()) { toast.error("Old and New Domain দিতে will be!"); return; }
    if (!confirm(`"${oldDomain.trim()}" → "${newDomain.trim()}" — replace ?`)) return;

    setReplacing(true);
    setReplaceResult(null);
    try {
      const snap = await get(ref(db, `webseries/${selectedSeriesId}`));
      const data = snap.val();
      if (!data?.seasons) { toast.error("this seriesে any Season none!"); setReplacing(false); return; }

      const old = oldDomain.trim();
      const nw = newDomain.trim();
      let totalLinks = 0, replacedLinks = 0;
      const linkFields = ["link", "link480", "link720", "link1080", "link4k"];

      const replaceInEp = (ep: any) => {
        const updatedEp = { ...ep };
        linkFields.forEach(field => {
          if (updatedEp[field]) { totalLinks++; if (updatedEp[field].includes(old)) { updatedEp[field] = updatedEp[field].replace(old, nw); replacedLinks++; } }
        });
        if (updatedEp.audioTracks) {
          updatedEp.audioTracks = updatedEp.audioTracks.map((at: any) => {
            const u = { ...at };
            linkFields.forEach(f => { if (u[f]) { totalLinks++; if (u[f].includes(old)) { u[f] = u[f].replace(old, nw); replacedLinks++; } } });
            return u;
          });
        }
        return updatedEp;
      };

      let updatedSeasons: any;

      if (selectedSeason === "all") {
        if (Array.isArray(data.seasons)) {
          updatedSeasons = data.seasons.map((season: any) => ({
            ...season, episodes: (season.episodes || []).map((ep: any) => replaceInEp(ep)),
          }));
        } else {
          updatedSeasons = { ...data.seasons };
          for (const sk of Object.keys(updatedSeasons)) {
            const s = updatedSeasons[sk];
            if (s?.episodes) {
              if (Array.isArray(s.episodes)) {
                updatedSeasons[sk] = { ...s, episodes: s.episodes.map((ep: any) => replaceInEp(ep)) };
              } else {
                const updatedEps = { ...s.episodes };
                for (const ek of Object.keys(updatedEps)) { updatedEps[ek] = replaceInEp(updatedEps[ek]); }
                updatedSeasons[sk] = { ...s, episodes: updatedEps };
              }
            }
          }
        }
      } else if (selectedEpisode === "all") {
        updatedSeasons = Array.isArray(data.seasons) ? [...data.seasons] : { ...data.seasons };
        const sIdx = Number(selectedSeason);
        if (Array.isArray(updatedSeasons)) {
          const s = { ...updatedSeasons[sIdx] };
          s.episodes = (s.episodes || []).map((ep: any) => replaceInEp(ep));
          updatedSeasons[sIdx] = s;
        } else {
          const sKeys = Object.keys(updatedSeasons);
          const sk = sKeys[sIdx];
          if (sk && updatedSeasons[sk]?.episodes) {
            const s = { ...updatedSeasons[sk] };
            if (Array.isArray(s.episodes)) {
              s.episodes = s.episodes.map((ep: any) => replaceInEp(ep));
            } else {
              const updatedEps = { ...s.episodes };
              for (const ek of Object.keys(updatedEps)) { updatedEps[ek] = replaceInEp(updatedEps[ek]); }
              s.episodes = updatedEps;
            }
            updatedSeasons[sk] = s;
          }
        }
      } else {
        updatedSeasons = Array.isArray(data.seasons) ? [...data.seasons] : { ...data.seasons };
        const sIdx = Number(selectedSeason);
        const eIdx = Number(selectedEpisode);
        if (Array.isArray(updatedSeasons)) {
          const s = { ...updatedSeasons[sIdx] };
          const eps = [...(s.episodes || [])];
          eps[eIdx] = replaceInEp(eps[eIdx]);
          s.episodes = eps;
          updatedSeasons[sIdx] = s;
        } else {
          const sKeys = Object.keys(updatedSeasons);
          const sk = sKeys[sIdx];
          if (sk && updatedSeasons[sk]?.episodes) {
            const s = { ...updatedSeasons[sk] };
            if (Array.isArray(s.episodes)) {
              const eps = [...s.episodes];
              eps[eIdx] = replaceInEp(eps[eIdx]);
              s.episodes = eps;
            } else {
              const eKeys = Object.keys(s.episodes);
              const ek = eKeys[eIdx];
              if (ek) {
                const updatedEps = { ...s.episodes };
                updatedEps[ek] = replaceInEp(updatedEps[ek]);
                s.episodes = updatedEps;
              }
            }
            updatedSeasons[sk] = s;
          }
        }
      }

      await update(ref(db, `webseries/${selectedSeriesId}`), { seasons: updatedSeasons });
      setReplaceResult({ total: totalLinks, replaced: replacedLinks });
      toast.success(`✅ ${replacedLinks}/${totalLinks} link replaced!`);
    } catch (err: any) {
      toast.error(" Error: " + err.message);
    }
    setReplacing(false);
  };

  const handleQuickPaste = () => {
    const text = quickPasteText.trim();
    if (!text) { toast.error("link Paste!"); return; }
    try {
      const url = new URL(text.split('\n')[0].trim());
      const domain = `${url.protocol}//${url.host}`;
      setOldDomain(domain);
      toast.success(`✅ domain set done: ${domain}`);
      setShowQuickPaste(false); setQuickPasteText("");
    } catch { toast.error("valid URL Paste!"); }
  };

  const handleBulkQP = () => {
    const t = bulkQP.trim();
    if (!t) { toast.error("link Paste!"); return; }
    try {
      const u = new URL(t.split('\n')[0].trim());
      setBulkOldDomain(`${u.protocol}//${u.host}`);
      toast.success(`✅ domain set: ${u.protocol}//${u.host}`);
      setShowBulkQP(false); setBulkQP("");
    } catch { toast.error("valid URL Paste!"); }
  };

  const bulkReplace = async () => {
    if (!bulkOldDomain.trim() || !bulkNewDomain.trim()) { toast.error("Old and New Domain দিতে will be!"); return; }
    const targetType = bulkMode === "all-series" ? "webseries" : "movies";
    const items = bulkMode === "all-series" ? webseriesData : moviesData;
    if (!confirm(`${items.length} ${targetType === "webseries" ? "series" : "movie"}-র all link replace ?`)) return;

    setBulkReplacing(true);
    setBulkResults([]);
    const old = bulkOldDomain.trim();
    const nw = bulkNewDomain.trim();
    const t0 = performance.now();

    const deepReplace = (val: any, oldStr: string, newStr: string, counter: { total: number; replaced: number }): any => {
      if (val == null) return val;
      if (typeof val === "string") {
        counter.total++;
        if (val.includes(oldStr)) {
          counter.replaced++;
          return val.split(oldStr).join(newStr);
        }
        return val;
      }
      if (Array.isArray(val)) return val.map(v => deepReplace(v, oldStr, newStr, counter));
      if (typeof val === "object") {
        const out: any = {};
        for (const k of Object.keys(val)) out[k] = deepReplace(val[k], oldStr, newStr, counter);
        return out;
      }
      return val;
    };

    const processItem = async (item: any) => {
      try {
        const snap = await get(ref(db, `${targetType}/${item.id}`));
        const data = snap.val();
        if (!data) return null;
        const counter = { total: 0, replaced: 0 };
        const updated = deepReplace(data, old, nw, counter);
        if (counter.replaced > 0) {
          await set(ref(db, `${targetType}/${item.id}`), updated);
          return { title: item.title || item.id, poster: item.poster || "", replaced: counter.replaced, total: counter.total };
        }
        return null;
      } catch (err) { console.error(`Error processing ${item.id}:`, err); return null; }
    };

    const CONCURRENCY = 25;
    const results: typeof bulkResults = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        const r = await processItem(items[idx]);
        if (r) { results.push(r); setBulkResults([...results]); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    setBulkReplacing(false);
    if (results.length === 0) toast.info(`any linkে this domain পা যায়নি — all skip done (${elapsed}s)`);
    else toast.success(`✅ ${results.length} ${targetType === "webseries" ? "series" : "movie"}-তে link replaced! (${elapsed}s)`);
  };

  return (
    <div className="space-y-4">
      <div className={`${glassCard} p-4`}>
        <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
          <Link size={16} className="text-cyan-400" /> 🔗 URL Changer
        </h3>
        <p className="text-[10px] text-zinc-400 mb-4">
          Replace domains for all or selected Season/Episode links of a series।
        </p>

        <label className="text-[10px] text-zinc-400 block mb-1">series select </label>
        <button onClick={() => setShowSelector(!showSelector)}
          className={`${inputClass} w-full mb-2 text-left flex items-center gap-3 py-2`}>
          {selectedSeries ? (
            <>
              <CachedImg src={selectedSeries.poster} alt="" className="w-10 h-14 rounded object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-white truncate">{selectedSeries.title}</p>
                <p className="text-[9px] text-zinc-500">{seriesSeasons.length} seasons</p>
              </div>
            </>
          ) : (
            <span className="text-[11px] text-zinc-500">-- series select --</span>
          )}
          <ChevronDown size={14} className={`text-zinc-400 transition-transform ${showSelector ? 'rotate-180' : ''}`} />
        </button>

        {showSelector && (
          <div className="mb-3 bg-zinc-900/95 border border-zinc-700/50 rounded-xl max-h-[300px] overflow-y-auto">
            <div className="sticky top-0 bg-zinc-900 p-2 border-b border-zinc-700/30">
              <input value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
                placeholder="🔍 search ..." className={`${inputClass} text-[10px] w-full`} autoFocus />
            </div>
            {sortedSeries.map(s => (
              <button key={s.id} onClick={() => { setSelectedSeriesId(s.id); setShowSelector(false); setSearchFilter(""); setSelectedSeason("all"); setSelectedEpisode("all"); }}
                className={`w-full flex items-center gap-3 p-2.5 hover:bg-zinc-800/60 transition-all border-b border-zinc-800/30 ${selectedSeriesId === s.id ? 'bg-cyan-500/10 border-cyan-500/20' : ''}`}>
                <CachedImg src={s.poster} alt="" className="w-9 h-12 rounded object-cover flex-shrink-0 bg-zinc-800" onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }} />
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[11px] font-semibold text-white truncate">{s.title}</p>
                  <p className="text-[9px] text-zinc-500">{Number(s.seasonCount) || (Array.isArray(s.seasons) ? s.seasons.length : (s.seasons && typeof s.seasons === "object" ? Object.keys(s.seasons).length : 0))} seasons{Number(s.episodeCount) > 0 ? ` • ${s.episodeCount} eps` : ""}</p>
                </div>
                {selectedSeriesId === s.id && <Check size={14} className="text-cyan-400 flex-shrink-0" />}
              </button>
            ))}
            {sortedSeries.length === 0 && <p className="text-[10px] text-zinc-500 p-4 text-center">some পা যায়নি</p>}
          </div>
        )}

        {selectedSeriesId && seriesSeasons.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="text-[9px] text-zinc-500 block mb-1">Season</label>
              <select value={selectedSeason} onChange={e => { setSelectedSeason(e.target.value); setSelectedEpisode("all"); }}
                className={`${inputClass} text-[10px] w-full`}>
                <option value="all">all Season</option>
                {seriesSeasons.map((s: any, i: number) => (
                  <option key={i} value={String(i)}>
                    {s.name || `Season ${s.seasonNumber || i + 1}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-zinc-500 block mb-1">episode</label>
              <select value={selectedEpisode} onChange={e => setSelectedEpisode(e.target.value)}
                className={`${inputClass} text-[10px] w-full`} disabled={selectedSeason === "all"}>
                <option value="all">all episode</option>
                {seasonEpisodes.map((ep: any, i: number) => (
                  <option key={i} value={String(i)}>
                    EP {ep.episodeNumber || i + 1} - {ep.title || ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <button onClick={() => setShowQuickPaste(!showQuickPaste)}
          className="mb-3 text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
          <Download size={10} /> Quick Paste (extract domain from links)
        </button>
        {showQuickPaste && (
          <div className="mb-3 bg-black/20 rounded-xl border border-cyan-500/20 p-3">
            <textarea value={quickPasteText} onChange={e => setQuickPasteText(e.target.value)}
              placeholder="any video link Paste — domain auto set will be"
              className={`${inputClass} w-full min-h-[60px] resize-none text-[10px] font-mono mb-2`} />
            <button onClick={handleQuickPaste} disabled={!quickPasteText.trim()}
              className={`${btnPrimary} w-full py-2 text-[10px] flex items-center justify-center gap-1 disabled:opacity-30`}>
              <Check size={11} /> domain set 
            </button>
          </div>
        )}

        <label className="text-[10px] text-zinc-400 block mb-1">old Domain/URL</label>
        <input value={oldDomain} onChange={e => setOldDomain(e.target.value)}
          placeholder="http://fi3.bot-hosting.net:22854" className={`${inputClass} mb-3 text-[10px]`} />
        <label className="text-[10px] text-zinc-400 block mb-1">new Domain/URL</label>
        <input value={newDomain} onChange={e => setNewDomain(e.target.value)}
          placeholder="https://rahat1102-video-hosting-bot.hf.space" className={`${inputClass} mb-4 text-[10px]`} />

        <button onClick={replaceUrls} disabled={replacing || !selectedSeriesId}
          className={`${btnPrimary} w-full py-3 text-sm flex items-center justify-center gap-2`}>
          {replacing ? <><Loader2 size={14} className="animate-spin" /> replace in progress...</> : <><RefreshCw size={14} /> replace </>}
        </button>

        {replaceResult && (
          <div className="mt-3 p-3 rounded-xl bg-green-500/10 border border-green-500/30">
            <p className="text-[11px] font-semibold text-green-400">
              ✅ Total {replaceResult.total} link মধ্which {replaceResult.replaced} replaced!
              {selectedSeason !== "all" && <span className="text-zinc-400 ml-1">(Season {Number(selectedSeason) + 1}{selectedEpisode !== "all" ? `, EP ${Number(selectedEpisode) + 1}` : ""})</span>}
            </p>
          </div>
        )}
      </div>

      <div className={`${glassCard} p-4`}>
        <h4 className="text-xs font-bold text-white mb-3">⚡ Quick Presets</h4>
        <div className="space-y-2">
          <button onClick={() => { setOldDomain("http://fi3.bot-hosting.net:22854"); setNewDomain("https://rahat1102-video-hosting-bot.hf.space"); setBulkOldDomain("http://fi3.bot-hosting.net:22854"); setBulkNewDomain("https://rahat1102-video-hosting-bot.hf.space"); }}
            className="w-full text-left p-2.5 rounded-xl bg-zinc-800/40 border border-zinc-700/40 hover:border-cyan-500/30 transition-all">
            <p className="text-[10px] font-semibold text-white">Bot Hosting → HF Space</p>
            <p className="text-[9px] text-zinc-500 mt-0.5">fi3.bot-hosting.net → hf.space</p>
          </button>
          <button onClick={() => { setOldDomain("https://rahat1102-video-hosting-bot.hf.space"); setNewDomain("http://fi3.bot-hosting.net:22854"); setBulkOldDomain("https://rahat1102-video-hosting-bot.hf.space"); setBulkNewDomain("http://fi3.bot-hosting.net:22854"); }}
            className="w-full text-left p-2.5 rounded-xl bg-zinc-800/40 border border-zinc-700/40 hover:border-cyan-500/30 transition-all">
            <p className="text-[10px] font-semibold text-white">HF Space → Bot Hosting</p>
            <p className="text-[9px] text-zinc-500 mt-0.5">hf.space → fi3.bot-hosting.net</p>
          </button>
        </div>
      </div>

      <div className={`${glassCard} p-4`}>
        <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">🚀 Bulk Replace — All Series / all movie</h4>
        <p className="text-[9px] text-zinc-400 mb-3">with All Series or all movieর link domain replace । যেতে domain none সে skip will be।</p>

        <div className="flex gap-2 mb-3">
          <button onClick={() => setBulkMode(bulkMode === "all-series" ? "off" : "all-series")}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl border transition-all flex items-center justify-center gap-1.5 ${bulkMode === "all-series" ? "bg-purple-600 border-purple-500 text-white" : "bg-zinc-800/40 border-zinc-700/40 text-zinc-400 hover:text-white"}`}>
            📺 All Series ({webseriesData.length})
          </button>
          <button onClick={() => setBulkMode(bulkMode === "all-movies" ? "off" : "all-movies")}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl border transition-all flex items-center justify-center gap-1.5 ${bulkMode === "all-movies" ? "bg-orange-600 border-orange-500 text-white" : "bg-zinc-800/40 border-zinc-700/40 text-zinc-400 hover:text-white"}`}>
            🎬 All Movies ({moviesData.length})
          </button>
        </div>

        {bulkMode !== "off" && (
          <div className="space-y-3">
            <button onClick={() => setShowBulkQP(!showBulkQP)}
              className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
              <Download size={10} /> Quick Paste
            </button>
            {showBulkQP && (
              <div className="bg-black/20 rounded-xl border border-purple-500/20 p-2.5">
                <textarea value={bulkQP} onChange={e => setBulkQP(e.target.value)}
                  placeholder="any video link Paste " className={`${inputClass} w-full min-h-[50px] resize-none text-[10px] font-mono mb-2`} />
                <button onClick={handleBulkQP} disabled={!bulkQP.trim()}
                  className={`${btnPrimary} w-full py-1.5 text-[10px] flex items-center justify-center gap-1 disabled:opacity-30`}>
                  <Check size={11} /> domain set 
                </button>
              </div>
            )}

            <input value={bulkOldDomain} onChange={e => setBulkOldDomain(e.target.value)}
              placeholder="old Domain" className={`${inputClass} text-[10px]`} />
            <input value={bulkNewDomain} onChange={e => setBulkNewDomain(e.target.value)}
              placeholder="new Domain" className={`${inputClass} text-[10px]`} />

            <button onClick={bulkReplace} disabled={bulkReplacing}
              className={`${btnPrimary} w-full py-3 text-sm flex items-center justify-center gap-2 ${bulkMode === "all-series" ? "bg-gradient-to-r from-purple-600 to-indigo-600" : "bg-gradient-to-r from-orange-600 to-red-600"}`}>
              {bulkReplacing ? <><Loader2 size={14} className="animate-spin" /> replace in progress...</> : <><RefreshCw size={14} /> {bulkMode === "all-series" ? "All Seriesে" : "all movieতে"} replace </>}
            </button>

            {bulkResults.length > 0 && (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                <p className="text-[10px] text-green-400 font-bold">✅ {bulkResults.length} contentে replaced:</p>
                {bulkResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2.5 bg-green-500/10 border border-green-500/20 rounded-lg p-2">
                    {r.poster && <CachedImg src={r.poster} alt="" className="w-8 h-11 rounded object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-white truncate">{r.title}</p>
                      <p className="text-[9px] text-green-400">{r.replaced}/{r.total} link replace</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UrlChangerManager;
