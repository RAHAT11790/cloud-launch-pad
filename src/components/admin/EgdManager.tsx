import { useEffect, useMemo, useState } from "react";
import {
  Bot, Copy, Loader2, Plus, RefreshCw, Rocket, Trash2, X, FileCode2, KeyRound,
  Link as LinkIcon, ExternalLink, Settings, CheckCircle2, AlertCircle, Download,
  Library, Search, Save, Terminal, LogOut, Eye, EyeOff, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { db, ref, onValue, set } from "@/lib/firebase";
import { EGD_DEPLOYER_CODE } from "@/lib/egdDeployerCode";
import { EDGE_FUNCTION_LIBRARY } from "@/lib/edgeFunctionCodeLibrary";

// Library is curated to admin self-deployable functions only.

/**
 * EGD MANAGER
 * ───────────
 * 1. User deploys the EGD Deployer function (code shown here) to their own
 *    Supabase project, sets EGD_SUPABASE_PAT secret, and pastes the URL here.
 * 2. After saving the deployer URL, this UI uses it to deploy/list/delete
 *    arbitrary edge functions in that project — all from the admin panel.
 *
 * Storage: Firebase  egdManager/config = { deployerUrl }
 */

type FnRow = {
  id: string;
  slug: string;
  name: string;
  status?: string;
  version?: number;
  updated_at?: number;
};

type SecretRow = { name: string; value: string };
type LogRow = { timestamp?: string; event_message?: string; source?: string };

const LOG_WINDOWS = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
];

const STARTER = `// New Edge Function
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  return new Response(JSON.stringify({ ok: true, msg: "Hello from EGD" }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
`;

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 50);

const parseMultipartFiles = (body: string, contentType: string) => {
  const boundary =
    contentType.match(/boundary=([^;]+)/i)?.[1]?.replace(/^"|"$/g, "") ||
    body.match(/^--([^\r\n-][^\r\n]*)/m)?.[1] ||
    "";
  if (!boundary || !body.includes(boundary)) return [] as Array<{ filename: string; content: string }>;

  return body
    .split(`--${boundary}`)
    .map((part) => part.trim())
    .filter((part) => part && part !== "--")
    .map((part) => {
      const [rawHeaders, ...rest] = part.split(/\r?\n\r?\n/);
      const content = rest.join("\n\n").replace(/\r?\n--$/, "").trim();
      const filename = rawHeaders.match(/filename="([^"]+)"/i)?.[1] || "";
      return { filename, content };
    })
    .filter((file) => file.filename && file.content);
};

const extractEszipSource = (body: string) => {
  const metadataIdx = body.indexOf("---EDGE-RUNTIME-METADATA---");
  const searchZone = metadataIdx >= 0 ? body.slice(metadataIdx) : body;
  const cleaned = searchZone.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, "\n");
  const startMarkers = ["\n//", "\nimport ", "\nexport ", "\nconst ", "\nlet ", "\nvar ", "\nDeno.serve", "\nserve("];
  const markerHits = startMarkers
    .map((marker) => cleaned.indexOf(marker))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b);

  if (markerHits.length === 0) return "";

  const start = markerHits[0] + 1;
  const tailMarkers = [
    "\nsource/index.ts{\"import_map\"",
    "\n2.0source/index.ts{\"import_map\"",
    "\nuser_fn_",
    "\nfile:///tmp/user_fn_",
  ];
  const tailHits = tailMarkers
    .map((marker) => cleaned.indexOf(marker, start))
    .filter((idx) => idx > start)
    .sort((a, b) => a - b);

  const candidate = (tailHits.length > 0 ? cleaned.slice(start, tailHits[0]) : cleaned.slice(start))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!candidate) return "";
  if (!/(Deno\.serve|serve\(|export\s+|import\s+|const\s+|let\s+|var\s+|async\s+)/.test(candidate)) return "";
  return candidate;
};

