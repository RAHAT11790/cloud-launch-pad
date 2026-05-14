import { useEffect, useState } from "react";
import { db, ref, onValue, set, update } from "@/lib/firebase";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Megaphone, MousePointerClick, Bell, LayoutPanelTop, Maximize2, Image as ImageIcon, Link2, Code2 } from "lucide-react";

interface Props {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
}

type SlotKey =
  | "popunder" | "onclickPop" | "inPagePush" | "nativeBanner"
  | "vignette" | "smartBanner" | "directLink"
  | "custom1" | "custom2" | "custom3";

type Slot = {
  enabled: boolean;
  src?: string;
  raw?: string;
  cooldownSec?: number;
};

const SLOT_DEFS: Array<{
  key: SlotKey;
  title: string;
  icon: any;
  desc: string;
  fieldType: "src" | "url" | "raw";
  placeholder: string;
  hasCooldown?: boolean;
}> = [
  {
    key: "popunder", title: "Pop-Under (Classic)", icon: Megaphone,
    desc: "Paste ANYTHING from Monetag dashboard: full <script src=...> tag, the IIFE snippet, or just the raw URL — auto-parsed. Loads once per session inside the player.",
    fieldType: "raw", placeholder: `<script>(function(s){s.dataset.zone='11000277',s.src='https://al5sm.com/tag.min.js'})([document.documentElement,document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>\n\n— or just —\n\nhttps://al5sm.com/tag.min.js`,
  },
  {
    key: "onclickPop", title: "OnClick Pop-Under", icon: MousePointerClick,
    desc: "Fires on user tap inside the player. Paste the full <script> tag or just the URL. Rate-limited so users aren't spammed.",
    fieldType: "raw", placeholder: `<script src="https://5gvci.com/act/files/tag.min.js?z=11004211" data-cfasync="false" async></script>`, hasCooldown: true,
  },
  {
    key: "inPagePush", title: "In-Page Push / Notifications", icon: Bell,
    desc: "Slide-in notification (no browser permission needed). Paste the IIFE snippet or full <script> tag — zone is auto-extracted.",
    fieldType: "raw", placeholder: `<script>(function(s){s.dataset.zone='11000277',s.src='https://al5sm.com/tag.min.js'})([document.documentElement,document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>`,
  },
  {
    key: "nativeBanner", title: "Native Banner", icon: LayoutPanelTop,
    desc: "Content-style ad block. Paste full <script> tag or URL.",
    fieldType: "raw", placeholder: `<script src="https://...js" async></script>`,
  },
  {
    key: "vignette", title: "Vignette / Interstitial", icon: Maximize2,
    desc: "Full-screen interstitial. Paste full <script> tag or URL.",
    fieldType: "raw", placeholder: `<script src="https://groleegni.net/..." async></script>`,
  },
  {
    key: "smartBanner", title: "Smart / Sticky Banner", icon: ImageIcon,
    desc: "Sticky bottom/top ad bar. Paste full <script> tag or URL.",
    fieldType: "raw", placeholder: `<script src="https://..." async></script>`,
  },
  {
    key: "directLink", title: "Direct Link", icon: Link2,
    desc: "Just the destination URL — opens in new tab on player tap, with cooldown.",
    fieldType: "url", placeholder: "https://omg10.com/4/11000244", hasCooldown: true,
  },
  {
    key: "custom1", title: "Custom Slot #1", icon: Code2,
    desc: "Free-form. Paste any raw <script>…</script>, IIFE, or URL — auto-parsed.",
    fieldType: "raw", placeholder: "<script>...</script>",
  },
  {
    key: "custom2", title: "Custom Slot #2", icon: Code2,
    desc: "Free-form raw script slot.",
    fieldType: "raw", placeholder: "<script>...</script>",
  },
  {
    key: "custom3", title: "Custom Slot #3", icon: Code2,
    desc: "Free-form raw script slot.",
    fieldType: "raw", placeholder: "<script>...</script>",
  },
];

