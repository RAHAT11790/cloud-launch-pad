import { useEffect, useState } from "react";
import { db, ref, onValue, set, update, get } from "@/lib/firebase";
import { toast } from "sonner";
import {
  DEFAULT_COIN_ADS,
  saveCoinAd,
  subscribeCoinAds,
  CoinAd,
  DEFAULT_PREMIUM_SETTINGS,
} from "@/lib/premiumAccess";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; }

// Fixed slot definitions for Free Premium background SDKs
const FREE_PREMIUM_SLOTS: { id: string; name: string; kind: CoinAd["kind"]; help: string }[] = [
  { id: "adsterra_popunder", name: "One Click Popunder", kind: "sdk", help: "Counted earn-coin click. Paste the one-click/popunder script or direct URL." },
  { id: "adsterra_social_bar", name: "Social Bar / In-Page Push", kind: "sdk", help: "This is the push/social placement. Paste the Social Bar script here — no separate push box." },
  { id: "adsterra_banner_160", name: "160x300 Banner", kind: "sdk", help: "Paste the 160x300 banner code/snippet. It renders on the Free Premium page." },
  { id: "adsterra_native_banner", name: "Native Banner", kind: "sdk", help: "Native banner invoke.js SDK/snippet." },
  { id: "adsterra_smartlink", name: "Smartlink (Stream Link)", kind: "smartlink", help: "Direct smartlink URL — used for the first-tap 'not counted' preview." },
];

const AdsterraConfig = ({ glassCard, inputClass, btnPrimary }: Props) => {
  // ---- Video Player Ads (settings/adsterra) ----
  const [vpEnabled, setVpEnabled] = useState(true);
  const [popunder, setPopunder] = useState("");
  const [socialLink, setSocialLink] = useState("");
  const [vpMinGapSec, setVpMinGapSec] = useState<number>(25);
  const [savingVp, setSavingVp] = useState(false);

  // ---- Free Premium Ads (settings/premiumCoinAds + settings/premium.adWatchSeconds) ----
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
        pushNotification: "", // Adsterra push is handled by Social Bar/In-Page Push.
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

  return (
    <div className="space-y-6">
      {/* Video Player Ads */}
      <div className={glassCard + " space-y-4"}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-bold text-white">🎬 Video Player Ads</h3>
            <p className="text-[11px] text-white/60 mt-1 max-w-full break-words">Only user-click gated ads run inside the video player — Popunder and Social Link/In-Page Push.</p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-white/80 flex-shrink-0">
            <input type="checkbox" checked={vpEnabled} onChange={(e) => setVpEnabled(e.target.checked)} />
            {vpEnabled ? "Enabled" : "Disabled"}
          </label>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-white/80 block">One Click Popunder <span className="text-white/40">(user-click gated)</span></label>
          <textarea value={popunder} onChange={(e) => setPopunder(e.target.value)} rows={3}
            className={inputClass + " w-full max-w-full font-mono text-[11px] break-all whitespace-pre-wrap overflow-x-auto"}
            placeholder='https://... or <script src="https://.../popunder.js"></script>' />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-white/80 block">Social Link / In-Page Push</label>
          <textarea value={socialLink} onChange={(e) => setSocialLink(e.target.value)} rows={3}
            className={inputClass + " w-full max-w-full font-mono text-[11px] break-all whitespace-pre-wrap overflow-x-auto"}
            placeholder='https://... social link or <script src="https://.../social-bar.js"></script>' />
          <p className="text-[10px] text-white/50 max-w-full break-words">Adsterra push/social notifications come from the Social Bar / Social Link placement, so this replaces the old wrong standalone push box.</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-white/80 block">Popunder minimum gap (seconds)</label>
          <input type="number" min={20} max={120} value={vpMinGapSec}
            onChange={(e) => setVpMinGapSec(Number(e.target.value))}
            className={inputClass + " w-full"} placeholder="25" />
          <p className="text-[10px] text-white/50 max-w-full break-words">Between 20–120s. Popunder fires only if this much time has passed since the last one.</p>
        </div>

        <button onClick={saveVideoPlayer} disabled={savingVp} className={btnPrimary + " w-full"}>
          {savingVp ? "Saving..." : "Save Video Player Ads"}
        </button>
      </div>

      {/* Free Premium Ads */}
      <div className={glassCard + " space-y-4"}>
        <div>
          <h3 className="text-base font-bold text-white">🎁 Free Premium Ads</h3>
          <p className="text-[11px] text-white/60 mt-1 max-w-full break-words">All Free Premium ad links live here only. Popunder + Smartlink drive the 2-tap earn button; Social Bar is the push/social placement; 160x300 banner renders on the page.</p>
        </div>

        {FREE_PREMIUM_SLOTS.map((slot) => {
          const cur = coinAds[slot.id] || ({ id: slot.id, name: slot.name, url: "", enabled: true, kind: slot.kind } as CoinAd);
          return (
            <div key={slot.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2 overflow-hidden">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white/90 min-w-0 break-words">{slot.name}</span>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-white/70">
                  <input type="checkbox" checked={cur.enabled !== false}
                    onChange={(e) => updateSlot(slot.id, { enabled: e.target.checked })} />
                  On
                </label>
              </div>
              <textarea value={cur.url} onChange={(e) => updateSlot(slot.id, { url: e.target.value })} rows={2}
                className={inputClass + " w-full max-w-full font-mono text-[11px] break-all whitespace-pre-wrap overflow-x-auto"}
                placeholder="https://... or <script src=...></script>" />
              <p className="text-[10px] text-white/50 max-w-full break-words leading-relaxed">{slot.help}</p>
            </div>
          );
        })}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/80 block">Count timer (sec)</label>
            <input type="number" min={5} max={120} value={adWatchSeconds}
              onChange={(e) => setAdWatchSeconds(Number(e.target.value))} className={inputClass + " w-full"} />
            <p className="text-[10px] text-white/50">Time user must stay on ad tab to earn 1 coin.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/80 block">Daily cap / device</label>
            <input type="number" min={1} max={50} value={dailyAdCap}
              onChange={(e) => setDailyAdCap(Number(e.target.value))} className={inputClass + " w-full"} />
            <p className="text-[10px] text-white/50">Max coins per device per day.</p>
          </div>
        </div>

        <button onClick={saveFreePremium} disabled={savingFp} className={btnPrimary + " w-full"}>
          {savingFp ? "Saving..." : "Save Free Premium Ads"}
        </button>
      </div>
    </div>
  );
};

export default AdsterraConfig;
