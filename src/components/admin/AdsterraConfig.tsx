import { useEffect, useState } from "react";
import { db, ref, onValue, set, update } from "@/lib/firebase";
import { toast } from "sonner";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; }

const AdsterraConfig = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [enabled, setEnabled] = useState(true);
  const [popunder, setPopunder] = useState("");
  const [socialBar, setSocialBar] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const u = onValue(ref(db, "settings/adsterra"), (snap) => {
      const v = snap.val() || {};
      setEnabled(v.enabled !== false);
      setPopunder(v.popunder || "");
      setSocialBar(v.socialBar || "");
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
      await set(ref(db, "settings/adsterra"), { enabled, popunder: popunder.trim(), socialBar: socialBar.trim() });
      toast.success("Adsterra config saved");
    } catch { toast.error("Save failed"); }
    setLoading(false);
  };

  return (
    <div className={glassCard + " space-y-4"}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-white">Adsterra Ads</h3>
        <label className="inline-flex items-center gap-2 text-xs text-white/80">
          <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
          {enabled ? "Enabled" : "Disabled"}
        </label>
      </div>
      <p className="text-xs text-white/60">
        Paste the exact <code>&lt;script&gt;</code> snippet from your Adsterra dashboard. Premium users never see ads.
        Anti-bypass guard auto-blocks AdBlock / VPN / custom DNS users with a warning overlay.
      </p>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-white/80">Popunder Script</label>
        <textarea
          value={popunder}
          onChange={(e) => setPopunder(e.target.value)}
          rows={3}
          className={inputClass + " font-mono text-[11px]"}
          placeholder='<script src="https://pl29545318.effectivecpmnetwork.com/.../invoke.js"></script>'
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-white/80">Social Bar Script</label>
        <textarea
          value={socialBar}
          onChange={(e) => setSocialBar(e.target.value)}
          rows={3}
          className={inputClass + " font-mono text-[11px]"}
          placeholder='<script src="https://pl29545319.effectivecpmnetwork.com/.../invoke.js"></script>'
        />
      </div>

      <button onClick={save} disabled={loading} className={btnPrimary}>
        {loading ? "Saving..." : "Save Adsterra Config"}
      </button>
    </div>
  );
};

export default AdsterraConfig;
