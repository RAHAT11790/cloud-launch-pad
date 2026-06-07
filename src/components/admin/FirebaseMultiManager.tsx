import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus, Database, Edit2, Trash2, Copy, Wifi, WifiOff, Upload, Download, Play, X, Check, Loader2,
} from "lucide-react";
import {
  ALL_SECTIONS, DEFAULT_RTDB_RULES,
  listExtraFirebases, saveExtraFirebase, deleteExtraFirebase, updateSections,
  pingExtra, pushSection, pushAllSelectedSections, pullSectionJson, uploadSectionJson,
  triggerJsonDownload, disposeExtraFirebase,
  type ExtraFirebaseConfig, type ProgressFn,
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
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const inputCls =
  "w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-white/35 focus:outline-none focus:border-emerald-400/60";

const FirebaseMultiManager = ({ glassCard, btnPrimary, btnSecondary }: Props) => {
  const [items, setItems] = useState<ExtraFirebaseConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ExtraFirebaseConfig | null>(null);
  const [pings, setPings] = useState<Record<string, { ok: boolean; ms: number; error?: string }>>({});
  const [progress, setProgress] = useState<Record<string, Parameters<ProgressFn>[0] | null>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rulesText, setRulesText] = useState(DEFAULT_RTDB_RULES);
  const [rulesOpen, setRulesOpen] = useState(false);

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
      const data = await pullSectionJson(cfg, section);
      if (data == null) { toast.error(`${section} is empty in ${cfg.displayName}`); return; }
      const stamp = new Date().toISOString().slice(0, 10);
      triggerJsonDownload(`${section}-${cfg.displayName.replace(/\W+/g, "_")}-${stamp}.json`, data);
      toast.success(`Downloaded ${section}.json`);
    } catch (e: any) { toast.error("Pull failed: " + (e?.message || e)); }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<{ cfg: ExtraFirebaseConfig; section: string } | null>(null);
  const onUploadJson = (cfg: ExtraFirebaseConfig, section: string) => {
    pendingUpload.current = { cfg, section };
    fileInputRef.current?.click();
  };
  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !pendingUpload.current) return;
    const { cfg, section } = pendingUpload.current;
    pendingUpload.current = null;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!confirm(`Overwrite "${section}" in "${cfg.displayName}" with this JSON file? This replaces ALL existing data in that section.`)) return;
      await uploadSectionJson(cfg, section, data);
      toast.success(`Uploaded ${section} → ${cfg.displayName}`);
    } catch (e: any) { toast.error("Upload failed: " + (e?.message || e)); }
  };

  const onSyncAll = async (cfg: ExtraFirebaseConfig) => {
    if (busyId) return toast.info("Another sync is running…");
    if (!cfg.sections.length) return toast.error("No sections selected");
    if (!confirm(`Push ${cfg.sections.length} sections from MAIN → ${cfg.displayName}? This overwrites existing data in those sections.`)) return;
    setBusyId(cfg.id);
    try {
      await pushAllSelectedSections(cfg, cfg.sections, (info) => setProgress((p) => ({ ...p, [cfg.id]: info })));
      toast.success(`All ${cfg.sections.length} sections synced to ${cfg.displayName}`);
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

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChosen} className="hidden" />

      {/* Header */}
      <div className={glassCard + " p-4"}>
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500/30 to-sky-500/30 border border-white/10 items-center justify-center text-[13px]">🔥</span>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-white">Firebase Add — Multi-Account Manager</h3>
            <p className="text-[11px] text-white/55 leading-relaxed">Add backup/replica Firebase projects. Push real data from MAIN, download per-section JSON, upload JSON back, copy RTDB rules.</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setEditing(blankCfg())} className={btnPrimary + " flex items-center gap-1.5 !px-3 !py-2 !text-[11px]"}>
            <Plus size={13} /> Add Firebase
          </button>
          <button onClick={() => setRulesOpen((v) => !v)} className={btnSecondary + " flex items-center gap-1.5 !px-3 !py-2 !text-[11px]"}>
            <Copy size={13} /> {rulesOpen ? "Hide rules" : "Copy RTDB rules"}
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

      {/* List */}
      {loading ? (
        <div className={glassCard + " p-6 text-center text-[12px] text-white/60 flex items-center justify-center gap-2"}>
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className={glassCard + " p-6 text-center text-[12px] text-white/60"}>
          No extra Firebase yet. Click <b className="text-white/85">Add Firebase</b> to register your first backup/replica.
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
                  </div>
                  <div className="text-[10px] text-white/45 truncate mt-0.5">
                    {cfg.projectId} · {cfg.databaseURL}
                  </div>
                  {cfg.mirrorURL && <div className="text-[10px] text-white/35 truncate">mirror: {cfg.mirrorURL}</div>}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => togglePing(cfg)} className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-white/70" title="Ping"><Wifi size={12} /></button>
                  <button onClick={() => setEditing(cfg)} className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-white/70" title="Edit"><Edit2 size={12} /></button>
                  <button onClick={() => handleDelete(cfg)} className="p-1.5 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300" title="Delete"><Trash2 size={12} /></button>
                </div>
              </div>

              {/* Section checkboxes */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-white/45 mb-1.5">Sections this Firebase handles</div>
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

      {/* Add / Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className={glassCard + " w-full max-w-md p-4 space-y-3 my-8"}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white">{items.find(i => i.id === editing.id) ? "Edit Firebase" : "Add Firebase"}</h4>
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
                  // quick test ping before save (don't block on failure)
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
