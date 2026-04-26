// =====================================================================
// APK Download Center — Admin Section (button-first)
// Goals:
//  • One big "Download Admin Panel APK" action button (admin install).
//  • One ON/OFF switch that controls whether the user-side download
//    button is visible on the user Profile page.
//  • Internal-only notes for the admin.
// Firebase paths used:
//   settings/apk/userEnabled        (boolean — show on user profile?)
//   settings/apk/notes              (string — admin-only release notes)
// Note: actual install targets are produced by the route-based install
// metadata (ManifestManager). The buttons just open the right panel so
// the OS / browser offers the matching "Add to Home screen" / install
// prompt for that panel.
// =====================================================================
import { useEffect, useState } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
import { toast } from "sonner";
import { Download, Save, Smartphone, Shield, Power } from "lucide-react";

interface Props {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
}

const ADMIN_INSTALL_PATH = "/admin?install=1";
const USER_INSTALL_PATH = "/?install=1";

export default function ApkDownloadCenter({ glassCard, inputClass, btnPrimary }: Props) {
  const [notes, setNotes] = useState("");
  const [userEnabled, setUserEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const saveAll = async () => {
    setSaving(true);
    try {
      await update(ref(db), {
        "settings/apk/notes": notes,
        "settings/apk/userEnabled": userEnabled,
      });
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

  const openAdminInstall = () => {
    // Opens the admin panel route — the route-based manifest will offer the
    // "Install Admin Panel" / "Add to Home screen" prompt in Chrome.
    window.open(ADMIN_INSTALL_PATH, "_blank", "noopener,noreferrer");
  };

  const openUserInstall = () => {
    window.open(USER_INSTALL_PATH, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className={`${glassCard} p-4`}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
            <Download className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold">APK Download Center</h2>
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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Power className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-tight">User Panel Download Button</h3>
              <p className="text-[10px] text-zinc-500 leading-tight">
                Show "Download App" button on the user Profile page
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggleUser(!userEnabled)}
            className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${
              userEnabled ? "bg-emerald-500" : "bg-zinc-600"
            }`}
            aria-pressed={userEnabled}
          >
            <span
              className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${
                userEnabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {userEnabled && (
          <button
            onClick={openUserInstall}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
          >
            <Smartphone className="w-4 h-4" /> Preview User Install
          </button>
        )}
      </div>

      {/* Admin install button */}
      <div className={`${glassCard} p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold">Admin Panel APK</h3>
        </div>
        <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed">
          Tap the button below to install the Admin panel on your phone. In Chrome you'll see the
          "Install app" / "Add to Home screen" prompt automatically.
        </p>
        <button
          onClick={openAdminInstall}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-sm font-semibold shadow-lg"
        >
          <Download className="w-4 h-4" /> Download Admin Panel APK
        </button>
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
          onClick={saveAll}
          disabled={saving}
          className={`${btnPrimary} w-full !py-3 text-sm flex items-center justify-center gap-2 mt-3`}
        >
          <Save size={14} /> {saving ? "Saving..." : "Save Notes"}
        </button>
      </div>
    </div>
  );
}
