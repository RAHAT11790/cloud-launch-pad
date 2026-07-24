import { memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { auth, db, get, ref } from "@/lib/firebase";
import { firebaseRestClearCache, firebaseRestDelete, firebaseRestGet, firebaseRestShallowKeys } from "@/lib/firebaseRest";

import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Download,
  FileJson,
  FolderTree,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

type NodeKind = "branch" | "leaf" | "empty" | "unknown";

const ACTIVE_ROOTS = new Set([
  "admin", "adminContentIndex", "analytics", "animesaltSelected", "appUsers", "activePrizeLink",
  "bkashPayments", "bkashSettings", "categories", "comments", "egdManager", "fcmTokens",
  "freeAccessUsers", "globalFreeAccess", "liveTvCategories", "liveTvChannels", "maintenance",
  "miniApp", "movies", "newEpisodeReleases", "notifications", "otpCodes", "passwordResets",
  "prizePool", "redeemCodes", "settings", "supportChats", "telegramPerAnimeButtons",
  "telegramPosts", "unlockTokens", "users", "webseries", "weeklyPending", "weeklySchedule",
  "XNXANIKPAY",
]);

const PAGE_SIZE = 120;

const sortKeys = (keys: string[]) => [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const previewValue = (value: unknown) => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.length > 96 ? `${value.slice(0, 96)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 96 ? `${text.slice(0, 96)}...` : text;
  } catch {
    return String(value);
  }
};

const buildDirectDatabaseDownloadUrl = async (fileName: string, path = "") => {
  const base = String(db.app.options.databaseURL || "").replace(/\/+$/, "");
  if (!base) throw new Error("Firebase databaseURL is missing");
  const encodedPath = String(path || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const url = new URL(`${base}/${encodedPath ? `${encodedPath}` : ""}.json`);
  url.searchParams.set("download", fileName);
  try {
    const token = await auth.currentUser?.getIdToken(false);
    if (token) url.searchParams.set("auth", token);
  } catch {}
  return url.toString();
};

const triggerDirectDownload = (url: string) => {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

const firebaseBackupName = () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `rs-anime-firebase-full-backup-${stamp}.json`;
};

interface TreeRowProps {
  path: string;
  name: string;
  depth: number;
  onDeleted: (path: string) => void;
}

const TreeRow = memo(function TreeRow({ path, name, depth, onDeleted }: TreeRowProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [kind, setKind] = useState<NodeKind>("unknown");
  const [children, setChildren] = useState<string[] | null>(null);
  const [value, setValue] = useState<unknown>(undefined);
  const [filter, setFilter] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const loadMeta = useCallback(async () => {
    setLoading(true);
    try {
      const data = await firebaseRestGet<any>(path, { shallow: true });
      if (data && typeof data === "object") {
        setChildren(sortKeys(Object.keys(data)));
        setKind("branch");
      } else if (data === null || data === undefined) {
        setChildren([]);
        setKind("empty");
      } else {
        setValue(data);
        setKind("leaf");
      }
    } catch (error: any) {
      toast.error(`Load failed: ${error?.message || error}`);
    } finally {
      setLoading(false);
    }
  }, [path]);

  const loadFullValue = useCallback(async () => {
    setLoading(true);
    try {
      setValue(await firebaseRestGet(path));
      setKind("leaf");
    } catch (error: any) {
      toast.error(`Value load failed: ${error?.message || error}`);
    } finally {
      setLoading(false);
    }
  }, [path]);

  const toggle = useCallback(async () => {
    if (!open && kind === "unknown") await loadMeta();
    setOpen((current) => !current);
  }, [kind, loadMeta, open]);

  const deleteNode = useCallback(async () => {
    if (!confirm(`Delete this database path?\n\n${path}\n\nThis cannot be undone.`)) return;
    setDeleting(true);
    try {
      await firebaseRestDelete(path);
      setKind("empty");
      setChildren([]);
      setValue(null);
      onDeleted(path);
      toast.success(`Deleted ${path}`);
    } catch (error: any) {
      toast.error(`Delete failed: ${error?.message || error}`);
    } finally {
      setDeleting(false);
    }
  }, [onDeleted, path]);

  const removeChild = useCallback((childPath: string) => {
    const childName = childPath.slice(path.length + 1).split("/")[0];
    setChildren((current) => (current ? current.filter((key) => key !== childName) : current));
  }, [path]);

  const filteredChildren = useMemo(() => {
    if (!children) return [];
    const query = filter.trim().toLowerCase();
    if (!query) return children;
    return children.filter((child) => child.toLowerCase().includes(query));
  }, [children, filter]);

  const icon = loading ? (
    <Loader2 size={13} className="animate-spin text-cyan-400" />
  ) : open && kind === "branch" ? (
    <ChevronDown size={13} className="text-cyan-300" />
  ) : kind === "leaf" ? (
    <FileJson size={13} className="text-amber-300" />
  ) : kind === "empty" ? (
    <FileJson size={13} className="text-zinc-500" />
  ) : (
    <ChevronRight size={13} className="text-zinc-400" />
  );

  return (
    <div className="select-none">
      <div
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:border-cyan-500/20 hover:bg-cyan-500/5"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <button onClick={toggle} className="flex min-w-0 items-center gap-2 text-left" type="button">
          <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-md bg-zinc-900/80">{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[12px] font-semibold text-zinc-100">{name}</span>
            <span className="block truncate text-[10px] text-zinc-500">
              {kind === "branch" ? `${children?.length || 0} child paths` : kind === "leaf" ? previewValue(value) : kind === "empty" ? "empty" : path}
            </span>
          </span>
        </button>
        <button
          onClick={deleteNode}
          disabled={deleting}
          className="grid h-8 w-8 place-items-center rounded-lg bg-red-500/10 text-red-300 transition-colors hover:bg-red-500/25 disabled:opacity-50"
          title={`Delete ${path}`}
          type="button"
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      </div>

      {open && kind === "branch" && children && (
        <div className="mt-1 space-y-1">
          {children.length > 18 && (
            <div className="pr-2" style={{ paddingLeft: `${24 + (depth + 1) * 16}px` }}>
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={filter}
                  onChange={(event) => { setFilter(event.target.value); setVisible(PAGE_SIZE); }}
                  placeholder={`Search ${children.length} keys`}
                  className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 pl-7 pr-2 text-[12px] text-zinc-100 outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}
          {filteredChildren.slice(0, visible).map((child) => (
            <TreeRow key={child} path={`${path}/${child}`} name={child} depth={depth + 1} onDeleted={removeChild} />
          ))}
          {filteredChildren.length > visible && (
            <div className="py-1 pr-2" style={{ paddingLeft: `${24 + (depth + 1) * 16}px` }}>
              <button
                onClick={() => setVisible((count) => count + PAGE_SIZE)}
                className="h-8 rounded-lg bg-zinc-800 px-3 text-[12px] font-semibold text-cyan-300 hover:bg-zinc-700"
                type="button"
              >
                Show next {Math.min(PAGE_SIZE, filteredChildren.length - visible)}
              </button>
            </div>
          )}
          {children.length === 0 && (
            <div className="py-1 pr-2 text-[11px] text-zinc-500" style={{ paddingLeft: `${24 + (depth + 1) * 16}px` }}>
              Empty path
            </div>
          )}
        </div>
      )}

      {open && kind === "leaf" && (
        <div className="py-2 pr-2" style={{ paddingLeft: `${24 + (depth + 1) * 16}px` }}>
          <div className="mb-2 flex flex-wrap gap-2">
            <button onClick={loadFullValue} className="inline-flex h-8 items-center gap-1 rounded-lg bg-zinc-800 px-2.5 text-[11px] text-zinc-200 hover:bg-zinc-700" type="button">
              <RefreshCw size={11} /> Reload
            </button>
            <button
              onClick={() => {
                try {
                  navigator.clipboard.writeText(JSON.stringify(value, null, 2));
                  toast.success("JSON copied");
                } catch {
                  toast.error("Copy failed");
                }
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-zinc-800 px-2.5 text-[11px] text-zinc-200 hover:bg-zinc-700"
              type="button"
            >
              <Copy size={11} /> Copy
            </button>
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-emerald-300 whitespace-pre-wrap break-words">
            {(() => { try { return JSON.stringify(value, null, 2); } catch { return String(value); } })()}
          </pre>
        </div>
      )}
    </div>
  );
});

function FirebaseAnalyticsActions({
  rootKeys,
  setRootKeys,
  btnSecondary,
}: {
  rootKeys: string[];
  setRootKeys: Dispatch<SetStateAction<string[]>>;
  btnSecondary: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const orphanKeys = useMemo(() => rootKeys.filter((key) => !ACTIVE_ROOTS.has(key)), [rootKeys]);

  const deleteExpiredTokens = useCallback(async () => {
    if (!confirm("Delete expired and consumed unlock tokens?")) return;
    setBusy("tokens");
    try {
      const snap = await get(ref(db, "unlockTokens"));
      const tokens = snap.val() || {};
      const now = Date.now();
      const expired = Object.entries<any>(tokens).filter(([, token]) => {
        if (token?.mode === "prize" && token?.unlimited) return false;
        const expiresAt = Number(token?.expiresAt || 0);
        return token?.consumed || (expiresAt > 0 && expiresAt < now);
      });
      await Promise.all(expired.map(([key]) => firebaseRestDelete(`unlockTokens/${key}`)));
      firebaseRestClearCache("unlockTokens");
      toast.success(`Deleted ${expired.length} expired tokens`);
    } catch (error: any) {
      toast.error(`Token cleanup failed: ${error?.message || error}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const deleteOrphanRoots = useCallback(async () => {
    if (orphanKeys.length === 0) return toast.info("No orphan roots found");
    if (!confirm(`Delete ${orphanKeys.length} orphan root paths?\n\n${orphanKeys.join(", ")}`)) return;
    setBusy("orphans");
    try {
      await Promise.all(orphanKeys.map((key) => firebaseRestDelete(key)));
      firebaseRestClearCache("");
      setRootKeys((keys) => keys.filter((key) => !orphanKeys.includes(key)));
      toast.success(`Deleted ${orphanKeys.length} orphan roots`);
    } catch (error: any) {
      toast.error(`Orphan delete failed: ${error?.message || error}`);
    } finally {
      setBusy(null);
    }
  }, [orphanKeys, setRootKeys]);



  const buttons = [
    { key: "tokens", label: "Expired Tokens", count: null as number | null, icon: <Trash2 size={13} />, action: deleteExpiredTokens },
    { key: "orphans", label: "Orphan Roots", count: orphanKeys.length, icon: <AlertTriangle size={13} />, action: deleteOrphanRoots },
  ];

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {buttons.map((button) => (
          <button
            key={button.key}
            onClick={button.action}
            disabled={busy !== null || (button.key === "orphans" && button.count === 0)}
            className={`${btnSecondary} flex min-h-[46px] items-center justify-between gap-2 px-3 py-2 text-left text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}
            type="button"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              {busy === button.key ? <Loader2 size={13} className="animate-spin" /> : button.icon}
              <span className="truncate font-semibold">{button.label}</span>
            </span>
            {button.count !== null && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-zinc-300">{button.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}


const RootBrowser = memo(function RootBrowser({ btnSecondary }: { btnSecondary: string }) {
  const [rootKeys, setRootKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filter, setFilter] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadRoots = useCallback(async () => {
    setLoading(true);
    try {
      const keys = sortKeys(await firebaseRestShallowKeys(""));
      if (mountedRef.current) setRootKeys(keys);
    } catch (error: any) {
      toast.error(`Database load failed: ${error?.message || error}`);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { loadRoots(); }, [loadRoots]);

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return rootKeys;
    return rootKeys.filter((key) => key.toLowerCase().includes(query));
  }, [filter, rootKeys]);

  const removeRoot = useCallback((path: string) => {
    const rootName = path.split("/")[0];
    setRootKeys((keys) => keys.filter((key) => key !== rootName));
  }, []);

  const downloadFullDatabase = useCallback(async () => {
    if (!confirm("Download the full Firebase Realtime Database as one JSON file?\n\nThis will use Firebase's direct REST download so the website does not load the whole database into memory.")) return;
    setExporting(true);
    try {
      const downloadUrl = await buildDirectDatabaseDownloadUrl(firebaseBackupName());
      triggerDirectDownload(downloadUrl);
      toast.success("Full Firebase JSON download started");
    } catch (error: any) {
      toast.error(`Full JSON download failed: ${error?.message || error}`);
    } finally {
      if (mountedRef.current) setExporting(false);
    }
  }, []);

  const activeCount = useMemo(() => rootKeys.filter((key) => ACTIVE_ROOTS.has(key)).length, [rootKeys]);
  const orphanCount = rootKeys.length - activeCount;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200">Root Paths</p>
          <p className="mt-1 text-xl font-black text-white">{rootKeys.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200">Active</p>
          <p className="mt-1 text-xl font-black text-white">{activeCount}</p>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-red-200">Orphan</p>
          <p className="mt-1 text-xl font-black text-white">{orphanCount}</p>
        </div>
      </div>

      <FirebaseAnalyticsActions rootKeys={rootKeys} setRootKeys={setRootKeys} btnSecondary={btnSecondary} />

      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60">
        <div className="flex flex-col gap-2 border-b border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <FolderTree size={16} className="flex-shrink-0 text-cyan-300" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-white">Database Tree</h3>
              <p className="truncate text-[11px] text-zinc-500">Expand a path to load only that branch.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadFullDatabase} disabled={exporting} className={`${btnSecondary} inline-flex h-9 items-center gap-2 px-3 text-[12px]`} type="button">
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              Full JSON
            </button>
            <button onClick={loadRoots} disabled={loading} className={`${btnSecondary} inline-flex h-9 items-center gap-2 px-3 text-[12px]`} type="button">
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Refresh
            </button>
          </div>
        </div>

        <div className="border-b border-zinc-800 p-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={filter}
              onChange={(event) => { setFilter(event.target.value); setVisible(PAGE_SIZE); }}
              placeholder="Search root paths"
              className="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/80 pl-9 pr-3 text-[13px] text-zinc-100 outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="max-h-[68vh] overflow-y-auto p-2">
          {loading && rootKeys.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400">
              <Loader2 size={16} className="animate-spin" /> Loading database...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-500">No database paths found</div>
          ) : (
            filtered.slice(0, visible).map((key) => <TreeRow key={key} path={key} name={key} depth={0} onDeleted={removeRoot} />)
          )}
          {filtered.length > visible && (
            <div className="p-2 text-center">
              <button onClick={() => setVisible((count) => count + PAGE_SIZE)} className="h-9 rounded-lg bg-zinc-800 px-4 text-[12px] font-semibold text-cyan-300 hover:bg-zinc-700" type="button">
                Show next {Math.min(PAGE_SIZE, filtered.length - visible)} paths
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default function FirebaseAnalyzer({
  glassCard,
  btnSecondary,
}: {
  glassCard: string;
  btnPrimary: string;
  btnSecondary: string;
}) {
  return (
    <div className="space-y-4">
      <div className={`${glassCard} p-4`}> 
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-cyan-500/10 text-cyan-300">
            <Database size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black text-white">Firebase Analytics</h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">
              Full database browser with lazy loading, path inspection, copy, and delete controls.
            </p>
          </div>
        </div>
      </div>

      <RootBrowser btnSecondary={btnSecondary} />
    </div>
  );
}
