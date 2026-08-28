import { useState } from "react";
import { toast } from "sonner";
import CachedImg from "@/components/CachedImg";
import {
  BackdropMode,
  DEFAULT_BACKDROP_PROMPT,
  DEFAULT_LOGO_PROMPT,
  buildBackdropPayload,
  callGenerateBackdrop,
} from "@/lib/backdropAi";

interface Props {
  title: string;
  year?: string | number;
  genres?: string[];
  overview?: string;
  contentId?: string;
  contentType?: "webseries" | "movies";
  currentBackdrop?: string;
  currentLogo?: string;
  /** Called with the generated URL when the admin accepts it. */
  onApply: (mode: BackdropMode, url: string) => void;
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
}

/**
 * Backdrop / Logo AI embedded directly inside the Series & Movie editors so the
 * admin never has to leave the editor (and never has to save first).
 */
const InlineBackdropAi = ({
  title, year, genres, overview, contentId, contentType,
  currentBackdrop, currentLogo, onApply,
  glassCard, inputClass, btnPrimary, btnSecondary,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<BackdropMode>("backdrop");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [usePromptOverride, setUsePromptOverride] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const toggleOverride = (checked: boolean) => {
    setUsePromptOverride(checked);
    if (checked && !customPrompt) {
      setCustomPrompt(mode === "backdrop" ? DEFAULT_BACKDROP_PROMPT : DEFAULT_LOGO_PROMPT);
    }
  };

  const generate = async () => {
    if (busy) return;
    if (!title?.trim()) { toast.error("Enter the title first"); return; }
    setBusy(true); setErr(null); setProgress(8);
    const tick = setInterval(() => setProgress(p => (p >= 90 ? p : Math.min(90, p + Math.random() * 7 + 2))), 500);
    try {
      const data = await callGenerateBackdrop(buildBackdropPayload({
        title, mode, year, genres, overview,
        animeId: contentId, type: contentType,
        // PERMANENT: the existing backdrop is always analysed first so the AI
        // uses the real official characters instead of inventing them.
        referenceImageUrl: currentBackdrop,
        customPrompt: usePromptOverride ? customPrompt : undefined,
      }));
      if (!data?.url) throw new Error("no url");
      setProgress(100);
      setPreview(data.url as string);
      toast.success(`Preview ready · ${data.model || data.provider || "lovable"}`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setErr(msg);
      toast.error(msg);
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  };

  const apply = () => {
    if (!preview) return;
    onApply(mode, preview);
    toast.success(`${mode === "backdrop" ? "Backdrop" : "Logo"} applied to the editor — hit Save now`);
    setPreview(null); setProgress(0);
  };


  const current = mode === "backdrop" ? currentBackdrop : currentLogo;

  return (
    <div className={`${glassCard} p-3 mb-4 border border-fuchsia-500/25`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 text-left"
      >
        <span className="inline-flex w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-500/25 to-amber-500/25 border border-white/10 items-center justify-center text-[14px]">🎨</span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-white leading-none">Backdrop &amp; Logo AI</div>
          <div className="text-[10px] text-white/50 mt-1">Generate art here and apply it straight into the editor</div>
        </div>
        <span className="text-white/50 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/30 rounded-xl border border-white/10">
            {(["backdrop", "logo"] as BackdropMode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setPreview(null); setProgress(0); }}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  mode === m ? "bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white shadow" : "text-white/60"
                }`}
              >
                {m === "backdrop" ? "Backdrop · 16:9" : "Logo · 1:1"}
              </button>
            ))}
          </div>

          <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2">
            <label className="flex items-center gap-2 text-[10.5px] text-white/80 cursor-pointer">
              <input type="checkbox" checked={usePromptOverride} onChange={e => toggleOverride(e.target.checked)} />
              <span>Custom prompt override</span>
            </label>
            <div className="text-[9.5px] text-white/40 mt-1 leading-snug">
              Locked always: the anime title and the current backdrop image (official characters are read from it first). Your prompt only controls the art direction.
            </div>
            {usePromptOverride && (
              <textarea
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                rows={4}
                className={inputClass + " w-full font-mono text-[10.5px] mt-2 resize-y"}
                placeholder="Use {title} for the anime name…"
              />
            )}

          </div>

          <div className="bg-black/40 rounded-xl border border-white/10 p-2 min-h-[140px] grid place-items-center overflow-hidden">
            {preview ? (
              <CachedImg src={preview} alt="Preview" className={mode === "backdrop" ? "w-full rounded-lg" : "max-h-[220px] rounded-lg"} />
            ) : busy ? (
              <div className="w-full px-3 py-6 text-center">
                <div className="text-[11px] text-white/70 mb-2">Generating…</div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mx-auto max-w-[260px]">
                  <div className="h-full bg-gradient-to-r from-fuchsia-400 to-pink-400 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="text-[10px] text-white/40 mt-1">{Math.round(progress)}%</div>
              </div>
            ) : current ? (
              <CachedImg src={current} alt="" className={mode === "backdrop" ? "w-full rounded-lg opacity-60" : "max-h-[200px] rounded-lg opacity-60"} />
            ) : (
              <div className="text-[11px] text-white/40 py-8">No preview yet.</div>
            )}
          </div>

          {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] text-rose-200 px-2.5 py-1.5 text-[10.5px]">❌ {err}</div>}

          <div className="flex gap-2">
            <button type="button" onClick={generate} disabled={busy} className={btnPrimary + " flex-1 disabled:opacity-50"}>
              {busy ? "Generating…" : preview ? "Regenerate" : "Generate"}
            </button>
            {preview && !busy && (
              <button type="button" onClick={apply} className={btnPrimary + " flex-1"}>
                Use {mode === "backdrop" ? "Backdrop" : "Logo"}
              </button>
            )}
            {preview && !busy && (
              <button type="button" onClick={() => setPreview(null)} className={btnSecondary + " !px-3"}>✕</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default InlineBackdropAi;
