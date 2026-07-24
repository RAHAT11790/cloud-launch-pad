import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus, Database, Edit2, Trash2, Copy, Wifi, WifiOff, Upload, Download, Play, X, Check, Loader2,
  HardDrive, RefreshCw, Timer, Shield,
} from "lucide-react";
import {
  ALL_SECTIONS, DEFAULT_RTDB_RULES, MAIN_DB_LABEL,
  listExtraFirebases, saveExtraFirebase, deleteExtraFirebase, updateSections,
  pingExtra, pushSection, pushAllSelectedSections, pullSectionJson, uploadSectionJson,
  triggerJsonDownload, streamJsonDownload, getMainRemoteJsonDownloadUrl, getExtraRemoteJsonDownloadUrl, getExtraRemoteSectionDownloadUrl, triggerRemoteJsonDownload, disposeExtraFirebase,
  pullMainFullJson, pullExtraFullJson, uploadMainFullJson, uploadExtraFullJson,
  analyzeMainStorage, analyzeExtraStorage, setAutoMirror,
  type ExtraFirebaseConfig, type ProgressFn, type StorageStats,
} from "@/lib/firebaseMultiSync";

interface Props { glassCard: string; btnPrimary: string; btnSecondary: string; }

const blankCfg = (): ExtraFirebaseConfig => ({
  id: crypto.randomUUID(),
  displayName: "",
  apiKey: "",
  authDomain: "",
  projectId: "",
  databaseURL: "",
  mirrorURL: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  sections: [...ALL_SECTIONS],
  autoMirrorMinutes: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const inputCls =
  "w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-white/35 focus:outline-none focus:border-emerald-400/60";

// RTDB free-tier reference: 1GB stored, used to compute fill %.
const RTDB_FREE_LIMIT = 1024 * 1024 * 1024;

const FirebaseMultiManager = ({ glassCard, btnPrimary, btnSecondary }: Props) => {
  const [items, setItems] = useState<ExtraFirebaseConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ExtraFirebaseConfig | null>(null);
  const [pings, setPings] = useState<Record<string, { ok: boolean; ms: number; error?: string }>>({});
  const [progress, setProgress] = useState<Record<string, Parameters<ProgressFn>[0] | null>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rulesText, setRulesText] = useState(DEFAULT_RTDB_RULES);
  const [rulesOpen, setRulesOpen] = useState(false);

  // Storage stats keyed by id ("MAIN" for primary)
  const [stats, setStats] = useState<Record<string, StorageStats | null>>({});
  const [statsBusy, setStatsBusy] = useState<Record<string, boolean>>({});
  const [downloadBusy, setDownloadBusy] = useState<Record<string, { progress: number; label: string } | null>>({});

  const refresh = async () => {
    setLoading(true);
    try { setItems(await listExtraFirebases()); }
    catch (e: any) { toast.error("Load failed: " + (e?.message || e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  // Auto-ping each FB once on mount.
  useEffect(() => {
    items.forEach(async (cfg) => {
      const r = await pingExtra(cfg);
      setPings((p) => ({ ...p, [cfg.id]: r }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // Auto-mirror scheduler: per-extra interval push from MAIN.
  useEffect(() => {
    const timers: number[] = [];
    for (const cfg of items) {
      const mins = cfg.autoMirrorMinutes || 0;
      if (mins <= 0 || !cfg.sections.length) continue;
      const id = window.setInterval(() => {
        if (busyId) return; // skip if another sync running
        pushAllSelectedSections(cfg, cfg.sections).catch(() => {});
      }, mins * 60 * 1000);
      timers.push(id);
    }
    return () => { timers.forEach((t) => clearInterval(t)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => `${i.id}:${i.autoMirrorMinutes || 0}:${i.sections.length}`).join("|")]);

  const handleSave = async (cfg: ExtraFirebaseConfig) => {
    if (!cfg.displayName.trim() || !cfg.apiKey.trim() || !cfg.databaseURL.trim()) {
      toast.error("Display Name, API Key, Database URL — required");
      return;
    }
    try {
      await saveExtraFirebase(cfg);
      toast.success(`Saved: ${cfg.displayName}`);
      setEditing(null);
      refresh();
    } catch (e: any) { toast.error("Save failed: " + (e?.message || e)); }
  };

  const handleDelete = async (cfg: ExtraFirebaseConfig) => {
    if (!confirm(`Delete Firebase "${cfg.displayName}"? This only removes the config — the actual Firebase project stays intact.`)) return;
    try {
      await disposeExtraFirebase(cfg);
      await deleteExtraFirebase(cfg.id);
      toast.success("Removed");
      refresh();
    } catch (e: any) { toast.error("Delete failed: " + (e?.message || e)); }
  };

  const togglePing = async (cfg: ExtraFirebaseConfig) => {
    setPings((p) => ({ ...p, [cfg.id]: { ok: false, ms: 0, error: "pinging…" } }));
    const r = await pingExtra(cfg);
    setPings((p) => ({ ...p, [cfg.id]: r }));
    if (r.ok) toast.success(`${cfg.displayName} online · ${r.ms}ms`);
    else toast.error(`${cfg.displayName} unreachable: ${r.error}`);
  };

  const toggleSection = async (cfg: ExtraFirebaseConfig, section: string) => {
    const next = cfg.sections.includes(section)
      ? cfg.sections.filter((s) => s !== section)
      : [...cfg.sections, section];
    try {
      await updateSections(cfg.id, next);
      setItems((arr) => arr.map((c) => (c.id === cfg.id ? { ...c, sections: next } : c)));
    } catch (e: any) { toast.error("Section update failed: " + (e?.message || e)); }
  };

  const onPushSection = async (cfg: ExtraFirebaseConfig, section: string) => {
    if (busyId) return toast.info("Another sync is running…");
    setBusyId(cfg.id);
    setProgress((p) => ({ ...p, [cfg.id]: { doneNodes: 0, totalNodes: 1, currentSection: section, phase: "reading" } }));
    try {
      const r = await pushSection(cfg, section, (info) => setProgress((p) => ({ ...p, [cfg.id]: info })));
      toast.success(`Pushed ${section} → ${cfg.displayName} (${r.nodes} nodes)`);
    } catch (e: any) {
      toast.error(`Push failed: ${e?.message || e}`);
    } finally {
      setBusyId(null);
      setTimeout(() => setProgress((p) => ({ ...p, [cfg.id]: null })), 1500);
    }
  };

  const onPullJson = async (cfg: ExtraFirebaseConfig, section: string) => {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const url = await getExtraRemoteSectionDownloadUrl(cfg, section, `${section}-${cfg.displayName.replace(/\W+/g, "_")}-${stamp}.json`);
      if (url) {
        triggerRemoteJsonDownload(url);
      } else {
        const data = await pullSectionJson(cfg, section);
        if (data == null) { toast.error(`${section} is empty in ${cfg.displayName}`); return; }
        triggerJsonDownload(`${section}-${cfg.displayName.replace(/\W+/g, "_")}-${stamp}.json`, data);
      }
      toast.success(`Downloaded ${section}.json`);
    } catch (e: any) { toast.error("Pull failed: " + (e?.message || e)); }
  };

  // ─── File-picker plumbing ────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<
    | { kind: "section"; cfg: ExtraFirebaseConfig; section: string }
    | { kind: "full-main" }
    | { kind: "full-extra"; cfg: ExtraFirebaseConfig }
    | null
  >(null);
  const triggerFilePick = () => fileInputRef.current?.click();

  const onUploadJson = (cfg: ExtraFirebaseConfig, section: string) => {
    pendingUpload.current = { kind: "section", cfg, section };
    triggerFilePick();
  };
  const onUploadFullMain = () => {
    if (!confirm("Upload a FULL JSON file into MAIN Firebase?\n\nTop-level sections in the file will REPLACE their current contents. Other sections stay untouched.\nProceed?")) return;
    pendingUpload.current = { kind: "full-main" };
    triggerFilePick();
  };
  const onUploadFullExtra = (cfg: ExtraFirebaseConfig) => {
    if (!confirm(`Upload a FULL JSON file into "${cfg.displayName}"?\n\nTop-level sections in the file will REPLACE their current contents.\nProceed?`)) return;
    pendingUpload.current = { kind: "full-extra", cfg };
    triggerFilePick();
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !pendingUpload.current) return;
    const job = pendingUpload.current;
    pendingUpload.current = null;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (job.kind === "section") {
        if (!confirm(`Overwrite "${job.section}" in "${job.cfg.displayName}" with this JSON file? Replaces ALL existing data in that section.`)) return;
        await uploadSectionJson(job.cfg, job.section, data);
        toast.success(`Uploaded ${job.section} → ${job.cfg.displayName}`);
      } else if (job.kind === "full-main") {
        await uploadMainFullJson(data);
        toast.success("Full JSON merged into MAIN Firebase");
        analyzeMain();
      } else if (job.kind === "full-extra") {
        await uploadExtraFullJson(job.cfg, data);
        toast.success(`Full JSON merged into ${job.cfg.displayName}`);
        analyzeExtra(job.cfg);
      }
    } catch (err: any) { toast.error("Upload failed: " + (err?.message || err)); }
  };

  const onSyncAll = async (cfg: ExtraFirebaseConfig) => {
    if (busyId) return toast.info("Another sync is running…");
    if (!cfg.sections.length) return toast.error("No sections selected");
    if (!confirm(`Push ${cfg.sections.length} sections from MAIN → ${cfg.displayName}?\nThis overwrites those sections in the replica.`)) return;
    setBusyId(cfg.id);
    try {
      await pushAllSelectedSections(cfg, cfg.sections, (info) => setProgress((p) => ({ ...p, [cfg.id]: info })));
      toast.success(`All ${cfg.sections.length} sections synced to ${cfg.displayName}`);
      analyzeExtra(cfg);
    } catch (e: any) {
      toast.error(`Sync failed: ${e?.message || e}`);
    } finally {
      setBusyId(null);
      setTimeout(() => setProgress((p) => ({ ...p, [cfg.id]: null })), 1500);
    }
  };

  const copyRules = async () => {
    try {
      await navigator.clipboard.writeText(rulesText);
      toast.success("Rules copied — paste in Firebase Console → Realtime Database → Rules");
    } catch { toast.error("Clipboard not available"); }
  };

  // ─── Full-JSON downloads ────────────────────────────────────────────────
  const onDownloadFullMain = async () => {
    const key = "MAIN";
    try {
      setDownloadBusy((prev) => ({ ...prev, [key]: { progress: 5, label: "Reading database…" } }));
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `main-firebase-FULL-${stamp}.json`;
      const directUrl = await getMainRemoteJsonDownloadUrl(filename);
      if (directUrl) {
        setDownloadBusy((prev) => ({ ...prev, [key]: { progress: 35, label: "Starting browser download…" } }));
        triggerRemoteJsonDownload(directUrl);
        setDownloadBusy((prev) => ({ ...prev, [key]: { progress: 100, label: "Download sent to browser" } }));
      } else {
        const data = await pullMainFullJson();
        await streamJsonDownload(filename, data, (info) => {
          const label = info.stage === "preparing"
            ? "Preparing JSON…"
            : info.stage === "writing"
              ? `Saving file… ${info.progress}%`
              : "Done";
          setDownloadBusy((prev) => ({ ...prev, [key]: { progress: info.progress, label } }));
        });
      }
      toast.success("Main full JSON downloaded");
    } catch (e: any) {
      toast.error("Download failed: " + (e?.message || e));
    } finally {
      setTimeout(() => setDownloadBusy((prev) => ({ ...prev, [key]: null })), 1200);
    }
  };
  const onDownloadFullExtra = async (cfg: ExtraFirebaseConfig) => {
    try {
      setDownloadBusy((prev) => ({ ...prev, [cfg.id]: { progress: 5, label: `Reading ${cfg.displayName}…` } }));
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `${cfg.displayName.replace(/\W+/g, "_")}-FULL-${stamp}.json`;
      const directUrl = await getExtraRemoteJsonDownloadUrl(cfg, filename);
      if (directUrl) {
        setDownloadBusy((prev) => ({ ...prev, [cfg.id]: { progress: 35, label: "Starting browser download…" } }));
        triggerRemoteJsonDownload(directUrl);
        setDownloadBusy((prev) => ({ ...prev, [cfg.id]: { progress: 100, label: "Download sent to browser" } }));
      } else {
        const data = await pullExtraFullJson(cfg);
        await streamJsonDownload(filename, data, (info) => {
          const label = info.stage === "preparing"
            ? "Preparing JSON…"
            : info.stage === "writing"
              ? `Saving file… ${info.progress}%`
              : "Done";
          setDownloadBusy((prev) => ({ ...prev, [cfg.id]: { progress: info.progress, label } }));
        });
      }
      toast.success(`${cfg.displayName} full JSON downloaded`);
    } catch (e: any) {
      toast.error("Download failed: " + (e?.message || e));
    } finally {
      setTimeout(() => setDownloadBusy((prev) => ({ ...prev, [cfg.id]: null })), 1200);
    }
  };

  // ─── Storage analytics ──────────────────────────────────────────────────
  const analyzeMain = async () => {
    setStatsBusy((b) => ({ ...b, MAIN: true }));
    try {
      const s = await analyzeMainStorage();
      setStats((m) => ({ ...m, MAIN: s }));
    } catch (e: any) { toast.error("Main analyze failed: " + (e?.message || e)); }
    finally { setStatsBusy((b) => ({ ...b, MAIN: false })); }
  };
  const analyzeExtra = async (cfg: ExtraFirebaseConfig) => {
    setStatsBusy((b) => ({ ...b, [cfg.id]: true }));
    try {
      const s = await analyzeExtraStorage(cfg);
      setStats((m) => ({ ...m, [cfg.id]: s }));
    } catch (e: any) { toast.error(`${cfg.displayName} analyze failed: ` + (e?.message || e)); }
    finally { setStatsBusy((b) => ({ ...b, [cfg.id]: false })); }
  };

  const analyzeAll = async () => {
    await analyzeMain();
    for (const cfg of items) await analyzeExtra(cfg);
  };

  // ─── Auto-mirror ─────────────────────────────────────────────────────────
  const onAutoMirrorChange = async (cfg: ExtraFirebaseConfig, mins: number) => {
    try {
      await setAutoMirror(cfg.id, mins);
      setItems((arr) => arr.map((c) => (c.id === cfg.id ? { ...c, autoMirrorMinutes: mins } : c)));
      toast.success(mins > 0 ? `Auto-mirror every ${mins} min` : "Auto-mirror disabled");
    } catch (e: any) { toast.error("Auto-mirror update failed: " + (e?.message || e)); }
  };

  // ─── Storage card renderer ──────────────────────────────────────────────
  const StorageCard = ({ stats, busy, onAnalyze }: { stats: StorageStats | null | undefined; busy: boolean; onAnalyze: () => void }) => {
    const pct = stats ? Math.min(100, (stats.bytes / RTDB_FREE_LIMIT) * 100) : 0;
    const barColor = pct > 80 ? "from-rose-400 to-orange-400" : pct > 50 ? "from-amber-400 to-yellow-400" : "from-emerald-400 to-sky-400";
    return (
      <div className="bg-black/30 border border-white/10 rounded-lg p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-white/55">
            <HardDrive size={11} /> Storage analytics
          </div>
          <button onClick={onAnalyze} disabled={busy} className="text-[10px] px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-white/85 disabled:opacity-50 flex items-center gap-1">
            {busy ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {stats ? "Refresh" : "Analyze"}
          </button>
        </div>
        {stats ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-bold text-white">{stats.human}</span>
              <span className="text-[10px] text-white/55 font-mono">
                {stats.totalNodes.toLocaleString()} nodes · {pct.toFixed(2)}% of 1 GB
              </span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className={`h-full bg-gradient-to-r ${barColor} transition-all`} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            {stats.sections.length > 0 && (
              <details className="text-[10.5px]">
                <summary className="cursor-pointer text-white/55 hover:text-white/75">Top sections ({stats.sections.length})</summary>
                <div className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto pr-1">
                  {stats.sections.slice(0, 12).map((s) => {
                    const sub = (s.bytes / Math.max(1, stats.bytes)) * 100;
                    return (
                      <div key={s.name} className="flex items-center gap-2">
                        <span className="font-mono text-white/80 truncate flex-1">{s.name}</span>
                        <span className="text-white/45 font-mono">{s.nodeCount}</span>
                        <span className="text-white/70 font-mono w-16 text-right">{((s.bytes / 1024) > 1024 ? `${(s.bytes / 1024 / 1024).toFixed(1)}M` : `${(s.bytes / 1024).toFixed(0)}K`)}</span>
                        <span className="text-white/40 font-mono w-10 text-right">{sub.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </>
        ) : (
          <div className="text-[11px] text-white/45">Click <b className="text-white/75">Analyze</b> to estimate storage usage.</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChosen} className="hidden" />

      {/* ═══ Header / Toolbar ═══ */}
      <div className={glassCard + " p-4"}>
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500/30 to-sky-500/30 border border-white/10 items-center justify-center text-[13px]">🔥</span>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-white">Firebase Multi-Manager</h3>
            <p className="text-[11px] text-white/55 leading-relaxed">Main Firebase always stays the source of truth. Add helper Firebases to share load — sync sections, download/upload JSON, monitor storage. Adding a new Firebase never touches existing data.</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setEditing(blankCfg())} className={btnPrimary + " flex items-center gap-1.5 !px-3 !py-2 !text-[11px]"}>
            <Plus size={13} /> Add Helper Firebase
          </button>
          <button onClick={analyzeAll} className={btnSecondary + " flex items-center gap-1.5 !px-3 !py-2 !text-[11px]"}>
            <HardDrive size={13} /> Analyze ALL storage
          </button>
          <button onClick={() => setRulesOpen((v) => !v)} className={btnSecondary + " flex items-center gap-1.5 !px-3 !py-2 !text-[11px]"}>
            <Copy size={13} /> {rulesOpen ? "Hide rules" : "RTDB rules"}
          </button>
        </div>
        {rulesOpen && (
          <div className="mt-3 space-y-2">
            <textarea
              value={rulesText}
              onChange={(e) => setRulesText(e.target.value)}
              rows={5}
              className={inputCls + " font-mono !text-[10.5px] leading-relaxed resize-y"}
            />
            <button onClick={copyRules} className={btnPrimary + " w-full !py-2 !text-[11px] flex items-center justify-center gap-1.5"}>
              <Copy size={12} /> Copy to clipboard
            </button>
          </div>
        )}
      </div>

      {/* ═══ MAIN Firebase card (cannot be deleted) ═══ */}
      <div className={glassCard + " p-4 space-y-3 border-2 border-amber-400/30"}>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Shield size={14} className="text-amber-300 shrink-0" />
              <h4 className="text-[13px] font-bold text-white truncate">{MAIN_DB_LABEL}</h4>
              <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30">PROTECTED · CANNOT DELETE</span>
            </div>
            <div className="text-[10px] text-white/45 mt-0.5">Source of truth · All live reads &amp; writes go here · Always full backup.</div>
          </div>
        </div>
        <StorageCard stats={stats.MAIN} busy={!!statsBusy.MAIN} onAnalyze={analyzeMain} />
        {downloadBusy.MAIN && (
          <div className="space-y-1.5 rounded-lg border border-amber-400/20 bg-black/30 px-3 py-2">
            <div className="flex items-center justify-between text-[10.5px] text-white/75">
              <span>{downloadBusy.MAIN.label}</span>
              <span className="font-mono">{downloadBusy.MAIN.progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all" style={{ width: `${Math.max(4, downloadBusy.MAIN.progress)}%` }} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onDownloadFullMain} disabled={!!downloadBusy.MAIN} className={btnSecondary + " flex items-center justify-center gap-1.5 !py-2 !text-[11px] disabled:opacity-50"}>
            <Download size={12} /> Download FULL JSON
          </button>
          <button onClick={onUploadFullMain} className={btnSecondary + " flex items-center justify-center gap-1.5 !py-2 !text-[11px]"}>
            <Upload size={12} /> Upload FULL JSON
          </button>
        </div>
      </div>

      {/* ═══ Extra Firebases list ═══ */}
      {loading ? (
        <div className={glassCard + " p-6 text-center text-[12px] text-white/60 flex items-center justify-center gap-2"}>
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className={glassCard + " p-6 text-center text-[12px] text-white/60"}>
          No helper Firebase yet. Click <b className="text-white/85">Add Helper Firebase</b> above to register one.
        </div>
      ) : (
        items.map((cfg) => {
          const ping = pings[cfg.id];
          const prog = progress[cfg.id];
          const pct = prog && prog.totalNodes > 0 ? Math.round((prog.doneNodes / prog.totalNodes) * 100) : 0;
          return (
            <div key={cfg.id} className={glassCard + " p-4 space-y-3"}>
              {/* Header row */}
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Database size={14} className="text-emerald-300 shrink-0" />
                    <h4 className="text-[13px] font-bold text-white truncate">{cfg.displayName}</h4>
                    {ping?.ok && <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 inline-flex items-center gap-1"><Wifi size={9} /> {ping.ms}ms</span>}
                    {ping && !ping.ok && <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-400/30 inline-flex items-center gap-1"><WifiOff size={9} /> offline</span>}
                    {(cfg.autoMirrorMinutes || 0) > 0 && (
                      <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/30 inline-flex items-center gap-1"><Timer size={9} /> auto {cfg.autoMirrorMinutes}m</span>
                    )}
                  </div>
                  <div className="text-[10px] text-white/45 truncate mt-0.5">{cfg.projectId} · {cfg.databaseURL}</div>
                  {cfg.mirrorURL && <div className="text-[10px] text-white/35 truncate">mirror: {cfg.mirrorURL}</div>}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => togglePing(cfg)} className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-white/70" title="Ping"><Wifi size={12} /></button>
                  <button onClick={() => setEditing(cfg)} className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-white/70" title="Edit"><Edit2 size={12} /></button>
                  <button onClick={() => handleDelete(cfg)} className="p-1.5 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300" title="Delete"><Trash2 size={12} /></button>
                </div>
              </div>

              {/* Storage analytics */}
              <StorageCard stats={stats[cfg.id]} busy={!!statsBusy[cfg.id]} onAnalyze={() => analyzeExtra(cfg)} />
              {downloadBusy[cfg.id] && (
                <div className="space-y-1.5 rounded-lg border border-emerald-400/15 bg-black/25 px-3 py-2">
                  <div className="flex items-center justify-between text-[10.5px] text-white/75">
                    <span>{downloadBusy[cfg.id]?.label}</span>
                    <span className="font-mono">{downloadBusy[cfg.id]?.progress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-gradient-to-r from-emerald-400 to-sky-400 transition-all" style={{ width: `${Math.max(4, downloadBusy[cfg.id]?.progress || 0)}%` }} />
                  </div>
                </div>
              )}

              {/* Full-JSON actions */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => onDownloadFullExtra(cfg)} disabled={!!downloadBusy[cfg.id]} className={btnSecondary + " flex items-center justify-center gap-1.5 !py-2 !text-[11px] disabled:opacity-50"}>
                  <Download size={12} /> Download FULL JSON
                </button>
                <button onClick={() => onUploadFullExtra(cfg)} className={btnSecondary + " flex items-center justify-center gap-1.5 !py-2 !text-[11px]"}>
                  <Upload size={12} /> Upload FULL JSON
                </button>
              </div>

              {/* Section checkboxes */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-white/45 mb-1.5">Sections this helper handles</div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                  {ALL_SECTIONS.map((s) => {
                    const on = cfg.sections.includes(s);
                    return (
                      <label key={s} className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-[10.5px] cursor-pointer border ${on ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-200" : "bg-white/5 border-white/10 text-white/60"}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleSection(cfg, s)} className="shrink-0" />
                        <span className="truncate">{s}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Per-section action rows */}
              {cfg.sections.length > 0 && (
                <div className="border-t border-white/5 pt-2">
                  <div className="text-[10px] uppercase tracking-wide text-white/45 mb-1.5">Per-section actions</div>
                  <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
                    {cfg.sections.map((s) => (
                      <div key={s} className="flex items-center gap-1.5 bg-black/20 border border-white/5 rounded px-2 py-1.5">
                        <span className="flex-1 min-w-0 text-[11px] font-mono text-white/80 truncate">{s}</span>
                        <button onClick={() => onPullJson(cfg, s)} title="Download JSON" className="p-1.5 rounded bg-white/5 hover:bg-sky-500/20 text-sky-300"><Download size={11} /></button>
                        <button onClick={() => onUploadJson(cfg, s)} title="Upload JSON" className="p-1.5 rounded bg-white/5 hover:bg-amber-500/20 text-amber-300"><Upload size={11} /></button>
                        <button onClick={() => onPushSection(cfg, s)} disabled={!!busyId} title="Push from MAIN" className="p-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 disabled:opacity-40"><Play size={11} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Auto-mirror */}
              <div className="bg-black/20 border border-white/5 rounded px-3 py-2 flex items-center gap-2 flex-wrap">
                <Timer size={12} className="text-sky-300 shrink-0" />
                <span className="text-[11px] text-white/70">Auto-mirror from MAIN</span>
                <select
                  value={cfg.autoMirrorMinutes || 0}
                  onChange={(e) => onAutoMirrorChange(cfg, Number(e.target.value))}
                  className="ml-auto bg-black/40 border border-white/10 rounded text-[11px] text-white px-2 py-1 focus:outline-none"
                >
                  <option value={0}>Off</option>
                  <option value={5}>Every 5 min</option>
                  <option value={15}>Every 15 min</option>
                  <option value={30}>Every 30 min</option>
                  <option value={60}>Every 1 hour</option>
                  <option value={180}>Every 3 hours</option>
                  <option value={720}>Every 12 hours</option>
                  <option value={1440}>Every 24 hours</option>
                </select>
              </div>

              {/* Sync All */}
              <button onClick={() => onSyncAll(cfg)} disabled={!!busyId || cfg.sections.length === 0} className={btnPrimary + " w-full !py-2 !text-[12px] disabled:opacity-50 flex items-center justify-center gap-1.5"}>
                {busyId === cfg.id ? <><Loader2 size={12} className="animate-spin" /> Syncing…</> : <><Play size={12} /> Sync ALL selected sections from MAIN → {cfg.displayName}</>}
              </button>

              {/* Progress bar */}
              {prog && (
                <div className="space-y-1">
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-400 to-sky-400 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[10px] text-white/55 flex items-center justify-between">
                    <span>{prog.phase === "done" ? <span className="text-emerald-300 inline-flex items-center gap-1"><Check size={10} /> done</span> : `${prog.phase} · ${prog.currentSection}${prog.currentKey ? ` · ${prog.currentKey}` : ""}`}</span>
                    <span className="font-mono">{prog.doneNodes}/{prog.totalNodes} · {pct}%</span>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      {/* ═══ Add / Edit modal ═══ */}
      {editing && (
        <div className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className={glassCard + " w-full max-w-md p-4 space-y-3 my-8"}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white">{items.find(i => i.id === editing.id) ? "Edit Firebase" : "Add Helper Firebase"}</h4>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded bg-white/5 text-white/70"><X size={14} /></button>
            </div>
            <div className="space-y-2">
              {([
                ["displayName", "Display Name *", "Backup-A"],
                ["apiKey", "API Key *", "AIzaSy…"],
                ["authDomain", "Auth Domain", "rs-backup.firebaseapp.com"],
                ["projectId", "Project ID", "rs-backup"],
                ["databaseURL", "Database URL *", "https://rs-backup-default-rtdb.firebaseio.com"],
                ["mirrorURL", "Mirror URL (optional, alt region)", "https://rs-backup.asia-se1.firebasedatabase.app"],
                ["storageBucket", "Storage Bucket", "rs-backup.firebasestorage.app"],
                ["messagingSenderId", "Messaging Sender ID", "1234567890"],
                ["appId", "App ID", "1:123:web:abc"],
              ] as Array<[keyof ExtraFirebaseConfig, string, string]>).map(([k, label, ph]) => (
                <div key={k}>
                  <label className="text-[10px] text-white/55 uppercase tracking-wide">{label}</label>
                  <input
                    value={(editing[k] as string) || ""}
                    onChange={(e) => setEditing({ ...editing, [k]: e.target.value })}
                    placeholder={ph}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(null)} className={btnSecondary + " flex-1 !text-[11px]"}>Cancel</button>
              <button
                onClick={async () => {
                  try {
                    const r = await pingExtra(editing);
                    if (r.ok) toast.success(`Test ping ok · ${r.ms}ms`);
                    else toast.warning(`Test ping failed: ${r.error} — saving anyway`);
                  } catch { /* ignore */ }
                  handleSave(editing);
                }}
                className={btnPrimary + " flex-1 !text-[11px]"}
              >
                Test &amp; Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FirebaseMultiManager;
