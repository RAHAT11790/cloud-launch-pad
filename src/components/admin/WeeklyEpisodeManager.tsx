import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { db, ref, onValue, set, remove, update } from "@/lib/firebase";
import { toast } from "sonner";
import {
  Calendar, Search, Save, Trash2, Edit, X, Check, AlertTriangle,
  CalendarDays, Film, ChevronRight, Sparkles, Power,
} from "lucide-react";
import CachedImg, { preloadCachedImages } from "@/components/CachedImg";

const DAYS = [
  "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "AllDay",
] as const;
type Day = typeof DAYS[number];

const SHORT: Record<Day, string> = {
  Saturday: "Sat", Sunday: "Sun", Monday: "Mon", Tuesday: "Tue",
  Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", AllDay: "All Day",
};

const LONG_LABEL: Record<Day, string> = {
  Saturday: "Saturday", Sunday: "Sunday", Monday: "Monday", Tuesday: "Tuesday",
  Wednesday: "Wednesday", Thursday: "Thursday", Friday: "Friday",
  AllDay: "All Day (every day)",
};

const DAY_GRADIENT: Record<Day, string> = {
  Saturday: "from-rose-500 to-pink-600",
  Sunday: "from-amber-500 to-orange-600",
  Monday: "from-sky-500 to-blue-600",
  Tuesday: "from-emerald-500 to-teal-600",
  Wednesday: "from-violet-500 to-purple-600",
  Thursday: "from-fuchsia-500 to-pink-600",
  Friday: "from-indigo-500 to-cyan-600",
  AllDay: "from-yellow-400 via-orange-500 to-red-500",
};

function todayName(): Day {
  return DAYS.find(d => d === (new Date().toLocaleDateString("en-US", { weekday: "long" }) as Day)) || "Saturday";
}

interface Schedule {
  seriesId: string;
  title: string;
  poster?: string;
  day: Day;
  expectedEpisodes?: number;
  endedAt?: number;
  updatedAt: number;
}

interface Props {
  webseriesData: any[];
  glassCard: string;
  inputClass: string;
  selectClass: string;
  btnPrimary: string;
  btnSecondary: string;
  onEditSeries: (id: string) => void;
}

// Module-level cache — see AnimeCard.tsx `watchlistCacheByUser` for the same
// pattern. Prevents the empty-grid flash + "loading details" spinner every
// time the admin user re-opens the Weekly Episode tab.
let weeklySchedulesCache: Record<string, Schedule> = {};

