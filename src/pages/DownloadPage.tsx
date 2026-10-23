import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, ShieldCheck, ShieldAlert, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOWNLOAD_FLOW_KEY, DOWNLOAD_FINAL_KEY, downloadWaitRemaining, sponsorWaitComplete, type DownloadFlowRequest } from "@/lib/downloadFlow";
import { useDownloadManagerConfig, recordDownloadEvent } from "@/lib/downloadManagerSettings";
import { checkDownloadBlocker, type DownloadBlockState } from "@/lib/downloadBlockCheck";
import { filenameRelayUrl, getFilenameRelayBase } from "@/lib/filenameRelay";
import { getAdsterraConfig } from "@/lib/adsterraAds";
import { toast } from "sonner";

function readRequest(): DownloadFlowRequest | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(DOWNLOAD_FLOW_KEY) || "null");
    return value && Array.isArray(value.episodes) ? value : null;
  } catch { return null; }
}
function StepAds({ socialBar, banner }: { socialBar: string; banner: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const send = () => frame.current?.contentWindow?.postMessage({ type: "download-placements", socialBar, banner }, location.origin);
    const ready = (event: MessageEvent) => {
      if (event.origin === location.origin && event.source === frame.current?.contentWindow && event.data?.type === "download-ads-ready") send();
    };
    window.addEventListener("message", ready); send();
    return () => window.removeEventListener("message", ready);
  }, [socialBar, banner]);
  return <iframe ref={frame} title="Download advertisements" src="/download-ads.html" className="h-full min-h-0 w-full border-0" />;
}

