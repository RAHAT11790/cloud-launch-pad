import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Shield, Ban, Trash2, RefreshCw, CheckCircle2, XCircle, Lock, LogOut, AlertTriangle } from "lucide-react";
import {
  subscribeLogs,
  subscribeBlocks,
  addBlock,
  removeBlock,
  clearOldLogs,
  clearAllLogs,
  setGlobalAdminLogout,
  OWNER_EMAILS,
  isOwnerEmail,
  type AdminAccessLog,
  type BlockEntry,
} from "@/lib/securityGuard";


interface Props {
  glassCard: string;
  btnPrimary: string;
  btnSecondary: string;
  inputClass: string;
}

const fmtDate = (ts?: number) => {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
};

export default function SecurityCenter({ glassCard, btnPrimary, btnSecondary, inputClass }: Props) {
  const [logs, setLogs] = useState<Record<string, AdminAccessLog>>({});
  const [blocks, setBlocks] = useState<Record<string, BlockEntry>>({});
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"logs" | "blocked">("logs");

  useEffect(() => {
    const u1 = subscribeLogs(setLogs);
    const u2 = subscribeBlocks(setBlocks);
    return () => {
      u1?.();
      u2?.();
    };
  }, []);

  const sortedLogs = useMemo(() => {
    const arr = Object.entries(logs).map(([id, v]) => ({ id, ...v }));
    arr.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const f = filter.trim().toLowerCase();
    if (!f) return arr.slice(0, 500);
    return arr
      .filter(
        (l) =>
          (l.email || "").toLowerCase().includes(f) ||
          (l.ip || "").toLowerCase().includes(f) ||
          (l.country || "").toLowerCase().includes(f) ||
          (l.fingerprint || "").toLowerCase().includes(f)
      )
      .slice(0, 500);
  }, [logs, filter]);

  const sortedBlocks = useMemo(() => {
    return Object.entries(blocks)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => (b.blockedAt || 0) - (a.blockedAt || 0));
  }, [blocks]);

  const handleBlock = async (type: "email" | "ip" | "fingerprint", value: string, reason: string) => {
    if (!value) return;
    if (type === "email" && isOwnerEmail(value)) {
      toast.error("Cannot block the owner account.");
      return;
    }
    try {
      await addBlock({ type, value, reason });
      toast.success(`Blocked ${type}: ${value}`);
    } catch (e: any) {
      toast.error(e?.message || "Block failed");
    }
  };

  const handleUnblock = async (id: string) => {
    if (!confirm("Remove this block?")) return;
    try {
      await removeBlock(id);
      toast.success("Block removed");
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };

  const handleClearOld = async () => {
    if (!confirm("Delete login logs older than 30 days?")) return;
    try {
      const n = await clearOldLogs();
      if (n === 0) toast.info("No logs older than 30 days.");
      else toast.success(`Cleared ${n} old log entr${n === 1 ? "y" : "ies"}.`);
    } catch (e: any) {
      toast.error(e?.message || "Clear failed — check Firebase rules.");
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Delete ALL login logs? This cannot be undone.")) return;
    try {
      const n = await clearAllLogs();
      toast.success(`Cleared ${n} log entr${n === 1 ? "y" : "ies"}.`);
    } catch (e: any) {
      toast.error(e?.message || "Clear failed — check Firebase rules.");
    }
  };

  const handleLogoutAll = async () => {
    if (!confirm(
      "Force sign-out of the admin panel on EVERY device (including this one)?\n\n" +
      "You will need to re-enter the PIN and sign back in with Google after this."
    )) return;
    try {
      await setGlobalAdminLogout();
      toast.success("Sign-out broadcast to all admin devices.");
      // Give the local subscriber a moment to react, then hard-reload as a fallback.
      setTimeout(() => {
        try {
          localStorage.removeItem("rs_admin_session");
          localStorage.removeItem("rs_admin_google");
          localStorage.removeItem("rs_admin_google_name");
          sessionStorage.removeItem("rs_admin_pin");
        } catch {}
        window.location.reload();
      }, 1200);
    } catch (e: any) {
      toast.error(e?.message || "Failed to broadcast logout");
    }
  };


  const successCount = sortedLogs.filter((l) => l.success).length;
  const failCount = sortedLogs.filter((l) => !l.success).length;

  return (
    <div className="space-y-4">
      <div className={`${glassCard} p-4 sm:p-5`}>
        <div className="flex items-center gap-2 mb-2">
          <Shield size={18} className="text-emerald-400" />
          <h2 className="text-base font-semibold text-white">Security & Access</h2>
        </div>
        <p className="text-[12px] text-zinc-400 leading-relaxed">
          Every admin-panel login attempt (PIN or Google) is recorded with IP, country, device fingerprint and user-agent.
          Use the <b>Block</b> button next to any suspicious entry to permanently deny that email / IP / device. Owner
          accounts ({OWNER_EMAILS.join(", ")}) can never be blocked.
        </p>
      </div>

      {/* Master danger zone — logout every admin device globally */}
      <div className={`${glassCard} p-4 border-red-500/20 bg-red-500/[0.03]`}>
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white mb-1">Force Sign-Out — All Devices</h3>
            <p className="text-[11px] text-zinc-400 leading-relaxed mb-3">
              Instantly log the admin panel out on every device where an owner is currently signed in
              (including this one). Use this if a phone/laptop is lost or a session leak is suspected.
              Owners will need the PIN + Google login to return.
            </p>
            <button
              onClick={handleLogoutAll}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white flex items-center gap-1.5 transition-colors"
            >
              <LogOut size={13} /> Logout from all admin devices
            </button>
          </div>
        </div>
      </div>


      <div className={`${glassCard} p-3 flex flex-wrap gap-2 items-center`}>
        <button
          onClick={() => setTab("logs")}
          className={`${tab === "logs" ? btnPrimary : btnSecondary} px-3 py-1.5 text-xs`}
        >
          Login History ({sortedLogs.length})
        </button>
        <button
          onClick={() => setTab("blocked")}
          className={`${tab === "blocked" ? btnPrimary : btnSecondary} px-3 py-1.5 text-xs`}
        >
          Blocked ({sortedBlocks.length})
        </button>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-400">
          <span className="text-emerald-400 flex items-center gap-1">
            <CheckCircle2 size={12} /> {successCount}
          </span>
          <span className="text-red-400 flex items-center gap-1">
            <XCircle size={12} /> {failCount}
          </span>
        </div>
      </div>

      {tab === "logs" && (
        <div className={`${glassCard} p-3`}>
          <div className="flex gap-2 mb-3 flex-wrap">
            <input
              className={`${inputClass} flex-1 min-w-[180px] text-xs`}
              placeholder="Filter by email / IP / country / device…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button onClick={handleClearOld} className={`${btnSecondary} px-3 py-1.5 text-xs flex items-center gap-1`}>
              <Trash2 size={12} /> Clear 30d+
            </button>
            <button
              onClick={handleClearAll}
              className="px-3 py-1.5 rounded-lg text-xs bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 flex items-center gap-1"
            >
              <Trash2 size={12} /> Clear ALL
            </button>
          </div>


          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[11px] min-w-[700px]">
              <thead>
                <tr className="text-zinc-400 border-b border-white/10">
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Email</th>
                  <th className="text-left p-2">Method</th>
                  <th className="text-left p-2">IP / Country</th>
                  <th className="text-left p-2">Device</th>
                  <th className="text-left p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedLogs.map((l) => (
                  <tr key={l.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-2 text-zinc-300 whitespace-nowrap">{fmtDate(l.ts)}</td>
                    <td className="p-2">
                      {l.success ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 size={12} /> OK
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1">
                          <XCircle size={12} /> {l.reason || "fail"}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-zinc-200 break-all">
                      {l.email || "—"}
                      {isOwnerEmail(l.email) && (
                        <span className="ml-1 text-[10px] text-amber-400">[owner]</span>
                      )}
                    </td>
                    <td className="p-2 text-zinc-400 uppercase">{l.method}</td>
                    <td className="p-2 text-zinc-300 whitespace-nowrap">
                      {l.ip || "—"}
                      <div className="text-[10px] text-zinc-500">{l.country || ""}</div>
                    </td>
                    <td className="p-2 text-zinc-500 text-[10px] break-all max-w-[140px]">
                      {l.fingerprint || "—"}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col gap-1">
                        {l.email && !isOwnerEmail(l.email) && (
                          <button
                            onClick={() => handleBlock("email", l.email!, `From log @ ${fmtDate(l.ts)}`)}
                            className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 flex items-center gap-1"
                          >
                            <Ban size={10} /> Email
                          </button>
                        )}
                        {l.ip && (
                          <button
                            onClick={() => handleBlock("ip", l.ip!, `From log @ ${fmtDate(l.ts)}`)}
                            className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 flex items-center gap-1"
                          >
                            <Ban size={10} /> IP
                          </button>
                        )}
                        {l.fingerprint && (
                          <button
                            onClick={() => handleBlock("fingerprint", l.fingerprint!, `From log @ ${fmtDate(l.ts)}`)}
                            className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 flex items-center gap-1"
                          >
                            <Ban size={10} /> Device
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {sortedLogs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-zinc-500">
                      No login attempts recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "blocked" && (
        <div className={`${glassCard} p-3`}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[11px] min-w-[600px]">
              <thead>
                <tr className="text-zinc-400 border-b border-white/10">
                  <th className="text-left p-2">Blocked At</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Value</th>
                  <th className="text-left p-2">Reason</th>
                  <th className="text-left p-2">By</th>
                  <th className="text-left p-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedBlocks.map((b) => (
                  <tr key={b.id} className="border-b border-white/5">
                    <td className="p-2 text-zinc-300 whitespace-nowrap">{fmtDate(b.blockedAt)}</td>
                    <td className="p-2 uppercase text-amber-300">{b.type}</td>
                    <td className="p-2 text-zinc-200 break-all">{b.value}</td>
                    <td className="p-2 text-zinc-400">{b.reason || "—"}</td>
                    <td className="p-2 text-zinc-500">{b.blockedBy || "—"}</td>
                    <td className="p-2">
                      <button
                        onClick={() => handleUnblock(b.id)}
                        className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 flex items-center gap-1"
                      >
                        <RefreshCw size={10} /> Unblock
                      </button>
                    </td>
                  </tr>
                ))}
                {sortedBlocks.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-zinc-500 flex flex-col items-center gap-2">
                      <Lock size={18} />
                      No accounts blocked.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
