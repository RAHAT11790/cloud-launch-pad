import { useEffect, useState } from "react";
import { Bot, Copy, Loader2, Plus, RefreshCw, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL || "https://kqxpzqegtvaiwgdusrin.supabase.co"}/functions/v1/multi-bot`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

type BotRow = {
  id: string;
  name: string;
  username: string;
  adminId: number | null;
  hasApiKey: boolean;
  hasToken: boolean;
  webhookUrl: string;
  createdAt: number;
};

const headers = (json = true): HeadersInit => {
  const h: Record<string, string> = { Authorization: `Bearer ${ANON}`, apikey: ANON };
  if (json) h["Content-Type"] = "application/json";
  return h;
};

export default function MultiBotManager({
  glassCard, inputClass, btnPrimary, btnSecondary,
}: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  const [form, setForm] = useState({ botToken: "", apiKey: "", name: "", adminId: "" });

  const loadBots = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${FN_BASE}/admin/list`, { headers: headers(false) });
      const d = await r.json();
      if (d?.ok) setBots(d.bots || []);
      else toast.error(d?.error || "Failed to load bots");
    } catch (e: any) {
      toast.error(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBots(); }, []);

  const addBot = async () => {
    if (!form.botToken.trim()) { toast.error("Bot Token is required"); return; }
    setAdding(true);
    try {
      const r = await fetch(`${FN_BASE}/admin/add`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          botToken: form.botToken.trim(),
          apiKey: form.apiKey.trim(),
          name: form.name.trim(),
          adminId: form.adminId ? Number(form.adminId) : undefined,
        }),
      });
      const d = await r.json();
      if (d?.ok) {
        toast.success(`Bot @${d.username} added`);
        setForm({ botToken: "", apiKey: "", name: "", adminId: "" });
        await loadBots();
      } else {
        toast.error(d?.error || "Failed to add bot");
      }
    } catch (e: any) {
      toast.error(e?.message || "Network error");
    } finally {
      setAdding(false);
    }
  };

  const setWebhook = async (botId: string) => {
    setWorking(botId + ":hook");
    try {
      const r = await fetch(`${FN_BASE}/admin/set-webhook`, {
        method: "POST", headers: headers(), body: JSON.stringify({ botId }),
      });
      const d = await r.json();
      if (d?.ok) toast.success("Webhook set ✔");
      else toast.error(d?.error || "Failed");
    } finally { setWorking(null); }
  };

  const checkWebhook = async (botId: string) => {
    setWorking(botId + ":info");
    try {
      const r = await fetch(`${FN_BASE}/admin/webhook-info`, {
        method: "POST", headers: headers(), body: JSON.stringify({ botId }),
      });
      const d = await r.json();
      if (d?.ok) {
        const info = d.info || {};
        toast.success(`Hook: ${info.url ? "active" : "none"}${info.last_error_message ? ` | err: ${info.last_error_message}` : ""}`);
      } else toast.error(d?.error || "Failed");
    } finally { setWorking(null); }
  };

  const deleteBot = async (botId: string) => {
    if (!confirm("Delete this bot? Webhook will be removed.")) return;
    setWorking(botId + ":del");
    try {
      const r = await fetch(`${FN_BASE}/admin/delete`, {
        method: "POST", headers: headers(), body: JSON.stringify({ botId }),
      });
      const d = await r.json();
      if (d?.ok) { toast.success("Deleted"); loadBots(); }
      else toast.error(d?.error || "Failed");
    } finally { setWorking(null); }
  };

  const copy = (txt: string) => {
    navigator.clipboard.writeText(txt).then(() => toast.success("Copied"));
  };

  return (
    <div className="space-y-6">
      <div className={glassCard + " p-6"}>
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Bot className="text-amber-400" /> Multi-Bot Manager
        </h2>
        <p className="text-sm text-zinc-400 mb-4">
          Add multiple Telegram bots — each routes through a single edge function. Storage uses Firebase per-bot.
        </p>

        {/* Add Bot Form */}
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Bot Token *</label>
            <input
              className={inputClass} placeholder="123456:ABC-..."
              value={form.botToken} onChange={(e) => setForm({ ...form, botToken: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">RS API Key (for /short)</label>
            <input
              className={inputClass} placeholder="rs_xxxxx"
              value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Display Name (optional)</label>
            <input
              className={inputClass} placeholder="My Link Share Bot"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Admin Telegram ID (for /set_channel, /short, /list, /fsub_*)</label>
            <input
              className={inputClass} placeholder="6621572366"
              value={form.adminId} onChange={(e) => setForm({ ...form, adminId: e.target.value })}
            />
          </div>
        </div>
        <button
          className={btnPrimary + " mt-4 inline-flex items-center gap-2"}
          disabled={adding} onClick={addBot}
        >
          {adding ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
          Add Bot
        </button>
      </div>

      {/* Bot List */}
      <div className={glassCard + " p-6"}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Registered Bots</h3>
          <button onClick={loadBots} className={btnSecondary + " inline-flex items-center gap-2"}>
            {loading ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>

        {bots.length === 0 ? (
          <p className="text-zinc-500 text-sm">No bots added yet.</p>
        ) : (
          <div className="space-y-3">
            {bots.map((b) => (
              <div key={b.id} className="border border-zinc-700/50 rounded-lg p-4 bg-zinc-900/40">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold flex items-center gap-2">
                      <Bot size={16} className="text-amber-400" />
                      {b.name} {b.username && <span className="text-zinc-400">(@{b.username})</span>}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      ID: {b.id} • Admin: {b.adminId || "—"} • API Key: {b.hasApiKey ? "✓" : "✗"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={btnPrimary + " inline-flex items-center gap-1 text-sm"}
                      onClick={() => setWebhook(b.id)} disabled={working === b.id + ":hook"}
                    >
                      {working === b.id + ":hook"
                        ? <Loader2 className="animate-spin" size={14} />
                        : <Webhook size={14} />}
                      Set Webhook
                    </button>
                    <button
                      className={btnSecondary + " inline-flex items-center gap-1 text-sm"}
                      onClick={() => checkWebhook(b.id)} disabled={working === b.id + ":info"}
                    >
                      Check
                    </button>
                    <button
                      className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 inline-flex items-center gap-1 text-sm"
                      onClick={() => deleteBot(b.id)} disabled={working === b.id + ":del"}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 bg-zinc-950/60 rounded p-2 text-xs">
                  <code className="flex-1 truncate text-amber-300">{b.webhookUrl}</code>
                  <button
                    className="text-zinc-400 hover:text-white"
                    onClick={() => copy(b.webhookUrl)}
                    title="Copy webhook URL"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
