import { useEffect, useMemo, useState } from "react";
import { Ban, Clock, Link2Off, MessageSquare, Plus, Search, ShieldAlert, Trash2, UserCheck, Users, Loader2, Filter } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { db, ref, onValue, push, remove, update } from "@/lib/firebase";
import { banMember, subscribeBans, subscribeMembers, unbanMember, warnMember } from "@/lib/communityChat";
import { DEFAULT_BAD_WORDS, formatCountdown, banRemainingMs, parseBanDuration, parseSettings, type ChatBan, type ChatMember, type ChatSettings } from "@/lib/chatModeration";

const card = "rounded-2xl border border-white/10 bg-[#16162A] p-4";
const input = "h-11 w-full rounded-xl border border-white/10 bg-[#0f0f1d] px-3 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none";
const chip = "rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-zinc-200 active:scale-95";
const QUICK = ["30s", "5m", "30m", "3h", "1d", "permanent"];

export default function GlobalChatManager() {
  const [tab, setTab] = useState<"members" | "bans" | "filters" | "rules">("members");
  const [members, setMembers] = useState<ChatMember[] | null>(null);
  const [bans, setBans] = useState<(ChatBan & { uid: string })[]>([]);
  const [settings, setSettings] = useState<ChatSettings>(parseSettings(null));
  const [wordRows, setWordRows] = useState<[string, string][]>([]);
  const [q, setQ] = useState("");
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => subscribeMembers(setMembers), []);
  useEffect(() => subscribeBans(setBans), []);
  useEffect(() => onValue(ref(db, "communityChat/settings"), snap => {
    const raw = snap.val();
    setSettings(parseSettings(raw));
    setWordRows(Object.entries(raw?.customWords || {}).map(([k, v]: [string, any]) => [k, String(v?.w ?? v)] as [string, string]));
  }), []);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);

  const banMap = useMemo(() => new Map(bans.map(b => [b.uid, b])), [bans]);
  const shown = useMemo(() => (members || []).filter(m => !q || m.name.toLowerCase().includes(q.toLowerCase()) || m.uid.toLowerCase().includes(q.toLowerCase())), [members, q]);
  const save = (patch: Partial<Record<string, unknown>>) => update(ref(db, "communityChat/settings"), patch).then(() => toast.success("Saved")).catch(() => toast.error("Could not save"));

  const doBan = async (m: { uid: string; name: string }, value: string) => {
    const d = parseBanDuration(value);
    if (d === null) return;
    if (d === "permanent" && !window.confirm(`Permanently ban ${m.name} and delete every message, photo and voice they sent?`)) return;
    setBusy(m.uid);
    try { const removed = await banMember(m.uid, d, "Banned from admin panel", "Admin", m.name); toast.success(d === "permanent" ? `${m.name} banned permanently — ${removed} messages deleted` : `${m.name} muted for ${formatCountdown(d)}`); }
    catch { toast.error("Could not ban"); } finally { setBusy(""); }
  };
  const doWarn = async (m: ChatMember) => {
    const text = window.prompt(`Warning message for ${m.name}`)?.trim();
    if (!text) return;
    try { await warnMember(m.uid, text, "Admin"); toast.success("Warning sent"); } catch { toast.error("Could not send warning"); }
  };
  const addWord = async () => {
    const w = word.trim().toLowerCase();
    if (!w) return;
    if (wordRows.some(([, v]) => v === w) || DEFAULT_BAD_WORDS.includes(w)) { toast.error("This word is already filtered"); return; }
    try { await push(ref(db, "communityChat/settings/customWords"), { w, t: Date.now() }); setWord(""); toast.success("Filter added"); } catch { toast.error("Could not add"); }
  };

  const tabs = [
    { id: "members", label: "Members", icon: <Users size={15} />, n: members?.length || 0 },
    { id: "bans", label: "Banned", icon: <Ban size={15} />, n: bans.length },
    { id: "filters", label: "Word filter", icon: <Filter size={15} />, n: wordRows.length + (settings.filterEnabled ? DEFAULT_BAD_WORDS.length : 0) },
    { id: "rules", label: "Rules", icon: <ShieldAlert size={15} />, n: 0 },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600/30 via-fuchsia-600/15 to-transparent border border-white/10 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-500/25 text-indigo-200"><MessageSquare size={22} /></span>
          <div className="min-w-0"><h2 className="text-lg font-black text-white">Global Chat</h2><p className="text-xs text-zinc-400">Members, bans, word filters, links and slow mode</p></div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Members" value={members?.length ?? "…"} /><Stat label="Banned" value={bans.length} /><Stat label="Slow mode" value={settings.slowModeSeconds ? `${settings.slowModeSeconds}s` : "Off"} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-[#0f0f1d] p-1">
        {tabs.map(t => <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`flex flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-bold ${tab === t.id ? "bg-indigo-600 text-white" : "text-zinc-400"}`}>{t.icon}{t.label}{t.n ? <span className="text-[10px] opacity-80">{t.n}</span> : null}</button>)}
      </div>

      {tab === "members" && <div className={card}>
        <div className="relative mb-3"><Search size={16} className="absolute left-3 top-3.5 text-zinc-500" /><input className={`${input} pl-9`} placeholder="Search name or ID" value={q} onChange={e => setQ(e.target.value)} /></div>
        {members === null ? <Loader2 className="mx-auto animate-spin text-zinc-400" /> : shown.length === 0 ? <p className="py-6 text-center text-sm text-zinc-500">No members yet</p> : (
          <ul className="space-y-2">{shown.slice(0, 300).map(m => {
            const b = banMap.get(m.uid);
            return <li key={m.uid} className="rounded-xl border border-white/5 bg-[#0f0f1d] p-3">
              <div className="flex items-center gap-3">
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-indigo-500/20 grid place-items-center text-sm font-black text-indigo-200">{m.photo ? <img src={m.photo} alt="" className="h-full w-full object-cover" /> : m.name.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">{m.name}</p>
                  <p className="truncate font-mono text-[10.5px] text-zinc-500">{m.uid}</p>
                  <p className="text-[10.5px] text-zinc-400">{m.count} msgs · last {new Date(m.last).toLocaleString()}</p>
                </div>
                {b && <span className="rounded-full bg-red-500/15 px-2 py-1 text-[10px] font-black text-red-300">{b.until === 0 ? "BANNED" : formatCountdown(banRemainingMs(b, now))}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK.map(d => <button key={d} type="button" disabled={busy === m.uid} onClick={() => void doBan(m, d)} className={`${chip} ${d === "permanent" ? "border-red-500/40 text-red-300" : ""}`}>{d === "permanent" ? "Ban forever" : `Mute ${d}`}</button>)}
                <button type="button" onClick={() => void doWarn(m)} className={`${chip} border-amber-500/40 text-amber-300`}>Warn</button>
                {b && <button type="button" onClick={() => void unbanMember(m.uid).then(() => toast.success("Unbanned"))} className={`${chip} border-emerald-500/40 text-emerald-300`}>Unban</button>}
              </div>
            </li>;
          })}</ul>
        )}
      </div>}

      {tab === "bans" && <div className={card}>
        {bans.length === 0 ? <p className="py-6 text-center text-sm text-zinc-500">Nobody is banned</p> : <ul className="space-y-2">{bans.map(b => (
          <li key={b.uid} className="flex items-center gap-3 rounded-xl border border-white/5 bg-[#0f0f1d] p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">{b.name || b.uid}</p>
              <p className="truncate font-mono text-[10.5px] text-zinc-500">{b.uid}</p>
              <p className="text-[11px] text-zinc-400">{b.reason || "—"} · by {b.by}</p>
            </div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-black ${b.until === 0 ? "bg-red-500/20 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>{b.until === 0 ? "PERMANENT" : formatCountdown(banRemainingMs(b, now))}</span>
            <button type="button" aria-label="Unban" onClick={() => void unbanMember(b.uid).then(() => toast.success("Unbanned"))} className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300"><UserCheck size={16} /></button>
          </li>))}</ul>}
      </div>}

      {tab === "filters" && <div className="space-y-3">
        <div className={`${card} flex items-center justify-between gap-3`}>
          <div><p className="text-sm font-bold text-white">Default abuse filter</p><p className="text-xs text-zinc-400">{DEFAULT_BAD_WORDS.length} Bangla + English words built in</p></div>
          <Switch checked={settings.filterEnabled} onCheckedChange={v => void save({ filterEnabled: v })} />
        </div>
        <div className={card}>
          <p className="mb-2 text-sm font-bold text-white">Your filter words</p>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void addWord(); }}>
            <input className={input} placeholder="Add a word or phrase" value={word} onChange={e => setWord(e.target.value)} maxLength={60} />
            <button type="submit" className="grid h-11 w-12 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white"><Plus size={18} /></button>
          </form>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {wordRows.length === 0 && <p className="text-xs text-zinc-500">No custom words yet</p>}
            {wordRows.map(([k, w]) => <span key={k} className="flex items-center gap-1 rounded-full bg-red-500/10 py-1 pl-3 pr-1 text-xs font-semibold text-red-200">{w}<button type="button" aria-label={`Remove ${w}`} onClick={() => void remove(ref(db, `communityChat/settings/customWords/${k}`))} className="grid h-5 w-5 place-items-center rounded-full bg-red-500/20"><Trash2 size={11} /></button></span>)}
          </div>
        </div>
        <details className={card}><summary className="cursor-pointer text-sm font-bold text-zinc-300">Show built-in words</summary><p className="mt-2 text-xs leading-relaxed text-zinc-500 break-words">{DEFAULT_BAD_WORDS.join(", ")}</p></details>
      </div>}

      {tab === "rules" && <div className="space-y-3">
        <div className={`${card} flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-3"><Link2Off size={20} className="text-indigo-300" /><div><p className="text-sm font-bold text-white">Block links</p><p className="text-xs text-zinc-400">Members cannot send URLs or website names</p></div></div>
          <Switch checked={settings.blockLinks} onCheckedChange={v => void save({ blockLinks: v })} />
        </div>
        <NumberRule icon={<Clock size={20} className="text-indigo-300" />} title="Slow mode" hint="Seconds between two messages from one member (0 = off)" value={settings.slowModeSeconds} presets={[0, 5, 10, 30, 60]} onSave={v => void save({ slowModeSeconds: v })} />
        <NumberRule icon={<Ban size={20} className="text-indigo-300" />} title="Auto-mute on abusive words" hint="Seconds a member is muted when the filter catches them (0 = only block the message)" value={settings.autoBanSeconds} presets={[0, 60, 300, 1800, 10800]} onSave={v => void save({ autoBanSeconds: v })} />
        <div className={`${card} text-xs leading-relaxed text-zinc-400`}>
          <p className="mb-1 font-bold text-zinc-200">CEO chat commands (reply to a member's message)</p>
          <p><code className="text-indigo-300">/ban 30s</code> · <code className="text-indigo-300">/ban 30m</code> · <code className="text-indigo-300">/ban 3h</code> · <code className="text-indigo-300">/ban permanent</code> (deletes all their messages) · <code className="text-indigo-300">/unban</code> · <code className="text-indigo-300">/warning your text</code>. Without a reply: <code className="text-indigo-300">/ban @ID 3h</code>.</p>
        </div>
      </div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-black/25 py-2"><p className="text-base font-black text-white">{value}</p><p className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</p></div>;
}
function NumberRule({ icon, title, hint, value, presets, onSave }: { icon: React.ReactNode; title: string; hint: string; value: number; presets: number[]; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return <div className={card}>
    <div className="flex items-center gap-3">{icon}<div><p className="text-sm font-bold text-white">{title}</p><p className="text-xs text-zinc-400">{hint}</p></div></div>
    <div className="mt-3 flex gap-2"><input type="number" min={0} className={input} value={v} onChange={e => setV(e.target.value)} /><button type="button" onClick={() => onSave(Math.max(0, Math.round(Number(v) || 0)))} className="h-11 shrink-0 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white">Save</button></div>
    <div className="mt-2 flex flex-wrap gap-1.5">{presets.map(p => <button key={p} type="button" onClick={() => onSave(p)} className={`${chip} ${value === p ? "bg-indigo-600 text-white" : ""}`}>{p === 0 ? "Off" : p >= 3600 ? `${p / 3600}h` : p >= 60 ? `${p / 60}m` : `${p}s`}</button>)}</div>
  </div>;
}
