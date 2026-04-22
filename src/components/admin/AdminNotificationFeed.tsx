import { useEffect, useState, useMemo } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import { Bell, Flame, CreditCard, Unlock, AlertTriangle, Calendar } from "lucide-react";
import { computeWeeklyStatus, type WeeklyPendingEntry } from "@/lib/weeklyEpManager";

type FeedItem = {
  id: string;
  kind: "weekly" | "subscription" | "unlock" | "error" | "system";
  title: string;
  desc: string;
  ts: number;
  priority: number; // higher = more urgent
};

const KIND_META: Record<FeedItem["kind"], { icon: any; color: string; bg: string }> = {
  weekly: { icon: Flame, color: "text-rose-300", bg: "bg-rose-500/15 border-rose-500/30" },
  subscription: { icon: CreditCard, color: "text-amber-300", bg: "bg-amber-500/15 border-amber-500/30" },
  unlock: { icon: Unlock, color: "text-emerald-300", bg: "bg-emerald-500/15 border-emerald-500/30" },
  error: { icon: AlertTriangle, color: "text-orange-300", bg: "bg-orange-500/15 border-orange-500/30" },
  system: { icon: Bell, color: "text-indigo-300", bg: "bg-indigo-500/15 border-indigo-500/30" },
};

export function AdminNotificationFeed() {
  const [weekly, setWeekly] = useState<WeeklyPendingEntry[]>([]);
  const [bkash, setBkash] = useState<any[]>([]);
  const [unlocks, setUnlocks] = useState<any[]>([]);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    const u1 = onValue(ref(db, "weeklyPending"), (s) => setWeekly(Object.values(s.val() || {})));
    const u2 = onValue(ref(db, "bkashPayments"), (s) => {
      const v = s.val() || {};
      setBkash(Object.entries(v).map(([id, x]: [string, any]) => ({ id, ...x })));
    });
    const u3 = onValue(ref(db, "unlockRequests"), (s) => {
      const v = s.val() || {};
      setUnlocks(Object.entries(v).map(([id, x]: [string, any]) => ({ id, ...x })));
    });
    return () => {
      clearInterval(t);
      u1();
      u2();
      u3();
    };
  }, []);

  const items: FeedItem[] = useMemo(() => {
    const arr: FeedItem[] = [];

    weekly.forEach((e) => {
      const s = computeWeeklyStatus(e);
      if (s.isPending && !s.isReleasedRecently) {
        arr.push({
          id: `w-${e.seriesId}`,
          kind: "weekly",
          title: `🔥 ${e.seriesTitle} — Episode due now`,
          desc: `${s.countdownLabel} · cycle ${e.weeklyEveryDays}d`,
          ts: e.nextReleaseAt,
          priority: 100,
        });
      } else if (!s.isReleasedRecently) {
        arr.push({
          id: `w-${e.seriesId}`,
          kind: "weekly",
          title: `📅 ${e.seriesTitle}`,
          desc: s.countdownLabel,
          ts: e.nextReleaseAt,
          priority: 30,
        });
      }
    });

    bkash
      .filter((p) => p.status === "pending")
      .forEach((p) => {
        arr.push({
          id: `b-${p.id}`,
          kind: "subscription",
          title: `💳 New bKash payment — ${p.amount || "?"} BDT`,
          desc: `${p.senderNumber || p.phone || "Unknown"} · plan: ${p.plan || "?"}`,
          ts: p.createdAt || Date.now(),
          priority: 80,
        });
      });

    unlocks.slice(-20).forEach((u) => {
      arr.push({
        id: `u-${u.id}`,
        kind: "unlock",
        title: `🔓 Unlock requested`,
        desc: `${u.email || u.uid || "user"} · ${u.service || "ad-link"}`,
        ts: u.createdAt || Date.now(),
        priority: 20,
      });
    });

    return arr.sort((a, b) => b.priority - a.priority || b.ts - a.ts).slice(0, 30);
  }, [weekly, bkash, unlocks]);

  if (items.length === 0) {
    return (
      <div className="bg-[#141422] border border-white/8 rounded-2xl p-5 text-center mb-4">
        <Bell className="w-8 h-8 mx-auto text-zinc-600 mb-2" />
        <p className="text-[13px] text-zinc-400">All caught up! No pending alerts. 🎉</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0d0d18] border border-white/8 rounded-2xl overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-white/8 bg-gradient-to-r from-indigo-900/20 to-violet-900/20 flex items-center gap-2">
        <Bell size={15} className="text-indigo-300" />
        <h3 className="text-sm font-bold text-white flex-1">AI Notifications</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
          {items.filter((x) => x.priority >= 80).length} urgent
        </span>
      </div>
      <div className="max-h-[380px] overflow-y-auto divide-y divide-white/5">
        {items.map((it) => {
          const meta = KIND_META[it.kind];
          const Icon = meta.icon;
          return (
            <div key={it.id} className="flex gap-2.5 px-3 py-2.5 hover:bg-white/[0.02]">
              <div
                className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${meta.bg}`}
              >
                <Icon size={14} className={meta.color} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] text-white font-medium truncate">{it.title}</p>
                <p className="text-[10.5px] text-zinc-400 truncate">{it.desc}</p>
              </div>
              <span className="text-[9px] text-zinc-500 flex-shrink-0">
                {new Date(it.ts).toLocaleDateString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
