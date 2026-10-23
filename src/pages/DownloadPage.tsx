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
  // Final page: the first tap on each button opens one sponsor page, the next tap downloads.
  const [adSeen, setAdSeen] = useState<Set<string>>(() => new Set());
  const tapWithAd = (key: string, action: () => void) => {
    if (!adSeen.has(key) && /^https?:\/\//i.test(smartlink)) {
      const tab = window.open(smartlink, "_blank");
      if (tab) {
        try { tab.opener = null; } catch {}
        setAdSeen(current => new Set(current).add(key));
        toast("Sponsor opened — tap again to start your download.");
        return;
      }
    }
    action();
  };
  const startWebsite = (choice: DownloadFlowRequest["episodes"][number]["choices"][number]) => {
    const url = filenameRelayUrl(base, choice.url, choice.fileName); if (!url) return;
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = choice.fileName;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); recordDownloadEvent("website");
  };
  const startTelegram = () => { if (!request?.telegramUrl) return; window.open(request.telegramUrl, "_blank", "noopener,noreferrer"); recordDownloadEvent("telegram", request.episodes.length); };
  const progress = Math.min(1, elapsed / (seconds * 1000));
  const showTelegram = !!(final && config.telegramEnabled && request?.telegramUrl);
  return <main className={`download-page bg-background text-foreground ${final ? "download-final-screen" : "download-step-screen"}`}>
    <header className="shrink-0 border-b border-border"><div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-2"><Button variant="ghost" size="icon" aria-label="Back to episode" onClick={back}><ArrowLeft /></Button><span className="text-sm font-bold">RS ANIME03 · Downloads</span><ShieldCheck className="ml-auto text-primary" size={20} /></div></header>
    {!request ? <div className="mx-auto py-16 text-center"><Download className="mx-auto mb-4" /><h1 className="text-xl font-bold">No episodes selected</h1><Button className="mt-6" onClick={back}>Back to anime</Button></div> : <>
      <div className="mx-auto flex w-full max-w-lg shrink-0 items-center gap-3 px-4 py-3">{request.poster && <img src={request.poster} alt="" className="h-12 w-9 rounded object-cover" />}<div className="min-w-0"><h1 className="break-words text-base font-bold">{request.title}</h1><p className="mt-1 text-xs text-muted-foreground">Season {request.season || 1} · Episode {request.episodes.map(ep => ep.number).join(", ")}</p></div></div>
      {!final && <div className="mx-auto flex w-full max-w-lg min-h-0 flex-1 flex-col px-4">
        <div className="flex shrink-0 items-center justify-between border-b border-border pb-2 text-xs text-muted-foreground"><span>DOWNLOAD ACCESS</span><span>Step {step + 1} / {config.adSteps.length}</span></div>
        <div className="flex shrink-0 items-center gap-3 py-3">
          <span className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden><circle cx="24" cy="24" r="21" className="download-ring-track" /><circle cx="24" cy="24" r="21" className="download-ring-fill" strokeDasharray={131.95} strokeDashoffset={131.95 * (1 - (sponsorPending ? 1 : progress))} /></svg>
            <span className="text-lg font-bold tabular-nums">{sponsorPending ? seconds : wait || <Check className="text-primary" />}</span>
          </span>
          <div className="min-w-0"><h2 className="text-sm font-semibold">{sponsorPending ? "Sponsor page opened" : wait ? "Preparing your links" : "Ready to continue"}</h2><p className="mt-1 text-xs leading-snug text-muted-foreground">{sponsorPending ? `Stay on the sponsor page for ${seconds} seconds, then come back.` : `Tap Continue, stay on the sponsor page for ${seconds} seconds, then return here.`}</p></div>
        </div>
        <div className="download-ad-slot">{guard === "clear" ? <StepAds key={step} socialBar={config.socialBar} banner={config.banner} /> : <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-center">{guard === "checking" ? <Loader2 className="animate-spin text-primary" /> : <ShieldAlert className="text-destructive" />}<h2 className="text-sm font-semibold">{guard === "checking" ? "Checking ad access…" : guard === "blocked" ? "Ad blocker detected" : "Unable to verify ad access"}</h2><p className="max-w-xs text-xs text-muted-foreground">{guard === "blocked" ? "Turn off ad blocking or filtering DNS, then retry." : "Check your connection and retry."}</p>{guard !== "checking" && <Button variant="outline" onClick={() => void verify()}><RefreshCw />Check again</Button>}</div>}</div>
        <footer className="download-step-footer"><Button className="h-12 w-full" disabled={wait > 0 || guard !== "clear" || sponsorPending} onClick={next}>{sponsorPending ? "Waiting for sponsor return" : wait ? `Continue in ${wait}s` : step + 1 === config.adSteps.length ? "Get download links" : "Continue"}<ArrowRight /></Button><p className="mt-2 text-center text-[11px] text-muted-foreground">Coming back before {seconds} seconds restarts this step's timer.</p></footer>
      </div>}
      {final && <>
        <div className="mx-auto w-full max-w-lg min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck size={18} />Your download links</div>
          {!base && <p role="alert" className="mb-4 text-sm text-destructive">Download service is unavailable. Please try again later.</p>}
          <div className="space-y-4">{request.episodes.map(ep => <section key={ep.number} className="download-card rounded-xl border border-border p-3">
            <div className="mb-2.5 flex items-center gap-2.5">{request.poster && <img src={request.poster} alt="" className="h-9 w-7 rounded object-cover" />}<span className="text-sm font-bold">Episode {String(ep.number).padStart(2, "0")}</span><span className="ml-auto text-[11px] text-muted-foreground">{ep.choices.length} {ep.choices.length === 1 ? "quality" : "qualities"}</span></div>
            <div className="space-y-2">{ep.choices.map(choice => { const key = `w:${ep.number}:${choice.quality}`; const ext = (choice.fileName.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "file").toUpperCase(); return <button key={choice.quality} type="button" className="download-go flex min-h-14 w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-left disabled:opacity-50" disabled={!base || !config.websiteEnabled} onClick={() => tapWithAd(key, () => startWebsite(choice))}><Download size={20} className="shrink-0" /><span className="min-w-0 flex-1"><span className="block text-sm font-bold">{qualityLabel(choice.quality)}</span><span className="block text-xs opacity-90">{sizes[choice.url] ? `${(sizes[choice.url] / 1048576).toFixed(1)} MB` : "Size unavailable"} • {ext}</span></span><span className="shrink-0 text-[11px] font-semibold">{adSeen.has(key) ? "Download now" : "Download"}</span></button>; })}{!ep.choices.length && <p className="text-xs text-muted-foreground">No website files available.</p>}</div>
          </section>)}</div>
        </div>
        <footer className="download-final-footer"><div className="mx-auto w-full max-w-lg px-4">{showTelegram ? <button type="button" className="download-telegram flex h-12 w-full items-center justify-center gap-2.5 rounded-lg text-sm font-bold" onClick={() => tapWithAd("telegram", startTelegram)}><TelegramLogo />{adSeen.has("telegram") ? "Open Telegram now" : "Telegram Download"}</button> : <Button variant="outline" className="h-11 w-full" onClick={back}><ArrowLeft />Back to anime</Button>}</div></footer>
      </>}
    </>}
  </main>;
}

