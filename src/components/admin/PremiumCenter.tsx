import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
import {
  Crown, Coins, Lock, Download, Plus, Trash2, Save, Search, Star,
  Sparkles, TrendingUp, Users2, ShieldCheck, Film, Tv, X, Check,
  ChevronRight, LayoutGrid, List, Filter, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import {
  DEFAULT_PREMIUM_SETTINGS,
  PremiumGlobalSettings,
  savePremiumSettings,
  subscribePremiumSettings,
  CoinPlan,
} from "@/lib/premiumAccess";
import { resolveAnSeriesSeasons } from "@/lib/anLivePlayback";

type Tab = "overview" | "series" | "eplocks" | "quality" | "download" | "plans";

const CACHE_RS = "rs_premium_center_rs_v1";
const CACHE_AN = "rs_premium_center_an_v1";
const readCache = (k: string): SeriesRow[] => {
  try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : []; } catch { return []; }
};
const writeCache = (k: string, v: SeriesRow[]) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

interface SeriesRow {
  id: string;
  path: "webseries" | "movies" | "animesaltSelected";
  title: string;
  poster?: string;
  year?: string | number;
  premium: boolean;
  dubType?: "official" | "fandub";
  premiumEpisodes?: Record<string, boolean>;
  seasonsCount?: number;
  episodesCount?: number;
}

const inputCls =
  "w-full rounded-xl bg-black/40 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-400/60 focus:bg-black/60 transition";

