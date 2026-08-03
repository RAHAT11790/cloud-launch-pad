import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cloud, Copy, Loader2, RefreshCw, Rocket, Trash2, X, KeyRound, FileCode2,
  Link as LinkIcon, ExternalLink, CheckCircle2, AlertCircle, Download,
  Library, Eye, EyeOff, ShieldCheck, Terminal, Plus, Save, LogOut, Search,
} from "lucide-react";
import { toast } from "sonner";
import { db, ref, onValue, set } from "@/lib/firebase";
import { CF_WORKER_LIBRARY, CF_MANAGER_WORKER_CODE, type CfLibraryEntry } from "@/lib/cloudflareWorkerLibrary";

// ============================================================
// CLOUDFLARE MANAGER — professional rebuild
// Vertical flow (top → bottom):
//   1. Code Library (buttons only)
//   2. Script name
//   3. Code editor
//   4. Env values (secrets)
//   5. Logs
//   6. Deployed scripts list
// ============================================================

type WorkerRow  = { id: string; created_on?: string; modified_on?: string };
type SecretRow  = { name: string; type?: string };
type LogsStatus = "idle" | "connecting" | "live" | "error" | "closed";

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

// Old cf-manager (v1.0.0) returned the raw multipart form body as `code`, so
// the editor showed boundary + Content-Disposition headers around the actual
// worker source. Parse it here so users don't have to redeploy the manager.
function cleanMultipart(raw: string): string {
  if (!raw) return "";
  if (!/Content-Disposition:\s*form-data/i.test(raw)) return raw;

  // Boundary = first non-empty line, must start with "--"
  const firstLineEnd = raw.search(/\r?\n/);
  if (firstLineEnd < 0) return raw;
  const boundary = raw.slice(0, firstLineEnd).trim();
  if (!boundary.startsWith("--")) return raw;

  // Split into parts, dropping preamble + closing epilogue
  const parts = raw.split(boundary).slice(1, -1);

  let jsBody = "";
  let fallback = "";
  for (const part of parts) {
    const headerEnd = part.search(/\r?\n\r?\n/);
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    let body = part.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
    // Trim trailing CRLF before the next boundary marker
    body = body.replace(/\r?\n$/, "");

    const filename = headers.match(/filename="([^"]+)"/i)?.[1] || "";
    const name = headers.match(/name="([^"]+)"/i)?.[1] || "";
    const partName = filename || name;

    if (/\.(m?js)$/i.test(partName) || partName === "worker.js") {
      jsBody = body;
      break;
    }
    if (partName && partName !== "metadata" && !fallback) fallback = body;
  }
  const out = (jsBody || fallback || raw).replace(/\r\n/g, "\n");
  return out.replace(/\s+$/, "") + "\n";
}

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
  const [subdomain, setSubdomain] = useState("");

  // ---- Editor state ----
  const [list, setList] = useState<WorkerRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selected, setSelected] = useState("");
  const [slug, setSlug] = useState("");
  const [code, setCode] = useState(STARTER);
  const [deploying, setDeploying] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState("");

  // Secrets
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [secretDraftKey, setSecretDraftKey] = useState("");
  const [secretDraftValue, setSecretDraftValue] = useState("");
  const [savingSecret, setSavingSecret] = useState(false);

  // Logs
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsStatus, setLogsStatus] = useState<LogsStatus>("idle");
  const logsWsRef = useRef<WebSocket | null>(null);

  // List filter
  const [filter, setFilter] = useState("");

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
      const h = await fetch(`${u}/health`).then((r) => r.json()).catch(() => null);
      if (!h?.ok) { toast.error("Health check failed"); setSavingCfg(false); return; }
      await set(ref(db, "cfManager/config"), { managerUrl: u, adminToken: t });
      setSavedUrl(u); setSavedToken(t);
      toast.success("Cloudflare connected");
      setShowSetup(false);
    } catch (e: any) { toast.error("Save failed: " + (e?.message || String(e))); }
    finally { setSavingCfg(false); }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Cloudflare manager?")) return;
    await set(ref(db, "cfManager/config"), null);
    setSavedUrl(""); setSavedToken(""); setManagerUrl(""); setAdminToken("");
    setList([]); setSelected(""); setSecrets([]); setHealth(null);
    toast.success("Disconnected");
    setShowSetup(true);
  };

  const loadHealth = async () => {
    if (!savedUrl) return;
    try {
      const h = await fetch(`${savedUrl.replace(/\/+$/, "")}/health`).then((r) => r.json());
      setHealth(h);
      if (savedToken) {
        const s = await call("subdomain");
        if (s.ok) setSubdomain(s.subdomain || "");
      }
    } catch (e: any) { setHealth({ ok: false, error: e?.message }); }
  };

  const loadList = async () => {
    if (!savedUrl || !savedToken) return;
    setLoadingList(true);
    try {
      const r = await call("list");
      if (!r.ok) { toast.error("Failed to load workers"); return; }
      setList((r.scripts || []).sort((a: any, b: any) =>
        (b.modified_on || "").localeCompare(a.modified_on || "")));
    } finally { setLoadingList(false); }
  };

  useEffect(() => { if (savedUrl && savedToken) { loadList(); loadHealth(); } /* eslint-disable-next-line */ }, [savedUrl, savedToken]);

  const openWorker = async (name: string) => {
    setSelected(name); setSlug(name); setCode("// loading…"); setSecrets([]);
    setResultUrl(subdomain ? `https://${name}.${subdomain}.workers.dev` : "");
    stopLogs();
    try {
      const r = await call("get", { name });
      if (r.ok) setCode(cleanMultipart(r.code || "") || STARTER);
      else { setCode(STARTER); toast.error("Failed to load code"); }
      loadSecrets(name);
    } catch (e: any) { toast.error(e.message); }
  };

  const newBlank = () => {
    setSelected(""); setSlug(""); setCode(STARTER); setSecrets([]); setResultUrl("");
    stopLogs();
  };

  const deploy = async () => {
    const name = slugify(slug);
    if (!name) { toast.error("Script name required"); return; }
    if (!code.trim()) { toast.error("Code is empty"); return; }
    setDeploying(true);
    try {
      const r = await call("deploy", { name, code });
      if (!r.ok) { toast.error("Deploy failed: " + JSON.stringify(r.error || r)); return; }
      toast.success(`Deployed: ${name}`);
      setResultUrl(r.url || "");
      setSelected(name);
      loadList();
    } catch (e: any) { toast.error(e.message); }
    finally { setDeploying(false); }
  };

  const removeWorker = async (name: string) => {
    if (!confirm(`Delete worker "${name}"?`)) return;
    setDeleting(name);
    try {
      const r = await call("delete", { name });
      if (!r.ok) { toast.error("Delete failed"); return; }
      toast.success("Deleted");
      if (selected === name) newBlank();
      loadList();
    } finally { setDeleting(null); }
  };

  const loadSecrets = async (name: string) => {
    if (!name) return;
    setLoadingSecrets(true);
    try {
      const r = await call("secrets-list", { name });
      if (r.ok) setSecrets(r.secrets || []);
    } finally { setLoadingSecrets(false); }
  };

  const saveSecret = async () => {
    if (!selected) { toast.error("Deploy or select a script first"); return; }
    const key = secretDraftKey.trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) { toast.error("Name: letters/digits/_ only"); return; }
    if (!secretDraftValue) { toast.error("Value required"); return; }
    setSavingSecret(true);
    try {
      const r = await call("secret-put", { name: selected, key, value: secretDraftValue });
      if (!r.ok) { toast.error("Save failed"); return; }
      toast.success(`Secret ${key} saved`);
      setSecretDraftKey(""); setSecretDraftValue("");
      loadSecrets(selected);
    } finally { setSavingSecret(false); }
  };

  const deleteSecret = async (key: string) => {
    if (!selected) return;
    if (!confirm(`Delete secret "${key}"?`)) return;
    const r = await call("secret-delete", { name: selected, key });
    if (!r.ok) { toast.error("Delete failed"); return; }
    toast.success("Secret deleted");
    loadSecrets(selected);
  };

  // ── Library ──
  const useLibrary = (entry: CfLibraryEntry) => {
    setSelected(""); setSlug(entry.slug); setCode(entry.source);
    setResultUrl("");
    toast.success(`Template loaded: ${entry.label}`);
    // scroll to name field
    setTimeout(() => document.getElementById("cf-name-input")?.focus(), 60);
  };

  // ── Logs ──
  const startLogs = async () => {
    if (!selected) { toast.error("Select a deployed script first"); return; }
    stopLogs();
    setLogLines([`[${new Date().toLocaleTimeString()}] Requesting tail for ${selected}…`]);
    setLogsStatus("connecting");
    try {
      const r = await call("logs", { name: selected });
      if (!r.ok || !r.tail?.url) {
        setLogLines((l) => [...l, `Failed: ${JSON.stringify(r.error || r)}`]);
        setLogsStatus("error"); return;
      }
      const wsUrl = r.tail.url.replace(/^http/, "ws");
      setLogLines((l) => [...l, `Connecting to ${wsUrl.split("?")[0]}…`]);
      // Cloudflare tail requires the trace-v1 subprotocol
      const ws = new WebSocket(wsUrl, "trace-v1");
      logsWsRef.current = ws;
      ws.onopen = () => {
        setLogsStatus("live");
        setLogLines((l) => [...l, `✔ Live. Waiting for requests…`]);
      };
      ws.onmessage = (ev) => {
        let msg = String(ev.data);
        try {
          const j = JSON.parse(ev.data);
          const outcome = j.outcome ? `[${j.outcome}]` : "";
          const req = j.event?.request ? `${j.event.request.method} ${j.event.request.url}` : "";
          const logs = (j.logs || []).map((x: any) => `  ${x.level}: ${(x.message || []).join(" ")}`).join("\n");
          const errs = (j.exceptions || []).map((x: any) => `  ⚠ ${x.name}: ${x.message}`).join("\n");
          msg = [`${new Date().toLocaleTimeString()} ${outcome} ${req}`, logs, errs].filter(Boolean).join("\n");
        } catch {}
        setLogLines((l) => [...l.slice(-500), msg]);
      };
      ws.onerror = () => { setLogsStatus("error"); setLogLines((l) => [...l, "WebSocket error"]); };
      ws.onclose = () => { setLogsStatus("closed"); setLogLines((l) => [...l, "— Tail closed —"]); };
    } catch (e: any) {
      setLogsStatus("error");
      setLogLines((l) => [...l, `Error: ${e?.message || e}`]);
    }
  };
  const stopLogs = () => {
    try { logsWsRef.current?.close(); } catch {}
    logsWsRef.current = null;
    if (logsStatus !== "idle") setLogsStatus("idle");
  };
  useEffect(() => () => stopLogs(), []); // eslint-disable-line

  const copy = (t: string, l = "Copied") => navigator.clipboard.writeText(t).then(() => toast.success(l));
  const downloadManagerCode = () => {
    const blob = new Blob([CF_MANAGER_WORKER_CODE], { type: "text/javascript" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "cf-manager-worker.js"; a.click();
    URL.revokeObjectURL(a.href);
  };

  const healthOk = health?.ok && health?.hasToken && health?.hasAccount && health?.hasAdmin;
  const filtered = useMemo(
    () => list.filter((w) => !filter || w.id.toLowerCase().includes(filter.toLowerCase())),
    [list, filter],
  );

  // Auto-track env var names from the code currently in the editor:
  // `env.XXX` with a `|| "fallback"` / `?? "fallback"` is optional, others required.
  const detectedEnv = useMemo(() => {
    const required = new Set<string>();
    const optional = new Set<string>();
    const re = /env\.([A-Z0-9_]{2,})\s*(\|\||\?\?)?\s*(["'`][^"'`\n]*["'`])?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const name = m[1];
      const hasFallback = !!(m[2] && m[3]);
      if (hasFallback) { if (!required.has(name)) optional.add(name); }
      else { required.add(name); optional.delete(name); }
    }
    return {
      required: Array.from(required).sort(),
      optional: Array.from(optional).sort(),
    };
  }, [code]);

  const setSecretNames = useMemo(() => new Set(secrets.map((s) => s.name)), [secrets]);


  // ═══════════════════════════════════════════
  // SETUP SCREEN
  // ═══════════════════════════════════════════
  if (showSetup) {
    return (
      <div className={`${glassCard} p-5 space-y-4`}>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/25">
            <Cloud size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-white">Connect Cloudflare</h3>
            <p className="text-[11px] text-zinc-400">Deploy one Manager Worker → paste URL + token below.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-3">
          <div className="text-sm text-orange-300 font-semibold flex items-center gap-2">
            <FileCode2 size={16} /> Step 1 — Deploy manager
          </div>
          <ol className="text-[12px] text-zinc-300 space-y-1 pl-5 list-decimal">
            <li>Cloudflare → <b>Workers &amp; Pages → Create → Worker</b> (e.g. <code className="text-orange-300">cf-manager</code>).</li>
            <li>Paste the code below, click <b>Deploy</b>.</li>
            <li><b>Settings → Variables and Secrets</b>, add: <code>CF_API_TOKEN</code>, <code>CF_ACCOUNT_ID</code>, <code>ADMIN_AUTH_TOKEN</code>.</li>
            <li>Click <b>Deploy</b> again. Open <code>/health</code> — all values must be <span className="text-emerald-300">true</span>.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => copy(CF_MANAGER_WORKER_CODE, "Manager code copied")} className={btnSecondary + " gap-2"}>
              <Copy size={14} /> Copy code
            </button>
            <button onClick={downloadManagerCode} className={btnSecondary + " gap-2"}>
              <Download size={14} /> Download .js
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-3">
          <div className="text-sm text-orange-300 font-semibold flex items-center gap-2">
            <LinkIcon size={16} /> Step 2 — Connect
          </div>
          <div>
            <label className="text-[11px] text-zinc-400">Manager URL</label>
            <input value={managerUrl} onChange={(e) => setManagerUrl(e.target.value)}
              placeholder="https://cf-manager.<sub>.workers.dev"
              className={inputClass + " font-mono text-[12px]"} />
          </div>
          <div>
            <label className="text-[11px] text-zinc-400">Admin token</label>
            <div className="relative">
              <input value={adminToken} onChange={(e) => setAdminToken(e.target.value)}
                type={showToken ? "text" : "password"}
                placeholder="ADMIN_AUTH_TOKEN"
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

  // ═══════════════════════════════════════════
  // MAIN — vertical flow, requested order
  // ═══════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* ── Top status strip ── */}
      <div className={`${glassCard} px-4 py-3 flex items-center gap-3 flex-wrap`}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
          <Cloud size={18} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white leading-tight">Cloudflare Manager</div>
          <div className="text-[10px] text-zinc-500 font-mono truncate">{savedUrl}</div>
        </div>
        <div className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border flex items-center gap-1 ${
          healthOk ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                   : "bg-rose-500/10 text-rose-300 border-rose-500/30"}`}>
          {healthOk ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          {healthOk ? "Live" : "Down"}
        </div>
        <button onClick={loadList} disabled={loadingList} title="Refresh"
          className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300">
          <RefreshCw size={14} className={loadingList ? "animate-spin" : ""} />
        </button>
        <button onClick={disconnect} title="Disconnect"
          className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300">
          <LogOut size={14} />
        </button>
      </div>

      {/* ─────────── 1. CODE LIBRARY ─────────── */}
      <section className={`${glassCard} p-4 space-y-3`}>
        <div className="flex items-center gap-2">
          <Library size={16} className="text-orange-300" />
          <h4 className="text-sm font-bold text-white">Code Library</h4>
          <span className="text-[10px] text-zinc-500">tap to load into editor</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {CF_WORKER_LIBRARY.map((e) => (
            <button key={e.slug} onClick={() => useLibrary(e)}
              className="group text-left rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-orange-500/40 transition-all p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-bold text-white truncate">{e.label}</div>
                {e.isNew && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">NEW</span>}
              </div>
              <div className="text-[10px] text-zinc-400 line-clamp-2 leading-tight">{e.description}</div>
              <div className="text-[9px] text-orange-300/80 font-mono">{e.slug}</div>
            </button>
          ))}
        </div>
      </section>

      {/* ─────────── 2. SCRIPT NAME ─────────── */}
      <section className={`${glassCard} p-4 space-y-2`}>
        <div className="flex items-center gap-2">
          <FileCode2 size={16} className="text-orange-300" />
          <h4 className="text-sm font-bold text-white">Script Name</h4>
          {selected && <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 font-mono">editing: {selected}</span>}
          <button onClick={newBlank} className="ml-auto text-[10px] text-zinc-400 hover:text-white flex items-center gap-1">
            <Plus size={11} /> new blank
          </button>
        </div>
        <input id="cf-name-input" value={slug} onChange={(e) => setSlug(e.target.value)}
          placeholder="my-worker-name"
          className={inputClass + " font-mono text-[13px]"} />
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 flex items-start gap-2 min-w-0">
          <LinkIcon size={12} className="text-orange-300 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[9px] uppercase tracking-wide text-zinc-500 font-semibold">Worker URL preview</div>
            <div className="font-mono text-[10.5px] leading-snug text-orange-300 break-all">
              {slug ? `https://${slugify(slug) || "…"}.${subdomain || "<sub>"}.workers.dev` : "—"}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── 3. CODE EDITOR ─────────── */}
      <section className={`${glassCard} p-4 space-y-2`}>
        <div className="flex items-center gap-2">
          <FileCode2 size={16} className="text-orange-300" />
          <h4 className="text-sm font-bold text-white">Worker Code</h4>
          <span className="text-[10px] text-zinc-500 ml-auto">{code.length.toLocaleString()} chars</span>
          <button onClick={() => copy(code, "Code copied")} className="text-zinc-400 hover:text-white">
            <Copy size={13} />
          </button>
        </div>
        <textarea value={code} onChange={(e) => setCode(e.target.value)}
          spellCheck={false} autoCorrect="off" autoCapitalize="off"
          className="w-full h-[420px] rounded-xl border border-white/10 bg-[#0a0a0f] text-emerald-100
                     font-mono text-[12px] leading-[1.55] p-3 resize-y
                     focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30"
          style={{ tabSize: 2 }} />
        <div className="flex gap-2 flex-wrap">
          <button onClick={deploy} disabled={deploying}
            className={btnPrimary + " gap-2 flex-1 min-w-[160px]"}>
            {deploying ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
            {deploying ? "Deploying…" : selected ? "Redeploy" : "Deploy"}
          </button>
          {resultUrl && (
            <>
              <button onClick={() => copy(resultUrl, "URL copied")} className={btnSecondary + " gap-2"}>
                <Copy size={13} /> URL
              </button>
              <a href={resultUrl} target="_blank" rel="noopener noreferrer" className={btnSecondary + " gap-2"}>
                <ExternalLink size={13} /> Open
              </a>
            </>
          )}
        </div>
        {resultUrl && (
          <div className="text-[11px] font-mono text-emerald-300 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2 truncate">
            {resultUrl}
          </div>
        )}
      </section>

      {/* ─────────── 4. ENV VALUES (SECRETS) ─────────── */}
      <section className={`${glassCard} p-4 space-y-3`}>
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-orange-300" />
          <h4 className="text-sm font-bold text-white">Env Values</h4>
          <span className="text-[10px] text-zinc-500 ml-auto">
            {selected ? `for ${selected}` : "select a deployed script"}
          </span>
        </div>

        {(detectedEnv.required.length > 0 || detectedEnv.optional.length > 0) && (
          <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3 space-y-2">
            <div className="text-[11px] font-semibold text-orange-200">
              Detected in code — tap a name to fill the key field
            </div>
            <div className="flex flex-wrap gap-1.5">
              {detectedEnv.required.map((n) => {
                const done = setSecretNames.has(n);
                return (
                  <button key={n} onClick={() => setSecretDraftKey(n)}
                    className={`font-mono text-[10px] px-2 py-1 rounded-lg border transition ${
                      done
                        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                        : "bg-rose-500/10 text-rose-200 border-rose-500/30 hover:bg-rose-500/20"
                    }`}>
                    {done ? "✔" : "•"} {n}
                  </button>
                );
              })}
              {detectedEnv.optional.map((n) => (
                <button key={n} onClick={() => setSecretDraftKey(n)}
                  className={`font-mono text-[10px] px-2 py-1 rounded-lg border transition ${
                    setSecretNames.has(n)
                      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                      : "bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10"
                  }`}>
                  {setSecretNames.has(n) ? "✔" : "○"} {n} <span className="opacity-60">opt</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {selected ? (
          <>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
              <input value={secretDraftKey} onChange={(e) => setSecretDraftKey(e.target.value.toUpperCase())}
                placeholder="KEY_NAME" className={inputClass + " font-mono text-[12px]"} />
              <input value={secretDraftValue} onChange={(e) => setSecretDraftValue(e.target.value)}
                placeholder="value" type="password"
                className={inputClass + " font-mono text-[12px]"} />
              <button onClick={saveSecret} disabled={savingSecret} className={btnPrimary + " gap-2"}>
                {savingSecret ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 divide-y divide-white/5">
              {loadingSecrets ? (
                <div className="p-3 text-[11px] text-zinc-500 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Loading…
                </div>
              ) : secrets.length === 0 ? (
                <div className="p-3 text-[11px] text-zinc-500">No env values set.</div>
              ) : secrets.map((s) => (
                <div key={s.name} className="px-3 py-2 flex items-center gap-2">
                  <KeyRound size={11} className="text-orange-300/70" />
                  <span className="font-mono text-[12px] text-white flex-1 truncate">{s.name}</span>
                  <span className="text-[9px] text-zinc-500 uppercase">{s.type || "secret"}</span>
                  <button onClick={() => deleteSecret(s.name)}
                    className="text-rose-400 hover:text-rose-300 p-1">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-[11px] text-zinc-500 py-4 text-center border border-dashed border-white/10 rounded-xl">
            Deploy first, or select a script from the list below.
          </div>
        )}
      </section>

      {/* ─────────── 5. LOGS ─────────── */}
      <section className={`${glassCard} p-4 space-y-2`}>
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-orange-300" />
          <h4 className="text-sm font-bold text-white">Live Logs</h4>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
            logsStatus === "live" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
            : logsStatus === "connecting" ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
            : logsStatus === "error" ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
            : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
          }`}>{logsStatus}</span>
          <div className="ml-auto flex gap-2">
            {logsStatus === "idle" || logsStatus === "closed" || logsStatus === "error" ? (
              <button onClick={startLogs} disabled={!selected} className={btnSecondary + " gap-1.5 text-[11px] py-1.5 px-3"}>
                <Terminal size={12} /> Start
              </button>
            ) : (
              <button onClick={stopLogs} className={btnSecondary + " gap-1.5 text-[11px] py-1.5 px-3"}>
                <X size={12} /> Stop
              </button>
            )}
            {logLines.length > 0 && (
              <button onClick={() => setLogLines([])} className="text-[11px] text-zinc-400 hover:text-white">
                clear
              </button>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#050508] p-2.5 h-[220px] overflow-y-auto overflow-x-hidden
                        font-mono text-[11px] leading-[1.55] text-emerald-200/90 whitespace-pre-wrap break-words">
          {logLines.length === 0
            ? <div className="h-full grid place-items-center text-center text-zinc-600 px-4">{selected ? "Press Start to tail live requests…" : "Select a deployed script to view logs."}</div>
            : logLines.map((l, i) => (
              <div key={i} className="rounded-lg px-2 py-1.5 mb-1 bg-white/[0.025] border border-white/[0.04] break-words [overflow-wrap:anywhere]">
                {l}
              </div>
            ))}
        </div>
      </section>

      {/* ─────────── 6. DEPLOYED SCRIPTS ─────────── */}
      <section className={`${glassCard} p-4 space-y-3 overflow-hidden`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Cloud size={16} className="text-orange-300 shrink-0" />
          <h4 className="text-sm font-bold text-white">Deployed Scripts</h4>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/5 text-zinc-400 font-mono">{list.length}</span>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="filter scripts…"
            className={inputClass + " pl-8 text-[12px]"} />
        </div>

        {loadingList ? (
          <div className="text-[11px] text-zinc-500 flex items-center gap-2 p-3">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-[11px] text-zinc-500 py-6 text-center border border-dashed border-white/10 rounded-xl">
            No scripts yet. Deploy one from the library above.
          </div>
        ) : (
          <div className="grid gap-2">
            {filtered.map((w) => {
              const active = selected === w.id;
              const url = subdomain ? `https://${w.id}.${subdomain}.workers.dev` : "";
              const isDeleting = deleting === w.id;
              return (
                <div key={w.id}
                  className={`rounded-xl border px-3 py-2.5 space-y-2 transition-all overflow-hidden ${
                    active ? "border-orange-500/50 bg-orange-500/[0.06]"
                           : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"}`}>
                  <button onClick={() => openWorker(w.id)} className="w-full min-w-0 text-left flex items-start gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${active ? "bg-orange-400" : "bg-emerald-400/70"}`} />
                    <span className="min-w-0 flex-1 block">
                      <span className="block text-[12.5px] font-bold text-white truncate">{w.id}</span>
                      {url && <span className="block text-[9.5px] font-mono text-orange-300/70 truncate">{url}</span>}
                    </span>
                  </button>
                  <div className="grid grid-cols-4 gap-1.5 min-w-0">
                    <a href={url || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!url}
                      onClick={(e) => { if (!url) e.preventDefault(); }} title="Open URL"
                      className={`h-8 rounded-lg border flex items-center justify-center gap-1 text-[10.5px] font-semibold min-w-0 ${
                        url ? "bg-white/5 hover:bg-white/10 border-white/10 text-zinc-200" : "bg-white/[0.02] border-white/5 text-zinc-600 pointer-events-none"
                      }`}>
                      <ExternalLink size={11} className="shrink-0" /> <span className="truncate">Open</span>
                    </a>
                    <button onClick={() => openWorker(w.id)} title="Edit"
                      className="h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center gap-1 text-[10.5px] font-semibold text-zinc-200 min-w-0">
                      <FileCode2 size={11} className="shrink-0" /> <span className="truncate">Edit</span>
                    </button>
                    <button onClick={() => url && copy(url, "URL copied")} disabled={!url} title="Copy URL"
                      className="h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center gap-1 text-[10.5px] font-semibold text-zinc-200 disabled:opacity-40 min-w-0">
                      <Copy size={11} className="shrink-0" /> <span className="truncate">Copy</span>
                    </button>
                    <button onClick={() => removeWorker(w.id)} disabled={isDeleting} title="Delete"
                      className="h-8 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 flex items-center justify-center gap-1 text-[10.5px] font-semibold text-rose-300 disabled:opacity-50 min-w-0">
                      {isDeleting ? <Loader2 size={11} className="animate-spin shrink-0" /> : <Trash2 size={11} className="shrink-0" />}
                      <span className="truncate">Delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
