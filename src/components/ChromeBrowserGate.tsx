import { useEffect, useState, type ReactNode } from "react";
import { Chrome, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chromeLaunchUrl, detectBrowser } from "@/lib/browserEligibility";

export default function ChromeBrowserGate({ children }: { children: ReactNode }) {
  const [browser, setBrowser] = useState(() => detectBrowser(navigator.userAgent));
  const [checking, setChecking] = useState(() => !!(navigator as Navigator & { brave?: unknown }).brave);
  const [ip, setIp] = useState("Checking…");
  useEffect(() => {
    const brave = (navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } }).brave;
    if (brave?.isBrave) brave.isBrave().then(value => setBrowser(detectBrowser(navigator.userAgent, value))).catch(() => setBrowser(detectBrowser(navigator.userAgent, true))).finally(() => setChecking(false));
    else setChecking(false);
  }, []);
  useEffect(() => {
    if (browser.supported || checking) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch("https://api.ipify.org?format=json", { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject()).then(data => setIp(typeof data.ip === "string" ? data.ip : "Unavailable")).catch(() => { if (!controller.signal.aborted) setIp("Unavailable"); else setIp("Unavailable"); }).finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [browser.supported, checking]);
  if (checking) return <div className="fixed inset-0 flex items-center justify-center bg-background"><ShieldAlert className="text-primary" /></div>;
  if (browser.supported) return <>{children}</>;
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