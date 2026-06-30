import { useEffect, useState } from "react";
import { db, ref, get, remove } from "@/lib/firebase";
import { toast } from "sonner";
import { Trash2, RefreshCw, Loader2, ShieldCheck, AlertTriangle, Database } from "lucide-react";

// Whitelist of root keys actively used by the app. Anything not in this list
// is considered orphan/legacy and can be safely deleted from Firebase RTDB.
const ACTIVE_ROOTS = new Set<string>([
  "admin",
  "analytics",
  "appUsers",
  "animesaltSelected",
  "activePrizeLink",
  "bkashPayments",
  "bkashSettings",
  "categories",
  "comments",
  "egdManager",
  "fcmTokens",
  "freeAccessUsers",
  "globalFreeAccess",
  "liveTvCategories",
  "liveTvChannels",
  "maintenance",
  "miniApp",
  "movies",
  "newEpisodeReleases",
  "notifications",
  "otpCodes",
  "passwordResets",
  "prizePool",
  "redeemCodes",
  "settings",
  "supportChats",
  "telegramPerAnimeButtons",
  "telegramPosts",
  "unlockTokens",
  "users",
  "webseries",
  "weeklyPending",
  "weeklySchedule",
  "adminContentIndex",
  "animesaltSelected",
  "XNXANIKPAY",
]);

// Estimate size of a JSON object (entries count at top level)
const countEntries = (val: any): number => {
  if (val === null || val === undefined) return 0;
  if (typeof val !== "object") return 1;
  return Object.keys(val).length;
};

const byteSize = (val: any): number => {
  try { return JSON.stringify(val).length; } catch { return 0; }
};

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

interface RootEntry {
  key: string;
  entries: number;
  bytes: number;
  active: boolean;
}

