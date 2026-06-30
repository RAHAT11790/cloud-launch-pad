import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { db, ref, remove, get } from "@/lib/firebase";
import { firebaseRestGet, firebaseRestShallowKeys } from "@/lib/firebaseRest";
import { toast } from "sonner";
import {
  ChevronRight, ChevronDown, Trash2, Loader2, RefreshCw, Database,
  Search, Copy, FileJson, FolderTree,
} from "lucide-react";
import FirebaseCleanupSection from "./FirebaseCleanup";

/* ============================================================
   Firebase Analyzer
   - Top:    Cleanup + orphan/expired-token tools (reused)
   - Bottom: Lazy-loaded tree browser (Firebase-console style)
              * Expand any path on demand via shallow REST
              * Inspect leaf values as JSON
              * Delete any node with confirm
   - Fully memoized rows, no global subscription => zero lag.
   ============================================================ */

type NodeKind = "branch" | "leaf" | "unknown";

interface TreeRowProps {
  path: string;       // full Firebase path, e.g. "users/abc"
  name: string;       // segment label
  depth: number;
  onDeleted: (path: string) => void;
}

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

const previewValue = (v: any): string => {
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 80) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { const s = JSON.stringify(v); return s.length > 80 ? s.slice(0, 80) + "…" : s; }
  catch { return String(v); }
};

const TreeRow = memo(function TreeRow({ path, name, depth, onDeleted }: TreeRowProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [children, setChildren] = useState<string[] | null>(null);
  const [leaf, setLeaf] = useState<any>(undefined);
  const [kind, setKind] = useState<NodeKind>("unknown");
  const [filter, setFilter] = useState("");
  const [visible, setVisible] = useState(200);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Shallow: object => keys, primitive => returns the value itself
      const data: any = await firebaseRestGet(path, { shallow: true });
      if (data && typeof data === "object") {
        const keys = Object.keys(data).sort();
        setChildren(keys);
        setKind("branch");
      } else if (data === null || data === undefined) {
        setChildren([]);
        setKind("branch");
      } else {
        setLeaf(data);
        setKind("leaf");
      }
    } catch (e: any) {
      toast.error("Load failed: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  const toggle = async () => {
    if (!open && children === null && kind !== "leaf") await load();
    setOpen((v) => !v);
  };

  const fetchLeafFull = useCallback(async () => {
    setLoading(true);
    try {
      const data = await firebaseRestGet<any>(path);
      setLeaf(data);
    } catch (e: any) { toast.error("Fetch failed: " + (e?.message || e)); }
    finally { setLoading(false); }
  }, [path]);

  const handleDelete = async () => {
    if (!confirm(`Delete "${path}"?\n\nThis cannot be undone.`)) return;
    setBusy(true);
    try {
      await remove(ref(db, path));
      toast.success("Deleted " + path);
      onDeleted(path);
    } catch (e: any) {
      toast.error("Delete failed: " + (e?.message || e));
    } finally { setBusy(false); }
  };

  const removeChild = (childPath: string) => {
    const childName = childPath.slice(path.length + 1);
    setChildren((arr) => (arr ? arr.filter((k) => k !== childName) : arr));
  };

  const filtered = useMemo(() => {
    if (!children) return [];
    if (!filter.trim()) return children;
    const q = filter.toLowerCase();
    return children.filter((k) => k.toLowerCase().includes(q));
  }, [children, filter]);

  const indent = { paddingLeft: `${depth * 14}px` };

  return (
    <div className="select-none">
      <div
        style={indent}
        className="group flex items-center gap-1.5 py-1.5 px-2 rounded-md hover:bg-zinc-800/60 transition-colors"
      >
        <button
          onClick={toggle}
          className="flex items-center gap-1 flex-1 min-w-0 text-left"
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin text-cyan-400 flex-shrink-0" />
          ) : kind === "leaf" ? (
            <FileJson size={12} className="text-amber-400 flex-shrink-0" />
          ) : open ? (
            <ChevronDown size={12} className="text-zinc-400 flex-shrink-0" />
          ) : (
            <ChevronRight size={12} className="text-zinc-500 flex-shrink-0" />
          )}
          <span className="font-mono text-xs text-white truncate">{name}</span>
          {kind === "branch" && children && (
            <span className="text-[10px] text-zinc-500 flex-shrink-0">
              ({children.length})
            </span>
          )}
          {kind === "leaf" && leaf !== undefined && (
            <span className="text-[10px] text-zinc-400 truncate ml-1">
              = {previewValue(leaf)}
            </span>
          )}
        </button>
        <button
          onClick={handleDelete}
          disabled={busy}
          title={`Delete ${path}`}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/20 text-red-400 disabled:opacity-40"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
        </button>
      </div>

      {open && kind === "branch" && children && children.length > 0 && (
        <>
          {children.length > 12 && (
            <div style={{ paddingLeft: `${(depth + 1) * 14}px` }} className="px-2 py-1">
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={filter}
                  onChange={(e) => { setFilter(e.target.value); setVisible(200); }}
                  placeholder={`Filter ${children.length} keys…`}
                  className="w-full pl-6 pr-2 py-1 rounded bg-zinc-900/80 border border-zinc-700 text-[11px] text-white outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}
          {filtered.slice(0, visible).map((childName) => (
            <TreeRow
              key={childName}
              path={`${path}/${childName}`}
              name={childName}
              depth={depth + 1}
              onDeleted={removeChild}
            />
          ))}
          {filtered.length > visible && (
            <div style={{ paddingLeft: `${(depth + 1) * 14}px` }} className="px-2 py-1">
              <button
                onClick={() => setVisible((v) => v + 200)}
                className="text-[10px] text-cyan-400 hover:text-cyan-300"
              >
                Show {Math.min(200, filtered.length - visible)} more
                ({filtered.length - visible} hidden)
              </button>
            </div>
          )}
        </>
      )}

      {open && kind === "leaf" && (
        <div style={{ paddingLeft: `${(depth + 1) * 14}px` }} className="px-2 pb-2">
          <div className="flex gap-1.5 mb-1">
            <button
              onClick={fetchLeafFull}
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1"
            >
              <RefreshCw size={9} /> Reload
            </button>
            <button
              onClick={() => {
                try { navigator.clipboard.writeText(JSON.stringify(leaf, null, 2)); toast.success("Copied"); }
                catch { toast.error("Copy failed"); }
              }}
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1"
            >
              <Copy size={9} /> Copy JSON
            </button>
          </div>
          <pre className="text-[10px] font-mono text-emerald-300 bg-zinc-950/80 border border-zinc-800 rounded p-2 max-h-60 overflow-auto whitespace-pre-wrap break-all">
            {(() => { try { return JSON.stringify(leaf, null, 2); } catch { return String(leaf); } })()}
          </pre>
        </div>
      )}

      {open && kind === "branch" && children && children.length === 0 && (
        <div style={{ paddingLeft: `${(depth + 1) * 14}px` }} className="px-2 py-1 text-[10px] text-zinc-500 italic">
          (empty)
        </div>
      )}
    </div>
  );
});

