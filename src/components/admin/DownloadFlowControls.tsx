import { useEffect, useState } from "react";
import { Plus, Trash2, ShieldCheck, Save, Loader2, Timer, Layers, ListChecks, ChevronDown, RotateCcw, Infinity as InfinityIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { db, ref, update } from "@/lib/firebase";
import { normalizeDownloadFlowSettings } from "@/lib/downloadFlow";
import { useDownloadManagerConfig } from "@/lib/downloadManagerSettings";
import { toast } from "sonner";

type Draft = ReturnType<typeof normalizeDownloadFlowSettings>;
const MAX_BOXES = 20;
const num = "h-9 w-16 rounded-lg border border-white/10 bg-[#0f0f1d] text-center text-sm font-bold text-white tabular-nums focus:border-indigo-500 focus:outline-none";
const total = (steps: number[]) => steps.reduce((a, b) => a + (Number(b) || 0), 0);
const summary = (steps: number[]) => `${steps.length} ${steps.length === 1 ? "step" : "steps"} · ${steps.map(s => `${s}s`).join(" + ")}`;

function SectionHead({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return <div className="mb-3 flex items-center gap-3">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">{icon}</span>
    <div className="min-w-0"><h4 className="text-[14px] font-bold leading-tight text-white">{title}</h4><p className="mt-0.5 text-[11px] leading-snug text-zinc-400">{note}</p></div>
  </div>;
}

function StepEditor({ label, steps, onChange }: { label: string; steps: number[]; onChange: (steps: number[]) => void }) {
  return <div className="space-y-2">
    <div className="grid grid-cols-2 gap-2">
      {steps.map((seconds, i) => <div key={i} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/25 py-1.5 pl-2.5 pr-1">
        <span className="flex-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">Step {i + 1}</span>
        <input aria-label={`${label} step ${i + 1} wait seconds`} className={num} type="number" inputMode="numeric" min={1} max={120} value={seconds} onChange={(e) => onChange(steps.map((n, idx) => idx === i ? Number(e.target.value) : n))} />
        <span className="text-[10px] text-zinc-500">s</span>
        <button type="button" aria-label={`Remove ${label} step ${i + 1}`} disabled={steps.length <= 1} onClick={() => onChange(steps.filter((_, idx) => idx !== i))} className="flex h-8 w-7 items-center justify-center rounded-md text-zinc-500 hover:text-red-400 disabled:opacity-30"><Trash2 size={14} /></button>
      </div>)}
    </div>
    <button type="button" disabled={steps.length >= 10} onClick={() => onChange([...steps, 5])} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 text-[12px] font-semibold text-zinc-300 hover:border-indigo-500/60 hover:text-white disabled:opacity-40"><Plus size={14} />Add step</button>
  </div>;
}

export default function DownloadFlowControls({ card = "rounded-2xl border border-white/10 bg-[#16162A] p-4" }: { card?: string }) {
  const config = useDownloadManagerConfig();
  const [draft, setDraft] = useState<Draft>(() => normalizeDownloadFlowSettings(config));
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setDraft(normalizeDownloadFlowSettings(config)); }, [config]);
  const setCount = (key: string, steps: number[] | null) => {
    const next = { ...draft.adStepsByCount };
    if (steps) next[key] = steps; else delete next[key];
    setDraft({ ...draft, adStepsByCount: next });
  };
  const save = async () => {
    setSaving(true);
    try {
      const clean = normalizeDownloadFlowSettings(draft as unknown as Record<string, unknown>);
      // Only download rules are written here; ad codes are managed in Ad Manager.
      await update(ref(db, "settings/downloadManager"), { maxEpisodes: clean.maxEpisodes, sponsorSeconds: clean.sponsorSeconds, adSteps: clean.adSteps, adStepsByCount: clean.adStepsByCount });
      toast.success("Download flow saved");
    }
    catch { toast.error("Could not save download flow"); }
    finally { setSaving(false); }
  };
  const boxes = Math.min(MAX_BOXES, Math.max(1, Math.trunc(draft.maxEpisodes) || 1));
  const allSteps = draft.adStepsByCount.all;
  const custom = Object.keys(draft.adStepsByCount).filter(k => k !== "all").length;

  return <section className="space-y-4" aria-label="Download controller">
    {/* Overview */}
    <div className={card}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"><ShieldCheck size={19} /></span>
        <div className="min-w-0 flex-1"><h3 className="text-[15px] font-bold leading-tight text-white">Download flow</h3><p className="mt-0.5 text-[11px] text-zinc-400">Free website downloads · no daily limit · ad-block protection on</p></div>
      </div>
      <div className="mt-3.5 grid grid-cols-3 gap-2">
        {[["Per request", `${draft.maxEpisodes || 1} ep`], ["Continue", `${draft.sponsorSeconds || 1}s`], ["Custom boxes", String(custom + (allSteps ? 1 : 0))]].map(([k, v]) => <div key={k} className="rounded-xl border border-white/8 bg-black/25 px-2.5 py-2">
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-500">{k}</p><p className="mt-0.5 text-[15px] font-extrabold text-white tabular-nums">{v}</p></div>)}
      </div>
    </div>

    {/* Limits & timers */}
    <div className={card}>
      <SectionHead icon={<Timer size={17} />} title="Limits & timers" note="Two separate timers: the step timer unlocks Continue, the Continue timer is the sponsor-page stay." />
      <div className="divide-y divide-white/8 rounded-xl border border-white/10 bg-black/20">
        <label className="flex items-center gap-3 px-3.5 py-3">
          <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-white">Episodes per request</span><span className="block text-[11px] text-zinc-400">How many episodes a free user may pick at once</span></span>
          <input aria-label="Episodes per request" className={num} type="number" inputMode="numeric" min={1} value={draft.maxEpisodes} onChange={(e) => setDraft({ ...draft, maxEpisodes: Number(e.target.value) })} />
        </label>
        <label className="flex items-center gap-3 px-3.5 py-3">
          <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-white">Continue button timer</span><span className="block text-[11px] text-zinc-400">Seconds the user must stay on the sponsor page after tapping Continue</span></span>
          <input aria-label="Continue button timer seconds" className={num} type="number" inputMode="numeric" min={1} max={120} value={draft.sponsorSeconds} onChange={(e) => setDraft({ ...draft, sponsorSeconds: Number(e.target.value) })} />
          <span className="-ml-1.5 text-[11px] text-zinc-500">sec</span>
        </label>
      </div>
    </div>

    {/* Default steps */}
    <div className={card}>
      <SectionHead icon={<Layers size={17} />} title="Default steps" note={`Step timers before Continue unlocks · ${summary(draft.adSteps)} · total ${total(draft.adSteps)}s`} />
      <StepEditor label="Default steps" steps={draft.adSteps} onChange={(adSteps) => setDraft({ ...draft, adSteps })} />
    </div>

    {/* Per count */}
    <div className={card}>
      <SectionHead icon={<ListChecks size={17} />} title="Steps by episodes selected" note="Tap a row to give that selection its own steps; otherwise it uses the default." />
      <div className="overflow-hidden rounded-xl border border-white/10">
        {Array.from({ length: boxes }, (_, i) => String(i + 1)).map(key => {
          const own = draft.adStepsByCount[key];
          const steps = own || draft.adSteps;
          const expanded = open === key;
          const name = `${key} ${key === "1" ? "episode" : "episodes"}`;
          return <div key={key} className="border-b border-white/8 bg-black/20 last:border-b-0">
            <button type="button" aria-expanded={expanded} aria-label={`${name} steps`} onClick={() => setOpen(expanded ? null : key)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[13px] font-extrabold text-white tabular-nums">{key}</span>
              <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-white">{name}</span><span className="block truncate text-[11px] text-zinc-400">{summary(steps)}</span></span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase ${own ? "bg-indigo-500/20 text-indigo-300" : "bg-white/[0.06] text-zinc-400"}`}>{own ? "Custom" : "Default"}</span>
              <ChevronDown size={16} className={`shrink-0 text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
            {expanded && <div className="space-y-2.5 px-3.5 pb-3.5">
              {own ? <>
                <StepEditor label={name} steps={own} onChange={(s) => setCount(key, s)} />
                <button type="button" onClick={() => setCount(key, null)} className="flex h-8 items-center gap-1.5 text-[11.5px] font-semibold text-zinc-400 hover:text-white"><RotateCcw size={13} />Use default steps</button>
              </> : <button type="button" onClick={() => setCount(key, [...draft.adSteps])} className="h-10 w-full rounded-lg bg-indigo-600 text-[12.5px] font-bold text-white hover:bg-indigo-500">Customize steps for {name}</button>}
            </div>}
          </div>;
        })}
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3.5">
        <label className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white"><InfinityIcon size={16} /></span>
          <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-white">All episodes</span><span className="block text-[11px] text-zinc-400">{allSteps ? `Selections above ${draft.maxEpisodes} · ${summary(allSteps)}` : `Off · free users can pick up to ${draft.maxEpisodes}`}</span></span>
          <Switch aria-label="Allow all episodes" checked={!!allSteps} onCheckedChange={(on) => setCount("all", on ? [...draft.adSteps] : null)} />
        </label>
        {allSteps && <div className="mt-3"><StepEditor label="All episodes" steps={allSteps} onChange={(steps) => setCount("all", steps)} /></div>}
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">After the last step the user sees “Your links are ready” → Get Link. Ad codes live in Ad Manager → Download page ads.</p>
    </div>

    <div className="sticky bottom-2 z-10">
      <button type="button" disabled={saving} onClick={save} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-bold text-white shadow-lg shadow-black/40 hover:bg-indigo-500 disabled:opacity-60">{saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}Save download flow</button>
    </div>
  </section>;
}