export default function FirebaseCleanupSection({
  glassCard, btnPrimary, btnSecondary,
}: { glassCard: string; btnPrimary: string; btnSecondary: string }) {
  const [loading, setLoading] = useState(false);
  const [roots, setRoots] = useState<RootEntry[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tokenStats, setTokenStats] = useState<{ total: number; expired: number } | null>(null);

  const scan = async () => {
    setLoading(true);
    try {
      const snap = await get(ref(db, "/"));
      const root = snap.val() || {};
      const list: RootEntry[] = Object.entries(root).map(([key, val]) => ({
        key,
        entries: countEntries(val),
        bytes: byteSize(val),
        active: ACTIVE_ROOTS.has(key),
      }));
      list.sort((a, b) => Number(a.active) - Number(b.active) || b.bytes - a.bytes);
      setRoots(list);

      // Token stats
      const tokens = root.unlockTokens || {};
      const now = Date.now();
      let expired = 0;
      Object.values<any>(tokens).forEach((t) => {
        const exp = Number(t?.expiresAt || 0);
        const isPrize = t?.mode === "prize" && t?.unlimited;
        if (isPrize) return;
        if (exp > 0 && exp < now) expired++;
        else if (t?.consumed) expired++;
      });
      setTokenStats({ total: Object.keys(tokens).length, expired });
    } catch (e: any) {
      toast.error("Scan failed: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { scan(); }, []);

  const deleteRoot = async (key: string) => {
    if (ACTIVE_ROOTS.has(key)) {
      if (!confirm(`⚠️ "${key}" সক্রিয় ফাংশনে ব্যবহার হচ্ছে! তবুও ডিলিট করবে?`)) return;
    } else {
      if (!confirm(`"${key}" পুরোপুরি ডিলিট হবে। নিশ্চিত?`)) return;
    }
    setBusyKey(key);
    try {
      await remove(ref(db, key));
      toast.success(`✅ ${key} ডিলিট হয়েছে`);
      setRoots((r) => r.filter((x) => x.key !== key));
    } catch (e: any) {
      toast.error("Delete failed: " + (e?.message || e));
    } finally {
      setBusyKey(null);
    }
  };

  const cleanupExpiredTokens = async () => {
    if (!confirm("সব expired/consumed unlock tokens ডিলিট করব?")) return;
    setBusyKey("__tokens__");
    try {
      const snap = await get(ref(db, "unlockTokens"));
      const tokens = snap.val() || {};
      const now = Date.now();
      const toDelete: string[] = [];
      Object.entries<any>(tokens).forEach(([k, t]) => {
        const isPrize = t?.mode === "prize" && t?.unlimited;
        if (isPrize) return;
        const exp = Number(t?.expiresAt || 0);
        if ((exp > 0 && exp < now) || t?.consumed) toDelete.push(k);
      });
      await Promise.all(toDelete.map((k) => remove(ref(db, `unlockTokens/${k}`))));
      toast.success(`🧹 ${toDelete.length} টি token ডিলিট`);
      scan();
    } catch (e: any) {
      toast.error("Cleanup failed: " + (e?.message || e));
    } finally {
      setBusyKey(null);
    }
  };

  const deleteAllOrphans = async () => {
    const orphans = roots.filter((r) => !r.active);
    if (orphans.length === 0) return toast.info("কোনো orphan key নেই");
    if (!confirm(`${orphans.length} টি orphan key ডিলিট হবে:\n\n${orphans.map((o) => o.key).join(", ")}\n\nনিশ্চিত?`)) return;
    setBusyKey("__orphans__");
    try {
      await Promise.all(orphans.map((o) => remove(ref(db, o.key))));
      toast.success(`✅ ${orphans.length} টি orphan ডিলিট`);
      scan();
    } catch (e: any) {
      toast.error("Failed: " + (e?.message || e));
    } finally {
      setBusyKey(null);
    }
  };

  const purgeLegacyAn = async () => {
    if (!confirm("পুরনো AN (AnimeSalt) Firebase data সব ডিলিট হবে — webseries/movies/newEpisodeReleases থেকে AN tagged entries + animesaltCache root। নিশ্চিত?")) return;
    setBusyKey("__legacy_an__");
    try {
      const isAn = (v: any) =>
        !!v?.anSlug || !!v?.animeSaltSlug || v?.sourceName === "AnimeSalt" ||
        v?.source === "animesalt" || v?.displayAs === "an";
      let deleted = 0;
      for (const root of ["webseries", "movies", "newEpisodeReleases"]) {
        const snap = await get(ref(db, root));
        const val = snap.val() || {};
        const keys = Object.entries<any>(val).filter(([k, v]) => isAn(v) || k.startsWith("an_") || k.startsWith("an_mv_"));
        await Promise.all(keys.map(([k]) => remove(ref(db, `${root}/${k}`))));
        deleted += keys.length;
      }
      // Nuke legacy AN cache roots entirely
      for (const root of ["animesaltCache", "anSeries", "anMovies", "animesalt"]) {
        try { await remove(ref(db, root)); } catch {}
      }
      toast.success(`🧹 ${deleted} টি legacy AN entry ডিলিট + cache roots cleared`);
      scan();
    } catch (e: any) {
      toast.error("Purge failed: " + (e?.message || e));
    } finally {
      setBusyKey(null);
    }
  };


  const orphans = roots.filter((r) => !r.active);
  const totalBytes = roots.reduce((s, r) => s + r.bytes, 0);
  const orphanBytes = orphans.reduce((s, r) => s + r.bytes, 0);

  return (
    <div className={`${glassCard} space-y-4`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Database size={18} className="text-cyan-400" />
            Firebase Cleanup
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            পুরনো ও অপ্রয়োজনীয় ডাটা স্ক্যান ও ডিলিট করো
          </p>
        </div>
        <button onClick={scan} className={`${btnSecondary} text-xs`} disabled={loading}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Rescan
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-zinc-800/50 rounded-lg p-2.5">
          <p className="text-[10px] text-zinc-400">Total Roots</p>
          <p className="text-lg font-bold text-white">{roots.length}</p>
          <p className="text-[10px] text-zinc-500">{formatBytes(totalBytes)}</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">
          <p className="text-[10px] text-red-300">Orphans</p>
          <p className="text-lg font-bold text-red-400">{orphans.length}</p>
          <p className="text-[10px] text-red-300/70">{formatBytes(orphanBytes)}</p>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">
          <p className="text-[10px] text-amber-300">Expired Tokens</p>
          <p className="text-lg font-bold text-amber-400">{tokenStats?.expired ?? "-"}</p>
          <p className="text-[10px] text-amber-300/70">of {tokenStats?.total ?? 0}</p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={cleanupExpiredTokens}
          disabled={busyKey === "__tokens__" || !tokenStats?.expired}
          className={`${btnPrimary} text-xs flex items-center gap-1.5`}
          style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)" }}>
          {busyKey === "__tokens__" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          Clean Expired Tokens ({tokenStats?.expired ?? 0})
        </button>
        <button
          onClick={deleteAllOrphans}
          disabled={busyKey === "__orphans__" || orphans.length === 0}
          className={`${btnPrimary} text-xs flex items-center gap-1.5`}
          style={{ background: "linear-gradient(135deg, #ef4444, #b91c1c)" }}>
          {busyKey === "__orphans__" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          Delete All Orphans ({orphans.length})
        </button>
        <button
          onClick={purgeLegacyAn}
          disabled={busyKey === "__legacy_an__"}
          className={`${btnPrimary} text-xs flex items-center gap-1.5`}
          style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }}>
          {busyKey === "__legacy_an__" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          Purge Legacy AN Data
        </button>

      </div>

      {/* Root keys list */}
      <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
        {roots.map((r) => (
          <div
            key={r.key}
            className={`flex items-center gap-2 p-2.5 rounded-lg border ${
              r.active
                ? "bg-emerald-500/5 border-emerald-500/20"
                : "bg-red-500/5 border-red-500/30"
            }`}>
            {r.active ? (
              <ShieldCheck size={14} className="text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-white truncate">{r.key}</p>
              <p className="text-[10px] text-zinc-400">
                {r.entries} entries • {formatBytes(r.bytes)}
              </p>
            </div>
            {!r.active && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-semibold">
                ORPHAN
              </span>
            )}
            <button
              onClick={() => deleteRoot(r.key)}
              disabled={busyKey === r.key}
              className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/40 text-red-300 text-[10px] flex items-center gap-1 disabled:opacity-50">
              {busyKey === r.key ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
