import { useEffect, useMemo, useState } from "react";
import { Chrome, Globe, Plus, Trash2, Wifi, ShieldCheck, ShieldOff, Loader2, Smartphone } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { addAllowedIp, fetchNetworkIp, isValidIp, normalizeIp, removeAllowedIp, setBrowserGateEnabled, useBrowserGateConfig } from "@/lib/browserAccess";

const card = "rounded-2xl border border-white/10 bg-[#16162A] p-4";
const input = "h-11 w-full rounded-xl border border-white/10 bg-[#0f0f1d] px-3 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none";

export default function BrowserAccessManager() {
  const cfg = useBrowserGateConfig();
  const [myIp, setMyIp] = useState<string | null>(null);
  const [ip, setIp] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchNetworkIp().then(setMyIp); }, []);
  const list = useMemo(() => Object.entries(cfg.allowIps).sort((a, b) => (b[1].addedAt || 0) - (a[1].addedAt || 0)), [cfg.allowIps]);
  const myAllowed = !!myIp && list.some(([, a]) => normalizeIp(a.ip) === normalizeIp(myIp));

  const add = async (value: string, name: string) => {
    const v = normalizeIp(value);
    if (!isValidIp(v)) { toast.error("Enter a valid IP address"); return; }
    if (list.some(([, a]) => normalizeIp(a.ip) === v)) { toast.error("This IP is already allowed"); return; }
    setBusy(true);
    try { await addAllowedIp(v, name); setIp(""); setLabel(""); toast.success("IP allowed — every browser can open the site"); }
    catch { toast.error("Could not save IP"); }
    finally { setBusy(false); }
  };
  const toggle = async (on: boolean) => {
    try { await setBrowserGateEnabled(on); toast.success(on ? "Chrome-only gate turned ON" : "Gate OFF — all browsers allowed"); }
    catch { toast.error("Could not update"); }
  };

  return <div className="space-y-4">
    <div className={`${card} overflow-hidden`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${cfg.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-400"}`}>{cfg.enabled ? <ShieldCheck size={22} /> : <ShieldOff size={22} />}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold leading-tight text-white">Chrome-only browser gate</h3>
          <p className="mt-1 text-[12px] leading-snug text-zinc-400">{cfg.enabled ? "ON — only Google Chrome can open the site, except allowed IPs below." : "OFF — every browser can open the site."}</p>
        </div>
        <Switch aria-label="Chrome-only browser gate" checked={cfg.enabled} onCheckedChange={toggle} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Status</p><p className={`mt-1 text-sm font-bold ${cfg.enabled ? "text-emerald-300" : "text-zinc-300"}`}>{cfg.enabled ? "Active" : "Disabled"}</p></div>
        <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Allowed IPs</p><p className="mt-1 text-sm font-bold text-white tabular-nums">{list.length}</p></div>
      </div>
    </div>

    <div className={card}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300"><Wifi size={18} /></span>
        <div className="min-w-0"><h4 className="text-[14px] font-bold text-white">Your network IP</h4><p className="text-[11px] text-zinc-400">Allow it so any browser on this network can open the site.</p></div>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-3">
        <span className="min-w-0 flex-1 break-all font-mono text-sm font-semibold text-white">{myIp || "Checking…"}</span>
        {myAllowed
          ? <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-bold text-emerald-300">Allowed</span>
          : <button type="button" disabled={!myIp || busy} onClick={() => myIp && add(myIp, "My network")} className="flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[12px] font-bold text-white disabled:opacity-40"><Plus size={14} />Allow</button>}
      </div>
    </div>

    <div className={card}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300"><Globe size={18} /></span>
        <div className="min-w-0"><h4 className="text-[14px] font-bold text-white">Add allowed IP</h4><p className="text-[11px] text-zinc-400">Users on this IP can use any browser — Booyah, Opera, Edge, Samsung…</p></div>
      </div>
      <div className="space-y-2">
        <input aria-label="IP address" className={`${input} font-mono`} inputMode="decimal" placeholder="e.g. 103.25.120.14" value={ip} onChange={e => setIp(e.target.value)} />
        <input aria-label="Label" className={input} placeholder="Label (optional) — e.g. Rahat phone" value={label} onChange={e => setLabel(e.target.value)} maxLength={40} />
        <button type="button" disabled={busy || !ip.trim()} onClick={() => add(ip, label)} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-bold text-white disabled:opacity-40">{busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}Allow this IP</button>
      </div>
    </div>

    <div className={card}>
      <div className="mb-3 flex items-center justify-between"><h4 className="text-[14px] font-bold text-white">Allowed IP list</h4><span className="text-[11px] text-zinc-500">{list.length} total</span></div>
      {list.length === 0
        ? <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 py-8 text-center"><Chrome size={22} className="text-zinc-500" /><p className="text-[12px] text-zinc-400">No IP allowed yet. Only Chrome can open the site.</p></div>
        : <ul className="space-y-2">{list.map(([key, a]) => <li key={key} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300"><Smartphone size={16} /></span>
          <div className="min-w-0 flex-1"><p className="break-all font-mono text-[13px] font-semibold text-white">{a.ip}</p><p className="truncate text-[11px] text-zinc-500">{a.label || "No label"} · {new Date(a.addedAt).toLocaleDateString()}</p></div>
          <button type="button" aria-label={`Remove ${a.ip}`} onClick={() => removeAllowedIp(key).then(() => toast.success("IP removed"), () => toast.error("Could not remove"))} className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-500/10 hover:text-red-400"><Trash2 size={16} /></button>
        </li>)}</ul>}
    </div>
  </div>;
}
