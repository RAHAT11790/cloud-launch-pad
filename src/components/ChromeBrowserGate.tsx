import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Check, Chrome, Copy, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { browserBrands, browserGateApplies, chromeLaunchUrl, detectBrowser } from "@/lib/browserEligibility";
import { browserGateBlocks, getGateDeviceId, cachedNetworkIp, fetchNetworkIp, useBrowserGateConfig } from "@/lib/browserAccess";

/** Decided synchronously from the browser's brand list, so there is no waiting screen. */
export default function ChromeBrowserGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const browser = useMemo(() => detectBrowser(navigator.userAgent, { brands: browserBrands(navigator) }), []);
  const cfg = useBrowserGateConfig();
  const [ip, setIp] = useState<string | null>(cachedNetworkIp);
  const [ipDone, setIpDone] = useState(false);
  const deviceId = useMemo(() => getGateDeviceId(), []);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, value: string) => {
    try { await navigator.clipboard.writeText(value); }
    catch {
      const t = document.createElement("textarea"); t.value = value; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch { /* ignore */ } t.remove();
    }
    setCopied(label); setTimeout(() => setCopied(c => (c === label ? null : c)), 1600);
  };
  const needsCheck = !browser.supported && cfg.enabled && browserGateApplies(pathname);
  useEffect(() => {
    if (!needsCheck) return;
    let live = true;
    fetchNetworkIp().then(v => { if (!live) return; if (v) setIp(v); setIpDone(true); });
    return () => { live = false; };
  }, [needsCheck]);
  const blocked = needsCheck && browserGateBlocks(browser.supported, cfg, ip, deviceId);
  if (!blocked) return <>{children}</>;
  return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-8 text-foreground">
    <section className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><ShieldAlert size={28} /></div>
      <h1 className="text-2xl font-bold">Unsupported browser</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">This site runs only in Google Chrome.</p>
      <dl className="my-6 space-y-3 border-y border-border py-4 text-sm">{[["Browser", browser.name], ["Version", browser.version]].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-3"><dt className="text-xs uppercase text-muted-foreground">{label}</dt><dd className="break-all text-right font-medium">{value}</dd></div>)}</dl>
      <div className="-mt-2 mb-6 space-y-2">{([["Network IP", ip], ["Device ID", deviceId]] as const).map(([label, value]) => <button key={label} type="button" disabled={!value} onClick={() => value && copy(label, value)} aria-label={`Copy ${label}`} className="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left active:scale-[0.99] disabled:opacity-60">
        <span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span><span className="block break-all font-mono text-sm font-semibold">{value || (ipDone ? "Unavailable" : "Checking…")}</span></span>
        <span className={`flex shrink-0 items-center gap-1 text-xs font-semibold ${copied === label ? "text-primary" : "text-muted-foreground"}`}>{copied === label ? <><Check size={15} />Copied</> : <><Copy size={15} />Copy</>}</span>
      </button>)}<p className="text-center text-[11px] text-muted-foreground">Tap to copy and send it to the admin. Your Device ID does not change when your IP or Wi-Fi changes.</p></div>
      <div className="space-y-3"><Button className="h-12 w-full" onClick={() => window.location.assign(chromeLaunchUrl(location.href, navigator.userAgent))}><Chrome size={20} />Open in Google Chrome</Button><Button variant="outline" className="h-11 w-full" onClick={() => { window.close(); window.location.replace("about:blank"); }}><X size={18} />Close site</Button></div>
      <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">No content is loaded in this browser.</p>
    </section>
  </main>;
}
