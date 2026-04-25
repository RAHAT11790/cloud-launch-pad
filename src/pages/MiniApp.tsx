import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Play,
  Sparkles,
  Globe,
  ExternalLink,
  Lock,
  Loader2,
  Copy,
  AlertTriangle,
} from "lucide-react";

// Monetag SDK zone id (provided by user)
const MONETAG_ZONE = "10924403";
const MONETAG_SDK = `//libtl.com/sdk.js`;
const REQUIRED_VIEWS = 5;
const MIN_AD_DURATION_SEC = 15;

declare global {
  interface Window {
    [k: string]: any;
    Telegram?: any;
  }
}

type Lang = "en" | "bn";

const STR: Record<Lang, Record<string, string>> = {
  en: {
    title: "Get 24h Free Access",
    subtitle: "Watch 5 short ads to unlock",
    chooseAd: "Choose your ad type",
    rewarded: "Rewarded Ad",
    rewardedDesc: "Watch the ad, then tap Open in your browser",
    inApp: "In-App Ad",
    inAppDesc: "Quick ads play automatically",
    progress: "Progress",
    watchAd: "Watch Ad",
    watching: "Loading ad…",
    completed: "Ads completed",
    getAccess: "Get 24h Access",
    granted: "🎉 Access Granted!",
    grantedDesc: "Your 24h access is now active.",
    backToBot: "Back to Bot",
    needTg: "Open this page from Telegram bot to unlock access.",
    invalidUser:
      "User not detected. Please open from the Telegram bot, or use the browser fallback below.",
    notCounted: "Ad closed too early or skipped. Not counted.",
    counted: "✅ Ad counted!",
    grantFailed: "Failed to grant access. Try again.",
    apiMode: "External access mode",
    redirecting: "Redirecting…",
    fallbackTitle: "Backup unlock link",
    fallbackDesc:
      "If your account didn't unlock automatically, copy this link and open it in your phone's browser to unlock instantly.",
    copy: "Copy",
    copied: "Copied!",
    openShortDest: "Open your link",
  },
  bn: {
    title: "২৪ ঘণ্টার ফ্রি অ্যাক্সেস",
    subtitle: "৫টি ছোট অ্যাড দেখলেই আনলক",
    chooseAd: "অ্যাডের ধরন বেছে নিন",
    rewarded: "Rewarded Ad",
    rewardedDesc: "অ্যাড দেখার পর Open বাটনে ট্যাপ করে ব্রাউজারে যেতে হবে",
    inApp: "In-App Ad",
    inAppDesc: "অটোমেটিক ছোট অ্যাড চলবে",
    progress: "অগ্রগতি",
    watchAd: "অ্যাড দেখুন",
    watching: "অ্যাড লোড হচ্ছে…",
    completed: "অ্যাড শেষ",
    getAccess: "২৪ ঘণ্টার অ্যাক্সেস নিন",
    granted: "🎉 অ্যাক্সেস পেয়ে গেছেন!",
    grantedDesc: "আপনার ২৪ ঘণ্টার অ্যাক্সেস এখন সক্রিয়।",
    backToBot: "বটে ফিরে যান",
    needTg: "অ্যাক্সেস পেতে এই পেইজটি টেলিগ্রাম বট থেকে খুলতে হবে।",
    invalidUser:
      "ইউজার পাওয়া যায়নি। টেলিগ্রাম বট থেকে খুলুন, অথবা নিচের ব্যাকআপ লিঙ্ক ব্যবহার করুন।",
    notCounted:
      "অ্যাড আগেই বন্ধ করেছেন বা স্কিপ করেছেন। গণনা হয়নি।",
    counted: "✅ অ্যাড গণনা হয়েছে!",
    grantFailed: "অ্যাক্সেস দিতে ব্যর্থ। আবার চেষ্টা করুন।",
    apiMode: "এক্সটার্নাল অ্যাক্সেস মোড",
    redirecting: "রিডাইরেক্ট হচ্ছে…",
    fallbackTitle: "ব্যাকআপ আনলক লিঙ্ক",
    fallbackDesc:
      "যদি আপনার একাউন্টে অটোমেটিক আনলক না হয়, তাহলে এই লিঙ্কটি কপি করে আপনার ফোনের ব্রাউজারে খুললেই সাথে সাথে আনলক হয়ে যাবে।",
    copy: "কপি",
    copied: "কপি হয়েছে!",
    openShortDest: "আপনার লিঙ্ক খুলুন",
  },
};

