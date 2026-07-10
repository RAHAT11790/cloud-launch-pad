import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  LayoutDashboard, ListChecks, Users as UsersIcon, Share2, Plus, Edit3, Trash2,
  Coins, ExternalLink, Search, Ban, ShieldCheck, TrendingUp, Send, Link as LinkIcon,
  Megaphone, Sparkles, X, Save, Power, PowerOff, RefreshCw, Award, Filter,
} from "lucide-react";
import { db, ref, get, onValue, remove, runTransaction, update } from "@/lib/firebase";
import {
  CustomTask, CustomTaskKind, subscribeCustomTasks, saveCustomTask, deleteCustomTask,
} from "@/lib/customTasks";
import {
  DAILY_TASKS, TaskDef, subscribeDailyTaskOverrides, setDailyTaskReward,
  setDailyTaskTitle, setDailyTaskEnabled, DailyTaskOverrides,
} from "@/lib/dailyTasks";
import {
  subscribePremiumSettings, savePremiumSettings, DEFAULT_PREMIUM_SETTINGS,
  type CoinPlan, type PremiumGlobalSettings,
} from "@/lib/premiumAccess";


interface Props {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
}

type Tab = "overview" | "tasks" | "pricing" | "users" | "referrals";

interface UserRow {
  id: string;
  name?: string;
  email?: string;
  coins: number;
  banned?: boolean;
  createdAt?: number;
  referralCount?: number;
  referralEarnings?: number;
}

const KIND_META: Record<CustomTaskKind, { label: string; icon: any; color: string }> = {
  link_visit:     { label: "Visit Website",     icon: LinkIcon,  color: "bg-blue-500/15 text-blue-300 border-blue-400/30" },
  telegram_join:  { label: "Join Telegram",     icon: Send,      color: "bg-sky-500/15 text-sky-300 border-sky-400/30" },
  promotion:      { label: "Paid Promotion",    icon: Megaphone, color: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-400/30" },
  custom:         { label: "Custom Task",       icon: Sparkles,  color: "bg-amber-500/15 text-amber-300 border-amber-400/30" },
};

const emptyDraft = (): Omit<CustomTask, "id" | "createdAt" | "updatedAt"> => ({
  kind: "link_visit",
  title: "",
  description: "",
  url: "",
  reward: 1,
  icon: "🎯",
  color: "",
  active: true,
  order: 100,
  dailyReset: false,
  minSeconds: 10,
});

// ---------------------------------------------------------------------------
// Module-level cache: keeps the last-known snapshot of tasks / users / refCounts
// alive across tab switches in the admin panel. Re-mount paints INSTANTLY from
// the cache and shows no loading spinner; Firebase listeners still update live
// in the background and refresh the cache for the next re-mount.
// ---------------------------------------------------------------------------
let dailyTasksCache: CustomTask[] = [];
let dailyUsersCache: UserRow[] = [];
let dailyRefCountsCache: Record<string, { count: number; earnings: number }> = {};

export default function DailyTaskManager({ glassCard, inputClass, btnPrimary, btnSecondary }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [tasks, setTasks] = useState<CustomTask[]>(() => dailyTasksCache);
  const [users, setUsers] = useState<UserRow[]>(() => dailyUsersCache);
  const [refCounts, setRefCounts] = useState<Record<string, { count: number; earnings: number }>>(() => dailyRefCountsCache);
  const [loading, setLoading] = useState(dailyUsersCache.length === 0);

  /* live tasks */
  useEffect(() => subscribeCustomTasks((next) => {
    dailyTasksCache = next;
    setTasks(next);
  }), []);

  /* live users */
  useEffect(() => {
    const un = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      const rows: UserRow[] = Object.entries(data).map(([id, u]: [string, any]) => ({
        id,
        name: u?.name || u?.displayName || "",
        email: u?.email || "",
        coins: Number(u?.coinWallet?.coins || 0),
        banned: !!u?.banned,
        createdAt: Number(u?.createdAt || 0),
        referralEarnings: (Object.values(u?.referralEarnings || {}) as any[]).reduce(
          (s: number, r: any) => s + Number(r?.amount || 0), 0,
        ) as number,
      }));
      dailyUsersCache = rows;
      setUsers(rows);
      setLoading(false);
    });
    return () => un();
  }, []);

  /* live referral counts */
  useEffect(() => {
    const un = onValue(ref(db, "referrals"), (snap) => {
      const data = snap.val() || {};
      const map: Record<string, { count: number; earnings: number }> = {};
      Object.entries(data).forEach(([refUid, v]: [string, any]) => {
        const visitors = v?.visitors ? Object.keys(v.visitors).length : 0;
        map[refUid] = { count: visitors, earnings: 0 };
      });
      dailyRefCountsCache = map;
      setRefCounts(map);
    });
    return () => un();
  }, []);


  const totalCoins = useMemo(() => users.reduce((s, u) => s + u.coins, 0), [users]);
  const bannedCount = useMemo(() => users.filter((u) => u.banned).length, [users]);
  const totalReferrals = useMemo(
    () => Object.values(refCounts).reduce((s, r) => s + r.count, 0),
    [refCounts],
  );

  return (
    <div className="space-y-5">
      {/* HERO HEADER */}
      <div className="rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-500/15 via-orange-500/5 to-transparent p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/20">
            <Sparkles className="w-6 h-6 text-black" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl sm:text-2xl font-black text-amber-100 leading-tight drop-shadow">
              Daily Task Manager
            </h2>
            <p className="mt-1 text-[13px] text-white/80">
              Control tasks, coins, users, promotions, and referral analytics — one place.
            </p>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {([
          { id: "overview",  label: "Overview",  icon: LayoutDashboard },
          { id: "tasks",     label: "Tasks",     icon: ListChecks },
          { id: "pricing",   label: "Pricing",   icon: Coins },
          { id: "users",     label: "Users",     icon: UsersIcon },
          { id: "referrals", label: "Referrals", icon: Share2 },
        ] as { id: Tab; label: string; icon: any }[]).map((t) => {

          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                "inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-xl border transition-all whitespace-nowrap",
                active
                  ? "bg-gradient-to-br from-amber-400 to-yellow-500 text-black border-amber-300 shadow-lg shadow-amber-500/20"
                  : "bg-white/[0.03] text-white/70 border-white/10 hover:bg-white/[0.06]",
              ].join(" ")}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && (
        <OverviewTab
          glassCard={glassCard}
          totalUsers={users.length}
          bannedCount={bannedCount}
          totalCoins={totalCoins}
          totalTasks={tasks.length}
          activeTasks={tasks.filter((t) => t.active).length}
          totalReferrals={totalReferrals}
          topReferrers={Object.entries(refCounts)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
            .map(([uid, r]) => {
              const u = users.find((x) => x.id === uid);
              return { uid, name: u?.name || u?.email || uid.slice(0, 10), count: r.count, coins: u?.coins || 0 };
            })}
          topEarners={[...users].sort((a, b) => b.coins - a.coins).slice(0, 5)}
        />
      )}

      {tab === "tasks" && (
        <>
          <BuiltInTasksSection glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} />
          <TasksTab
            glassCard={glassCard}
            inputClass={inputClass}
            btnPrimary={btnPrimary}
            btnSecondary={btnSecondary}
            tasks={tasks}
          />
        </>
      )}

      {tab === "pricing" && (
        <PricingTab glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />
      )}

      {tab === "users" && (

        <UsersTab
          glassCard={glassCard}
          inputClass={inputClass}
          btnPrimary={btnPrimary}
          btnSecondary={btnSecondary}
          users={users}
          refCounts={refCounts}
          loading={loading}
        />
      )}

      {tab === "referrals" && (
        <ReferralsTab
          glassCard={glassCard}
          users={users}
          refCounts={refCounts}
        />
      )}
    </div>
  );
}

