import { useEffect, useState, useMemo } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import { Flame, Clock, Trash2, Edit, Bell, CalendarDays } from "lucide-react";
import {
  computeWeeklyStatus,
  disableWeeklyForSeries,
  markWeeklyEpisodeReleased,
  shouldShowWeeklyEntry,
  sweepExpiredWeekly,
  type WeeklyPendingEntry,
} from "@/lib/weeklyEpManager";
import { toast } from "sonner";

/** Tab button — red badge = number of series whose timer has hit zero. */
export function WeeklyEpTabButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  const [pendingCount, setPendingCount] = useState(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = onValue(ref(db, "weeklyPending"), (snap) => {
      const data = snap.val() || {};
      const entries = (Object.values(data) as WeeklyPendingEntry[]).filter(shouldShowWeeklyEntry);
      const pending = entries.filter((e) => {
        const s = computeWeeklyStatus(e);
        return s.isPending && !s.isReleasedRecently && !s.isStale;
      }).length;
      setPendingCount(pending);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <button
      onClick={onClick}
      className={`relative flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
        active
          ? "bg-rose-600 text-white"
          : "bg-[#141422] border border-white/8 text-zinc-400"
      }`}
    >
      Weekly EP
      {pendingCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center animate-pulse shadow-[0_0_8px_rgba(220,38,38,0.8)]">
          {pendingCount}
        </span>
      )}
    </button>
  );
}

type SubTab = "all" | "pending";

/**
 * Admin Weekly EP manager — same row card design as the All Series list:
 * poster + title + meta + Edit / Release / Delete buttons.
 */
