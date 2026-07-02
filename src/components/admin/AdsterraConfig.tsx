import { useEffect, useState } from "react";
import { db, ref, onValue, set, update } from "@/lib/firebase";
import { toast } from "sonner";
import {
  DEFAULT_COIN_ADS,
  saveCoinAd,
  subscribeCoinAds,
  CoinAd,
  DEFAULT_PREMIUM_SETTINGS,
} from "@/lib/premiumAccess";
import { Zap, Radio, LayoutGrid, Sparkles, Link2, Clock, Shield, Save } from "lucide-react";

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

const AdsterraConfig = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [vpEnabled, setVpEnabled] = useState(true);
  const [popunder, setPopunder] = useState("");
  const [socialLink, setSocialLink] = useState("");
  const [vpMinGapSec, setVpMinGapSec] = useState<number>(25);
  const [savingVp, setSavingVp] = useState(false);

  const [coinAds, setCoinAds] = useState<Record<string, CoinAd>>({});
  const [adWatchSeconds, setAdWatchSeconds] = useState<number>(15);
  const [dailyAdCap, setDailyAdCap] = useState<number>(5);
  const [savingFp, setSavingFp] = useState(false);

  useEffect(() => {
    const u1 = onValue(ref(db, "settings/adsterra"), (snap) => {
      const v = snap.val() || {};
      setVpEnabled(v.enabled !== false);
      setPopunder(v.popunder || "");
      setSocialLink(v.streamLink || v.socialLink || v.pushNotification || "");
      const n = Number(v.minGapSec);
      setVpMinGapSec(Number.isFinite(n) && n >= 20 ? Math.min(n, 120) : 25);
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
      await set(ref(db, "settings/adsterra"), {
        enabled: vpEnabled,
        popunder: popunder.trim(),
        streamLink: socialLink.trim(),
        socialLink: socialLink.trim(),
        pushNotification: "",
        socialBar: socialLink.trim(),
        minGapSec: Math.max(20, Math.min(120, Number(vpMinGapSec) || 25)),
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
            <input type="checkbox" className="accent-fuchsia-500" checked={vpEnabled} onChange={(e) => setVpEnabled(e.target.checked)} />
            {vpEnabled ? "Enabled" : "Off"}
          </label>
        </header>

        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-300" />
            <span className="text-[11px] font-semibold text-white/85">One-Click Popunder</span>
            <span className="text-[10px] text-white/40">click-gated</span>
          </div>
          <textarea value={popunder} onChange={(e) => setPopunder(e.target.value)} rows={3}
            className={codeArea}
            placeholder='https://... or <script src="https://.../popunder.js"></script>' />
        </div>

        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-fuchsia-300" />
            <span className="text-[11px] font-semibold text-white/85">Social Bar / In-Page Push</span>
          </div>
          <textarea value={socialLink} onChange={(e) => setSocialLink(e.target.value)} rows={3}
            className={codeArea}
            placeholder='https://... or <script src="https://.../social-bar.js"></script>' />
          <p className="text-[10px] text-white/45">Adsterra push notifications ship from the Social Bar placement.</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-sky-300" />
            <span className="text-[11px] font-semibold text-white/85">Popunder minimum gap</span>
          </div>
          <div className="flex items-center gap-2">
            <input type="number" min={20} max={120} value={vpMinGapSec}
              onChange={(e) => setVpMinGapSec(Number(e.target.value))}
              className={inputClass + " w-24"} />
            <span className="text-[11px] text-white/50">seconds (20–120)</span>
          </div>
        </div>

        <button onClick={saveVideoPlayer} disabled={savingVp}
          className={btnPrimary + " w-full inline-flex items-center justify-center gap-1.5"}>
          <Save className="w-3.5 h-3.5" />
          {savingVp ? "Saving..." : "Save Video Player Ads"}
        </button>
      </section>

      {/* Free Premium Ads */}
      <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#0f1f2e]/70 to-black/40 p-4 space-y-4 min-w-0 overflow-hidden">
        <header className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-400/25 flex items-center justify-center">🎁</span>
            <h3 className="text-sm font-bold text-white truncate">Free Premium Ads</h3>
          </div>
          <p className="text-[11px] text-white/50 mt-1">Popunder + Smartlink drive the 2-tap flow. Social Bar = push. 160×300 renders on page.</p>
        </header>

        <div className="grid gap-3">
          {FREE_PREMIUM_SLOTS.map((slot) => {
            const cur = coinAds[slot.id] || ({ id: slot.id, name: slot.name, url: "", enabled: true, kind: slot.kind } as CoinAd);
            const on = cur.enabled !== false;
            return (
              <div key={slot.id}
                className={`rounded-xl border border-white/10 bg-gradient-to-br ${slot.accent} p-3 space-y-2 min-w-0 overflow-hidden`}>
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-md bg-black/40 border border-white/10 flex items-center justify-center shrink-0">
                      {slot.icon}
                    </span>
                    <span className="text-[12px] font-semibold text-white truncate">{slot.name}</span>
                  </div>
                  <button
                    onClick={() => updateSlot(slot.id, { enabled: !on })}
                    className={`shrink-0 h-6 w-11 rounded-full relative transition-colors ${on ? "bg-emerald-500/70" : "bg-white/15"}`}
                    aria-label="toggle"
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                </div>
                <textarea value={cur.url} onChange={(e) => updateSlot(slot.id, { url: e.target.value })} rows={2}
                  className={codeArea}
                  placeholder="https://... or <script src=...></script>" />
                <p className="text-[10px] text-white/45 leading-relaxed">{slot.help}</p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-1.5 min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
              <Clock className="w-3.5 h-3.5 text-amber-300" /> Count timer
            </div>
            <input type="number" min={5} max={120} value={adWatchSeconds}
              onChange={(e) => setAdWatchSeconds(Number(e.target.value))} className={inputClass + " w-full"} />
            <p className="text-[10px] text-white/45">Seconds to earn 1 coin.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-1.5 min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
              <Shield className="w-3.5 h-3.5 text-emerald-300" /> Daily cap
            </div>
            <input type="number" min={1} max={50} value={dailyAdCap}
              onChange={(e) => setDailyAdCap(Number(e.target.value))} className={inputClass + " w-full"} />
            <p className="text-[10px] text-white/45">Coins per device / day.</p>
          </div>
        </div>

        <button onClick={saveFreePremium} disabled={savingFp}
          className={btnPrimary + " w-full inline-flex items-center justify-center gap-1.5"}>
          <Save className="w-3.5 h-3.5" />
          {savingFp ? "Saving..." : "Save Free Premium Ads"}
        </button>
      </section>
    </div>
  );
};

export default AdsterraConfig;
