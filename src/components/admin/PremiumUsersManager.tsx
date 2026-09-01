// ============================================================
// RS Anime — Premium Users Manager (Admin)
// One page for: premium list, manual grant/extend/revoke, device slots,
// and Email / Device-ID bans.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue, set, remove, query, limitToLast } from "@/lib/firebase";
import { banUser, unbanUser, listBans } from "@/lib/banGuard";
import { toast } from "sonner";
import {
  Crown, Search, Ban, ShieldCheck, Trash2, Clock, Smartphone, Loader2, RefreshCw, Plus,
} from "lucide-react";

type Row = {
  id: string;
  name: string;
  email: string;
  photo?: string;
  banned?: boolean;
  premium?: { active?: boolean; expiresAt?: number; source?: string };
};

const DAY = 86_400_000;

const fmt = (ts?: number) => {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return String(ts); }
};

const leftLabel = (ts?: number) => {
  const ms = (ts || 0) - Date.now();
  if (ms <= 0) return "expired";
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / 3_600_000);
  return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
};

const PremiumUsersManager = ({ glassCard, inputClass, btnPrimary, btnSecondary }: {
  glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string;
}) => {
  const [users, setUsers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"premium" | "all" | "banned">("premium");
  const [search, setSearch] = useState("");
  const [days, setDays] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [devices, setDevices] = useState<Record<string, any[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bans, setBans] = useState<any[]>([]);
  const [manualBan, setManualBan] = useState("");

  useEffect(() => {
    const unsub = onValue(query(ref(db, "users"), limitToLast(3000)), (snap) => {
      const raw = snap.val() || {};
      const list: Row[] = Object.entries(raw).map(([id, u]: any) => ({
        id,
        name: u?.name || u?.username || "Unknown",
        email: u?.email || "",
        photo: u?.photoURL || u?.photo || "",
        banned: u?.banned === true,
        premium: u?.premium || null,
      }));
      setUsers(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const refreshBans = () => { listBans().then(setBans).catch(() => {}); };
  useEffect(() => { refreshBans(); }, []);

  const premiumUsers = useMemo(
    () => users.filter((u) => u.premium?.active && Number(u.premium?.expiresAt || 0) > Date.now())
      .sort((a, b) => Number(a.premium?.expiresAt) - Number(b.premium?.expiresAt)),
    [users],
  );

  const visible = useMemo(() => {
    const base = tab === "premium" ? premiumUsers : users;
    const q = search.trim().toLowerCase();
    const filtered = q
      ? base.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.id.toLowerCase().includes(q))
      : base;
    return tab === "all" && !q ? filtered.slice(0, 60) : filtered.slice(0, 200);
  }, [tab, users, premiumUsers, search]);

  const grant = async (u: Row, addDays: number) => {
    if (!addDays || addDays <= 0) return toast.error("Enter a valid number of days");
    setBusy(u.id);
    try {
      const cur = Number(u.premium?.expiresAt || 0);
      const base = u.premium?.active && cur > Date.now() ? cur : Date.now();
      const expiresAt = base + addDays * DAY;
      await set(ref(db, `users/${u.id}/premium`), {
        active: true, expiresAt, source: "admin", grantedAt: Date.now(),
      });
      toast.success(`${u.name} — premium ${addDays} day(s) added`);
      setDays((p) => ({ ...p, [u.id]: "" }));
    } catch { toast.error("Failed to grant premium"); }
    setBusy(null);
  };

  const revoke = async (u: Row) => {
    if (!confirm(`Remove premium from "${u.name}"?`)) return;
    setBusy(u.id);
    try {
      await remove(ref(db, `users/${u.id}/premium`));
      await remove(ref(db, `users/${u.id}/premiumDevices`));
      toast.success("Premium removed");
    } catch { toast.error("Failed"); }
    setBusy(null);
  };

  const toggleDevices = async (u: Row) => {
    if (expanded === u.id) { setExpanded(null); return; }
    setExpanded(u.id);
    if (devices[u.id]) return;
    try {
      const { getUserDevices } = await import("@/lib/premiumDevice");
      const list = await getUserDevices(u.id);
      setDevices((p) => ({ ...p, [u.id]: list || [] }));
    } catch { setDevices((p) => ({ ...p, [u.id]: [] })); }
  };

  const dropDevice = async (u: Row, deviceId: string) => {
    try {
      const { removeDevice } = await import("@/lib/premiumDevice");
      await removeDevice(u.id, deviceId);
      setDevices((p) => ({ ...p, [u.id]: (p[u.id] || []).filter((d: any) => d.id !== deviceId) }));
      toast.success("Device removed");
    } catch { toast.error("Failed to remove device"); }
  };

  const toggleBan = async (u: Row) => {
    const next = !u.banned;
    if (next && !confirm(`Ban "${u.name}"? Their email and all known devices will be blocked.`)) return;
    setBusy(u.id);
    try {
      const devIds = (devices[u.id] || []).map((d: any) => d.id).filter(Boolean);
      if (next) await banUser({ uid: u.id, email: u.email, deviceIds: devIds, reason: "Banned by admin" });
      else await unbanUser({ uid: u.id, email: u.email, deviceIds: devIds });
      toast.success(next ? "User banned" : "User unbanned");
      refreshBans();
    } catch { toast.error("Failed"); }
    setBusy(null);
  };

  const addManualBan = async () => {
    const v = manualBan.trim();
    if (!v) return;
    try {
      if (v.includes("@")) await banUser({ email: v, reason: "Manual ban" });
      else await banUser({ deviceIds: [v], reason: "Manual ban" });
      setManualBan("");
      refreshBans();
      toast.success("Ban added");
    } catch { toast.error("Failed"); }
  };

  const liftBan = async (b: any) => {
    try {
      if (b.kind === "email") await unbanUser({ email: String(b.key).replace(/,/g, ".") });
      else await unbanUser({ deviceIds: [b.key] });
      if (b.uid) await unbanUser({ uid: b.uid });
      refreshBans();
      toast.success("Ban lifted");
    } catch { toast.error("Failed"); }
  };

  const stats = [
    { label: "Active Premium", value: premiumUsers.length, icon: Crown, tone: "text-amber-300" },
    { label: "Total Users", value: users.length, icon: ShieldCheck, tone: "text-emerald-300" },
    { label: "Banned", value: bans.length + users.filter((u) => u.banned).length, icon: Ban, tone: "text-rose-300" },
  ];

  return (
    <div className="flex flex-col gap-4 pb-32">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className={`${glassCard} p-3`}>
            <div className={`flex items-center gap-2 ${s.tone}`}>
              <s.icon size={15} />
              <span className="text-lg font-bold">{s.value}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className={`${glassCard} p-3 flex flex-col gap-3`}>
        <div className="flex gap-2">
          {(["premium", "all", "banned"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${tab === t ? "bg-primary/20 border-primary/40 text-primary" : "border-border text-muted-foreground"}`}
            >
              {t === "premium" ? "Premium List" : t === "all" ? "All Users" : "Bans"}
            </button>
          ))}
          <button onClick={refreshBans} className={`${btnSecondary} ml-auto px-2.5`} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>

        {tab !== "banned" && (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={inputClass + " pl-9"}
              placeholder="Search by name, email or user id…"
            />
          </div>
        )}
      </div>

      {tab === "banned" ? (
        <div className={`${glassCard} p-3 flex flex-col gap-3`}>
          <div className="flex gap-2">
            <input
              value={manualBan}
              onChange={(e) => setManualBan(e.target.value)}
              className={inputClass}
              placeholder="Email or device id to ban"
            />
            <button onClick={addManualBan} className={btnPrimary}><Plus size={14} /> Ban</button>
          </div>
          {bans.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No bans yet.</p>
          ) : bans.map((b) => (
            <div key={b.kind + b.key} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <Ban size={15} className="text-rose-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate">{b.kind === "email" ? String(b.key).replace(/,/g, ".") : b.key}</p>
                <p className="text-[10px] text-muted-foreground">{b.kind} · {fmt(b.at)} {b.reason ? `· ${b.reason}` : ""}</p>
              </div>
              <button onClick={() => liftBan(b)} className={btnSecondary}>Unban</button>
            </div>
          ))}
        </div>
      ) : loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted-foreground py-10 text-center">No users found.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((u) => {
            const active = u.premium?.active && Number(u.premium?.expiresAt || 0) > Date.now();
            return (
              <div key={u.id} className={`${glassCard} p-3`}>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${u.banned ? "bg-rose-500/15 text-rose-300" : active ? "bg-amber-500/15 text-amber-300" : "bg-muted text-muted-foreground"}`}>
                    {u.banned ? <Ban size={16} /> : <Crown size={16} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">
                      {u.name}
                      {u.banned && <span className="ml-2 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">Banned</span>}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{u.email || u.id}</p>
                  </div>
                  {active && (
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-amber-300 font-semibold flex items-center gap-1"><Clock size={11} />{leftLabel(u.premium?.expiresAt)}</p>
                      <p className="text-[9px] text-muted-foreground">{fmt(u.premium?.expiresAt)}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <input
                    value={days[u.id] || ""}
                    onChange={(e) => setDays((p) => ({ ...p, [u.id]: e.target.value.replace(/\D/g, "") }))}
                    className={inputClass + " w-20 py-1.5 text-xs"}
                    placeholder="days"
                    inputMode="numeric"
                  />
                  <button
                    disabled={busy === u.id}
                    onClick={() => grant(u, Number(days[u.id] || 0))}
                    className={btnPrimary + " text-xs py-1.5"}
                  >
                    {busy === u.id ? <Loader2 size={13} className="animate-spin" /> : <Crown size={13} />} {active ? "Extend" : "Give Premium"}
                  </button>
                  {[7, 30].map((d) => (
                    <button key={d} onClick={() => grant(u, d)} className={btnSecondary + " text-xs py-1.5"}>+{d}d</button>
                  ))}
                  <button onClick={() => toggleDevices(u)} className={btnSecondary + " text-xs py-1.5"}>
                    <Smartphone size={13} /> Devices
                  </button>
                  {active && (
                    <button onClick={() => revoke(u)} className={btnSecondary + " text-xs py-1.5 text-rose-300"}>
                      <Trash2 size={13} /> Revoke
                    </button>
                  )}
                  <button onClick={() => toggleBan(u)} className={btnSecondary + " text-xs py-1.5 " + (u.banned ? "text-emerald-300" : "text-rose-300")}>
                    {u.banned ? <><ShieldCheck size={13} /> Unban</> : <><Ban size={13} /> Ban</>}
                  </button>
                </div>

                {expanded === u.id && (
                  <div className="mt-3 border-t border-border pt-3 flex flex-col gap-2">
                    {(devices[u.id] || []).length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">No registered devices.</p>
                    ) : (devices[u.id] || []).map((d: any) => (
                      <div key={d.id} className="flex items-center gap-2 text-[11px]">
                        <Smartphone size={12} className="text-muted-foreground" />
                        <span className="truncate flex-1">{d.name || d.id}</span>
                        <span className="text-muted-foreground">{fmt(d.lastSeen || d.registeredAt)}</span>
                        <button onClick={() => dropDevice(u, d.id)} className="text-rose-300"><Trash2 size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PremiumUsersManager;
