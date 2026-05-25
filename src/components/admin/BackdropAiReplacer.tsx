import { useEffect, useState } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string; }

type Item = { id: string; title: string; backdrop?: string; type: "webseries" | "movies" };

const BackdropAiReplacer = ({ glassCard, btnPrimary, btnSecondary }: Props) => {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    const u1 = onValue(ref(db, "webseries"), (snap) => {
      const v = snap.val() || {};
      const ws = Object.keys(v).map((id) => ({ id, title: v[id]?.title || id, backdrop: v[id]?.backdrop, type: "webseries" as const }));
      setItems((prev) => [...ws, ...prev.filter((p) => p.type !== "webseries")]);
    });
    const u2 = onValue(ref(db, "movies"), (snap) => {
      const v = snap.val() || {};
      const mv = Object.keys(v).map((id) => ({ id, title: v[id]?.title || id, backdrop: v[id]?.backdrop, type: "movies" as const }));
      setItems((prev) => [...prev.filter((p) => p.type !== "movies"), ...mv]);
    });
    return () => { u1(); u2(); };
  }, []);

  const log = (s: string) => setLogs((l) => [`${new Date().toLocaleTimeString()} • ${s}`, ...l].slice(0, 200));

  const generateOne = async (it: Item): Promise<boolean> => {
    log(`→ ${it.title} (${it.type})`);
    try {
      const { data, error } = await supabase.functions.invoke("generate-backdrop", {
        body: { animeId: it.id, title: it.title, type: it.type },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || "no url");
      await update(ref(db, `${it.type}/${it.id}`), { backdrop: data.url });
      log(`✓ ${it.title} → ${data.url}`);
      return true;
    } catch (e: any) {
      log(`✗ ${it.title}: ${e?.message || e}`);
      return false;
    }
  };

  const runOne = async (it: Item) => { setRunning(true); await generateOne(it); setRunning(false); };

  const runAll = async () => {
    if (running) return;
    setRunning(true); setCancel(false); setLogs([]); setProgress({ done: 0, total: items.length });
    for (let i = 0; i < items.length; i++) {
      if (cancel) { log("⏹ Cancelled"); break; }
      await generateOne(items[i]);
      setProgress({ done: i + 1, total: items.length });
    }
    setRunning(false);
  };

  return (
    <div className={glassCard + " space-y-4"}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-bold text-white">Backdrop AI Replacer</h3>
        <div className="flex gap-2">
          <button onClick={runAll} disabled={running} className={btnPrimary}>
            {running ? `Generating ${progress.done}/${progress.total}...` : `Generate ALL (${items.length})`}
          </button>
          {running && <button onClick={() => setCancel(true)} className={btnSecondary}>Cancel</button>}
        </div>
      </div>
      <p className="text-xs text-white/60">
        AI generates a cinematic 16:9 backdrop for each title (style: title text + RS ANIME logo + Telegram tag), uploads to ImgBB, saves URL to Firebase.
      </p>

      <div className="max-h-60 overflow-y-auto bg-black/40 rounded-lg p-2 text-[11px] font-mono text-white/80 space-y-0.5">
        {logs.length === 0 ? <div className="text-white/40">Logs will appear here…</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto">
        {items.map((it) => (
          <div key={it.type + it.id} className="flex items-center gap-2 bg-white/5 rounded-lg p-2">
            {it.backdrop ? <img src={it.backdrop} alt="" className="w-20 h-11 object-cover rounded" /> : <div className="w-20 h-11 bg-white/10 rounded" />}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white truncate">{it.title}</div>
              <div className="text-[10px] text-white/50">{it.type}</div>
            </div>
            <button onClick={() => runOne(it)} disabled={running} className={btnSecondary + " !text-[10px] !px-2 !py-1"}>Generate</button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BackdropAiReplacer;
