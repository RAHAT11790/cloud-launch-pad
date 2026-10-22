import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, ShieldCheck, ShieldAlert, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOWNLOAD_FLOW_KEY, downloadWaitRemaining, selectDownloadEpisode, type DownloadFlowRequest } from "@/lib/downloadFlow";
import { useDownloadManagerConfig, recordDownloadEvent } from "@/lib/downloadManagerSettings";
import { checkDownloadBlocker, type DownloadBlockState } from "@/lib/downloadBlockCheck";
import { filenameRelayUrl, getFilenameRelayBase } from "@/lib/filenameRelay";
import { getAdsterraConfig } from "@/lib/adsterraAds";
import { toast } from "sonner";

function readRequest(): DownloadFlowRequest | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(DOWNLOAD_FLOW_KEY) || "null");
    if (!value || !Array.isArray(value.episodes)) return null;
    return value;
  } catch { return null; }
}
// Ad scripts run in their own document. Leaving a step destroys every listener,
// popup hook and injected social bar before the ad-free final document loads.
function StepAds({ socialBar, banner }: { socialBar: string; banner: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let active = true;
    getAdsterraConfig().then((ads) => {
      const scripts = [ads.popunder, ads.streamLink, ads.pushNotification, socialBar].filter((s) => s.includes("<script"));
      if (active) setHtml(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;display:flex;justify-content:center;min-height:300px}iframe{max-width:100%}</style></head><body>${banner}${scripts.join("")}</body></html>`);
    });
    return () => { active = false; };
  }, [socialBar, banner]);
  return <div className="my-5 flex min-h-[300px] justify-center border-y border-border py-4">
    {html ? <iframe title="Download advertisements" srcDoc={html} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" className="h-[320px] w-full border-0" /> : <Loader2 className="animate-spin text-muted-foreground" />}
  </div>;
}

export default function DownloadPage() {
  const config = useDownloadManagerConfig();
  const [request] = useState(readRequest);
  const [selected, setSelected] = useState<number[]>([]);
  const [stage, setStage] = useState<"select" | "steps" | "final">("select");
  const [step, setStep] = useState(0);
  const [guard, setGuard] = useState<DownloadBlockState>("checking");
  const [elapsed, setElapsed] = useState(0);
  const [base, setBase] = useState("");
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [smartlink, setSmartlink] = useState("");
  const busy = useRef(false);
  const verify = async () => {
    if (busy.current) return;
    busy.current = true;
    setGuard("checking");
    const result = await checkDownloadBlocker();
    setGuard(result);
    busy.current = false;
  };
  useEffect(() => {
    void verify();
    const timer = window.setInterval(() => { void verify(); }, 20000);
    const focus = () => { void verify(); };
    window.addEventListener("focus", focus);
    getFilenameRelayBase().then(setBase).catch(() => {});
    getAdsterraConfig().then((ads) => setSmartlink(ads.directLink || ""));
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, []);
  useEffect(() => {
    if (stage !== "steps" || guard !== "clear") return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === "visible") setElapsed((n) => n + Math.min(500, now - last));
      last = now;
    }, 200);
    return () => clearInterval(timer);
  }, [stage, step, guard]);
  useEffect(() => {
    if (stage !== "final" || !base || !request) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    const choices = request.episodes.filter((ep) => selected.includes(ep.number)).flatMap((ep) => ep.choices);
    Promise.all(choices.map(async (choice) => {
      const url = filenameRelayUrl(base, choice.url, choice.fileName);
      try {
        const res = await fetch(url, { method: "HEAD", signal: controller.signal });
        const bytes = Number(res.headers.get("content-length"));
        if (res.ok && bytes > 0) setSizes((current) => ({ ...current, [choice.url]: bytes }));
      } catch {}
    })).finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [stage, base, request, selected]);
  const wait = downloadWaitRemaining(config.adSteps[step] || 5, elapsed);
  const picked = request?.episodes.filter((ep) => selected.includes(ep.number)).slice(0, config.maxEpisodes) || [];
  const back = () => window.location.assign(request?.returnPath || "/");
  const next = () => {
    if (guard !== "clear" || wait > 0) return;
    if (/^https?:\/\//i.test(smartlink)) window.open(smartlink, "_blank", "noopener,noreferrer");
    if (step + 1 < config.adSteps.length) { setStep(step + 1); setElapsed(0); void verify(); window.scrollTo(0, 0); }
    else setStage("final");
  };
  return <main className="min-h-dvh bg-background text-foreground pb-8">
    <header className="border-b border-border"><div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-4"><Button variant="ghost" size="icon" aria-label="Back to episode" onClick={back}><ArrowLeft /></Button><span className="font-bold text-base">RS ANIME03 <span className="block text-xs font-medium text-muted-foreground">Downloads</span></span><ShieldCheck className="ml-auto text-primary" size={22} /></div></header>
    <div className="mx-auto max-w-lg px-5 pt-6">
      {!request ? <div className="py-16 text-center"><Download className="mx-auto mb-4 text-muted-foreground" /><h1 className="text-xl font-bold">No episodes selected</h1><Button className="mt-6" onClick={back}>Back to anime</Button></div> : <>
        <div className="mb-6 flex items-center gap-3">{request.poster && <img src={request.poster} alt="" className="h-16 w-12 rounded-md object-cover" />}<div className="min-w-0"><p className="text-xs text-muted-foreground">{stage === "final" ? "Your files are ready" : "Website download"}</p><h1 className="mt-1 text-xl font-bold break-words">{request.title}</h1></div></div>
        {guard !== "clear" && <div role="alert" className="mb-5 rounded-lg border border-border bg-secondary p-4"><div className="flex gap-3">{guard === "checking" ? <Loader2 className="shrink-0 animate-spin text-primary" /> : <ShieldAlert className="shrink-0 text-destructive" />}<div><h2 className="text-sm font-semibold">{guard === "checking" ? "Checking ad access…" : guard === "blocked" ? "Ad blocker detected" : "Unable to verify ad access"}</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{guard === "blocked" ? "Turn off your ad blocker or filtering DNS, then try again. Downloads require ad access." : guard === "unavailable" ? "Check your connection and ad-blocking DNS settings, then retry." : "Please wait."}</p></div></div>{guard !== "checking" && <Button variant="outline" className="mt-4 w-full" onClick={() => void verify()}><RefreshCw />Check again</Button>}</div>}
        {stage === "select" && <><div className="flex justify-between items-center mb-3"><h2 className="font-semibold">Select episodes</h2><span className="text-xs tabular-nums text-muted-foreground">{selected.length} / {config.maxEpisodes}</span></div><div className="space-y-2">{request.episodes.map((ep) => <Button key={ep.number} variant="outline" aria-pressed={selected.includes(ep.number)} disabled={!ep.choices.length || (!selected.includes(ep.number) && selected.length >= config.maxEpisodes)} className={`w-full min-h-16 h-auto justify-start whitespace-normal text-left px-3 py-3 ${selected.includes(ep.number) ? "border-primary bg-primary/10" : ""}`} onClick={() => setSelected(selectDownloadEpisode(selected, ep.number, config.maxEpisodes))}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">{selected.includes(ep.number) ? <Check /> : ep.number}</span><span className="min-w-0 flex-1"><span className="block font-semibold">Episode {ep.number}</span><span className="block text-xs text-muted-foreground break-words mt-1">{ep.title}</span></span></Button>)}</div><Button className="w-full mt-5 h-12" disabled={!selected.length || guard !== "clear" || !config.websiteEnabled} onClick={() => { setStage(config.adSteps.length ? "steps" : "final"); setElapsed(0); window.scrollTo(0, 0); }}>Continue with {selected.length || "selected"} episode{selected.length === 1 ? "" : "s"}<ArrowRight /></Button></>}
        {stage === "steps" && <>
          <div className="flex justify-between text-xs text-muted-foreground"><span>DOWNLOAD ACCESS</span><span>Step {step + 1} of {config.adSteps.length}</span></div>
          <div className="mt-3 flex gap-2">{config.adSteps.map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-secondary"}`} />)}</div>
          <div className="py-7 text-center"><span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-4 border-primary/25 text-3xl font-bold tabular-nums">{wait || <Check className="text-primary" size={32} />}</span><h2 className="mt-5 text-xl font-bold">{wait ? "Preparing your downloads" : "Ready to continue"}</h2><p className="mt-2 text-sm text-muted-foreground">{picked.length} episode{picked.length === 1 ? "" : "s"} · Step {step + 1}</p></div>
          {guard === "clear" && <StepAds key={step} socialBar={config.socialBar} banner={config.banner} />}
          <Button className="w-full h-12" disabled={wait > 0 || guard !== "clear"} onClick={next}>{wait ? `Please wait ${wait}s` : step + 1 === config.adSteps.length ? "Get download links" : "Next step"}<ArrowRight /></Button>
        </>}
        {stage === "final" && <><div className="mb-5 flex items-center gap-2 text-primary text-sm font-semibold"><ShieldCheck size={18} />Download links · Ad-free</div>{!base && <p role="alert" className="text-sm text-destructive mb-4">Download service is not configured. Please try again later.</p>}<div className="space-y-7">{picked.map((ep) => <section key={ep.number} className="border-b border-border pb-6"><h2 className="text-base font-bold">Episode {ep.number}</h2><p className="text-xs text-muted-foreground mt-1 mb-3 break-words">{ep.title}</p><div className="space-y-2">{ep.choices.map((choice) => <Button key={choice.quality} variant="secondary" className="w-full h-16 justify-between text-left px-4" disabled={guard !== "clear" || !base || choice.locked || !config.websiteEnabled} onClick={() => { const url = filenameRelayUrl(base, choice.url, choice.fileName); if (!url) return; const a = document.createElement("a"); a.href = url; a.download = choice.fileName; document.body.appendChild(a); a.click(); a.remove(); recordDownloadEvent("website"); toast.success("Download sent to browser"); }}><span><span className="block text-base font-bold">{choice.quality}</span><span className="block text-xs font-normal text-muted-foreground mt-1">{choice.locked ? "Premium required" : sizes[choice.url] ? `${(sizes[choice.url] / 1048576).toFixed(1)} MB` : "Size unavailable"} · {choice.fileName.split(".").pop()?.toUpperCase()}</span></span><Download className="text-primary" /></Button>)}</div></section>)}</div><Button variant="outline" className="w-full mt-6 h-12" onClick={back}><ArrowLeft />Back to anime</Button></>}
      </>}
    </div>
  </main>;
}