export default function DownloadPage() {
  const config = useDownloadManagerConfig();
  const [request] = useState(readRequest);
  const [final] = useState(() => sessionStorage.getItem(DOWNLOAD_FINAL_KEY) === sessionStorage.getItem(DOWNLOAD_FLOW_KEY));
  const [step, setStep] = useState(0);
  const [guard, setGuard] = useState<DownloadBlockState>("checking");
  const [elapsed, setElapsed] = useState(0);
  const [base, setBase] = useState("");
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [smartlink, setSmartlink] = useState("");
  const [sponsorPending, setSponsorPending] = useState(false);
  const busy = useRef(false);
  const sponsor = useRef<{ awayAt: number; left: boolean } | null>(null);
  const sponsorTab = useRef<Window | null>(null);
  const seconds = config.adSteps[step] || 5;
  const finish = () => {
    sessionStorage.setItem(DOWNLOAD_FINAL_KEY, sessionStorage.getItem(DOWNLOAD_FLOW_KEY) || "");
    // A full new document destroys provider hooks, even if a provider touched the parent.
    window.location.replace("/download");
  };
  const advance = () => {
    sponsor.current = null; setSponsorPending(false);
    if (step + 1 < config.adSteps.length) { setStep(n => n + 1); setElapsed(0); }
    else finish();
  };
  const verify = async () => {
    if (busy.current || final) return;
    busy.current = true;
    try { setGuard(await checkDownloadBlocker()); }
    finally { busy.current = false; }
  };
  useEffect(() => {
    void verify();
    const timer = window.setInterval(() => { void verify(); }, 20000);
    getFilenameRelayBase().then(setBase).catch(() => {});
    getAdsterraConfig().then(ads => setSmartlink(ads.directLink || ""));
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!final && request && !config.adSteps.length) finish();
  }, [config.adSteps.length, final, request]);
  useEffect(() => {
    if (final || guard !== "clear" || sponsorPending) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === "visible" && document.hasFocus()) setElapsed(n => n + Math.min(500, now - last));
      last = now;
    }, 200);
    return () => clearInterval(timer);
  }, [final, step, guard, sponsorPending]);
  useEffect(() => {
    if (final) return;
    const leave = () => {
      if (sponsor.current && !sponsor.current.left) { sponsor.current.left = true; sponsor.current.awayAt = performance.now(); }
    };
    const returned = () => {
      const pending = sponsor.current;
      if (!pending?.left) return;
      if (sponsorWaitComplete(seconds, performance.now() - pending.awayAt)) advance();
      else { sponsor.current = null; setSponsorPending(false); setElapsed(0); toast("Stay on the sponsor page until the wait is complete."); }
      void verify();
    };
    const visibility = () => document.visibilityState === "hidden" ? leave() : returned();
    const closedCheck = window.setInterval(() => {
      if (sponsor.current && sponsorTab.current?.closed) returned();
    }, 250);
    window.addEventListener("blur", leave); window.addEventListener("focus", returned); document.addEventListener("visibilitychange", visibility);
    return () => { clearInterval(closedCheck); window.removeEventListener("blur", leave); window.removeEventListener("focus", returned); document.removeEventListener("visibilitychange", visibility); };
  }, [step, seconds, final]);
  useEffect(() => {
    if (!final || !base || !request) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    Promise.all(request.episodes.flatMap(ep => ep.choices).map(async choice => {
      try {
        const response = await fetch(filenameRelayUrl(base, choice.url, choice.fileName), { method: "HEAD", signal: controller.signal });
        const bytes = Number(response.headers.get("content-length"));
        if (response.ok && bytes > 0) setSizes(current => ({ ...current, [choice.url]: bytes }));
      } catch {}
    })).finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [final, base, request]);
  const wait = downloadWaitRemaining(seconds, elapsed);
  const back = () => window.location.assign(request?.returnPath || "/");
  const next = () => {
    if (guard !== "clear" || wait || sponsorPending) return;
    if (!/^https?:\/\//i.test(smartlink)) { advance(); return; }
    sponsor.current = { awayAt: performance.now(), left: true }; setSponsorPending(true);
    const tab = window.open(smartlink, "_blank");
    sponsorTab.current = tab;
    if (!tab) { sponsor.current = null; setSponsorPending(false); toast.error("Allow the sponsor tab, then try again."); return; }
    try { tab.opener = null; } catch {}
  };
  return <main className={`bg-background text-foreground ${final ? "min-h-dvh pb-6" : "download-step-screen"}`}>
    <header className="shrink-0 border-b border-border"><div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-2"><Button variant="ghost" size="icon" aria-label="Back to episode" onClick={back}><ArrowLeft /></Button><span className="text-sm font-bold">RS ANIME03 · Downloads</span><ShieldCheck className="ml-auto text-primary" size={20} /></div></header>
    {!request ? <div className="mx-auto py-16 text-center"><Download className="mx-auto mb-4" /><h1 className="text-xl font-bold">No episodes selected</h1><Button className="mt-6" onClick={back}>Back to anime</Button></div> : <>
      <div className="mx-auto flex w-full max-w-lg shrink-0 items-center gap-3 px-4 py-3">{request.poster && <img src={request.poster} alt="" className="h-12 w-9 rounded object-cover" />}<div className="min-w-0"><h1 className="break-words text-base font-bold">{request.title}</h1><p className="mt-1 text-xs text-muted-foreground">Season {request.season || 1} · Episode {request.episodes.map(ep => ep.number).join(", ")}</p></div></div>
      {!final && <div className="mx-auto flex w-full max-w-lg min-h-0 flex-1 flex-col px-4">
        <div className="flex shrink-0 items-center justify-between border-b border-border pb-2 text-xs text-muted-foreground"><span>DOWNLOAD ACCESS</span><span>Step {step + 1} / {config.adSteps.length}</span></div>
        <div className="flex shrink-0 items-center justify-center gap-3 py-3"><span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary text-xl font-bold tabular-nums">{wait || <Check className="text-primary" />}</span><div><h2 className="text-sm font-semibold">{sponsorPending ? "Sponsor page opened" : wait ? "Preparing your links" : "Ready to continue"}</h2><p className="mt-1 text-xs text-muted-foreground">{sponsorPending ? `Return after ${seconds} seconds` : `Step ${step + 1} · ${seconds} second wait`}</p></div></div>
        <div className="download-ad-slot">{guard === "clear" ? <StepAds key={step} socialBar={config.socialBar} banner={config.banner} /> : <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-center">{guard === "checking" ? <Loader2 className="animate-spin text-primary" /> : <ShieldAlert className="text-destructive" />}<h2 className="text-sm font-semibold">{guard === "checking" ? "Checking ad access…" : guard === "blocked" ? "Ad blocker detected" : "Unable to verify ad access"}</h2><p className="max-w-xs text-xs text-muted-foreground">{guard === "blocked" ? "Turn off ad blocking or filtering DNS, then retry." : "Check your connection and retry."}</p>{guard !== "checking" && <Button variant="outline" onClick={() => void verify()}><RefreshCw />Check again</Button>}</div>}</div>
        <footer className="download-step-footer"><Button className="h-12 w-full" disabled={wait > 0 || guard !== "clear" || sponsorPending} onClick={next}>{sponsorPending ? "Waiting for sponsor return" : wait ? `Continue in ${wait}s` : step + 1 === config.adSteps.length ? "Get download links" : "Continue"}<ArrowRight /></Button><p className="mt-2 text-center text-[11px] text-muted-foreground">Returning early restarts this step.</p></footer>
      </div>}
      {final && <div className="mx-auto w-full max-w-lg px-4"><div className="mb-4 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck size={18} />Your download links</div>{!base && <p role="alert" className="mb-4 text-sm text-destructive">Download service is unavailable. Please try again later.</p>}<div className="space-y-5">{request.episodes.map(ep => <section key={ep.number} className="border-b border-border pb-5"><h2 className="text-sm font-bold">{request.title} · S{String(request.season || 1).padStart(2,"0")} · Episode {ep.number}</h2><p className="mb-3 mt-1 break-words text-xs text-muted-foreground">{ep.title}</p><div className="space-y-2">{ep.choices.map(choice => <Button key={choice.quality} variant="secondary" className="h-auto min-h-16 w-full justify-between gap-3 px-3 py-3 text-left" disabled={!base || !config.websiteEnabled} onClick={() => { const url = filenameRelayUrl(base, choice.url, choice.fileName); if (!url) return; const anchor = document.createElement("a"); anchor.href = url; anchor.download = choice.fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); recordDownloadEvent("website"); }}><span className="min-w-0"><span className="block text-sm font-bold">{choice.quality === "Default" ? "Original file" : choice.quality}</span><span className="mt-1 block whitespace-normal break-words text-[11px] font-normal text-muted-foreground">{choice.fileName}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{sizes[choice.url] ? `${(sizes[choice.url] / 1048576).toFixed(1)} MB` : "Size unavailable"}</span></span><Download className="shrink-0 text-primary" size={20} /></Button>)}{!ep.choices.length && <p className="text-xs text-muted-foreground">No website files available.</p>}</div></section>)}</div>{config.telegramEnabled && request.telegramUrl && <Button className="download-telegram mt-5 h-12 w-full" onClick={() => { window.open(request.telegramUrl, "_blank", "noopener,noreferrer"); recordDownloadEvent("telegram", request.episodes.length); }}><Send size={20} />Telegram Download</Button>}<Button variant="outline" className="mt-4 h-11 w-full" onClick={back}><ArrowLeft />Back to anime</Button></div>}
    </>}
  </main>;
}
