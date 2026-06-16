import { useEffect, useMemo, useState, useCallback } from "react";
import { db, ref, onValue, update, get, set } from "@/lib/firebase";
import { toast } from "sonner";
import { fuzzyMatch } from "@/lib/fuzzyMatch";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string; }

type Item = {
  id: string;
  title: string;
  backdrop?: string;
  logo?: string;
  year?: string | number;
  type: "webseries" | "movies";
  category?: string;
  storyline?: string;
  genres?: string[];
  addedAt?: number;
};
type Mode = "backdrop" | "logo";
type Provider = "gemini";

const DEFAULT_BACKDROP_PROMPT = `CREATE A PROFESSIONAL 16:9 CINEMATIC ANIME PROMOTIONAL BANNER FOR "{title}" IN ULTRA DETAILED 4K HDR QUALITY.

Use ONLY the OFFICIAL canonical main characters of "{title}" — exact signature hairstyle, eye design, outfit, weapons. Characters must be instantly recognizable. Do NOT invent characters or use generic anime faces. Hero protagonist on the right 55% of frame; supporting cast in official hierarchy.

Background inspired by official key visuals: signature environment, atmospheric particles, HDR rim lighting, cinematic fog. Match the anime's official color palette and mood.

Style: Netflix / Crunchyroll promotional banner quality, sharp focus, perfect anatomy, no deformed faces, no watermarks. Ultra detailed, 4K, HDR.

The final result must look like an OFFICIAL anime poster remastered into a premium cinematic banner.`;

const DEFAULT_LOGO_PROMPT = `Official anime TITLE LOGO for "{title}", square 1:1. Title "{title}" rendered in the canonical official logo treatment of the real anime (matching font, colors, glow, ornaments). Japanese kanji of the title below in small elegant typography. Deep black radial gradient background. High resolution, perfect kerning, no foreground characters, no extra text.`;

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const callGenerateBackdrop = async (body: Record<string, any>) => {
  const endpoint = await getEdgeFunctionUrl("generate-backdrop");
  if (!endpoint) throw new Error("Generate Backdrop function URL not configured. Deploy it from EGD Manager first.");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw ? (() => { try { return JSON.parse(raw); } catch { return { error: raw }; } })() : {};
  if (!res.ok) throw new Error(data?.error || `Generate Backdrop failed (${res.status})`);
  return data;
};

