import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Globe, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { onValue } from "firebase/database";
import { toast } from "sonner";

import { db, ref } from "@/lib/firebase";
import { createTelegramBotUnlockLink, createUnlockLinksForAllServices, claimAccessCode, getLocalUserId, type AdService } from "@/lib/unlockAccess";
import { openExternalBrowser, openTelegramDeepLink } from "@/lib/openExternal";

type UnlockLink = { service: AdService; shortUrl: string };
type PendingPlayback = {
  animeId: string;
  seasonIdx?: number;
  epIdx?: number;
  title?: string;
  poster?: string;
  backdrop?: string;
};

const PENDING_KEY = "rs_pendingUnlockPlayback";

const UnlockRequired = () => {
  const navigate = useNavigate();
  const [lang, setLang] = useState<"bn" | "en">("en");
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState<UnlockLink[]>([]);
  const [accessCode, setAccessCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [openingService, setOpeningService] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPlayback | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (raw) setPending(JSON.parse(raw));
    } catch {}
  }, []);

  const resumePlayback = useCallback(() => {
    navigate("/?resumeUnlock=1", { replace: true });
  }, [navigate]);

  useEffect(() => {
    const uid = getLocalUserId();
    if (!uid) return;

    const unsub = onValue(ref(db, `users/${uid}/freeAccess`), (snap) => {
      const data = snap.val();
      if (data?.active && Number(data.expiresAt) > Date.now()) {
        // Only auto-resume if there's a pending playback waiting.
        // Otherwise the user navigated here manually with already-active access
        // and we'd cause a /unlock-required ↔ / loop.
        let hasPending = false;
        try { hasPending = !!sessionStorage.getItem(PENDING_KEY); } catch {}
        if (hasPending) resumePlayback();
      }
    });

    return () => unsub();
  }, [resumePlayback]);

  useEffect(() => {
    let mounted = true;
    createUnlockLinksForAllServices()
      .then((result) => {
        if (!mounted) return;
        if (result.ok) setLinks(result.links);
        else toast.error("Failed to create unlock link");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const openLink = useCallback(async (url: string, service?: AdService) => {
    const isTelegramMode =
      service?.mode === "miniapp" ||
      url === "miniapp://telegram" ||
      /telegram/i.test(`${service?.id || ""} ${service?.name || ""}`);

    if (isTelegramMode) {
      const serviceKey = service?.id || "telegram";
      setOpeningService(serviceKey);
      setTimeout(async () => {
        const result = await createTelegramBotUnlockLink();
        if (result.ok && result.url) {
          openTelegramDeepLink(result.url);
          setTimeout(() => setOpeningService(null), 300);
          return;
        }
        setOpeningService(null);
        toast.error("Failed to create Telegram verify link");
      }, 950);
      return;
    }

    if (url) openExternalBrowser(url);
  }, []);

  const handleClaim = useCallback(async () => {
    const code = accessCode.trim();
    if (!code) return;
    setClaiming(true);
    try {
      const result = await claimAccessCode(code);
      if (result.ok) {
        toast.success(lang === "bn" ? "Access unlocked" : "Access unlocked");
        resumePlayback();
        return;
      }
      toast.error(result.error || "Claim failed");
    } finally {
      setClaiming(false);
    }
  }, [accessCode, lang, resumePlayback]);

  const t = useMemo(() => lang === "bn" ? {
    eyebrow: "ভেরিফাই অ্যাক্সেস",
    title: "ভিডিও দেখার আগে অ্যাক্সেস আনলক করুন",
    subtitle: "ডাইরেক্ট লিংক নয় — verify button আপনাকে shortener flow হয়ে Telegram-এ নিয়ে যাবে, তারপর token নিয়ে এখানে paste করবেন।",
    stepsTitle: "কীভাবে কাজ করে",
    steps: [
      "Telegram Bot বা unlock button-এ চাপুন",
      "Telegram-এ verify message নিন বা short link complete করুন",
      "সফল হলে আপনাকে আবার player-এ ফিরিয়ে আনা হবে",
    ],
    tokenLabel: "Telegram থেকে পাওয়া লিংক / টোকেন",
    tokenHint: "নিচে access token পেস্ট করুন",
    tokenPlaceholder: "access token এখানে লিখুন",
    claim: "টোকেন দিয়ে আনলক",
    loading: "Unlock button তৈরি হচ্ছে...",
    back: "হোমে ফিরে যান",
    lang: "EN",
  } : {
    eyebrow: "VERIFY ACCESS",
    title: "Unlock access before opening the player",
    subtitle: "No direct link here — the verify button must go through the shortener flow, then you paste the Telegram token below.",
    stepsTitle: "How it works",
    steps: [
      "Tap Telegram Bot or any unlock button",
      "Receive the verify message in Telegram or complete the short link",
      "After success, you'll be returned to the player automatically",
    ],
    tokenLabel: "Link / token from Telegram",
    tokenHint: "Paste the access token below",
    tokenPlaceholder: "Type your access token here",
    claim: "Unlock with token",
    loading: "Preparing unlock buttons...",
    back: "Back to home",
    lang: "BN",
  }, [lang]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative min-h-screen overflow-hidden">
        <div className="absolute inset-0 bg-background" />

        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8">
          <div className="rounded-2xl border border-primary/20 bg-card/80 p-5 shadow-2xl backdrop-blur-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">{t.eyebrow}</p>
                <h1 className="mt-2 text-2xl font-black leading-tight">{t.title}</h1>
              </div>
              <button
                onClick={() => setLang((v) => v === "bn" ? "en" : "bn")}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary"
              >
                <Globe className="h-3.5 w-3.5" /> {t.lang}
              </button>
            </div>

            {pending?.poster ? (
              <div className="mb-4 flex items-center gap-3 rounded-xl bg-secondary/40 p-3">
                <img src={pending.poster} alt={pending.title || "Pending unlock"} className="h-16 w-12 rounded-lg object-cover" loading="lazy" />
                <div className="min-w-0">
                  <p className="text-sm font-bold line-clamp-2">{pending.title || "Selected content"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Player will open automatically after successful verification.</p>
                </div>
              </div>
            ) : null}

            <p className="text-sm leading-relaxed text-muted-foreground">{t.subtitle}</p>

            {/* MAIN ACTION: Unlock buttons (top priority) */}
            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center gap-2 rounded-xl bg-secondary/40 px-4 py-5 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" /> {t.loading}
                </div>
              ) : (
                links.map((link, index) => (
                  <button
                    key={`${link.service.id}-${index}`}
                    onClick={() => openLink(link.shortUrl, link.service)}
                    disabled={openingService === (link.service.id || "telegram")}
                    className="unlock-cta-button relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-primary/20 px-4 py-3 text-sm font-bold text-primary-foreground shadow-lg disabled:opacity-100"
                    style={{ background: link.service.color || "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))", fontFamily: "'Russo One', sans-serif" }}
                  >
                    <span
                      className={`unlock-cta-fill ${openingService === (link.service.id || "telegram") ? "opacity-100" : "opacity-0"}`}
                    />
                    {openingService === (link.service.id || "telegram") ? <Loader2 className="relative z-10 h-4 w-4 animate-spin" /> : <ExternalLink className="relative z-10 h-4 w-4" />}
                    <span className="relative z-10">{link.service.icon || "🔓"} {link.service.name || `Unlock ${index + 1}`}</span>
                  </button>
                ))
              )}
            </div>

            {/* MIDDLE: Paste input (top) + TOKEN BOX display (bottom) */}
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-primary/25 bg-secondary/25 p-4 shadow-[0_0_30px_hsl(var(--primary)/0.12)]">
                <p className="text-center text-sm font-bold text-primary" style={{ fontFamily: "'Russo One', sans-serif" }}>
                  ✦ {t.tokenHint} ✦
                </p>
                <input
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                  placeholder={t.tokenPlaceholder}
                  className="mt-3 w-full rounded-xl border border-primary/25 bg-background/70 px-3 py-3 text-center font-mono tracking-[0.25em] outline-none focus:border-primary"
                  maxLength={20}
                />
                <button
                  onClick={handleClaim}
                  disabled={claiming || !accessCode.trim()}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {t.claim}
                </button>
              </div>

              <div className="block w-full rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background/60 to-accent/10 px-4 py-4 text-center shadow-[0_0_24px_hsl(var(--primary)/0.18)]">
                <p className="text-[10px] tracking-[0.25em] text-muted-foreground truncate" style={{ fontFamily: "'Russo One', sans-serif" }}>
                  ✦━━━━━━━━━━━━━━━━✦
                </p>
                <p className="my-2 px-2 text-[13px] font-bold leading-snug text-primary break-words" style={{ fontFamily: "'Russo One', sans-serif" }}>
                  {lang === "bn"
                    ? "Telegram থেকে পাওয়া link / token এইখানে দিতে হবে"
                    : "Paste your Telegram link / token here"}
                </p>
                <p className="text-[10px] tracking-[0.25em] text-muted-foreground truncate" style={{ fontFamily: "'Russo One', sans-serif" }}>
                  ✦━━━━━━━━━━━━━━━━✦
                </p>
              </div>
            </div>

            {/* BOTTOM: How it works (informational, lowest priority) */}
            <div className="mt-4 rounded-xl bg-secondary/40 p-4">
              <div className="mb-2 flex items-center gap-2 text-primary">
                <ShieldCheck className="h-4 w-4" />
                <p className="text-xs font-bold uppercase tracking-[0.22em]">{t.stepsTitle}</p>
              </div>
              <div className="space-y-2 text-sm text-foreground/90">
                {t.steps.map((step, index) => (
                  <p key={step}><span className="mr-2 font-bold text-primary">0{index + 1}</span>{step}</p>
                ))}
              </div>
            </div>

            <button
              onClick={() => navigate("/", { replace: true })}
              className="mt-4 w-full rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm font-semibold text-muted-foreground"
            >
              {t.back}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnlockRequired;