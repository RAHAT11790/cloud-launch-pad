import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  Send,
  Globe,
  Server as ServerIcon,
  ShieldCheck,
  Zap,
  Loader2,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { db, ref, onValue, update } from "@/lib/firebase";
import {
  DEFAULT_DOWNLOAD_MANAGER_CONFIG,
  DownloadDayStat,
  DownloadManagerConfig,
  DownloadServerMode,
  buildDirectDownloadLink,
  downloadStatsDayKey,
  parseDownloadStats,
  serverModeKey,
  sumDownloadStats,
} from "@/lib/downloadManagerSettings";

type Props = {
  glassCard?: string;
};

type VideoServer = { name?: string; domain?: string; proxy?: string };

const DownloadManagerPanel = ({ glassCard = "" }: Props) => {
  const [config, setConfig] = useState<DownloadManagerConfig>(DEFAULT_DOWNLOAD_MANAGER_CONFIG);
  const [servers, setServers] = useState<VideoServer[]>([]);
  const [stats, setStats] = useState<DownloadDayStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubConfig = onValue(ref(db, "settings/downloadManager"), (snap) => {
      const raw = snap.val() || {};
      const modesRaw = raw?.serverModes && typeof raw.serverModes === "object" ? raw.serverModes : {};
      const serverModes: Record<string, DownloadServerMode> = {};
      Object.keys(modesRaw).forEach((k) => {
        serverModes[k] = String(modesRaw[k]).toLowerCase() === "https" ? "https" : "http";
      });
      setConfig({
        telegramEnabled: raw?.telegramEnabled !== false,
        websiteEnabled: raw?.websiteEnabled !== false,
        serverModes,
        activeServerKey: String(raw?.activeServerKey || ""),
        activeServerDomain: String(raw?.activeServerDomain || ""),
      });
      setLoading(false);
    });
    const unsubServers = onValue(ref(db, "settings/videoServers"), (snap) => {
      const val = snap.val();
      const list: VideoServer[] = Array.isArray(val)
        ? val.filter((s: any) => s && s.domain)
        : val && typeof val === "object"
          ? (Object.values(val) as VideoServer[]).filter((s: any) => s && s.domain)
          : [];
      setServers(list);
    });
    const unsubStats = onValue(ref(db, "stats/downloads"), (snap) => {
      setStats(parseDownloadStats(snap.val()));
    });
    return () => {
      try { unsubConfig(); } catch {}
      try { unsubServers(); } catch {}
      try { unsubStats(); } catch {}
    };
  }, []);

  const patch = async (changes: Record<string, any>) => {
    setSaving(true);
    try {
      await update(ref(db, "settings/downloadManager"), changes);
    } catch {
      toast.error("Could not save the setting");
    } finally {
      setSaving(false);
    }
  };

  const toggleSource = (key: "telegramEnabled" | "websiteEnabled") => {
    const next = !config[key];
    setConfig((prev) => ({ ...prev, [key]: next }));
    patch({ [key]: next });
  };

  const setServerMode = (domain: string, mode: DownloadServerMode) => {
    const key = serverModeKey(domain);
    if (!key) return;
    setConfig((prev) => ({ ...prev, serverModes: { ...prev.serverModes, [key]: mode } }));
    patch({ [`serverModes/${key}`]: mode });
  };

  const selectActiveServer = (domain: string) => {
    const trimmed = String(domain || "").trim();
    const key = trimmed ? serverModeKey(trimmed) : "";
    setConfig((prev) => ({ ...prev, activeServerKey: key, activeServerDomain: trimmed }));
    patch({ activeServerKey: key, activeServerDomain: trimmed });
    toast.success(trimmed ? "Download server selected" : "Using each video's own source server");
  };

  const today = useMemo(() => {
    const key = downloadStatsDayKey();
    return stats.find((s) => s.day === key) || { day: key, telegram: 0, website: 0, total: 0 };
  }, [stats]);
  const week = useMemo(() => sumDownloadStats(stats, 7), [stats]);
  const month = useMemo(() => sumDownloadStats(stats, 30), [stats]);
  const last14 = useMemo(() => stats.slice(-14), [stats]);
  const peak = useMemo(() => Math.max(1, ...last14.map((s) => s.total)), [last14]);

  const bothOff = !config.telegramEnabled && !config.websiteEnabled;

  const card = `${glassCard || "rounded-2xl border border-white/10 bg-[#16162A]"} p-4`;
  const label = "block text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5";

  const SourceCard = ({
    active,
    icon,
    title,
    note,
    onToggle,
    activeClass,
  }: { active: boolean; icon: React.ReactNode; title: string; note: string; onToggle: () => void; activeClass: string }) => (
    <div className={`rounded-xl border p-3.5 transition-colors ${active ? activeClass : "border-white/10 bg-black/20"}`}>
      <div className="flex items-start gap-3">
        <div className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center ${active ? "bg-white/10 text-white" : "bg-white/[0.04] text-zinc-500"}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold text-white leading-tight">{title}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{note}</p>
        </div>
        <button
          onClick={onToggle}
          disabled={loading}
          aria-label={`${title} toggle`}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${active ? "bg-emerald-500" : "bg-zinc-700"} disabled:opacity-50`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${active ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
      <p className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide ${active ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-500/15 text-zinc-400"}`}>
        {active ? "SHOWN TO USERS" : "HIDDEN"}
      </p>
    </div>
  );

  const StatTile = ({ title, value, sub }: { title: string; value: number; sub: string }) => (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{title}</p>
      <p className="mt-1.5 text-2xl font-extrabold leading-none text-white tabular-nums">{value}</p>
      <p className="mt-1.5 text-[10.5px] text-zinc-500">{sub}</p>
    </div>
  );

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Sources */}
      <div className={card}>
        <div className="mb-4 flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center">
            <Download size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold text-white leading-tight">Download Manager</h3>
            <p className="mt-1 text-[11px] text-zinc-400">Control which download buttons users see inside the player.</p>
          </div>
          {saving && <Loader2 size={15} className="animate-spin text-zinc-400 shrink-0" />}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SourceCard
            active={config.telegramEnabled}
            activeClass="border-sky-500/40 bg-sky-500/[0.07]"
            icon={<Send size={18} />}
            title="Telegram Download"
            note="Delivered by the Telegram bot deep link."
            onToggle={() => toggleSource("telegramEnabled")}
          />
          <SourceCard
            active={config.websiteEnabled}
            activeClass="border-emerald-500/40 bg-emerald-500/[0.07]"
            icon={<Globe size={18} />}
            title="Website Download"
            note="Browser download with quality and size details."
            onToggle={() => toggleSource("websiteEnabled")}
          />
        </div>

        {bothOff && (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[11.5px] font-semibold text-amber-300">
            Both sources are off — users will see “Download not available”.
          </p>
        )}
      </div>

      {/* Server modes */}
      <div className={card}>
        <div className="mb-4 flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center">
            <ServerIcon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold text-white leading-tight">Download server</h3>
            <p className="mt-1 text-[11px] text-zinc-400">
              Pick the one server every download is served from. The list comes from Video Servers.
            </p>
          </div>
        </div>

        <div className="mb-3 grid gap-2 sm:grid-cols-2 text-[10.5px] leading-relaxed text-zinc-400">
          <p className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <span className="font-bold text-white">HTTP</span> — proxy path + file renaming (current system).
          </p>
          <p className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <span className="font-bold text-white">HTTPS</span> — direct link, no proxy, no renaming.
          </p>
        </div>

        <div className="mb-3 rounded-xl border border-white/10 bg-black/25 px-3.5 py-3">
          <p className={label}>Selected download server</p>
          {config.activeServerDomain ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-[11.5px] font-semibold text-emerald-300">{config.activeServerDomain}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                (config.serverModes[config.activeServerKey] === "https") ? "bg-emerald-500/15 text-emerald-300" : "bg-sky-500/15 text-sky-300"
              }`}>
                {config.serverModes[config.activeServerKey] === "https" ? "https · direct" : "http · proxy"}
              </span>
            </div>
          ) : (
            <p className="text-[11.5px] text-zinc-400">
              None selected — every video downloads from its own source link.
            </p>
          )}
          <button
            onClick={() => selectActiveServer("")}
            disabled={!config.activeServerDomain}
            className="mt-2.5 h-8 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[11px] font-bold text-zinc-300 hover:text-white disabled:opacity-40"
          >
            Use source server
          </button>
        </div>

        {servers.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-black/20 px-3.5 py-6 text-center text-[12px] text-zinc-500">
            No video servers found. Add them in Video Servers first.
          </p>
        ) : (
          <div className="space-y-2">
            {servers.map((server, idx) => {
              const domain = String(server?.domain || "");
              const key = serverModeKey(domain);
              const mode: DownloadServerMode = config.serverModes[key] === "https" ? "https" : "http";
              const directOk = Boolean(buildDirectDownloadLink(`${domain.replace(/\/+$/, "")}/watch/sample.mp4`));
              const isActive = !!config.activeServerDomain && key === config.activeServerKey;
              return (
                <div
                  key={`${key}-${idx}`}
                  className={`rounded-xl border p-3 transition-colors ${isActive ? "border-emerald-500/45 bg-emerald-500/[0.07]" : "border-white/10 bg-black/25"}`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => selectActiveServer(domain)}
                      aria-label={`Select ${server?.name || domain} as download server`}
                      className={`h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                        isActive ? "border-emerald-400 bg-emerald-400" : "border-zinc-600 hover:border-zinc-400"
                      }`}
                    >
                      {isActive && <span className="h-2 w-2 rounded-full bg-[#101024]" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-bold text-white">{server?.name || domain}</p>
                        <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] font-bold text-zinc-400">#{idx + 1}</span>
                        {isActive && (
                          <span className="shrink-0 rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-300">ACTIVE</span>
                        )}
                      </div>
                      <p className="truncate font-mono text-[10.5px] text-zinc-500">{domain}</p>
                    </div>
                    <div className="inline-flex shrink-0 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
                      {(["http", "https"] as DownloadServerMode[]).map((option) => (
                        <button
                          key={option}
                          onClick={() => setServerMode(domain, option)}
                          className={`h-8 px-3 rounded-[7px] text-[11px] font-bold uppercase tracking-wide transition-colors ${
                            mode === option ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-zinc-400">
                    {mode === "https" ? <Zap size={12} className="text-emerald-400" /> : <ShieldCheck size={12} className="text-sky-400" />}
                    {mode === "https"
                      ? directOk
                        ? "Direct download, /watch removed from the link"
                        : "This domain is not https — direct mode will fall back to the proxy"
                      : "Proxy download with renamed files"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Statistics */}
      <div className={card}>
        <div className="mb-4 flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
            <BarChart3 size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold text-white leading-tight">Download statistics</h3>
            <p className="mt-1 text-[11px] text-zinc-400">File counts only — no titles are tracked.</p>
          </div>
          <RefreshCw size={14} className="shrink-0 text-zinc-500" />
        </div>

        <div className="grid gap-2.5 sm:grid-cols-3">
          <StatTile title="Today" value={today.total} sub={`${today.website} website · ${today.telegram} telegram`} />
          <StatTile title="Last 7 days" value={week.total} sub={`${week.website} website · ${week.telegram} telegram`} />
          <StatTile title="Last 30 days" value={month.total} sub={`${month.website} website · ${month.telegram} telegram`} />
        </div>

        <p className={`${label} mt-5`}>Daily files (last 14 days)</p>
        {last14.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-black/20 px-3.5 py-6 text-center text-[12px] text-zinc-500">
            No downloads recorded yet.
          </p>
        ) : (
          <div className="space-y-2">
            {last14.slice().reverse().map((entry) => (
              <div key={entry.day} className="flex items-center gap-3">
                <span className="w-[74px] shrink-0 font-mono text-[10.5px] text-zinc-500">{entry.day.slice(5)}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400"
                    style={{ width: `${Math.round((entry.total / peak) * 100)}%` }}
                  />
                </span>
                <span className="w-9 shrink-0 text-right text-[11px] font-bold tabular-nums text-white">{entry.total}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DownloadManagerPanel;