const normalizeFunctionBody = (body: string, contentType = "") => {
  const files = parseMultipartFiles(body, contentType);
  if (files.length > 0) {
    const preferred =
      files.find((file) => /(^|\/)index\.(ts|tsx|js|jsx)$/i.test(file.filename)) ||
      files[0];

    return {
      mode: "source" as const,
      code: preferred.content,
      note: files.length > 1 ? `${files.length} files found · showing ${preferred.filename}` : `Showing ${preferred.filename}`,
    };
  }

  if (body.startsWith("ESZIP")) {
    const extracted = extractEszipSource(body);
    if (extracted) {
      return {
        mode: "source" as const,
        code: extracted,
        note: "Recovered source from deployed ESZIP bundle",
      };
    }
  }

  const looksBinary = body.startsWith("ESZIP") || /[\x00-\x08\x0E-\x1F]/.test(body.slice(0, 200));
  if (looksBinary) {
    return {
      mode: "bundle" as const,
      code:
        `// ⚠️ This function was deployed as a compiled bundle (ESZIP).\n` +
        `// Source code cannot be recovered from the deployed bundle.\n` +
        `//\n` +
        `// Paste fresh source here, then click Deploy to replace it.\n\n` +
        STARTER,
      note: "Compiled bundle — paste fresh source to replace",
    };
  }

  return { mode: "source" as const, code: body || "// (empty body)", note: "" };
};

