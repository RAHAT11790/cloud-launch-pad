import { useEffect, useRef, useState } from "react";
import { db, ref, onValue, set, update } from "@/lib/firebase";
import { toast } from "sonner";
import {
  DEFAULT_COIN_ADS,
  saveCoinAd,
  subscribeCoinAds,
  CoinAd,
  DEFAULT_PREMIUM_SETTINGS,
} from "@/lib/premiumAccess";
import { Zap, Radio, LayoutGrid, Sparkles, Link2, Save } from "lucide-react";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; }

type SlotDef = {
  id: string;
  name: string;
  kind: CoinAd["kind"];
  help: string;
  icon: JSX.Element;
  accent: string;
};

const FREE_PREMIUM_SLOTS: SlotDef[] = [
  { id: "adsterra_popunder",     name: "One Click Popunder",   kind: "sdk",       accent: "from-amber-500/20 to-orange-500/5",   icon: <Zap className="w-3.5 h-3.5 text-amber-300" />,     help: "Counted earn-coin click. Direct URL or popunder script." },
  { id: "adsterra_social_bar",   name: "Social Bar (Push)",    kind: "sdk",       accent: "from-fuchsia-500/20 to-purple-500/5", icon: <Radio className="w-3.5 h-3.5 text-fuchsia-300" />, help: "Adsterra Push/In-Page notifications come from Social Bar — no separate push slot." },
  { id: "adsterra_banner_160",   name: "160×300 Banner",       kind: "sdk",       accent: "from-sky-500/20 to-blue-500/5",       icon: <LayoutGrid className="w-3.5 h-3.5 text-sky-300" />, help: "Renders on the Free Premium page." },
  { id: "adsterra_native_banner",name: "Native Banner",        kind: "sdk",       accent: "from-emerald-500/20 to-teal-500/5",   icon: <Sparkles className="w-3.5 h-3.5 text-emerald-300" />, help: "Native banner invoke.js snippet." },
  { id: "adsterra_smartlink",    name: "Smartlink (Preview)",  kind: "smartlink", accent: "from-pink-500/20 to-rose-500/5",      icon: <Link2 className="w-3.5 h-3.5 text-pink-300" />,    help: "Direct smartlink URL — first tap 'not counted' preview." },
];

// Warm-start cache — paints Adsterra config instantly on re-open.
const CACHE_KEY = "rs_admin_adsterra_cache_v1";
type CacheShape = {
  vpEnabled: boolean; popunder: string; directLink: string; socialLink: string; cooldownSec: number;
};
let adsterraCache: CacheShape | null = (() => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
})();
const writeCache = (c: CacheShape) => {
  adsterraCache = c;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
};

