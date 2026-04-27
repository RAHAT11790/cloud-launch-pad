import { useEffect, useMemo, useState } from "react";
import {
  Bot, Copy, Loader2, Plus, RefreshCw, Rocket, Trash2, X, FileCode2, KeyRound,
  Save, Send, Link as LinkIcon, ExternalLink, Edit3,
} from "lucide-react";
import { toast } from "sonner";
import { db, ref, onValue, set, remove } from "@/lib/firebase";

/**
 * EGD MANAGER (manual deploy mode)
 *
 * User deploys edge functions themselves (in Supabase Dashboard) and pastes
 * the resulting URL back here. This component:
 *  - stores function name + code + secrets list + live URL in Firebase
 *  - provides a "Test / Invoke" button that hits the saved URL
 *  - the code template forces JWT verification OFF (per user requirement)
 *
 * Storage path: egdManager/functions/{slug}
 */

type SecretRow = { name: string; value: string };

type EgdFn = {
  slug: string;
  url: string;
  code: string;
  secrets: SecretRow[];
  notes?: string;
  updated_at?: number;
};

const STARTER = `// EGD Function — JWT verify is OFF (configure in Dashboard: Settings → "Verify JWT" = false)
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // your logic here
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  return new Response(
    JSON.stringify({ ok: true, msg: "Hello from EGD", echo: body }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
`;

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 50);

