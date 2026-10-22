import { useEffect, useState } from "react";
import { Plus, Trash2, ShieldCheck, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { db, ref, update } from "@/lib/firebase";
import { DEFAULT_DOWNLOAD_ADS, normalizeDownloadFlowSettings } from "@/lib/downloadFlow";
import { useDownloadManagerConfig } from "@/lib/downloadManagerSettings";
import { toast } from "sonner";

export default function DownloadFlowControls() {
  const config = useDownloadManagerConfig();
  const [draft, setDraft] = useState(() => normalizeDownloadFlowSettings(config));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(normalizeDownloadFlowSettings(config)); }, [config]);
  const save = async () => {
    setSaving(true);
    try { await update(ref(db, "settings/downloadManager"), normalizeDownloadFlowSettings(draft)); toast.success("Download flow saved"); }
    catch { toast.error("Could not save download flow"); }
    finally { setSaving(false); }
  };
  return <section className="border-y border-border py-5 text-foreground space-y-5" aria-label="Download advertising controls">
    <div><h3 className="text-base font-bold">Download controller</h3><p className="text-xs text-muted-foreground mt-1">Website downloads only</p></div>
    <label className="flex items-center justify-between gap-4 text-sm font-medium">Episodes per request
      <Input aria-label="Episodes per request" type="number" min={1} value={draft.maxEpisodes} className="w-20" onChange={(e) => setDraft({ ...draft, maxEpisodes: Number(e.target.value) })} />
    </label>
    <div className="space-y-2"><div className="flex items-center justify-between"><h4 className="text-sm font-semibold">Advertising steps</h4><Button variant="outline" size="sm" disabled={draft.adSteps.length >= 10} onClick={() => setDraft({ ...draft, adSteps: [...draft.adSteps, 5] })}><Plus />Add step</Button></div>
      {draft.adSteps.map((seconds, i) => <div className="flex items-center gap-3 border-b border-border py-2" key={i}><span className="flex-1 text-sm">Step {i + 1}</span><Input aria-label={`Step ${i + 1} wait seconds`} className="w-20" type="number" min={1} max={120} value={seconds} onChange={(e) => setDraft({ ...draft, adSteps: draft.adSteps.map((n, idx) => idx === i ? Number(e.target.value) : n) })} /><span className="text-xs text-muted-foreground">sec</span><Button variant="ghost" size="icon" aria-label={`Remove step ${i + 1}`} onClick={() => setDraft({ ...draft, adSteps: draft.adSteps.filter((_, idx) => idx !== i) })}><Trash2 /></Button></div>)}
      <p className="text-xs text-muted-foreground">Final page · Ad-free</p>
    </div>
    <div className="flex items-center gap-2 text-sm text-primary"><ShieldCheck size={18} />Download ad-block protection · Always active</div>
    <div className="space-y-3">
      <label className="block text-sm font-medium">Social Bar<Textarea aria-label="Download Social Bar code" value={draft.socialBar} onChange={(e) => setDraft({ ...draft, socialBar: e.target.value })} className="mt-2 min-h-24 font-mono text-xs" /></label>
      <label className="block text-sm font-medium">Banner · 160 × 300<Textarea aria-label="Download Banner code" value={draft.banner} onChange={(e) => setDraft({ ...draft, banner: e.target.value })} className="mt-2 min-h-32 font-mono text-xs" /></label>
      <Button variant="outline" className="w-full" onClick={() => setDraft({ ...draft, ...DEFAULT_DOWNLOAD_ADS })}>Insert supplied placements</Button>
      <Button className="w-full" disabled={saving} onClick={save}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save download flow</Button>
    </div>
  </section>;
}