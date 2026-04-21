import { useEffect, useState, useMemo } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import { Flame, Clock, Trash2, RefreshCw } from "lucide-react";
import { computeWeeklyStatus, disableWeeklyForSeries, markWeeklyEpisodeReleased, sweepExpiredWeekly, type WeeklyPendingEntry } from "@/lib/weeklyEpManager";
import { toast } from "sonner";

/**
 * Tab button that shows a red badge with the count of weekly entries that are
 * overdue (timer hit zero — admin needs to add a new episode).
 */
export function WeeklyEpTabButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  const [overdueCount, setOverdueCount] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const unsub = onValue(ref(db, "weeklyPending"), (snap) => {
      const data = snap.val() || {};
      const entries: WeeklyPendingEntry[] = Object.values(data);
      const overdue = entries.filter((e) => {
        const s = computeWeeklyStatus(e);
        return s.isOverdue && !s.isReleasedRecently;
      }).length;
      setOverdueCount(overdue);
    });
    return () => unsub();
  }, []);

  // Recompute every minute so the badge stays fresh
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <button
      onClick={onClick}
      data-tick={tick}
      className={`relative flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${active ? "bg-rose-600 text-white" : "bg-[#141422] border border-white/8 text-zinc-400"}`}
    >
      Weekly EP
      {overdueCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center animate-pulse shadow-[0_0_8px_rgba(220,38,38,0.8)]">
          {overdueCount}
        </span>
      )}
    </button>
  );
}

/**
 * Section that lists all series enabled for weekly tracking with countdown,
 * "Mark Released" (resets timer + 5min auto-clear) and "Stop tracking".
 */
export function WeeklyEpManager({ onEditSeries }: { onEditSeries: (id: string) => void }) {
  const [entries, setEntries] = useState<WeeklyPendingEntry[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const unsub = onValue(ref(db, "weeklyPending"), (snap) => {
      const data = snap.val() || {};
      const list: WeeklyPendingEntry[] = Object.values(data);
      list.sort((a, b) => a.nextReleaseAt - b.nextReleaseAt);
      setEntries(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    // Clean up expired entries every 30s
    const sweep = setInterval(() => { sweepExpiredWeekly().catch(() => {}); }, 30_000);
    sweepExpiredWeekly().catch(() => {});
    return () => { clearInterval(t); clearInterval(sweep); };
  }, []);

  const stats = useMemo(() => {
    let overdue = 0, upcoming = 0, recent = 0;
    entries.forEach((e) => {
      const s = computeWeeklyStatus(e);
      if (s.isReleasedRecently) recent++;
      else if (s.isOverdue) overdue++;
      else upcoming++;
    });
    return { overdue, upcoming, recent, _t: tick };
  }, [entries, tick]);

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl bg-rose-600/15 border border-rose-500/30 p-3">
          <p className="text-[10px] text-rose-300 uppercase font-semibold">Overdue</p>
          <p className="text-2xl font-bold text-rose-400">{stats.overdue}</p>
        </div>
        <div className="rounded-xl bg-indigo-600/15 border border-indigo-500/30 p-3">
          <p className="text-[10px] text-indigo-300 uppercase font-semibold">Upcoming</p>
          <p className="text-2xl font-bold text-indigo-400">{stats.upcoming}</p>
        </div>
        <div className="rounded-xl bg-emerald-600/15 border border-emerald-500/30 p-3">
          <p className="text-[10px] text-emerald-300 uppercase font-semibold">Released</p>
          <p className="text-2xl font-bold text-emerald-400">{stats.recent}</p>
        </div>
      </div>

      <p className="text-[11px] text-zinc-500 mb-3">
        💡 Edit a series and add a new episode → save → timer auto-resets and entry clears in 5 min.
      </p>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-white/8 bg-[#0d0d18] p-8 text-center">
          <Clock className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
          <p className="text-sm text-zinc-400">No series being tracked weekly.</p>
          <p className="text-[11px] text-zinc-500 mt-1">Enable "Weekly EP Tracking" on any series to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const s = computeWeeklyStatus(entry);
            const isHot = s.isOverdue && !s.isReleasedRecently;
            return (
              <div
                key={entry.seriesId}
                className={`flex gap-3 p-3 rounded-xl border ${isHot ? "border-rose-500/50 bg-rose-600/10 shadow-[0_0_16px_rgba(244,63,94,0.25)]" : s.isReleasedRecently ? "border-emerald-500/40 bg-emerald-600/10" : "border-white/8 bg-[#141422]"}`}
              >
                <img
                  src={entry.poster || "/placeholder.svg"}
                  alt={entry.seriesTitle}
                  className="w-[50px] h-[70px] rounded-lg object-cover flex-shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).src = "/placeholder.svg"; }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold text-white truncate">{entry.seriesTitle}</h4>
                    {isHot && <Flame className="w-4 h-4 text-rose-400 flex-shrink-0 animate-pulse" />}
                  </div>
                  <p className={`text-[11px] mt-0.5 font-medium ${isHot ? "text-rose-300" : s.isReleasedRecently ? "text-emerald-300" : "text-indigo-300"}`}>
                    {s.countdownLabel}
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Cycle: every {entry.weeklyEveryDays}d • Next: {new Date(entry.nextReleaseAt).toLocaleDateString()}</p>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    <button
                      onClick={() => onEditSeries(entry.seriesId)}
                      className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1"
                    >
                      Edit / Add EP
                    </button>
                    <button
                      onClick={async () => {
                        await markWeeklyEpisodeReleased(entry.seriesId);
                        toast.success("Marked as released — clears in 5 min");
                      }}
                      className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Mark Released
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Stop tracking ${entry.seriesTitle}?`)) return;
                        await disableWeeklyForSeries(entry.seriesId);
                        toast.info("Tracking stopped");
                      }}
                      className="px-2.5 py-1 rounded-md bg-zinc-700 hover:bg-zinc-600 text-white text-[11px] font-semibold flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Stop
                    </button>
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
