import { useEffect, useMemo, useState } from "react";
import {
  Bot, Copy, Loader2, Plus, RefreshCw, Rocket, Trash2, X, FileCode2, KeyRound,
  Link as LinkIcon, ExternalLink, Settings, CheckCircle2, AlertCircle, Download,
} from "lucide-react";
import { toast } from "sonner";
import { db, ref, onValue, set } from "@/lib/firebase";
import { EGD_DEPLOYER_CODE } from "@/lib/egdDeployerCode";

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

export default function EgdManager({
  glassCard, inputClass, btnPrimary, btnSecondary,
}: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) {
  // --- Deployer config ---
  const [deployerUrl, setDeployerUrl] = useState("");
  const [savedDeployerUrl, setSavedDeployerUrl] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

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

  useEffect(() => { if (savedDeployerUrl) loadList(); }, [savedDeployerUrl]);

  const loadFn = async (s: string) => {
    setSelected(s);
    try {
      const d = await callDeployer("get", { slug: s });
      if (d?.ok && d.fn) {
        setSlug(d.fn.slug || s);
        const body: string = d.fn.body || "";
        // Detect binary / ESZIP bundle (non-text content) and show friendly message
        const looksBinary =
          body.startsWith("ESZIP") ||
          /[\x00-\x08\x0E-\x1F]/.test(body.slice(0, 200));
        if (looksBinary) {
          setCode(
            `// ⚠️ This function was deployed as a compiled bundle (ESZIP).\n` +
            `// Source code cannot be recovered from the deployed bundle.\n` +
            `//\n` +
            `// To update "${s}", paste your new source code here and click Deploy.\n` +
            `// (The old bundle will be replaced with this fresh source.)\n\n` +
            STARTER,
          );
          toast.info("Compiled bundle — paste fresh source to replace");
        } else {
          setCode(body || "// (empty body)");
        }
        const ref = savedDeployerUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
        if (ref) setResultUrl(`https://${ref}.supabase.co/functions/v1/${s}`);
      } else {
        appendError("Get failed: " + JSON.stringify(d?.error || d));
      }
    } catch (e: any) {
      appendError("Network: " + (e?.message || String(e)));
    }
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
        await loadList();
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
  };

  const sortedList = useMemo(
    () => [...list].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)),
    [list],
  );

  const isConfigured = !!savedDeployerUrl;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className={glassCard + " p-4 sm:p-6"}>
        <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Rocket className="text-amber-400 shrink-0" size={22} />
              <span className="truncate">EGD MANAGER</span>
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1">
              Deploy edge functions to your own Supabase project, directly from this admin panel.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowSetup((v) => !v)}
              className={btnSecondary + " inline-flex items-center gap-2 text-xs sm:text-sm px-3 py-2"}
            >
              <Settings size={14} /> Setup
            </button>
            <button onClick={newDraft} className={btnSecondary + " inline-flex items-center gap-2 text-xs sm:text-sm px-3 py-2"}>
              <Plus size={14} /> New
            </button>
          </div>
        </div>

        {/* Status badge */}
        <div className="mt-3 flex items-center gap-2 text-xs flex-wrap">
          {isConfigured ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-300">
              <CheckCircle2 size={12} /> Deployer configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/15 text-amber-300">
              <AlertCircle size={12} /> Not configured — open Setup
            </span>
          )}
          {isConfigured && (
            <code className="text-[10px] text-zinc-500 truncate max-w-full block">{savedDeployerUrl}</code>
          )}
        </div>
      </div>

      {/* Setup card */}
      {showSetup && (
        <div className={glassCard + " p-4 sm:p-6 space-y-4 border border-amber-500/30"}>
          <h3 className="font-bold text-amber-300 flex items-center gap-2 text-sm sm:text-base">
            <Settings size={16} /> One-time Deployer Setup
          </h3>

          <ol className="text-xs text-zinc-300 space-y-2 list-decimal list-inside break-words">
            <li>Open your Supabase Dashboard → <b>Edge Functions</b> → <b>Create function</b>.</li>
            <li>Name it <code className="bg-zinc-800 px-1 rounded break-all">egd-deployer</code> and paste the code below.</li>
            <li>Go to function <b>Settings</b> → turn <b>Verify JWT = OFF</b>.</li>
            <li>Add a project secret <code className="bg-zinc-800 px-1 rounded break-all">EGD_SUPABASE_PAT</code> = your Supabase Personal Access Token.</li>
            <li>Deploy. Copy the function URL and paste it below, then Save.</li>
          </ol>

          {/* Deployer code box */}
          <div className="min-w-0">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <label className="text-xs text-zinc-400">Deployer source (index.ts)</label>
              <div className="flex gap-2">
                <button
                  onClick={() => copyText(EGD_DEPLOYER_CODE, "Deployer code copied")}
                  className="text-[11px] text-amber-400 hover:text-amber-300 inline-flex items-center gap-1"
                >
                  <Copy size={11} /> Copy
                </button>
                <button
                  onClick={downloadDeployerCode}
                  className="text-[11px] text-zinc-400 hover:text-amber-300 inline-flex items-center gap-1"
                >
                  <Download size={11} /> Download
                </button>
              </div>
            </div>
            <textarea
              readOnly
              value={EGD_DEPLOYER_CODE}
              className={inputClass + " font-mono text-[10px] sm:text-[11px] leading-relaxed w-full block"}
              style={{ height: 220, resize: "none", overflow: "auto", whiteSpace: "pre" }}
              spellCheck={false}
            />
          </div>

          {/* URL input */}
          <div className="min-w-0">
            <label className="text-xs text-zinc-400 mb-1 flex items-center gap-1">
              <LinkIcon size={12} /> Deployer Function URL
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                className={inputClass + " flex-1 min-w-0"}
                placeholder="https://xxxx.supabase.co/functions/v1/egd-deployer"
                value={deployerUrl}
                onChange={(e) => setDeployerUrl(e.target.value)}
              />
              <button
                onClick={saveDeployerUrl}
                disabled={savingUrl}
                className={btnPrimary + " inline-flex items-center justify-center gap-2 shrink-0"}
              >
                {savingUrl ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                Save
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1 break-words">
              URL is stored in Firebase. No API keys needed (deployer runs with Verify JWT off).
            </p>
          </div>
        </div>
      )}

      {/* Editor + List */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* Editor card */}
        <div className={glassCard + " p-6 space-y-4"}>
          {/* Name */}
          <div>
            <label className="text-xs text-zinc-400 mb-1 flex items-center gap-1">
              <FileCode2 size={12} /> Function Name (slug)
            </label>
            <input
              className={inputClass}
              placeholder="my-bot"
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              disabled={!!selected}
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              lowercase, numbers, _ and - only. Cannot rename after deploy.
            </p>
          </div>

          {/* Code box */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-zinc-400">Edge Function Code (index.ts)</label>
              <button
                onClick={() => copyText(code)}
                className="text-[11px] text-zinc-400 hover:text-amber-300 inline-flex items-center gap-1"
              >
                <Copy size={11} /> Copy
              </button>
            </div>
            <textarea
              className={inputClass + " font-mono text-xs leading-relaxed"}
              style={{ height: 360, resize: "none", overflow: "auto", whiteSpace: "pre" }}
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          {/* Secrets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-zinc-400 flex items-center gap-1">
                <KeyRound size={12} /> Secrets (project-wide env vars)
              </label>
              <button
                onClick={addSecretRow}
                className="text-xs text-amber-400 hover:text-amber-300 inline-flex items-center gap-1"
              >
                <Plus size={12} /> Add
              </button>
            </div>
            <div className="space-y-2">
              {secrets.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className={inputClass + " flex-1"}
                    placeholder="SECRET_NAME"
                    value={s.name}
                    onChange={(e) => updateSecret(i, "name", e.target.value)}
                  />
                  <input
                    className={inputClass + " flex-1"}
                    placeholder="value"
                    type="password"
                    value={s.value}
                    onChange={(e) => updateSecret(i, "value", e.target.value)}
                  />
                  <button
                    onClick={() => removeSecretRow(i)}
                    className="px-2 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25"
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              Names starting with SUPABASE_ / SB_ are reserved and skipped automatically.
            </p>
          </div>

          {/* Deploy button */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={deploy}
              disabled={deploying || !isConfigured}
              className={btnPrimary + " inline-flex items-center gap-2"}
            >
              {deploying ? <Loader2 className="animate-spin" size={16} /> : <Rocket size={16} />}
              {deploying ? "Deploying..." : "Deploy"}
            </button>
            {selected && (
              <span className="text-xs text-zinc-500">Editing: <span className="text-amber-300">{selected}</span></span>
            )}
          </div>

          {/* Result URL */}
          {resultUrl && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
              <div className="text-xs text-emerald-300 mb-1">✔ Live URL</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate text-sm text-emerald-200">{resultUrl}</code>
                <button onClick={() => copyText(resultUrl)} className="text-emerald-300 hover:text-white" title="Copy">
                  <Copy size={14} />
                </button>
                <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-white">
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          )}

          {/* Error log */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Error / Deploy log</label>
            <textarea
              readOnly
              value={errorLog || "— no errors —"}
              className={inputClass + " font-mono text-[11px] leading-relaxed"}
              style={{ height: 120, resize: "none", overflow: "auto" }}
            />
          </div>
        </div>

        {/* List card */}
        <div className={glassCard + " p-4"}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold flex items-center gap-2">
              <Bot size={16} className="text-amber-400" /> Deployed
            </h3>
            <button onClick={loadList} className="text-zinc-400 hover:text-white" title="Refresh">
              {loadingList ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
            </button>
          </div>
          {!isConfigured ? (
            <p className="text-xs text-zinc-500">Configure deployer first.</p>
          ) : sortedList.length === 0 ? (
            <p className="text-xs text-zinc-500">No functions deployed yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-[640px] overflow-auto pr-1">
              {sortedList.map((f) => (
                <div
                  key={f.id || f.slug}
                  className={
                    "rounded-lg border p-2.5 cursor-pointer transition " +
                    (selected === f.slug
                      ? "border-amber-400/60 bg-amber-500/10"
                      : "border-zinc-700/50 bg-zinc-900/40 hover:border-zinc-600")
                  }
                  onClick={() => loadFn(f.slug)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{f.slug}</div>
                      <div className="text-[10px] text-zinc-500">
                        v{f.version || "?"} · {f.status || "—"}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFn(f.slug); }}
                      className="text-red-400 hover:text-red-300"
                      disabled={deleting === f.slug}
                      title="Delete"
                    >
                      {deleting === f.slug ? <Loader2 className="animate-spin" size={12} /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
