import { useEffect, useState } from "react";
import { db, ref, onValue, set, update } from "@/lib/firebase";
import { toast } from "sonner";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; }

const AdsterraConfig = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [enabled, setEnabled] = useState(true);
  const [popunder, setPopunder] = useState("");
  const [socialBar, setSocialBar] = useState("");
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(60);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const u = onValue(ref(db, "settings/adsterra"), (snap) => {
      const v = snap.val() || {};
      setEnabled(v.enabled !== false);
      setPopunder(v.popunder || "");
      setSocialBar(v.socialBar || "");
      const n = Number(v.refreshIntervalSec);
      setRefreshIntervalSec(Number.isFinite(n) && n >= 0 ? n : 60);
    });
    return () => u();
  }, []);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    try { await update(ref(db, "settings/adsterra"), { enabled: next }); toast.success(next ? "Adsterra enabled" : "Adsterra disabled"); }
    catch { toast.error("Failed"); }
  };

  const save = async () => {
    setLoading(true);
    try {
      await set(ref(db, "settings/adsterra"), {
        enabled,
        popunder: popunder.trim(),
        socialBar: socialBar.trim(),
        refreshIntervalSec: Math.max(0, Math.min(3600, Number(refreshIntervalSec) || 0)),
      });
      toast.success("Adsterra config saved");
    } catch { toast.error("Save failed"); }
    setLoading(false);
  };

  return (
    <div className={glassCard + " space-y-4"}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 className="text-base font-bold text-white">Adsterra Ads</h3>
        <label className="inline-flex items-center gap-2 text-xs text-white/80 flex-shrink-0">
          <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
          {enabled ? "Enabled" : "Disabled"}
        </label>
      </div>
      <p className="text-[11px] text-white/60 leading-relaxed">
        Paste the exact <code className="text-white/80">&lt;script&gt;</code> snippet from your Adsterra dashboard. Ads run only inside the video player, refresh strictly from the last successful load time, and now include a manual close button. Premium users never see ads.
      </p>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-white/80 block">Popunder Script</label>
        <textarea
          value={popunder}
          onChange={(e) => setPopunder(e.target.value)}
          rows={3}
          className={inputClass + " w-full font-mono text-[11px] break-all"}
          placeholder='<script src="https://pl29545318.effectivecpmnetwork.com/.../invoke.js"></script>'
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-white/80 block">Social Bar Script</label>
        <textarea
          value={socialBar}
          onChange={(e) => setSocialBar(e.target.value)}
          rows={3}
          className={inputClass + " w-full font-mono text-[11px] break-all"}
          placeholder='<script src="https://pl29545319.effectivecpmnetwork.com/.../invoke.js"></script>'
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-white/80 block">
          Ad Refresh Interval (seconds)
        </label>
        <input
          type="number"
          min={0}
          max={3600}
          value={refreshIntervalSec}
          onChange={(e) => setRefreshIntervalSec(Number(e.target.value))}
          className={inputClass + " w-full"}
          placeholder="60"
        />
        <p className="text-[10px] text-white/50 leading-relaxed">
          Refresh starts counting after the current ad cycle finishes loading. Example: if an ad loads at 1:00 and this is <strong>120</strong>, the next cycle starts at about 3:00. Set <strong>0</strong> to disable auto refresh.
        </p>
      </div>

      <button onClick={save} disabled={loading} className={btnPrimary + " w-full"}>
        {loading ? "Saving..." : "Save Adsterra Config"}
      </button>
    </div>
  );
};

export default AdsterraConfig;
