// =====================================================================
// APK Download Center — Admin Section
// Centralized place to manage both User-Panel and Admin-Panel APK
// download links + a built-in toggle that controls whether the User
// download button is visible inside the user app.
// Firebase paths used:
//   settings/branding/userApkUrl
//   settings/branding/adminApkUrl
//   settings/apk/userEnabled        (boolean — show on user profile?)
//   settings/apk/userVersion        (string — e.g. "v1.4.2")
//   settings/apk/adminVersion       (string)
//   settings/apk/notes              (string — admin-only release notes)
// =====================================================================
import { useEffect, useState } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
import { toast } from "sonner";
import { Download, Save, Smartphone, Shield, Power, Copy, ExternalLink } from "lucide-react";

interface Props {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
}

export default function ApkDownloadCenter({ glassCard, inputClass, btnPrimary }: Props) {
  const [userApkUrl, setUserApkUrl] = useState("");
  const [adminApkUrl, setAdminApkUrl] = useState("");
  const [userVersion, setUserVersion] = useState("");
  const [adminVersion, setAdminVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [userEnabled, setUserEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubs = [
      onValue(ref(db, "settings/branding/userApkUrl"), (s) => setUserApkUrl(String(s.val() || ""))),
      onValue(ref(db, "settings/branding/adminApkUrl"), (s) => setAdminApkUrl(String(s.val() || ""))),
      onValue(ref(db, "settings/apk/userVersion"), (s) => setUserVersion(String(s.val() || ""))),
      onValue(ref(db, "settings/apk/adminVersion"), (s) => setAdminVersion(String(s.val() || ""))),
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
        "settings/branding/userApkUrl": userApkUrl.trim(),
        "settings/branding/adminApkUrl": adminApkUrl.trim(),
        "settings/apk/userVersion": userVersion.trim(),
        "settings/apk/adminVersion": adminVersion.trim(),
        "settings/apk/notes": notes,
        "settings/apk/userEnabled": userEnabled,
      });
      toast.success("✅ APK settings saved");
    } catch (e: any) {
      toast.error(`Failed: ${e?.message || "unknown"}`);
    } finally {
      setSaving(false);
    }
  };

  const copy = (s: string) => {
    if (!s) { toast.error("Nothing to copy"); return; }
    navigator.clipboard.writeText(s);
    toast.success("Copied");
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
            <p className="text-[11px] text-muted-foreground">Manage User & Admin APK download links</p>
          </div>
        </div>
        <p className="text-[11px] text-zinc-400 leading-relaxed">
          User APK link will appear on the user Profile page. Admin APK link is only visible inside this admin panel.
          Use the toggle below to instantly hide the User download button without removing the URL.
        </p>
      </div>

      {/* Visibility toggle */}
      <div className={`${glassCard} p-4`}>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Power className="w-4 h-4 text-amber-400" /> User Panel Visibility
        </h3>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={userEnabled}
            onChange={(e) => setUserEnabled(e.target.checked)}
            className="w-4 h-4 mt-0.5"
          />
          <span className="text-sm">
            Show "Download App (APK)" button on the user Profile page
          </span>
        </label>
        <p className="text-[10px] text-zinc-500 mt-2">
          When OFF, the button is hidden even if the URL is configured.
        </p>
      </div>

      {/* User APK */}
      <div className={`${glassCard} p-4`}>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-blue-400" /> User Panel APK
        </h3>
        <label className="text-[10px] text-zinc-400 block mb-1">Download URL</label>
        <input
          value={userApkUrl}
          onChange={(e) => setUserApkUrl(e.target.value)}
          placeholder="https://example.com/rsanime-user.apk"
          className={inputClass}
        />
        <label className="text-[10px] text-zinc-400 block mt-3 mb-1">Version label (optional)</label>
        <input
          value={userVersion}
          onChange={(e) => setUserVersion(e.target.value)}
          placeholder="v1.0.0"
          className={inputClass}
        />
        {userApkUrl && (
          <div className="flex flex-wrap gap-2 mt-3">
            <a
              href={userApkUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
            >
              <Download size={12} /> Test Download
            </a>
            <button
              type="button"
              onClick={() => copy(userApkUrl)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-semibold"
            >
              <Copy size={12} /> Copy URL
            </button>
            <a
              href={userApkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-semibold"
            >
              <ExternalLink size={12} /> Open
            </a>
          </div>
        )}
      </div>

      {/* Admin APK */}
      <div className={`${glassCard} p-4`}>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" /> Admin Panel APK
        </h3>
        <label className="text-[10px] text-zinc-400 block mb-1">Download URL</label>
        <input
          value={adminApkUrl}
          onChange={(e) => setAdminApkUrl(e.target.value)}
          placeholder="https://example.com/rsanime-admin.apk"
          className={inputClass}
        />
        <label className="text-[10px] text-zinc-400 block mt-3 mb-1">Version label (optional)</label>
        <input
          value={adminVersion}
          onChange={(e) => setAdminVersion(e.target.value)}
          placeholder="v1.0.0"
          className={inputClass}
        />
        {adminApkUrl && (
          <div className="flex flex-wrap gap-2 mt-3">
            <a
              href={adminApkUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
            >
              <Download size={12} /> Download Admin APK
            </a>
            <button
              type="button"
              onClick={() => copy(adminApkUrl)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-semibold"
            >
              <Copy size={12} /> Copy URL
            </button>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className={`${glassCard} p-4`}>
        <h3 className="text-sm font-semibold mb-2">Internal Notes</h3>
        <p className="text-[10px] text-zinc-400 mb-2">
          Visible only to admins. Use this for build dates, changelog, or internal links.
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Built on 2026-04-26 — fixed login crash on Android 9"
          className={`${inputClass} min-h-[80px] resize-y`}
          rows={4}
        />
      </div>

      {/* Save */}
      <button
        onClick={saveAll}
        disabled={saving}
        className={`${btnPrimary} w-full !py-3 text-sm flex items-center justify-center gap-2`}
      >
        <Save size={14} /> {saving ? "Saving..." : "Save All"}
      </button>
    </div>
  );
}
