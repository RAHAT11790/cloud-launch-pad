import { useState } from "react";
import AdsterraAnalytics from "@/components/admin/AdsterraAnalytics";
import AdsterraConfig from "@/components/admin/AdsterraConfig";
import DownloadAdPlacements from "@/components/admin/DownloadAdPlacements";
import MondiadConfig from "@/components/admin/MondiadConfig";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; }

const NETWORKS = [
  { id: "adsterra", label: "Adsterra" },
  { id: "mondiad", label: "Mondiad" },
] as const;

/** Ads Network: one tab per ad network; each keeps its own Video Player and Download Page codes. */
export default function AdsNetworkPanel({ glassCard, inputClass, btnPrimary }: Props) {
  const [tab, setTab] = useState<(typeof NETWORKS)[number]["id"]>(() => {
    try { return localStorage.getItem("rs_admin_ads_network_tab") === "mondiad" ? "mondiad" : "adsterra"; } catch { return "adsterra"; }
  });
  const pick = (id: typeof tab) => { setTab(id); try { localStorage.setItem("rs_admin_ads_network_tab", id); } catch {} };
  return (
    <div className="space-y-5 min-w-0">
      <div role="tablist" aria-label="Ad networks" className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-black/40 p-1">
        {NETWORKS.map((n) => (
          <button key={n.id} role="tab" type="button" aria-selected={tab === n.id} onClick={() => pick(n.id)}
            className={`h-10 rounded-xl text-[13px] font-bold transition-colors ${tab === n.id ? "bg-white/15 text-white" : "text-white/55"}`}>
            {n.label}
          </button>
        ))}
      </div>
      {tab === "adsterra" ? (
        <>
          <AdsterraAnalytics />
          <AdsterraConfig glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} />
          <DownloadAdPlacements />
        </>
      ) : (
        <MondiadConfig inputClass={inputClass} btnPrimary={btnPrimary} />
      )}
    </div>
  );
}
