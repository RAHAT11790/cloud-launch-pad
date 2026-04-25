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
  const [botUsername, setBotUsername] = useState("Rs_forwards_bot");
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
      setBotUsername(v || "Rs_forwards_bot");
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

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className={`${glassCard} relative overflow-hidden`}>
        <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-fuchsia-500/15 blur-3xl pointer-events-none" />
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-cyan-400 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Telegram Mini App</h2>
            <p className="text-xs text-muted-foreground">Monetag-monetized ad gate via Telegram bot</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={<Eye className="w-4 h-4" />} label="Visits" value={visits} color="from-cyan-500 to-blue-500" />
          <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label="Site Completes" value={completes} color="from-emerald-500 to-teal-500" />
          <StatCard icon={<MousePointerClick className="w-4 h-4" />} label="API Completes" value={apiCompletes} color="from-fuchsia-500 to-purple-500" />
        </div>
      </div>

      {/* Settings */}
      <div className={glassCard}>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Power className="w-4 h-4" /> Verify Button Routing
        </h3>
        <label className="flex items-center gap-2 mb-3 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4" />
          <span className="text-sm">Route website Verify button to Telegram Mini App</span>
        </label>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Telegram Bot Username (without @)</label>
          <input
            value={botUsername}
            onChange={(e) => setBotUsername(e.target.value)}
            placeholder="my_bot"
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground">
            User will be sent to <code>https://t.me/{botUsername || "bot"}?startapp=u_USER_ID</code>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={saveSettings} className={btnPrimary}>
            <Save className="w-4 h-4" /> Save Settings
          </button>
          <button onClick={setupBotMenu} disabled={setupBusy} className={btnSecondary}>
            ⚡ {setupBusy ? "Setting up…" : "Auto-Setup Bot Menu Button"}
          </button>
        </div>
      </div>

      {/* Mini App URL */}
      <div className={glassCard}>
        <h3 className="font-semibold mb-2">Mini App URL</h3>
        <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-xs font-mono break-all">
          {miniUrl}
          <button onClick={() => copy(miniUrl)} className="ml-auto p-1.5 hover:bg-muted rounded">
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          ⚡ Use the "Auto-Setup" button above to register this URL as your bot's Menu Button automatically — no BotFather needed.
        </p>
      </div>

      {/* API Keys */}
      <div className={glassCard}>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <KeyRound className="w-4 h-4" /> API Keys for External Bots
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Generate keys for partner bots. They send users to <code>{miniUrl}?key=KEY&user=USER_ID</code>; after 5 ads, user is redirected to your <strong>Redirect URL</strong>. No site access is granted.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
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
            className={`${inputClass} md:col-span-1`}
          />
          <button onClick={createKey} className={btnPrimary}>
            <Plus className="w-4 h-4" /> Create Key
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
    <div className={`p-3 rounded-xl bg-gradient-to-br ${color} text-white`}>
      <div className="flex items-center gap-1.5 text-xs opacity-90 mb-1">{icon}{label}</div>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
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
