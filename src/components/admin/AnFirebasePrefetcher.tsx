import { useEffect, useMemo, useRef, useState } from "react";
import { db, ref, set, get, onValue } from "@/lib/firebase";
import { useSelectedAnimeSalt } from "@/hooks/useSelectedAnimeSalt";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";
import { toast } from "sonner";
import { Database, Hammer, Zap, Square, Trash2 } from "lucide-react";

interface Props {
  glassCard: string;
  btnPrimary: string;
  btnSecondary: string;
}

type LogLine = { ts: number; level: "ok" | "warn" | "err" | "info"; msg: string };

const EP_CONCURRENCY = 4;
const SERIES_THROTTLE_MS = 250;

async function resolveBase(): Promise<string> {
  const url = await getEdgeFunctionUrl("an-api");
  return String(url || "").replace(/\/+$/, "");
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<any | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const AnFirebasePrefetcher = ({ glassCard, btnPrimary, btnSecondary }: Props) => {
  const { items: saltItems, loading: saltLoading } = useSelectedAnimeSalt();
  const [singleSlug, setSingleSlug] = useState("");
  const [running, setRunning] = useState<null | "all" | "single" | "repair">(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [stats, setStats] = useState({ series: 0, episodes: 0, ok: 0, fail: 0, total: 0 });
  const [storedCount, setStoredCount] = useState(0);
  const stopRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Watch stored count
  useEffect(() => {
    const u = onValue(ref(db, "anSeries"), (snap) => {
      const v = snap.val() || {};
      setStoredCount(Object.keys(v).length);
    });
    return () => u();
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const log = (msg: string, level: LogLine["level"] = "info") =>
    setLogs((prev) => [...prev.slice(-300), { ts: Date.now(), level, msg }]);

  const persistEpisode = async (seriesSlug: string, epSlug: string, payload: any, broken: boolean) => {
    try {
      await set(ref(db, `anSeries/${seriesSlug}/episodes/${epSlug}`), {
        slug: epSlug,
        directUrl: payload?.directUrl || "",
        links: Array.isArray(payload?.links) ? payload.links : [],
        sources: Array.isArray(payload?.sources) ? payload.sources : [],
        defaultAudioIdx: payload?.defaultAudioIdx ?? 0,
        preferredAudio: payload?.preferredAudio || "",
        broken,
        updatedAt: Date.now(),
      });
    } catch (e) {
      log(`Firebase write failed for ${epSlug}: ${(e as Error).message}`, "err");
    }
  };

  const prefetchSeries = async (base: string, slug: string, type: "series" | "movies" = "series") => {
    if (stopRef.current) return;
    log(`→ ${slug}`, "info");
    const detail = await fetchJson(`${base}/anime?slug=${encodeURIComponent(slug)}&type=${type}`);
    if (!detail) {
      log(`  detail fetch failed`, "err");
      setStats((s) => ({ ...s, fail: s.fail + 1 }));
      return;
    }

    try {
      await set(ref(db, `anSeries/${slug}/meta`), {
        title: detail.title || slug,
        poster: detail.poster || "",
        type,
        storyline: detail.storyline || "",
        updatedAt: Date.now(),
      });
    } catch {}

    const episodes: { slug: string; number: number }[] = [];
    for (const season of detail.seasons || []) {
      for (const ep of season.episodes || []) {
        if (ep?.slug) episodes.push({ slug: ep.slug, number: ep.number });
      }
    }
    setStats((s) => ({ ...s, series: s.series + 1, total: s.total + episodes.length }));

    // Concurrency pool
    let i = 0;
    const workers = Array.from({ length: EP_CONCURRENCY }, async () => {
      while (!stopRef.current) {
        const idx = i++;
        if (idx >= episodes.length) return;
        const ep = episodes[idx];
        const payload = await fetchJson(`${base}/episode?slug=${encodeURIComponent(ep.slug)}`, 20000);
        const hasPlayable = !!(payload && (payload.directUrl || (Array.isArray(payload.links) && payload.links.length)));
        await persistEpisode(slug, ep.slug, payload || {}, !hasPlayable);
        setStats((s) => ({
          ...s,
          episodes: s.episodes + 1,
          ok: s.ok + (hasPlayable ? 1 : 0),
          fail: s.fail + (hasPlayable ? 0 : 1),
        }));
      }
    });
    await Promise.all(workers);
    log(`  ✓ ${episodes.length} episodes processed`, "ok");
  };

  const runAll = async () => {
    if (!saltItems.length) {
      toast.error("AN catalog not loaded yet");
      return;
    }
    stopRef.current = false;
    setRunning("all");
    setStats({ series: 0, episodes: 0, ok: 0, fail: 0, total: 0 });
    setLogs([]);
    const base = await resolveBase();
    if (!base) {
      toast.error("AN API URL not configured");
      setRunning(null);
      return;
    }
    log(`Starting full prefetch — ${saltItems.length} series`, "info");
    for (const item of saltItems) {
      if (stopRef.current) break;
      const type = item.type === "movie" ? "movies" : "series";
      await prefetchSeries(base, item.slug as string, type);
      await new Promise((r) => setTimeout(r, SERIES_THROTTLE_MS));
    }
    log(`Done. Series: ${stats.series}, Episodes: ${stats.episodes}`, "ok");
    toast.success("AN prefetch complete");
    setRunning(null);
  };

  const runSingle = async () => {
    const slug = singleSlug.trim();
    if (!slug) {
      toast.error("Enter a series slug (e.g. naruto)");
      return;
    }
    stopRef.current = false;
    setRunning("single");
    setStats({ series: 0, episodes: 0, ok: 0, fail: 0, total: 0 });
    setLogs([]);
    const base = await resolveBase();
    if (!base) {
      toast.error("AN API URL not configured");
      setRunning(null);
      return;
    }
    await prefetchSeries(base, slug, "series");
    toast.success(`Prefetched: ${slug}`);
    setRunning(null);
  };

  const runRepair = async () => {
    stopRef.current = false;
    setRunning("repair");
    setStats({ series: 0, episodes: 0, ok: 0, fail: 0, total: 0 });
    setLogs([]);
    const base = await resolveBase();
    if (!base) {
      toast.error("AN API URL not configured");
      setRunning(null);
      return;
    }
    log("Scanning Firebase for broken episodes…", "info");
    const snap = await get(ref(db, "anSeries"));
    const all = snap.val() || {};
    const broken: { series: string; ep: string }[] = [];
    for (const seriesSlug of Object.keys(all)) {
      const eps = all[seriesSlug]?.episodes || {};
      for (const epSlug of Object.keys(eps)) {
        if (eps[epSlug]?.broken) broken.push({ series: seriesSlug, ep: epSlug });
      }
    }
    log(`Found ${broken.length} broken episodes`, "warn");
    setStats((s) => ({ ...s, total: broken.length }));
    let i = 0;
    const workers = Array.from({ length: EP_CONCURRENCY }, async () => {
      while (!stopRef.current) {
        const idx = i++;
        if (idx >= broken.length) return;
        const { series, ep } = broken[idx];
        const payload = await fetchJson(`${base}/episode?slug=${encodeURIComponent(ep)}`, 20000);
        const ok = !!(payload && (payload.directUrl || (Array.isArray(payload.links) && payload.links.length)));
        await persistEpisode(series, ep, payload || {}, !ok);
        setStats((s) => ({
          ...s,
          episodes: s.episodes + 1,
          ok: s.ok + (ok ? 1 : 0),
          fail: s.fail + (ok ? 0 : 1),
        }));
        log(`  ${ok ? "✓" : "✗"} ${ep}`, ok ? "ok" : "err");
      }
    });
    await Promise.all(workers);
    toast.success(`Repair done — ${stats.ok} fixed`);
    setRunning(null);
  };

  const stop = () => {
    stopRef.current = true;
    log("Stop requested…", "warn");
  };

  const clearAll = async () => {
    if (!confirm("Delete ALL prefetched anSeries data from Firebase? This cannot be undone.")) return;
    await set(ref(db, "anSeries"), null);
    toast.success("Cleared anSeries cache");
  };

  const progressPct = stats.total > 0 ? Math.round((stats.episodes / stats.total) * 100) : 0;

  return (
    <div className={`${glassCard} p-4 sm:p-5 rounded-2xl mt-4`}>
      <div className="flex items-center gap-2 mb-3">
        <Database className="w-5 h-5 text-emerald-400" />
        <h3 className="text-base sm:text-lg font-semibold">AN → Firebase Prefetcher</h3>
        <span className="ml-auto text-xs opacity-70">{storedCount} series stored</span>
      </div>
      <p className="text-xs opacity-70 mb-4 leading-relaxed">
        Extract every AN episode's playback URLs once and store them permanently at <code>anSeries/{`{slug}`}/episodes/{`{epSlug}`}</code>.
        After this, episode switching is instant (Firebase-direct, no AN API hit). Broken links self-mark on playback failure and can be repaired below.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <button
          onClick={runAll}
          disabled={!!running || saltLoading}
          className={`${btnPrimary} flex items-center justify-center gap-2 disabled:opacity-50`}
        >
          <Zap className="w-4 h-4" /> Prefetch All ({saltItems.length})
        </button>
        <div className="flex gap-2">
          <input
            value={singleSlug}
            onChange={(e) => setSingleSlug(e.target.value)}
            placeholder="series slug e.g. naruto"
            className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm"
            disabled={!!running}
          />
          <button
            onClick={runSingle}
            disabled={!!running}
            className={`${btnSecondary} flex items-center gap-1 disabled:opacity-50`}
          >
            <Zap className="w-4 h-4" /> Go
          </button>
        </div>
        <button
          onClick={runRepair}
          disabled={!!running}
          className={`${btnSecondary} flex items-center justify-center gap-2 disabled:opacity-50`}
        >
          <Hammer className="w-4 h-4" /> Repair Broken
        </button>
      </div>

      <div className="flex gap-2 mb-3">
        {running && (
          <button onClick={stop} className={`${btnSecondary} flex items-center gap-2 text-red-300`}>
            <Square className="w-4 h-4" /> Stop
          </button>
        )}
        <button onClick={clearAll} disabled={!!running} className={`${btnSecondary} flex items-center gap-2 text-red-300 disabled:opacity-50`}>
          <Trash2 className="w-4 h-4" /> Clear All
        </button>
      </div>

      {(running || stats.episodes > 0) && (
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1 opacity-80">
            <span>Series: {stats.series} · Episodes: {stats.episodes}/{stats.total}</span>
            <span>OK: {stats.ok} · Fail: {stats.fail}</span>
          </div>
          <div className="h-2 bg-white/10 rounded overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      <div
        ref={logRef}
        className="h-48 overflow-y-auto bg-black/40 rounded-lg p-3 font-mono text-xs leading-relaxed border border-white/5"
      >
        {logs.length === 0 ? (
          <div className="opacity-50">Logs will appear here…</div>
        ) : (
          logs.map((l, i) => (
            <div
              key={i}
              className={
                l.level === "err" ? "text-red-400" :
                l.level === "warn" ? "text-yellow-300" :
                l.level === "ok" ? "text-emerald-300" :
                "text-white/80"
              }
            >
              {l.msg}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AnFirebasePrefetcher;