export default function EgdManager({
  glassCard, inputClass, btnPrimary, btnSecondary,
}: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) {
  // --- Deployer config ---
  const [deployerUrl, setDeployerUrl] = useState("");
  const [savedDeployerUrl, setSavedDeployerUrl] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  // (Player Proxy URL moved to EGD Router — single source of truth there.)

  // --- Function editor state ---
  const [list, setList] = useState<FnRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [slug, setSlug] = useState("");
  const [code, setCode] = useState(STARTER);
  const [secrets, setSecrets] = useState<SecretRow[]>([{ name: "", value: "" }]);
  const [deploying, setDeploying] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState("");
  const [errorLog, setErrorLog] = useState("");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logsWindow, setLogsWindow] = useState(60);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [sourceHint, setSourceHint] = useState("");
  const [logStartAt, setLogStartAt] = useState("");
  const [logEndAt, setLogEndAt] = useState("");
  const [projectSecrets, setProjectSecrets] = useState<string[]>([]);
  const [selectedProjectSecret, setSelectedProjectSecret] = useState<string>("");
  const [projectSecretDraft, setProjectSecretDraft] = useState<string>("");
  const [showProjectSecretValues, setShowProjectSecretValues] = useState(false);
  const [savingProjectSecret, setSavingProjectSecret] = useState<string | null>(null);
  const [deletingProjectSecret, setDeletingProjectSecret] = useState<string | null>(null);

  // ---------- Load deployer URL ----------
  useEffect(() => {
    const r = ref(db, "egdManager/config/deployerUrl");
    return onValue(r, (snap) => {
      const v = (snap.val() as string) || "";
      setDeployerUrl(v);
      setSavedDeployerUrl(v);
      setShowSetup(!v);
    });
  }, []);

  // ---------- (Player proxy URL is configured in EGD Router) ----------





  const appendError = (msg: string) =>
    setErrorLog((prev) => `[${new Date().toLocaleTimeString()}] ${msg}\n` + prev);


  // ---------- Call deployer endpoint ----------
  const callDeployer = async (action: string, body: any = {}) => {
    if (!savedDeployerUrl) throw new Error("Deployer URL not configured");
    const base = savedDeployerUrl.replace(/\/+$/, "");
    const r = await fetch(`${base}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let d: any;
    try { d = JSON.parse(text); } catch { d = { ok: false, error: text }; }
    return { httpOk: r.ok, status: r.status, ...d };
  };

  // ---------- Save deployer URL ----------
  const saveDeployerUrl = async () => {
    const u = deployerUrl.trim();
    if (!u) { toast.error("URL required"); return; }
    if (!/^https?:\/\//.test(u)) { toast.error("Must start with https://"); return; }
    setSavingUrl(true);
    try {
      await set(ref(db, "egdManager/config/deployerUrl"), u);
      setSavedDeployerUrl(u);
      toast.success("Deployer URL saved ✔");
      setShowSetup(false);
      // immediately probe
      setTimeout(loadList, 300);
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || String(e)));
    } finally { setSavingUrl(false); }
  };

  const copyText = (txt: string, label = "Copied") =>
    navigator.clipboard.writeText(txt).then(() => toast.success(label));

  const downloadDeployerCode = () => {
    const blob = new Blob([EGD_DEPLOYER_CODE], { type: "text/typescript" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "egd-deployer.index.ts";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---------- Function list ops ----------
  const loadList = async () => {
    if (!savedDeployerUrl) return;
    setLoadingList(true);
    try {
      const d = await callDeployer("list");
      if (d?.ok) {
        const arr: any[] = Array.isArray(d.functions) ? d.functions : [];
        setList(arr.map((f) => ({
          id: f.id, slug: f.slug, name: f.name || f.slug,
          status: f.status, version: f.version, updated_at: f.updated_at,
        })));
      } else {
        appendError("List failed: " + JSON.stringify(d?.error || d));
      }
    } catch (e: any) {
      appendError("Network: " + (e?.message || String(e)));
    } finally { setLoadingList(false); }
  };

  const loadProjectSecrets = async () => {
    if (!savedDeployerUrl) return;
    setLoadingSecrets(true);
    try {
      const d = await callDeployer("secrets");
      if (d?.ok) {
        const names = Array.isArray(d.names) ? d.names : [];
        setProjectSecrets(names);
        // If the currently-selected secret was removed, clear selection
        if (selectedProjectSecret && !names.includes(selectedProjectSecret)) {
          setSelectedProjectSecret("");
          setProjectSecretDraft("");
        }
      } else {
        appendError("Secrets failed: " + JSON.stringify(d?.error || d));
      }
    } catch (e: any) {
      appendError("Secrets network: " + (e?.message || String(e)));
    } finally {
      setLoadingSecrets(false);
    }
  };

  const saveProjectSecretValue = async () => {
    const name = selectedProjectSecret;
    const value = projectSecretDraft.trim();
    if (!name) { toast.error("Pick a secret first"); return; }
    if (!value) { toast.error(`Paste a new value for ${name}`); return; }
    setSavingProjectSecret(name);
    try {
      const d = await callDeployer("secret-update", { name, value });
      if (d?.ok) {
        toast.success(`${name} updated`);
        setProjectSecretDraft("");
        await loadProjectSecrets();
      } else {
        toast.error("Secret update failed");
        appendError("Secret update failed: " + JSON.stringify(d?.error || d));
      }
    } catch (e: any) {
      toast.error("Secret update failed");
      appendError("Secret update network: " + (e?.message || String(e)));
    } finally { setSavingProjectSecret(null); }
  };

  const deleteProjectSecretValue = async (name: string) => {
    if (!confirm(`Delete project secret "${name}"? The functions using it may stop working until you add it again.`)) return;
    setDeletingProjectSecret(name);
    try {
      const d = await callDeployer("secret-delete", { names: [name] });
      if (d?.ok) {
        toast.success(`${name} deleted`);
        if (selectedProjectSecret === name) {
          setSelectedProjectSecret("");
          setProjectSecretDraft("");
        }
        await loadProjectSecrets();
      } else {
        toast.error("Secret delete failed");
        appendError("Secret delete failed: " + JSON.stringify(d?.error || d));
      }
    } catch (e: any) {
      toast.error("Secret delete failed");
      appendError("Secret delete network: " + (e?.message || String(e)));
    } finally { setDeletingProjectSecret(null); }
  };





  useEffect(() => {
    if (!savedDeployerUrl) return;
    loadList();
    loadProjectSecrets();
  }, [savedDeployerUrl]);

  const loadFn = async (s: string) => {
    setSelected(s);
    setSourceHint("");
    setSlug(s);
    setSecrets([{ name: "", value: "" }]);
    const supaRef = savedDeployerUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
    if (supaRef) setResultUrl(`https://${supaRef}.supabase.co/functions/v1/${s}`);

    try {
      const d = await callDeployer("get", { slug: s });
      if (d?.ok && d.fn) {
        setSlug(d.fn.slug || s);
        const body: string = d.fn.body || "";
        if (body) {
          const normalized = normalizeFunctionBody(body, d.fn.contentType || "");
          if (normalized.mode === "source") {
            setCode(normalized.code);
            setSourceHint(normalized.note);
          } else {
            setCode(normalized.code);
            setSourceHint(normalized.note);
            toast.info(normalized.note);
          }
        } else {
          setCode(STARTER);
          setSourceHint("No source returned from backend. Paste code and deploy.");
        }
      } else {
        appendError("Get failed: " + JSON.stringify(d?.error || d));
        setCode(STARTER);
        setSourceHint("Could not fetch source from backend deployer.");
      }
    } catch (e: any) {
      appendError("Network: " + (e?.message || String(e)));
    }

    loadProjectSecrets();
    loadLogs(s, logsWindow);
  };

  const addSecretRow = () => setSecrets((p) => [...p, { name: "", value: "" }]);
  const removeSecretRow = (i: number) =>
    setSecrets((p) => p.filter((_, idx) => idx !== i));
  const updateSecret = (i: number, k: "name" | "value", v: string) =>
    setSecrets((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const deploy = async () => {
    if (!savedDeployerUrl) { toast.error("Save deployer URL first"); setShowSetup(true); return; }
    if (!slug.trim()) { toast.error("Function name required"); return; }
    if (!code.trim()) { toast.error("Code is empty"); return; }
    setDeploying(true);
    setErrorLog(""); setResultUrl("");
    try {
      const cleanSecrets = secrets
        .map((s) => ({ name: s.name.trim(), value: s.value }))
        .filter((s) => s.name.length > 0);
      const d = await callDeployer("deploy", {
        slug: slugify(slug), code, secrets: cleanSecrets,
      });
      if (d?.ok) {
        toast.success("Deployed ✔");
        setResultUrl(d.url || "");
        if (d.url) toast.success("Copy this URL and paste it in EGD Router to activate it.");
        await loadList();
        await loadProjectSecrets();
      } else {
        const msg = `Stage: ${d?.stage || "?"} | ${typeof d?.error === "string" ? d.error : JSON.stringify(d?.error || d)}`;
        toast.error("Deploy failed");
        appendError(msg);
      }
    } catch (e: any) {
      toast.error("Network error");
      appendError("Network: " + (e?.message || String(e)));
    } finally { setDeploying(false); }
  };

  const removeFn = async (s: string) => {
    if (!confirm(`Delete edge function "${s}"? This is permanent.`)) return;
    setDeleting(s);
    try {
      const d = await callDeployer("delete", { slug: s });
      if (d?.ok) {
        toast.success("Deleted");
        if (selected === s) { setSelected(""); setSlug(""); setCode(STARTER); setResultUrl(""); }
        loadList();
      } else { toast.error("Delete failed"); appendError(JSON.stringify(d?.error || d)); }
    } finally { setDeleting(null); }
  };

  const newDraft = () => {
    setSelected(""); setSlug(""); setCode(STARTER);
    setSecrets([{ name: "", value: "" }]); setResultUrl(""); setErrorLog("");
    setLogs([]); setSourceHint("Blank draft — pick a function name and paste code, then Deploy.");
    toast.success("New draft ready");
    if (typeof window !== "undefined") {
      setTimeout(() => {
        document
          .querySelector('[data-egd-editor-anchor="true"]')
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  };

  const openSetup = () => {
    setShowSetup(true);
    if (typeof window !== "undefined") {
      setTimeout(() => {
        document
          .querySelector('[data-egd-setup-anchor="true"]')
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  };

  const loadLogs = async (targetSlug = selected, minutes = logsWindow, startAt = logStartAt, endAt = logEndAt) => {
    if (!savedDeployerUrl) return;
    setLoadingLogs(true);
    try {
      const d = await callDeployer("logs", { slug: targetSlug, minutes, startAt, endAt });
      if (d?.ok) {
        setLogs(Array.isArray(d.rows) ? d.rows : []);
      } else {
        const errStr = typeof d?.error === "string" ? d.error : JSON.stringify(d?.error || d);
        if (d?.status === 404 || /unknown action/i.test(errStr)) {
          setLogs([]);
          appendError("Logs unavailable: deployer is outdated. Open Setup → copy fresh code → redeploy egd-deployer in Supabase.");
        } else {
          appendError("Logs failed: " + errStr);
        }
      }
    } catch (e: any) {
      appendError("Logs network: " + (e?.message || String(e)));
    } finally {
      setLoadingLogs(false);
    }
  };

  const sortedList = useMemo(
    () => [...list].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)),
    [list],
  );

  const isConfigured = !!savedDeployerUrl;

  // ---- filter for deployed list ----
  const [filter, setFilter] = useState("");
  const filtered = useMemo(
    () => sortedList.filter((f) => !filter || f.slug.toLowerCase().includes(filter.toLowerCase())),
    [sortedList, filter],
  );

  const disconnect = async () => {
    if (!confirm("Disconnect EGD deployer? URL will be cleared.")) return;
    await set(ref(db, "egdManager/config/deployerUrl"), null);
    setSavedDeployerUrl(""); setDeployerUrl("");
    setList([]); setSelected(""); setProjectSecrets([]);
    toast.success("Disconnected");
    setShowSetup(true);
  };

  // ═══════════════════════════════════════════
  // SETUP SCREEN — early return, like CF Manager
  // ═══════════════════════════════════════════
  if (showSetup) {
    return (
      <div data-egd-setup-anchor="true" className={`${glassCard} p-5 space-y-4`}>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center shadow-lg shadow-amber-500/25">
            <Rocket size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-white">Connect EGD Deployer</h3>
            <p className="text-[11px] text-zinc-400">Deploy one Deployer function → paste its URL below.</p>
          </div>
          {isConfigured && (
            <button
              onClick={() => setShowSetup(false)}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300"
              title="Close"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-3">
          <div className="text-sm text-amber-300 font-semibold flex items-center gap-2">
            <FileCode2 size={16} /> Step 1 — Deploy the deployer
          </div>
          <ol className="text-[12px] text-zinc-300 space-y-1 pl-5 list-decimal">
            <li>Backend → <b>Edge Functions → Create function</b> named <code className="text-amber-300">egd-deployer</code>.</li>
            <li>Paste the code below, then Deploy.</li>
            <li>Function <b>Settings → Verify JWT = OFF</b>.</li>
            <li>Add project secret <code>EGD_SUPABASE_PAT</code> = your Personal Access Token.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => copyText(EGD_DEPLOYER_CODE, "Deployer code copied")} className={btnSecondary + " gap-2"}>
              <Copy size={14} /> Copy code
            </button>
            <button onClick={downloadDeployerCode} className={btnSecondary + " gap-2"}>
              <Download size={14} /> Download .ts
            </button>
          </div>
          <textarea
            readOnly
            value={EGD_DEPLOYER_CODE}
            className="w-full h-[200px] rounded-xl border border-white/10 bg-[#0a0a0f] text-emerald-100 font-mono text-[10.5px] leading-[1.55] p-3 resize-y"
            spellCheck={false}
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-3">
          <div className="text-sm text-amber-300 font-semibold flex items-center gap-2">
            <LinkIcon size={16} /> Step 2 — Connect
          </div>
          <div>
            <label className="text-[11px] text-zinc-400">Deployer Function URL</label>
            <input
              value={deployerUrl}
              onChange={(e) => setDeployerUrl(e.target.value)}
              placeholder="https://xxxx.supabase.co/functions/v1/egd-deployer"
              className={inputClass + " font-mono text-[12px]"}
            />
          </div>
          <button disabled={savingUrl} onClick={saveDeployerUrl} className={btnPrimary + " gap-2 w-full"}>
            {savingUrl ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {savingUrl ? "Saving…" : "Save & Connect"}
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // MAIN — vertical flow (mirrors Cloudflare Manager)
  // ═══════════════════════════════════════════
  const supaRef = savedDeployerUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || "";
  const previewFnUrl = slug && supaRef ? `https://${supaRef}.supabase.co/functions/v1/${slugify(slug)}` : "";

  return (
    <div className="space-y-4">
      {/* ── Top status strip ── */}
      <div className={`${glassCard} px-4 py-3 flex items-center gap-3 flex-wrap`}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center">
          <Rocket size={18} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white leading-tight">EGD Manager</div>
          <div className="text-[10px] text-zinc-500 font-mono truncate">{savedDeployerUrl}</div>
        </div>
        <div className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border flex items-center gap-1 ${
          isConfigured ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                       : "bg-rose-500/10 text-rose-300 border-rose-500/30"}`}>
          {isConfigured ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          {isConfigured ? "Live" : "Down"}
        </div>
        <button onClick={loadList} disabled={loadingList} title="Refresh"
          className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300">
          <RefreshCw size={14} className={loadingList ? "animate-spin" : ""} />
        </button>
        <button onClick={openSetup} title="Setup"
          className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300">
          <Settings size={14} />
        </button>
        <button onClick={disconnect} title="Disconnect"
          className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300">
          <LogOut size={14} />
        </button>
      </div>

      {/* ─────────── 1. CODE LIBRARY ─────────── */}
      <section className={`${glassCard} p-4 space-y-3`}>
        <div className="flex items-center gap-2">
          <Library size={16} className="text-amber-300" />
          <h4 className="text-sm font-bold text-white">Code Library</h4>
          <span className="text-[10px] text-zinc-500">tap to load into editor</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {EDGE_FUNCTION_LIBRARY.map((entry) => (
            <button
              key={entry.slug}
              type="button"
              onClick={() => {
                setSelected("");
                setSlug(entry.slug);
                setCode(entry.source);
                setSecrets(
                  entry.secrets.length > 0
                    ? entry.secrets.map((name) => ({ name, value: "" }))
                    : [{ name: "", value: "" }],
                );
                setResultUrl("");
                setErrorLog("");
                setSourceHint(
                  entry.secrets.length === 0
                    ? `Loaded "${entry.label}" — no secrets required.`
                    : `Loaded "${entry.label}" — fill ${entry.secrets.length} secret(s) below, then Deploy.`,
                );
                toast.success(`Loaded: ${entry.label}`);
                setTimeout(() => {
                  document.getElementById("egd-name-input")?.focus();
                }, 60);
              }}
              className="group text-left rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-amber-500/40 transition-all p-3 space-y-1.5 min-w-0"
            >
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="text-[12px] font-bold text-white truncate flex-1 min-w-0">{entry.label}</div>
                {(entry.badgeText || entry.isNew) && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                    entry.badgeTone === "cyan" ? "bg-cyan-500/20 text-cyan-300" :
                    entry.badgeTone === "amber" ? "bg-amber-500/20 text-amber-300" :
                    "bg-emerald-500/20 text-emerald-300"
                  }`}>
                    {entry.badgeText || "NEW"}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-zinc-400 line-clamp-2 leading-tight">{entry.description}</div>
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="text-[9px] text-amber-300/80 font-mono truncate flex-1 min-w-0">{entry.slug}</div>
                {entry.secrets.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-300/90 shrink-0">
                    <KeyRound size={9} /> {entry.secrets.length}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ─────────── 2. SCRIPT NAME ─────────── */}
      <section className={`${glassCard} p-4 space-y-2`}>
        <div className="flex items-center gap-2">
          <FileCode2 size={16} className="text-amber-300" />
          <h4 className="text-sm font-bold text-white">Function Name</h4>
          {selected && <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 font-mono">editing: {selected}</span>}
          <button onClick={newDraft} className="ml-auto text-[10px] text-zinc-400 hover:text-white flex items-center gap-1">
            <Plus size={11} /> new blank
          </button>
        </div>
        <input
          id="egd-name-input"
          value={slug}
          onChange={(e) => setSlug(slugify(e.target.value))}
          disabled={!!selected}
          placeholder="my-function-slug"
          className={inputClass + " font-mono text-[13px]"}
        />
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 flex items-start gap-2 min-w-0">
          <LinkIcon size={12} className="text-amber-300 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[9px] uppercase tracking-wide text-zinc-500 font-semibold">Function URL preview</div>
            <div className="font-mono text-[10.5px] leading-snug text-amber-300 break-all">
              {previewFnUrl || "—"}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── 3. CODE EDITOR + DEPLOY ─────────── */}
      <section data-egd-editor-anchor="true" className={`${glassCard} p-4 space-y-2`}>
        <div className="flex items-center gap-2">
          <FileCode2 size={16} className="text-amber-300" />
          <h4 className="text-sm font-bold text-white">Function Code</h4>
          <span className="text-[10px] text-zinc-500 ml-auto">{code.length.toLocaleString()} chars</span>
          <button onClick={() => copyText(code, "Code copied")} className="text-zinc-400 hover:text-white">
            <Copy size={13} />
          </button>
        </div>
        {sourceHint && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 break-words">
            {sourceHint}
          </div>
        )}
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="w-full h-[420px] rounded-xl border border-white/10 bg-[#0a0a0f] text-emerald-100
                     font-mono text-[12px] leading-[1.55] p-3 resize-y
                     focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
          style={{ tabSize: 2 }}
        />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={deploy}
            disabled={deploying || !isConfigured}
            className={btnPrimary + " gap-2 flex-1 min-w-[160px]"}
          >
            {deploying ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
            {deploying ? "Deploying…" : selected ? "Redeploy" : "Deploy"}
          </button>
          {resultUrl && (
            <>
              <button onClick={() => copyText(resultUrl, "URL copied")} className={btnSecondary + " gap-2"}>
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
        {errorLog && (
          <details className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2">
            <summary className="text-[11px] text-rose-300 cursor-pointer font-semibold">Deploy errors ({errorLog.split("\n").filter(Boolean).length})</summary>
            <pre className="mt-2 font-mono text-[10.5px] text-rose-200/90 whitespace-pre-wrap break-words max-h-[160px] overflow-auto">{errorLog}</pre>
          </details>
        )}
      </section>

      {/* ─────────── 4. ENV VALUES ─────────── */}
      <section className={`${glassCard} p-4 space-y-3`}>
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-amber-300" />
          <h4 className="text-sm font-bold text-white">Env Values</h4>
          <span className="text-[10px] text-zinc-500 ml-auto">project-wide secrets</span>
          <button
            onClick={() => setShowProjectSecretValues((v) => !v)}
            className="text-zinc-400 hover:text-white"
            title={showProjectSecretValues ? "Hide values" : "Show values"}
          >
            {showProjectSecretValues ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            onClick={loadProjectSecrets}
            disabled={loadingSecrets}
            className="text-zinc-400 hover:text-white"
            title="Refresh"
          >
            {loadingSecrets ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />}
          </button>
        </div>

        {/* Bulk secret rows for deploy */}
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">Set on next deploy</div>
          {secrets.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                value={s.name}
                onChange={(e) => updateSecret(i, "name", e.target.value.toUpperCase())}
                placeholder="KEY_NAME"
                className={inputClass + " font-mono text-[12px]"}
              />
              <input
                value={s.value}
                onChange={(e) => updateSecret(i, "value", e.target.value)}
                type={showProjectSecretValues ? "text" : "password"}
                placeholder="value"
                className={inputClass + " font-mono text-[12px]"}
              />
              <button
                onClick={() => removeSecretRow(i)}
                className="px-3 rounded-lg bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
                title="Remove"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button onClick={addSecretRow} className="text-[11px] text-amber-300 hover:text-amber-200 inline-flex items-center gap-1">
            <Plus size={12} /> Add row
          </button>
        </div>

        {/* Existing project secrets */}
        <div className="pt-2 border-t border-white/5 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">Existing ({projectSecrets.length})</div>
          {projectSecrets.length === 0 ? (
            <div className="text-[11px] text-zinc-500">No project secrets found.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {projectSecrets.map((name) => {
                const active = selectedProjectSecret === name;
                return (
                  <button
                    key={name}
                    onClick={() => { setSelectedProjectSecret(active ? "" : name); setProjectSecretDraft(""); }}
                    className={`text-left rounded-lg border px-2.5 py-2 transition min-w-0 ${
                      active
                        ? "border-amber-400/70 bg-amber-500/10"
                        : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <KeyRound size={10} className="text-amber-300 shrink-0" />
                      <code className="text-[10.5px] text-amber-200 font-semibold truncate flex-1">{name}</code>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selectedProjectSecret && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/[0.06] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase text-zinc-400 tracking-wide">Editing</div>
                  <code className="text-[12px] text-amber-200 font-semibold break-all">{selectedProjectSecret}</code>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => deleteProjectSecretValue(selectedProjectSecret)}
                    disabled={deletingProjectSecret === selectedProjectSecret}
                    className="rounded-md bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 px-2.5 py-1.5 text-[11px] inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {deletingProjectSecret === selectedProjectSecret ? <Loader2 className="animate-spin" size={11} /> : <Trash2 size={11} />}
                    Delete
                  </button>
                  <button
                    onClick={() => { setSelectedProjectSecret(""); setProjectSecretDraft(""); }}
                    className="rounded-md bg-white/5 text-zinc-300 hover:bg-white/10 px-2 py-1.5 text-[11px]"
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  className={inputClass + " flex-1 font-mono text-[11px]"}
                  placeholder={`new value for ${selectedProjectSecret}`}
                  type={showProjectSecretValues ? "text" : "password"}
                  value={projectSecretDraft}
                  onChange={(e) => setProjectSecretDraft(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  onClick={saveProjectSecretValue}
                  disabled={savingProjectSecret === selectedProjectSecret || !projectSecretDraft.trim()}
                  className={btnPrimary + " gap-1.5 disabled:opacity-50"}
                >
                  {savingProjectSecret === selectedProjectSecret ? <Loader2 className="animate-spin" size={12} /> : <Save size={12} />}
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ─────────── 5. LIVE LOGS ─────────── */}
      <section className={`${glassCard} p-4 space-y-2`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Terminal size={16} className="text-amber-300" />
          <h4 className="text-sm font-bold text-white">Live Logs</h4>
          <span className="text-[10px] text-zinc-500">
            {selected ? `for ${selected}` : "project-wide"}
          </span>
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {LOG_WINDOWS.map((item) => (
              <button
                key={item.minutes}
                onClick={() => { setLogsWindow(item.minutes); loadLogs(selected, item.minutes); }}
                className={`rounded-md px-2 py-1 text-[10px] font-semibold border transition ${
                  logsWindow === item.minutes
                    ? "border-amber-400/60 bg-amber-500/15 text-amber-200"
                    : "border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {item.label}
              </button>
            ))}
            <button
              onClick={() => loadLogs()}
              disabled={loadingLogs}
              className={btnSecondary + " gap-1 text-[10.5px] py-1 px-2"}
            >
              {loadingLogs ? <Loader2 className="animate-spin" size={11} /> : <RefreshCw size={11} />}
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            type="datetime-local"
            className={inputClass + " text-[11px]"}
            value={logStartAt}
            onChange={(e) => setLogStartAt(e.target.value)}
            placeholder="Start"
          />
          <input
            type="datetime-local"
            className={inputClass + " text-[11px]"}
            value={logEndAt}
            onChange={(e) => setLogEndAt(e.target.value)}
            placeholder="End"
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-[#050508] p-2.5 h-[240px] overflow-y-auto overflow-x-hidden
                        font-mono text-[11px] leading-[1.55] text-emerald-200/90 whitespace-pre-wrap break-words">
          {logs.length === 0 ? (
            <div className="h-full grid place-items-center text-center text-zinc-600 px-4">
              No logs in this window.
            </div>
          ) : (
            logs.map((row, idx) => (
              <div key={`${row.timestamp || 't'}-${idx}`} className="rounded-lg px-2 py-1.5 mb-1 bg-white/[0.025] border border-white/[0.04]">
                <div className="flex items-center justify-between gap-2 text-[9.5px] text-zinc-500">
                  <span className="uppercase tracking-wide">{row.source || "log"}</span>
                  <span className="shrink-0">{row.timestamp ? new Date(row.timestamp).toLocaleString() : "—"}</span>
                </div>
                <div className="mt-0.5 whitespace-pre-wrap break-words text-emerald-100/90">
                  {row.event_message || "(empty log)"}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ─────────── 6. DEPLOYED FUNCTIONS ─────────── */}
      <section className={`${glassCard} p-4 space-y-3 overflow-hidden`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Bot size={16} className="text-amber-300 shrink-0" />
          <h4 className="text-sm font-bold text-white">Deployed Functions</h4>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/5 text-zinc-400 font-mono">{sortedList.length}</span>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter functions…"
            className={inputClass + " pl-8 text-[12px]"}
          />
        </div>

        {loadingList ? (
          <div className="text-[11px] text-zinc-500 flex items-center gap-2 p-3">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-[11px] text-zinc-500 py-6 text-center border border-dashed border-white/10 rounded-xl">
            No functions yet. Load one from the library above and Deploy.
          </div>
        ) : (
          <div className="grid gap-2">
            {filtered.map((f) => {
              const active = selected === f.slug;
              const url = supaRef ? `https://${supaRef}.supabase.co/functions/v1/${f.slug}` : "";
              const isDeleting = deleting === f.slug;
              return (
                <div key={f.id || f.slug}
                  className={`rounded-xl border px-3 py-2.5 space-y-2 transition-all overflow-hidden ${
                    active ? "border-amber-500/50 bg-amber-500/[0.06]"
                           : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"}`}>
                  <button onClick={() => loadFn(f.slug)} className="w-full min-w-0 text-left flex items-start gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${active ? "bg-amber-400" : "bg-emerald-400/70"}`} />
                    <span className="min-w-0 flex-1 block">
                      <span className="block text-[12.5px] font-bold text-white truncate">{f.slug}</span>
                      <span className="block text-[9.5px] text-zinc-500">
                        v{f.version || "?"} · {(f.status || "—").toUpperCase()}
                      </span>
                      {url && <span className="block text-[9.5px] font-mono text-amber-300/70 truncate">{url}</span>}
                    </span>
                  </button>
                  <div className="grid grid-cols-4 gap-1.5 min-w-0">
                    <a
                      href={url || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled={!url}
                      onClick={(e) => { if (!url) e.preventDefault(); }}
                      title="Open URL"
                      className={`h-8 rounded-lg border flex items-center justify-center gap-1 text-[10.5px] font-semibold min-w-0 ${
                        url ? "bg-white/5 hover:bg-white/10 border-white/10 text-zinc-200" : "bg-white/[0.02] border-white/5 text-zinc-600 pointer-events-none"
                      }`}
                    >
                      <ExternalLink size={11} className="shrink-0" /> <span className="truncate">Open</span>
                    </a>
                    <button
                      onClick={() => loadFn(f.slug)}
                      title="Edit"
                      className="h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center gap-1 text-[10.5px] font-semibold text-zinc-200 min-w-0"
                    >
                      <FileCode2 size={11} className="shrink-0" /> <span className="truncate">Edit</span>
                    </button>
                    <button
                      onClick={() => url && copyText(url, "URL copied")}
                      disabled={!url}
                      title="Copy URL"
                      className="h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center gap-1 text-[10.5px] font-semibold text-zinc-200 disabled:opacity-40 min-w-0"
                    >
                      <Copy size={11} className="shrink-0" /> <span className="truncate">Copy</span>
                    </button>
                    <button
                      onClick={() => removeFn(f.slug)}
                      disabled={isDeleting}
                      title="Delete"
                      className="h-8 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 flex items-center justify-center gap-1 text-[10.5px] font-semibold text-rose-300 disabled:opacity-50 min-w-0"
                    >
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
