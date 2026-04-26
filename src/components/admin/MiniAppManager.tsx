import { useEffect, useState } from "react";
import { db, ref, set, onValue, push, remove, update } from "@/lib/firebase";
import { toast } from "sonner";
import {
  Sparkles, Eye, MousePointerClick, CheckCircle2, KeyRound, Plus, Trash2, Copy, ExternalLink, Power, Save,
} from "lucide-react";

interface Props {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
}

interface ApiKeyEntry {
  id: string;
  key: string;
  label: string;
  redirectUrl: string;
  enabled: boolean;
  createdAt: number;
  uses?: number;
  lastUsedAt?: number;
}

const randomKey = () =>
  `mini_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

export default function MiniAppManager({ glassCard, inputClass, btnPrimary, btnSecondary }: Props) {
  const [stats, setStats] = useState<any>({});
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [botUsername, setBotUsername] = useState("RS_ANIME_ACCESS_BOT");
  const [newLabel, setNewLabel] = useState("");
  const [newRedirect, setNewRedirect] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);

  useEffect(() => {
    const u1 = onValue(ref(db, "miniApp/stats"), (snap) => setStats(snap.val() || {}));
    const u2 = onValue(ref(db, "miniApp/apiKeys"), (snap) => {
      const v = snap.val() || {};
      const arr: ApiKeyEntry[] = Object.entries(v).map(([id, val]: [string, any]) => ({
        id, ...val,
      }));
      arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setApiKeys(arr);
    });
    const u3 = onValue(ref(db, "settings/unlockViaTelegramMini"), (snap) => setEnabled(snap.val() === true));
    const u4 = onValue(ref(db, "settings/telegramMiniBotUsername"), (snap) => {
      const v = String(snap.val() || "").trim();
      setBotUsername(v || "RS_ANIME_ACCESS_BOT");
    });
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  const saveSettings = async () => {
    await set(ref(db, "settings/unlockViaTelegramMini"), enabled);
    await set(ref(db, "settings/telegramMiniBotUsername"), botUsername.trim().replace(/^@/, ""));
    toast.success("Settings saved");
  };

  const setupBotMenu = async () => {
    setSetupBusy(true);
    try {
      const r = await fetch(
        `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/mini-app`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "setup-bot", miniUrl: `${window.location.origin}/mini` }),
        },
      );
      const data = await r.json();
      if (data?.ok) toast.success("✅ Bot menu button set! Open the bot in Telegram.");
      else toast.error(`Setup failed: ${data?.telegram?.description || data?.error || "unknown"}`);
    } catch (e: any) {
      toast.error(`Setup error: ${e?.message || "unknown"}`);
    } finally {
      setSetupBusy(false);
    }
  };

  const createKey = async () => {
    if (!newLabel.trim()) { toast.error("Label required"); return; }
    if (!newRedirect.trim()) { toast.error("Redirect URL required"); return; }
    const key = randomKey();
    const r = await push(ref(db, "miniApp/apiKeys"), {
      key,
      label: newLabel.trim(),
      redirectUrl: newRedirect.trim(),
      enabled: true,
      createdAt: Date.now(),
      uses: 0,
    });
    if (r.key) {
      toast.success("API key created");
      setNewLabel(""); setNewRedirect("");
    }
  };

  const toggleKey = async (id: string, enabled: boolean) => {
    await update(ref(db, `miniApp/apiKeys/${id}`), { enabled: !enabled });
  };
  const deleteKey = async (id: string) => {
    if (!confirm("Delete this API key?")) return;
    await remove(ref(db, `miniApp/apiKeys/${id}`));
    toast.success("Deleted");
  };
  const copy = (s: string) => {
    navigator.clipboard.writeText(s);
    toast.success("Copied");
  };

  const miniUrl = `${window.location.origin}/mini`;
  const visits = Number(stats.visits || 0);
  const completes = Number(stats.completes || 0);
  const apiCompletes = Number(stats.apiCompletes || 0);

  const cardCls = `${glassCard} p-4 overflow-hidden`;

  return (
    <div className="space-y-4 max-w-full">
      {/* Hero */}
      <div className={`${cardCls} relative`}>
        <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-fuchsia-500/15 blur-3xl pointer-events-none" />
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-cyan-400 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">Telegram Mini App</h2>
            <p className="text-xs text-muted-foreground truncate">Monetag-monetized ad gate via Telegram bot</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <StatCard icon={<Eye className="w-4 h-4" />} label="All-time Visits" value={visits} color="from-cyan-500 to-blue-500" />
          <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label="All-time Done" value={completes} color="from-emerald-500 to-teal-500" />
          <StatCard icon={<MousePointerClick className="w-4 h-4" />} label="API Done" value={apiCompletes} color="from-fuchsia-500 to-purple-500" />
        </div>

        {/* Daily breakdown */}
        {(() => {
          const daily = (stats?.daily || {}) as Record<string, { visits?: number; completes?: number; apiCompletes?: number }>;
          const days = Object.keys(daily).sort().reverse().slice(0, 7);
          if (days.length === 0) {
            return (
              <p className="text-[11px] text-muted-foreground mt-3 text-center">No daily data yet</p>
            );
          }
          return (
            <div className="mt-4">
              <h4 className="text-xs font-semibold mb-2 opacity-80">Last {days.length} day(s)</h4>
              <div className="space-y-1.5">
                {days.map((d) => {
                  const v = Number(daily[d]?.visits || 0);
                  const c = Number(daily[d]?.completes || 0);
                  const isToday = d === new Date().toISOString().split("T")[0];
                  return (
                    <div key={d} className="flex items-center justify-between text-[11px] bg-muted/40 rounded-lg px-2.5 py-1.5">
                      <span className={`font-mono ${isToday ? "text-cyan-400 font-bold" : "opacity-80"}`}>
                        {isToday ? "Today" : d}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-cyan-300">👁 {v}</span>
                        <span className="text-emerald-300">✅ {c}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Settings */}
      <div className={cardCls}>
        <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
          <Power className="w-4 h-4" /> Verify Button Routing
        </h3>
        <label className="flex items-start gap-2 mb-3 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="text-sm">Route website Verify button to Telegram Mini App</span>
        </label>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Telegram Bot Username (without @)</label>
          <input
            value={botUsername}
            onChange={(e) => setBotUsername(e.target.value)}
            placeholder="RS_ANIME_ACCESS_BOT"
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground break-all">
            Users go to <code className="break-all">https://t.me/{botUsername || "bot"}?startapp=u_USER_ID</code>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={saveSettings} className={`${btnPrimary} px-3 py-2 text-xs flex items-center gap-1.5`}>
            <Save className="w-3.5 h-3.5" /> Save
          </button>
          <button onClick={setupBotMenu} disabled={setupBusy} className={`${btnSecondary} px-3 py-2 text-xs`}>
            ⚡ {setupBusy ? "Setting…" : "Auto-Setup Menu"}
          </button>
        </div>
      </div>

      {/* === Dedicated Access Bot (RS_ANIME_ACCESS_BOT) === */}
      <AccessBotSection glassCard={cardCls} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />

      {/* Mini App URL */}
      <div className={cardCls}>
        <h3 className="font-semibold mb-2 text-sm">Mini App URL</h3>
        <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-[11px] font-mono break-all">
          <span className="min-w-0 break-all flex-1">{miniUrl}</span>
          <button onClick={() => copy(miniUrl)} className="p-1.5 hover:bg-muted rounded shrink-0">
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          ⚡ Use Auto-Setup above to register this URL as the bot's Menu Button.
        </p>
      </div>

      {/* API Keys */}
      <div className={cardCls}>
        <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
          <KeyRound className="w-4 h-4" /> API Keys for External Bots
        </h3>
        <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
          <strong>(1) Direct redirect</strong> — send users to <code className="break-all">{miniUrl}?key=KEY&user=USER_ID</code>; after 5 ads they go to your Redirect URL. <strong>(2) Per-link shortener</strong> — POST to <code>/functions/v1/mini-app</code> with <code>{`{action:"shorten", apiKey, url}`}</code> for a unique short URL.
        </p>

        <div className="grid grid-cols-1 gap-2 mb-3">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (e.g. Partner Bot 1)"
            className={inputClass}
          />
          <input
            value={newRedirect}
            onChange={(e) => setNewRedirect(e.target.value)}
            placeholder="Redirect URL after ads"
            className={inputClass}
          />
          <button onClick={createKey} className={`${btnPrimary} px-3 py-2 text-xs flex items-center justify-center gap-1.5`}>
            <Plus className="w-3.5 h-3.5" /> Create Key
          </button>
        </div>

        <div className="space-y-2">
          {apiKeys.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No API keys yet</p>
          )}
          {apiKeys.map((k) => {
            const fullUrl = `${miniUrl}?key=${k.key}&user=USER_ID`;
            return <ApiKeyRow key={k.id} k={k} fullUrl={fullUrl} miniUrl={miniUrl} copy={copy} toggleKey={toggleKey} deleteKey={deleteKey} />;
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className={`p-2.5 rounded-xl bg-gradient-to-br ${color} text-white min-w-0 overflow-hidden`}>
      <div className="flex items-center gap-1 text-[10px] opacity-90 mb-1 truncate">{icon}<span className="truncate">{label}</span></div>
      <div className="text-xl font-bold truncate">{value.toLocaleString()}</div>
    </div>
  );
}

function ApiKeyRow({
  k, fullUrl, miniUrl, copy, toggleKey, deleteKey,
}: {
  k: ApiKeyEntry; fullUrl: string; miniUrl: string;
  copy: (s: string) => void;
  toggleKey: (id: string, enabled: boolean) => void;
  deleteKey: (id: string) => void;
}) {
  const [shortenInput, setShortenInput] = useState("");
  const [shortenResult, setShortenResult] = useState("");
  const [busy, setBusy] = useState(false);

  const doShorten = async () => {
    if (!shortenInput.trim()) { toast.error("URL required"); return; }
    setBusy(true);
    try {
      const r = await fetch(
        `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/mini-app`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "shorten", apiKey: k.key, url: shortenInput.trim() }),
        },
      );
      const data = await r.json();
      if (data?.ok && data.shortId) {
        const s = `${miniUrl}?s=${data.shortId}`;
        setShortenResult(s);
        toast.success("Shortened!");
      } else {
        toast.error(data?.error || "Failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 rounded-lg bg-muted/40 border border-border/50 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${k.enabled ? "bg-emerald-500" : "bg-gray-400"}`} />
        <span className="font-medium text-sm flex-1 truncate">{k.label}</span>
        <span className="text-xs text-muted-foreground">{k.uses || 0} uses</span>
        <button onClick={() => toggleKey(k.id, k.enabled)} className="p-1.5 hover:bg-muted rounded" title="Toggle">
          <Power className={`w-3.5 h-3.5 ${k.enabled ? "text-emerald-500" : "text-gray-400"}`} />
        </button>
        <button onClick={() => deleteKey(k.id)} className="p-1.5 hover:bg-muted rounded text-red-500">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2 p-2 rounded bg-background/50 text-xs font-mono break-all">
        <span className="opacity-60">key:</span> {k.key}
        <button onClick={() => copy(k.key)} className="ml-auto p-1 hover:bg-muted rounded shrink-0">
          <Copy className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-center gap-2 p-2 rounded bg-background/50 text-xs font-mono break-all">
        <span className="opacity-60">redirect url:</span> {fullUrl}
        <button onClick={() => copy(fullUrl)} className="ml-auto p-1 hover:bg-muted rounded shrink-0">
          <Copy className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <ExternalLink className="w-3 h-3 opacity-60" />
        <span className="opacity-60">default redirect:</span>
        <span className="truncate">{k.redirectUrl}</span>
      </div>

      {/* Inline URL shortener */}
      <div className="pt-2 border-t border-border/40 space-y-1.5">
        <div className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
          🔗 Shorten any URL with this key
        </div>
        <div className="flex gap-1.5">
          <input
            value={shortenInput}
            onChange={(e) => setShortenInput(e.target.value)}
            placeholder="https://your-link.com/whatever"
            className="flex-1 px-2 py-1 rounded bg-background/60 border border-border/50 text-xs"
          />
          <button
            onClick={doShorten}
            disabled={busy}
            className="px-3 py-1 rounded bg-fuchsia-500 hover:bg-fuchsia-600 text-white text-xs disabled:opacity-60"
          >
            {busy ? "…" : "Shorten"}
          </button>
        </div>
        {shortenResult && (
          <div className="flex items-center gap-2 p-2 rounded bg-background/50 text-[11px] font-mono break-all">
            {shortenResult}
            <button onClick={() => copy(shortenResult)} className="ml-auto p-1 hover:bg-muted rounded shrink-0">
              <Copy className="w-3 h-3" />
            </button>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          Users opening this short URL must watch 5 ads, then are redirected to the original link.
        </p>
      </div>
    </div>
  );
}

