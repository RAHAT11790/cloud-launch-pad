import { useEffect, useState } from "react";
import { db, ref, onValue, set, update } from "@/lib/firebase";
import { Crown, Coins, Lock, Download, Plus, Trash2, Save, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import {
  DEFAULT_PREMIUM_SETTINGS,
  PremiumGlobalSettings,
  savePremiumSettings,
  subscribePremiumSettings,
  subscribeCoinAds,
  saveCoinAd,
  deleteCoinAd,
  CoinAd,
  CoinPlan,
} from "@/lib/premiumAccess";

type Tab = "series" | "quality" | "download" | "plans" | "ads" | "episodes";

interface SeriesRow {
  id: string;
  path: "series" | "animeSaltSelected";
  title: string;
  premium: boolean;
  dubType?: "official" | "fan";
}

const inputCls = "w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-amber-400/50";

export default function PremiumCenter() {
  const [tab, setTab] = useState<Tab>("series");
  const [settings, setSettings] = useState<PremiumGlobalSettings>(DEFAULT_PREMIUM_SETTINGS);
  const [ads, setAds] = useState<CoinAd[]>([]);
  const [rsSeries, setRsSeries] = useState<SeriesRow[]>([]);
  const [anSeries, setAnSeries] = useState<SeriesRow[]>([]);
  const [q, setQ] = useState("");
  const [dubFilter, setDubFilter] = useState<"all" | "official" | "fan">("all");

  useEffect(() => subscribePremiumSettings(setSettings), []);
  useEffect(() => subscribeCoinAds(setAds), []);

  useEffect(() => {
    const u1 = onValue(ref(db, "series"), (snap) => {
      const raw = snap.val() || {};
      const list = Object.entries(raw).map(([id, v]: any) => ({
        id,
        path: "series" as const,
        title: v?.title || v?.name || id,
        premium: !!v?.premium,
        dubType: v?.dubType,
      }));
      setRsSeries(list);
    });
    const u2 = onValue(ref(db, "animeSaltSelected"), (snap) => {
      const raw = snap.val() || {};
      const list = Object.entries(raw).map(([id, v]: any) => ({
        id,
        path: "animeSaltSelected" as const,
        title: v?.title || v?.name || id,
        premium: !!v?.premium,
        dubType: v?.dubType,
      }));
      setAnSeries(list);
    });
    return () => { u1(); u2(); };
  }, []);

  const allSeries = [...rsSeries, ...anSeries];
  const filtered = allSeries.filter((s) => {
    if (dubFilter !== "all" && (s.dubType || "official") !== dubFilter) return false;
    if (q && !s.title.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const togglePremium = async (row: SeriesRow) => {
    await update(ref(db, `${row.path}/${row.id}`), { premium: !row.premium });
    toast({ title: row.premium ? "Removed from Premium" : "Marked as Premium", description: row.title });
  };

  const toggleDub = async (row: SeriesRow, dub: "official" | "fan") => {
    await update(ref(db, `${row.path}/${row.id}`), { dubType: dub });
  };

  const toggleQuality = (q: string, val: boolean) => {
    savePremiumSettings({ globalQualityLocks: { ...settings.globalQualityLocks, [q]: val } });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-2xl border border-amber-400/20 bg-gradient-to-r from-amber-500/10 to-transparent p-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center">
            <Crown className="w-6 h-6 text-black" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Premium Center</h2>
            <p className="text-xs text-zinc-400">Manage all premium locks, plans, ads and content in one place.</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          { id: "series", label: "Series Locks", icon: Lock },
          { id: "quality", label: "Quality Locks", icon: Star },
          { id: "download", label: "Download Lock", icon: Download },
          { id: "plans", label: "Plans", icon: Crown },
          { id: "ads", label: "Coin Ads", icon: Coins },
        ] as { id: Tab; label: string; icon: any }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm border transition ${
              tab === t.id ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "series" && (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input className={`${inputCls} pl-9`} placeholder="Search series..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex gap-1">
              {(["all", "official", "fan"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDubFilter(d)}
                  className={`px-3 py-2 rounded-lg text-xs capitalize border ${
                    dubFilter === d ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-white/10 text-zinc-400"
                  }`}
                >
                  {d === "all" ? "All" : d + " Dub"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-2 max-h-[520px] overflow-y-auto pr-1">
            {filtered.slice(0, 400).map((row) => (
              <div key={`${row.path}-${row.id}`} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${row.path === "series" ? "bg-blue-500/20 text-blue-300" : "bg-emerald-500/20 text-emerald-300"}`}>
                  {row.path === "series" ? "RS" : "AN"}
                </span>
                <div className="flex-1 min-w-0 text-sm truncate">{row.title}</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => toggleDub(row, "official")}
                    className={`text-[10px] px-2 py-1 rounded ${(row.dubType || "official") === "official" ? "bg-indigo-500/25 text-indigo-200" : "bg-white/5 text-zinc-500"}`}
                  >Official</button>
                  <button
                    onClick={() => toggleDub(row, "fan")}
                    className={`text-[10px] px-2 py-1 rounded ${row.dubType === "fan" ? "bg-pink-500/25 text-pink-200" : "bg-white/5 text-zinc-500"}`}
                  >Fan</button>
                </div>
                <Button
                  size="sm"
                  onClick={() => togglePremium(row)}
                  className={row.premium ? "bg-amber-500 text-black hover:bg-amber-400" : "bg-white/5 hover:bg-white/10"}
                >
                  <Crown className="w-3.5 h-3.5" /> {row.premium ? "Premium" : "Free"}
                </Button>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-center text-sm text-zinc-500 py-10">No series found.</div>
            )}
          </div>
        </div>
      )}

      {tab === "quality" && (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5 space-y-3">
          <div className="text-sm text-zinc-400">Toggle qualities that require Premium. Free users see 🔒 on those.</div>
          {["480p", "720p", "1080p", "4k"].map((q) => (
            <label key={q} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <div>
                <div className="text-sm font-semibold uppercase">{q}</div>
                <div className="text-xs text-zinc-500">{q === "4k" ? "Ultra HD (recommended premium)" : "Standard quality"}</div>
              </div>
              <input
                type="checkbox"
                checked={!!settings.globalQualityLocks[q]}
                onChange={(e) => toggleQuality(q, e.target.checked)}
                className="w-5 h-5 accent-amber-400"
              />
            </label>
          ))}
        </div>
      )}

      {tab === "download" && (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <label className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-4">
            <div>
              <div className="text-sm font-semibold flex items-center gap-2"><Download className="w-4 h-4" /> Premium-only Downloads</div>
              <div className="text-xs text-zinc-500 mt-1">When ON, only premium users can download videos.</div>
            </div>
            <input
              type="checkbox"
              checked={settings.globalDownloadLock}
              onChange={(e) => savePremiumSettings({ globalDownloadLock: e.target.checked })}
              className="w-5 h-5 accent-amber-400"
            />
          </label>
        </div>
      )}

      {tab === "plans" && <PlansEditor settings={settings} />}
      {tab === "ads" && <CoinAdsEditor ads={ads} />}
    </div>
  );
}

function PlansEditor({ settings }: { settings: PremiumGlobalSettings }) {
  const [defPlan, setDefPlan] = useState<CoinPlan>(settings.coinPlan);
  const [extras, setExtras] = useState<CoinPlan[]>(settings.extraPlans || []);
  const [dailyCap, setDailyCap] = useState(settings.dailyAdCap);
  const [watchSecs, setWatchSecs] = useState(settings.adWatchSeconds);

  useEffect(() => setDefPlan(settings.coinPlan), [settings.coinPlan]);
  useEffect(() => setExtras(settings.extraPlans || []), [settings.extraPlans]);
  useEffect(() => setDailyCap(settings.dailyAdCap), [settings.dailyAdCap]);
  useEffect(() => setWatchSecs(settings.adWatchSeconds), [settings.adWatchSeconds]);

  const save = async () => {
    await savePremiumSettings({
      coinPlan: { ...defPlan, id: "default", featured: true },
      extraPlans: extras,
      dailyAdCap: Math.max(1, dailyCap),
      adWatchSeconds: Math.max(5, watchSecs),
    });
    toast({ title: "Plans saved" });
  };

  const addExtra = () =>
    setExtras([...extras, { id: `p_${Date.now()}`, name: "New Plan", coins: 40, days: 12 }]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-400/30 bg-amber-500/5 p-4">
        <div className="text-sm font-semibold text-amber-200 mb-3">Default Plan</div>
        <div className="grid sm:grid-cols-3 gap-2">
          <input className={inputCls} value={defPlan.name} onChange={(e) => setDefPlan({ ...defPlan, name: e.target.value })} placeholder="Name" />
          <input className={inputCls} type="number" value={defPlan.coins} onChange={(e) => setDefPlan({ ...defPlan, coins: Number(e.target.value) })} placeholder="Coins" />
          <input className={inputCls} type="number" value={defPlan.days} onChange={(e) => setDefPlan({ ...defPlan, days: Number(e.target.value) })} placeholder="Days" />
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="text-sm font-semibold">Extra Plans</div>
          <Button size="sm" variant="outline" onClick={addExtra}><Plus className="w-3.5 h-3.5" /> Add</Button>
        </div>
        <div className="space-y-2">
          {extras.map((p, i) => (
            <div key={p.id} className="grid grid-cols-[1fr_100px_100px_auto] gap-2 items-center">
              <input className={inputCls} value={p.name} onChange={(e) => { const c = [...extras]; c[i] = { ...p, name: e.target.value }; setExtras(c); }} />
              <input className={inputCls} type="number" value={p.coins} onChange={(e) => { const c = [...extras]; c[i] = { ...p, coins: Number(e.target.value) }; setExtras(c); }} />
              <input className={inputCls} type="number" value={p.days} onChange={(e) => { const c = [...extras]; c[i] = { ...p, days: Number(e.target.value) }; setExtras(c); }} />
              <Button size="sm" variant="destructive" onClick={() => setExtras(extras.filter((_, k) => k !== i))}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
          {extras.length === 0 && <div className="text-xs text-zinc-500">No extra plans.</div>}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/30 p-4 grid sm:grid-cols-2 gap-3">
        <label className="text-sm">
          Daily ad cap
          <input className={`${inputCls} mt-1`} type="number" value={dailyCap} onChange={(e) => setDailyCap(Number(e.target.value))} />
        </label>
        <label className="text-sm">
          Required watch seconds
          <input className={`${inputCls} mt-1`} type="number" value={watchSecs} onChange={(e) => setWatchSecs(Number(e.target.value))} />
        </label>
      </div>

      <Button onClick={save} className="bg-amber-500 text-black hover:bg-amber-400"><Save className="w-4 h-4" /> Save Plans</Button>
    </div>
  );
}

function CoinAdsEditor({ ads }: { ads: CoinAd[] }) {
  const [items, setItems] = useState<CoinAd[]>(ads);
  useEffect(() => setItems(ads), [ads]);

  const add = () => setItems([...items, { id: `ad_${Date.now()}`, name: `Ad ${items.length + 1}`, url: "", enabled: true }]);
  const saveAll = async () => {
    for (const it of items) await saveCoinAd(it);
    toast({ title: "Ads saved" });
  };
  const remove = async (id: string) => {
    await deleteCoinAd(id);
    setItems(items.filter((i) => i.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="text-sm font-semibold">Adsterra Direct-Link Ads (max 5)</div>
          <Button size="sm" variant="outline" onClick={add} disabled={items.length >= 5}><Plus className="w-3.5 h-3.5" /> Add Ad</Button>
        </div>
        <div className="space-y-3">
          {items.map((ad, i) => (
            <div key={ad.id} className="grid grid-cols-[130px_1fr_80px_auto] gap-2 items-center">
              <input className={inputCls} value={ad.name} onChange={(e) => { const c = [...items]; c[i] = { ...ad, name: e.target.value }; setItems(c); }} placeholder="Name" />
              <input className={inputCls} value={ad.url} onChange={(e) => { const c = [...items]; c[i] = { ...ad, url: e.target.value }; setItems(c); }} placeholder="https://adsterra-direct-link..." />
              <label className="text-xs flex items-center gap-1 justify-center">
                <input type="checkbox" checked={ad.enabled !== false} onChange={(e) => { const c = [...items]; c[i] = { ...ad, enabled: e.target.checked }; setItems(c); }} className="accent-amber-400" />
                On
              </label>
              <Button size="sm" variant="destructive" onClick={() => remove(ad.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
          {items.length === 0 && <div className="text-xs text-zinc-500">No ads yet.</div>}
        </div>
      </div>
      <Button onClick={saveAll} className="bg-amber-500 text-black hover:bg-amber-400"><Save className="w-4 h-4" /> Save All Ads</Button>
    </div>
  );
}
