import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Save, Trash2, RotateCw } from "lucide-react";
import {
  DEFAULT_LUCKY_SPIN, MAX_PRIZES, MIN_PRIZES, normalizeSpinSettings, prizePercents, saveSpinSettings, subscribeSpinSettings,
  type LuckySpinSettings, type SpinPrize,
} from "@/lib/luckySpin";
import { db, get, ref } from "@/lib/firebase";

type Props = { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string };

/** Admin → Daily Task Manager → Lucky Spin: switch, price, spins per period and the prize wheel. */
export default function LuckySpinManager({ glassCard, inputClass, btnPrimary, btnSecondary }: Props) {
  const [live, setLive] = useState<LuckySpinSettings>(DEFAULT_LUCKY_SPIN);
  const [draft, setDraft] = useState<LuckySpinSettings>(DEFAULT_LUCKY_SPIN);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rawEnabled, setRawEnabled] = useState(false);

  useEffect(() => subscribeSpinSettings((s) => {
    setLive(s);
    setDirty((d) => { if (!d) setDraft(s); return d; });
  }), []);
  useEffect(() => { void get(ref(db, "settings/luckySpin/enabled")).then((s) => setRawEnabled(s.val() === true)).catch(() => {}); }, [live]);

  const edit = (patch: Partial<LuckySpinSettings>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };
  const editPrize = (i: number, patch: Partial<SpinPrize>) => edit({ prizes: draft.prizes.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const addPrize = () => {
    if (draft.prizes.length >= MAX_PRIZES) return toast.error(`Up to ${MAX_PRIZES} prizes`);
    edit({ prizes: [...draft.prizes, { id: `p${Date.now().toString(36)}`, label: "1 Day", days: 1, chance: 10 }] });
  };
  const removePrize = (i: number) => {
    if (draft.prizes.length <= MIN_PRIZES) return toast.error(`The wheel needs at least ${MIN_PRIZES} prizes`);
    edit({ prizes: draft.prizes.filter((_, k) => k !== i) });
  };

  const save = async (next = draft) => {
    if (next.prizes.length < MIN_PRIZES) return toast.error(`The wheel needs at least ${MIN_PRIZES} prizes`);
    if (!next.prizes.some((p) => p.chance > 0)) return toast.error("At least one prize needs a chance above 0");
    setSaving(true);
    try {
      const clean = normalizeSpinSettings({ ...next, enabled: true });
      await saveSpinSettings({ ...clean, enabled: next.enabled });
      setDirty(false);
      toast.success(next.enabled ? "Lucky Spin saved — it is ON for users" : "Lucky Spin saved — it is OFF");
    } catch (e: any) { toast.error("Save failed: " + (e?.message || "unknown")); }
    setSaving(false);
  };
  const toggle = () => { const next = { ...draft, enabled: !rawEnabled }; setDraft(next); void save(next).then(() => setRawEnabled(next.enabled)); };

  const pct = prizePercents(draft.prizes);
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <div className="space-y-4">
      <div className={glassCard + " p-4 flex items-center gap-3"}>
        <div className={"w-10 h-10 rounded-xl flex items-center justify-center shrink-0 " + (rawEnabled ? "bg-amber-400/20" : "bg-white/5")}>
          <RotateCw className={"w-5 h-5 " + (rawEnabled ? "text-amber-300" : "text-white/40")} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">Lucky Spin</p>
          <p className="text-[11.5px] text-white/55 leading-snug">{rawEnabled ? "ON — users see a golden Lucky Spin button in Profile and on the redeem page." : "OFF — the button is hidden for everyone."}</p>
        </div>
        <button role="switch" aria-checked={rawEnabled} aria-label="Lucky Spin" disabled={saving} onClick={toggle}
          className={"relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50 " + (rawEnabled ? "bg-amber-500" : "bg-white/15")}>
          <span className={"absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all " + (rawEnabled ? "left-6" : "left-1")} />
        </button>
      </div>

      <div className={glassCard + " p-4 space-y-3"}>
        <h3 className="text-sm font-black text-white">Rules</h3>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-[11px] text-white/60">Coins per spin
            <input type="number" min={0} className={inputClass + " mt-1"} value={draft.coinCost} onChange={(e) => edit({ coinCost: num(e.target.value) })} />
          </label>
          <label className="text-[11px] text-white/60">Spins
            <input type="number" min={1} className={inputClass + " mt-1"} value={draft.spinsPerPeriod} onChange={(e) => edit({ spinsPerPeriod: num(e.target.value) })} />
          </label>
          <label className="text-[11px] text-white/60">Every (days)
            <input type="number" min={1} className={inputClass + " mt-1"} value={draft.periodDays} onChange={(e) => edit({ periodDays: num(e.target.value) })} />
          </label>
        </div>
        <p className="text-[11.5px] text-white/55">Each user gets <b className="text-amber-200">{draft.spinsPerPeriod}</b> spin{draft.spinsPerPeriod === 1 ? "" : "s"} every <b className="text-amber-200">{draft.periodDays}</b> day{draft.periodDays === 1 ? "" : "s"} (the first spin starts the cycle), <b className="text-amber-200">{draft.coinCost}</b> coins each.</p>
      </div>

      <div className={glassCard + " p-4 space-y-2"}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-white">Prizes on the wheel ({draft.prizes.length}/{MAX_PRIZES})</h3>
          <button onClick={addPrize} className={btnSecondary + " inline-flex items-center gap-1 text-[12px] px-3 py-1.5"}><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
        <p className="text-[11px] text-white/50">Days 0 = nothing won. Chance is a weight: 1, 90 and 10 mean 1 %, 89 % and 10 % of spins.</p>
        <div className="grid grid-cols-[1fr_56px_64px_44px_28px] gap-1.5 text-[10px] uppercase tracking-wide text-white/40 px-0.5">
          <span>Label</span><span>Days</span><span>Chance</span><span className="text-right">Real</span><span />
        </div>
        {draft.prizes.map((p, i) => (
          <div key={p.id + i} className="grid grid-cols-[1fr_56px_64px_44px_28px] gap-1.5 items-center">
            <input className={inputClass} value={p.label} maxLength={14} onChange={(e) => editPrize(i, { label: e.target.value })} />
            <input type="number" min={0} className={inputClass} value={p.days} onChange={(e) => editPrize(i, { days: num(e.target.value) })} />
            <input type="number" min={0} step="0.1" className={inputClass} value={p.chance} onChange={(e) => editPrize(i, { chance: num(e.target.value) })} />
            <span className="text-right text-[11px] font-bold text-amber-200">{pct[i] < 1 && pct[i] > 0 ? pct[i].toFixed(1) : Math.round(pct[i])}%</span>
            <button onClick={() => removePrize(i)} aria-label="Remove prize" className="w-7 h-7 rounded-lg grid place-items-center bg-red-500/15 text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {dirty && <button onClick={() => { setDraft(live); setDirty(false); }} className={btnSecondary + " px-4 py-2.5 text-sm"}>Undo</button>}
        <button onClick={() => void save()} disabled={saving || !dirty} className={btnPrimary + " flex-1 inline-flex items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-50"}>
          <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Lucky Spin"}
        </button>
      </div>
    </div>
  );
}
