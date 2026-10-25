import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Chrome, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { browserBrands, browserGateApplies, chromeLaunchUrl, detectBrowser } from "@/lib/browserEligibility";

/** Decided synchronously from the browser's brand list, so there is no waiting screen. */
export default function ChromeBrowserGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const browser = useMemo(() => detectBrowser(navigator.userAgent, { brands: browserBrands(navigator) }), []);
  const blocked = !browser.supported && browserGateApplies(pathname);
  const [ip, setIp] = useState("Checking…");
  useEffect(() => {
    if (!blocked) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch("https://api.ipify.org?format=json", { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject()).then(data => setIp(typeof data.ip === "string" ? data.ip : "Unavailable")).catch(() => setIp("Unavailable")).finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [blocked]);
  if (!blocked) return <>{children}</>;
  return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-8 text-foreground">
    <section className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><ShieldAlert size={28} /></div>
      <h1 className="text-2xl font-bold">Unsupported browser</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">This site runs only in Google Chrome.</p>
      <dl className="my-6 space-y-3 border-y border-border py-4 text-sm">{[["Browser", browser.name], ["Version", browser.version], ["Network IP", ip]].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-3"><dt className="text-xs uppercase text-muted-foreground">{label}</dt><dd className="break-all text-right font-medium">{value}</dd></div>)}</dl>
      <div className="space-y-3"><Button className="h-12 w-full" onClick={() => window.location.assign(chromeLaunchUrl(location.href, navigator.userAgent))}><Chrome size={20} />Open in Google Chrome</Button><Button variant="outline" className="h-11 w-full" onClick={() => { window.close(); window.location.replace("about:blank"); }}><X size={18} />Close site</Button></div>
      <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">No content is loaded in this browser.</p>
    </section>
  </main>;
}