export default function EgdManager({
  glassCard, inputClass, btnPrimary, btnSecondary,
}: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) {
  const [list, setList] = useState<EgdFn[]>([]);
  const [selected, setSelected] = useState<string>("");

  const [slug, setSlug] = useState("");
  const [url, setUrl] = useState("");
  const [code, setCode] = useState(STARTER);
  const [secrets, setSecrets] = useState<SecretRow[]>([{ name: "", value: "" }]);
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testBody, setTestBody] = useState(`{}`);
  const [testMethod, setTestMethod] = useState<"GET" | "POST">("POST");
  const [logBox, setLogBox] = useState("");

  // ---------- Load saved functions ----------
  useEffect(() => {
    const r = ref(db, "egdManager/functions");
    return onValue(r, (snap) => {
      const v = snap.val() || {};
      const arr: EgdFn[] = Object.values(v) as EgdFn[];
      setList(arr.filter(Boolean));
    });
  }, []);

  const sortedList = useMemo(
    () => [...list].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)),
    [list],
  );

  // ---------- Helpers ----------
  const log = (msg: string) =>
    setLogBox((prev) => `[${new Date().toLocaleTimeString()}] ${msg}\n` + prev);

  const newDraft = () => {
    setSelected(""); setSlug(""); setUrl(""); setCode(STARTER);
    setSecrets([{ name: "", value: "" }]); setNotes(""); setLogBox("");
  };

  const loadFn = (s: string) => {
    const fn = list.find((f) => f.slug === s);
    if (!fn) return;
    setSelected(s);
    setSlug(fn.slug);
    setUrl(fn.url || "");
    setCode(fn.code || STARTER);
    setSecrets(fn.secrets?.length ? fn.secrets : [{ name: "", value: "" }]);
    setNotes(fn.notes || "");
    setLogBox("");
  };

  const addSecretRow = () => setSecrets((p) => [...p, { name: "", value: "" }]);
  const removeSecretRow = (i: number) =>
    setSecrets((p) => p.filter((_, idx) => idx !== i));
  const updateSecret = (i: number, k: "name" | "value", v: string) =>
    setSecrets((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const copy = (txt: string) =>
    navigator.clipboard.writeText(txt).then(() => toast.success("Copied"));

  // ---------- Save ----------
  const save = async () => {
    const cleanSlug = slugify(slug);
    if (!cleanSlug) { toast.error("Function name required"); return; }
    if (!code.trim()) { toast.error("Code is empty"); return; }

    setSaving(true);
    try {
      const data: EgdFn = {
        slug: cleanSlug,
        url: url.trim(),
        code,
        secrets: secrets
          .map((s) => ({ name: s.name.trim(), value: s.value }))
          .filter((s) => s.name.length > 0),
        notes: notes.trim(),
        updated_at: Date.now(),
      };
      await set(ref(db, `egdManager/functions/${cleanSlug}`), data);
      toast.success("Saved ✔");
      setSelected(cleanSlug);
      setSlug(cleanSlug);
    } catch (e: any) {
      toast.error("Save failed");
      log("Save error: " + (e?.message || String(e)));
    } finally { setSaving(false); }
  };

  // ---------- Delete ----------
  const removeFn = async (s: string) => {
    if (!confirm(`Remove "${s}" from this list? (Does NOT delete the deployed function.)`)) return;
    try {
      await remove(ref(db, `egdManager/functions/${s}`));
      if (selected === s) newDraft();
      toast.success("Removed");
    } catch (e: any) {
      toast.error("Remove failed");
      log("Remove error: " + (e?.message || String(e)));
    }
  };

  // ---------- Test / Invoke ----------
  const test = async () => {
    if (!url.trim()) { toast.error("Save URL first"); return; }
    setTesting(true);
    log(`→ ${testMethod} ${url}`);
    try {
      const init: RequestInit = {
        method: testMethod,
        headers: { "Content-Type": "application/json" },
      };
      if (testMethod === "POST") init.body = testBody || "{}";
      const r = await fetch(url, init);
      const txt = await r.text();
      log(`← ${r.status} ${r.statusText}\n${txt.slice(0, 4000)}`);
    } catch (e: any) {
      log("✖ Network: " + (e?.message || String(e)));
    } finally { setTesting(false); }
  };

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
              Write your edge function code here, deploy it manually in your Supabase Dashboard,
              then paste the live URL back to save & test it.
            </p>
          </div>
          <button onClick={newDraft} className={btnSecondary + " inline-flex items-center gap-2"}>
            <Plus size={14} /> New Function
          </button>
        </div>

        {/* Quick guide */}
        <div className="mt-4 grid sm:grid-cols-3 gap-2 text-[11px] text-zinc-400">
          <div className="bg-zinc-900/40 border border-zinc-700/50 rounded-lg p-2">
            <span className="text-amber-300 font-semibold">1.</span> Write code & secrets here, click <b>Save</b>.
          </div>
          <div className="bg-zinc-900/40 border border-zinc-700/50 rounded-lg p-2">
            <span className="text-amber-300 font-semibold">2.</span> Open Supabase Dashboard → Edge Functions → Deploy this code. Set <b>Verify JWT = OFF</b>.
          </div>
          <div className="bg-zinc-900/40 border border-zinc-700/50 rounded-lg p-2">
            <span className="text-amber-300 font-semibold">3.</span> Copy the function URL → paste in <b>Live URL</b> field → <b>Test</b>.
          </div>
        </div>
      </div>

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
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              lowercase, numbers, _ and - only. Used as the storage key.
            </p>
          </div>

          {/* Code box — fixed height, scrollable */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-zinc-400">Edge Function Code (index.ts)</label>
              <button
                onClick={() => copy(code)}
                className="text-[11px] text-zinc-400 hover:text-amber-300 inline-flex items-center gap-1"
                title="Copy code to clipboard"
              >
                <Copy size={11} /> Copy code
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

          {/* Secrets list (just for reference / your own notes) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-zinc-400 flex items-center gap-1">
                <KeyRound size={12} /> Secrets (reference only — set them in Supabase Dashboard)
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
          </div>

          {/* Live URL */}
          <div>
            <label className="text-xs text-zinc-400 mb-1 flex items-center gap-1">
              <LinkIcon size={12} /> Live URL (paste after deploying in Dashboard)
            </label>
            <div className="flex gap-2">
              <input
                className={inputClass + " flex-1"}
                placeholder="https://xxx.supabase.co/functions/v1/my-bot"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 inline-flex items-center"
                  title="Open"
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Notes (optional)</label>
            <input
              className={inputClass}
              placeholder="What this function does, project ref, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Save / Test */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button onClick={save} disabled={saving} className={btnPrimary + " inline-flex items-center gap-2"}>
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              {saving ? "Saving..." : (selected ? "Update" : "Save")}
            </button>

            <div className="flex items-center gap-1 ml-auto">
              <select
                value={testMethod}
                onChange={(e) => setTestMethod(e.target.value as any)}
                className={inputClass + " !py-1.5 !px-2 text-xs w-auto"}
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
              <button onClick={test} disabled={testing || !url} className={btnSecondary + " inline-flex items-center gap-2"}>
                {testing ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                Test
              </button>
            </div>
          </div>

          {/* Test body */}
          {testMethod === "POST" && (
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Test request body (JSON)</label>
              <textarea
                value={testBody}
                onChange={(e) => setTestBody(e.target.value)}
                className={inputClass + " font-mono text-xs"}
                style={{ height: 80, resize: "none" }}
                spellCheck={false}
              />
            </div>
          )}

          {/* Log */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Log</label>
            <textarea
              readOnly
              value={logBox || "— no activity —"}
              className={inputClass + " font-mono text-[11px] leading-relaxed"}
              style={{ height: 140, resize: "none", overflow: "auto" }}
            />
          </div>
        </div>

        {/* List card */}
        <div className={glassCard + " p-4"}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold flex items-center gap-2">
              <Bot size={16} className="text-amber-400" /> Saved ({sortedList.length})
            </h3>
          </div>
          {sortedList.length === 0 ? (
            <p className="text-xs text-zinc-500">No functions saved yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-[640px] overflow-auto pr-1">
              {sortedList.map((f) => (
                <div
                  key={f.slug}
                  className={
                    "rounded-lg border p-2.5 cursor-pointer transition " +
                    (selected === f.slug
                      ? "border-amber-400/60 bg-amber-500/10"
                      : "border-zinc-700/50 bg-zinc-900/40 hover:border-zinc-600")
                  }
                  onClick={() => loadFn(f.slug)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate flex items-center gap-1">
                        <Edit3 size={10} className="text-zinc-500" /> {f.slug}
                      </div>
                      {f.url ? (
                        <div className="text-[10px] text-emerald-400/80 truncate">● live</div>
                      ) : (
                        <div className="text-[10px] text-zinc-500">○ no URL yet</div>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFn(f.slug); }}
                      className="text-red-400 hover:text-red-300"
                      title="Remove from list"
                    >
                      <Trash2 size={12} />
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