const MonetagConfig = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [enabled, setEnabled] = useState(true);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({ popunder: true });
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/monetag"), (snap) => {
      const v = snap.val() || {};
      setEnabled(v.enabled !== false);
      setSlots(v.slots || {});
    });
    return () => unsub();
  }, []);

  const saveGlobal = async (next: boolean) => {
    setEnabled(next);
    try { await update(ref(db, "settings/monetag"), { enabled: next }); toast.success(next ? "Monetag enabled" : "Monetag disabled"); }
    catch (e: any) { toast.error(e?.message || "Save failed"); }
  };

  const updateSlot = (key: SlotKey, patch: Partial<Slot>) => {
    setSlots((p) => ({ ...p, [key]: { enabled: true, ...(p[key] || {}), ...patch } }));
  };

  const saveSlot = async (key: SlotKey) => {
    setSavingKey(key);
    try {
      const cur = slots[key] || { enabled: true };
      const clean: Slot = {
        enabled: cur.enabled !== false,
        src: typeof cur.src === "string" ? cur.src.trim() : "",
        raw: typeof cur.raw === "string" ? cur.raw : "",
        cooldownSec: Number(cur.cooldownSec) > 0 ? Number(cur.cooldownSec) : undefined,
      };
      await set(ref(db, `settings/monetag/slots/${key}`), clean);
      toast.success("Slot saved");
    } catch (e: any) { toast.error(e?.message || "Save failed"); }
    finally { setSavingKey(null); }
  };

  return (
    <div className="space-y-4 max-w-full overflow-hidden">
      {/* ── Master toggle ─────────────────────────────────────── */}
      <div className={`${glassCard} max-w-full`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-white">Monetag Ads</h3>
            <p className="text-xs text-white/50 mt-1 break-words">
              All slots load <strong>only inside the video player</strong>, and are <strong>fully skipped for premium users</strong>.
              Anti-adblock fallback (fetch + blob inject) is built in — even DNS/extension blockers can't strip these.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-white/80 shrink-0">
            <input type="checkbox" className="w-4 h-4 accent-amber-400" checked={enabled} onChange={(e) => saveGlobal(e.target.checked)} />
            <span>Master {enabled ? "ON" : "OFF"}</span>
          </label>
        </div>
      </div>

      {/* ── Slot cards ────────────────────────────────────────── */}
      {SLOT_DEFS.map((def) => {
        const slot = slots[def.key] || { enabled: true };
        const isOpen = !!open[def.key];
        const Icon = def.icon;
        return (
          <div key={def.key} className={`${glassCard} max-w-full overflow-hidden`}>
            {/* Header (clickable) */}
            <button
              type="button"
              onClick={() => setOpen((p) => ({ ...p, [def.key]: !isOpen }))}
              className="w-full flex items-center gap-3 text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <Icon size={16} className="text-amber-300" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-white truncate">{def.title}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${slot.enabled !== false ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/50"}`}>
                    {slot.enabled !== false ? "ON" : "OFF"}
                  </span>
                  {(slot.src || slot.raw) ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">configured</span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/40">empty</span>
                  )}
                </div>
              </div>
              {isOpen ? <ChevronDown size={16} className="text-white/60 shrink-0" /> : <ChevronRight size={16} className="text-white/60 shrink-0" />}
            </button>

            {isOpen && (
              <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
                <p className="text-xs text-white/60 break-words">{def.desc}</p>

                <label className="flex items-center gap-2 text-xs text-white/80">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-amber-400"
                    checked={slot.enabled !== false}
                    onChange={(e) => updateSlot(def.key, { enabled: e.target.checked })}
                  />
                  Slot enabled
                </label>

                {def.fieldType === "raw" ? (
                  <div>
                    <label className="block text-xs text-white/70 mb-1">Raw script snippet</label>
                    <textarea
                      className={`${inputClass} font-mono text-xs min-h-[120px] w-full max-w-full break-all`}
                      placeholder={def.placeholder}
                      value={slot.raw || ""}
                      onChange={(e) => updateSlot(def.key, { raw: e.target.value })}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-white/70 mb-1">
                      {def.fieldType === "url" ? "Destination URL" : "Script src URL"}
                    </label>
                    <input
                      className={`${inputClass} w-full max-w-full`}
                      placeholder={def.placeholder}
                      value={slot.src || ""}
                      onChange={(e) => updateSlot(def.key, { src: e.target.value })}
                    />
                  </div>
                )}

                {def.hasCooldown && (
                  <div>
                    <label className="block text-xs text-white/70 mb-1">Cooldown (seconds between triggers)</label>
                    <input
                      type="number"
                      min={5}
                      className={`${inputClass} w-full max-w-[180px]`}
                      value={slot.cooldownSec ?? 60}
                      onChange={(e) => updateSlot(def.key, { cooldownSec: Number(e.target.value) })}
                    />
                  </div>
                )}

                <div className="flex justify-end">
                  <button onClick={() => saveSlot(def.key)} disabled={savingKey === def.key} className={`${btnPrimary} text-sm`}>
                    {savingKey === def.key ? "Saving…" : "Save Slot"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Info: SW verification ─────────────────────────────── */}
      <div className={`${glassCard} max-w-full`}>
        <h4 className="text-sm font-bold text-white mb-2">Verification Service Worker</h4>
        <p className="text-xs text-white/60 break-words">
          Monetag SW served at <code className="text-amber-300 break-all">/sw.js</code> (zone <code>10888250</code>, domain <code>3nbf4.com</code>).
          Auto-registers on the published domain only — preview iframes are skipped per Lovable rules.
          Verify in Monetag dashboard with <code className="text-amber-300 break-all">https://rsanime03.lovable.app/sw.js</code>.
        </p>
      </div>

      <div className={`${glassCard} max-w-full`}>
        <h4 className="text-sm font-bold text-white mb-2">Premium Bypass</h4>
        <p className="text-xs text-white/60 break-words">
          Premium users (active subscription in <code>users/&lt;uid&gt;/premium</code>) get a hard early-return — <strong>no Monetag script is ever injected for them</strong>,
          and the player tap-to-direct-link handler is disabled.
        </p>
      </div>
    </div>
  );
};

export default MonetagConfig;
