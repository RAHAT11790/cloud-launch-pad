import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string; }

type Item = { id: string; title: string; backdrop?: string; logo?: string; year?: string | number; type: "webseries" | "movies" };
type Mode = "backdrop" | "logo";
type Provider = "lovable" | "flux";

const DEFAULT_BACKDROP_PROMPT = `CREATE A PROFESSIONAL 16:9 CINEMATIC ANIME PROMOTIONAL BANNER FOR "{title}" IN ULTRA DETAILED 4K HDR QUALITY.

Use ONLY the OFFICIAL canonical main characters of "{title}" — exact signature hairstyle, eye design, outfit, weapons. Characters must be instantly recognizable. Do NOT invent characters or use generic anime faces. Hero protagonist on the right 55% of frame; supporting cast in official hierarchy.

Background inspired by official key visuals: signature environment, atmospheric particles, HDR rim lighting, cinematic fog. Match the anime's official color palette and mood.

Style: Netflix / Crunchyroll promotional banner quality, sharp focus, perfect anatomy, no deformed faces, no watermarks. Ultra detailed, 4K, HDR.

The final result must look like an OFFICIAL anime poster remastered into a premium cinematic banner.`;

const DEFAULT_LOGO_PROMPT = `Official anime TITLE LOGO for "{title}", square 1:1. Title "{title}" rendered in the canonical official logo treatment of the real anime (matching font, colors, glow, ornaments). Japanese kanji of the title below in small elegant typography. Deep black radial gradient background. High resolution, perfect kerning, no foreground characters, no extra text.`;

