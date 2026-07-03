import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cloud, Copy, Loader2, Plus, RefreshCw, Rocket, Trash2, X, FileCode2, KeyRound,
  Link as LinkIcon, ExternalLink, Settings, CheckCircle2, AlertCircle, Download,
  Library, Eye, EyeOff, ShieldCheck, Terminal, Zap, Activity, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { db, ref, onValue, set } from "@/lib/firebase";
import { CF_WORKER_LIBRARY, CF_MANAGER_WORKER_CODE, type CfLibraryEntry } from "@/lib/cloudflareWorkerLibrary";

// ============================================================
// CLOUDFLARE MANAGER
// ============================================================
// 1. User deploys `cf-manager-worker.js` to their Cloudflare account,
//    sets CF_API_TOKEN, CF_ACCOUNT_ID, ADMIN_AUTH_TOKEN secrets, and
//    pastes the resulting workers.dev URL + ADMIN_AUTH_TOKEN below.
// 2. From then on this panel lists / deploys / edits / deletes / secrets /
//    tails Workers on that account — same UX as EGD Manager for Supabase.
//
// Firebase storage: cfManager/config = { managerUrl, adminToken }
// URL & token are NEVER hardcoded — user can change any time.
// ============================================================

type WorkerRow = { id: string; created_on?: string; modified_on?: string; etag?: string };
type SecretRow = { name: string; type?: string };

const STARTER = `// New Cloudflare Worker (Module syntax)
export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*",
        },
      });
    }
    return new Response(JSON.stringify({ ok: true, msg: "Hello from Cloudflare" }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  },
};
`;

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

type Props = {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
};

