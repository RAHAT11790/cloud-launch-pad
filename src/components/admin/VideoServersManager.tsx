import { useEffect, useRef, useState } from "react";
import { db, ref, onValue, set } from "@/lib/firebase";
import { toast } from "sonner";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Lock,
  Unlock,
  Plus,
  Edit,
  Save,
  X,
} from "lucide-react";

type Server = { name: string; domain: string; proxy?: string; locked?: boolean };

interface Props {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
}

// Module-level cache — the same "warm start" pattern used elsewhere in
// the admin panel. Re-opening this section paints the list instantly
// from cache while the fresh Firebase snapshot arrives in the background.
let videoServersCache: Server[] = [];

const VideoServersManager = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [servers, setServers] = useState<Server[]>(() => videoServersCache);
  const [loading, setLoading] = useState(videoServersCache.length === 0);
  const [newName, setNewName] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newProxy, setNewProxy] = useState("");

  // Edit state
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDomain, setEditDomain] = useState("");
  const [editProxy, setEditProxy] = useState("");

  // Track whether user is mid-edit / mid-typing so Firebase snapshots
  // don't yank the panel out from under them (this is what caused the
  // "panel keeps refreshing every time I type" complaint).
  const isBusy = editIdx !== null || newName.length > 0 || newDomain.length > 0 || newProxy.length > 0;
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;
  const pendingSnapRef = useRef<Server[] | null>(null);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/videoServers"), (snap) => {
      const val = snap.val();
      let next: Server[] = [];
      if (val && Array.isArray(val)) {
        next = val.filter((s: any) => s && s.domain);
      } else if (val && typeof val === "object") {
        next = Object.values(val).filter((s: any) => s && s.domain) as Server[];
      }
      videoServersCache = next;
      // If the admin is currently editing or typing, park the snapshot
      // and apply it once they finish — never mid-typing.
      if (isBusyRef.current) {
        pendingSnapRef.current = next;
      } else {
        setServers(next);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Flush any parked snapshot as soon as the admin stops editing / typing.
  useEffect(() => {
    if (!isBusy && pendingSnapRef.current) {
      setServers(pendingSnapRef.current);
      pendingSnapRef.current = null;
    }
  }, [isBusy]);

  const saveServers = async (updated: Server[]) => {
    await set(ref(db, "settings/videoServers"), updated);
    toast.success("✅ Server list saved!");
  };

  const addServer = () => {
    if (!newDomain.trim()) {
      toast.error("Enter domain!");
      return;
    }
    const updated = [
      ...servers,
      {
        name: newName.trim() || `Server ${servers.length + 1}`,
        domain: newDomain.trim(),
        proxy: newProxy.trim(),
        locked: false,
      },
    ];
    saveServers(updated);
    setNewName("");
    setNewDomain("");
    setNewProxy("");
  };

  const toggleLocked = (idx: number) => {
    const updated = [...servers];
    updated[idx] = { ...updated[idx], locked: !updated[idx].locked };
    saveServers(updated);
  };

  const removeServer = (idx: number) => {
    if (!confirm(`Delete "${servers[idx]?.name}"?`)) return;
    const updated = servers.filter((_, i) => i !== idx);
    saveServers(updated);
    if (editIdx === idx) cancelEdit();
  };

  const moveServer = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= servers.length) return;
    const updated = [...servers];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    saveServers(updated);
  };

  const startEdit = (idx: number) => {
    const srv = servers[idx];
    if (!srv) return;
    setEditIdx(idx);
    setEditName(srv.name || "");
    setEditDomain(srv.domain || "");
    setEditProxy(srv.proxy || "");
  };

  const cancelEdit = () => {
    setEditIdx(null);
    setEditName("");
    setEditDomain("");
    setEditProxy("");
  };

  const saveEdit = () => {
    if (editIdx === null) return;
    const domain = editDomain.trim();
    if (!domain) {
      toast.error("Domain cannot be empty!");
      return;
    }
    const updated = [...servers];
    updated[editIdx] = {
      ...updated[editIdx],
      name: editName.trim() || `Server ${editIdx + 1}`,
      domain,
      proxy: editProxy.trim(),
    };
    saveServers(updated);
    cancelEdit();
  };

  return (
    <div>
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Activity size={14} className="text-cyan-400" /> Video Server Manager
        </h3>
        <p className="text-[11px] text-zinc-400 mb-4">
          Add at least 2 servers to show the server-switch button in the player. Only the domain
          changes; file paths remain the same.
        </p>

        {loading ? (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : servers.length === 0 ? (
          <p className="text-zinc-500 text-[11px] text-center py-4 mb-4">
            No servers yet. Add one below.
          </p>
        ) : (
          <div className="space-y-2 mb-4">
            {servers.map((srv, idx) => {
              const isEditing = editIdx === idx;
              return (
                <div
                  key={idx}
                  className="p-2.5 bg-zinc-800/40 rounded-xl border border-zinc-700/30"
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-[11px] font-bold text-cyan-300">
                            S{idx + 1}
                          </span>
                        </div>
                        <span className="text-[11px] font-semibold text-cyan-300">
                          Editing Server {idx + 1}
                        </span>
                      </div>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className={inputClass}
                        placeholder="Server name"
                      />
                      <input
                        value={editDomain}
                        onChange={(e) => setEditDomain(e.target.value)}
                        className={inputClass}
                        placeholder="https://example.com"
                      />
                      <input
                        value={editProxy}
                        onChange={(e) => setEditProxy(e.target.value)}
                        className={inputClass}
                        placeholder="Proxy URL for this server (only for http:// servers)"
                      />
                      <p className="text-[10px] text-zinc-500 -mt-1">
                        Leave empty for HTTPS servers. This server will play ONLY through this proxy.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveEdit}
                          className={`${btnPrimary} flex-1 py-2 text-[12px] font-semibold flex items-center justify-center gap-1.5`}
                        >
                          <Save size={13} /> Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="flex-1 py-2 text-[12px] font-semibold rounded-lg bg-zinc-700/60 hover:bg-zinc-700 text-white flex items-center justify-center gap-1.5"
                        >
                          <X size={13} /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-[11px] font-bold text-cyan-300">
                          S{idx + 1}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] font-medium block truncate flex items-center gap-1">
                          {srv.name}
                          {srv.locked && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded-md font-bold">
                              PREMIUM
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-zinc-500 block truncate">
                          {srv.domain}
                        </span>
                        <span className={`text-[9.5px] block truncate ${srv.proxy ? "text-emerald-400" : "text-zinc-600"}`}>
                          {srv.proxy ? `proxy: ${srv.proxy}` : "proxy: direct (none)"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEdit(idx)}
                          title="Edit"
                          className="text-cyan-400 hover:text-cyan-300 p-1"
                        >
                          <Edit size={13} />
                        </button>
                        <button
                          onClick={() => toggleLocked(idx)}
                          title={srv.locked ? "Unlock (make free)" : "Lock (premium only)"}
                          className={`p-1 rounded ${
                            srv.locked
                              ? "text-amber-400 hover:text-amber-300"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          {srv.locked ? <Lock size={13} /> : <Unlock size={13} />}
                        </button>
                        <button
                          onClick={() => moveServer(idx, -1)}
                          disabled={idx === 0}
                          className="text-zinc-400 hover:text-white p-1 disabled:opacity-30"
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <button
                          onClick={() => moveServer(idx, 1)}
                          disabled={idx === servers.length - 1}
                          className="text-zinc-400 hover:text-white p-1 disabled:opacity-30"
                        >
                          <ChevronRight size={12} />
                        </button>
                        <button
                          onClick={() => removeServer(idx)}
                          className="text-red-400 hover:text-red-300 p-1"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="border border-dashed border-zinc-700 rounded-xl p-3 space-y-2">
          <p className="text-[11px] text-zinc-400 font-medium">➕ Add new server</p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={inputClass}
            placeholder="Server name (e.g. Server 1)"
          />
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            className={inputClass}
            placeholder="https://example.com"
          />
          <input
            value={newProxy}
            onChange={(e) => setNewProxy(e.target.value)}
            className={inputClass}
            placeholder="Proxy URL for this server (http:// servers only)"
          />
          <p className="text-[10px] text-zinc-500">
            HTTP server → paste its own proxy URL here. HTTPS server → leave empty.
          </p>
          <button
            onClick={addServer}
            className={`${btnPrimary} w-full py-2.5 text-[12px] font-semibold flex items-center justify-center gap-2`}
          >
            <Plus size={14} /> Add Server
          </button>
        </div>
      </div>

      <div className={`${glassCard} p-4`}>
        <h4 className="text-xs font-semibold mb-2 text-zinc-300">📖 How it works</h4>
        <ul className="text-[11px] text-zinc-400 space-y-1.5 list-disc list-inside">
          <li>Each server has its OWN proxy — no shared global proxy anymore</li>
          <li>HTTP servers must have a proxy; HTTPS servers play direct (leave proxy empty)</li>
          <li>With at least 2 servers, the player shows a "Server" switch button</li>
          <li>Switching a server only changes the domain — channel/file ID stays the same</li>
          <li>
            Example: <code className="text-cyan-400">https://s1.example.com</code>/8866/file.mkv →{" "}
            <code className="text-cyan-400">https://s2.example.com</code>/8866/file.mkv
          </li>
        </ul>
      </div>
    </div>
  );
};

export default VideoServersManager;
