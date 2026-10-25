import { useEffect, useState } from "react";
import { Plus, Trash2, ShieldCheck, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { db, ref, update } from "@/lib/firebase";
import { normalizeDownloadFlowSettings } from "@/lib/downloadFlow";
import { useDownloadManagerConfig } from "@/lib/downloadManagerSettings";
import { toast } from "sonner";

type Draft = ReturnType<typeof normalizeDownloadFlowSettings>;
const MAX_BOXES = 20;

function StepBox({ title, note, steps, onChange, onReset }: { title: string; note: string; steps: number[]; onChange: (steps: number[]) => void; onReset?: () => void }) {
  return <div className="rounded-lg border border-border p-3 space-y-2">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0"><h5 className="text-sm font-semibold">{title}</h5><p className="text-[11px] text-muted-foreground">{note}</p></div>
      <div className="flex shrink-0 gap-1">
        {onReset && <Button variant="ghost" size="sm" onClick={onReset}>Default</Button>}
        <Button variant="outline" size="sm" disabled={steps.length >= 10} onClick={() => onChange([...steps, 5])}><Plus />Step</Button>
      </div>
    </div>
    {steps.map((seconds, i) => <div className="flex items-center gap-3" key={i}>
      <span className="flex-1 text-sm">Step {i + 1}</span>
      <Input aria-label={`${title} step ${i + 1} wait seconds`} className="w-20" type="number" min={1} max={120} value={seconds} onChange={(e) => onChange(steps.map((n, idx) => idx === i ? Number(e.target.value) : n))} />
      <span className="text-xs text-muted-foreground">sec</span>
      <Button variant="ghost" size="icon" aria-label={`Remove ${title} step ${i + 1}`} disabled={steps.length <= 1} onClick={() => onChange(steps.filter((_, idx) => idx !== i))}><Trash2 /></Button>
    </div>)}
  </div>;
}

export default function DownloadFlowControls() {
  const config = useDownloadManagerConfig();
  const [draft, setDraft] = useState<Draft>(() => normalizeDownloadFlowSettings(config));
  const [saving, setSaving] = useState(false);
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
      await update(ref(db, "settings/downloadManager"), { maxEpisodes: clean.maxEpisodes, adSteps: clean.adSteps, adStepsByCount: clean.adStepsByCount });
      toast.success("Download flow saved");
    }
    catch { toast.error("Could not save download flow"); }
    finally { setSaving(false); }
  };
  const boxes = Math.min(MAX_BOXES, Math.max(1, Math.trunc(draft.maxEpisodes) || 1));
  const allSteps = draft.adStepsByCount.all;
  return <section className="border-y border-border py-5 text-foreground space-y-5" aria-label="Download controller">
    <div><h3 className="text-base font-bold">Download controller</h3><p className="text-xs text-muted-foreground mt-1">Website downloads only · no daily limit</p></div>
    <label className="flex items-center justify-between gap-4 text-sm font-medium">Episodes per request
      <Input aria-label="Episodes per request" type="number" min={1} value={draft.maxEpisodes} className="w-20" onChange={(e) => setDraft({ ...draft, maxEpisodes: Number(e.target.value) })} />
    </label>
    <StepBox title="Default steps" note="Used for any episode count without its own box" steps={draft.adSteps} onChange={(adSteps) => setDraft({ ...draft, adSteps })} />
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Steps by episodes selected</h4>
      {Array.from({ length: boxes }, (_, i) => String(i + 1)).map(key => {
        const own = draft.adStepsByCount[key];
        return own
          ? <StepBox key={key} title={`${key} ${key === "1" ? "episode" : "episodes"}`} note="Own steps" steps={own} onChange={(steps) => setCount(key, steps)} onReset={() => setCount(key, null)} />
          : <div key={key} className="flex items-center justify-between rounded-lg border border-dashed border-border p-3">
              <div><h5 className="text-sm font-semibold">{key} {key === "1" ? "episode" : "episodes"}</h5><p className="text-[11px] text-muted-foreground">Uses default · {draft.adSteps.length} steps</p></div>
              <Button variant="outline" size="sm" onClick={() => setCount(key, [...draft.adSteps])}>Customize</Button>
            </div>;
      })}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <label className="flex items-center justify-between gap-3 text-sm font-semibold">All episodes
          <Switch aria-label="Allow all episodes" checked={!!allSteps} onCheckedChange={(on) => setCount("all", on ? [...draft.adSteps] : null)} />
        </label>
        <p className="text-[11px] text-muted-foreground">{allSteps ? "Free users can select more than the per-request limit; these steps apply." : "Off: free users can select only up to the per-request limit."}</p>
        {allSteps && <StepBox title="All episodes" note="Selections above the limit" steps={allSteps} onChange={(steps) => setCount("all", steps)} />}
      </div>
      <p className="text-xs text-muted-foreground">Final page · links after the last step</p>
    </div>
    <div className="flex items-center gap-2 text-sm text-primary"><ShieldCheck size={18} />Download ad-block protection · Always active</div>
    <p className="text-xs text-muted-foreground">Ad codes for these pages are in Ad Manager → Download page ads.</p>
    <Button className="w-full" disabled={saving} onClick={save}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save download flow</Button>
  </section>;
}
