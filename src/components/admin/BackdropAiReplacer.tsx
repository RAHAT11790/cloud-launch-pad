import { useEffect, useMemo, useState, useCallback } from "react";
import { db, ref, onValue, update } from "@/lib/firebase";
import { toast } from "sonner";
import { fuzzyMatch } from "@/lib/fuzzyMatch";
import {
  DEFAULT_BACKDROP_PROMPT,
  DEFAULT_LOGO_PROMPT,
  callGenerateBackdrop,
  getRoutedBackdropUrl,
  probeRoutedUrl,
  buildBackdropPayload,
} from "@/lib/backdropAi";
import CachedImg, { preloadCachedImages } from "@/components/CachedImg";
import { optimizedImageUrl } from "@/lib/imageCache";

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

// ---------------------------------------------------------------------------
// Module-level caches so remounting this tab paints INSTANTLY. The listener
// still updates the cache live; images use CachedImg so bitmaps persist
// across mounts (no more "black flash → reload" every time you open the tab).
// ---------------------------------------------------------------------------
let backdropItemsCache: Item[] = [];
let statusCache: { state: "unknown" | "checking" | "online" | "offline"; model?: string; message?: string; checkedAt?: number } = { state: "unknown" };
const STATUS_TTL_MS = 5 * 60 * 1000;

