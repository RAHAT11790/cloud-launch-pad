import { useEffect, useState } from "react";
import { db, ref, onValue, set } from "@/lib/firebase";
import { toast } from "sonner";

interface Props {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
}

const MonetagConfig = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [enabled, setEnabled] = useState(true);
  const [popunderSrc, setPopunderSrc] = useState("");
  const [directLinkUrl, setDirectLinkUrl] = useState("");
  const [cooldown, setCooldown] = useState(60);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/monetag"), (snap) => {
      const v = snap.val() || {};
      setEnabled(v.enabled !== false);
      setPopunderSrc(v.popunderSrc || "");
      setDirectLinkUrl(v.directLinkUrl || "");
      setCooldown(Number(v.directCooldownSec) > 0 ? Number(v.directCooldownSec) : 60);
    });
    return () => unsub();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await set(ref(db, "settings/monetag"), {
        enabled,
        popunderSrc: popunderSrc.trim(),
        directLinkUrl: directLinkUrl.trim(),
        directCooldownSec: Math.max(5, Number(cooldown) || 60),
      });
      toast.success("Monetag config saved");
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={glassCard}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-white">Monetag Ads (Video Player Only)</h3>
          <label className="flex items-center gap-2 text-xs text-white/80">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
        </div>
        <p className="text-xs text-white/50 mb-3">
          Popunder loads <strong>once per session</strong> when the video player opens. Direct link fires on
          player tap with cooldown to mimic 9anime-style ad behavior.
        </p>

        <label className="block text-xs text-white/70 mb-1">Popunder script src (full URL)</label>
        <input
          className={inputClass}
          placeholder="https://3nbf4.com/abc/xyz.js"
          value={popunderSrc}
          onChange={(e) => setPopunderSrc(e.target.value)}
        />

        <label className="block text-xs text-white/70 mb-1 mt-3">Direct link URL</label>
        <input
          className={inputClass}
          placeholder="https://3nbf4.com/4/1234567"
          value={directLinkUrl}
          onChange={(e) => setDirectLinkUrl(e.target.value)}
        />

        <label className="block text-xs text-white/70 mb-1 mt-3">Direct link cooldown (seconds)</label>
        <input
          type="number"
          min={5}
          className={inputClass}
          value={cooldown}
          onChange={(e) => setCooldown(Number(e.target.value))}
        />

        <button onClick={save} disabled={saving} className={`${btnPrimary} mt-4`}>
          {saving ? "Saving..." : "Save Monetag Config"}
        </button>
      </div>

      <div className={glassCard}>
        <h4 className="text-sm font-bold text-white mb-2">Verification Service Worker</h4>
        <p className="text-xs text-white/60">
          Monetag SW is served at <code className="text-amber-300">/sw.js</code> (zone <code>10888250</code>,
          domain <code>3nbf4.com</code>). It auto-registers only on the published domain — preview iframes
          are skipped per Lovable rules. To verify in Monetag dashboard, point them to{" "}
          <code className="text-amber-300">https://rsanime03.lovable.app/sw.js</code>.
        </p>
      </div>
    </div>
  );
};

export default MonetagConfig;
