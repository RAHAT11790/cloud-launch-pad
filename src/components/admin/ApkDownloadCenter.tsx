// =====================================================================
// APK Download Center — Admin Section (button-first, real PWA install)
// Goals:
//  • One big "Download Admin Panel APK" button that triggers Chrome's
//    native install prompt (beforeinstallprompt) — not a redirect.
//  • One ON/OFF switch that controls whether the user-side download
//    button is visible on the user Profile page.
// Firebase paths used:
//   settings/apk/userEnabled        (boolean — show on user profile?)
//   settings/apk/notes              (string — admin-only release notes)
// =====================================================================
import { useEffect, useState } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
import { toast } from "sonner";
import { Download, Save, Shield, Power, CheckCircle2 } from "lucide-react";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { Switch } from "@/components/ui/switch";

interface Props {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
}

export default function ApkDownloadCenter({ glassCard, inputClass, btnPrimary }: Props) {
  const [notes, setNotes] = useState("");
  const [userEnabled, setUserEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const { canInstall, isStandalone, promptInstall } = usePwaInstall({
    appName: "Admin Panel",
    installPath: "/admin",
  });

  useEffect(() => {
    const unsubs = [
      onValue(ref(db, "settings/apk/notes"), (s) => setNotes(String(s.val() || ""))),
      onValue(ref(db, "settings/apk/userEnabled"), (s) => {
        const v = s.val();
        setUserEnabled(v === undefined || v === null ? true : !!v);
      }),
    ];
    return () => { unsubs.forEach((u) => u()); };
  }, []);

  const saveNotes = async () => {
    setSaving(true);
    try {
      await update(ref(db), { "settings/apk/notes": notes });
      toast.success("Saved");
    } catch (e: any) {
      toast.error(`Failed: ${e?.message || "unknown"}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleUser = async (next: boolean) => {
    setUserEnabled(next);
    try {
      await update(ref(db), { "settings/apk/userEnabled": next });
      toast.success(next ? "User download button ON" : "User download button OFF");
    } catch (e: any) {
      toast.error(`Failed: ${e?.message || "unknown"}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className={`${glassCard} p-4`}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shrink-0">
            <Download className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold leading-tight">APK Download Center</h2>
            <p className="text-[11px] text-muted-foreground">Install buttons for Admin & User panels</p>
          </div>
        </div>
        <p className="text-[11px] text-zinc-400 leading-relaxed">
          Tap the Admin button below to install the admin app on your phone. Use the toggle to show or
          hide the user-side install button on the user Profile page.
        </p>
      </div>

      {/* User panel ON/OFF */}
      <div className={`${glassCard} p-4`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <Power className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold leading-tight">User Panel Download Button</h3>
              <p className="text-[10px] text-zinc-500 leading-tight mt-0.5">
                Show "Download App" on user Profile
              </p>
            </div>
          </div>
          <Switch
            checked={userEnabled}
            onCheckedChange={toggleUser}
            aria-label="Toggle user panel download button"
            className="shrink-0"
          />
        </div>
      </div>

      {/* Admin install button */}
      <div className={`${glassCard} p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold">Admin Panel APK</h3>
        </div>

        {isStandalone ? (
          <div className="flex items-center gap-2 px-3 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            <span>Admin panel is already installed on this device.</span>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed">
              Tap the button below to install the Admin panel as an app on your phone.
              {!canInstall && (
                <span className="block mt-1 text-amber-400/90">
                  Tip: open this page in Chrome (not Telegram in-app browser) for the install prompt.
                </span>
              )}
            </p>
            <button
              onClick={promptInstall}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-sm font-semibold shadow-lg active:scale-[0.98] transition"
            >
              <Download className="w-4 h-4" /> Download Admin Panel APK
            </button>
          </>
        )}
      </div>

      {/* Notes */}
      <div className={`${glassCard} p-4`}>
        <h3 className="text-sm font-semibold mb-2">Internal Notes</h3>
        <p className="text-[10px] text-zinc-400 mb-2">
          Visible only to admins. Use this for build dates or internal changelog.
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Build 2026-04-26 — fixed login crash on Android 9"
          className={`${inputClass} min-h-[80px] resize-y`}
          rows={4}
        />
        <button
          onClick={saveNotes}
          disabled={saving}
          className={`${btnPrimary} w-full !py-3 text-sm flex items-center justify-center gap-2 mt-3`}
        >
          <Save size={14} /> {saving ? "Saving..." : "Save Notes"}
        </button>
      </div>
    </div>
  );
}
