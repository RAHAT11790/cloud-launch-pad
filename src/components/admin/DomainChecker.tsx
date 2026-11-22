import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Globe, RefreshCw, CheckCircle2, ArrowRight, XCircle } from "lucide-react";
import { fetchSiteDomainState, refreshSiteDomain, type SiteDomainState } from "@/lib/siteDomain";

interface Props { glassCard: string; btnPrimary: string; }

const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};

/** Domain Checker: which address the site lives on now, as found by the email server's automatic check. */
export default function DomainChecker({ glassCard, btnPrimary }: Props) {
  const [state, setState] = useState<SiteDomainState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void fetchSiteDomainState(5000).then(setState); }, []);

  const checkNow = async () => {
    setBusy(true);
    try {
      const next = await refreshSiteDomain(true);
      if (next) { setState(next); toast.success(`Live domain: ${new URL(next.live).hostname}`); }
      else toast.error("Domain check failed — the email server did not answer.");
    } finally { setBusy(false); }
  };

  const hosts = state ? Object.values(state.hosts).sort((a, b) => Number(b.serving) - Number(a.serving) || a.host.localeCompare(b.host)) : [];
  const liveHost = state ? new URL(state.live).hostname : "";

  return (
    <div className="space-y-4 min-w-0">
      <div className={`${glassCard} p-5 space-y-3`}>
        <div className="flex items-center gap-2 text-sm font-bold"><Globe size={16} /> Live domain</div>
        <div className="text-xl font-extrabold break-all">{liveHost || "—"}</div>
        <p className="text-xs text-muted-foreground">
          {state ? `Checked ${ago(state.checkedAt)}. ` : "Not checked yet. "}
          Every link (share, Telegram, invite, install) and every server uses this address. Visitors on an old address are moved here with their login.
        </p>
        <button type="button" onClick={checkNow} disabled={busy} className={`${btnPrimary} inline-flex items-center gap-2`}>
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> {busy ? "Checking…" : "Check now"}
        </button>
      </div>
      <div className={`${glassCard} p-5 space-y-2`}>
        <div className="text-sm font-bold">All domains</div>
        {hosts.length === 0 && <div className="text-xs text-muted-foreground">No domains found yet.</div>}
        {hosts.map((h) => (
          <div key={h.host} className="flex items-center gap-2 rounded-xl border border-border/40 px-3 py-2 text-[13px] min-w-0">
            {h.serving ? <CheckCircle2 size={15} className="shrink-0 text-primary" /> : h.redirect ? <ArrowRight size={15} className="shrink-0 text-muted-foreground" /> : <XCircle size={15} className="shrink-0 text-destructive" />}
            <span className="font-semibold break-all">{h.host}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {h.host === liveHost ? "Live" : h.serving ? "Working" : h.redirect ? `→ ${h.redirect}` : "Offline"}
            </span>
          </div>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          Domains come from Firebase → Authentication → Authorized domains. A new domain or subdomain appears here by itself after you add it there and connect it to the site.
        </p>
      </div>
    </div>
  );
}
