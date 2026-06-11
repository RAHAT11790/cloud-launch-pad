import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue, set, update } from "@/lib/firebase";
import { toast } from "sonner";
import { SUPABASE_URL } from "@/lib/siteConfig";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; }

const AdsterraConfig = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [enabled, setEnabled] = useState(true);
  const [popunder, setPopunder] = useState("");
  const [socialBar, setSocialBar] = useState("");
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(60);
  const [loading, setLoading] = useState(false);
  const [dailyStats, setDailyStats] = useState<any>(null);
  const exitFunctionUrl = useMemo(() => SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ad-capture` : "", []);

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

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const un = onValue(ref(db, `adsterraStats/${today}`), (snap) => {
      setDailyStats(snap.val() || null);
    });
    return () => un();
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
        Paste the exact <code className="text-white/80">&lt;script src="..."&gt;</code> snippets from your Adsterra dashboard. Both scripts are now injected directly into the page (no iframe). When an ad fires (window.open), the click is captured through Supabase — on a successful capture response the cooldown below starts and the ad script is removed from the DOM. After the cooldown elapses the script is automatically re-injected.
      </p>


      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-white/80 block">Exit Function URL</label>
        <input
          readOnly
          value={exitFunctionUrl}
          className={inputClass + " w-full font-mono text-[11px]"}
        />
        <p className="text-[10px] text-white/50 leading-relaxed">
          Use this exit function URL for testing and status monitoring. Script URLs still come from the admin inputs below.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-white/80 block">Direct Link Script</label>
        <textarea
          value={popunder}
          onChange={(e) => setPopunder(e.target.value)}
          rows={3}
          className={inputClass + " w-full font-mono text-[11px] break-all"}
          placeholder='<script src="https://pl29545318.effectivecpmnetwork.com/.../invoke.js"></script>'
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-white/80 block">Push Notification Script</label>
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
          Cooldown (seconds)
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
          After an ad fires (popunder opens / user taps × on the push bar) no new ad can load for this many seconds. Set <strong>0</strong> to let ads re-arm immediately after every fire.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold text-white">Today Status</h4>
          <span className="text-[10px] text-white/55">Live daily counters</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-white/5 p-2 text-white/80">
            <div className="text-white/50">Popunder</div>
            <div>Clicks: {dailyStats?.popunder?.clicks || 0}</div>
            <div>Loads: {dailyStats?.popunder?.loads || 0}</div>
            <div>Accepted: {dailyStats?.popunder?.accepted || 0}</div>
            <div>Rejected: {dailyStats?.popunder?.rejected || 0}</div>
          </div>
          <div className="rounded-lg bg-white/5 p-2 text-white/80">
            <div className="text-white/50">Notification</div>
            <div>Clicks: {dailyStats?.social?.clicks || 0}</div>
            <div>Loads: {dailyStats?.social?.loads || 0}</div>
            <div>Accepted: {dailyStats?.social?.accepted || 0}</div>
            <div>Rejected: {dailyStats?.social?.rejected || 0}</div>
          </div>
        </div>
      </div>

      <button onClick={save} disabled={loading} className={btnPrimary + " w-full"}>
        {loading ? "Saving..." : "Save Adsterra Config"}
      </button>
    </div>
  );
};

export default AdsterraConfig;