function loadMonetag(): Promise<void> {
  return new Promise((resolve) => {
    const fnName = `show_${MONETAG_ZONE}`;
    if (typeof window[fnName] === "function") return resolve();
    const existing = document.querySelector(
      `script[data-zone="${MONETAG_ZONE}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      setTimeout(() => resolve(), 3000);
      return;
    }
    const s = document.createElement("script");
    s.src = MONETAG_SDK;
    s.setAttribute("data-zone", MONETAG_ZONE);
    s.setAttribute("data-sdk", `show_${MONETAG_ZONE}`);
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
    setTimeout(() => resolve(), 5000);
  });
}

const FN_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/mini-app`;

export default function MiniApp() {
  const [lang, setLang] = useState<Lang>("bn");
  const t = STR[lang];

  const [adType, setAdType] = useState<"rewarded" | "inApp" | null>(null);
  const [views, setViews] = useState(0);
  const [adRunning, setAdRunning] = useState(false);
  const [granted, setGranted] = useState(false);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState<string>("");
  const [info, setInfo] = useState<string>("");
  const [fallbackUrl, setFallbackUrl] = useState<string>("");
  const [shortDest, setShortDest] = useState<string>("");
  const [shortLabel, setShortLabel] = useState<string>("");
  const [copyOk, setCopyOk] = useState(false);

  // Parse url params
  const params = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const apiKey = params.get("key") || "";
  const externalUser = params.get("user") || params.get("u") || "";
  const externalRedirect = params.get("redirect") || "";
  const shortId = params.get("s") || "";

  // Resolve user id with maximum reliability
  const userId = useMemo(() => {
    // 1) Telegram start_param u_xxx (forwarded from t.me/<bot>?startapp=u_xxx)
    try {
      const tg = window.Telegram?.WebApp;
      const sp = tg?.initDataUnsafe?.start_param || "";
      if (typeof sp === "string" && sp.startsWith("u_")) {
        return decodeURIComponent(sp.slice(2));
      }
    } catch {}
    // 2) Explicit ?user= or ?u= URL param
    if (externalUser) return externalUser;
    // 3) Telegram WebApp user id (real telegram numeric id)
    try {
      const tg = window.Telegram?.WebApp;
      if (tg?.initDataUnsafe?.user?.id)
        return `tg_${tg.initDataUnsafe.user.id}`;
    } catch {}
    // 4) Local site user (rare; only if user opened /mini directly while logged in)
    try {
      const raw = localStorage.getItem("rsanime_user");
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.id) return p.id;
      }
    } catch {}
    return "";
  }, [externalUser]);

  const isApiMode = !!apiKey;
  const isShortMode = !!shortId;
  const mode: "site" | "api" | "short" = isShortMode
    ? "short"
    : isApiMode
      ? "api"
      : "site";

  // Boot SDK + Telegram + visit log + resolve short link
  useEffect(() => {
    try {
      window.Telegram?.WebApp?.ready?.();
      window.Telegram?.WebApp?.expand?.();
    } catch {}
    loadMonetag();
    fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "visit", source: mode }),
    }).catch(() => {});

    if (isShortMode) {
      fetch(FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", shortId }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.ok && d.dest) {
            setShortDest(d.dest);
            setShortLabel(d.label || "");
          }
        })
        .catch(() => {});
    }
  }, [mode, isShortMode, shortId]);

  // Auto-clear notices
  useEffect(() => {
    if (!info && !error) return;
    const id = setTimeout(() => {
      setInfo("");
      setError("");
    }, 4000);
    return () => clearTimeout(id);
  }, [info, error]);

  const handleWatchAd = async () => {
    if (adRunning) return;
    if (!adType) return;
    setAdRunning(true);
    setError("");
    setInfo("");

    const fnName = `show_${MONETAG_ZONE}`;
    const showFn = window[fnName];
    if (typeof showFn !== "function") {
      setAdRunning(false);
      setError("SDK not loaded yet. Try again.");
      return;
    }

    const startedAt = Date.now();
    try {
      if (adType === "rewarded") {
        // Rewarded interstitial — Monetag resolves only if user actually viewed/closed.
        await showFn();
      } else {
        // In-App Interstitial: short trigger
        await showFn({
          type: "inApp",
          inAppSettings: {
            frequency: 1,
            capping: 0.05,
            interval: 15,
            timeout: 5,
            everyPage: false,
          },
        });
      }
      const elapsed = (Date.now() - startedAt) / 1000;
      // Strict gate: must have spent >=15s on the ad. Closing earlier = not counted.
      if (elapsed < MIN_AD_DURATION_SEC) {
        setError(t.notCounted);
      } else {
        setViews((v) => Math.min(REQUIRED_VIEWS, v + 1));
        setInfo(t.counted);
      }
    } catch {
      setError(t.notCounted);
    } finally {
      setAdRunning(false);
    }
  };

  const handleGetAccess = async () => {
    if (granting) return;
    if (views < REQUIRED_VIEWS) return;

    // Short-link mode doesn't require a user id at all
    if (mode !== "short" && !userId) {
      setError(t.invalidUser);
      return;
    }
    setGranting(true);
    setError("");

    try {
      const r = await fetch(FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "grant",
          userId: userId || "anon",
          source: mode,
          apiKey: apiKey || undefined,
          shortId: shortId || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        setError(t.grantFailed);
      } else {
        setGranted(true);
        // Short-link mode: redirect to original destination
        if (mode === "short" && data.dest) {
          setShortDest(data.dest);
          setInfo(t.redirecting);
          setTimeout(() => {
            window.location.href = data.dest;
          }, 1500);
        }
        // Api mode: redirect after delay
        else if (mode === "api") {
          const redirectTo = data.redirectUrl || externalRedirect;
          if (redirectTo) {
            setInfo(t.redirecting);
            setTimeout(() => {
              window.location.href = redirectTo;
            }, 1500);
          }
        }
        // Site mode: show fallback unlock URL so user can paste in browser
        else if (mode === "site" && data.fallbackToken) {
          const origin = window.location.origin;
          setFallbackUrl(
            `${origin}/unlock?mini=${encodeURIComponent(data.fallbackToken)}`,
          );
        }
      }
    } catch {
      setError(t.grantFailed);
    } finally {
      setGranting(false);
    }
  };

  const closeMini = () => {
    try {
      window.Telegram?.WebApp?.close?.();
    } catch {}
  };

  const copy = (txt: string) => {
    try {
      navigator.clipboard.writeText(txt);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {}
  };

  const progress = (views / REQUIRED_VIEWS) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b0f1a] via-[#0a0d18] to-black text-white relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-96 h-96 rounded-full bg-purple-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-cyan-500/20 blur-3xl" />

      <div className="relative max-w-md mx-auto px-5 pt-6 pb-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-fuchsia-500/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm text-white/60 leading-none">Mini App</div>
              <div className="text-base font-semibold leading-tight">
                {shortLabel || "RS Access"}
              </div>
            </div>
          </div>
          <button
            onClick={() => setLang(lang === "en" ? "bn" : "en")}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium border border-white/10 transition flex items-center gap-1"
          >
            <Globe className="w-3.5 h-3.5" />
            {lang === "en" ? "বাংলা" : "English"}
          </button>
        </div>

        {/* Mode badge */}
        {(isApiMode || isShortMode) && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-400/30 text-amber-200 text-xs flex items-center gap-2">
            <Lock className="w-3.5 h-3.5" />
            {isShortMode
              ? `${shortLabel || "External"} link · unlock after 5 ads`
              : t.apiMode}
          </div>
        )}

        {/* No user warning (site mode only) */}
        {mode === "site" && !userId && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-400/30 text-rose-200 text-xs flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{t.invalidUser}</span>
          </div>
        )}

        {/* Granted state */}
        {granted ? (
          <div className="rounded-2xl bg-gradient-to-br from-emerald-500/15 to-cyan-500/10 border border-emerald-400/30 p-6 text-center">
            <CheckCircle2 className="w-14 h-14 mx-auto text-emerald-400 mb-3" />
            <h2 className="text-2xl font-bold mb-2">{t.granted}</h2>
            <p className="text-white/70 text-sm mb-5">{t.grantedDesc}</p>
            {info && <p className="text-cyan-300 text-xs mb-3">{info}</p>}

            {/* Short-link destination */}
            {mode === "short" && shortDest && (
              <a
                href={shortDest}
                className="block w-full py-3 mb-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-400 text-black font-semibold shadow-lg hover:scale-[1.02] active:scale-[0.98] transition"
              >
                <ExternalLink className="inline w-4 h-4 mr-2" />
                {t.openShortDest}
              </a>
            )}

            {/* Site fallback unlock link */}
            {mode === "site" && fallbackUrl && (
              <div className="text-left rounded-xl bg-white/5 border border-white/15 p-3 mb-4">
                <div className="text-xs font-semibold text-amber-300 mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t.fallbackTitle}
                </div>
                <p className="text-[11px] text-white/60 mb-2">
                  {t.fallbackDesc}
                </p>
                <div className="flex items-center gap-1 p-2 rounded-lg bg-black/40 text-[11px] font-mono break-all">
                  <span className="flex-1 break-all">{fallbackUrl}</span>
                  <button
                    onClick={() => copy(fallbackUrl)}
                    className="p-1.5 rounded bg-white/10 hover:bg-white/20 shrink-0"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
                {copyOk && (
                  <div className="text-[10px] text-emerald-300 mt-1">
                    {t.copied}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={closeMini}
              className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold border border-white/10 transition"
            >
              {t.backToBot}
            </button>
          </div>
        ) : (
          <>
            {/* Title */}
            <h1 className="text-2xl font-bold leading-tight mb-1">{t.title}</h1>
            <p className="text-white/60 text-sm mb-5">{t.subtitle}</p>

            {/* Progress */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 mb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-white/60">{t.progress}</span>
                <span className="text-sm font-semibold">
                  {views} / {REQUIRED_VIEWS}
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-400 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 gap-1">
                {Array.from({ length: REQUIRED_VIEWS }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 h-1.5 rounded-full ${
                      i < views ? "bg-emerald-400" : "bg-white/10"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Ad type chooser */}
            {!adType && views < REQUIRED_VIEWS && (
              <>
                <div className="text-sm font-semibold text-white/80 mb-2">
                  {t.chooseAd}
                </div>
                <div className="grid grid-cols-1 gap-3 mb-5">
                  <button
                    onClick={() => setAdType("rewarded")}
                    className="text-left p-4 rounded-2xl bg-gradient-to-br from-fuchsia-500/15 to-purple-600/10 border border-fuchsia-400/30 hover:border-fuchsia-300 transition group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-fuchsia-500/30 flex items-center justify-center">
                        <Play className="w-5 h-5 text-fuchsia-200" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold">{t.rewarded}</div>
                        <div className="text-xs text-white/60 mt-0.5">
                          {t.rewardedDesc}
                        </div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-white/40 group-hover:text-white/80 transition" />
                    </div>
                  </button>

                  <button
                    onClick={() => setAdType("inApp")}
                    className="text-left p-4 rounded-2xl bg-gradient-to-br from-cyan-500/15 to-sky-600/10 border border-cyan-400/30 hover:border-cyan-300 transition group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-cyan-500/30 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-cyan-200" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold">{t.inApp}</div>
                        <div className="text-xs text-white/60 mt-0.5">
                          {t.inAppDesc}
                        </div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-white/40 group-hover:text-white/80 transition" />
                    </div>
                  </button>
                </div>
              </>
            )}

            {/* Watch ad button */}
            {adType && views < REQUIRED_VIEWS && (
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-white/60">
                    {adType === "rewarded" ? t.rewarded : t.inApp}
                  </span>
                  <button
                    onClick={() => setAdType(null)}
                    className="text-xs text-white/50 hover:text-white"
                  >
                    Change
                  </button>
                </div>
                <button
                  onClick={handleWatchAd}
                  disabled={adRunning}
                  className="w-full py-4 rounded-2xl bg-gradient-to-r from-fuchsia-500 to-cyan-400 text-black font-bold text-lg shadow-lg shadow-fuchsia-500/30 hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-60 disabled:hover:scale-100 flex items-center justify-center gap-2"
                >
                  {adRunning ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" /> {t.watching}
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5" /> {t.watchAd} ({views + 1}/
                      {REQUIRED_VIEWS})
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Get access */}
            {views >= REQUIRED_VIEWS && (
              <button
                onClick={handleGetAccess}
                disabled={granting}
                className="w-full py-4 mb-5 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-400 text-black font-bold text-lg shadow-lg shadow-emerald-500/40 hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {granting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
                {t.getAccess}
              </button>
            )}

            {/* Notices */}
            {info && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-400/30 text-emerald-300 text-xs">
                {info}
              </div>
            )}
            {error && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-400/30 text-rose-300 text-xs">
                {error}
              </div>
            )}

            {/* Rules */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 text-xs text-white/70 space-y-1 leading-relaxed">
              <div className="font-semibold text-white/90 mb-1">
                {lang === "en" ? "Rules" : "নিয়মাবলি"}
              </div>
              <div>
                {lang === "en"
                  ? "• Each ad must run for at least 15 seconds"
                  : "• প্রতিটি অ্যাড অন্তত ১৫ সেকেন্ড চলতে হবে"}
              </div>
              <div>
                {lang === "en"
                  ? "• You must tap Open and view the page in browser"
                  : "• Open বাটনে ক্লিক করে ব্রাউজারে পেইজ দেখতে হবে"}
              </div>
              <div>
                {lang === "en"
                  ? "• Closing early will not count"
                  : "• অ্যাড আগে বন্ধ করলে গণনা হবে না"}
              </div>
              <div>
                {lang === "en"
                  ? "• Complete all 5 ads to unlock 24h access"
                  : "• ৫টি অ্যাড সম্পন্ন করলেই ২৪ ঘণ্টার অ্যাক্সেস"}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
