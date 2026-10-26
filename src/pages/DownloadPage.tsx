import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, ShieldCheck, ShieldAlert, Loader2, RefreshCw, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOWNLOAD_FLOW_KEY, DOWNLOAD_FINAL_KEY, downloadWaitRemaining, nextDownloadStep, downloadStepsFor, readDownloadTimer, saveDownloadTimer, resumeDownloadTimer, sponsorVisitOutcome, BACK_TO_WATCH_KEY, type DownloadFlowRequest } from "@/lib/downloadFlow";
import BackToWatchLoader from "@/components/BackToWatchLoader";
import { useDownloadManagerConfig, useDownloadConfigReady, recordDownloadEvent } from "@/lib/downloadManagerSettings";
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
  const configReady = useDownloadConfigReady();
  const [steps, setSteps] = useState<number[] | null>(null);
  // Continue-button (sponsor) timer is its own admin setting, snapshotted with the steps.
  const [sponsorSeconds, setSponsorSeconds] = useState(10);
  const [request] = useState(readRequest);
  const [final] = useState(() => sessionStorage.getItem(DOWNLOAD_FINAL_KEY) === sessionStorage.getItem(DOWNLOAD_FLOW_KEY));
  const flowId = useRef(sessionStorage.getItem(DOWNLOAD_FLOW_KEY) || "").current;
  // The running step, its countdown and an open sponsor visit survive leaving, reloading and returning.
  const [savedTimer] = useState(() => { const t = readDownloadTimer(); return t && t.flow === flowId ? t : null; });
  const [step, setStep] = useState(savedTimer?.step ?? 0);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    // Returning from the browser's page cache must show this page again, not the leave screen.
    const shown = (event: PageTransitionEvent) => { if (event.persisted) setLeaving(false); };
    window.addEventListener("pageshow", shown);
    return () => window.removeEventListener("pageshow", shown);
  }, []);
  const [guard, setGuard] = useState<DownloadBlockState>("checking");
  const [startedAt, setStartedAt] = useState(() => savedTimer?.startedAt ?? Date.now());
  const [now, setNow] = useState(Date.now);
  const [waitAttempt, setWaitAttempt] = useState(0);
  const [base, setBase] = useState("");
  const [relayState, setRelayState] = useState<"checking" | "ready" | "unavailable">("checking");
  const [fileState, setFileState] = useState<Record<string, "ready" | "unavailable">>({});
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [smartlink, setSmartlink] = useState("");
  const restoredVisit = !savedTimer?.ready && Number(savedTimer?.sponsorAt) > 0 ? Number(savedTimer!.sponsorAt) : null;
  // Wall-clock time Continue opened the sponsor page (null = no visit running).
  const [sponsorAt, setSponsorAtState] = useState<number | null>(restoredVisit);
  const sponsorRef = useRef<number | null>(restoredVisit);
  const visitSeconds = useRef(Number(savedTimer?.sponsorSeconds) || 0);
  const restoredPending = useRef(restoredVisit !== null);
  const leftAt = useRef(0);
  const sponsorPending = sponsorAt !== null;
  const setVisit = (at: number | null) => { sponsorRef.current = at; setSponsorAtState(at); };
  const [ready, setReady] = useState(!!savedTimer?.ready);
  const busy = useRef(false);
  const advancing = useRef(false);
  const seconds = steps?.[step] ?? 5;
  useEffect(() => { if (configReady && steps === null) { setSponsorSeconds(config.sponsorSeconds); setSteps([...downloadStepsFor(config, request?.episodes.length || 1)]); } }, [configReady, config, request, steps]);
  // Instruction popup after each countdown; only the user's cross closes it.
  const [hintClosed, setHintClosed] = useState("");
  const finish = () => {
    sessionStorage.setItem(DOWNLOAD_FINAL_KEY, sessionStorage.getItem(DOWNLOAD_FLOW_KEY) || "");
    // A full new document destroys provider hooks, even if a provider touched the parent.
    window.location.replace("/download");
  };
  const advance = () => {
    if (advancing.current || steps === null) return;
    advancing.current = true;
    setVisit(null);
    const next = nextDownloadStep(step, steps.length);
    // Last step done: show the "links ready" screen; the user taps Get Link to continue.
    if (next === "final") { setReady(true); saveDownloadTimer({ flow: flowId, step, startedAt: Date.now(), ready: true }); }
    else { const t = Date.now(); saveDownloadTimer({ flow: flowId, step: next, startedAt: t }); setStartedAt(t); setStep(next); }
  };
  useEffect(() => { advancing.current = false; }, [step]);
  const resolveRelay = async () => {
    setRelayState("checking");
    try {
      const endpoint = await getFilenameRelayBase();
      setBase(endpoint); setFileState({});
      setRelayState(endpoint ? "ready" : "unavailable");
    } catch { setRelayState("unavailable"); }
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
    void resolveRelay();
    getAdsterraConfig().then(ads => setSmartlink(ads.directLink || ""));
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!final && request && steps?.length === 0) setReady(true);
  }, [steps, final, request]);
  useEffect(() => {
    if (steps !== null && steps.length > 0 && step >= steps.length) setStep(steps.length - 1);
  }, [steps, step]);
  // Preparation countdown for the current step: resumes its saved wall-clock start.
  useEffect(() => {
    if (final || ready || guard !== "clear" || steps === null) return;
    const saved = readDownloadTimer();
    const timerState = resumeDownloadTimer(saved, flowId, step, Date.now());
    if (timerState !== saved) saveDownloadTimer(timerState);
    setStartedAt(timerState.startedAt);
  }, [final, ready, guard, steps, step, waitAttempt]);
  useEffect(() => {
    if (final || ready) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [final, ready]);
  /** Judge the sponsor visit once: enough wall-clock time since Continue → next step, otherwise retry this step. */
  const evaluateVisit = () => {
    const at = sponsorRef.current;
    if (at === null || advancing.current) return;
    const needed = visitSeconds.current || sponsorSeconds;
    setVisit(null); leftAt.current = 0;
    const t = Date.now();
    if (sponsorVisitOutcome(at, needed, t) === "advance") { advance(); return; }
    saveDownloadTimer({ flow: flowId, step, startedAt: t });
    setStartedAt(t); setWaitAttempt(n => n + 1);
    toast.error(`You came back after ${Math.floor((t - at) / 1000)}s. Stay ${needed} seconds on the sponsor page.`);
  };
  const evaluateRef = useRef(evaluateVisit);
  evaluateRef.current = evaluateVisit;
  // Page was reloaded or discarded while the sponsor was open: finish the visit as a return.
  useEffect(() => {
    console.debug('[dl-restore]', steps, restoredPending.current, sponsorRef.current, savedTimer);
    if (steps !== null && restoredPending.current) { restoredPending.current = false; evaluateRef.current(); }
  }, [steps]);
  useEffect(() => {
    if (final) return;
    const away = () => {
      // Tapping an ad frame on this page also blurs the window; that is not leaving.
      if (sponsorRef.current !== null && document.activeElement?.tagName !== "IFRAME") leftAt.current ||= Date.now();
    };
    const back = () => {
      const at = sponsorRef.current;
      if (at === null || document.visibilityState !== "visible") return;
      // Focus noise right after window.open is not a return.
      if (!leftAt.current || Date.now() - at < 1500) return;
      evaluateRef.current();
    };
    const visibility = () => { if (document.visibilityState === "hidden") { if (sponsorRef.current !== null) leftAt.current ||= Date.now(); } else back(); };
    const shown = () => back();
    window.addEventListener("blur", away); window.addEventListener("focus", back); window.addEventListener("pageshow", shown); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("blur", away); window.removeEventListener("focus", back); window.removeEventListener("pageshow", shown); document.removeEventListener("visibilitychange", visibility); };
  }, [final]);
  // The sponsor never took focus (user stayed here): finish once its time has passed.
  useEffect(() => {
    const at = sponsorRef.current;
    if (at === null || document.visibilityState !== "visible" || !document.hasFocus()) return;
    if (now - at >= (visitSeconds.current || sponsorSeconds) * 1000) evaluateRef.current();
  }, [now, sponsorSeconds]);
  useEffect(() => {
    if (!final || !base || !request) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    Promise.all(request.episodes.flatMap(ep => ep.choices).map(async choice => {
      try {
        const response = await fetch(filenameRelayUrl(base, choice.url, choice.fileName), { method: "HEAD", signal: controller.signal });
        const bytes = Number(response.headers.get("content-length"));
        if (response.ok && bytes > 0) setSizes(current => ({ ...current, [choice.url]: bytes }));
        if (!controller.signal.aborted) setFileState(current => ({ ...current, [choice.url]: response.ok ? "ready" : "unavailable" }));
      } catch { if (!controller.signal.aborted) setFileState(current => ({ ...current, [choice.url]: "unavailable" })); }
    })).finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [final, base, request]);
  const visitSecs = visitSeconds.current || sponsorSeconds;
  const timerSeconds = sponsorPending ? visitSecs : seconds;
  const elapsed = sponsorPending ? Math.max(0, now - (sponsorAt as number)) : guard === "clear" ? Math.max(0, now - startedAt) : 0;
  const wait = downloadWaitRemaining(timerSeconds, elapsed);
  const back = () => {
    // The watch page is the previous document: going back restores it (often instantly) instead of rebuilding the app.
    let sameOrigin = false;
    try { sameOrigin = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch {}
    setLeaving(true);
    try { sessionStorage.setItem(BACK_TO_WATCH_KEY, String(Date.now())); } catch {}
    if (sameOrigin && history.length > 1) history.back();
    else window.location.assign(request?.returnPath || "/");
  };
  const next = () => {
    if (guard !== "clear" || steps === null || wait > 0 || sponsorPending || advancing.current) return;
    if (!/^https?:\/\//i.test(smartlink)) { advance(); return; }
    const at = Date.now();
    const tab = window.open(smartlink, "_blank");
    if (!tab) { advance(); return; }
    try { tab.opener = null; } catch {}
    visitSeconds.current = sponsorSeconds; leftAt.current = 0;
    setVisit(at); setNow(at);
    saveDownloadTimer({ flow: flowId, step, startedAt, sponsorAt: at, sponsorSeconds });
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
  const startTelegram = (url = request?.telegramUrl, count = request?.telegramEpisodeCount || request?.episodes.length || 1) => { if (!url) return; window.open(url, "_blank", "noopener,noreferrer"); recordDownloadEvent("telegram", count); };
  const progress = Math.min(1, elapsed / (timerSeconds * 1000));
  const showTelegram = !!(final && config.telegramEnabled && request?.telegramUrl);
  if (leaving) return <BackToWatchLoader />;
  return <main className={`download-page bg-background text-foreground ${final ? "download-final-screen" : "download-step-screen"}`}>
    <header className="shrink-0 border-b border-border"><div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-2"><Button variant="ghost" size="icon" aria-label="Back to episode" onClick={back}><ArrowLeft /></Button><span className="text-sm font-bold">RS ANIME03 · Downloads</span><ShieldCheck className="ml-auto text-primary" size={20} /></div></header>
    {!request ? <div className="mx-auto py-16 text-center"><Download className="mx-auto mb-4" /><h1 className="text-xl font-bold">No episodes selected</h1><Button className="mt-6" onClick={back}>Back to anime</Button></div> : <>
      <div className="mx-auto flex w-full max-w-lg shrink-0 items-center gap-3 px-4 py-3">{request.poster && <img src={request.poster} alt="" className="h-12 w-9 rounded object-cover" />}<div className="min-w-0"><h1 className="break-words text-base font-bold">{request.title}</h1><p className="mt-1 text-xs text-muted-foreground">Season {request.season || 1} · Episode {request.episodes.map(ep => ep.number).join(", ")}</p></div></div>
      {!final && ready && <div className="mx-auto flex w-full max-w-lg min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/15"><ShieldCheck className="text-primary" size={44} /></span>
        <h2 className="text-xl font-bold">Your links are ready!</h2>
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">Your website download and Telegram download links are ready. Tap the button below to get them.</p>
        <Button className="h-12 w-full max-w-xs text-base font-bold" onClick={finish}>Get Link<ArrowRight /></Button>
      </div>}
      {!final && !ready && <div className="mx-auto flex w-full max-w-lg min-h-0 flex-1 flex-col px-4">
        <div className="flex shrink-0 items-center justify-between border-b border-border pb-2 text-xs text-muted-foreground"><span>DOWNLOAD ACCESS</span><span>{steps === null ? "Loading steps…" : `Step ${step + 1} / ${steps.length}`}</span></div>
        <div className="flex shrink-0 items-center gap-3 py-3">
          <span className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden><circle cx="24" cy="24" r="21" className="download-ring-track" /><circle cx="24" cy="24" r="21" className="download-ring-fill" strokeDasharray={131.95} strokeDashoffset={131.95 * (1 - progress)} /></svg>
            <span role="timer" aria-label="Seconds remaining" className="text-lg font-bold tabular-nums">{steps === null ? "…" : wait > 0 ? wait : <Check className="text-primary" />}</span>
          </span>
          <div className="min-w-0"><h2 className="text-sm font-semibold">{sponsorPending ? "Sponsor page opened" : wait ? "Preparing your links" : "Ready to continue"}</h2><p className="mt-1 text-xs leading-snug text-muted-foreground">{sponsorPending ? `Stay on the sponsor page for ${visitSecs} seconds, then come back. This step finishes by itself.` : `Tap Continue, stay on the sponsor page for ${sponsorSeconds} seconds, then return here.`}</p></div>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col"><div className="download-ad-slot">{guard === "clear" ? <StepAds key={step} socialBar={config.socialBar} banner={config.banner} /> : <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-center">{guard === "checking" ? <Loader2 className="animate-spin text-primary" /> : <ShieldAlert className="text-destructive" />}<h2 className="text-sm font-semibold">{guard === "checking" ? "Checking ad access…" : guard === "blocked" ? "Ad blocker detected" : "Unable to verify ad access"}</h2><p className="max-w-xs text-xs text-muted-foreground">{guard === "blocked" ? "Turn off ad blocking or filtering DNS, then retry." : "Check your connection and retry."}</p>{guard !== "checking" && <Button variant="outline" onClick={() => void verify()}><RefreshCw />Check again</Button>}</div>}</div>
          {guard === "clear" && steps !== null && wait === 0 && !sponsorPending && hintClosed !== `${step}:${waitAttempt}` && <div role="dialog" aria-label="How to continue" className="download-hint absolute inset-x-0 bottom-2 z-10 mx-auto w-full max-w-sm rounded-xl border border-primary/40 bg-secondary p-4 pr-10 text-foreground shadow-lg">
            <button type="button" aria-label="Close message" className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground" onClick={() => setHintClosed(`${step}:${waitAttempt}`)}><X size={18} /></button>
            <p className="flex items-center gap-2 text-sm font-bold"><Info size={18} className="shrink-0 text-primary" />Your step is ready</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Tap <b className="text-foreground">Continue</b>, stay on the sponsor page for <b className="text-foreground">{sponsorSeconds} seconds</b>, then come back here. The next step opens by itself.</p>
          </div>}
        </div>
        <footer className="download-step-footer"><Button className="h-12 w-full" disabled={steps === null || guard !== "clear" || sponsorPending || wait > 0} onClick={next}>{sponsorPending ? (wait > 0 ? `Come back in ${wait}s` : "Come back now") : "Continue"}<ArrowRight /></Button><p className="mt-2 text-center text-[11px] text-muted-foreground">Coming back before {sponsorSeconds} seconds restarts this step. If no sponsor opens, you can continue without an extra wait.</p></footer>
      </div>}
      {final && <>
        <div className="mx-auto w-full max-w-lg min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck size={18} />Your download links</div>
          {relayState === "checking" && <p role="status" className="mb-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />Checking download service…</p>}
          {(relayState === "unavailable" || (request.episodes.flatMap(ep => ep.choices).length > 0 && request.episodes.flatMap(ep => ep.choices).every(choice => fileState[choice.url] === "unavailable"))) && <div role="alert" className="mb-4 text-sm text-destructive"><p>Website downloads are currently unavailable. {showTelegram ? "Please use the Telegram episode links, or try again later." : "Please try again later."}</p><Button variant="outline" className="mt-2" onClick={() => void resolveRelay()}><RefreshCw size={14} />Retry</Button></div>}
          <div className="space-y-4">{request.episodes.map(ep => <section key={ep.number} className="download-card rounded-xl border border-border p-3">
            <div className="mb-2.5 flex items-center gap-2.5">{request.poster && <img src={request.poster} alt="" className="h-9 w-7 rounded object-cover" />}<span className="text-sm font-bold">Episode {String(ep.number).padStart(2, "0")}</span><span className="ml-auto text-[11px] text-muted-foreground">{ep.choices.length} {ep.choices.length === 1 ? "quality" : "qualities"}</span></div>
            <div className="space-y-2">{ep.choices.map(choice => { const key = `w:${ep.number}:${choice.quality}`; const ext = (choice.fileName.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "file").toUpperCase(); return <Button key={choice.quality} type="button" className="download-go flex min-h-14 h-auto w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-left disabled:opacity-50" disabled={!base || !config.websiteEnabled || fileState[choice.url] === "unavailable"} onClick={() => tapWithAd(key, () => startWebsite(choice))}><Download size={20} className="shrink-0" /><span className="min-w-0 flex-1"><span className="block text-sm font-bold">{qualityLabel(choice.quality)}</span><span className="block text-xs opacity-90">{fileState[choice.url] === "unavailable" ? "File unavailable" : sizes[choice.url] ? `${(sizes[choice.url] / 1048576).toFixed(1)} MB` : "Size unavailable"} • {ext}</span></span><span className="shrink-0 text-[11px] font-semibold">{adSeen.has(key) ? "Download now" : "Download"}</span></Button>; })}{!ep.choices.length && <p className="text-xs text-muted-foreground">No website files available.</p>}</div>
            {config.telegramEnabled && ep.telegramUrl && <Button className="download-telegram mt-3 h-11 w-full" onClick={() => tapWithAd(`telegram:${ep.number}`, () => startTelegram(ep.telegramUrl, 1))}><TelegramLogo />Telegram · Episode {ep.number}</Button>}
          </section>)}</div>
          {showTelegram && (request.telegramEpisodeCount || request.episodes.length) > 1 && <Button className="download-telegram mt-4 h-12 w-full" onClick={() => tapWithAd("telegram", () => startTelegram())}><TelegramLogo />Telegram · All {request.telegramEpisodeCount || request.episodes.length} episodes</Button>}
        </div>
        <footer className="download-final-footer"><div className="mx-auto w-full max-w-lg px-4"><Button type="button" variant="outline" className="h-12 w-full text-sm font-bold" onClick={back}><ArrowLeft />Go back watch page</Button></div></footer>
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

