import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, AlertTriangle, CheckCircle2, DollarSign, Eye, Globe2, Info,
  MousePointerClick, RefreshCw, TrendingDown, TrendingUp, Percent, Smartphone,
} from "lucide-react";

type Row = {
  date?: string; placement?: number; country?: string; domain?: number;
  impression?: number; clicks?: number; ctr?: number; cpm?: number; revenue?: number;
};
type Placement = { id: number; domain_id: number; title: string; alias?: string };
type DomainRow = { id: number; title: string };

type Overview = {
  byDate: Row[]; byPlacement: Row[]; byCountry: Row[]; byDomain: Row[];
  domains: DomainRow[]; placements: Placement[]; lastUpdate: string | null;
};

const RANGES = [
  { key: "today", label: "Today", days: 0 },
  { key: "7d", label: "7 Days", days: 6 },
  { key: "14d", label: "14 Days", days: 13 },
  { key: "30d", label: "30 Days", days: 29 },
] as const;

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const shiftDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const money = (n: number) => `$${n.toFixed(n >= 10 ? 2 : 3)}`;
const num = (n: number) => n.toLocaleString("en-US");
const sum = (rows: Row[], k: keyof Row) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

const PIE_COLORS = ["#a855f7", "#22d3ee", "#f59e0b", "#34d399", "#f472b6", "#60a5fa"];

