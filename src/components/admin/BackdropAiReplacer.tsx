import { useEffect, useMemo, useState, useCallback } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
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

const DEFAULT_BACKDROP_PROMPT = `CREATE A PROFESSIONAL 16:9 CINEMATIC ANIME PROMOTIONAL BANNER FOR "{title}" IN ULTRA DETAILED 4K HDR QUALITY.

Use ONLY the OFFICIAL canonical main characters of "{title}" — exact signature hairstyle, eye design, outfit, weapons. Characters must be instantly recognizable. Do NOT invent characters or use generic anime faces. Hero protagonist on the right 55% of frame; supporting cast in official hierarchy.

Background inspired by official key visuals: signature environment, atmospheric particles, HDR rim lighting, cinematic fog. Match the anime's official color palette and mood.

Style: Netflix / Crunchyroll promotional banner quality, sharp focus, perfect anatomy, no deformed faces, no watermarks. Ultra detailed, 4K, HDR.

The final result must look like an OFFICIAL anime poster remastered into a premium cinematic banner.`;

const DEFAULT_LOGO_PROMPT = `Official anime TITLE LOGO for "{title}", square 1:1. Title "{title}" rendered in the canonical official logo treatment of the real anime (matching font, colors, glow, ornaments). Japanese kanji of the title below in small elegant typography. Deep black radial gradient background. High resolution, perfect kerning, no foreground characters, no extra text.`;

