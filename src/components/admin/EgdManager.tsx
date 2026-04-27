import { useEffect, useMemo, useState } from "react";
import {
  Bot, Copy, Loader2, Plus, RefreshCw, Rocket, Trash2, X, FileCode2, KeyRound,
} from "lucide-react";
import { toast } from "sonner";

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL || "https://kqxpzqegtvaiwgdusrin.supabase.co"}/functions/v1/egd-deployer`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL || "https://kqxpzqegtvaiwgdusrin.supabase.co";

type FnRow = {
  id: string;
  slug: string;
  name: string;
  status?: string;
  version?: number;
  updated_at?: number;
};

type SecretRow = { name: string; value: string };

const headers = (json = true): HeadersInit => {
  const h: Record<string, string> = { Authorization: `Bearer ${ANON}`, apikey: ANON };
  if (json) h["Content-Type"] = "application/json";
  return h;
};

const STARTER = `// New Edge Function — replace with your code
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(JSON.stringify({ ok: true, msg: "Hello from EGD" }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
`;

export default function EgdManager({
  glassCard, inputClass, btnPrimary, btnSecondary,
}: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) {
  const [list, setList] = useState<FnRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selected, setSelected] = useState<string>("");

  const [slug, setSlug] = useState("");
  const [code, setCode] = useState(STARTER);
  const [secrets, setSecrets] = useState<SecretRow[]>([{ name: "", value: "" }]);

  const [deploying, setDeploying] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string>("");
  const [errorLog, setErrorLog] = useState<string>("");

  const loadList = async () => {
    setLoadingList(true);
    try {
      const r = await fetch(`${FN_BASE}/list`, { method: "POST", headers: headers() });
      const d = await r.json();
      if (d?.ok) {
        const arr: any[] = Array.isArray(d.functions) ? d.functions : [];
        setList(arr.map((f: any) => ({
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

  useEffect(() => { loadList(); }, []);

  const appendError = (msg: string) => {
    setErrorLog((prev) => `[${new Date().toLocaleTimeString()}] ${msg}\n` + prev);
  };

  const loadFn = async (s: string) => {
    setSelected(s);
    try {
      const r = await fetch(`${FN_BASE}/get`, {
        method: "POST", headers: headers(), body: JSON.stringify({ slug: s }),
      });
      const d = await r.json();
      if (d?.ok && d.fn) {
        setSlug(d.fn.slug || s);
        setCode(d.fn.body || "// (empty body)");
        setResultUrl(`${SUPA_URL}/functions/v1/${s}`);
      } else {
        appendError("Get failed: " + JSON.stringify(d?.error || d));
      }
    } catch (e: any) {
      appendError("Network: " + (e?.message || String(e)));
    }
  };

  const addSecretRow = () => setSecrets((p) => [...p, { name: "", value: "" }]);
  const removeSecretRow = (i: number) => setSecrets((p) => p.filter((_, idx) => idx !== i));
  const updateSecret = (i: number, k: "name" | "value", v: string) =>
    setSecrets((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const deploy = async () => {
    if (!slug.trim()) { toast.error("Function name required"); return; }
    if (!code.trim()) { toast.error("Code is empty"); return; }
    setDeploying(true);
    setErrorLog("");
    setResultUrl("");
    try {
      const cleanSecrets = secrets
        .map((s) => ({ name: s.name.trim(), value: s.value }))
        .filter((s) => s.name.length > 0);

      const r = await fetch(`${FN_BASE}/deploy`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ slug: slug.trim().toLowerCase(), code, secrets: cleanSecrets }),
      });
      const d = await r.json();
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
      const r = await fetch(`${FN_BASE}/delete`, {
        method: "POST", headers: headers(), body: JSON.stringify({ slug: s }),
      });
      const d = await r.json();
      if (d?.ok) { toast.success("Deleted"); if (selected === s) { setSelected(""); setSlug(""); setCode(STARTER); setResultUrl(""); } loadList(); }
      else { toast.error("Delete failed"); appendError(JSON.stringify(d?.error || d)); }
    } finally { setDeleting(null); }
  };

  const newDraft = () => {
    setSelected(""); setSlug(""); setCode(STARTER);
    setSecrets([{ name: "", value: "" }]); setResultUrl(""); setErrorLog("");
  };

  const copy = (txt: string) => navigator.clipboard.writeText(txt).then(() => toast.success("Copied"));

  const sortedList = useMemo(
    () => [...list].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)),
    [list],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={glassCard + " p-6"}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Rocket className="text-amber-400" /> EGD MANAGER
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Deploy any Supabase Edge Function directly from here. Provide a name, paste the code, add required secrets, and hit Deploy.
            </p>
          </div>
          <button onClick={newDraft} className={btnSecondary + " inline-flex items-center gap-2"}>
            <Plus size={14} /> New
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* Editor card */}
        <div className={glassCard + " p-6 space-y-4"}>
          {/* Name */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1 flex items-center gap-1">
              <FileCode2 size={12} /> Function Name (slug)
            </label>
            <input
              className={inputClass}
              placeholder="my-bot"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              disabled={!!selected}
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              lowercase, numbers, _ and - only. Cannot rename after deploy.
            </p>
          </div>

          {/* Code box — fixed height, scrollable */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Edge Function Code (index.ts)</label>
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
              <button onClick={addSecretRow} className="text-xs text-amber-400 hover:text-amber-300 inline-flex items-center gap-1">
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

          {/* Deploy */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={deploy}
              disabled={deploying}
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
                <button onClick={() => copy(resultUrl)} className="text-emerald-300 hover:text-white" title="Copy">
                  <Copy size={14} />
                </button>
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
            <h3 className="font-bold flex items-center gap-2"><Bot size={16} className="text-amber-400" /> Deployed</h3>
            <button onClick={loadList} className="text-zinc-400 hover:text-white" title="Refresh">
              {loadingList ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
            </button>
          </div>
          {sortedList.length === 0 ? (
            <p className="text-xs text-zinc-500">No functions deployed yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-[520px] overflow-auto pr-1">
              {sortedList.map((f) => (
                <div
                  key={f.id}
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