export default function PremiumCenter() {
  const [tab, setTab] = useState<Tab>("overview");
  const [settings, setSettings] = useState<PremiumGlobalSettings>(DEFAULT_PREMIUM_SETTINGS);
  const [rsSeries, setRsSeries] = useState<SeriesRow[]>(() => readCache(CACHE_RS));
  const [anSeries, setAnSeries] = useState<SeriesRow[]>(() => readCache(CACHE_AN));
  const [q, setQ] = useState("");
  const [dubFilter, setDubFilter] = useState<"all" | "official" | "fandub">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "RS" | "AN">("all");
  const [premiumFilter, setPremiumFilter] = useState<"all" | "premium" | "free">("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [episodeModal, setEpisodeModal] = useState<SeriesRow | null>(null);
  const [premiumUsers, setPremiumUsers] = useState(0);
  const [coinCirculation, setCoinCirculation] = useState(0);

  useEffect(() => subscribePremiumSettings(setSettings), []);

  useEffect(() => {
    const normalizeDub = (value: any): "official" | "fandub" => /fan|fandub/i.test(String(value || "")) ? "fandub" : "official";
    const mapRows = (raw: any, path: "webseries" | "movies" | "animesaltSelected"): SeriesRow[] =>
      Object.entries(raw || {}).map(([id, v]: any) => {
        const seasons = Array.isArray(v?.seasons) ? v.seasons : [];
        const episodesCount = seasons.reduce(
          (n: number, s: any) => n + (Array.isArray(s?.episodes) ? s.episodes.length : 0),
          0,
        );
        return {
          id,
          path,
          title: v?.title || v?.name || id,
          poster: v?.poster || v?.image || v?.thumbnail || "",
          year: v?.year || v?.releaseYear,
          premium: !!v?.premium,
          dubType: normalizeDub(v?.dubType || v?.dub || v?.languageType),
          premiumEpisodes: v?.premiumEpisodes || {},
          seasonsCount: seasons.length,
          episodesCount,
        };
      });
    const u1 = onValue(ref(db, "webseries"), (snap) => setRsSeries((prev) => [...prev.filter((r) => r.path !== "webseries"), ...mapRows(snap.val(), "webseries")]));
    const uMovies = onValue(ref(db, "movies"), (snap) => setRsSeries((prev) => [...prev.filter((r) => r.path !== "movies"), ...mapRows(snap.val(), "movies")]));
    const u2 = onValue(ref(db, "animesaltSelected"), (snap) =>
      setAnSeries(mapRows(snap.val(), "animesaltSelected")),
    );
    return () => { u1(); uMovies(); u2(); };
  }, []);

  // Persist snapshots so returning to Premium Center never shows an empty list.
  useEffect(() => { writeCache(CACHE_RS, rsSeries); }, [rsSeries]);
  useEffect(() => { writeCache(CACHE_AN, anSeries); }, [anSeries]);

  useEffect(() => {
    const u = onValue(ref(db, "users"), (snap) => {
      const raw = snap.val() || {};
      let pu = 0;
      let coins = 0;
      Object.values(raw).forEach((u: any) => {
        if (u?.premium?.active && Number(u?.premium?.expiresAt || 0) > Date.now()) pu++;
        coins += Number(u?.coinWallet?.coins || 0);
      });
      setPremiumUsers(pu);
      setCoinCirculation(coins);
    });
    return () => u();
  }, []);

  const allSeries = useMemo(() => [...rsSeries, ...anSeries], [rsSeries, anSeries]);
  const filtered = useMemo(() => {
    return allSeries.filter((s) => {
      if (sourceFilter === "RS" && s.path === "animesaltSelected") return false;
      if (sourceFilter === "AN" && s.path !== "animesaltSelected") return false;
      if (dubFilter !== "all" && (s.dubType || "official") !== dubFilter) return false;
      if (premiumFilter === "premium" && !s.premium) return false;
      if (premiumFilter === "free" && s.premium) return false;
      if (q && !s.title.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [allSeries, sourceFilter, dubFilter, premiumFilter, q]);

  const stats = useMemo(() => {
    const premiumSeries = allSeries.filter((s) => s.premium).length;
    const lockedEps = allSeries.reduce(
      (n, s) => n + Object.values(s.premiumEpisodes || {}).filter(Boolean).length,
      0,
    );
    return {
      totalSeries: allSeries.length,
      premiumSeries,
      lockedEps,
      qualityLocks: Object.values(settings.globalQualityLocks || {}).filter(Boolean).length,
    };
  }, [allSeries, settings]);

  const togglePremium = async (row: SeriesRow) => {
    await update(ref(db, `${row.path}/${row.id}`), { premium: !row.premium });
    toast({
      title: row.premium ? "Unlocked" : "Marked Premium",
      description: row.title,
    });
  };

  const setDub = async (row: SeriesRow, dub: "official" | "fandub") => {
    await update(ref(db, `${row.path}/${row.id}`), { dubType: dub });
  };

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "overview", label: "Overview", icon: TrendingUp },
    { id: "series", label: "Content Locks", icon: Lock },
    { id: "eplocks", label: "Episode Lock (RS)", icon: Film },
    { id: "quality", label: "Quality", icon: Star },
    { id: "download", label: "Downloads", icon: Download },
    { id: "plans", label: "Coin Plans", icon: Crown },
  ];

  return (
    <div className="space-y-6">
      {/* Premium Hero Header */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-400/30 bg-gradient-to-br from-amber-500/15 via-yellow-500/5 to-transparent p-6">
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-amber-500/20 blur-3xl rounded-full pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-yellow-600/10 blur-3xl rounded-full pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-300 via-amber-500 to-yellow-700 flex items-center justify-center shadow-[0_10px_40px_-10px_rgba(251,191,36,0.6)]">
              <Crown className="w-7 h-7 text-black" />
            </div>
            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-black animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-black tracking-tight bg-gradient-to-r from-amber-100 via-amber-300 to-yellow-500 bg-clip-text text-transparent">
                Premium Center
              </h2>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30">
                <Sparkles className="w-3 h-3" /> LIVE
              </span>
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              Monetization command center — content locks, coin economy and premium plans.
            </p>
          </div>
        </div>

        {/* Live Stats */}
        <div className="relative mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Users2} label="Premium Users" value={premiumUsers} accent="emerald" />
          <StatCard icon={Coins} label="Coins in Circulation" value={coinCirculation} accent="amber" />
          <StatCard icon={Lock} label="Premium Series" value={stats.premiumSeries} sub={`of ${stats.totalSeries}`} accent="rose" />
          <StatCard icon={Zap} label="Locked Episodes" value={stats.lockedEps} accent="indigo" />
        </div>
      </div>

      {/* Tabs — wrap on mobile so nothing gets clipped/blocked from scroll */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold border transition-all ${
                active
                  ? "border-amber-400/50 bg-gradient-to-r from-amber-500/20 to-yellow-500/10 text-amber-200 shadow-[0_4px_20px_-4px_rgba(251,191,36,0.4)]"
                  : "border-white/10 bg-white/[0.02] text-zinc-400 hover:text-zinc-100 hover:border-white/20"
              }`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>


      {tab === "overview" && <OverviewTab stats={stats} settings={settings} premiumUsers={premiumUsers} coinCirculation={coinCirculation} onNav={setTab} />}

      {tab === "series" && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-transparent p-4 space-y-3">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  className={`${inputCls} pl-10`}
                  placeholder={`Search ${allSeries.length} series...`}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button
                    onClick={() => setQ("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex gap-1 bg-black/40 rounded-xl p-1 border border-white/5">
                <button
                  onClick={() => setView("grid")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${view === "grid" ? "bg-white/10 text-white" : "text-zinc-500"}`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" /> Grid
                </button>
                <button
                  onClick={() => setView("list")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${view === "list" ? "bg-white/10 text-white" : "text-zinc-500"}`}
                >
                  <List className="w-3.5 h-3.5" /> List
                </button>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-1"><Filter className="w-3 h-3" />Filter</div>
              <FilterGroup value={sourceFilter} onChange={setSourceFilter as any} options={[
                { v: "all", label: `All (${rsSeries.length + anSeries.length})` },
                { v: "RS", label: `RS (${rsSeries.length})` },
                { v: "AN", label: `AN (${anSeries.length})` },
              ]} />
              <FilterGroup value={dubFilter} onChange={setDubFilter as any} options={[
                { v: "all", label: "Any Dub" },
                { v: "official", label: "Official" },
                { v: "fandub", label: "Fan Dub" },
              ]} />
              <FilterGroup value={premiumFilter} onChange={setPremiumFilter as any} options={[
                { v: "all", label: "All" },
                { v: "premium", label: "💎 Premium" },
                { v: "free", label: "Free" },
              ]} />
              <div className="ml-auto text-xs text-zinc-500">
                <span className="font-bold text-amber-300">{filtered.length}</span> shown
              </div>
            </div>
          </div>

          {/* Series Grid/List */}
          {view === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {filtered.slice(0, 200).map((row) => (
                <SeriesCard
                  key={`${row.path}-${row.id}`}
                  row={row}
                  onTogglePremium={() => togglePremium(row)}
                  onSetDub={(d) => setDub(row, d)}
                  onOpenEpisodes={() => setEpisodeModal(row)}
                />
              ))}
              {filtered.length === 0 && <EmptyState />}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-black/20 divide-y divide-white/5">
              {filtered.slice(0, 300).map((row) => (
                <SeriesListRow
                  key={`${row.path}-${row.id}`}
                  row={row}
                  onTogglePremium={() => togglePremium(row)}
                  onSetDub={(d) => setDub(row, d)}
                  onOpenEpisodes={() => setEpisodeModal(row)}
                />
              ))}
              {filtered.length === 0 && <EmptyState />}
            </div>
          )}
        </div>
      )}

      {tab === "eplocks" && (
        <EpisodeLockTab
          rsSeries={rsSeries}
          onOpen={(row) => setEpisodeModal(row)}
          onToggleSeries={(row) => togglePremium(row)}
        />
      )}
      {tab === "quality" && <QualityTab settings={settings} />}
      {tab === "download" && <DownloadTab settings={settings} />}
      {tab === "plans" && <PlansEditor settings={settings} />}

      {episodeModal && (
        <EpisodeLockModal
          row={episodeModal}
          onClose={() => setEpisodeModal(null)}
        />
      )}
    </div>
  );
}

// ============ Sub-components ============

function StatCard({ icon: Icon, label, value, sub, accent }: any) {
  const accents: any = {
    amber: "from-amber-500/20 to-transparent border-amber-400/20 text-amber-300",
    emerald: "from-emerald-500/20 to-transparent border-emerald-400/20 text-emerald-300",
    rose: "from-rose-500/20 to-transparent border-rose-400/20 text-rose-300",
    indigo: "from-indigo-500/20 to-transparent border-indigo-400/20 text-indigo-300",
  };
  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${accents[accent]} bg-black/40 p-4`}>
      <div className="flex items-center gap-2 text-xs text-zinc-400 font-semibold">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="mt-2 text-2xl font-black text-white tabular-nums">{value.toLocaleString()}</div>
      {sub && <div className="text-[10px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function FilterGroup({ value, onChange, options }: { value: string; onChange: (v: any) => void; options: { v: string; label: string }[] }) {
  return (
    <div className="flex gap-1 bg-black/30 rounded-lg p-1 border border-white/5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap ${
            value === o.v ? "bg-amber-500/20 text-amber-200" : "text-zinc-500 hover:text-zinc-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SeriesCard({ row, onTogglePremium, onSetDub, onOpenEpisodes }: any) {
  const lockedEps = Object.values(row.premiumEpisodes || {}).filter(Boolean).length;
  return (
    <div className={`group relative rounded-2xl overflow-hidden border transition-all ${
      row.premium ? "border-amber-400/50 shadow-[0_0_30px_-10px_rgba(251,191,36,0.4)]" : "border-white/10 hover:border-white/20"
    } bg-gradient-to-b from-zinc-900 to-black`}>
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-zinc-950 overflow-hidden">
        {row.poster ? (
          <img src={row.poster} alt={row.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-700">
            {row.path !== "animesaltSelected" ? <Tv className="w-10 h-10" /> : <Film className="w-10 h-10" />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

        {/* Top badges */}
        <div className="absolute top-2 left-2 right-2 flex justify-between items-start">
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
            row.path !== "animesaltSelected" ? "bg-blue-500/90 text-white" : "bg-emerald-500/90 text-white"
          }`}>
            {row.path !== "animesaltSelected" ? "RS" : "AN"}
          </span>
          {row.premium && (
            <span className="inline-flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded bg-gradient-to-r from-amber-400 to-yellow-600 text-black">
              <Crown className="w-2.5 h-2.5" /> PRO
            </span>
          )}
        </div>

        {/* Locked episode badge */}
        {lockedEps > 0 && !row.premium && (
          <div className="absolute bottom-14 left-2 inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/90 text-white">
            <Lock className="w-2.5 h-2.5" /> {lockedEps} eps
          </div>
        )}

        {/* Info overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-2.5">
          <div className="text-xs font-bold text-white line-clamp-2 leading-tight">{row.title}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[9px] text-zinc-400">
            {row.year && <span>{row.year}</span>}
            {row.seasonsCount ? <span>• {row.seasonsCount}S</span> : null}
            {row.episodesCount ? <span>• {row.episodesCount}E</span> : null}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-2 space-y-1.5 bg-black/60">
        <button
          onClick={onTogglePremium}
          className={`w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${
            row.premium
              ? "bg-gradient-to-r from-amber-400 to-yellow-600 text-black hover:brightness-110"
              : "bg-white/5 text-zinc-300 hover:bg-white/10"
          }`}
        >
          {row.premium ? <><Check className="w-3 h-3" /> Premium</> : <><Crown className="w-3 h-3" /> Lock</>}
        </button>
        <div className="grid grid-cols-2 gap-1">
          <button
            onClick={() => onSetDub("official")}
            className={`text-[9px] px-1.5 py-1 rounded font-semibold ${
              (row.dubType || "official") === "official" ? "bg-indigo-500/30 text-indigo-200" : "bg-white/5 text-zinc-500"
            }`}
          >
            Official
          </button>
          <button
            onClick={() => onSetDub("fandub")}
            className={`text-[9px] px-1.5 py-1 rounded font-semibold ${
              row.dubType === "fandub" ? "bg-pink-500/30 text-pink-200" : "bg-white/5 text-zinc-500"
            }`}
          >
            Fan Dub
          </button>
        </div>
        <button
          onClick={onOpenEpisodes}
          className="w-full inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-[10px] text-zinc-400 hover:text-amber-300 hover:bg-white/5"
        >
          Episode Locks <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function SeriesListRow({ row, onTogglePremium, onSetDub, onOpenEpisodes }: any) {
  return (
    <div className="flex items-center gap-3 p-3 hover:bg-white/[0.02]">
      <div className="w-11 h-16 rounded-md overflow-hidden bg-zinc-900 shrink-0">
        {row.poster ? <img src={row.poster} className="w-full h-full object-cover" loading="lazy" /> : null}
      </div>
      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${row.path !== "animesaltSelected" ? "bg-blue-500/20 text-blue-300" : "bg-emerald-500/20 text-emerald-300"}`}>
        {row.path !== "animesaltSelected" ? "RS" : "AN"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{row.title}</div>
        <div className="text-[10px] text-zinc-500">
          {row.year} • {row.seasonsCount || 0} Seasons • {row.episodesCount || 0} Episodes
        </div>
      </div>
      <div className="flex gap-1">
        <button onClick={() => onSetDub("official")} className={`text-[10px] px-2 py-1 rounded ${(row.dubType || "official") === "official" ? "bg-indigo-500/25 text-indigo-200" : "bg-white/5 text-zinc-500"}`}>Off</button>
        <button onClick={() => onSetDub("fandub")} className={`text-[10px] px-2 py-1 rounded ${row.dubType === "fandub" ? "bg-pink-500/25 text-pink-200" : "bg-white/5 text-zinc-500"}`}>Fan</button>
      </div>
      <Button size="sm" variant="outline" onClick={onOpenEpisodes} className="border-white/10 text-xs">
        Episodes
      </Button>
      <Button
        size="sm"
        onClick={onTogglePremium}
        className={row.premium ? "bg-gradient-to-r from-amber-400 to-yellow-600 text-black hover:brightness-110" : "bg-white/5 hover:bg-white/10"}
      >
        <Crown className="w-3.5 h-3.5" /> {row.premium ? "Premium" : "Free"}
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="col-span-full text-center py-16 text-zinc-500">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-white/5 flex items-center justify-center mb-3">
        <Search className="w-6 h-6" />
      </div>
      <div className="text-sm">No series match these filters.</div>
    </div>
  );
}

function EpisodeLockModal({ row, onClose }: { row: SeriesRow; onClose: () => void }) {
  const [seasons, setSeasons] = useState<any[]>([]);
  const [locks, setLocks] = useState<Record<string, boolean>>(row.premiumEpisodes || {});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openSeason, setOpenSeason] = useState(0);

  useEffect(() => {
    if (row.path === "animesaltSelected") {
      // AN series have no seasons stored in Firebase — resolve from the AN API.
      setLoading(true);
      resolveAnSeriesSeasons(row.id)
        .then((s) => setSeasons(Array.isArray(s) ? s : []))
        .catch(() => setSeasons([]))
        .finally(() => setLoading(false));
      return;
    }
    const u = onValue(ref(db, `${row.path}/${row.id}/seasons`), (snap) => {
      setSeasons(snap.val() || []);
    });
    return () => u();
  }, [row.id, row.path]);

  const save = async () => {
    setSaving(true);
    await update(ref(db, `${row.path}/${row.id}`), { premiumEpisodes: locks });
    setSaving(false);
    toast({ title: "Episode locks saved", description: row.title });
    onClose();
  };

  const toggleAll = (sIdx: number, val: boolean) => {
    const eps = seasons[sIdx]?.episodes || [];
    const next = { ...locks };
    eps.forEach((_: any, eIdx: number) => {
      next[`s${sIdx + 1}e${eIdx + 1}`] = val;
    });
    setLocks(next);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] rounded-3xl border border-amber-400/30 bg-gradient-to-b from-zinc-950 to-black shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-5 border-b border-white/10 bg-gradient-to-r from-amber-500/10 to-transparent">
          <div className="w-10 h-14 rounded-md overflow-hidden bg-zinc-900 shrink-0">
            {row.poster ? <img src={row.poster} className="w-full h-full object-cover" /> : null}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold truncate">{row.title}</div>
            <div className="text-xs text-zinc-500">Lock individual episodes as premium-only</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading && <div className="text-center py-10 text-amber-300 text-sm">Loading seasons from AN API…</div>}
          {!loading && seasons.length === 0 && <div className="text-center py-10 text-zinc-500 text-sm">No seasons found for this series.</div>}
          {seasons.map((s, sIdx) => {
            const isOpen = openSeason === sIdx;
            const eps = s?.episodes || [];
            const lockedInSeason = eps.filter((_: any, eIdx: number) => locks[`s${sIdx + 1}e${eIdx + 1}`]).length;
            return (
              <div key={sIdx} className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                <button
                  onClick={() => setOpenSeason(isOpen ? -1 : sIdx)}
                  className="w-full flex items-center gap-3 p-3.5 hover:bg-white/[0.03]"
                >
                  <ChevronRight className={`w-4 h-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  <div className="flex-1 text-left">
                    <div className="text-sm font-bold">Season {sIdx + 1}</div>
                    <div className="text-[10px] text-zinc-500">{eps.length} episodes • {lockedInSeason} locked</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleAll(sIdx, lockedInSeason !== eps.length); }}
                    className="text-[10px] px-2 py-1 rounded bg-amber-500/20 text-amber-200 font-semibold hover:bg-amber-500/30"
                  >
                    {lockedInSeason === eps.length ? "Unlock all" : "Lock all"}
                  </button>
                </button>
                {isOpen && (
                  <div className="p-3 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 border-t border-white/5">
                    {eps.map((_: any, eIdx: number) => {
                      const key = `s${sIdx + 1}e${eIdx + 1}`;
                      const locked = !!locks[key];
                      return (
                        <button
                          key={eIdx}
                          onClick={() => setLocks({ ...locks, [key]: !locked })}
                          className={`relative aspect-square rounded-lg text-xs font-bold flex items-center justify-center transition-all ${
                            locked
                              ? "bg-gradient-to-br from-amber-400 to-yellow-600 text-black shadow-[0_4px_15px_-4px_rgba(251,191,36,0.6)]"
                              : "bg-white/5 text-zinc-400 hover:bg-white/10"
                          }`}
                        >
                          {eIdx + 1}
                          {locked && <Crown className="w-3 h-3 absolute top-1 right-1" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-white/10 bg-black/40 flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} className="border-white/10">Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-gradient-to-r from-amber-400 to-yellow-600 text-black font-bold">
            <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Locks"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ stats, settings, premiumUsers, coinCirculation, onNav }: any) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-amber-500/5 to-transparent p-5">
        <div className="flex items-center gap-2 text-amber-300 font-bold mb-3"><Crown className="w-4 h-4" /> Active Plan</div>
        <div className="text-3xl font-black">{settings.coinPlan.coins} <span className="text-sm font-normal text-zinc-400">coins</span></div>
        <div className="text-sm text-zinc-400 mt-1">= {settings.coinPlan.days} days of Premium access</div>
        <button onClick={() => onNav("plans")} className="mt-4 text-xs text-amber-300 hover:text-amber-200 inline-flex items-center gap-1">Manage plans <ChevronRight className="w-3 h-3" /></button>
      </div>
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-500/5 to-transparent p-5">
        <div className="flex items-center gap-2 text-emerald-300 font-bold mb-3"><ShieldCheck className="w-4 h-4" /> Health Check</div>
        <ul className="text-sm space-y-2">
          <li className="flex justify-between"><span className="text-zinc-400">Quality locks</span> <span className="font-bold">{stats.qualityLocks}/4</span></li>
          <li className="flex justify-between"><span className="text-zinc-400">Download lock</span> <span className="font-bold">{settings.globalDownloadLock ? "ON" : "OFF"}</span></li>
          <li className="flex justify-between"><span className="text-zinc-400">Coin plans</span> <span className="font-bold">{(settings.extraPlans || []).length + 1}</span></li>
        </ul>
      </div>
      <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-5">
        <div className="text-sm font-bold text-zinc-300 mb-3">Quick Actions</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { l: "Lock Content", i: Lock, t: "series" },
            { l: "Quality Locks", i: Star, t: "quality" },
            { l: "Coin Plans", i: Crown, t: "plans" },
            { l: "Download Lock", i: Download, t: "download" },
          ].map((q) => (
            <button key={q.t} onClick={() => onNav(q.t)} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 hover:border-amber-400/30 hover:bg-amber-500/5 transition text-left">
              <q.i className="w-4 h-4 text-amber-300 mb-2" />
              <div className="text-xs font-bold">{q.l}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function QualityTab({ settings }: { settings: PremiumGlobalSettings }) {
  const qualities = [
    { id: "480p", label: "480p", desc: "SD baseline — usually free", icon: "📱" },
    { id: "720p", label: "720p", desc: "HD standard viewing", icon: "💻" },
    { id: "1080p", label: "1080p", desc: "Full HD — great candidate", icon: "🖥️" },
    { id: "4k", label: "4K", desc: "Ultra HD — best for premium", icon: "🎬" },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {qualities.map((q) => {
        const locked = !!settings.globalQualityLocks[q.id];
        return (
          <label key={q.id} className={`relative overflow-hidden rounded-2xl border p-5 cursor-pointer transition-all ${
            locked ? "border-amber-400/40 bg-gradient-to-br from-amber-500/10 to-transparent" : "border-white/10 bg-white/[0.02] hover:border-white/20"
          }`}>
            <div className="flex items-center gap-4">
              <div className="text-3xl">{q.icon}</div>
              <div className="flex-1">
                <div className="text-lg font-black">{q.label}</div>
                <div className="text-xs text-zinc-500">{q.desc}</div>
              </div>
              <div className={`w-12 h-6 rounded-full transition relative ${locked ? "bg-amber-500" : "bg-white/10"}`}>
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${locked ? "left-6" : "left-0.5"}`} />
              </div>
            </div>
            <input
              type="checkbox"
              className="sr-only"
              checked={locked}
              onChange={(e) => savePremiumSettings({ globalQualityLocks: { ...settings.globalQualityLocks, [q.id]: e.target.checked } })}
            />
            {locked && (
              <div className="absolute top-2 right-2 text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-400 text-black flex items-center gap-1">
                <Crown className="w-2.5 h-2.5" /> PRO
              </div>
            )}
          </label>
        );
      })}
    </div>
  );
}

function DownloadTab({ settings }: { settings: PremiumGlobalSettings }) {
  const on = !!settings.globalDownloadLock;
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-rose-500/5 to-transparent p-6">
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-400 to-pink-600 flex items-center justify-center shrink-0">
          <Download className="w-7 h-7 text-white" />
        </div>
        <div className="flex-1">
          <div className="text-lg font-bold">Premium-only Downloads</div>
          <div className="text-sm text-zinc-400 mt-1">When enabled, only premium users see the download button in the player.</div>
          <div className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full border ${on ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-300" : "bg-white/5 border-white/10 text-zinc-400"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"}`} /> {on ? "LOCKED · Premium only" : "OPEN · Everyone"}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => savePremiumSettings({ globalDownloadLock: !on })}
          className={`relative w-14 h-7 rounded-full transition-colors duration-300 ease-out shrink-0 ${on ? "bg-gradient-to-r from-amber-400 to-yellow-600" : "bg-white/10"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-lg transition-transform duration-300 ease-out ${on ? "translate-x-7" : "translate-x-0"}`}
          />
        </button>
      </div>
    </div>
  );
}

function EpisodeLockTab({
  rsSeries,
  onOpen,
  onToggleSeries,
}: {
  rsSeries: SeriesRow[];
  onOpen: (row: SeriesRow) => void;
  onToggleSeries: (row: SeriesRow) => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rsSeries
      .filter((r) => (term ? r.title.toLowerCase().includes(term) : true))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [rsSeries, q]);

  const totalLocked = rsSeries.reduce(
    (n, r) => n + Object.values(r.premiumEpisodes || {}).filter(Boolean).length,
    0,
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-purple-400/30 bg-gradient-to-br from-purple-500/10 via-fuchsia-500/5 to-transparent p-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-400 to-fuchsia-600 flex items-center justify-center">
            <Lock className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-base font-black">RS Episode Lock</div>
            <div className="text-xs text-zinc-400">Pick an RS series → lock full anime, or individual episodes one-by-one. AN uses full-series lock only.</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-purple-300 tabular-nums">{totalLocked}</div>
            <div className="text-[10px] text-zinc-500">episodes locked</div>
          </div>
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          className={`${inputCls} pl-10`}
          placeholder={`Search ${rsSeries.length} RS series...`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {rsSeries.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 py-14 text-center text-zinc-500 text-sm">
          RS series list is loading in the background. Cached data will appear here on next open.
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-black/20 divide-y divide-white/5 max-h-none">
          {list.slice(0, 400).map((row) => {
            const lockedEps = Object.values(row.premiumEpisodes || {}).filter(Boolean).length;
            return (
              <div key={`${row.path}-${row.id}`} className="flex items-center gap-3 p-3 hover:bg-white/[0.02]">
                <div className="w-10 h-14 rounded-md overflow-hidden bg-zinc-900 shrink-0">
                  {row.poster ? <img src={row.poster} className="w-full h-full object-cover" loading="lazy" /> : null}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{row.title}</div>
                  <div className="text-[10px] text-zinc-500">
                    RS • {row.seasonsCount || 0}S • {row.episodesCount || 0}E {lockedEps > 0 && <span className="text-purple-300 font-bold">· {lockedEps} locked</span>}
                  </div>
                </div>
                <button
                  onClick={() => onToggleSeries(row)}
                  className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg ${row.premium ? "bg-gradient-to-r from-amber-400 to-yellow-600 text-black" : "bg-white/5 text-zinc-300 hover:bg-white/10"}`}
                >
                  {row.premium ? "Full Locked" : "Lock Full"}
                </button>
                <button
                  onClick={() => onOpen(row)}
                  className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-purple-500/20 text-purple-200 hover:bg-purple-500/30 inline-flex items-center gap-1"
                >
                  <Lock className="w-3 h-3" /> Episodes
                </button>
              </div>
            );
          })}
          {list.length === 0 && (
            <div className="py-10 text-center text-zinc-500 text-sm">No RS series match "{q}".</div>
          )}
        </div>
      )}
    </div>
  );
}


function PlansEditor({ settings }: { settings: PremiumGlobalSettings }) {
  const [defPlan, setDefPlan] = useState<CoinPlan>(settings.coinPlan);
  const [extras, setExtras] = useState<CoinPlan[]>(settings.extraPlans || []);

  useEffect(() => setDefPlan(settings.coinPlan), [settings.coinPlan]);
  useEffect(() => setExtras(settings.extraPlans || []), [settings.extraPlans]);

  const save = async () => {
    await savePremiumSettings({
      coinPlan: { ...defPlan, id: "default", featured: true },
      extraPlans: extras,
    });
    toast({ title: "Plans saved" });
  };
  const addExtra = () => setExtras([...extras, { id: `p_${Date.now()}`, name: "New Plan", coins: 40, days: 12 }]);

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/10 via-yellow-500/5 to-transparent p-5">
        <div className="absolute top-2 right-2 text-[9px] font-black px-2 py-0.5 rounded bg-amber-400 text-black">DEFAULT</div>
        <div className="flex items-center gap-2 mb-3">
          <Crown className="w-5 h-5 text-amber-300" />
          <div className="text-base font-bold text-amber-200">Starter Plan</div>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-xs">Name<input className={`${inputCls} mt-1`} value={defPlan.name} onChange={(e) => setDefPlan({ ...defPlan, name: e.target.value })} /></label>
          <label className="text-xs">Coins<input className={`${inputCls} mt-1`} type="number" value={defPlan.coins} onChange={(e) => setDefPlan({ ...defPlan, coins: Number(e.target.value) })} /></label>
          <label className="text-xs">Days<input className={`${inputCls} mt-1`} type="number" value={defPlan.days} onChange={(e) => setDefPlan({ ...defPlan, days: Number(e.target.value) })} /></label>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
        <div className="flex justify-between items-center mb-3">
          <div className="text-sm font-bold">Extra Plans</div>
          <Button size="sm" variant="outline" onClick={addExtra} className="border-white/10"><Plus className="w-3.5 h-3.5" /> Add</Button>
        </div>
        <div className="space-y-2">
          {extras.map((p, i) => (
            <div key={p.id} className="grid grid-cols-[1fr_100px_100px_auto] gap-2 items-center bg-white/[0.02] rounded-xl p-2">
              <input className={inputCls} value={p.name} onChange={(e) => { const c = [...extras]; c[i] = { ...p, name: e.target.value }; setExtras(c); }} />
              <input className={inputCls} type="number" value={p.coins} onChange={(e) => { const c = [...extras]; c[i] = { ...p, coins: Number(e.target.value) }; setExtras(c); }} placeholder="coins" />
              <input className={inputCls} type="number" value={p.days} onChange={(e) => { const c = [...extras]; c[i] = { ...p, days: Number(e.target.value) }; setExtras(c); }} placeholder="days" />
              <Button size="sm" variant="destructive" onClick={() => setExtras(extras.filter((_, k) => k !== i))}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
          {extras.length === 0 && <div className="text-xs text-zinc-500 text-center py-4">No extra plans. Users will only see the default.</div>}
        </div>
      </div>

      <Button onClick={save} className="w-full bg-gradient-to-r from-amber-400 to-yellow-600 text-black font-bold hover:brightness-110"><Save className="w-4 h-4" /> Save All Plans</Button>
    </div>
  );
}
