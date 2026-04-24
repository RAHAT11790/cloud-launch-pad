import { useEffect, useState, useMemo, useRef } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
import {
  Bell,
  Flame,
  CreditCard,
  Unlock,
  AlertTriangle,
  Eye,
  TrendingUp,
  X,
} from "lucide-react";
import { computeWeeklyStatus, shouldShowWeeklyEntry, type WeeklyPendingEntry } from "@/lib/weeklyEpManager";

type FeedItem = {
  id: string;
  kind: "weekly" | "subscription" | "unlock" | "error" | "system" | "stats" | "trending";
  title: string;
  desc: string;
  ts: number;
  priority: number;
};

const KIND_META: Record<FeedItem["kind"], { icon: any; color: string; bg: string }> = {
  weekly: { icon: Flame, color: "text-rose-300", bg: "bg-rose-500/15 border-rose-500/30" },
  subscription: { icon: CreditCard, color: "text-amber-300", bg: "bg-amber-500/15 border-amber-500/30" },
  unlock: { icon: Unlock, color: "text-emerald-300", bg: "bg-emerald-500/15 border-emerald-500/30" },
  error: { icon: AlertTriangle, color: "text-orange-300", bg: "bg-orange-500/15 border-orange-500/30" },
  system: { icon: Bell, color: "text-indigo-300", bg: "bg-indigo-500/15 border-indigo-500/30" },
  stats: { icon: Eye, color: "text-cyan-300", bg: "bg-cyan-500/15 border-cyan-500/30" },
  trending: { icon: TrendingUp, color: "text-fuchsia-300", bg: "bg-fuchsia-500/15 border-fuchsia-500/30" },
};

function isToday(ts: number) {
  const d = new Date(ts);
  const n = new Date();
  return (
    d.getDate() === n.getDate() &&
    d.getMonth() === n.getMonth() &&
    d.getFullYear() === n.getFullYear()
  );
}

