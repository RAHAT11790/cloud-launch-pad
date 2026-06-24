import { useEffect, useState } from "react";
import { db, ref, onValue, set, update } from "@/lib/firebase";
import { toast } from "sonner";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; }

const AdsterraConfig = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [enabled, setEnabled] = useState(true);
  const [popunder, setPopunder] = useState("");
  const [streamLink, setStreamLink] = useState("");
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(50);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const u = onValue(ref(db, "settings/adsterra"), (snap) => {
      const v = snap.val() || {};
      setEnabled(v.enabled !== false);
      setPopunder(v.popunder || "");
      setStreamLink(v.streamLink || "");
      const n = Number(v.refreshIntervalSec);
      setRefreshIntervalSec(Number.isFinite(n) && n >= 0 ? Math.min(Math.max(n, 45), 60) : 50);
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
        streamLink: streamLink.trim(),
        socialBar: null,
        refreshIntervalSec: Math.max(45, Math.min(60, Number(refreshIntervalSec) || 50)),
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
        Paste the exact Adsterra snippets or direct URLs. The player now runs only two ads: Stream Link and One Click Popunder, alternating every 45–60 seconds.
      </p>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-white/80 block">One Click Popunder</label>
        <textarea
          value={popunder}
          onChange={(e) => setPopunder(e.target.value)}
          rows={3}
          className={inputClass + " w-full font-mono text-[11px] break-all"}
          placeholder='<script src="https://.../popunder.js"></script>'
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-white/80 block">Stream Link</label>
        <textarea
          value={streamLink}
          onChange={(e) => setStreamLink(e.target.value)}
          rows={3}
          className={inputClass + " w-full font-mono text-[11px] break-all"}
          placeholder='https://... or <script src="https://.../invoke.js"></script>'
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-white/80 block">
          Ad Refresh Interval (seconds)
        </label>
        <input
          type="number"
          min={45}
          max={60}
          value={refreshIntervalSec}
          onChange={(e) => setRefreshIntervalSec(Number(e.target.value))}
          className={inputClass + " w-full"}
          placeholder="50"
        />
        <p className="text-[10px] text-white/50 leading-relaxed">
          The runtime adds a small random jitter and keeps calls between <strong>45</strong> and <strong>60</strong> seconds.
        </p>
      </div>

      <button onClick={save} disabled={loading} className={btnPrimary + " w-full"}>
        {loading ? "Saving..." : "Save Adsterra Config"}
      </button>
    </div>
  );
};

export default AdsterraConfig;