const AdsterraConfig = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [vpEnabled, setVpEnabled] = useState<boolean>(adsterraCache?.vpEnabled ?? true);
  const [popunder, setPopunder] = useState<string>(adsterraCache?.popunder ?? "");
  const [directLink, setDirectLink] = useState<string>(adsterraCache?.directLink ?? "");
  const [socialLink, setSocialLink] = useState<string>(adsterraCache?.socialLink ?? "");
  const [cooldownSec, setCooldownSec] = useState<number>(adsterraCache?.cooldownSec ?? 50);
  const [savingVp, setSavingVp] = useState(false);

  const [coinAds, setCoinAds] = useState<Record<string, CoinAd>>({});
  const [adWatchSeconds, setAdWatchSeconds] = useState<number>(15);
  const [dailyAdCap, setDailyAdCap] = useState<number>(5);
  const [savingFp, setSavingFp] = useState(false);

  const typingRef = useRef(false);
  const pendingRef = useRef<CacheShape | null>(null);
  const markTyping = () => {
    typingRef.current = true;
    window.clearTimeout((markTyping as any)._t);
    (markTyping as any)._t = window.setTimeout(() => {
      typingRef.current = false;
      const p = pendingRef.current;
      if (p) {
        pendingRef.current = null;
        setVpEnabled(p.vpEnabled); setPopunder(p.popunder); setDirectLink(p.directLink);
        setSocialLink(p.socialLink); setCooldownSec(p.cooldownSec);
      }
    }, 4000);
  };

  useEffect(() => {
    const u1 = onValue(ref(db, "settings/adsterra"), (snap) => {
      const v = snap.val() || {};
      const cd = Number(v.refreshIntervalSec);
      const snapshot: CacheShape = {
        vpEnabled: v.enabled !== false,
        popunder: v.popunder || "",
        directLink: v.directLink || "",
        socialLink: v.streamLink || v.socialLink || v.pushNotification || "",
        cooldownSec: Number.isFinite(cd) && cd >= 0 ? cd : 50,
      };
      writeCache(snapshot);
      if (typingRef.current) {
        pendingRef.current = snapshot;
      } else {
        setVpEnabled(snapshot.vpEnabled);
        setPopunder(snapshot.popunder);
        setDirectLink(snapshot.directLink);
        setSocialLink(snapshot.socialLink);
        setCooldownSec(snapshot.cooldownSec);
      }
    });
    const u2 = subscribeCoinAds((list) => {
      const map: Record<string, CoinAd> = {};
      FREE_PREMIUM_SLOTS.forEach((s) => {
        const found = list.find((a) => a.id === s.id) || DEFAULT_COIN_ADS.find((a) => a.id === s.id);
        map[s.id] = found || { id: s.id, name: s.name, url: "", enabled: true, kind: s.kind };
      });
      setCoinAds(map);
    });
    const u3 = onValue(ref(db, "settings/premium"), (snap) => {
      const v = snap.val() || {};
      setAdWatchSeconds(Number(v.adWatchSeconds) || DEFAULT_PREMIUM_SETTINGS.adWatchSeconds);
      setDailyAdCap(Number(v.dailyAdCap) || DEFAULT_PREMIUM_SETTINGS.dailyAdCap);
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  const saveVideoPlayer = async () => {
    setSavingVp(true);
    try {
      const cd = Math.max(10, Math.min(3600, Number(cooldownSec) || 60));
      await set(ref(db, "settings/adsterra"), {
        enabled: vpEnabled,
        popunder: popunder.trim(),
        directLink: directLink.trim(),
        streamLink: socialLink.trim(),
        socialLink: socialLink.trim(),
        pushNotification: socialLink.trim(),
        socialBar: socialLink.trim(),
        minGapSec: cd,
        refreshIntervalSec: cd,
      });
      toast.success("Video Player ads saved");
    } catch { toast.error("Save failed"); }
    setSavingVp(false);
  };

  const saveFreePremium = async () => {
    setSavingFp(true);
    try {
      for (const slot of FREE_PREMIUM_SLOTS) {
        const cur = coinAds[slot.id];
        await saveCoinAd({
          id: slot.id,
          name: slot.name,
          url: (cur?.url || "").trim(),
          enabled: cur?.enabled !== false,
          kind: slot.kind,
        });
      }
      await update(ref(db, "settings/premium"), {
        adWatchSeconds: Math.max(5, Math.min(120, Number(adWatchSeconds) || 15)),
        dailyAdCap: Math.max(1, Math.min(50, Number(dailyAdCap) || 5)),
      });
      toast.success("Free Premium ads saved");
    } catch { toast.error("Save failed"); }
    setSavingFp(false);
  };

  const updateSlot = (id: string, patch: Partial<CoinAd>) => {
    setCoinAds((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } as CoinAd }));
  };

  const codeArea =
    "w-full min-w-0 rounded-lg bg-black/60 border border-white/10 px-2.5 py-2 " +
    "font-mono text-[11px] leading-relaxed text-emerald-100/90 " +
    "placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-fuchsia-400/40 " +
    "resize-y break-all whitespace-pre-wrap overflow-auto";

  return (
    <div className="space-y-5 min-w-0">
      {/* Video Player Ads */}
      <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#1a0f2e]/70 to-black/40 p-4 space-y-4 min-w-0 overflow-hidden">
        <header className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-fuchsia-500/15 border border-fuchsia-400/25 flex items-center justify-center">🎬</span>
              <h3 className="text-sm font-bold text-white truncate">Video Player Ads</h3>
            </div>
            <p className="text-[11px] text-white/50 mt-1">Only user-click gated — Popunder + Social/Push.</p>
          </div>
          <label className="inline-flex items-center gap-2 text-[11px] text-white/80 shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
            <input type="checkbox" className="accent-fuchsia-500" checked={vpEnabled} onChange={(e) => { markTyping(); setVpEnabled(e.target.checked); }} />
            {vpEnabled ? "Enabled" : "Off"}
          </label>
        </header>

        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-300" />
            <span className="text-[11px] font-semibold text-white/85">One-Click Popunder</span>
            <span className="text-[10px] text-white/40">click-gated</span>
          </div>
          <textarea value={popunder} onChange={(e) => { markTyping(); setPopunder(e.target.value); }} rows={3}
            className={codeArea}
            placeholder='https://... or <script src="https://.../popunder.js"></script>' />
        </div>

        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5 text-pink-300" />
            <span className="text-[11px] font-semibold text-white/85">Direct Link (Anti-AdBlock backup)</span>
          </div>
          <textarea value={directLink} onChange={(e) => { markTyping(); setDirectLink(e.target.value); }} rows={2}
            className={codeArea}
            placeholder="https://valuationappeared.com/xxxxx?key=..." />
          <p className="text-[10px] text-white/45">Used when the popunder script is blocked or already capped — keeps ads running all session.</p>
        </div>

        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-fuchsia-300" />
            <span className="text-[11px] font-semibold text-white/85">Social Bar / In-Page Push</span>
          </div>
          <textarea value={socialLink} onChange={(e) => { markTyping(); setSocialLink(e.target.value); }} rows={3}
            className={codeArea}
            placeholder='https://... or <script src="https://.../social-bar.js"></script>' />
          <p className="text-[10px] text-white/45">Adsterra push notifications ship from the Social Bar placement.</p>
        </div>

        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-emerald-300" />
            <span className="text-[11px] font-semibold text-white/85">Ad Cool-down (seconds)</span>
          </div>
          <input type="number" min={10} max={3600} value={cooldownSec}
            onChange={(e) => { markTyping(); setCooldownSec(Number(e.target.value)); }}
            className={inputClass} />
          <p className="text-[10px] text-white/45">
            Minimum gap between two player ads. 60 = one ad per minute, all session long (new users get 1.5× this gap).
          </p>
        </div>


        <button onClick={saveVideoPlayer} disabled={savingVp}
          className={btnPrimary + " w-full inline-flex items-center justify-center gap-1.5"}>
          <Save className="w-3.5 h-3.5" />
          {savingVp ? "Saving..." : "Save Video Player Ads"}
        </button>
      </section>

    </div>
  );
};

export default AdsterraConfig;