/* =================== Root browser =================== */
const RootBrowser = memo(function RootBrowser() {
  const [rootKeys, setRootKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const keys = await firebaseRestShallowKeys("");
      setRootKeys(keys.sort());
    } catch (e: any) {
      toast.error("Root load failed: " + (e?.message || e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return rootKeys;
    const q = filter.toLowerCase();
    return rootKeys.filter((k) => k.toLowerCase().includes(q));
  }, [rootKeys, filter]);

  const removeRoot = useCallback((path: string) => {
    const name = path.split("/")[0];
    setRootKeys((arr) => arr.filter((k) => k !== name));
  }, []);

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-white text-sm font-semibold">
          <FolderTree size={15} className="text-cyan-400" />
          Database Browser
          <span className="text-[10px] text-zinc-500 font-normal">
            ({rootKeys.length} roots)
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1 disabled:opacity-50"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Refresh
        </button>
      </div>

      <div className="relative mb-2">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter root paths…"
          className="w-full pl-7 pr-2 py-1.5 rounded-md bg-zinc-950/80 border border-zinc-700 text-xs text-white outline-none focus:border-cyan-500"
        />
      </div>

      <div className="max-h-[70vh] overflow-y-auto rounded-md bg-zinc-950/40 border border-zinc-800/80 p-1">
        {loading && rootKeys.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-zinc-500 text-xs gap-2">
            <Loader2 size={12} className="animate-spin" /> Loading database tree…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-xs text-zinc-500 py-6">No paths</div>
        ) : (
          filtered.map((k) => (
            <TreeRow key={k} path={k} name={k} depth={0} onDeleted={removeRoot} />
          ))
        )}
      </div>

      <p className="mt-2 text-[10px] text-zinc-500">
        Tip: Click any node to expand. Hover a row to reveal the delete button.
        Leaf values load on demand — zero data is fetched up-front.
      </p>
    </div>
  );
});

/* =================== Public component =================== */
export default function FirebaseAnalyzer({
  glassCard, btnPrimary, btnSecondary,
}: { glassCard: string; btnPrimary: string; btnSecondary: string }) {
  return (
    <div className="space-y-4">
      <div className={`${glassCard}`}>
        <div className="flex items-center gap-2 mb-1">
          <Database size={18} className="text-cyan-400" />
          <h2 className="text-lg font-bold text-white">Firebase Analyzer</h2>
        </div>
        <p className="text-xs text-zinc-400">
          Inspect, audit, and clean the entire Realtime Database. Lazy-loaded
          for zero lag — nothing is fetched until you expand a path.
        </p>
      </div>

      <FirebaseCleanupSection
        glassCard={glassCard}
        btnPrimary={btnPrimary}
        btnSecondary={btnSecondary}
      />

      <RootBrowser />
    </div>
  );
}
