import { useEffect, useState } from "react";
import { db, ref, onValue, set, update } from "@/lib/firebase";
import { toast } from "sonner";
import { DEFAULT_GATE_CONFIG, type AccessGateConfig } from "@/lib/accessGate";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; }

const AccessGateConfigCard = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [v, setV] = useState<AccessGateConfig>(DEFAULT_GATE_CONFIG);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const u = onValue(ref(db, "settings/accessGate"), (snap) => {
      const d = snap.val() || {};
      setV({
        enabled: !!d.enabled,
        directLink: d.directLink || "",
        nativeBanner: d.nativeBanner || "",
        banner160x300: d.banner160x300 || "",
        popunder: d.popunder || "",
        socialBar: d.socialBar || "",
        clicksRequired: Number(d.clicksRequired) || 5,
        dwellSeconds: Number(d.dwellSeconds) || 10,
        accessHours: Number(d.accessHours) || 6,
      });
    });
    return () => u();
  }, []);

  const toggle = async (next: boolean) => {
    setV((s) => ({ ...s, enabled: next }));
    try { await update(ref(db, "settings/accessGate"), { enabled: next }); toast.success(next ? "Access Gate enabled" : "Disabled"); }
    catch { toast.error("Failed"); }
  };

  const save = async () => {
    setLoading(true);
    try {
      await set(ref(db, "settings/accessGate"), {
        ...v,
        clicksRequired: Math.max(1, Math.min(50, Number(v.clicksRequired) || 5)),
        dwellSeconds: Math.max(1, Math.min(120, Number(v.dwellSeconds) || 10)),
        accessHours: Math.max(0.1, Math.min(168, Number(v.accessHours) || 6)),
      });
      toast.success("Saved");
    } catch { toast.error("Save failed"); }
    setLoading(false);
  };

  const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-white/80 block">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-white/50 leading-relaxed">{hint}</p>}
    </div>
  );

  const taClass = inputClass + " w-full font-mono text-[10.5px] leading-snug whitespace-pre-wrap break-words resize-y";

  return (
    <div className={glassCard + " p-4 sm:p-5 space-y-4 overflow-hidden"}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-white">Access Gate (Master Trap)</h3>
          <p className="text-[11px] text-white/60 mt-1 leading-relaxed break-words">
            Shows a single ad gate page before video playback. All 5 Adsterra ad slots load at once.
            Once the user completes N direct-link views, they get H hours of fully ad-free access.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-white/80 flex-shrink-0">
          <input type="checkbox" checked={v.enabled} onChange={(e) => toggle(e.target.checked)} />
          {v.enabled ? "Enabled" : "Disabled"}
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Clicks Required" hint="How many ad views to unlock">
          <input type="number" min={1} max={50} value={v.clicksRequired}
            onChange={(e) => setV({ ...v, clicksRequired: Number(e.target.value) })}
            className={inputClass + " w-full min-w-0"} />
        </Field>
        <Field label="Dwell (seconds)" hint="Min seconds on ad tab per count">
          <input type="number" min={1} max={120} value={v.dwellSeconds}
            onChange={(e) => setV({ ...v, dwellSeconds: Number(e.target.value) })}
            className={inputClass + " w-full min-w-0"} />
        </Field>
        <Field label="Access Hours" hint="Hours of ad-free access">
          <input type="number" min={0.1} step={0.1} max={168} value={v.accessHours}
            onChange={(e) => setV({ ...v, accessHours: Number(e.target.value) })}
            className={inputClass + " w-full min-w-0"} />
        </Field>
      </div>

      <Field label="Direct Link (Smartlink URL)" hint="Adsterra Smartlink URL — opened in a new tab when user taps Continue">
        <input type="url" value={v.directLink}
          onChange={(e) => setV({ ...v, directLink: e.target.value })}
          className={inputClass + " w-full min-w-0 font-mono text-[11px]"}
          placeholder="https://www.effectivecpmnetwork.com/zmcs077s5n?key=..." />
      </Field>

      <Field label="Native Banner Script" hint="Full <script>…</script> snippet from Adsterra Native Banner">
        <textarea value={v.nativeBanner} rows={3}
          onChange={(e) => setV({ ...v, nativeBanner: e.target.value })}
          className={taClass}
          placeholder='<script async data-cfasync="false" src="..."></script><div id="container-..."></div>' />
      </Field>

      <Field label="Banner 160x300 Script" hint="Full atOptions + invoke.js snippet">
        <textarea value={v.banner160x300} rows={4}
          onChange={(e) => setV({ ...v, banner160x300: e.target.value })}
          className={taClass}
          placeholder='<script>atOptions={...}</script><script src="//www.highperformanceformat.com/.../invoke.js"></script>' />
      </Field>

      <Field label="Social Bar Script" hint="Adsterra Social Bar — sticks itself to the bottom">
        <textarea value={v.socialBar} rows={2}
          onChange={(e) => setV({ ...v, socialBar: e.target.value })}
          className={taClass} />
      </Field>

      <Field label="Popunder Script" hint="Adsterra Popunder — fires on user click">
        <textarea value={v.popunder} rows={2}
          onChange={(e) => setV({ ...v, popunder: e.target.value })}
          className={taClass} />
      </Field>

      <button onClick={save} disabled={loading} className={btnPrimary + " w-full"}>
        {loading ? "Saving..." : "Save Access Gate Config"}
      </button>
    </div>
  );
};

export default AccessGateConfigCard;