function qualityLabel(quality: string) {
  const n = quality.match(/\d+/)?.[0];
  if (n === "480") return "480P SD";
  if (n === "720") return "720P HD";
  if (n === "1080") return "1080P FHD";
  return quality === "Default" ? "Original file" : quality;
}

/** Official Telegram mark (brand colours are part of the logo). */
function TelegramLogo() {
  return <svg viewBox="0 0 240 240" width="26" height="26" aria-hidden className="shrink-0"><defs><linearGradient id="tg-logo" x1=".667" x2=".417" y1=".167" y2=".75"><stop offset="0" stopColor="#37aee2" /><stop offset="1" stopColor="#1e96c8" /></linearGradient></defs><circle cx="120" cy="120" r="120" fill="url(#tg-logo)" /><path fill="#c8daea" d="M98 175c-3.888 0-3.227-1.468-4.568-5.17L82 132.207 170 80" /><path fill="#a9c9dd" d="M98 175c3 0 4.325-1.372 6-3l16-15.558-19.958-12.035" /><path fill="#fff" d="M100.04 144.41l48.36 35.729c5.519 3.045 9.501 1.468 10.876-5.123l19.685-92.763c2.015-8.08-3.08-11.746-8.36-9.349l-115.59 44.571c-7.89 3.165-7.843 7.567-1.438 9.528l29.663 9.259 68.673-43.325c3.242-1.966 6.218-.91 3.776 1.258" /></svg>;
}

