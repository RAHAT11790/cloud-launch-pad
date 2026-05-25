import { useEffect, useState } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string; }

type Item = { id: string; title: string; backdrop?: string; logo?: string; year?: string | number; type: "webseries" | "movies" };
type Mode = "backdrop" | "logo" | "both";

const SIZE_HINT: Record<Exclude<Mode, "both">, string> = {
  backdrop: "16:9 cinematic banner • ~1920×1080 • saved to `backdrop`",
  logo: "1:1 square title-mark • ~1024×1024 • saved to `logo`",
};

const BackdropAiReplacer = ({ glassCard, btnPrimary, btnSecondary, inputClass }: Props) => {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState("");
  const [running, setRunning] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [mode, setMode] = useState<Mode>("backdrop");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    const u1 = onValue(ref(db, "webseries"), (snap) => {
      const v = snap.val() || {};
      const ws = Object.keys(v).map((id) => ({
        id, title: v[id]?.title || id, backdrop: v[id]?.backdrop, logo: v[id]?.logo,
        year: v[id]?.year, type: "webseries" as const,
      }));
      setItems((prev) => [...ws, ...prev.filter((p) => p.type !== "webseries")]);
    });
    const u2 = onValue(ref(db, "movies"), (snap) => {
      const v = snap.val() || {};
      const mv = Object.keys(v).map((id) => ({
        id, title: v[id]?.title || id, backdrop: v[id]?.backdrop, logo: v[id]?.logo,
        year: v[id]?.year, type: "movies" as const,
      }));
      setItems((prev) => [...prev.filter((p) => p.type !== "movies"), ...mv]);
    });
    return () => { u1(); u2(); };
  }, []);

  const log = (s: string) => setLogs((l) => [`${new Date().toLocaleTimeString()} • ${s}`, ...l].slice(0, 250));

  const generateField = async (it: Item, m: Exclude<Mode, "both">): Promise<boolean> => {
    log(`→ [${m}] ${it.title}`);
    try {
      const { data, error } = await supabase.functions.invoke("generate-backdrop", {
        body: { animeId: it.id, title: it.title, type: it.type, year: it.year, mode: m },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || "no url");
      await update(ref(db, `${it.type}/${it.id}`), { [m]: data.url });
      log(`✓ [${m}] ${it.title} → ${data.url}`);
      return true;
    } catch (e: any) {
      log(`✗ [${m}] ${it.title}: ${e?.message || e}`);
      return false;
    }
  };

  const generateOne = async (it: Item, m: Mode = mode) => {
    if (m === "both") {
      await generateField(it, "backdrop");
      await generateField(it, "logo");
    } else {
      await generateField(it, m);
    }
  };

  const runOne = async (it: Item, m: Mode = mode) => {
    setRunning(true);
    try { await generateOne(it, m); toast.success(`Done: ${it.title}`); }
    finally { setRunning(false); }
  };

  const visible = items.filter((i) => i.title.toLowerCase().includes(filter.toLowerCase()));

  const runAll = async () => {
    if (running) return;
    setRunning(true); setCancel(false); setLogs([]); setProgress({ done: 0, total: visible.length });
    for (let i = 0; i < visible.length; i++) {
      if (cancel) { log("⏹ Cancelled"); break; }
      await generateOne(visible[i]);
      setProgress({ done: i + 1, total: visible.length });
    }
    setRunning(false);
    toast.success("Bulk generation finished");
  };

  return (
    <div className={glassCard + " space-y-4"}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-bold text-white">Backdrop & Logo AI Replacer</h3>
          <p className="text-[11px] text-white/60 mt-0.5">
            {mode === "both"
              ? "Generates BOTH a 16:9 backdrop AND a 1:1 logo per anime."
              : SIZE_HINT[mode]}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["backdrop", "logo", "both"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${mode === m ? "bg-emerald-500 text-black border-emerald-400" : "bg-white/5 text-white/70 border-white/10"}`}>
              {m === "backdrop" ? "Backdrop" : m === "logo" ? "Logo" : "Both"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title…" className={inputClass + " flex-1 min-w-[180px]"} />
        <button onClick={runAll} disabled={running} className={btnPrimary}>
          {running ? `Generating ${progress.done}/${progress.total}…` : `Generate ALL (${visible.length})`}
        </button>
        {running && <button onClick={() => setCancel(true)} className={btnSecondary}>Cancel</button>}
      </div>

      <div className="max-h-56 overflow-y-auto bg-black/40 rounded-lg p-2 text-[11px] font-mono text-white/80 space-y-0.5">
        {logs.length === 0 ? <div className="text-white/40">Logs will appear here…</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[460px] overflow-y-auto">
        {visible.map((it) => (
          <div key={it.type + it.id} className="flex items-center gap-2 bg-white/5 rounded-lg p-2">
            <div className="flex flex-col gap-1">
              {it.backdrop ? <img src={it.backdrop} alt="" className="w-20 h-11 object-cover rounded" /> : <div className="w-20 h-11 bg-white/10 rounded grid place-items-center text-[8px] text-white/40">no bd</div>}
              {it.logo ? <img src={it.logo} alt="" className="w-20 h-11 object-contain rounded bg-black/40" /> : <div className="w-20 h-11 bg-white/10 rounded grid place-items-center text-[8px] text-white/40">no logo</div>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white truncate">{it.title}</div>
              <div className="text-[10px] text-white/50">{it.type} {it.year ? `• ${it.year}` : ""}</div>
            </div>
            <div className="flex flex-col gap-1">
              <button onClick={() => runOne(it, "backdrop")} disabled={running} className={btnSecondary + " !text-[9px] !px-2 !py-1"}>Backdrop</button>
              <button onClick={() => runOne(it, "logo")} disabled={running} className={btnSecondary + " !text-[9px] !px-2 !py-1"}>Logo</button>
              <button onClick={() => runOne(it, "both")} disabled={running} className={btnSecondary + " !text-[9px] !px-2 !py-1 !bg-emerald-500/20 !border-emerald-400/40"}>Both</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BackdropAiReplacer;
