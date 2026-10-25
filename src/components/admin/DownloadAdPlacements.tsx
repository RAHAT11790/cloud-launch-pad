import { useEffect, useState } from "react";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { db, ref, update } from "@/lib/firebase";
import { DEFAULT_DOWNLOAD_ADS } from "@/lib/downloadFlow";
import { useDownloadManagerConfig } from "@/lib/downloadManagerSettings";
import { toast } from "sonner";

/** Ad codes shown on the download step pages. Lives in Ad Manager; the download controller keeps only download rules. */
export default function DownloadAdPlacements() {
  const config = useDownloadManagerConfig();
  const [socialBar, setSocialBar] = useState(config.socialBar);
  const [banner, setBanner] = useState(config.banner);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setSocialBar(config.socialBar); setBanner(config.banner); }, [config.socialBar, config.banner]);
  const save = async () => {
    setSaving(true);
    try { await update(ref(db, "settings/downloadManager"), { socialBar, banner }); toast.success("Download page ads saved"); }
    catch { toast.error("Could not save download page ads"); }
    finally { setSaving(false); }
  };
  return <section className="rounded-xl border border-border bg-card p-4 text-foreground space-y-3" aria-label="Download page ad codes">
    <div><h3 className="text-base font-bold">Download page ads</h3><p className="text-xs text-muted-foreground mt-1">Shown between the timer and the Continue button on each download step</p></div>
    <label className="block text-sm font-medium">Social Bar<Textarea aria-label="Download Social Bar code" value={socialBar} onChange={(e) => setSocialBar(e.target.value)} className="mt-2 min-h-24 font-mono text-xs" /></label>
    <label className="block text-sm font-medium">Banner · 160 × 300<Textarea aria-label="Download Banner code" value={banner} onChange={(e) => setBanner(e.target.value)} className="mt-2 min-h-32 font-mono text-xs" /></label>
    <Button variant="outline" className="w-full" onClick={() => { setSocialBar(DEFAULT_DOWNLOAD_ADS.socialBar); setBanner(DEFAULT_DOWNLOAD_ADS.banner); }}>Insert supplied placements</Button>
    <Button className="w-full" disabled={saving} onClick={save}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save download page ads</Button>
  </section>;
}
