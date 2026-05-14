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
  id: string;
  storageKey: SlotKey;
  title: string;
  icon: any;
  desc: string;
  inputLabel: string;
  fieldType: "src" | "url" | "raw";
  placeholder: string;
  hasCooldown?: boolean;
}> = [
  {
    id: "multitag", storageKey: "popunder", title: "Multitag (all-in-one)", icon: Megaphone,
    desc: "Official Monetag bundle from the docs. One code can activate Onclick, Push Notifications, In-Page Push, and Vignette together. Use this only if you want the combined Monetag setup.",
    inputLabel: "Multitag code",
    fieldType: "raw", placeholder: `<script src="https://example-monetag-domain.com/tag.min.js" data-cfasync="false" async></script>\n\nবা full code snippet paste করুন`,
  },
  {
    id: "onclickPop", storageKey: "onclickPop", title: "OnClick PopUnder", icon: MousePointerClick,
    desc: "Official Monetag click-triggered tab ad. Paste the exact tag from Monetag docs/dashboard. It fires only on player interaction and respects cooldown.",
    inputLabel: "OnClick PopUnder tag",
    fieldType: "raw", placeholder: `<script src="https://5gvci.com/act/files/tag.min.js?z=11004211" data-cfasync="false" async></script>`, hasCooldown: true,
  },
  {
    id: "pushNotifications", storageKey: "custom1", title: "Push Notifications", icon: Bell,
    desc: "Official Monetag browser-push format. This needs a verified site and service worker. Paste the exact Monetag push tag here.",
    inputLabel: "Push Notifications tag",
    fieldType: "raw", placeholder: `<script src="https://example-monetag-domain.com/tag.min.js" data-cfasync="false" async></script>`,
  },
  {
    id: "inPagePush", storageKey: "inPagePush", title: "In-Page Push (Banner)", icon: LayoutPanelTop,
    desc: "Official Monetag in-page banner format. Usually this is the Monetag IIFE snippet with s.dataset.zone + s.src, but full <script> tags and raw src URLs are also accepted.",
    inputLabel: "In-Page Push code",
    fieldType: "raw", placeholder: `(function(s){s.dataset.zone='11000277',s.src='https://al5sm.com/tag.min.js'})([document.documentElement,document.body].filter(Boolean).pop().appendChild(document.createElement('script')))` ,
  },
  {
    id: "vignette", storageKey: "vignette", title: "Vignette Banner", icon: Maximize2,
    desc: "Official Monetag vignette format. Paste the exact tag or snippet given by Monetag. It shows as an overlay-style banner when the player session starts.",
    inputLabel: "Vignette tag",
    fieldType: "raw", placeholder: `<script src="https://example-monetag-domain.com/tag.min.js" data-cfasync="false" async></script>`,
  },
  {
    id: "directLink", storageKey: "directLink", title: "Direct Link (SmartLink)", icon: Link2,
    desc: "Official Monetag smart link. Paste only the direct destination URL from Monetag. It opens in a new tab on player tap and respects cooldown.",
    inputLabel: "Direct Link URL",
    fieldType: "url", placeholder: "https://omg10.com/4/11000244", hasCooldown: true,
  },
];

const MonetagConfig = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [enabled, setEnabled] = useState(true);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({ multitag: true });
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

  const saveSlot = async (def: typeof SLOT_DEFS[number]) => {
    setSavingKey(def.id);
    try {
      const cur = slots[def.storageKey] || { enabled: true };
      const clean: Slot = {
        enabled: cur.enabled !== false,
      };
      const src = typeof cur.src === "string" ? cur.src.trim() : "";
      const raw = typeof cur.raw === "string" ? cur.raw.trim() : "";
      if (src) clean.src = src;
      if (raw) clean.raw = raw;
      if (def.hasCooldown) {
        const cooldown = Number(cur.cooldownSec);
        clean.cooldownSec = cooldown > 0 ? cooldown : 60;
      }
      await set(ref(db, `settings/monetag/slots/${def.storageKey}`), clean);
      toast.success("Slot saved");
    } catch (e: any) { toast.error(e?.message || "Save failed"); }
    finally { setSavingKey(null); }
  };

  return (
    <div className="space-y-4 max-w-full overflow-hidden">
      {/* ── Master toggle ─────────────────────────────────────── */}
      <div className={`${glassCard} max-w-full p-4`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-white">Monetag Ads</h3>
            <p className="text-xs text-white/50 mt-1 break-words">
              All slots load <strong>only inside the video player</strong>, and are <strong>fully skipped for premium users</strong>.
              Anti-adblock fallback (fetch + blob inject) is built in — even DNS/extension blockers can't strip these.
            </p>
            <p className="text-[11px] text-white/40 mt-2 break-words">
              Official Monetag web formats used here: <strong>Multitag</strong>, <strong>OnClick PopUnder</strong>, <strong>Push Notifications</strong>, <strong>In-Page Push (Banner)</strong>, <strong>Vignette Banner</strong>, and <strong>Direct Link (SmartLink)</strong>.
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
        const slot = slots[def.storageKey] || { enabled: true };
        const isOpen = !!open[def.id];
        const Icon = def.icon;
        return (
          <div key={def.id} className={`${glassCard} max-w-full overflow-hidden p-4`}>
            {/* Header (clickable) */}
            <button
              type="button"
              onClick={() => setOpen((p) => ({ ...p, [def.id]: !isOpen }))}
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
                    onChange={(e) => updateSlot(def.storageKey, { enabled: e.target.checked })}
                  />
                  Slot enabled
                </label>

                {def.fieldType === "raw" ? (
                  <div>
                    <label className="block text-xs text-white/70 mb-1">{def.inputLabel}</label>
                    <textarea
                      className={`${inputClass} font-mono text-xs leading-relaxed min-h-[140px] w-full max-w-full break-all whitespace-pre-wrap resize-y`}
                      placeholder={def.placeholder}
                      value={slot.raw || ""}
                      onChange={(e) => updateSlot(def.storageKey, { raw: e.target.value })}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-white/70 mb-1">{def.inputLabel}</label>
                    <input
                      className={`${inputClass} w-full max-w-full`}
                      placeholder={def.placeholder}
                      value={slot.src || ""}
                      onChange={(e) => updateSlot(def.storageKey, { src: e.target.value })}
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
                      onChange={(e) => updateSlot(def.storageKey, { cooldownSec: Number(e.target.value) })}
                    />
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:justify-end">
                  <button onClick={() => saveSlot(def)} disabled={savingKey === def.id} className={`${btnPrimary} w-full sm:w-auto min-h-11 px-4 py-3 inline-flex items-center justify-center whitespace-nowrap text-sm disabled:opacity-60`}>
                    {savingKey === def.id ? "Saving…" : "Save Slot"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Info: SW verification ─────────────────────────────── */}
      <div className={`${glassCard} max-w-full p-4`}>
        <h4 className="text-sm font-bold text-white mb-2">Verification Service Worker</h4>
        <p className="text-xs text-white/60 break-words">
          Monetag SW served at <code className="text-amber-300 break-all">/sw.js</code> (zone <code>10888250</code>, domain <code>3nbf4.com</code>).
          Auto-registers on the published domain only — preview iframes are skipped per Lovable rules.
          Verify in Monetag dashboard with <code className="text-amber-300 break-all">https://rsanime03.lovable.app/sw.js</code>.
        </p>
      </div>

      <div className={`${glassCard} max-w-full p-4`}>
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