export function AdminNotificationBell() {
  const [open, setOpen] = useState(false);
  const [weekly, setWeekly] = useState<WeeklyPendingEntry[]>([]);
  const [bkash, setBkash] = useState<any[]>([]);
  const [unlocks, setUnlocks] = useState<any[]>([]);
  const [freeAccess, setFreeAccess] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, any>>({});
  const [readMap, setReadMap] = useState<Record<string, boolean>>({});
  const [, tick] = useState(0);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    const u1 = onValue(ref(db, "weeklyPending"), (s) => setWeekly(Object.values(s.val() || {}).filter(shouldShowWeeklyEntry)));
    const u2 = onValue(ref(db, "bkashPayments"), (s) => {
      const v = s.val() || {};
      setBkash(Object.entries(v).map(([id, x]: [string, any]) => ({ id, ...x })));
    });
    const u3 = onValue(ref(db, "unlockRequests"), (s) => {
      const v = s.val() || {};
      setUnlocks(Object.entries(v).map(([id, x]: [string, any]) => ({ id, ...x })));
    });
    const u4 = onValue(ref(db, "freeAccessUsers"), (s) => {
      const v = s.val() || {};
      setFreeAccess(Object.entries(v).map(([id, x]: [string, any]) => ({ id, ...x })));
    });
    const u5 = onValue(ref(db, "analytics/views"), (s) => setAnalytics(s.val() || {}));
    const u6 = onValue(ref(db, "settings/adminAiNotifications/read"), (s) => setReadMap(s.val() || {}));
    return () => {
      clearInterval(t);
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
    };
  }, []);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const items: FeedItem[] = useMemo(() => {
    const arr: FeedItem[] = [];

    // Weekly pending
      weekly.forEach((e) => {
      const s = computeWeeklyStatus(e);
        if (s.isPending && !s.isReleasedRecently && !s.isStale) {
        arr.push({
          id: `w-${e.seriesId}`,
          kind: "weekly",
          title: `🔥 ${e.seriesTitle}`,
          desc: `Episode due now · ${s.countdownLabel}`,
          ts: e.nextReleaseAt,
          priority: 100,
        });
      }
    });

    // Pending bKash
    bkash
      .filter((p) => p.status === "pending")
      .forEach((p) => {
        arr.push({
          id: `b-${p.id}`,
          kind: "subscription",
          title: `💳 bKash payment — ${p.amount || "?"} BDT`,
          desc: `${p.senderNumber || p.phone || "Unknown"} · plan: ${p.plan || "?"}`,
          ts: p.createdAt || Date.now(),
          priority: 80,
        });
      });

    // Today's free-access count summary
    const todayFree = freeAccess.filter((u) => isToday(u.unlockedAt || u.claimedAt || 0));
    if (todayFree.length > 0) {
      arr.push({
        id: "stats-free-today",
        kind: "stats",
        title: `📊 Today's Free Access`,
        desc: `${todayFree.length} unlock${todayFree.length > 1 ? "s" : ""} so far today`,
        ts: Date.now(),
        priority: 60,
      });
    }

    // Top-clicked anime (from analytics/views)
    const sortedViews = Object.entries(analytics)
      .map(([id, v]: [string, any]) => ({ id, ...v }))
      .filter((v: any) => isToday(v.lastClickAt || 0))
      .sort((a: any, b: any) => (b.clicks || 0) - (a.clicks || 0))
      .slice(0, 3);
    sortedViews.forEach((v: any, idx: number) => {
      arr.push({
        id: `t-${v.id}`,
        kind: "trending",
        title: `${["🥇", "🥈", "🥉"][idx]} ${v.title || v.id}`,
        desc: `${v.clicks || 0} clicks today`,
        ts: v.lastClickAt || Date.now(),
        priority: 50 - idx,
      });
    });

    // Recent unlock requests
    unlocks.slice(-10).forEach((u) => {
      arr.push({
        id: `u-${u.id}`,
        kind: "unlock",
        title: `🔓 Unlock requested`,
        desc: `${u.email || u.uid || "user"} · ${u.service || "ad-link"}`,
        ts: u.createdAt || Date.now(),
        priority: 20,
      });
    });

    return arr
      .filter((item) => !readMap[item.id])
      .sort((a, b) => b.priority - a.priority || b.ts - a.ts)
      .slice(0, 30);
  }, [weekly, bkash, unlocks, freeAccess, analytics, readMap]);

  const markAllRead = async () => {
    if (items.length === 0) return;
    const payload = Object.fromEntries(items.map((item) => [item.id, true]));
    await update(ref(db, "settings/adminAiNotifications/read"), payload);
  };

  const urgentCount = items.filter((x) => x.priority >= 80).length;
  const totalCount = items.length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-10 h-10 rounded-full bg-[#141422] border border-white/10 hover:bg-[#1a1a2e] flex items-center justify-center transition-colors"
        aria-label="Notifications"
      >
        <Bell size={17} className="text-zinc-300" />
        {urgentCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.7)]">
            {urgentCount}
          </span>
        )}
        {urgentCount === 0 && totalCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center">
            {totalCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popRef}
          className="absolute right-0 top-12 w-[320px] max-h-[440px] z-50 bg-[#0d0d18] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        >
          <div className="px-3.5 py-2.5 border-b border-white/8 bg-gradient-to-r from-indigo-900/30 to-violet-900/30 flex items-center gap-2">
            <Bell size={14} className="text-indigo-300" />
            <h3 className="text-[13px] font-bold text-white flex-1">AI Notifications</h3>
            {items.length > 0 && (
              <button
                onClick={markAllRead}
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-zinc-300 hover:text-white"
              >
                Mark all read
              </button>
            )}
            {urgentCount > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                {urgentCount} urgent
              </span>
            )}
            <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white">
              <X size={14} />
            </button>
          </div>
          <div className="overflow-y-auto max-h-[380px] divide-y divide-white/5">
            {items.length === 0 ? (
              <div className="p-6 text-center">
                <Bell className="w-7 h-7 mx-auto text-zinc-600 mb-1.5" />
                <p className="text-[12px] text-zinc-400">All clear! 🎉</p>
              </div>
            ) : (
              items.map((it) => {
                const meta = KIND_META[it.kind];
                const Icon = meta.icon;
                return (
                  <div key={it.id} className="flex gap-2.5 px-3 py-2.5 hover:bg-white/[0.02]">
                    <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                      <Icon size={14} className={meta.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] text-white font-medium truncate">{it.title}</p>
                      <p className="text-[10.5px] text-zinc-400 truncate">{it.desc}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