// ===== Dedicated Access Bot (separate webhook + menu) =====
function AccessBotSection({ glassCard, btnPrimary, btnSecondary }: { glassCard: string; btnPrimary: string; btnSecondary: string }) {
  const [busy, setBusy] = useState<"" | "menu" | "set" | "info" | "delete" | "send">("");
  const [info, setInfo] = useState<any>(null);
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const fnUrl = `https://${projectId}.supabase.co/functions/v1/access-bot`;
  const miniUrl = `${window.location.origin}/mini`;

  const call = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action as any);
    try {
      const r = await fetch(fnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const d = await r.json();
      return d;
    } catch (e: any) {
      toast.error(e?.message || "Network error");
      return null;
    } finally {
      setBusy("");
    }
  };

  const setMenu = async () => {
    const d = await call("set-menu", { miniUrl });
    if (d?.ok) toast.success("✅ Access bot menu button set!");
    else toast.error(d?.description || d?.error || "Failed");
  };

  const setWebhook = async () => {
    const d = await call("set-webhook", { webhookUrl: fnUrl });
    if (d?.ok) {
      toast.success("✅ Access bot webhook set!");
      checkWebhook();
    } else {
      toast.error(d?.description || d?.error || "Failed");
    }
  };

  const deleteWebhook = async () => {
    const d = await call("delete-webhook");
    if (d?.ok) {
      toast.success("Webhook deleted");
      setInfo(null);
    } else toast.error(d?.description || d?.error || "Failed");
  };

  const checkWebhook = async () => {
    const d = await call("webhook-info");
    if (d?.result) setInfo(d.result);
  };

  return (
    <div className={glassCard}>
      <h3 className="font-semibold mb-2 flex items-center gap-2">
        🤖 Access Bot — @RS_ANIME_ACCESS_BOT
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Dedicated bot for the Mini App. Set its webhook so /start sends the welcome message + Open Mini App button, and pin a persistent menu button.
      </p>

      <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-xs font-mono break-all mb-3">
        <span className="opacity-60">webhook url:</span> {fnUrl}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <button onClick={setWebhook} disabled={!!busy} className={`${btnPrimary} px-3 py-2 text-xs`}>
          🔗 {busy === "set" ? "Setting…" : "Set Webhook"}
        </button>
        <button onClick={setMenu} disabled={!!busy} className={`${btnSecondary} px-3 py-2 text-xs`}>
          🎁 {busy === "menu" ? "Setting…" : "Set Menu"}
        </button>
        <button onClick={checkWebhook} disabled={!!busy} className={`${btnSecondary} px-3 py-2 text-xs`}>
          🔍 Check
        </button>
        <button onClick={deleteWebhook} disabled={!!busy} className="px-3 py-2 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition">
          🗑️ Remove
        </button>
      </div>

      {info && (
        <div className="rounded-lg bg-background/50 p-3 text-[11px] space-y-1">
          <div><span className="opacity-60">URL:</span> <span className={info.url ? "text-emerald-400" : "text-rose-400"}>{info.url || "Not set"}</span></div>
          {info.last_error_message && <div className="text-rose-400">⚠️ {info.last_error_message}</div>}
          {info.pending_update_count !== undefined && <div className="opacity-70">Pending: {info.pending_update_count}</div>}
        </div>
      )}
    </div>
  );
}