export function WeeklyEpManager({
  onEditSeries,
}: {
  onEditSeries: (id: string) => void;
}) {
  const [entries, setEntries] = useState<WeeklyPendingEntry[]>([]);
  const [tick, setTick] = useState(0);
  const [subTab, setSubTab] = useState<SubTab>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsub = onValue(ref(db, "weeklyPending"), (snap) => {
      const data = snap.val() || {};
      const list = (Object.values(data) as WeeklyPendingEntry[]).filter(shouldShowWeeklyEntry);
      list.sort((a, b) => a.nextReleaseAt - b.nextReleaseAt);
      setEntries(list);
    });
    return () => unsub();
  }, []);

  // Live tick + 5-min auto-clear sweep (only clears the released badge)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    const sweep = setInterval(() => {
      sweepExpiredWeekly().catch(() => {});
    }, 30_000);
    sweepExpiredWeekly().catch(() => {});
    return () => {
      clearInterval(t);
      clearInterval(sweep);
    };
  }, []);

  const stats = useMemo(() => {
    let pending = 0,
      ticking = 0,
      released = 0;
    entries.forEach((e) => {
      const s = computeWeeklyStatus(e);
      if (s.isReleasedRecently) released++;
      else if (s.isPending) pending++;
      else ticking++;
    });
    return { pending, ticking, released, _t: tick };
  }, [entries, tick]);

  const filtered = useMemo(() => {
    let list = entries;
    if (subTab === "pending") {
      list = list.filter((e) => {
        const s = computeWeeklyStatus(e);
        return s.isPending && !s.isReleasedRecently;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => e.seriesTitle?.toLowerCase().includes(q));
    }
    return list;
  }, [entries, subTab, search, tick]);

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-xl bg-rose-600/15 border border-rose-500/30 p-3">
          <p className="text-[10px] text-rose-300 uppercase font-semibold">
            Pending
          </p>
          <p className="text-2xl font-bold text-rose-400">{stats.pending}</p>
        </div>
        <div className="rounded-xl bg-indigo-600/15 border border-indigo-500/30 p-3">
          <p className="text-[10px] text-indigo-300 uppercase font-semibold">
            Ticking
          </p>
          <p className="text-2xl font-bold text-indigo-400">{stats.ticking}</p>
        </div>
        <div className="rounded-xl bg-emerald-600/15 border border-emerald-500/30 p-3">
          <p className="text-[10px] text-emerald-300 uppercase font-semibold">
            Released
          </p>
          <p className="text-2xl font-bold text-emerald-400">{stats.released}</p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-hide">
        <button
          onClick={() => setSubTab("all")}
          className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
            subTab === "all"
              ? "bg-indigo-600 text-white"
              : "bg-[#141422] border border-white/8 text-zinc-400"
          }`}
        >
          All Tracked
        </button>
        <button
          onClick={() => setSubTab("pending")}
          className={`relative flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
            subTab === "pending"
              ? "bg-rose-600 text-white"
              : "bg-[#141422] border border-white/8 text-zinc-400"
          }`}
        >
          <Bell size={12} className="inline mr-1" /> Pending Releases
          {stats.pending > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold animate-pulse">
              {stats.pending}
            </span>
          )}
        </button>
      </div>

      <p className="text-[11px] text-zinc-500 mb-3">
        💡 টাইমার শূন্যে গেলে এখানে লাল ব্যাজ আসবে → এডিট করে নতুন এপিসোড সেভ
        করো → ৫ মিনিট পর ব্যাজ মুছে যাবে, পরের সাইকেল চালু হবে।
      </p>

      {/* Search */}
      <div className="mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-[#1A1A2E] border border-white/8 text-[13px] text-white placeholder:text-zinc-500"
          placeholder="Search tracked series..."
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/8 bg-[#0d0d18] p-8 text-center">
          <Clock className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
          <p className="text-sm text-zinc-400">
            {subTab === "pending"
              ? "এখন কোনো pending release নেই 🎉"
              : "এখনো কোনো series weekly tracking এ নেই।"}
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">
            যেকোনো series এডিট করে "Weekly EP Tracking" চালু করো।
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => {
            const s = computeWeeklyStatus(entry);
            const isHot = s.isPending && !s.isReleasedRecently;
            const nextDate = new Date(entry.nextReleaseAt);
            return (
              <div
                key={entry.seriesId}
                className={`bg-[#1A1A2E] border rounded-[14px] p-3.5 transition-all ${
                  isHot
                    ? "border-rose-500/60 shadow-[0_0_20px_rgba(244,63,94,0.35)] animate-pulse"
                    : s.isReleasedRecently
                      ? "border-emerald-500/40"
                      : "border-white/5 hover:border-purple-500/30"
                }`}
              >
                <div className="flex gap-3.5">
                  <img
                    src={entry.poster || "/placeholder.svg"}
                    className="w-20 h-[115px] rounded-[10px] object-cover flex-shrink-0"
                    alt={entry.seriesTitle}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "/placeholder.svg";
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-semibold mb-1 truncate text-white">
                        {entry.seriesTitle}
                      </h4>
                      {isHot && (
                        <Flame className="w-4 h-4 text-rose-400 flex-shrink-0 animate-pulse" />
                      )}
                    </div>
                    <p
                      className={`text-[11px] font-semibold mb-1 ${
                        isHot
                          ? "text-rose-300"
                          : s.isReleasedRecently
                            ? "text-emerald-300"
                            : "text-indigo-300"
                      }`}
                    >
                      {s.countdownLabel}
                    </p>
                    <div className="flex items-center gap-3 text-[10px] text-[#957DAD] flex-wrap mb-2">
                      <span className="flex items-center gap-1">
                        <Clock size={10} /> Cycle: every {entry.weeklyEveryDays}d
                      </span>
                      <span>• Progress: {s.progressLabel}</span>
                      <span className="flex items-center gap-1">
                        <CalendarDays size={10} />
                        {nextDate.toLocaleDateString()}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-1">
                      <button
                        onClick={() => onEditSeries(entry.seriesId)}
                        className={`px-3.5 py-2 text-[11px] font-semibold flex items-center gap-1.5 rounded-xl border ${
                          isHot
                            ? "bg-rose-500/25 border-rose-500/50 text-rose-300"
                            : "bg-purple-500/20 border-purple-500/30 text-purple-300"
                        }`}
                      >
                        <Edit size={12} /> {isHot ? "Release Now" : "Edit / Add EP"}
                      </button>
                      <button
                        onClick={async () => {
                          await markWeeklyEpisodeReleased(entry.seriesId);
                          toast.success(
                            "✅ Marked as released — badge clears in 5 min",
                          );
                        }}
                        className="bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 px-3.5 py-2 rounded-xl text-[11px] font-semibold"
                      >
                        Mark Released
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`Stop tracking ${entry.seriesTitle}?`))
                            return;
                          await disableWeeklyForSeries(entry.seriesId);
                          toast.info("Tracking stopped");
                        }}
                        className="bg-red-500/20 border border-red-500/30 text-pink-500 px-3.5 py-2 rounded-xl text-[11px] font-semibold flex items-center gap-1.5"
                      >
                        <Trash2 size={12} /> Stop
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