export default function CloudflareManager({ glassCard, inputClass, btnPrimary, btnSecondary }: Props) {
  // ---- Config ----
  const [managerUrl, setManagerUrl] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [savedToken, setSavedToken] = useState("");
  const [savingCfg, setSavingCfg] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [subdomain, setSubdomain] = useState("");

  // ---- Workflow state ----
  const [list, setList] = useState<WorkerRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selected, setSelected] = useState("");
  const [slug, setSlug] = useState("");
  const [code, setCode] = useState(STARTER);
  const [deploying, setDeploying] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState("");
  const [errorLog, setErrorLog] = useState("");
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [secretDraftKey, setSecretDraftKey] = useState("");
  const [secretDraftValue, setSecretDraftValue] = useState("");
  const [savingSecret, setSavingSecret] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [logsWorker, setLogsWorker] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsStatus, setLogsStatus] = useState<"idle" | "connecting" | "live" | "error" | "closed">("idle");
  const logsWsRef = useRef<WebSocket | null>(null);

  // ---- Load config ----
  useEffect(() => {
    const r = ref(db, "cfManager/config");
    return onValue(r, (snap) => {
      const v = (snap.val() as { managerUrl?: string; adminToken?: string }) || {};
      setManagerUrl(v.managerUrl || "");
      setAdminToken(v.adminToken || "");
      setSavedUrl(v.managerUrl || "");
      setSavedToken(v.adminToken || "");
      setShowSetup(!(v.managerUrl && v.adminToken));
    });
  }, []);

  const appendError = (msg: string) =>
    setErrorLog((prev) => `[${new Date().toLocaleTimeString()}] ${msg}\n` + prev);

  const call = async (action: string, body: any = {}) => {
    if (!savedUrl || !savedToken) throw new Error("Manager URL / Admin Token not configured");
    const base = savedUrl.replace(/\/+$/, "");
    const r = await fetch(`${base}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${savedToken}` },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let d: any; try { d = JSON.parse(text); } catch { d = { ok: false, error: text }; }
    return { httpOk: r.ok, status: r.status, ...d };
  };

  const saveConfig = async () => {
    const u = managerUrl.trim().replace(/\/+$/, "");
    const t = adminToken.trim();
    if (!/^https?:\/\//.test(u)) { toast.error("Manager URL must start with https://"); return; }
    if (!t) { toast.error("Admin token required"); return; }
    setSavingCfg(true);
    try {
      // Probe health first
      const h = await fetch(`${u}/health`).then((r) => r.json()).catch(() => null);
      if (!h?.ok) { toast.error("Health check failed — is the manager deployed?"); setSavingCfg(false); return; }
      await set(ref(db, "cfManager/config"), { managerUrl: u, adminToken: t });
      setSavedUrl(u); setSavedToken(t);
      toast.success("Cloudflare manager connected ✔");
      setShowSetup(false);
      setTimeout(() => { loadList(); loadHealth(); }, 200);
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || String(e)));
    } finally { setSavingCfg(false); }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Cloudflare manager? URL & token will be cleared.")) return;
    await set(ref(db, "cfManager/config"), null);
    setSavedUrl(""); setSavedToken(""); setManagerUrl(""); setAdminToken("");
    setList([]); setSelected(""); setSecrets([]); setHealth(null);
    toast.success("Disconnected");
    setShowSetup(true);
  };

  const loadHealth = async () => {
    if (!savedUrl) return;
    setCheckingHealth(true);
    try {
      const h = await fetch(`${savedUrl.replace(/\/+$/, "")}/health`).then((r) => r.json());
      setHealth(h);
      if (savedToken) {
        const s = await call("subdomain");
        if (s.ok) setSubdomain(s.subdomain || "");
      }
    } catch (e: any) {
      setHealth({ ok: false, error: e?.message });
    } finally { setCheckingHealth(false); }
  };

  const loadList = async () => {
    if (!savedUrl || !savedToken) return;
    setLoadingList(true);
    try {
      const r = await call("list");
      if (!r.ok) { appendError("list: " + JSON.stringify(r.error || r)); toast.error("Failed to load workers"); return; }
      setList((r.scripts || []).sort((a: any, b: any) => (b.modified_on || "").localeCompare(a.modified_on || "")));
    } catch (e: any) { appendError("list: " + e.message); }
    finally { setLoadingList(false); }
  };

  useEffect(() => { if (savedUrl && savedToken) { loadList(); loadHealth(); } /* eslint-disable-next-line */ }, [savedUrl, savedToken]);

  const openWorker = async (name: string) => {
    setSelected(name); setSlug(name); setCode("// loading…"); setSecrets([]); setResultUrl("");
    try {
      const r = await call("get", { name });
      if (r.ok) setCode(r.code || STARTER);
      else { setCode(STARTER); appendError("get: " + JSON.stringify(r.error || r)); }
      loadSecrets(name);
      if (subdomain) setResultUrl(`https://${name}.${subdomain}.workers.dev`);
    } catch (e: any) { appendError("get: " + e.message); }
  };

  const newWorker = () => {
    setSelected(""); setSlug(""); setCode(STARTER); setSecrets([]); setResultUrl(""); setErrorLog("");
  };

  const deploy = async () => {
    const name = slugify(slug);
    if (!name) { toast.error("Worker name required"); return; }
    if (!code.trim()) { toast.error("Code is empty"); return; }
    setDeploying(true);
    try {
      const r = await call("deploy", { name, code });
      if (!r.ok) { appendError("deploy: " + JSON.stringify(r.error || r)); toast.error("Deploy failed"); return; }
      toast.success(`Deployed: ${name} ✔`);
      setResultUrl(r.url || "");
      setSelected(name);
      loadList();
    } catch (e: any) { appendError("deploy: " + e.message); toast.error(e.message); }
    finally { setDeploying(false); }
  };

  const removeWorker = async (name: string) => {
    if (!confirm(`Delete worker "${name}"? This cannot be undone.`)) return;
    setDeleting(name);
    try {
      const r = await call("delete", { name });
      if (!r.ok) { toast.error("Delete failed"); appendError("delete: " + JSON.stringify(r.error || r)); return; }
      toast.success("Deleted");
      if (selected === name) newWorker();
      loadList();
    } catch (e: any) { appendError("delete: " + e.message); }
    finally { setDeleting(null); }
  };

  const loadSecrets = async (name: string) => {
    if (!name) return;
    setLoadingSecrets(true);
    try {
      const r = await call("secrets-list", { name });
      if (r.ok) setSecrets(r.secrets || []);
      else appendError("secrets: " + JSON.stringify(r.error || r));
    } catch (e: any) { appendError("secrets: " + e.message); }
    finally { setLoadingSecrets(false); }
  };

  const saveSecret = async () => {
    if (!selected) { toast.error("Select or deploy a worker first"); return; }
    const key = secretDraftKey.trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) { toast.error("Secret name: letters, digits, underscore only"); return; }
    if (!secretDraftValue) { toast.error("Value required"); return; }
    setSavingSecret(true);
    try {
      const r = await call("secret-put", { name: selected, key, value: secretDraftValue });
      if (!r.ok) { toast.error("Save failed"); appendError("secret-put: " + JSON.stringify(r.error || r)); return; }
      toast.success(`Secret ${key} saved ✔`);
      setSecretDraftKey(""); setSecretDraftValue("");
      loadSecrets(selected);
    } catch (e: any) { appendError("secret-put: " + e.message); }
    finally { setSavingSecret(false); }
  };

  const deleteSecret = async (key: string) => {
    if (!selected) return;
    if (!confirm(`Delete secret "${key}" from ${selected}?`)) return;
    try {
      const r = await call("secret-delete", { name: selected, key });
      if (!r.ok) { toast.error("Delete failed"); return; }
      toast.success("Secret deleted");
      loadSecrets(selected);
    } catch (e: any) { toast.error(e.message); }
  };

  const useLibrary = (entry: CfLibraryEntry) => {
    setSelected(""); setSlug(entry.slug); setCode(entry.source);
    setShowLibrary(false); setResultUrl(""); setErrorLog("");
    toast.success(`Loaded template: ${entry.label}`);
  };

  const openLogs = async (name: string) => {
    setLogsWorker(name);
    setLogLines([`[${new Date().toLocaleTimeString()}] Requesting tail session for ${name}…`]);
    setLogsStatus("connecting");
    try {
      const r = await call("logs", { name });
      if (!r.ok || !r.tail?.url) {
        setLogLines((l) => [...l, `❌ Failed to open tail: ${JSON.stringify(r.error || r)}`]);
        setLogsStatus("error");
        return;
      }
      const wsUrl = r.tail.url.replace(/^http/, "ws");
      setLogLines((l) => [...l, `→ Connecting to ${wsUrl.split("?")[0]}…`]);
      const ws = new WebSocket(wsUrl);
      logsWsRef.current = ws;
      ws.onopen = () => { setLogsStatus("live"); setLogLines((l) => [...l, `✔ Live tail connected. Waiting for requests…`]); };
      ws.onmessage = (ev) => {
        let msg = ev.data;
        try {
          const j = JSON.parse(ev.data);
          const outcome = j.outcome ? `[${j.outcome}]` : "";
          const req = j.event?.request ? `${j.event.request.method} ${j.event.request.url}` : "";
          const logs = (j.logs || []).map((x: any) => `  ${x.level}: ${(x.message || []).join(" ")}`).join("\n");
          const errs = (j.exceptions || []).map((x: any) => `  ⚠ ${x.name}: ${x.message}`).join("\n");
          msg = [`${new Date().toLocaleTimeString()} ${outcome} ${req}`, logs, errs].filter(Boolean).join("\n");
        } catch {}
        setLogLines((l) => [...l.slice(-500), String(msg)]);
      };
      ws.onerror = () => { setLogsStatus("error"); setLogLines((l) => [...l, "❌ WebSocket error"]); };
      ws.onclose = () => { setLogsStatus("closed"); setLogLines((l) => [...l, "— Tail closed —"]); };
    } catch (e: any) {
      setLogsStatus("error");
      setLogLines((l) => [...l, `❌ ${e?.message || e}`]);
    }
  };

  const closeLogs = () => {
    try { logsWsRef.current?.close(); } catch {}
    logsWsRef.current = null;
    setLogsWorker(null);
    setLogLines([]);
    setLogsStatus("idle");
  };

  const copy = (t: string, l = "Copied") => navigator.clipboard.writeText(t).then(() => toast.success(l));
  const downloadManagerCode = () => {
    const blob = new Blob([CF_MANAGER_WORKER_CODE], { type: "text/javascript" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "cf-manager-worker.js"; a.click();
    URL.revokeObjectURL(a.href);
  };

  const healthOk = health?.ok && health?.hasToken && health?.hasAccount && health?.hasAdmin;

  const badgeTone = (t?: string) =>
    t === "cyan" ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
    : t === "amber" ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
    : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";

  // ─────────── SETUP SCREEN ───────────
  if (showSetup) {
    return (
      <div className={`${glassCard} p-5 space-y-4`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
            <Cloud size={22} className="text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white">Cloudflare Manager Setup</h3>
            <p className="text-[11px] text-zinc-400">Deploy one Manager Worker to Cloudflare, then connect it here — unlimited-bandwidth deployment for every widget function.</p>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-orange-300 font-semibold">
            <FileCode2 size={16} /> Step 1 — Deploy the Manager Worker
          </div>
          <ol className="text-[12px] text-zinc-300 space-y-1 pl-5 list-decimal">
            <li>Open Cloudflare Dashboard → <b>Workers &amp; Pages → Create → Worker</b> → name it e.g. <code className="text-orange-300">cf-manager</code>.</li>
            <li>Click <b>Edit code</b>, paste the manager code below, then <b>Deploy</b>.</li>
            <li>Open <b>Settings → Variables and Secrets</b> and add these <b>3 secrets</b> (type: Secret):
              <div className="mt-1 space-y-1 font-mono text-[11px] text-orange-200">
                <div>CF_API_TOKEN &nbsp;&nbsp; = your Cloudflare API token (Workers Scripts:Edit permission)</div>
                <div>CF_ACCOUNT_ID &nbsp;= your Cloudflare account id</div>
                <div>ADMIN_AUTH_TOKEN = a long random string you choose (25+ chars)</div>
              </div>
            </li>
            <li>Click <b>Deploy</b> again after adding secrets. Open the Worker URL + <code>/health</code> — every value should be <code className="text-emerald-300">true</code>.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => copy(CF_MANAGER_WORKER_CODE, "Manager code copied")} className={btnSecondary + " gap-2"}>
              <Copy size={14} /> Copy Manager Code
            </button>
            <button onClick={downloadManagerCode} className={btnSecondary + " gap-2"}>
              <Download size={14} /> Download .js
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-orange-300 font-semibold">
            <LinkIcon size={16} /> Step 2 — Connect
          </div>
          <div>
            <label className="text-[11px] text-zinc-400">Manager Worker URL</label>
            <input value={managerUrl} onChange={(e) => setManagerUrl(e.target.value)}
              placeholder="https://cf-manager.<sub>.workers.dev"
              className={inputClass + " font-mono text-[12px]"} />
          </div>
          <div>
            <label className="text-[11px] text-zinc-400">Admin Auth Token</label>
            <div className="relative">
              <input value={adminToken} onChange={(e) => setAdminToken(e.target.value)}
                type={showToken ? "text" : "password"}
                placeholder="the ADMIN_AUTH_TOKEN you set as a Worker secret"
                className={inputClass + " font-mono text-[12px] pr-10"} />
              <button type="button" onClick={() => setShowToken((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white">
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <button disabled={savingCfg} onClick={saveConfig} className={btnPrimary + " gap-2 w-full"}>
            {savingCfg ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {savingCfg ? "Verifying…" : "Verify & Connect"}
          </button>
        </div>
      </div>
    );
  }

  // ─────────── MAIN DASHBOARD ───────────
  return (
    <div className="space-y-4">
      {/* Header / status */}
      <div className={`${glassCard} p-4 flex flex-wrap items-center gap-3`}>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shrink-0">
          <Cloud size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            Cloudflare Manager
            {healthOk ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle2 size={10} /> Connected
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                <AlertCircle size={10} /> {checkingHealth ? "Checking…" : "Check failed"}
              </span>
            )}
          </div>
          <div className="text-[10px] text-zinc-400 font-mono truncate">{savedUrl}</div>
          {subdomain && <div className="text-[10px] text-zinc-500">Subdomain: <span className="text-orange-300">*.{subdomain}.workers.dev</span></div>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={loadHealth} disabled={checkingHealth} className={btnSecondary + " gap-1"}>
            <RefreshCw size={12} className={checkingHealth ? "animate-spin" : ""} /> Health
          </button>
          <button onClick={() => setShowSetup(true)} className={btnSecondary + " gap-1"}>
            <Settings size={12} /> Reconfigure
          </button>
          <button onClick={disconnect} className={btnSecondary + " gap-1 !text-red-300 hover:!bg-red-500/10"}>
            <X size={12} /> Disconnect
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* LEFT — worker list + library */}
        <div className={`${glassCard} p-3 space-y-3 self-start`}>
          <div className="flex items-center gap-2">
            <div className="flex-1 text-xs font-semibold text-zinc-300 flex items-center gap-1">
              <Rocket size={12} className="text-orange-300" /> Deployed Workers ({list.length})
            </div>
            <button onClick={loadList} disabled={loadingList} className="p-1.5 rounded hover:bg-white/5 text-zinc-400" title="Refresh">
              <RefreshCw size={12} className={loadingList ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={newWorker} className={btnPrimary + " gap-1 flex-1 !py-1.5 text-xs"}>
              <Plus size={12} /> New
            </button>
            <button onClick={() => setShowLibrary(true)} className={btnSecondary + " gap-1 flex-1 !py-1.5 text-xs"}>
              <Library size={12} /> Library
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto space-y-1 -mx-1 px-1">
            {list.length === 0 && (
              <div className="text-[11px] text-zinc-500 italic text-center py-4">No workers yet — deploy one from the Library.</div>
            )}
            {list.map((w) => (
              <div key={w.id}
                className={`group flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                  selected === w.id ? "bg-orange-500/10 border border-orange-500/30" : "hover:bg-white/5 border border-transparent"
                }`}>
                <button onClick={() => openWorker(w.id)} className="flex-1 text-left min-w-0">
                  <div className="text-[12px] text-white font-medium truncate">{w.id}</div>
                  {w.modified_on && <div className="text-[9px] text-zinc-500 truncate">{new Date(w.modified_on).toLocaleString()}</div>}
                </button>
                {subdomain && (
                  <a href={`https://${w.id}.${subdomain}.workers.dev`} target="_blank" rel="noreferrer"
                    className="p-1 rounded text-zinc-500 hover:text-orange-300 opacity-0 group-hover:opacity-100" title="Open">
                    <ExternalLink size={11} />
                  </a>
                )}
                <button onClick={() => openLogs(w.id)}
                  className="p-1 rounded text-zinc-500 hover:text-cyan-300 opacity-0 group-hover:opacity-100" title="Live logs">
                  <Terminal size={11} />
                </button>
                <button onClick={() => removeWorker(w.id)} disabled={deleting === w.id}
                  className="p-1 rounded text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100" title="Delete">
                  {deleting === w.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — editor + secrets */}
        <div className="space-y-3">
          <div className={`${glassCard} p-4 space-y-3`}>
            <div className="flex items-center gap-2 flex-wrap">
              <FileCode2 size={14} className="text-orange-300 shrink-0" />
              <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))}
                placeholder="worker-name (lowercase, dashes)"
                className={inputClass + " font-mono text-[12px] flex-1 min-w-[160px]"} />
              {selected && (
                <button onClick={() => openLogs(selected)} className={btnSecondary + " gap-1 !py-1.5 !text-[11px]"} title="Live tail logs">
                  <Terminal size={12} /> Logs
                </button>
              )}
              <button onClick={deploy} disabled={deploying || !slug || !code.trim()}
                className={btnPrimary + " gap-1 !py-1.5"}>
                {deploying ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
                {deploying ? "Deploying…" : selected === slug ? "Update" : "Deploy"}
              </button>
            </div>

            <textarea value={code} onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              className="w-full h-[420px] bg-black/40 border border-white/10 rounded-lg p-3 text-[11px] font-mono text-zinc-100 focus:outline-none focus:border-orange-500/50 resize-y" />

            {resultUrl && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px]">
                <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                <span className="text-emerald-300">Live at</span>
                <a href={resultUrl} target="_blank" rel="noreferrer"
                  className="font-mono text-orange-300 hover:underline truncate flex-1">{resultUrl}</a>
                <button onClick={() => copy(resultUrl, "URL copied")} className="p-1 rounded hover:bg-white/5 text-zinc-400">
                  <Copy size={11} />
                </button>
              </div>
            )}
          </div>

          {/* Secrets */}
          <div className={`${glassCard} p-4 space-y-3`}>
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <KeyRound size={12} className="text-amber-300" />
              Secrets {selected ? <span className="text-zinc-500 font-mono">→ {selected}</span> : <span className="text-zinc-500">(select a worker first)</span>}
              <button onClick={() => selected && loadSecrets(selected)} disabled={!selected || loadingSecrets}
                className="ml-auto p-1 rounded hover:bg-white/5 text-zinc-400">
                <RefreshCw size={11} className={loadingSecrets ? "animate-spin" : ""} />
              </button>
            </div>
            {selected && (
              <>
                <div className="space-y-1">
                  {secrets.length === 0 && <div className="text-[11px] text-zinc-500 italic">No secrets yet.</div>}
                  {secrets.map((s) => (
                    <div key={s.name} className="flex items-center gap-2 px-2 py-1 rounded bg-white/[0.03] border border-white/5">
                      <KeyRound size={10} className="text-amber-400 shrink-0" />
                      <span className="text-[11px] font-mono text-zinc-200 flex-1 truncate">{s.name}</span>
                      <button onClick={() => deleteSecret(s.name)} className="p-1 rounded text-zinc-500 hover:text-red-400">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-[1fr_1.5fr_auto] gap-2">
                  <input value={secretDraftKey} onChange={(e) => setSecretDraftKey(e.target.value.toUpperCase())}
                    placeholder="SECRET_NAME" className={inputClass + " font-mono text-[11px] !py-1.5"} />
                  <input value={secretDraftValue} onChange={(e) => setSecretDraftValue(e.target.value)}
                    type="password" placeholder="value" className={inputClass + " font-mono text-[11px] !py-1.5"} />
                  <button onClick={saveSecret} disabled={savingSecret}
                    className={btnPrimary + " gap-1 !py-1.5 text-[11px]"}>
                    {savingSecret ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Save
                  </button>
                </div>
              </>
            )}
          </div>

          {errorLog && (
            <div className={`${glassCard} p-3`}>
              <div className="flex items-center gap-2 text-xs font-semibold text-red-300 mb-2">
                <AlertCircle size={12} /> Error log
                <button onClick={() => setErrorLog("")} className="ml-auto text-zinc-500 hover:text-white">
                  <X size={12} />
                </button>
              </div>
              <pre className="text-[10px] text-red-200 font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">{errorLog}</pre>
            </div>
          )}
        </div>
      </div>

      {/* LIBRARY MODAL */}
      {showLibrary && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowLibrary(false)}>
          <div className={`${glassCard} !bg-zinc-900 w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col`}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 p-4 border-b border-white/10">
              <Library size={18} className="text-orange-300" />
              <div className="flex-1">
                <div className="text-sm font-bold text-white">Cloudflare Worker Library</div>
                <div className="text-[11px] text-zinc-400">Pre-built widget functions ported for Cloudflare. Load a template, then Deploy.</div>
              </div>
              <button onClick={() => setShowLibrary(false)} className="p-1.5 rounded hover:bg-white/5 text-zinc-400">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-2">
              {CF_WORKER_LIBRARY.map((e) => (
                <div key={e.slug}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-3 hover:border-orange-500/40 transition-colors">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-semibold text-white">{e.label}</div>
                        <code className="text-[10px] text-zinc-500 font-mono">{e.slug}</code>
                        {(e.badgeText || e.isNew) && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${badgeTone(e.badgeTone)}`}>
                            {e.badgeText || "NEW"}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-1">{e.description}</div>
                      {e.secrets.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {e.secrets.map((s) => (
                            <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                              <KeyRound size={8} className="inline mr-1" />{s}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => useLibrary(e)} className={btnPrimary + " gap-1 !py-1.5 text-[11px] shrink-0"}>
                      <Rocket size={11} /> Load
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