export default function WeeklyEpisodeManager({
  webseriesData, glassCard, inputClass, selectClass, btnPrimary, btnSecondary, onEditSeries,
}: Props) {
  const [schedules, setSchedules] = useState<Record<string, Schedule>>(() => weeklySchedulesCache);
  const [activeDay, setActiveDay] = useState<Day>(todayName());
  const WEEKLY_LIST_PAGE = 15;
  const [visibleLimit, setVisibleLimit] = useState(WEEKLY_LIST_PAGE);
  // Reset pagination whenever the day tab changes so users always see the
  // freshest 15 without scrolling through stale extra rows.
  useEffect(() => { setVisibleLimit(WEEKLY_LIST_PAGE); }, [activeDay]);

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const deferredPickerSearch = useDeferredValue(pickerSearch);
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [selectedDay, setSelectedDay] = useState<Day>(todayName());

  // End-of-season prompt
  const [endPrompt, setEndPrompt] = useState<{ seriesId: string; title: string; totalAvailable: number; expected?: number } | null>(null);

  // Inline edit day
  const [editingId, setEditingId] = useState<string>("");
  const [editingDay, setEditingDay] = useState<Day>("Saturday");

  useEffect(() => {
    const unsub = onValue(ref(db, "weeklySchedule"), snap => {
      const next = snap.val() || {};
      weeklySchedulesCache = next;
      startTransition(() => setSchedules(next));
    });
    return () => unsub();
  }, []);


  const seriesById = useMemo(() => {
    const map: Record<string, any> = {};
    webseriesData.forEach(s => { map[s.id] = s; });
    return map;
  }, [webseriesData]);

  const countEpisodes = (s: any) => {
    if (!s) return 0;
    const fromIndex = Number(s?.episodeCount);
    if (Number.isFinite(fromIndex) && fromIndex > 0) return fromIndex;
    const values = (v: any) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);
    const sumSeasons = (seasons: any) => values(seasons).reduce((n: number, se: any) => n + values(se?.episodes).length, 0);
    const direct = sumSeasons(s?.seasons);
    if (direct > 0) return direct;
    const custom = sumSeasons(s?.customSeasons);
    if (custom > 0) return custom;
    if (s?.seasonsByLanguage && typeof s.seasonsByLanguage === "object") {
      const lang = Math.max(0, ...Object.values(s.seasonsByLanguage).map(sumSeasons));
      if (lang > 0) return lang;
    }
    const declared = Number(s?.totalEpisodes || s?.numberOfEpisodes || 0);
    return Number.isFinite(declared) && declared > 0 ? declared : 0;
  };


  const scheduledIds = useMemo(() => Object.keys(schedules), [schedules]);
  const availableSeries = useMemo(() => {
    const q = deferredPickerSearch.trim().toLowerCase();
    return webseriesData
      .filter(s => !scheduledIds.includes(s.id))
      .filter(s => !q || s.title?.toLowerCase().includes(q))
      .slice(0, 80);
  }, [webseriesData, scheduledIds, deferredPickerSearch]);

  const dayCounts = useMemo(() => {
    const counts: Record<Day, number> = {
      Saturday: 0, Sunday: 0, Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, AllDay: 0,
    };
    Object.values(schedules).forEach(s => { if (counts[s.day] !== undefined) counts[s.day]++; });
    return counts;
  }, [schedules]);

  // "All Day" anime are visible on EVERY day's tab as well as their own tab.
  const visibleList = useMemo(() => {
    return Object.values(schedules)
      .filter(s => {
        if (activeDay === "AllDay") return s.day === "AllDay";
        return s.day === activeDay || s.day === "AllDay";
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 120);
  }, [schedules, activeDay]);

  useEffect(() => {
    const posters = visibleList.map((item) => item.poster || seriesById[item.seriesId]?.poster).filter(Boolean);
    if (posters.length) void preloadCachedImages(posters, 80);
  }, [visibleList, seriesById]);

  async function saveSchedule(seriesId: string, day: Day, opts?: { silent?: boolean }) {
    const s = seriesById[seriesId];
    if (!s) { toast.error("Series not found"); return; }
    const total = countEpisodes(s);
    const entry: Record<string, any> = {
      seriesId,
      title: s.title || "Untitled",
      poster: s.poster || "",
      day,
      updatedAt: Date.now(),
    };
    const exp = s.totalEpisodes || s.numberOfEpisodes;
    if (exp) entry.expectedEpisodes = exp;
    await set(ref(db, `weeklySchedule/${seriesId}`), entry);
    if (!opts?.silent) toast.success(`Scheduled on ${day}`);
    return total;
  }

  async function handlePickerSave() {
    if (!selectedSeriesId) { toast.error("Select a series"); return; }
    const s = seriesById[selectedSeriesId];
    const total = countEpisodes(s);
    const expected = s?.totalEpisodes || s?.numberOfEpisodes;
    if (expected && total >= expected) {
      setEndPrompt({ seriesId: selectedSeriesId, title: s?.title || "Series", totalAvailable: total, expected });
      return;
    }
    await saveSchedule(selectedSeriesId, selectedDay);
    setActiveDay(selectedDay);
    setSelectedSeriesId("");
    setPickerSearch("");
    setPickerOpen(false);
  }

  async function removeSchedule(id: string) {
    if (!confirm("Remove this anime from the weekly schedule?")) return;
    await remove(ref(db, `weeklySchedule/${id}`));
    toast.success("Removed from schedule");
  }

  async function changeDay(id: string, day: Day) {
    await update(ref(db, `weeklySchedule/${id}`), { day, updatedAt: Date.now() });
    setEditingId("");
    toast.success(`Moved to ${day}`);
  }

  async function endSeason(id: string, title: string) {
    if (!confirm(`End weekly tracking for "${title}"?`)) return;
    await remove(ref(db, `weeklySchedule/${id}`));
    toast.success("Season ended — removed from schedule");
  }

  return (
    <div className="space-y-4">
      {/* Picker Card */}
      <div className={`${glassCard} p-4 relative overflow-hidden`}>
        <div className="absolute -top-12 -right-12 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          <div className="flex items-center gap-2 mb-3.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Select your weekly episode</h3>
              <p className="text-[11px] text-zinc-400">Pick an anime and the day it releases.</p>
            </div>
          </div>

          {!pickerOpen ? (
            <button
              onClick={() => { setPickerOpen(true); setSelectedDay(activeDay); }}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold rounded-xl py-3.5 flex items-center justify-center gap-2 transition-all shadow-md shadow-indigo-500/20"
            >
              <Calendar size={16} /> Schedule a new anime
            </button>
          ) : (
            <div className="space-y-3">
              {/* Series selector */}
              <div>
                <label className="text-[11px] text-zinc-400 mb-1.5 block font-medium">Anime Series</label>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    value={pickerSearch}
                    onChange={e => { setPickerSearch(e.target.value); setSelectedSeriesId(""); }}
                    className={`${inputClass} pl-9`}
                    placeholder="Search series..."
                  />
                </div>
                {pickerSearch.trim() && !selectedSeriesId && (
                  <div className="mt-2 max-h-[200px] overflow-y-auto bg-[#0F0F1C] border border-white/8 rounded-lg">
                    {availableSeries.length === 0 ? (
                      <p className="text-[11px] text-zinc-500 text-center py-4">No matching series</p>
                    ) : availableSeries.slice(0, 12).map(s => (
                      <button
                        key={s.id}
                        onClick={() => { setSelectedSeriesId(s.id); setPickerSearch(s.title); }}
                        className="w-full flex items-center gap-2.5 p-2 hover:bg-white/5 transition-colors text-left"
                      >
                        <CachedImg src={s.poster || ""} className="w-8 h-11 rounded object-cover bg-[#1E1E32]" loading="lazy" decoding="async"
                          onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/32x44/141422/6366f1?text=N"; }} />
                        <span className="text-[12px] text-white truncate flex-1">{s.title}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedSeriesId && (
                  <div className="mt-2 flex items-center gap-2 bg-indigo-600/15 border border-indigo-500/30 rounded-lg p-2">
                    <CachedImg src={seriesById[selectedSeriesId]?.poster || ""} className="w-8 h-11 rounded object-cover" loading="lazy" decoding="async"
                      onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/32x44/141422/6366f1?text=N"; }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold truncate">{seriesById[selectedSeriesId]?.title}</p>
                      <p className="text-[10px] text-zinc-400">{countEpisodes(seriesById[selectedSeriesId])} episodes uploaded</p>
                    </div>
                    <button onClick={() => { setSelectedSeriesId(""); setPickerSearch(""); }}
                      className="text-zinc-400 hover:text-white"><X size={14} /></button>
                  </div>
                )}
              </div>

              {/* Day selector */}
              <div>
                <label className="text-[11px] text-zinc-400 mb-1.5 block font-medium">Release Day</label>
                <select value={selectedDay} onChange={e => setSelectedDay(e.target.value as Day)} className={selectClass}>
                  {DAYS.map(d => <option key={d} value={d}>{LONG_LABEL[d]}</option>)}
                </select>
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => { setPickerOpen(false); setSelectedSeriesId(""); setPickerSearch(""); }}
                  className={`${btnSecondary} flex-1 py-3 text-[12px] font-medium`}>
                  Cancel
                </button>
                <button onClick={handlePickerSave}
                  className={`${btnPrimary} flex-1 py-3 text-[12px] font-semibold flex items-center justify-center gap-1.5`}>
                  <Save size={13} /> Save Schedule
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Day Pills */}
      <div className={`${glassCard} p-3`}>
        <div className="flex items-center gap-2 mb-2.5 px-1">
          <CalendarDays size={13} className="text-indigo-400" />
          <h3 className="text-[12px] font-semibold text-white">Days of the week</h3>
          <span className="text-[10px] text-zinc-500 ml-auto">Today: {LONG_LABEL[todayName()]}</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
          {DAYS.map(d => {
            const isActive = d === activeDay;
            const isToday = d === todayName();
            return (
              <button
                key={d}
                onClick={() => setActiveDay(d)}
                className={`relative flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all min-w-[58px] ${
                  isActive
                    ? `bg-gradient-to-br ${DAY_GRADIENT[d]} text-white shadow-md`
                    : "bg-[#141422] border border-white/8 text-zinc-400 hover:text-white"
                }`}
              >
                {isToday && !isActive && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full ring-2 ring-[#16162A]" />
                )}
                <div>{SHORT[d]}</div>
                {dayCounts[d] > 0 && (
                  <div className={`text-[9px] mt-0.5 ${isActive ? "text-white/80" : "text-indigo-400"}`}>
                    {dayCounts[d]}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* List for active day */}
      <div className={`${glassCard} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${DAY_GRADIENT[activeDay]} flex items-center justify-center`}>
              <Film size={14} className="text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold">{LONG_LABEL[activeDay]}</h3>
              <p className="text-[10.5px] text-zinc-500">{visibleList.length} anime scheduled</p>
            </div>
          </div>
        </div>

        {visibleList.length === 0 ? (
          <div className="text-center py-10 text-zinc-500">
            <Calendar size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-[12px]">No anime scheduled for {LONG_LABEL[activeDay]}</p>
            <p className="text-[10.5px] mt-1 text-zinc-600">Use the picker above to add one.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {visibleList.slice(0, visibleLimit).map(item => {
              const live = seriesById[item.seriesId];
              const totalAvailable = live ? countEpisodes(live) : 0;
              const expected = item.expectedEpisodes || live?.totalEpisodes || live?.numberOfEpisodes;
              const isComplete = expected && totalAvailable >= expected;
              const isEditing = editingId === item.seriesId;
              if (!live) {
                return (
                  <div key={item.seriesId} className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-center gap-2">
                    <AlertTriangle size={14} className="text-rose-400" />
                    <span className="text-[12px] text-rose-300 flex-1">"{item.title}" no longer exists.</span>
                    <button onClick={() => removeSchedule(item.seriesId)} className="text-[11px] text-rose-300 underline">Remove</button>
                  </div>
                );
              }
              return (
                <div key={item.seriesId}
                  className="bg-[#141422] border border-white/8 rounded-xl p-3 hover:border-indigo-500/40 transition-all">
                  <div className="flex gap-3">
                    <div className="relative flex-shrink-0">
                      <CachedImg src={item.poster || live.poster || ""} className="w-16 h-[88px] rounded-lg object-cover" loading="lazy" decoding="async"
                        onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/64x88/141422/6366f1?text=N"; }} />
                      {isComplete && (
                        <div className="absolute -top-1 -right-1 bg-emerald-500 rounded-full p-0.5">
                          <Check size={10} className="text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[13px] font-semibold truncate">{live.title}</h4>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-gradient-to-r ${DAY_GRADIENT[item.day]} text-white`}>
                          {LONG_LABEL[item.day]}
                        </span>
                        <span className="text-[10px] text-zinc-400">
                          {totalAvailable}{expected ? `/${expected}` : ""} eps
                        </span>
                        {isComplete && (
                          <span className="text-[9px] text-emerald-400 font-semibold">COMPLETE</span>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="flex gap-1.5 mt-2">
                          <select value={editingDay} onChange={e => setEditingDay(e.target.value as Day)}
                            className={`${selectClass} flex-1 py-1.5 text-[11px]`}>
                            {DAYS.map(d => <option key={d} value={d}>{LONG_LABEL[d]}</option>)}
                          </select>
                          <button onClick={() => changeDay(item.seriesId, editingDay)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 rounded-lg">
                            <Check size={13} />
                          </button>
                          <button onClick={() => setEditingId("")}
                            className="bg-zinc-700 hover:bg-zinc-600 text-white px-2.5 rounded-lg">
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <button onClick={() => onEditSeries(item.seriesId)}
                            className="bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 px-2.5 py-1.5 rounded-lg text-[10.5px] font-semibold flex items-center gap-1">
                            <ChevronRight size={11} /> Open
                          </button>
                          <button onClick={() => { setEditingId(item.seriesId); setEditingDay(item.day); }}
                            className="bg-amber-500/15 border border-amber-500/30 text-amber-300 px-2.5 py-1.5 rounded-lg text-[10.5px] font-semibold flex items-center gap-1">
                            <Edit size={11} /> Day
                          </button>
                          {isComplete && (
                            <button onClick={() => endSeason(item.seriesId, live.title)}
                              className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-2.5 py-1.5 rounded-lg text-[10.5px] font-semibold flex items-center gap-1">
                              <Power size={11} /> End
                            </button>
                          )}
                          <button onClick={() => removeSchedule(item.seriesId)}
                            className="bg-rose-500/15 border border-rose-500/30 text-rose-300 px-2.5 py-1.5 rounded-lg text-[10.5px] font-semibold flex items-center gap-1">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {visibleList.length > visibleLimit && (
              <div className="pt-2 flex flex-col items-center gap-1.5">
                <button
                  onClick={() => setVisibleLimit(v => v + WEEKLY_LIST_PAGE)}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-[12px] font-semibold shadow-lg shadow-purple-500/20 transition-all active:scale-95"
                >
                  Load More ({visibleList.length - visibleLimit} left)
                </button>
                <span className="text-[10px] text-zinc-500">Showing {visibleLimit} of {visibleList.length}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* End of season prompt */}
      {endPrompt && (
        <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setEndPrompt(null)}>
          <div onClick={e => e.stopPropagation()}
            className="bg-[#16162A] border border-white/10 rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mb-3 mx-auto">
              <AlertTriangle size={20} className="text-white" />
            </div>
            <h3 className="text-base font-bold text-center mb-1">Season Complete</h3>
            <p className="text-[12px] text-zinc-400 text-center mb-4">
              "{endPrompt.title}" already has {endPrompt.totalAvailable}
              {endPrompt.expected ? ` of ${endPrompt.expected}` : ""} episodes uploaded.
              Do you want to continue weekly tracking, or end the season?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setEndPrompt(null)}
                className={`${btnSecondary} flex-1 py-2.5 text-[12px] font-semibold`}>
                End Season
              </button>
              <button onClick={async () => {
                await saveSchedule(endPrompt.seriesId, selectedDay);
                setActiveDay(selectedDay);
                setSelectedSeriesId("");
                setPickerSearch("");
                setPickerOpen(false);
                setEndPrompt(null);
              }}
                className={`${btnPrimary} flex-1 py-2.5 text-[12px] font-semibold`}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