/* =====================================================================
   OVERVIEW TAB
   ===================================================================== */

function OverviewTab({
  glassCard, totalUsers, bannedCount, totalCoins, totalTasks, activeTasks, totalReferrals,
  topReferrers, topEarners,
}: {
  glassCard: string;
  totalUsers: number;
  bannedCount: number;
  totalCoins: number;
  totalTasks: number;
  activeTasks: number;
  totalReferrals: number;
  topReferrers: { uid: string; name: string; count: number; coins: number }[];
  topEarners: UserRow[];
}) {
  const stats = [
    { label: "Total Users",     value: totalUsers.toLocaleString(),    icon: UsersIcon,   color: "from-blue-500/20 to-cyan-500/10 text-blue-300 border-blue-400/30" },
    { label: "Coins in Economy",value: totalCoins.toLocaleString(),    icon: Coins,       color: "from-amber-500/20 to-yellow-500/10 text-amber-300 border-amber-400/30" },
    { label: "Active Tasks",    value: `${activeTasks}/${totalTasks}`, icon: ListChecks,  color: "from-emerald-500/20 to-green-500/10 text-emerald-300 border-emerald-400/30" },
    { label: "Total Referrals", value: totalReferrals.toLocaleString(),icon: Share2,      color: "from-fuchsia-500/20 to-pink-500/10 text-fuchsia-300 border-fuchsia-400/30" },
    { label: "Banned Users",    value: bannedCount.toLocaleString(),   icon: Ban,         color: "from-rose-500/20 to-red-500/10 text-rose-300 border-rose-400/30" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className={`rounded-2xl border p-4 bg-gradient-to-br ${s.color}`}>
              <Icon className="w-5 h-5 mb-2" />
              <div className="text-2xl font-black leading-none tabular-nums">{s.value}</div>
              <div className="mt-1 text-[10.5px] uppercase tracking-wider opacity-80">{s.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className={glassCard + " p-5"}>
          <div className="flex items-center gap-2 mb-3">
            <Award className="w-4 h-4 text-amber-300" />
            <h3 className="text-sm font-bold">Top Referrers</h3>
          </div>
          {topReferrers.length === 0 ? (
            <p className="text-xs text-white/40">No referrals yet.</p>
          ) : (
            <div className="space-y-2">
              {topReferrers.map((r, i) => (
                <div key={r.uid} className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.03] border border-white/5">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-300 flex items-center justify-center text-xs font-black">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{r.name}</div>
                    <div className="text-[10.5px] text-white/50 truncate">{r.uid}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black text-emerald-300 tabular-nums">{r.count}</div>
                    <div className="text-[10px] text-white/40">invites</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={glassCard + " p-5"}>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-emerald-300" />
            <h3 className="text-sm font-bold">Top Coin Holders</h3>
          </div>
          {topEarners.length === 0 ? (
            <p className="text-xs text-white/40">No users yet.</p>
          ) : (
            <div className="space-y-2">
              {topEarners.map((u, i) => (
                <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.03] border border-white/5">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-300 flex items-center justify-center text-xs font-black">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{u.name || u.email || u.id.slice(0, 10)}</div>
                    <div className="text-[10.5px] text-white/50 truncate">{u.email || u.id}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black text-amber-300 tabular-nums inline-flex items-center gap-1">
                      <Coins className="w-3 h-3" />{u.coins}
                    </div>
                    <div className="text-[10px] text-white/40">wallet</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   TASKS TAB
   ===================================================================== */

function TasksTab({
  glassCard, inputClass, btnPrimary, btnSecondary, tasks,
}: {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
  tasks: CustomTask[];
}) {
  const [editing, setEditing] = useState<CustomTask | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [filter, setFilter] = useState<CustomTaskKind | "all">("all");

  const filtered = filter === "all" ? tasks : tasks.filter((t) => t.kind === filter);

  const openNew = () => { setEditing(null); setShowEditor(true); };
  const openEdit = (t: CustomTask) => { setEditing(t); setShowEditor(true); };

  const doDelete = async (id: string) => {
    if (!confirm("Delete this task permanently?")) return;
    await deleteCustomTask(id);
    toast.success("Task deleted");
  };

  const toggleActive = async (t: CustomTask) => {
    await saveCustomTask({ ...t, active: !t.active });
    toast.success(t.active ? "Task disabled" : "Task enabled");
  };

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-black text-white">Custom Tasks</h3>
          <p className="text-[11.5px] text-white/60">Promotions, external links, community joins.</p>
        </div>
        <button onClick={openNew} className={btnPrimary + " inline-flex items-center gap-1.5 text-sm px-3.5 py-2 whitespace-nowrap"}>
          <Plus className="w-4 h-4" /> New Task
        </button>
      </div>

      {/* Filter chips row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Filter className="w-3.5 h-3.5 text-white/40 mr-0.5" />
        {(["all", "link_visit", "telegram_join", "promotion", "custom"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={[
              "px-3 py-1.5 rounded-lg border text-[12px] font-semibold transition-all whitespace-nowrap",
              filter === k
                ? "bg-amber-500/20 text-amber-200 border-amber-400/50"
                : "bg-white/[0.03] text-white/70 border-white/10 hover:bg-white/[0.06]",
            ].join(" ")}
          >
            {k === "all" ? "All" : KIND_META[k].label}
          </button>
        ))}
      </div>



      {/* Task list */}
      {filtered.length === 0 ? (
        <div className={glassCard + " p-8 text-center"}>
          <ListChecks className="w-8 h-8 text-white/30 mx-auto mb-2" />
          <p className="text-sm text-white/50">No tasks yet. Click "New Task" to add one.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((t) => {
            const meta = KIND_META[t.kind];
            const Icon = meta.icon;
            return (
              <div key={t.id} className={glassCard + " p-4"}>
                <div className="flex items-start gap-3">
                  <div className={"w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 border " + meta.color}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold flex items-center gap-2">
                          {t.icon && <span className="text-base">{t.icon}</span>}
                          {t.title || "(untitled)"}
                          {!t.active && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-white/5 text-white/50">off</span>}
                        </h3>
                        <p className="mt-0.5 text-[12px] text-white/60 line-clamp-2">{t.description}</p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300 flex-shrink-0">
                        <Coins className="w-3 h-3" /> +{t.reward}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-white/50">
                      <span className={"px-1.5 py-0.5 rounded border " + meta.color}>{meta.label}</span>
                      {t.dailyReset ? (
                        <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03]">Daily reset</span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03]">One-time</span>
                      )}
                      {t.minSeconds ? (
                        <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03]">Wait {t.minSeconds}s</span>
                      ) : null}
                      <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03]">Order {t.order}</span>
                      {t.url && (
                        <a href={t.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-blue-400/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 max-w-[220px] truncate">
                          <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                          <span className="truncate">{t.url}</span>
                        </a>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <button onClick={() => openEdit(t)} className={btnSecondary + " inline-flex items-center gap-1 text-[11px] px-2.5 py-1"}>
                        <Edit3 className="w-3 h-3" /> Edit
                      </button>
                      <button onClick={() => toggleActive(t)} className={btnSecondary + " inline-flex items-center gap-1 text-[11px] px-2.5 py-1"}>
                        {t.active ? <><PowerOff className="w-3 h-3" /> Disable</> : <><Power className="w-3 h-3" /> Enable</>}
                      </button>
                      <button onClick={() => doDelete(t.id)} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-rose-400/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 font-semibold">
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showEditor && (
        <TaskEditor
          glassCard={glassCard}
          inputClass={inputClass}
          btnPrimary={btnPrimary}
          btnSecondary={btnSecondary}
          initial={editing}
          onClose={() => setShowEditor(false)}
          onSaved={() => { setShowEditor(false); toast.success("Task saved"); }}
        />
      )}
    </div>
  );
}

function TaskEditor({
  glassCard, inputClass, btnPrimary, btnSecondary, initial, onClose, onSaved,
}: {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
  initial: CustomTask | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(() => initial ? { ...initial } : { ...emptyDraft(), id: undefined as any });
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    if (!draft.title.trim()) { toast.error("Title required"); return; }
    if (draft.reward < 0) { toast.error("Reward can't be negative"); return; }
    if ((draft.kind === "link_visit" || draft.kind === "telegram_join" || draft.kind === "promotion") && !draft.url?.trim()) {
      toast.error("URL required for this task type");
      return;
    }
    setSaving(true);
    try {
      await saveCustomTask({
        id: (draft as any).id,
        kind: draft.kind,
        title: draft.title.trim(),
        description: draft.description.trim(),
        url: draft.url?.trim() || "",
        reward: Number(draft.reward) || 0,
        icon: draft.icon?.trim() || "🎯",
        color: draft.color?.trim() || "",
        active: !!draft.active,
        order: Number(draft.order) || 100,
        dailyReset: !!draft.dailyReset,
        minSeconds: Number(draft.minSeconds) || 0,
      });
      onSaved();
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || "unknown"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className={glassCard + " w-full max-w-lg p-5 sm:p-6 max-h-[92vh] overflow-y-auto"}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black">{initial ? "Edit Task" : "New Task"}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">Task Type</span>
            <select value={draft.kind} onChange={(e) => setField("kind", e.target.value as CustomTaskKind)} className={inputClass + " mt-1 w-full"}>
              {(Object.entries(KIND_META) as [CustomTaskKind, typeof KIND_META[CustomTaskKind]][]).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">Title *</span>
            <input value={draft.title} onChange={(e) => setField("title", e.target.value)} placeholder="e.g. Join our Telegram Channel"
              className={inputClass + " mt-1 w-full"} />
          </label>

          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">Description</span>
            <textarea value={draft.description} onChange={(e) => setField("description", e.target.value)} rows={3}
              placeholder="Explain what the user needs to do…"
              className={inputClass + " mt-1 w-full resize-none"} />
          </label>

          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">
              {draft.kind === "promotion" ? "Promotion URL *" : "Task URL"}
            </span>
            <input value={draft.url || ""} onChange={(e) => setField("url", e.target.value)}
              placeholder="https://…"
              className={inputClass + " mt-1 w-full"} />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">Reward</span>
              <input type="number" min={0} value={draft.reward}
                onChange={(e) => setField("reward", Number(e.target.value))}
                className={inputClass + " mt-1 w-full"} />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">Wait (s)</span>
              <input type="number" min={0} value={draft.minSeconds}
                onChange={(e) => setField("minSeconds", Number(e.target.value))}
                className={inputClass + " mt-1 w-full"} />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">Order</span>
              <input type="number" value={draft.order}
                onChange={(e) => setField("order", Number(e.target.value))}
                className={inputClass + " mt-1 w-full"} />
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">Icon (emoji)</span>
            <input value={draft.icon || ""} onChange={(e) => setField("icon", e.target.value)} placeholder="🎯"
              className={inputClass + " mt-1 w-full"} />
          </label>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.03] border border-white/10 cursor-pointer">
              <input type="checkbox" checked={draft.active} onChange={(e) => setField("active", e.target.checked)} className="w-4 h-4" />
              <span className="text-[12px] font-semibold">Active (visible to users)</span>
            </label>
            <label className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.03] border border-white/10 cursor-pointer">
              <input type="checkbox" checked={draft.dailyReset} onChange={(e) => setField("dailyReset", e.target.checked)} className="w-4 h-4" />
              <span className="text-[12px] font-semibold">Daily reset (else one-time)</span>
            </label>
          </div>
        </div>

        <div className="mt-5 flex gap-2 justify-end">
          <button onClick={onClose} className={btnSecondary + " text-sm"}>Cancel</button>
          <button onClick={save} disabled={saving} className={btnPrimary + " inline-flex items-center gap-1.5 text-sm disabled:opacity-60"}>
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Task"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   USERS TAB
   ===================================================================== */

function UsersTab({
  glassCard, inputClass, btnPrimary, btnSecondary, users, refCounts, loading,
}: {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
  users: UserRow[];
  refCounts: Record<string, { count: number; earnings: number }>;
  loading: boolean;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"coins" | "recent" | "name">("coins");
  const [editUser, setEditUser] = useState<UserRow | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let arr = users;
    if (term) {
      arr = arr.filter((u) =>
        u.id.toLowerCase().includes(term) ||
        (u.name || "").toLowerCase().includes(term) ||
        (u.email || "").toLowerCase().includes(term),
      );
    }
    if (sort === "coins") arr = [...arr].sort((a, b) => b.coins - a.coins);
    else if (sort === "recent") arr = [...arr].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    else arr = [...arr].sort((a, b) => (a.name || a.email || a.id).localeCompare(b.name || b.email || b.id));
    return arr.slice(0, 200);
  }, [users, q, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, or UID…"
            className={inputClass + " w-full pl-9"} />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as any)} className={inputClass + " w-auto"}>
          <option value="coins">Most coins</option>
          <option value="recent">Newest</option>
          <option value="name">Name A→Z</option>
        </select>
      </div>

      {loading ? (
        <div className={glassCard + " p-8 text-center text-white/50 text-sm"}>Loading users…</div>
      ) : filtered.length === 0 ? (
        <div className={glassCard + " p-8 text-center text-white/50 text-sm"}>No users match.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => {
            const invites = refCounts[u.id]?.count || 0;
            return (
              <div key={u.id} className={glassCard + " p-3.5"}>
                <div className="flex items-center gap-3">
                  <div className={"w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 " + (u.banned ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300")}>
                    {u.banned ? <Ban className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold truncate">{u.name || u.email || u.id.slice(0, 12)}</span>
                      {u.banned && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">Banned</span>}
                    </div>
                    <div className="text-[10.5px] text-white/50 truncate">{u.email || u.id}</div>
                  </div>
                  <div className="text-right">
                    <div className="inline-flex items-center gap-1 text-sm font-black text-amber-300 tabular-nums">
                      <Coins className="w-3.5 h-3.5" />{u.coins}
                    </div>
                    <div className="text-[10px] text-white/40">{invites} invites</div>
                  </div>
                  <button onClick={() => setEditUser(u)} className={btnSecondary + " inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5"}>
                    <Edit3 className="w-3 h-3" /> Manage
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editUser && (
        <UserEditor
          glassCard={glassCard}
          inputClass={inputClass}
          btnPrimary={btnPrimary}
          btnSecondary={btnSecondary}
          user={editUser}
          onClose={() => setEditUser(null)}
        />
      )}
    </div>
  );
}

function UserEditor({
  glassCard, inputClass, btnPrimary, btnSecondary, user, onClose,
}: {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
  user: UserRow;
  onClose: () => void;
}) {
  const [delta, setDelta] = useState(0);
  const [setTo, setSetTo] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [coins, setCoins] = useState(user.coins);
  const [banned, setBanned] = useState(!!user.banned);

  useEffect(() => {
    return onValue(ref(db, `users/${user.id}/coinWallet`), (s) => {
      setCoins(Number(s.val()?.coins || 0));
    });
  }, [user.id]);

  const applyDelta = async () => {
    if (!delta) return;
    setBusy(true);
    try {
      await runTransaction(ref(db, `users/${user.id}/coinWallet`), (cur: any) => {
        const w = cur || { coins: 0, adWatchLog: {} };
        return { ...w, coins: Math.max(0, (w.coins || 0) + delta) };
      });
      toast.success(`${delta > 0 ? "Added" : "Removed"} ${Math.abs(delta)} coins`);
      setDelta(0);
    } catch (e: any) { toast.error("Failed: " + e?.message); }
    finally { setBusy(false); }
  };

  const applySet = async () => {
    if (setTo === "" || Number(setTo) < 0) return;
    setBusy(true);
    try {
      await runTransaction(ref(db, `users/${user.id}/coinWallet`), (cur: any) => {
        const w = cur || { coins: 0, adWatchLog: {} };
        return { ...w, coins: Number(setTo) };
      });
      toast.success(`Coins set to ${setTo}`);
      setSetTo("");
    } catch (e: any) { toast.error("Failed: " + e?.message); }
    finally { setBusy(false); }
  };

  const toggleBan = async () => {
    setBusy(true);
    try {
      const next = !banned;
      await update(ref(db, `users/${user.id}`), { banned: next, bannedAt: next ? Date.now() : null });
      setBanned(next);
      toast.success(next ? "User banned" : "User unbanned");
    } catch (e: any) { toast.error("Failed: " + e?.message); }
    finally { setBusy(false); }
  };

  const resetDailyTasks = async () => {
    if (!confirm("Reset today's daily task claims for this user?")) return;
    setBusy(true);
    try {
      const day = new Date();
      const key = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
      await remove(ref(db, `users/${user.id}/dailyTasks/${key}`));
      toast.success("Daily tasks reset");
    } catch (e: any) { toast.error("Failed: " + e?.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className={glassCard + " w-full max-w-lg p-5 sm:p-6 max-h-[92vh] overflow-y-auto"}>
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0">
            <h3 className="text-lg font-black truncate">{user.name || user.email || user.id.slice(0, 12)}</h3>
            <p className="text-[11px] text-white/50 truncate">{user.email || user.id}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5"><X className="w-4 h-4" /></button>
        </div>

        <div className="rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-500/15 to-transparent p-4 mb-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300/80">Current Balance</div>
          <div className="mt-1 text-3xl font-black text-amber-200 inline-flex items-center gap-1.5">
            <Coins className="w-6 h-6" /> {coins.toLocaleString()}
          </div>
        </div>

        <div className="space-y-3">
          <div className={glassCard + " p-3"}>
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/60 mb-2">Adjust (+/−)</div>
            <div className="flex gap-2">
              <input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))}
                placeholder="e.g. 50 or -20" className={inputClass + " flex-1"} />
              <button onClick={applyDelta} disabled={busy || !delta} className={btnPrimary + " text-sm"}>Apply</button>
            </div>
            <div className="mt-2 flex gap-1 flex-wrap">
              {[10, 50, 100, -10, -50].map((n) => (
                <button key={n} onClick={() => setDelta(n)}
                  className={"text-[11px] font-semibold px-2 py-1 rounded-lg border " + (n > 0 ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-rose-400/30 bg-rose-500/10 text-rose-300")}>
                  {n > 0 ? "+" : ""}{n}
                </button>
              ))}
            </div>
          </div>

          <div className={glassCard + " p-3"}>
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/60 mb-2">Set to exact value</div>
            <div className="flex gap-2">
              <input type="number" min={0} value={setTo} onChange={(e) => setSetTo(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="e.g. 500" className={inputClass + " flex-1"} />
              <button onClick={applySet} disabled={busy || setTo === ""} className={btnPrimary + " text-sm"}>Set</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={toggleBan} disabled={busy}
              className={"inline-flex items-center justify-center gap-1.5 text-sm font-bold px-3 py-2.5 rounded-xl border " + (banned
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-400/30 bg-rose-500/10 text-rose-300")}>
              {banned ? <><ShieldCheck className="w-4 h-4" /> Unban</> : <><Ban className="w-4 h-4" /> Ban User</>}
            </button>
            <button onClick={resetDailyTasks} disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 text-sm font-bold px-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08]">
              <RefreshCw className="w-4 h-4" /> Reset Daily
            </button>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className={btnSecondary + " text-sm"}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   REFERRALS TAB
   ===================================================================== */

function ReferralsTab({
  glassCard, users, refCounts,
}: {
  glassCard: string;
  users: UserRow[];
  refCounts: Record<string, { count: number; earnings: number }>;
}) {
  const rows = useMemo(() => {
    return Object.entries(refCounts)
      .map(([uid, r]) => {
        const u = users.find((x) => x.id === uid);
        return {
          uid,
          name: u?.name || u?.email || uid.slice(0, 12),
          email: u?.email || "",
          count: r.count,
          coins: u?.coins || 0,
          earnings: u?.referralEarnings || 0,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [users, refCounts]);

  const totalInvites = rows.reduce((s, r) => s + r.count, 0);
  const totalEarnings = rows.reduce((s, r) => s + r.earnings, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-fuchsia-400/25 bg-fuchsia-500/10 p-4">
          <div className="text-[10px] uppercase tracking-wider text-fuchsia-300/80 font-bold">Referrers</div>
          <div className="mt-1 text-2xl font-black text-fuchsia-200 tabular-nums">{rows.length}</div>
        </div>
        <div className="rounded-2xl border border-blue-400/25 bg-blue-500/10 p-4">
          <div className="text-[10px] uppercase tracking-wider text-blue-300/80 font-bold">Total Invites</div>
          <div className="mt-1 text-2xl font-black text-blue-200 tabular-nums">{totalInvites}</div>
        </div>
        <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
          <div className="text-[10px] uppercase tracking-wider text-amber-300/80 font-bold">Coins Earned</div>
          <div className="mt-1 text-2xl font-black text-amber-200 tabular-nums">{totalEarnings}</div>
        </div>
      </div>

      <div className={glassCard + " p-5"}>
        <h3 className="text-sm font-bold mb-3">All Referrers</h3>
        {rows.length === 0 ? (
          <p className="text-xs text-white/40">No referral activity yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wider text-white/50 border-b border-white/10">
                  <th className="text-left py-2 font-semibold">#</th>
                  <th className="text-left py-2 font-semibold">User</th>
                  <th className="text-right py-2 font-semibold">Invites</th>
                  <th className="text-right py-2 font-semibold">Earned</th>
                  <th className="text-right py-2 font-semibold">Wallet</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={r.uid} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-2 text-white/40 text-xs tabular-nums">{i + 1}</td>
                    <td className="py-2">
                      <div className="font-semibold text-[13px] truncate max-w-[180px]">{r.name}</div>
                      <div className="text-[10px] text-white/40 truncate max-w-[180px]">{r.email || r.uid}</div>
                    </td>
                    <td className="py-2 text-right font-black text-emerald-300 tabular-nums">{r.count}</td>
                    <td className="py-2 text-right font-black text-amber-300 tabular-nums">{r.earnings}</td>
                    <td className="py-2 text-right font-semibold text-white/70 tabular-nums">{r.coins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   BUILT-IN TASKS (the permanent 5) — admin can edit rewards
   ===================================================================== */

function BuiltInTasksSection({
  glassCard, inputClass, btnPrimary,
}: {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
}) {
  const [overrides, setOverrides] = useState<DailyTaskOverrides>({});
  const [rewardDrafts, setRewardDrafts] = useState<Record<string, number>>({});
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => subscribeDailyTaskOverrides(setOverrides), []);

  const rewardFor = (t: TaskDef) => {
    const o = overrides[t.id];
    return typeof o?.reward === "number" ? o.reward : t.reward;
  };
  const titleFor = (t: TaskDef) => {
    const o = overrides[t.id];
    return o?.title && o.title.length ? o.title : t.title;
  };
  const enabledFor = (t: TaskDef) => !overrides[t.id]?.disabled;

  const save = async (t: TaskDef) => {
    setBusy(t.id);
    try {
      const rDraft = rewardDrafts[t.id];
      const tDraft = titleDrafts[t.id];
      if (typeof rDraft === "number" && rDraft >= 0 && rDraft !== rewardFor(t)) {
        await setDailyTaskReward(t.id, rDraft);
      }
      if (typeof tDraft === "string" && tDraft.trim() && tDraft !== titleFor(t)) {
        await setDailyTaskTitle(t.id, tDraft.trim());
      }
      setRewardDrafts((d) => { const c = { ...d }; delete c[t.id]; return c; });
      setTitleDrafts((d) => { const c = { ...d }; delete c[t.id]; return c; });
      toast.success(`${titleFor(t)} saved`);
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || "unknown"));
    } finally { setBusy(null); }
  };

  const toggle = async (t: TaskDef) => {
    const next = !enabledFor(t);
    try {
      await setDailyTaskEnabled(t.id, next);
      toast.success(`${titleFor(t)} ${next ? "enabled" : "hidden from users"}`);
    } catch (e: any) {
      toast.error("Toggle failed: " + (e?.message || "unknown"));
    }
  };

  const activeCount = DAILY_TASKS.filter(enabledFor).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-black text-white">Built-in Daily Tasks</h3>
          <p className="text-[11.5px] text-white/60">Rename, re-price, or hide any of the built-in tasks.</p>
        </div>
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-400/30 whitespace-nowrap">
          {activeCount}/{DAILY_TASKS.length} live
        </span>
      </div>

      <div className="grid gap-2.5">
        {DAILY_TASKS.map((t) => {
          const enabled = enabledFor(t);
          const currentReward = rewardFor(t);
          const currentTitle = titleFor(t);
          const rDraft = rewardDrafts[t.id];
          const tDraft = titleDrafts[t.id];
          const dirty =
            (typeof rDraft === "number" && rDraft !== currentReward) ||
            (typeof tDraft === "string" && tDraft.trim() !== currentTitle);
          return (
            <div key={t.id} className={glassCard + " p-3.5 " + (enabled ? "" : "opacity-60")}>
              <div className="flex items-start gap-3">
                <div className={
                  "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg " +
                  (enabled
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30"
                    : "bg-white/[0.04] text-white/40 border border-white/10")
                }>
                  {enabled ? "✅" : "⏸️"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-white truncate">{currentTitle}</h4>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-1 rounded-lg bg-amber-500/15 text-amber-200 border border-amber-400/30 whitespace-nowrap">
                        <Coins className="w-3 h-3" /> +{currentReward}
                      </span>
                      <button
                        onClick={() => toggle(t)}
                        className={
                          "inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border whitespace-nowrap transition-colors " +
                          (enabled
                            ? "bg-emerald-500/10 text-emerald-300 border-emerald-400/30 hover:bg-emerald-500/20"
                            : "bg-white/5 text-white/60 border-white/15 hover:bg-white/10")
                        }
                      >
                        {enabled ? <Power className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />}
                        {enabled ? "Live" : "Hidden"}
                      </button>
                    </div>
                  </div>
                  <p className="mt-0.5 text-[12px] text-white/60 line-clamp-2">{t.description}</p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_120px_auto] items-center">
                    <input
                      placeholder="Title"
                      value={typeof tDraft === "string" ? tDraft : currentTitle}
                      onChange={(e) => setTitleDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                      className={inputClass + " text-sm"}
                    />
                    <div className="flex items-center gap-1.5">
                      <Coins className="w-3.5 h-3.5 text-amber-300" />
                      <input
                        type="number"
                        min={0}
                        value={typeof rDraft === "number" ? rDraft : currentReward}
                        onChange={(e) => setRewardDrafts((d) => ({ ...d, [t.id]: Number(e.target.value) }))}
                        className={inputClass + " w-full text-sm"}
                      />
                    </div>
                    <button
                      onClick={() => save(t)}
                      disabled={!dirty || busy === t.id}
                      className={btnPrimary + " inline-flex items-center justify-center gap-1 text-[12px] px-3 py-1.5 disabled:opacity-40"}
                    >
                      <Save className="w-3.5 h-3.5" /> {busy === t.id ? "Saving…" : "Save"}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10.5px] text-white/40">
                    Goal: {t.goal} {t.unit} · ID <code className="text-white/60">{t.id}</code>
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =====================================================================
   PRICING TAB — admin controls the coin → premium-days plans
   Reads/writes settings/premium/extraPlans
   ===================================================================== */

function PricingTab({
  glassCard, inputClass, btnPrimary, btnSecondary,
}: {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
}) {
  const [settings, setSettings] = useState<PremiumGlobalSettings>(DEFAULT_PREMIUM_SETTINGS);
  const [plans, setPlans] = useState<CoinPlan[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return subscribePremiumSettings((s) => {
      setSettings(s);
      if (!dirty) setPlans(Array.isArray(s.extraPlans) ? s.extraPlans : []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mutate = (fn: (list: CoinPlan[]) => CoinPlan[]) => {
    setPlans((prev) => fn(prev));
    setDirty(true);
  };

  const addPlan = () =>
    mutate((prev) => [
      ...prev,
      {
        id: `plan-${Date.now().toString(36)}`,
        name: `${(prev.length + 1) * 10} Days`,
        coins: 100,
        days: 10,
        featured: false,
      },
    ]);

  const updatePlan = (i: number, patch: Partial<CoinPlan>) =>
    mutate((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const removePlan = (i: number) => {
    if (!confirm("Remove this plan?")) return;
    mutate((prev) => prev.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    // Basic validation.
    for (const p of plans) {
      if (!p.name?.trim()) return toast.error("Every plan needs a name");
      if (!(p.coins > 0) || !(p.days > 0)) return toast.error(`"${p.name}" needs coins & days > 0`);
    }
    setSaving(true);
    try {
      await savePremiumSettings({ extraPlans: plans });
      setDirty(false);
      toast.success("Pricing plans saved");
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || "unknown"));
    } finally { setSaving(false); }
  };

  const resetToLive = () => {
    setPlans(Array.isArray(settings.extraPlans) ? settings.extraPlans : []);
    setDirty(false);
  };

  return (
    <div className="space-y-4">
      <div className={glassCard + " p-5"}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-black text-white flex items-center gap-2">
              <Coins className="w-4 h-4 text-amber-300" /> Coin → Premium Plans
            </h3>
            <p className="mt-1 text-[12px] text-white/60">
              Set how many coins buy how many days of Premium. Users see these on the redeem page.
              Leave empty to use the built-in default (100/200/300 → 10/20/30 days).
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                onClick={resetToLive}
                className={btnSecondary + " inline-flex items-center gap-1 text-[12px] px-3 py-1.5"}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Revert
              </button>
            )}
            <button
              onClick={save}
              disabled={!dirty || saving}
              className={btnPrimary + " inline-flex items-center gap-1 text-[12px] px-3 py-1.5 disabled:opacity-40"}
            >
              <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-2.5">
        {plans.length === 0 && (
          <div className={glassCard + " p-6 text-center"}>
            <Sparkles className="w-6 h-6 mx-auto text-amber-300 mb-2" />
            <p className="text-sm font-bold text-white">No custom plans yet</p>
            <p className="mt-1 text-[12px] text-white/60">
              The default 3-tier plan is showing to users. Add your own to override.
            </p>
          </div>
        )}
        {plans.map((p, i) => (
          <div key={p.id || i} className={glassCard + " p-3.5"}>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_100px_auto_auto] items-center">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/50 font-bold">Name</label>
                <input
                  className={inputClass + " text-sm mt-0.5"}
                  value={p.name}
                  onChange={(e) => updatePlan(i, { name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/50 font-bold">Coins</label>
                <input
                  type="number"
                  min={1}
                  className={inputClass + " text-sm mt-0.5"}
                  value={p.coins}
                  onChange={(e) => updatePlan(i, { coins: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/50 font-bold">Days</label>
                <input
                  type="number"
                  min={1}
                  className={inputClass + " text-sm mt-0.5"}
                  value={p.days}
                  onChange={(e) => updatePlan(i, { days: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-300 whitespace-nowrap select-none mt-4">
                <input
                  type="checkbox"
                  checked={!!p.featured}
                  onChange={(e) => updatePlan(i, { featured: e.target.checked })}
                  className="accent-amber-400"
                />
                Featured
              </label>
              <button
                onClick={() => removePlan(i)}
                className="mt-4 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-400/30 text-rose-300 hover:bg-rose-500/20"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addPlan}
        className={btnSecondary + " w-full inline-flex items-center justify-center gap-1.5 text-[12.5px] px-4 py-2.5"}
      >
        <Plus className="w-4 h-4" /> Add plan
      </button>
    </div>
  );
}