const BackdropAiReplacer = ({ glassCard, btnPrimary, btnSecondary, inputClass }: Props) => {
  const [items, setItems] = useState<Item[]>(() => backdropItemsCache);
  const [filter, setFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("backdrop");
  const [customPrompt, setCustomPrompt] = useState("");
  const [usePromptOverride, setUsePromptOverride] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const [lovableStatus, setLovableStatus] = useState(statusCache);
  const [lastResult, setLastResult] = useState<{ model?: string; at?: number } | null>(null);
  const [lastError, setLastError] = useState<{ message?: string; status?: number; at?: number } | null>(null);

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
      setItems((prev) => {
        const next = [...ws, ...prev.filter((p) => p.type !== "webseries")];
        backdropItemsCache = next;
        return next;
      });
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
      setItems((prev) => {
        const next = [...prev.filter((p) => p.type !== "movies"), ...mv];
        backdropItemsCache = next;
        return next;
      });
    });
    return () => { u1(); u2(); };
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim();
    const scored = items.filter((i) => fuzzyMatch(q, i.title, 0.5)).slice();
    scored.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return scored;
  }, [items, filter]);

  // Warm the image cache once per unique thumbnail URL — CachedImg de-dupes
  // and localStorage-persists, so this runs at most once per URL across the
  // whole session, not on every tab open.
  useEffect(() => {
    if (!visible.length) return;
    const urls = visible.slice(0, 60).map((i) => optimizedImageUrl(i.backdrop, "backdrop")).filter(Boolean);
    void preloadCachedImages(urls, 60);
  }, [visible]);

  const activeItem = useMemo(() => {
    if (!activeId) return null;
    const [t, id] = activeId.split(":");
    return items.find((i) => i.type === t && i.id === id) || null;
  }, [activeId, items]);

  useEffect(() => { setPreviewUrl(null); setProgress(0); }, [activeId, mode]);

  useEffect(() => {
    if (usePromptOverride && !customPrompt) {
      setCustomPrompt(mode === "backdrop" ? DEFAULT_BACKDROP_PROMPT : DEFAULT_LOGO_PROMPT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usePromptOverride, mode]);

  const checkLovable = useCallback(async (silent = false) => {
    setLovableStatus((s) => { const next = { ...s, state: "checking" as const }; statusCache = next; return next; });
    try {
      // Routed (custom deployed) URL → probe the ENDPOINT itself. A custom
      // function is not required to implement the `check-lovable` action, so
      // asking for it was the reason a perfectly working URL showed "Down".
      const routed = await getRoutedBackdropUrl();
      if (routed) {
        const probe = await probeRoutedUrl(routed);
        const next = probe.ok
          ? { state: "online" as const, model: "custom route", message: probe.message, checkedAt: Date.now() }
          : { state: "offline" as const, message: probe.message, checkedAt: Date.now() };
        setLovableStatus(next); statusCache = next;
        if (!silent) probe.ok ? toast.success("Custom backdrop route ✓") : toast.error(probe.message);
        return;
      }

      const data = await callGenerateBackdrop({ action: "check-lovable" });
      const l = data?.lovable || {};
      const next = l?.ok
        ? { state: "online" as const, model: l.model, message: l.message || "Gateway reachable", checkedAt: Date.now() }
        : { state: "offline" as const, message: l?.error || "Probe failed", checkedAt: Date.now() };
      setLovableStatus(next); statusCache = next;
      if (!silent) {
        if (l?.ok) toast.success(`Lovable AI ✓ (${l.model || "ready"})`);
        else toast.error(`Lovable AI offline — out of credits or not configured`);
      }
    } catch (e: any) {
      const next = { state: "offline" as const, message: e?.message || String(e), checkedAt: Date.now() };
      setLovableStatus(next); statusCache = next;
      if (!silent) toast.error(e?.message || "Probe failed");
    }
  }, []);


  // Only re-probe if status is unknown OR older than 5 min. Prevents a probe
  // every time the tab opens.
  useEffect(() => {
    const stale = !lovableStatus.checkedAt || (Date.now() - lovableStatus.checkedAt > STATUS_TTL_MS);
    if (lovableStatus.state === "unknown" || stale) void checkLovable(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async () => {
    if (!activeItem || busy) return;
    setBusy(true); setProgress(8); setLastError(null);
    const tick = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : Math.min(90, p + Math.random() * 7 + 2)));
    }, 500);
    try {
      const payload = buildBackdropPayload({
        title: activeItem.title,
        mode,
        year: activeItem.year,
        genres: activeItem.genres,
        overview: activeItem.storyline,
        animeId: activeItem.id,
        type: activeItem.type,
        customPrompt: usePromptOverride ? customPrompt : undefined,
      });
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
      setPreviewUrl(null); setProgress(0);
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message || e}`);
    }
  };

  const statusTone =
    lovableStatus.state === "online" ? { dot: "bg-emerald-400", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30", label: "Online" } :
    lovableStatus.state === "offline" ? { dot: "bg-rose-400", chip: "bg-rose-500/15 text-rose-300 border-rose-400/30", label: "Offline" } :
    lovableStatus.state === "checking" ? { dot: "bg-amber-400 animate-pulse", chip: "bg-amber-500/15 text-amber-300 border-amber-400/30", label: "Checking" } :
    { dot: "bg-white/30", chip: "bg-white/10 text-white/60 border-white/15", label: "Idle" };

  return (
    <div className={glassCard + " space-y-3 overflow-hidden"}>
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="inline-flex w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500/25 to-amber-500/25 border border-white/10 items-center justify-center text-[15px] shadow-inner">🎨</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-bold text-white tracking-tight leading-none">Backdrop &amp; Logo AI</h3>
          <div className="text-[10px] text-white/50 mt-1 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${statusTone.dot}`} />
            <span>{lovableStatus.model === "custom route" ? "Custom route" : "Lovable Gateway"} · {statusTone.label}</span>
          </div>
        </div>
        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${statusTone.chip}`}>
          {items.length} items
        </span>
      </div>

      {!activeItem && (
        <>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search anime title…"
            className={inputClass + " w-full"}
          />
          <div
            className="grid grid-cols-2 gap-2 max-h-[560px] overflow-y-auto pr-1 -mr-1"
            style={{ contentVisibility: "auto", containIntrinsicSize: "560px" }}
          >
            {visible.map((it) => {
              const thumb = optimizedImageUrl(it.backdrop, "backdrop");
              return (
                <button
                  key={it.type + it.id}
                  onClick={() => setActiveId(`${it.type}:${it.id}`)}
                  className="group text-left rounded-xl overflow-hidden border border-white/10 bg-white/[0.03] hover:border-fuchsia-400/40 hover:bg-white/[0.06] transition-colors active:scale-[0.98]"
                >
                  <div className="relative aspect-video bg-black/50 overflow-hidden">
                    {thumb ? (
                      <CachedImg src={thumb} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-[9px] text-white/30">no art</div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent pointer-events-none" />
                    <div className="absolute top-1 left-1 flex gap-1">
                      <span className="px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[8.5px] uppercase font-bold tracking-wide text-white/85 border border-white/10">{it.type === "movies" ? "movie" : "series"}</span>
                    </div>
                    {it.logo && (
                      <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-500/90 text-black text-[9px] font-bold grid place-items-center border border-emerald-300">L</span>
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="text-[11.5px] font-semibold text-white truncate leading-tight">{it.title}</div>
                    <div className="text-[9.5px] text-white/45 mt-0.5">{it.year || "—"}</div>
                  </div>
                </button>
              );
            })}
            {visible.length === 0 && (
              <div className="col-span-2 text-center text-white/40 text-xs py-10">
                {items.length === 0 ? "Loading library…" : "No items match the filter."}
              </div>
            )}
          </div>
        </>
      )}

      {activeItem && (
        <div className="space-y-3">
          {/* Active item bar */}
          <div className="flex items-center gap-2.5 bg-gradient-to-r from-white/[0.06] to-white/[0.02] rounded-xl p-2 border border-white/10">
            <div className="w-16 h-9 rounded-md overflow-hidden bg-black/40 flex-shrink-0 ring-1 ring-white/10">
              {activeItem.backdrop ? (
                <CachedImg src={optimizedImageUrl(activeItem.backdrop, "backdrop")} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center text-[9px] text-white/40">no bd</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold text-white truncate leading-tight">{activeItem.title}</div>
              <div className="text-[9.5px] text-white/50 mt-0.5 uppercase tracking-wide">{activeItem.type} {activeItem.year ? `· ${activeItem.year}` : ""}</div>
            </div>
            <button
              onClick={() => { setActiveId(null); setPreviewUrl(null); }}
              className={btnSecondary + " !text-[10px] !px-2.5 !py-1.5"}
            >
              ← Back
            </button>
          </div>

          {/* Mode switcher */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/30 rounded-xl border border-white/8">
            {(["backdrop", "logo"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  mode === m ? "bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white shadow" : "text-white/60 hover:text-white/90"
                }`}
              >
                {m === "backdrop" ? "Backdrop · 16:9" : "Logo · 1:1"}
              </button>
            ))}
          </div>

          {/* Gateway status compact */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center gap-2.5">
            <span className={`w-2 h-2 rounded-full ${statusTone.dot}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[10.5px] font-semibold text-white/90">Lovable AI Gateway</div>
              <div className="text-[9.5px] text-white/45 truncate">{lovableStatus.model || "openai/gpt-image-2"}</div>
            </div>
            <button
              onClick={() => checkLovable(false)}
              disabled={lovableStatus.state === "checking"}
              className="text-[10px] px-2 py-1 rounded-md bg-white/8 hover:bg-white/12 border border-white/10 disabled:opacity-40"
            >
              {lovableStatus.state === "checking" ? "…" : "Test"}
            </button>
          </div>

          {(lastResult || lastError) && (
            <div className={`rounded-lg border px-2.5 py-1.5 text-[10.5px] ${lastError ? "border-rose-500/30 bg-rose-500/[0.06] text-rose-200" : "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200"}`}>
              {lastError ? `❌ ${lastError.status || ""} ${lastError.message}` : `✅ Generated · ${lastResult?.model}`}
            </div>
          )}

          <div className="bg-fuchsia-500/[0.06] border border-fuchsia-500/25 rounded-lg p-2 text-[10.5px] text-white/80">
            <span className="text-fuchsia-300 font-semibold">GPT-Image-2</span> · ChatGPT-quality {mode === "backdrop" ? "16:9 cinematic banner" : "1:1 title logo"} from prompt only. Reference image not needed.
          </div>

          {/* Prompt override */}
          <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2">
            <label className="flex items-center gap-2 text-[10.5px] text-white/80 cursor-pointer">
              <input
                type="checkbox"
                checked={usePromptOverride}
                onChange={(e) => setUsePromptOverride(e.target.checked)}
              />
              <span>Custom prompt override</span>
            </label>
            {usePromptOverride && (
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={5}
                className={inputClass + " w-full font-mono text-[10.5px] mt-2 resize-y"}
                placeholder="Use {title} for the anime name…"
              />
            )}
          </div>

          {/* Preview area */}
          <div className="bg-black/40 rounded-xl border border-white/10 p-2 min-h-[180px] grid place-items-center overflow-hidden">
            {previewUrl ? (
              <CachedImg
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

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={generate} disabled={busy} className={btnPrimary + " flex-1 disabled:opacity-50"}>
              {busy ? "Generating…" : previewUrl ? "Regenerate" : "Generate Preview"}
            </button>
            {previewUrl && !busy && (
              <button onClick={saveCurrent} className={btnPrimary + " flex-1"}>
                Save {mode === "backdrop" ? "Backdrop" : "Logo"}
              </button>
            )}
          </div>

          {previewUrl && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="space-y-1">
                <div className="text-[10px] text-white/50 uppercase tracking-wide">Current</div>
                {(mode === "backdrop" ? activeItem.backdrop : activeItem.logo) ? (
                  <CachedImg
                    src={(mode === "backdrop" ? optimizedImageUrl(activeItem.backdrop, "backdrop") : activeItem.logo) || ""}
                    alt=""
                    className="w-full rounded border border-white/10"
                  />
                ) : (
                  <div className="w-full h-20 bg-white/5 rounded border border-white/10 grid place-items-center text-[10px] text-white/40">none</div>
                )}
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-emerald-300 uppercase tracking-wide">Preview</div>
                <CachedImg src={previewUrl} alt="" className="w-full rounded border border-emerald-400/30" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BackdropAiReplacer;
