// =====================================================================
// APK Download Center — Admin Section (URL-based)
// Admin enters APK URLs for User panel and Admin panel separately.
// A single ON/OFF switch controls whether the user-side download button
// is visible on the user Profile page.
//
// Firebase paths:
//   settings/apk/userUrl        (string — user APK download URL)
//   settings/apk/adminUrl       (string — admin APK download URL)
//   settings/apk/userEnabled    (boolean — show user-side button?)
//   settings/apk/notes          (string — admin-only release notes)
// =====================================================================
import { useEffect, useState } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
import { toast } from "sonner";
import { Download, Save, Shield, Power, Smartphone, Link as LinkIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { triggerApkDownload } from "@/lib/apkDownload";

interface Props {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
}

export default function ApkDownloadCenter({ glassCard, inputClass, btnPrimary }: Props) {
  const [userUrl, setUserUrl] = useState("");
  const [adminUrl, setAdminUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [userEnabled, setUserEnabled] = useState(true);
  const [savingUser, setSavingUser] = useState(false);
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    const unsubs = [
      onValue(ref(db, "settings/apk/userUrl"), (s) => setUserUrl(String(s.val() || ""))),
      onValue(ref(db, "settings/apk/adminUrl"), (s) => setAdminUrl(String(s.val() || ""))),
      onValue(ref(db, "settings/apk/notes"), (s) => setNotes(String(s.val() || ""))),
      onValue(ref(db, "settings/apk/userEnabled"), (s) => {
        const v = s.val();
        setUserEnabled(v === undefined || v === null ? true : !!v);
      }),
    ];
    return () => { unsubs.forEach((u) => u()); };
  }, []);

  const saveField = async (path: string, value: string, setter: (b: boolean) => void, label: string) => {
    setter(true);
    try {
      await update(ref(db), { [path]: value });
      toast.success(`${label} saved`);
    } catch (e: any) {
      toast.error(`Failed: ${e?.message || "unknown"}`);
    } finally {
      setter(false);
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

  const openUrl = (url: string) => {
    const u = (url || "").trim();
    if (!u) { toast.error("URL is empty"); return; }
    const ok = triggerApkDownload(u);
    if (!ok) toast.error("Download could not be started");
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
            <p className="text-[11px] text-muted-foreground">Set APK URLs for User & Admin panels</p>
          </div>
        </div>
        <p className="text-[11px] text-zinc-400 leading-relaxed">
          Paste the direct APK download links below. Use the toggle to show or hide the
          download button on the user Profile page.
        </p>
      </div>

      {/* User panel ON/OFF */}
      <div className={`${glassCard} p-4`}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Power className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold leading-tight">User Panel Download Button</h3>
              <p className="text-[10px] text-zinc-500 leading-tight mt-0.5">
                Show "Download App" on user Profile page
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 justify-self-end shrink-0">
            <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap">
              {userEnabled ? "ON" : "OFF"}
            </span>
            <Switch
              checked={userEnabled}
              onCheckedChange={toggleUser}
              aria-label="Toggle user panel download button"
              className="shrink-0"
            />
          </div>
        </div>
      </div>

      {/* User APK URL */}
      <div className={`${glassCard} p-4`}>
        <div className="flex items-center gap-2 mb-2">
          <Smartphone className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">User Panel APK URL</h3>
        </div>
        <p className="text-[10px] text-zinc-500 mb-2">
          Direct .apk download link shown to users on Profile page.
        </p>
        <div className="flex items-center gap-2 mb-2">
          <LinkIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <input
            type="url"
            value={userUrl}
            onChange={(e) => setUserUrl(e.target.value)}
            placeholder="https://example.com/user-app.apk"
            className={`${inputClass} flex-1 min-w-0`}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => saveField("settings/apk/userUrl", userUrl.trim(), setSavingUser, "User URL")}
            disabled={savingUser}
            className={`${btnPrimary} !py-2.5 text-xs flex items-center justify-center gap-2`}
          >
            <Save size={13} /> {savingUser ? "Saving…" : "Save URL"}
          </button>
          <button
            onClick={() => openUrl(userUrl)}
            className="py-2.5 text-xs rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold flex items-center justify-center gap-2"
          >
            <Download size={13} /> Test Download
          </button>
        </div>
      </div>

      {/* Admin APK URL */}
      <div className={`${glassCard} p-4`}>
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold">Admin Panel APK URL</h3>
        </div>
        <p className="text-[10px] text-zinc-500 mb-2">
          Direct .apk download link for the admin app. Tap the button to download.
        </p>
        <div className="flex items-center gap-2 mb-2">
          <LinkIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <input
            type="url"
            value={adminUrl}
            onChange={(e) => setAdminUrl(e.target.value)}
            placeholder="https://example.com/admin-app.apk"
            className={`${inputClass} flex-1 min-w-0`}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            onClick={() => saveField("settings/apk/adminUrl", adminUrl.trim(), setSavingAdmin, "Admin URL")}
            disabled={savingAdmin}
            className={`${btnPrimary} !py-2.5 text-xs flex items-center justify-center gap-2`}
          >
            <Save size={13} /> {savingAdmin ? "Saving…" : "Save URL"}
          </button>
          <button
            onClick={() => openUrl(adminUrl)}
            className="py-2.5 text-xs rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center justify-center gap-2"
          >
            <Download size={13} /> Test Download
          </button>
        </div>
        <button
          onClick={() => openUrl(adminUrl)}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-sm font-semibold shadow-lg active:scale-[0.98] transition"
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
          onClick={() => saveField("settings/apk/notes", notes, setSavingNotes, "Notes")}
          disabled={savingNotes}
          className={`${btnPrimary} w-full !py-3 text-sm flex items-center justify-center gap-2 mt-3`}
        >
          <Save size={14} /> {savingNotes ? "Saving..." : "Save Notes"}
        </button>
      </div>
    </div>
  );
}