const AdsterraAnalytics = () => {
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]["key"]>("7d");
  const [data, setData] = useState<Overview | null>(null);
  const [prev, setPrev] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const days = RANGES.find((r) => r.key === rangeKey)!.days;
  const start = fmtDate(shiftDays(days));
  const finish = fmtDate(new Date());
  const prevStart = fmtDate(shiftDays(days * 2 + 1));
  const prevFinish = fmtDate(shiftDays(days + 1));

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [cur, old] = await Promise.all([
        supabase.functions.invoke("adsterra-stats", { body: { action: "overview", start, finish } }),
        supabase.functions.invoke("adsterra-stats", {
          body: { action: "stats", start: prevStart, finish: prevFinish, group_by: ["date"] },
        }),
      ]);
      if (cur.error) throw new Error(cur.error.message);
      if ((cur.data as any)?.error) throw new Error((cur.data as any).error);
      setData(cur.data as Overview);
      setPrev(((old.data as any)?.items ?? []) as Row[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load Adsterra stats");
    }
    setLoading(false);
  }, [start, finish, prevStart, prevFinish]);

  useEffect(() => { void load(); }, [load]);

  const placementName = useCallback((id?: number) => {
    const p = data?.placements.find((x) => x.id === id);
    const dom = data?.domains.find((d) => d.id === p?.domain_id);
    return p ? `${p.title}${dom ? ` · ${dom.title.replace(/\.lovable\.app$/, "")}` : ""}` : `#${id ?? "?"}`;
  }, [data]);

  const totals = useMemo(() => {
    const rows = data?.byDate ?? [];
    const imp = sum(rows, "impression"), clk = sum(rows, "clicks"), rev = sum(rows, "revenue");
    return { imp, clk, rev, ctr: imp ? (clk / imp) * 100 : 0, cpm: imp ? (rev / imp) * 1000 : 0 };
  }, [data]);

  const prevTotals = useMemo(() => {
    const rows = prev ?? [];
    const imp = sum(rows, "impression"), clk = sum(rows, "clicks"), rev = sum(rows, "revenue");
    return { imp, clk, rev, ctr: imp ? (clk / imp) * 100 : 0, cpm: imp ? (rev / imp) * 1000 : 0 };
  }, [prev]);

  const daily = useMemo(() => {
    const map = new Map<string, { date: string; impression: number; clicks: number; revenue: number }>();
    (data?.byDate ?? []).forEach((r) => {
      const d = r.date || "";
      const e = map.get(d) || { date: d, impression: 0, clicks: 0, revenue: 0 };
      e.impression += Number(r.impression) || 0;
      e.clicks += Number(r.clicks) || 0;
      e.revenue += Number(r.revenue) || 0;
      map.set(d, e);
    });
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, ctr: d.impression ? +((d.clicks / d.impression) * 100).toFixed(2) : 0,
        cpm: d.impression ? +((d.revenue / d.impression) * 1000).toFixed(3) : 0,
        label: d.date.slice(5) }));
  }, [data]);

  const placements = useMemo(() => {
    return (data?.byPlacement ?? [])
      .map((r) => ({
        id: r.placement!, name: placementName(r.placement),
        impression: Number(r.impression) || 0, clicks: Number(r.clicks) || 0,
        revenue: Number(r.revenue) || 0,
        ctr: Number(r.impression) ? ((Number(r.clicks) || 0) / Number(r.impression)) * 100 : 0,
        cpm: Number(r.impression) ? ((Number(r.revenue) || 0) / Number(r.impression)) * 1000 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [data, placementName]);

  const countries = useMemo(() => {
    const map = new Map<string, { country: string; impression: number; clicks: number; revenue: number }>();
    (data?.byCountry ?? []).forEach((r) => {
      const c = r.country || "??";
      const e = map.get(c) || { country: c, impression: 0, clicks: 0, revenue: 0 };
      e.impression += Number(r.impression) || 0;
      e.clicks += Number(r.clicks) || 0;
      e.revenue += Number(r.revenue) || 0;
      map.set(c, e);
    });
    return [...map.values()]
      .map((c) => ({ ...c, cpm: c.impression ? (c.revenue / c.impression) * 1000 : 0,
        ctr: c.impression ? (c.clicks / c.impression) * 100 : 0 }))
      .sort((a, b) => b.impression - a.impression);
  }, [data]);

  const domainRows = useMemo(() => (data?.byDomain ?? []).map((r) => ({
    name: data?.domains.find((d) => d.id === r.domain)?.title || `#${r.domain}`,
    impression: Number(r.impression) || 0,
    clicks: Number(r.clicks) || 0, revenue: Number(r.revenue) || 0,
  })).sort((a, b) => b.impression - a.impression), [data]);

  /* ---------------- Click Gap Analysis ---------------- */
  const gaps = useMemo(() => {
    const out: { level: "critical" | "warn" | "ok"; title: string; detail: string; fix: string; metric?: string }[] = [];
    if (!data) return out;

    const activeDomainIds = new Set(placements.filter((p) => p.impression > 0)
      .map((p) => data.placements.find((x) => x.id === p.id)?.domain_id)
      .filter(Boolean) as number[]);

    // 1. Placements created in Adsterra but receiving zero traffic
    const silent = data.placements.filter(
      (p) => activeDomainIds.has(p.domain_id) && !placements.some((x) => x.id === p.id && x.impression > 0),
    );
    if (silent.length) {
      out.push({
        level: "warn",
        title: `${silent.length} placement(s) getting zero impressions`,
        metric: silent.map((s) => s.title).join(", "),
        detail: "These placements exist in your Adsterra account but the site never requested them during this period — the ad code is either missing from the app, blocked before it loads, or gated behind a screen users rarely reach.",
        fix: "Paste each placement's script into Adsterra Ads → settings, and make sure the slot renders for non-premium users (premium users bypass ads by design).",
      });
    }

    // 2. Impressions with zero clicks (click not registering)
    const zeroClickPl = placements.filter((p) => p.impression >= 200 && p.clicks === 0);
    if (zeroClickPl.length) {
      out.push({
        level: "critical",
        title: `${zeroClickPl.length} placement(s) with impressions but 0 recorded clicks`,
        metric: zeroClickPl.map((p) => `${p.name} · ${num(p.impression)} imp`).join(" | "),
        detail: "For Popunder this is expected (Adsterra counts a popunder open as an impression, not a click). But if this is a Social Bar / Banner / Direct-link slot, the click is being swallowed — usually by popup blocking, an intercepted `click` handler, an ad-blocked redirect, or the new tab being killed before it navigates.",
        fix: "Open ad links from a real user gesture (no setTimeout / async gap before window.open), avoid `preventDefault` on the ad anchor, and never re-trigger the ad script inside a capture-phase listener that also stops propagation.",
      });
    }

    // 3. Very high CTR = accidental/invalid clicks risk
    const highCtr = placements.filter((p) => p.impression >= 50 && p.ctr > 15);
    if (highCtr.length) {
      out.push({
        level: "warn",
        title: "Abnormally high CTR detected — invalid-click risk",
        metric: highCtr.map((p) => `${p.name} · ${p.ctr.toFixed(1)}% CTR`).join(" | "),
        detail: "CTR above ~15% usually means users are clicking the ad by accident (ad overlapping a real button) or clicking repeatedly. Adsterra filters those clicks, pays nothing for them and can lower your CPM for the whole domain.",
        fix: "Move the Social Bar away from play / next-episode buttons and add spacing so real UI is never under the ad layer.",
      });
    }

    // 4. Revenue-less impressions (unfilled / rejected requests)
    const noRev = placements.filter((p) => p.impression >= 100 && p.revenue <= 0.0005);
    if (noRev.length) {
      out.push({
        level: "critical",
        title: `${noRev.length} placement(s) serving impressions with almost no revenue`,
        metric: noRev.map((p) => `${p.name} · ${money(p.revenue)}`).join(" | "),
        detail: "Adsterra received the request but paid nothing — the traffic was classified as low quality, the geo has no demand, or the impression was discarded as non-viewable.",
        fix: "Check the country table below: if traffic is concentrated in ultra-low-CPM geos, reduce ad frequency there and focus promotion on higher-CPM countries.",
      });
    }

    // 5. Low CPM concentration
    const lowCpmShare = (() => {
      const totalImp = countries.reduce((a, c) => a + c.impression, 0);
      const low = countries.filter((c) => c.cpm < 0.2).reduce((a, c) => a + c.impression, 0);
      return totalImp ? (low / totalImp) * 100 : 0;
    })();
    if (lowCpmShare > 40) {
      out.push({
        level: "warn",
        title: `${lowCpmShare.toFixed(0)}% of impressions come from sub-$0.20 CPM geos`,
        detail: "Most of your inventory is being burned on traffic that barely pays. Revenue scales with CPM, not raw impressions.",
        fix: "Keep the ad count low for these geos and push more content/SEO towards Tier-1 & Gulf audiences visible in the country table.",
      });
    }

    // 6. Day-over-day collapse
    if (daily.length >= 2) {
      const last = daily[daily.length - 1], before = daily[daily.length - 2];
      if (before.impression > 100 && last.impression < before.impression * 0.5) {
        out.push({
          level: "critical",
          title: "Impressions dropped more than 50% versus yesterday",
          metric: `${num(before.impression)} → ${num(last.impression)}`,
          detail: "A sudden collapse almost always means the ad script stopped loading (deploy change, domain lock, wrong placement key) rather than a traffic drop.",
          fix: "Verify the site is still reachable at the domain registered in Adsterra and that the ad scripts survived the latest deploy. Today's figures may also still be partially aggregated.",
        });
      }
    }

    if (!out.length) {
      out.push({
        level: "ok", title: "No structural click/impression loss detected",
        detail: "Every active placement is serving impressions, registering clicks and generating revenue within a normal range for this period.",
        fix: "Keep monitoring daily — recheck after any deploy that touches ad code.",
      });
    }
    return out;
  }, [data, placements, countries, daily]);

  /* ---------------- UI ---------------- */
  const delta = (cur: number, old: number) => (old > 0 ? ((cur - old) / old) * 100 : cur > 0 ? 100 : 0);

  const kpis = [
    { label: "Revenue", value: money(totals.rev), icon: DollarSign, d: delta(totals.rev, prevTotals.rev), tint: "text-emerald-300", ring: "from-emerald-500/20" },
    { label: "Impressions", value: num(totals.imp), icon: Eye, d: delta(totals.imp, prevTotals.imp), tint: "text-sky-300", ring: "from-sky-500/20" },
    { label: "Clicks", value: num(totals.clk), icon: MousePointerClick, d: delta(totals.clk, prevTotals.clk), tint: "text-fuchsia-300", ring: "from-fuchsia-500/20" },
    { label: "CTR", value: `${totals.ctr.toFixed(2)}%`, icon: Percent, d: delta(totals.ctr, prevTotals.ctr), tint: "text-amber-300", ring: "from-amber-500/20" },
    { label: "eCPM", value: money(totals.cpm), icon: Activity, d: delta(totals.cpm, prevTotals.cpm), tint: "text-violet-300", ring: "from-violet-500/20" },
  ];

  const card = "rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] backdrop-blur";
  const maxImp = Math.max(1, ...placements.map((p) => p.impression));

  const tooltipStyle = {
    contentStyle: { background: "rgba(12,10,24,0.95)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, fontSize: 11, color: "#fff" },
    labelStyle: { color: "rgba(255,255,255,0.6)", fontSize: 11 },
  };

  return (
    <div className="space-y-5 min-w-0">
      {/* Header */}
      <section className={`${card} p-4 flex flex-wrap items-center justify-between gap-3`}>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center">📊</span>
            Adsterra Revenue Analytics
          </h3>
          <p className="text-[11px] text-white/45 mt-1">
            {start} → {finish}
            {data?.lastUpdate ? ` · synced ${data.lastUpdate}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRangeKey(r.key)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                rangeKey === r.key
                  ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-200"
                  : "bg-white/5 border-white/10 text-white/60 hover:text-white"}`}>
              {r.label}
            </button>
          ))}
          <button onClick={() => void load()} disabled={loading}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-white/70 hover:text-white inline-flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Sync
          </button>
        </div>
      </section>

      {err && (
        <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-[11px] text-red-200 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span className="break-all">{err}</span>
        </div>
      )}

      {/* KPI */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className={`${card} p-3.5 relative overflow-hidden`}>
            <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br ${k.ring} to-transparent blur-xl`} />
            <div className="relative">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/45">
                <k.icon className={`w-3.5 h-3.5 ${k.tint}`} /> {k.label}
              </div>
              <div className="mt-1.5 text-xl font-extrabold text-white tabular-nums">
                {loading && !data ? "—" : k.value}
              </div>
              <div className={`mt-1 inline-flex items-center gap-1 text-[10px] font-semibold ${
                k.d >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {k.d >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(k.d).toFixed(1)}% <span className="text-white/35 font-normal">vs prev</span>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Revenue + impression trend */}
      <section className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-[12px] font-bold text-white">Revenue & Impressions</h4>
          <span className="text-[10px] text-white/40">daily aggregation</span>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gImp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }} />
              <Area yAxisId="r" type="monotone" dataKey="impression" name="Impressions" stroke="#38bdf8" fill="url(#gImp)" strokeWidth={1.5} />
              <Area yAxisId="l" type="monotone" dataKey="revenue" name="Revenue ($)" stroke="#34d399" fill="url(#gRev)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Clicks + CTR */}
      <section className="grid lg:grid-cols-2 gap-3">
        <div className={`${card} p-4`}>
          <h4 className="text-[12px] font-bold text-white mb-3">Clicks per day</h4>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                <Bar dataKey="clicks" name="Clicks" fill="#d946ef" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={`${card} p-4`}>
          <h4 className="text-[12px] font-bold text-white mb-3">CTR % vs eCPM</h4>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }} />
                <Line type="monotone" dataKey="ctr" name="CTR %" stroke="#fbbf24" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cpm" name="eCPM $" stroke="#a78bfa" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Placement performance */}
      <section className={`${card} p-4`}>
        <h4 className="text-[12px] font-bold text-white mb-3">Placement performance</h4>
        <div className="space-y-2">
          {placements.length === 0 && <p className="text-[11px] text-white/40">No placement data for this range.</p>}
          {placements.map((p) => (
            <div key={p.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-[11.5px] font-semibold text-white truncate">{p.name}</span>
                <span className="text-[11.5px] font-bold text-emerald-300 tabular-nums shrink-0">{money(p.revenue)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/8 overflow-hidden mb-2">
                <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-fuchsia-500"
                  style={{ width: `${(p.impression / maxImp) * 100}%` }} />
              </div>
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                {[["Impr", num(p.impression)], ["Clicks", num(p.clicks)],
                  ["CTR", `${p.ctr.toFixed(2)}%`], ["eCPM", money(p.cpm)]].map(([l, v]) => (
                  <div key={l}>
                    <div className="text-white/40 uppercase tracking-wide">{l}</div>
                    <div className="text-white/90 font-semibold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Click Gap Analysis */}
      <section className={`${card} p-4`}>
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-4 h-4 text-amber-300" />
          <h4 className="text-[12px] font-bold text-white">Click Gap Analysis</h4>
        </div>
        <p className="text-[10.5px] text-white/45 mb-3">Why impressions or clicks are not being counted — and how to fix each one.</p>
        <div className="space-y-2.5">
          {gaps.map((g, i) => {
            const tone = g.level === "critical"
              ? { b: "border-rose-400/30", bg: "bg-rose-500/10", t: "text-rose-200", chip: "bg-rose-500/20 text-rose-200", Icon: AlertTriangle, label: "Critical" }
              : g.level === "warn"
              ? { b: "border-amber-400/30", bg: "bg-amber-500/10", t: "text-amber-200", chip: "bg-amber-500/20 text-amber-200", Icon: Info, label: "Warning" }
              : { b: "border-emerald-400/30", bg: "bg-emerald-500/10", t: "text-emerald-200", chip: "bg-emerald-500/20 text-emerald-200", Icon: CheckCircle2, label: "Healthy" };
            return (
              <div key={i} className={`rounded-xl border ${g.level === "ok" ? tone.b : tone.b} ${tone.bg} p-3`}>
                <div className="flex items-start gap-2">
                  <tone.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${tone.t}`} />
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[11.5px] font-bold ${tone.t}`}>{g.title}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${tone.chip}`}>{tone.label}</span>
                    </div>
                    {g.metric && <div className="text-[10px] font-mono text-white/55 break-all">{g.metric}</div>}
                    <p className="text-[11px] text-white/70 leading-relaxed">{g.detail}</p>
                    <p className="text-[11px] text-white/85 leading-relaxed">
                      <span className="text-white/45">Fix → </span>{g.fix}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Geo + OS */}
      <section className="grid lg:grid-cols-2 gap-3">
        <div className={`${card} p-4`}>
          <h4 className="text-[12px] font-bold text-white mb-3 flex items-center gap-2">
            <Globe2 className="w-3.5 h-3.5 text-sky-300" /> Top countries
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-white/40 text-[10px] uppercase tracking-wider">
                  <th className="text-left font-medium pb-2">Geo</th>
                  <th className="text-right font-medium pb-2">Impr</th>
                  <th className="text-right font-medium pb-2">Clicks</th>
                  <th className="text-right font-medium pb-2">eCPM</th>
                  <th className="text-right font-medium pb-2">Rev</th>
                </tr>
              </thead>
              <tbody>
                {countries.slice(0, 12).map((c) => (
                  <tr key={c.country} className="border-t border-white/5">
                    <td className="py-1.5 text-white/85 font-semibold">{c.country}</td>
                    <td className="py-1.5 text-right text-white/70 tabular-nums">{num(c.impression)}</td>
                    <td className="py-1.5 text-right text-white/70 tabular-nums">{num(c.clicks)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${c.cpm < 0.2 ? "text-rose-300" : "text-emerald-300"}`}>{money(c.cpm)}</td>
                    <td className="py-1.5 text-right text-white/90 tabular-nums">{money(c.revenue)}</td>
                  </tr>
                ))}
                {!countries.length && <tr><td colSpan={5} className="py-3 text-white/40">No geo data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`${card} p-4`}>
          <h4 className="text-[12px] font-bold text-white mb-3 flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 text-fuchsia-300" /> Impressions by site
          </h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={domainRows} dataKey="impression" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={3} stroke="none">
                  {domainRows.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AdsterraAnalytics;
