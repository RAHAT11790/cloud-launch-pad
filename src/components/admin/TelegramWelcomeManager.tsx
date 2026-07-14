import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save, Eye, EyeOff, GripVertical, ArrowUp, ArrowDown } from "lucide-react";
import { db, ref, onValue, set, update, remove, push } from "@/lib/firebase";
import {
  DEFAULT_TG_WELCOME_BUTTONS,
  type TgWelcomeButton,
} from "@/components/TelegramWelcomeModal";

type Props = {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
};

const COLOR_OPTIONS: TgWelcomeButton["color"][] = ["blue", "purple", "green", "pink", "orange"];
const ICON_OPTIONS: NonNullable<TgWelcomeButton["icon"]>[] = ["send", "chat", "support", "link"];

// Warm-start cache — keeps the panel painted instantly on re-open and
// survives HMR + tab-switches so admins never stare at a blank screen.
const CACHE_KEY = "rs_admin_tg_welcome_cache_v1";
type CacheShape = {
  enabled: boolean;
  heading: string;
  description: string;
  buttons: (TgWelcomeButton & { _key?: string })[];
};
let tgWelcomeCache: CacheShape | null = (() => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
})();
const writeCache = (c: CacheShape) => {
  tgWelcomeCache = c;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
};

const TelegramWelcomeManager = ({ glassCard, inputClass, btnPrimary, btnSecondary }: Props) => {
  const [enabled, setEnabled] = useState<boolean>(tgWelcomeCache?.enabled ?? true);
  const [heading, setHeading] = useState<string>(tgWelcomeCache?.heading ?? "");
  const [description, setDescription] = useState<string>(tgWelcomeCache?.description ?? "");
  const [buttons, setButtons] = useState<(TgWelcomeButton & { _key?: string })[]>(
    tgWelcomeCache?.buttons ?? [],
  );
  const [loaded, setLoaded] = useState<boolean>(!!tgWelcomeCache);

  // Pause snapshot re-apply while admin is actively typing/editing —
  // otherwise Firebase pushes yank inputs out from under them.
  const isTypingRef = useRef(false);
  const pendingRef = useRef<CacheShape | null>(null);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/telegramWelcome"), (snap) => {
      const val = snap.val() || {};
      const nextEnabled = val.enabled !== false;
      const nextHeading = val.heading || "";
      const nextDescription = val.description || "";
      const raw = val.buttons;
      let list: (TgWelcomeButton & { _key?: string })[] = [];
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        list = Object.entries(raw).map(([k, b]: [string, any]) => ({ ...b, _key: k }));
      } else if (Array.isArray(raw)) {
        list = raw.map((b: any) => ({ ...b }));
      }
      if (!list.length) list = DEFAULT_TG_WELCOME_BUTTONS.map((b) => ({ ...b }));
      list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      const snapshot: CacheShape = {
        enabled: nextEnabled, heading: nextHeading, description: nextDescription, buttons: list,
      };
      writeCache(snapshot);
      if (isTypingRef.current) {
        pendingRef.current = snapshot;
      } else {
        setEnabled(nextEnabled);
        setHeading(nextHeading);
        setDescription(nextDescription);
        setButtons(list);
      }
      setLoaded(true);
    });
    return () => unsub();
  }, []);

  const markTyping = () => {
    isTypingRef.current = true;
    // Auto-release after 4s of no typing so parked snapshots can flow in.
    window.clearTimeout((markTyping as any)._t);
    (markTyping as any)._t = window.setTimeout(() => {
      isTypingRef.current = false;
      const p = pendingRef.current;
      if (p) {
        pendingRef.current = null;
        setEnabled(p.enabled);
        setHeading(p.heading);
        setDescription(p.description);
        setButtons(p.buttons);
      }
    }, 4000);
  };

  const toggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await update(ref(db, "settings/telegramWelcome"), { enabled: next });
      toast.success(next ? "Popup enabled" : "Popup disabled");
    } catch { toast.error("Failed to update"); }
  };

  const saveMeta = async () => {
    try {
      await update(ref(db, "settings/telegramWelcome"), {
        enabled,
        heading: heading.trim(),
        description: description.trim(),
      });
      toast.success("Heading & description saved");
    } catch { toast.error("Save failed"); }
  };

  const saveButton = async (b: TgWelcomeButton & { _key?: string }, idx: number) => {
    if (!b.title.trim() || !b.url.trim()) { toast.error("Title & URL required"); return; }
    const payload: TgWelcomeButton = {
      id: b.id || b._key || `btn_${Date.now()}`,
      title: b.title.trim(),
      subtitle: (b.subtitle || "").trim(),
      url: b.url.trim(),
      color: b.color || "blue",
      icon: b.icon || "send",
      order: idx + 1,
    };
    try {
      const key = b._key || payload.id;
      await set(ref(db, `settings/telegramWelcome/buttons/${key}`), payload);
      toast.success(`"${payload.title}" saved`);
    } catch { toast.error("Save failed"); }
  };

  const deleteButton = async (b: TgWelcomeButton & { _key?: string }) => {
    if (!confirm(`Delete button "${b.title}"?`)) return;
    const key = b._key || b.id;
    try {
      await remove(ref(db, `settings/telegramWelcome/buttons/${key}`));
      toast.success("Button removed");
    } catch { toast.error("Delete failed"); }
  };

  const addButton = async () => {
    const newRef = await push(ref(db, "settings/telegramWelcome/buttons"), {
      id: `btn_${Date.now()}`,
      title: "New Button",
      subtitle: "",
      url: "https://t.me/",
      color: "blue",
      icon: "send",
      order: buttons.length + 1,
    });
    toast.success("Button added — edit and save");
  };

  const restoreDefaults = async () => {
    if (!confirm("Reset to default 3 buttons (Channel / Group / Support)?")) return;
    const payload: Record<string, TgWelcomeButton> = {};
    DEFAULT_TG_WELCOME_BUTTONS.forEach((b) => { payload[b.id] = b; });
    try {
      await set(ref(db, "settings/telegramWelcome/buttons"), payload);
      toast.success("Defaults restored");
    } catch { toast.error("Failed"); }
  };

  const moveButton = (idx: number, dir: -1 | 1) => {
    const next = [...buttons];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setButtons(next);
  };

  const updateLocal = (idx: number, patch: Partial<TgWelcomeButton>) => {
    markTyping();
    setButtons((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const resetSeenFlag = () => {
    try {
      localStorage.removeItem("rs_tg_welcome_seen_v1");
      toast.success("Local 'seen' flag cleared — reload site to preview popup");
    } catch { toast.error("Failed"); }
  };

  if (!loaded) return null;

  return (
    <div className={`${glassCard} p-4 mb-4`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-white">
          📣 Telegram Welcome Popup
        </h3>
        <button
          onClick={toggleEnabled}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${
            enabled ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-white/5 text-white/60 border border-white/10"
          }`}
        >
          {enabled ? <><Eye size={12} /> Enabled</> : <><EyeOff size={12} /> Disabled</>}
        </button>
      </div>
      <p className="text-[11px] text-white/60 mb-4">
        First-time visitors see this popup once (stored in their browser). Edit heading, description and any number of Telegram buttons below.
      </p>

      {/* Meta */}
      <div className="space-y-2 mb-4">
        <label className="text-[11px] text-white/60">Heading</label>
        <input value={heading} onChange={(e) => { markTyping(); setHeading(e.target.value); }}
               placeholder="Join our Telegram community"
               className={inputClass} />
        <label className="text-[11px] text-white/60">Description</label>
        <textarea value={description} onChange={(e) => { markTyping(); setDescription(e.target.value); }}
                  placeholder="Get instant notifications for every new episode..."
                  rows={3}
                  className={`${inputClass} resize-y`} />
        <div className="flex gap-2 flex-wrap">
          <button onClick={saveMeta} className={btnPrimary}>
            <Save size={14} className="inline mr-1" /> Save text
          </button>
          <button onClick={resetSeenFlag} className={btnSecondary}>
            Preview on this browser
          </button>
        </div>
      </div>

      {/* Buttons list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[12px] font-semibold text-white">Buttons ({buttons.length})</h4>
          <div className="flex gap-2">
            <button onClick={restoreDefaults} className={btnSecondary}>Restore defaults</button>
            <button onClick={addButton} className={btnPrimary}>
              <Plus size={14} className="inline mr-1" /> Add button
            </button>
          </div>
        </div>

        {buttons.map((b, idx) => (
          <div key={b._key || b.id || idx}
               className="rounded-xl border border-white/10 bg-[#0b0f1e]/60 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <GripVertical size={14} className="text-white/30" />
              <span className="text-[11px] text-white/60">#{idx + 1}</span>
              <div className="flex-1" />
              <button onClick={() => moveButton(idx, -1)} className="p-1 rounded hover:bg-white/10 text-white/70" title="Move up">
                <ArrowUp size={12} />
              </button>
              <button onClick={() => moveButton(idx, 1)} className="p-1 rounded hover:bg-white/10 text-white/70" title="Move down">
                <ArrowDown size={12} />
              </button>
              <button onClick={() => deleteButton(b)} className="p-1 rounded hover:bg-red-500/20 text-red-400" title="Delete">
                <Trash2 size={12} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50">Title</label>
                <input value={b.title || ""} onChange={(e) => updateLocal(idx, { title: e.target.value })}
                       placeholder="Update Channel" className={inputClass} />
              </div>
              <div>
                <label className="text-[10px] text-white/50">Subtitle (optional)</label>
                <input value={b.subtitle || ""} onChange={(e) => updateLocal(idx, { subtitle: e.target.value })}
                       placeholder="Short helper text" className={inputClass} />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-white/50">URL</label>
              <input value={b.url || ""} onChange={(e) => updateLocal(idx, { url: e.target.value })}
                     placeholder="https://t.me/..." className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50">Color</label>
                <select value={b.color || "blue"} onChange={(e) => updateLocal(idx, { color: e.target.value as any })}
                        className={inputClass}>
                  {COLOR_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50">Icon</label>
                <select value={b.icon || "send"} onChange={(e) => updateLocal(idx, { icon: e.target.value as any })}
                        className={inputClass}>
                  {ICON_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            </div>
            <button onClick={() => saveButton(b, idx)} className={`${btnPrimary} w-full`}>
              <Save size={13} className="inline mr-1" /> Save this button
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TelegramWelcomeManager;
