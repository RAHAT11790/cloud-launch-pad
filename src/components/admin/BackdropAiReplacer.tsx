import { useEffect, useState } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string; }

type Item = { id: string; title: string; backdrop?: string; logo?: string; year?: string | number; type: "webseries" | "movies" };
type Mode = "backdrop" | "logo";

const SIZE_HINT: Record<Mode, string> = {
  backdrop: "16:9 cinematic banner • saved to `backdrop`",
  logo: "1:1 square title-mark • saved to `logo`",
};

const BackdropAiReplacer = ({ glassCard, btnPrimary, btnSecondary, inputClass }: Props) => {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<Mode>("backdrop");
  // per-key (type:id:mode) progress 0..100, undefined = idle
  const [progress, setProgress] = useState<Record<string, number>>({});

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

  const keyOf = (it: Item, m: Mode) => `${it.type}:${it.id}:${m}`;

  const runOne = async (it: Item, m: Mode) => {
    const k = keyOf(it, m);
    if (progress[k] !== undefined) return; // already running
    setProgress((p) => ({ ...p, [k]: 5 }));

    // Smooth fake-progress while we wait for the model
    const tick = setInterval(() => {
      setProgress((p) => {
        const cur = p[k] ?? 5;
        if (cur >= 92) return p;
        return { ...p, [k]: Math.min(92, cur + Math.random() * 6 + 2) };
      });
    }, 600);

    try {
      const { data, error } = await supabase.functions.invoke("generate-backdrop", {
        body: { animeId: it.id, title: it.title, type: it.type, year: it.year, mode: m },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || "no url");
      await update(ref(db, `${it.type}/${it.id}`), { [m]: data.url });
      setProgress((p) => ({ ...p, [k]: 100 }));
      toast.success(`${m === "backdrop" ? "Backdrop" : "Logo"} ready: ${it.title}`);
      setTimeout(() => setProgress((p) => { const n = { ...p }; delete n[k]; return n; }), 1200);
    } catch (e: any) {
      const msg = e?.message || String(e);
      toast.error(`${it.title}: ${msg.includes("PAYMENT") ? "AI credits exhausted — add credits in Workspace" : msg.includes("RATE") ? "Rate limited — try again in a moment" : msg}`);
      setProgress((p) => { const n = { ...p }; delete n[k]; return n; });
    } finally {
      clearInterval(tick);
    }
  };

  const visible = items.filter((i) => i.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className={glassCard + " space-y-4"}>
      <div className="space-y-2">
        <h3 className="text-base font-bold text-white">Backdrop & Logo AI Replacer</h3>
        <p className="text-[11px] text-white/60 leading-relaxed">{SIZE_HINT[mode]} • Click a button to generate one image at a time.</p>
        <div className="flex gap-2 flex-wrap">
          {(["backdrop", "logo"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${mode === m ? "bg-emerald-500 text-black border-emerald-400" : "bg-white/5 text-white/70 border-white/10"}`}>
              {m === "backdrop" ? "Backdrop (16:9)" : "Logo (1:1)"}
            </button>
          ))}
        </div>
      </div>

      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title…" className={inputClass + " w-full"} />

      <div className="grid grid-cols-1 gap-2 max-h-[560px] overflow-y-auto pr-1">
        {visible.map((it) => {
          const kb = keyOf(it, "backdrop");
          const kl = keyOf(it, "logo");
          const pb = progress[kb];
          const pl = progress[kl];
          return (
            <div key={it.type + it.id} className="bg-white/5 rounded-xl p-3 border border-white/5 space-y-2.5">
              <div className="flex gap-3 items-start">
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  {it.backdrop ? <img src={it.backdrop} alt="" className="w-24 h-[54px] object-cover rounded-md" /> : <div className="w-24 h-[54px] bg-white/5 rounded-md grid place-items-center text-[9px] text-white/40">no bd</div>}
                  {it.logo ? <img src={it.logo} alt="" className="w-24 h-[54px] object-contain rounded-md bg-black/40" /> : <div className="w-24 h-[54px] bg-white/5 rounded-md grid place-items-center text-[9px] text-white/40">no logo</div>}
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="text-[13px] font-semibold text-white truncate">{it.title}</div>
                  <div className="text-[10px] text-white/50">{it.type} {it.year ? `• ${it.year}` : ""}</div>
                  <div className="flex gap-1.5 pt-0.5">
                    <button onClick={() => runOne(it, "backdrop")} disabled={pb !== undefined}
                      className={btnSecondary + " !text-[10px] !px-2.5 !py-1.5 disabled:opacity-50"}>
                      {pb !== undefined ? "Generating…" : "Backdrop"}
                    </button>
                    <button onClick={() => runOne(it, "logo")} disabled={pl !== undefined}
                      className={btnSecondary + " !text-[10px] !px-2.5 !py-1.5 disabled:opacity-50"}>
                      {pl !== undefined ? "Generating…" : "Logo"}
                    </button>
                  </div>
                </div>
              </div>

              {(pb !== undefined || pl !== undefined) && (
                <div className="space-y-1.5">
                  {pb !== undefined && (
                    <div>
                      <div className="flex justify-between text-[9px] text-white/60 mb-1"><span>Backdrop</span><span>{Math.round(pb)}%</span></div>
                      <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-300" style={{ width: `${pb}%` }} />
                      </div>
                    </div>
                  )}
                  {pl !== undefined && (
                    <div>
                      <div className="flex justify-between text-[9px] text-white/60 mb-1"><span>Logo</span><span>{Math.round(pl)}%</span></div>
                      <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-fuchsia-500 to-pink-400 transition-all duration-300" style={{ width: `${pl}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <div className="text-center text-white/40 text-xs py-6">No items match the filter.</div>}
      </div>
    </div>
  );
};

export default BackdropAiReplacer;