const BackdropAiReplacer = ({ glassCard, btnPrimary, btnSecondary, inputClass }: Props) => {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("backdrop");
  const [provider, setProvider] = useState<Provider>("lovable");
  const [customPrompt, setCustomPrompt] = useState("");
  const [usePromptOverride, setUsePromptOverride] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const u1 = onValue(ref(db, "webseries"), (snap) => {
      const v = snap.val() || {};
      const ws = Object.keys(v).map((id) => ({
        id, title: v[id]?.title || id, backdrop: v[id]?.backdrop, logo: v[id]?.logo,
        year: v[id]?.year, type: "webseries" as const,
      }));
      setItems((prev) => [...ws, ...prev.filter((p) => p.type !== "webseries")]);
    });
    const u2 = onValue(ref(db, "movies"), (snap) => {
      const v = snap.val() || {};
      const mv = Object.keys(v).map((id) => ({
        id, title: v[id]?.title || id, backdrop: v[id]?.backdrop, logo: v[id]?.logo,
        year: v[id]?.year, type: "movies" as const,
      }));
      setItems((prev) => [...prev.filter((p) => p.type !== "movies"), ...mv]);
    });
    return () => { u1(); u2(); };
  }, []);

  const visible = useMemo(
    () => items.filter((i) => i.title.toLowerCase().includes(filter.toLowerCase())),
    [items, filter]
  );

  const activeItem = useMemo(() => {
    if (!activeId) return null;
    const [t, id] = activeId.split(":");
    return items.find((i) => i.type === t && i.id === id) || null;
  }, [activeId, items]);

  useEffect(() => {
    setPreviewUrl(null);
    setProgress(0);
  }, [activeId, mode, provider]);

  useEffect(() => {
    if (usePromptOverride && !customPrompt) {
      setCustomPrompt(mode === "backdrop" ? DEFAULT_BACKDROP_PROMPT : DEFAULT_LOGO_PROMPT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usePromptOverride, mode]);

  const generate = async () => {
    if (!activeItem || busy) return;
    setBusy(true);
    setProgress(8);
    const tick = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : Math.min(90, p + Math.random() * 7 + 2)));
    }, 500);
    try {
      const payload: any = {
        animeId: activeItem.id,
        title: activeItem.title,
        type: activeItem.type,
        year: activeItem.year,
        mode,
        provider,
      };
      if (usePromptOverride && customPrompt.trim()) {
        payload.customPrompt = customPrompt
          .replace(/\{title\}/gi, activeItem.title)
          .replace(/\[WRITE ANIME NAME HERE\]/gi, activeItem.title);
      }
      const { data, error } = await supabase.functions.invoke("generate-backdrop", { body: payload });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || "no url");
      setProgress(100);
      setPreviewUrl(data.url as string);
      toast.success(`Preview ready (${data.engine})`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      toast.error(
        msg.includes("PAYMENT") ? "Lovable AI credits exhausted — try Flux v1" :
        msg.includes("RATE") ? "Rate limited — try again shortly" : msg
      );
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  };

  const saveCurrent = async () => {
    if (!activeItem || !previewUrl) return;
    try {
      await update(ref(db, `${activeItem.type}/${activeItem.id}`), { [mode]: previewUrl });
      toast.success(`${mode === "backdrop" ? "Backdrop" : "Logo"} saved for ${activeItem.title}`);
      setPreviewUrl(null);
      setProgress(0);
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message || e}`);
    }
  };

  return (
    <div className={glassCard + " space-y-4 overflow-hidden"}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex w-7 h-7 rounded-lg bg-gradient-to-br from-fuchsia-500/30 to-amber-500/30 border border-white/10 items-center justify-center text-[13px]">🎨</span>
          <h3 className="text-[13px] font-bold text-white tracking-wide">Backdrop & Logo AI Generator</h3>
        </div>
        <p className="text-[10.5px] text-white/55 leading-relaxed break-words">
          Pick an anime → preview → regenerate or save. Two engines available — Lovable AI &amp; Flux v1.
        </p>
      </div>

      {!activeItem && (
        <>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search anime title…"
            className={inputClass + " w-full"}
          />
          <div className="grid grid-cols-1 gap-1.5 max-h-[520px] overflow-y-auto pr-1">
            {visible.map((it) => (
              <button
                key={it.type + it.id}
                onClick={() => setActiveId(`${it.type}:${it.id}`)}
                className="w-full text-left bg-white/5 hover:bg-white/10 rounded-lg p-2.5 border border-white/5 flex gap-3 items-center transition min-w-0"
              >
                {it.backdrop ? (
                  <img src={it.backdrop} alt="" className="w-20 h-[44px] object-cover rounded flex-shrink-0" />
                ) : (
                  <div className="w-20 h-[44px] bg-white/5 rounded grid place-items-center text-[9px] text-white/40 flex-shrink-0">no bd</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-white truncate">{it.title}</div>
                  <div className="text-[10px] text-white/50">
                    {it.type} {it.year ? `• ${it.year}` : ""} {it.logo ? "• logo ✓" : ""}
                  </div>
                </div>
              </button>
            ))}
            {visible.length === 0 && (
              <div className="text-center text-white/40 text-xs py-6">No items match the filter.</div>
            )}
          </div>
        </>
      )}

      {activeItem && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-white/5 rounded-lg p-2.5 border border-white/5">
            {activeItem.backdrop ? (
              <img src={activeItem.backdrop} alt="" className="w-16 h-9 object-cover rounded" />
            ) : (
              <div className="w-16 h-9 bg-white/5 rounded grid place-items-center text-[9px] text-white/40">no bd</div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-white truncate">{activeItem.title}</div>
              <div className="text-[10px] text-white/50">{activeItem.type} {activeItem.year ? `• ${activeItem.year}` : ""}</div>
            </div>
            <button
              onClick={() => { setActiveId(null); setPreviewUrl(null); }}
              className={btnSecondary + " !text-[10px] !px-2.5 !py-1.5"}
            >
              ← Back
            </button>
          </div>

          <div className="space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/50 mb-1.5">Type</div>
              <div className="grid grid-cols-2 gap-1.5">
                {(["backdrop", "logo"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap ${
                      mode === m ? "bg-emerald-500 text-black border-emerald-400" : "bg-white/5 text-white/70 border-white/10"
                    }`}
                  >
                    {m === "backdrop" ? "Backdrop 16:9" : "Logo 1:1"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/50 mb-1.5">Engine</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setProvider("lovable")}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap ${
                    provider === "lovable" ? "bg-amber-500 text-black border-amber-400" : "bg-white/5 text-white/70 border-white/10"
                  }`}
                >
                  Lovable AI
                </button>
                <button
                  onClick={() => setProvider("flux")}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap ${
                    provider === "flux" ? "bg-fuchsia-500 text-black border-fuchsia-400" : "bg-white/5 text-white/70 border-white/10"
                  }`}
                >
                  Flux v1
                </button>
              </div>
            </div>
          </div>

          {/* Engine info card */}
          <div className="text-[10px] text-white/55 leading-relaxed bg-white/[0.04] border border-white/10 rounded-lg p-2">
            {provider === "lovable" ? (
              <>
                <span className="text-amber-300 font-semibold">Lovable AI</span> · ultra-realistic, follows official character anatomy
                closely. Credit limited (Lovable AI gateway). Best for hero backdrops.
              </>
            ) : (
              <>
                <span className="text-fuchsia-300 font-semibold">Flux v1</span> · unlimited free tier but lower character fidelity.
                Guided with strict size + style prompt so output stays in correct aspect ratio.
              </>
            )}
          </div>


          <div>
            <label className="flex items-center gap-2 text-[11px] text-white/80 mb-1.5">
              <input
                type="checkbox"
                checked={usePromptOverride}
                onChange={(e) => setUsePromptOverride(e.target.checked)}
              />
              Custom prompt (override default — use <code className="text-white/60">{`{title}`}</code> for anime name)
            </label>
            {usePromptOverride && (
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={6}
                className={inputClass + " w-full font-mono text-[10.5px] leading-relaxed"}
                placeholder="Enter your custom prompt…"
              />
            )}
          </div>

          <div className="bg-black/40 rounded-xl border border-white/10 p-2 min-h-[180px] grid place-items-center">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Preview"
                className={mode === "backdrop" ? "w-full rounded-lg" : "max-h-[260px] rounded-lg"}
              />
            ) : busy ? (
              <div className="w-full px-3 py-6 text-center">
                <div className="text-[11px] text-white/70 mb-2">Generating with {provider === "lovable" ? "Lovable AI" : "Flux v1"}…</div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mx-auto max-w-[280px]">
                  <div className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="text-[10px] text-white/40 mt-1">{Math.round(progress)}%</div>
              </div>
            ) : (
              <div className="text-[11px] text-white/40 py-8">No preview yet. Click Generate.</div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <button onClick={generate} disabled={busy} className={btnPrimary + " flex-1 disabled:opacity-50"}>
              {busy ? "Generating…" : previewUrl ? "Regenerate" : "Generate Preview"}
            </button>
            {previewUrl && !busy && (
              <button onClick={saveCurrent} className={btnPrimary + " flex-1"}>
                Save to {mode === "backdrop" ? "Backdrop" : "Logo"}
              </button>
            )}
          </div>

          {previewUrl && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="space-y-1">
                <div className="text-[10px] text-white/50">Current</div>
                {(mode === "backdrop" ? activeItem.backdrop : activeItem.logo) ? (
                  <img
                    src={mode === "backdrop" ? activeItem.backdrop : activeItem.logo}
                    alt=""
                    className="w-full rounded border border-white/10"
                  />
                ) : (
                  <div className="w-full h-20 bg-white/5 rounded border border-white/10 grid place-items-center text-[10px] text-white/40">none</div>
                )}
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-emerald-300">Preview</div>
                <img src={previewUrl} alt="" className="w-full rounded border border-emerald-400/30" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BackdropAiReplacer;