const BackdropAiReplacer = ({ glassCard, btnPrimary, btnSecondary, inputClass }: Props) => {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("backdrop");
  const [provider, setProvider] = useState<Provider>("gemini");
  const [customPrompt, setCustomPrompt] = useState("");
  const [usePromptOverride, setUsePromptOverride] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [useReference, setUseReference] = useState(true);

  // ---- EGD Gemini status ----
  const [geminiDailyLimit, setGeminiDailyLimit] = useState<number>(100);
  const [geminiUsedToday, setGeminiUsedToday] = useState<number>(0);
  const [geminiStatus, setGeminiStatus] = useState<{
    state: "unknown" | "checking" | "online" | "offline";
    model?: string;
    message?: string;
    checkedAt?: number;
  }>({ state: "unknown" });

  useEffect(() => {
    const u1 = onValue(ref(db, "webseries"), (snap) => {
      const v = snap.val() || {};
      const ws = Object.keys(v).map((id) => ({
        id, title: v[id]?.title || id, backdrop: v[id]?.backdrop, logo: v[id]?.logo,
        year: v[id]?.year, type: "webseries" as const,
        category: v[id]?.category, storyline: v[id]?.storyline,
        genres: Array.isArray(v[id]?.genres) ? v[id].genres : (v[id]?.category ? [v[id].category] : undefined),
        addedAt: Number(v[id]?.addedAt || v[id]?.createdAt || v[id]?.updatedAt || 0),
      }));
      setItems((prev) => [...ws, ...prev.filter((p) => p.type !== "webseries")]);
    });
    const u2 = onValue(ref(db, "movies"), (snap) => {
      const v = snap.val() || {};
      const mv = Object.keys(v).map((id) => ({
        id, title: v[id]?.title || id, backdrop: v[id]?.backdrop, logo: v[id]?.logo,
        year: v[id]?.year, type: "movies" as const,
        category: v[id]?.category, storyline: v[id]?.storyline,
        genres: Array.isArray(v[id]?.genres) ? v[id].genres : (v[id]?.category ? [v[id].category] : undefined),
        addedAt: Number(v[id]?.addedAt || v[id]?.createdAt || v[id]?.updatedAt || 0),
      }));
      setItems((prev) => [...prev.filter((p) => p.type !== "movies"), ...mv]);
    });
    // Load Gemini quota config only. API key stays inside the EGD-deployed function.
    const u3 = onValue(ref(db, "settings/geminiImage"), (snap) => {
      const v = snap.val() || {};
      setGeminiDailyLimit(Number(v.dailyLimit) || 100);
    });
    const u4 = onValue(ref(db, `settings/geminiImage/usage/${todayKey()}`), (snap) => {
      setGeminiUsedToday(Number(snap.val()) || 0);
    });
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  // Fuzzy + latest-first
  const visible = useMemo(() => {
    const q = filter.trim();
    const scored = items
      .filter((i) => fuzzyMatch(q, i.title, 0.5))
      .slice();
    scored.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return scored;
  }, [items, filter]);

  const activeItem = useMemo(() => {
    if (!activeId) return null;
    const [t, id] = activeId.split(":");
    return items.find((i) => i.type === t && i.id === id) || null;
  }, [activeId, items]);

  useEffect(() => { setPreviewUrl(null); setProgress(0); }, [activeId, mode, provider]);

  useEffect(() => {
    if (usePromptOverride && !customPrompt) {
      setCustomPrompt(mode === "backdrop" ? DEFAULT_BACKDROP_PROMPT : DEFAULT_LOGO_PROMPT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usePromptOverride, mode]);

  // ---- Gemini live status: probe key via edge function (server reads GEMINI_API_KEY from env) ----
  const checkGemini = useCallback(async (silent = false) => {
    setGeminiStatus((s) => ({ ...s, state: "checking" }));
    try {
      const data = await callGenerateBackdrop({ action: "check-gemini" });
      if (data?.ok) {
        setGeminiStatus({
          state: "online", model: data.model, message: data.message || "Server key verified",
          checkedAt: Date.now(),
        });
        if (!silent) toast.success(`Gemini online · ${data.model}`);
      } else {
        setGeminiStatus({
          state: "offline", message: data?.error || "Probe failed", checkedAt: Date.now(),
        });
        if (!silent) toast.error(data?.error || "Probe failed");
      }
    } catch (e: any) {
      setGeminiStatus({ state: "offline", message: e?.message || String(e), checkedAt: Date.now() });
      if (!silent) toast.error(e?.message || "Probe failed");
    }
  }, []);

  // Auto-check whenever provider becomes gemini
  useEffect(() => {
    if (provider === "gemini" && geminiStatus.state === "unknown") {
      void checkGemini(true);
    }
  }, [provider, geminiStatus.state, checkGemini]);

  const saveGeminiConfig = async () => {
    try {
      await update(ref(db, "settings/geminiImage"), {
        dailyLimit: Number(geminiDailyLimit) || 100,
      });
      toast.success("Quota saved");
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message || e}`);
    }
  };

  const generate = async () => {
    if (!activeItem || busy) return;
    if (provider === "gemini" && geminiUsedToday >= geminiDailyLimit) {
      toast.error(`Daily limit reached (${geminiUsedToday}/${geminiDailyLimit}).`);
      return;
    }
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
        referenceImageUrl: mode === "backdrop" ? activeItem.backdrop : undefined,
        useReference: mode === "backdrop",
        genres: activeItem.genres,
        overview: activeItem.storyline,
      };
      if (usePromptOverride && customPrompt.trim()) {
        payload.customPrompt = customPrompt
          .replace(/\{title\}/gi, activeItem.title)
          .replace(/\[WRITE ANIME NAME HERE\]/gi, activeItem.title);
      }
      const data = await callGenerateBackdrop(payload);
      if (!data?.url) throw new Error(data?.error || "no url");
      setProgress(100);
      setPreviewUrl(data.url as string);
      toast.success(`Preview ready via EGD URL (${data.engine})`);




      if (provider === "gemini") {
        // bump usage atomically (best-effort)
        try {
          const k = `settings/geminiImage/usage/${todayKey()}`;
          const snap = await get(ref(db, k));
          await set(ref(db, k), (Number(snap.val()) || 0) + 1);
        } catch {}
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      toast.error(msg.includes("RATE") ? "Rate limited — try again shortly." : msg);
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

  const dotColor =
    geminiStatus.state === "online" ? "bg-emerald-400" :
    geminiStatus.state === "offline" ? "bg-rose-400" :
    geminiStatus.state === "checking" ? "bg-amber-400 animate-pulse" :
    "bg-white/30";

  return (
    <div className={glassCard + " space-y-4 overflow-hidden"}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex w-7 h-7 rounded-lg bg-gradient-to-br from-fuchsia-500/30 to-amber-500/30 border border-white/10 items-center justify-center text-[13px]">🎨</span>
          <h3 className="text-[13px] font-bold text-white tracking-wide">Backdrop & Logo AI Generator</h3>
        </div>
        <p className="text-[10.5px] text-white/55 leading-relaxed break-words">
          Pick an anime → preview → regenerate or save. Calls only your EGD-deployed generate-backdrop URL.
        </p>
      </div>

      {!activeItem && (
        <>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search anime title… (fuzzy, 50% match)"
            className={inputClass + " w-full"}
          />
          <div className="flex flex-col gap-2 max-h-[520px] overflow-y-auto pr-1 -mr-1">
            {visible.map((it) => (
              <button
                key={it.type + it.id}
                onClick={() => setActiveId(`${it.type}:${it.id}`)}
                className="group w-full text-left rounded-xl p-2 pr-3 border border-white/8 bg-gradient-to-br from-white/[0.04] to-white/[0.015] hover:from-white/[0.08] hover:to-white/[0.03] hover:border-white/15 flex gap-3 items-center transition-all duration-150 min-w-0 active:scale-[0.99]"
              >
                <div className="relative w-[88px] h-12 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-white/10 bg-black/40">
                  {it.backdrop ? (
                    <img src={it.backdrop} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-[9px] text-white/40">no art</div>
                  )}
                </div>
                <div className="flex-1 min-w-0 py-0.5">
                  <div className="text-[12.5px] font-semibold text-white truncate leading-tight">{it.title}</div>
                  <div className="text-[10px] text-white/45 mt-0.5 flex items-center gap-1.5">
                    <span className="px-1.5 py-px rounded bg-white/8 uppercase tracking-wide text-[9px]">{it.type}</span>
                    {it.year ? <span>{it.year}</span> : null}
                    {it.logo ? <span className="text-emerald-400/80">• logo</span> : null}
                  </div>
                </div>
                <span className="text-white/30 group-hover:text-white/60 text-[14px] transition">›</span>
              </button>
            ))}
            {visible.length === 0 && (
              <div className="text-center text-white/40 text-xs py-8">No items match the filter.</div>
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
              <div className="grid grid-cols-1 gap-1.5">
                <button
                  onClick={() => setProvider("gemini")}
                  className="px-2 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap bg-sky-500 text-black border-sky-400"
                >
                  EGD Gemini
                </button>
              </div>
            </div>
          </div>


          {provider === "gemini" && (
            <div className="rounded-xl border border-sky-500/25 bg-gradient-to-br from-sky-500/[0.06] to-indigo-500/[0.04] overflow-hidden">
              {/* Header strip */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/[0.03]">
                <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                <div className="text-[11px] font-bold text-white tracking-wide">Gemini Image API</div>
                <span className={
                  "ml-auto text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md " +
                  (geminiStatus.state === "online" ? "bg-emerald-500/15 text-emerald-300" :
                   geminiStatus.state === "offline" ? "bg-rose-500/15 text-rose-300" :
                   geminiStatus.state === "checking" ? "bg-amber-500/15 text-amber-300" :
                   "bg-white/10 text-white/50")
                }>
                  {geminiStatus.state}
                </span>
              </div>

              {/* Status grid */}
              <div className="px-3 py-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10.5px] border-b border-white/10">
                <div className="text-white/50">Model</div>
                <div className="text-white/90 truncate text-right">{geminiStatus.model || "—"}</div>
                <div className="text-white/50">Today</div>
                <div className="text-white/90 text-right">{geminiUsedToday} / {geminiDailyLimit}</div>
                <div className="text-white/50">Last check</div>
                <div className="text-white/90 text-right">{geminiStatus.checkedAt ? new Date(geminiStatus.checkedAt).toLocaleTimeString() : "—"}</div>
                {geminiStatus.message && (
                  <>
                    <div className="text-white/50">Message</div>
                    <div className="text-white/70 text-right break-words">{geminiStatus.message}</div>
                  </>
                )}
              </div>

              {/* Form */}
              <div className="px-3 py-3 space-y-2.5">
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-2">
                  <div className="text-[10.5px] text-emerald-200/90 leading-snug">
                    🔒 This panel sends requests only to the <b>EGD Manager saved generate-backdrop URL</b>. <b>GEMINI_API_KEY</b> stays inside that deployed function.
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-white/55 font-semibold">
                    Daily Quota (client-side counter)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={geminiDailyLimit}
                    onChange={(e) => setGeminiDailyLimit(Number(e.target.value) || 0)}
                    className={inputClass + " w-full !text-[12px]"}
                  />
                  <div className="text-[9.5px] text-white/40">Free tier resets at midnight UTC.</div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => checkGemini(false)}
                    disabled={geminiStatus.state === "checking"}
                    className={btnSecondary + " flex-1 !text-[11px] !py-1.5 disabled:opacity-40"}
                  >
                    {geminiStatus.state === "checking" ? "Testing…" : "Test Connection"}
                  </button>
                  <button
                    onClick={saveGeminiConfig}
                    className={btnPrimary + " flex-1 !text-[11px] !py-1.5"}
                  >
                    Save Quota
                  </button>
                </div>


                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank" rel="noopener noreferrer"
                  className="block text-center text-[10px] text-sky-300/80 hover:text-sky-300 underline pt-0.5"
                >
                  Get a Gemini API key →
                </a>
              </div>
            </div>
          )}


          {mode === "backdrop" && (
            <div className="bg-emerald-500/[0.06] border border-emerald-500/25 rounded-lg p-2.5 space-y-1.5">
              <label className="flex items-start gap-2 text-[11px] text-white/85 leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={mode === "backdrop"}
                  disabled
                  onChange={() => setUseReference(true)}
                />
                <span className="min-w-0 break-words">
                  <span className="text-emerald-300 font-semibold">Reference required</span> — EGD Gemini always edits the current backdrop so it cannot switch into random text-only image generation.
                </span>
              </label>
              {useReference && !activeItem.backdrop && (
                <div className="text-[10px] text-amber-300 pl-5">⚠ No reference backdrop on this title. Will fall back to text-to-image.</div>
              )}
              {useReference && activeItem.backdrop && (
                <img src={activeItem.backdrop} alt="ref" className="w-full rounded border border-emerald-500/30 mt-1" />
              )}
            </div>
          )}

          <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2.5">
            <label className="flex items-start gap-2 text-[11px] text-white/80 leading-relaxed cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={usePromptOverride}
                onChange={(e) => setUsePromptOverride(e.target.checked)}
              />
              <span className="min-w-0 break-words">
                Custom prompt (override default) — use <code className="text-white/70 bg-white/10 px-1 rounded">{`{title}`}</code> for the anime name.
              </span>
            </label>
            {usePromptOverride && (
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={6}
                className={inputClass + " w-full font-mono text-[10.5px] leading-relaxed mt-2 resize-y"}
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
                <div className="text-[11px] text-white/70 mb-2">
                  Generating with Gemini…
                </div>
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