const callGenerateBackdrop = async (body: Record<string, any>) => {
  const endpoint = await getEdgeFunctionUrl("generate-backdrop");
  if (!endpoint) throw new Error("Generate Backdrop function URL not configured. Deploy it from EGD Manager first.");
  if (!/\/functions\/v1\/generate-backdrop\/?(?:[?#].*)?$/i.test(endpoint)) {
    throw new Error("Active URL is not generate-backdrop. Save the EGD deployer URL again, then redeploy generate-backdrop.");
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw ? (() => { try { return JSON.parse(raw); } catch { return { error: raw }; } })() : {};
  if (!res.ok) {
    const err = new Error(data?.error || `Generate Backdrop failed (${res.status})`) as any;
    err.status = res.status;
    err.raw = data;
    throw err;
  }
  return { ...data, endpoint };
};

const BackdropAiReplacer = ({ glassCard, btnPrimary, btnSecondary, inputClass }: Props) => {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("backdrop");
  const [customPrompt, setCustomPrompt] = useState("");
  const [usePromptOverride, setUsePromptOverride] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeFunctionUrl, setActiveFunctionUrl] = useState("");

  const [lovableStatus, setLovableStatus] = useState<{
    state: "unknown" | "checking" | "online" | "offline";
    model?: string;
    message?: string;
    checkedAt?: number;
  }>({ state: "unknown" });
  const [lastResult, setLastResult] = useState<{
    model?: string; at?: number;
  } | null>(null);
  const [lastError, setLastError] = useState<{
    message?: string; status?: number; at?: number;
  } | null>(null);

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
    return () => { u1(); u2(); };
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim();
    const scored = items.filter((i) => fuzzyMatch(q, i.title, 0.5)).slice();
    scored.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return scored;
  }, [items, filter]);

  const activeItem = useMemo(() => {
    if (!activeId) return null;
    const [t, id] = activeId.split(":");
    return items.find((i) => i.type === t && i.id === id) || null;
  }, [activeId, items]);

  useEffect(() => { setPreviewUrl(null); setProgress(0); }, [activeId, mode]);

  useEffect(() => {
    const refresh = () => getEdgeFunctionUrl("generate-backdrop").then((url) => setActiveFunctionUrl(url || ""));
    void refresh();
    const off1 = onValue(ref(db, "egdManager/config/deployerUrl"), refresh);
    const off2 = onValue(ref(db, "settings/functionOverrides/generate-backdrop"), refresh);
    return () => { off1(); off2(); };
  }, []);

  useEffect(() => {
    if (usePromptOverride && !customPrompt) {
      setCustomPrompt(mode === "backdrop" ? DEFAULT_BACKDROP_PROMPT : DEFAULT_LOGO_PROMPT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usePromptOverride, mode]);

  const checkLovable = useCallback(async (silent = false) => {
    setLovableStatus((s) => ({ ...s, state: "checking" }));
    try {
      const data = await callGenerateBackdrop({ action: "check-lovable" });
      const l = data?.lovable || {};
      setLovableStatus(l?.ok
        ? { state: "online", model: l.model, message: l.message || "Gateway reachable", checkedAt: Date.now() }
        : { state: "offline", message: l?.error || "Probe failed", checkedAt: Date.now() });
      if (!silent) {
        if (l?.ok) toast.success(`Lovable AI ✓ (${l.model || "ready"})`);
        else toast.error(`Lovable AI offline — out of credits or not configured`);
      }
    } catch (e: any) {
      setLovableStatus({ state: "offline", message: e?.message || String(e), checkedAt: Date.now() });
      if (!silent) toast.error(e?.message || "Probe failed");
    }
  }, []);

  useEffect(() => {
    if (lovableStatus.state === "unknown") void checkLovable(true);
  }, [lovableStatus.state, checkLovable]);

  const generate = async () => {
    if (!activeItem || busy) return;
    if (mode === "backdrop" && !activeItem.backdrop) {
      toast.error("This title has no reference backdrop. Add one first so AI can edit the correct anime image.");
      return;
    }
    setBusy(true);
    setProgress(8);
    setLastError(null);
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
        provider: "lovable",
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
      setLastResult({ model: data.model, at: Date.now() });
      toast.success(`Preview ready · ${data.model || "lovable"}`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setLastError({ message: msg, status: e?.status, at: Date.now() });
      toast.error(e?.status === 429
        ? "Lovable AI rate-limited or out of credits. It will resume automatically when credits refill."
        : msg);
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

  const lovDot =
    lovableStatus.state === "online" ? "bg-emerald-400" :
    lovableStatus.state === "offline" ? "bg-rose-400" :
    lovableStatus.state === "checking" ? "bg-amber-400 animate-pulse" :
    "bg-white/30";

  return (
    <div className={glassCard + " space-y-4 overflow-hidden"}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex w-7 h-7 rounded-lg bg-gradient-to-br from-fuchsia-500/30 to-amber-500/30 border border-white/10 items-center justify-center text-[13px]">🎨</span>
          <h3 className="text-[13px] font-bold text-white tracking-wide">Backdrop & Logo AI Generator</h3>
        </div>
        <p className="text-[10.5px] text-white/55 leading-relaxed break-words">
          Powered by Lovable AI Gateway. Works while Lovable credits are available; pauses automatically when they run out.
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

          {/* Lovable Gateway status card — the ONLY engine */}
          <div className="rounded-xl border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/[0.06] to-pink-500/[0.04] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/[0.03]">
              <span className={`w-2 h-2 rounded-full ${lovDot}`} />
              <div className="text-[11px] font-bold text-white tracking-wide">Lovable AI Gateway</div>
              <span className={
                "ml-auto text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md " +
                (lovableStatus.state === "online" ? "bg-emerald-500/15 text-emerald-300" :
                 lovableStatus.state === "offline" ? "bg-rose-500/15 text-rose-300" :
                 lovableStatus.state === "checking" ? "bg-amber-500/15 text-amber-300" :
                 "bg-white/10 text-white/50")
              }>{lovableStatus.state}</span>
            </div>
            <div className="px-3 py-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10.5px]">
              <div className="text-white/50">Model</div>
              <div className="text-white/90 truncate text-right">{lovableStatus.model || "google/gemini-3.1-flash-image-preview"}</div>
              <div className="text-white/50">Last check</div>
              <div className="text-white/90 text-right">{lovableStatus.checkedAt ? new Date(lovableStatus.checkedAt).toLocaleTimeString() : "—"}</div>
              {lovableStatus.message && (<><div className="text-white/50">Message</div><div className="text-white/70 text-right break-words">{lovableStatus.message}</div></>)}
            </div>
            <div className="px-3 pb-3 flex items-center gap-2">
              <button
                onClick={() => checkLovable(false)}
                disabled={lovableStatus.state === "checking"}
                className={btnSecondary + " flex-1 !text-[11px] !py-1.5 disabled:opacity-40"}
              >
                {lovableStatus.state === "checking" ? "Testing…" : "Test Connection"}
              </button>
            </div>
            <div className="px-3 pb-3 text-[10px] text-fuchsia-200/80 leading-relaxed">
              🔒 Calls only your EGD-deployed <code className="text-white/70 bg-white/10 px-1 rounded">generate-backdrop</code> URL. Works while Lovable credits last and pauses when they run out — no extra setup needed.
              <div className="mt-1 text-[9.5px] text-fuchsia-100/60 break-all">Active URL: {activeFunctionUrl || "Not configured"}</div>
            </div>
          </div>

          {(lastResult || lastError) && (
            <div className={`rounded-xl border overflow-hidden ${lastError ? "border-rose-500/30 bg-rose-500/[0.05]" : "border-emerald-500/25 bg-emerald-500/[0.05]"}`}>
              <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                <span className="text-[11px] font-bold text-white">
                  {lastError ? "❌ Last Error" : "✅ Last Generation"}
                </span>
                <span className="ml-auto text-[9.5px] text-white/50">
                  {new Date((lastError?.at || lastResult?.at) as number).toLocaleTimeString()}
                </span>
              </div>
              <div className="px-3 py-2 grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 text-[10.5px]">
                {lastResult && (<><div className="text-white/50">Model</div><div className="text-white/90 break-all">{lastResult.model}</div></>)}
                {lastError && (
                  <>
                    <div className="text-white/50">Status</div><div className="text-rose-200">{lastError.status || "?"}</div>
                    <div className="text-white/50">Message</div><div className="text-rose-100 break-words">{lastError.message}</div>
                  </>
                )}
              </div>
            </div>
          )}

          {mode === "backdrop" && (
            <div className="bg-emerald-500/[0.06] border border-emerald-500/25 rounded-lg p-2.5 space-y-1.5">
              <div className="text-[11px] text-white/85 leading-relaxed">
                <span className="text-emerald-300 font-semibold">Reference required</span> — Lovable AI always edits the current backdrop so it cannot return a random unrelated image.
              </div>
              {!activeItem.backdrop && (
                <div className="text-[10px] text-amber-300">⚠ No reference backdrop on this title. Generation is blocked until a backdrop is added.</div>
              )}
              {activeItem.backdrop && (
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
                <div className="text-[11px] text-white/70 mb-2">Generating with Lovable AI…</div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mx-auto max-w-[280px]">
                  <div className="h-full bg-gradient-to-r from-fuchsia-400 to-pink-400 transition-all" style={{ width: `${progress}%` }} />
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
