import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  User as UserIcon,
  Shield,
  Zap,
  Clock,
} from "lucide-react";
import logoImg from "@/assets/logo.png";

// Monetag SDK zone id
const MONETAG_ZONE = "10924403";
// Use absolute https URL — protocol-relative can fail inside Telegram WebView
const MONETAG_SDK = `https://libtl.com/sdk.js`;
const MONETAG_SCRIPT_ID = `monetag-sdk-${MONETAG_ZONE}`;
const MONETAG_REQUEST_VAR = "mini_unlock";
const REQUIRED_VIEWS = 5;

let monetagLoadPromise: Promise<boolean> | null = null;

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
    subtitle: "Watch 5 short ads to unlock everything",
    chooseAd: "Choose your ad type",
    rewarded: "Rewarded Ad",
    rewardedDesc: "Watch the ad, then tap Open in your browser",
    inApp: "In-App Ad",
    inAppDesc: "Quick ads play automatically",
    progress: "Progress",
    watchAd: "Watch Ad",
    watching: "Loading ad…",
    sdkLoading: "Preparing ads…",
    completed: "Ads completed",
    getAccess: "🎉 Unlock 24h Access",
    granted: "Access Granted!",
    grantedDesc: "Open the website now — your access is already active.",
    backToBot: "Close",
    needTg: "Open this page from Telegram bot to unlock access.",
    invalidUser:
      "Account not detected. Please open from the Telegram bot link.",
    notCounted: "Ad closed too early or skipped. Not counted.",
    counted: "✅ Ad counted!",
    realOnly: "Only real Rewarded ads can unlock access.",
    adUnavailable: "Monetag did not return a real ad, so nothing was counted.",
    rewardReady: "Rewarded ad is ready",
    grantFailed: "Failed to grant access. Try again.",
    apiMode: "External access mode",
    redirecting: "Redirecting…",
    fallbackTitle: "Backup unlock link",
    fallbackDesc:
      "If your access didn't show up automatically on the website, copy this link and open it in your phone's browser.",
    copy: "Copy",
    copied: "Copied!",
    openShortDest: "Open your link",
    welcome: "Welcome",
    detecting: "Detecting your account…",
    aboutTitle: "About RS ANIME",
    aboutDesc:
      "Premium anime streaming with HD quality, multi-language audio, and zero buffering on weak networks.",
    rule1: "Each ad must run for at least 15 seconds",
    rule2: "Closing the ad early will not count",
    rule3: "Complete all 5 ads to unlock 24h access",
    rule4: "Access works automatically on the website",
    secure: "Secure",
    fast: "Fast",
    free: "Free",
  },
  bn: {
    title: "২৪ ঘণ্টার ফ্রি অ্যাক্সেস",
    subtitle: "৫টি ছোট অ্যাড দেখলেই সবকিছু আনলক",
    chooseAd: "অ্যাডের ধরন বেছে নিন",
    rewarded: "Rewarded Ad",
    rewardedDesc: "অ্যাড দেখার পর Open বাটনে ট্যাপ করে ব্রাউজারে যেতে হবে",
    inApp: "In-App Ad",
    inAppDesc: "অটোমেটিক ছোট অ্যাড চলবে",
    progress: "অগ্রগতি",
    watchAd: "অ্যাড দেখুন",
    watching: "অ্যাড লোড হচ্ছে…",
    sdkLoading: "অ্যাড প্রস্তুত হচ্ছে…",
    completed: "অ্যাড শেষ",
    getAccess: "🎉 ২৪ ঘণ্টার অ্যাক্সেস নিন",
    granted: "অ্যাক্সেস পেয়ে গেছেন!",
    grantedDesc: "এখনই ওয়েবসাইট খুলুন — আপনার অ্যাক্সেস সক্রিয় হয়ে গেছে।",
    backToBot: "বন্ধ করুন",
    needTg: "অ্যাক্সেস পেতে এই পেইজটি টেলিগ্রাম বট থেকে খুলতে হবে।",
    invalidUser: "একাউন্ট পাওয়া যায়নি। টেলিগ্রাম বট লিঙ্ক থেকে খুলুন।",
    notCounted: "অ্যাড আগেই বন্ধ করেছেন বা স্কিপ করেছেন। গণনা হয়নি।",
    counted: "✅ অ্যাড গণনা হয়েছে!",
    realOnly: "আনলকের জন্য শুধু রিয়াল Rewarded Ad ব্যবহার করা যাবে।",
    adUnavailable:
      "Monetag কোনো রিয়াল অ্যাড দেয়নি, তাই কিছু কাউন্ট হয়নি।",
    rewardReady: "Rewarded ad প্রস্তুত",
    grantFailed: "অ্যাক্সেস দিতে ব্যর্থ। আবার চেষ্টা করুন।",
    apiMode: "এক্সটার্নাল অ্যাক্সেস মোড",
    redirecting: "রিডাইরেক্ট হচ্ছে…",
    fallbackTitle: "ব্যাকআপ আনলক লিঙ্ক",
    fallbackDesc:
      "যদি ওয়েবসাইটে অটোমেটিক অ্যাক্সেস না আসে, এই লিঙ্কটি কপি করে ফোনের ব্রাউজারে খুলুন।",
    copy: "কপি",
    copied: "কপি হয়েছে!",
    openShortDest: "আপনার লিঙ্ক খুলুন",
    welcome: "স্বাগতম",
    detecting: "আপনার একাউন্ট খোঁজা হচ্ছে…",
    aboutTitle: "RS ANIME সম্পর্কে",
    aboutDesc:
      "HD কোয়ালিটি, মাল্টি-ল্যাঙ্গুয়েজ অডিও এবং দুর্বল নেটওয়ার্কে জিরো-বাফারিং সহ প্রিমিয়াম এনিমে স্ট্রিমিং।",
    rule1: "প্রতিটি অ্যাড অন্তত ১৫ সেকেন্ড চলতে হবে",
    rule2: "অ্যাড আগে বন্ধ করলে গণনা হবে না",
    rule3: "৫টি অ্যাড সম্পন্ন করলেই ২৪ ঘণ্টার অ্যাক্সেস",
    rule4: "ওয়েবসাইটে অ্যাক্সেস স্বয়ংক্রিয়ভাবে কাজ করবে",
    secure: "নিরাপদ",
    fast: "দ্রুত",
    free: "ফ্রি",
  },
};

const waitForMonetagFn = (maxWaitMs = 15000): Promise<boolean> =>
  new Promise((resolve) => {
    const fnName = `show_${MONETAG_ZONE}`;
    const started = Date.now();
    const tick = () => {
      if (typeof window[fnName] === "function") return resolve(true);
      if (Date.now() - started >= maxWaitMs) return resolve(false);
      setTimeout(tick, 150);
    };
    tick();
  });

const buildMonetagTrackingId = (userId: string, step: number) => {
  const safeUser = (userId || "guest").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  return `${MONETAG_REQUEST_VAR}-${safeUser}-${step}-${Date.now()}`;
};

// Telegram WebApp on older clients (incl. Lovable preview & some Android builds)
// throws "CloudStorage is not supported in version 6.0" the moment Monetag SDK
// touches tg.cloudStorage.getItem/setItem. We FORCE-override these methods with
// a localStorage-backed shim so Monetag never sees the native error.
function ensureTelegramCloudStorageCompat() {
  try {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    const get = (key: string) => {
      try { return localStorage.getItem(`tgcs:${key}`) || ""; } catch { return ""; }
    };
    const set = (key: string, value: string) => {
      try { localStorage.setItem(`tgcs:${key}`, String(value)); } catch {}
    };
    const del = (key: string) => {
      try { localStorage.removeItem(`tgcs:${key}`); } catch {}
    };

    const safeStorage: any = {
      getItem: (key: string, cb?: (err: unknown, value: string) => void) => {
        const v = get(key); cb?.(null, v); return Promise.resolve(v);
      },
      setItem: (key: string, value: string, cb?: (err: unknown, ok: boolean) => void) => {
        set(key, value); cb?.(null, true); return Promise.resolve(true);
      },
      removeItem: (key: string, cb?: (err: unknown, ok: boolean) => void) => {
        del(key); cb?.(null, true); return Promise.resolve(true);
      },
      getItems: (keys: string[], cb?: (err: unknown, value: Record<string, string>) => void) => {
        const out: Record<string, string> = {};
        for (const k of keys || []) out[k] = get(k);
        cb?.(null, out); return Promise.resolve(out);
      },
      setItems: (items: Record<string, string>, cb?: (err: unknown, ok: boolean) => void) => {
        for (const [k, v] of Object.entries(items || {})) set(k, v);
        cb?.(null, true); return Promise.resolve(true);
      },
      removeItems: (keys: string[], cb?: (err: unknown, ok: boolean) => void) => {
        for (const k of keys || []) del(k);
        cb?.(null, true); return Promise.resolve(true);
      },
      getKeys: (cb?: (err: unknown, keys: string[]) => void) => {
        const keys: string[] = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith("tgcs:")) keys.push(k.slice(5));
          }
        } catch {}
        cb?.(null, keys); return Promise.resolve(keys);
      },
    };

    // FORCE override (do NOT spread native after — native throws on v6.0)
    try {
      Object.defineProperty(tg, "cloudStorage", {
        value: safeStorage,
        writable: true,
        configurable: true,
      });
    } catch {
      tg.cloudStorage = safeStorage;
    }
  } catch {}
}

// Load Monetag SDK exactly once and wait until show_<zone> is registered.
function loadMonetag(maxWaitMs = 15000): Promise<boolean> {
  ensureTelegramCloudStorageCompat();
  const fnName = `show_${MONETAG_ZONE}`;
  if (typeof window[fnName] === "function") {
    return Promise.resolve(true);
  }

  if (monetagLoadPromise) return monetagLoadPromise;

  monetagLoadPromise = new Promise((resolve) => {
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (!ok) monetagLoadPromise = null;
      resolve(ok);
    };

    const waitUntilReady = async () => {
      const ok = await waitForMonetagFn(maxWaitMs);
      finish(ok);
    };

    const existing = document.getElementById(MONETAG_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "true") {
        void waitUntilReady();
        return;
      }
      existing.addEventListener("load", () => {
        existing.dataset.loaded = "true";
        void waitUntilReady();
      }, { once: true });
      existing.addEventListener("error", () => finish(false), { once: true });
      void waitUntilReady();
      return;
    }

    const script = document.createElement("script");
    script.id = MONETAG_SCRIPT_ID;
    script.src = MONETAG_SDK;
    script.async = true;
    script.setAttribute("data-zone", MONETAG_ZONE);
    script.setAttribute("data-sdk", `show_${MONETAG_ZONE}`);
    script.onload = () => {
      script.dataset.loaded = "true";
      void waitUntilReady();
    };
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  });

  return monetagLoadPromise;
}

const FN_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/mini-app`;

interface UserProfile {
  id: string;
  name: string;
  email?: string;
  photoURL?: string;
  source?: "site" | "telegram" | "external";
  username?: string;
  tag?: string; // short label like "tg_662" or "user_1"
}

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
  const [sdkReady, setSdkReady] = useState(false);
  const [rewardReady, setRewardReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const preloadedTrackingIdRef = useRef<string>("");
  const autoGrantedRef = useRef(false);
  const preloadAttemptedRef = useRef(false);

  // Parse url params
  const params = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const apiKey = params.get("key") || "";
  const externalUser = params.get("user") || params.get("u") || "";
  const externalRedirect = params.get("redirect") || "";
  const externalName = params.get("n") || params.get("name") || "";
  const externalPhoto = params.get("p") || params.get("photo") || "";
  const shortId = params.get("s") || "";

  // Resolve user identity. We track Telegram users separately from website users.
  // Website users: live in Firebase users/<uid> (existing flow).
  // Telegram users: identified by tg_<telegram_id>, profile from Telegram WebApp directly.
  // External (API) users: identified by what the partner bot sent in ?user= (+ optional ?n=&p=).
  const identity = useMemo(() => {
    // 1) Telegram WebApp itself (most reliable when opened inside Telegram)
    try {
      const tg = window.Telegram?.WebApp;
      const tgUser = tg?.initDataUnsafe?.user;
      if (tgUser?.id) {
        const fullName = [tgUser.first_name, tgUser.last_name]
          .filter(Boolean)
          .join(" ") || tgUser.username || "Telegram User";
        return {
          id: `tg_${tgUser.id}`,
          source: "telegram" as const,
          name: fullName,
          username: tgUser.username || "",
          photoURL: tgUser.photo_url || "",
          tag: `tg_${String(tgUser.id).slice(-4)}`,
        };
      }
      // 1b) start_param u_<firebase_uid> (website user clicked deep link from website -> bot)
      const sp = tg?.initDataUnsafe?.start_param || "";
      if (typeof sp === "string" && sp.startsWith("u_")) {
        const uid = decodeURIComponent(sp.slice(2));
        return {
          id: uid,
          source: "site" as const,
          name: "",
          tag: `user_${uid.slice(0, 4)}`,
        };
      }
    } catch {}

    // 2) ?user= from external bot — treat as external API user
    if (externalUser) {
      // If the partner sent name/photo, use them directly
      if (externalName || externalPhoto) {
        return {
          id: externalUser,
          source: "external" as const,
          name: externalName || "External User",
          photoURL: externalPhoto || "",
          tag: `ext_${externalUser.slice(0, 4)}`,
        };
      }
      // If user looks like a telegram id (numeric), treat as telegram external
      const isNumeric = /^\d+$/.test(externalUser);
      return {
        id: isNumeric ? `tg_${externalUser}` : externalUser,
        source: isNumeric ? ("telegram" as const) : ("external" as const),
        name: "",
        tag: isNumeric
          ? `tg_${externalUser.slice(-4)}`
          : `ext_${externalUser.slice(0, 4)}`,
      };
    }

    // 3) Local site user (logged in on website)
    try {
      const raw = localStorage.getItem("rsanime_user");
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.id) {
          return {
            id: p.id,
            source: "site" as const,
            name: p.name || p.displayName || "",
            photoURL: p.photoURL || p.photo || "",
            tag: `user_${String(p.id).slice(0, 4)}`,
          };
        }
      }
    } catch {}

    return {
      id: "",
      source: "site" as const,
      name: "",
      tag: "",
    };
  }, [externalUser, externalName, externalPhoto]);

  const userId = identity.id;

  const isApiMode = !!apiKey;
  const isShortMode = !!shortId;
  const mode: "site" | "api" | "short" = isShortMode
    ? "short"
    : isApiMode
      ? "api"
      : "site";

  // Boot: SDK + Telegram + visit + resolve short + fetch user info
  useEffect(() => {
    try {
      window.Telegram?.WebApp?.ready?.();
      window.Telegram?.WebApp?.expand?.();
    } catch {}

    ensureTelegramCloudStorageCompat();

    loadMonetag().then((ok) => setSdkReady(ok));

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

  // Build the displayed profile.
  // - Telegram & external users: use what we already have from initData / URL params.
  // - Website users: hit Firebase via mini-app edge function for name/email/photo.
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    // Telegram or external API user — we already have what we need locally.
    if (identity.source === "telegram" || identity.source === "external") {
      setProfile({
        id: identity.id,
        name: identity.name || (identity.source === "telegram" ? "Telegram User" : "User"),
        photoURL: identity.photoURL || "",
        source: identity.source,
        username: identity.username || "",
        tag: identity.tag || "",
      });
      setProfileLoading(false);
      return;
    }

    // Website user — fetch from backend
    setProfileLoading(true);
    fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "user-info", userId }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.user) {
          setProfile({
            id: d.user.id,
            name: d.user.name || identity.name || "User",
            email: d.user.email || "",
            photoURL: d.user.photoURL || identity.photoURL || "",
            source: "site",
            tag: identity.tag,
          });
        } else {
          setProfile({
            id: userId,
            name: identity.name || "User",
            photoURL: identity.photoURL || "",
            source: "site",
            tag: identity.tag,
          });
        }
      })
      .catch(() =>
        setProfile({
          id: userId,
          name: identity.name || "User",
          photoURL: identity.photoURL || "",
          source: "site",
          tag: identity.tag,
        }),
      )
      .finally(() => setProfileLoading(false));
  }, [userId, identity]);

  // Auto-clear notices
  useEffect(() => {
    if (!info && !error) return;
    const id = setTimeout(() => {
      setInfo("");
      setError("");
    }, 4000);
    return () => clearTimeout(id);
  }, [info, error]);

  const preloadRewardedAd = useCallback(
    async () => {
      const ready = await loadMonetag(15000);
      setSdkReady(ready);
      if (!ready) {
        setRewardReady(false);
        preloadedTrackingIdRef.current = "";
        return false;
      }

      const showFn = window[`show_${MONETAG_ZONE}`];
      if (typeof showFn !== "function") {
        setRewardReady(false);
        return false;
      }

      try {
        const trackingId = buildMonetagTrackingId(userId, views + 1);
        await showFn({ type: "preload", ymid: trackingId, requestVar: MONETAG_REQUEST_VAR });
        preloadedTrackingIdRef.current = trackingId;
        setRewardReady(true);
        setInfo(t.rewardReady);
        return true;
      } catch {
        preloadedTrackingIdRef.current = "";
        setRewardReady(false);
        return false;
      }
    },
    [t.rewardReady, userId, views],
  );

  useEffect(() => {
    if (views >= REQUIRED_VIEWS) return;
    if (adType !== "rewarded") {
      setRewardReady(false);
      preloadAttemptedRef.current = false;
      return;
    }
    if (preloadAttemptedRef.current) return;

    preloadAttemptedRef.current = true;
    preloadRewardedAd().finally(() => {
      preloadAttemptedRef.current = false;
    });
  }, [adType, preloadRewardedAd, views]);

  // AUTO-GRANT: when 5 ads done in site mode, auto-call grant so user is unlocked
  // even if they close Telegram without tapping the button.
  useEffect(() => {
    if (
      views >= REQUIRED_VIEWS &&
      mode === "site" &&
      userId &&
      !granted &&
      !autoGrantedRef.current
    ) {
      autoGrantedRef.current = true;
      handleGetAccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, mode, userId, granted]);

  const handleWatchAd = async () => {
    if (adRunning) return;
    if (!adType) return;
    setError("");
    setInfo("");

    // Rewarded unlock must use real successful Monetag ad only.
    if (adType !== "rewarded") {
      setError(t.realOnly);
      return;
    }

    setAdRunning(true);

    // Step 1: ensure SDK is loaded. This is the only hard requirement.
    let ready = sdkReady;
    if (!ready) {
      ready = await loadMonetag(15000);
      setSdkReady(ready);
    }

    if (!ready) {
      setAdRunning(false);
      setRewardReady(false);
      setError(t.adUnavailable);
      return;
    }

    const fnName = `show_${MONETAG_ZONE}`;
    const showFn = window[fnName];

    if (typeof showFn !== "function") {
      setAdRunning(false);
      setRewardReady(false);
      setError(t.adUnavailable);
      return;
    }

    // Step 2: try to call show directly. Per Monetag docs, preload is optional —
    // calling show_XXX() directly will fetch + display an ad in one shot.
    // This is more reliable than gating on a separate preload Promise that
    // sometimes silently never resolves inside the Telegram WebView.
    try {
      const trackingId =
        preloadedTrackingIdRef.current ||
        buildMonetagTrackingId(userId, views + 1);
      await showFn({ ymid: trackingId, requestVar: MONETAG_REQUEST_VAR });
      preloadedTrackingIdRef.current = "";
      setViews((v) => Math.min(REQUIRED_VIEWS, v + 1));
      setRewardReady(false);
      setInfo(t.counted);
      // Preload the next one in the background (non-blocking)
      preloadRewardedAd().catch(() => {});
    } catch (e) {
      preloadedTrackingIdRef.current = "";
      setRewardReady(false);
      // Real failure (no-fill / user closed early / network). Do NOT count.
      setError(t.adUnavailable);
      preloadRewardedAd().catch(() => {});
    } finally {
      setAdRunning(false);
    }
  };

  const handleGetAccess = async () => {
    if (granting) return;
    if (views < REQUIRED_VIEWS) return;

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
        if (mode === "short" && data.dest) {
          setShortDest(data.dest);
          setInfo(t.redirecting);
          setTimeout(() => {
            window.location.href = data.dest;
          }, 1500);
        } else if (mode === "api") {
          const redirectTo = data.redirectUrl || externalRedirect;
          if (redirectTo) {
            setInfo(t.redirecting);
            setTimeout(() => {
              window.location.href = redirectTo;
            }, 1500);
          }
        } else if (mode === "site" && data.fallbackToken) {
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
    <div className="min-h-screen bg-[#0a0a14] text-white relative overflow-hidden">
      {/* Decorative gradient mesh */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-32 w-[28rem] h-[28rem] rounded-full bg-fuchsia-600/25 blur-[120px]" />
        <div className="absolute top-40 -right-32 w-[26rem] h-[26rem] rounded-full bg-cyan-500/20 blur-[120px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[30rem] h-[20rem] rounded-full bg-violet-700/15 blur-[120px]" />
      </div>

      <div className="relative max-w-md mx-auto px-4 pt-4 pb-10">
        {/* Top bar — branded */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <img
                src={logoImg}
                alt="RS ANIME"
                className="w-11 h-11 rounded-xl object-cover border border-white/15 shadow-lg shadow-fuchsia-900/30"
              />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-[#0a0a14] flex items-center justify-center">
                <CheckCircle2 className="w-2.5 h-2.5 text-black" />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/50 leading-none">
                Mini App
              </div>
              <div className="text-[15px] font-bold leading-tight bg-gradient-to-r from-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
                {shortLabel || "RS ANIME ACCESS"}
              </div>
            </div>
          </div>
          <button
            onClick={() => setLang(lang === "en" ? "bn" : "en")}
            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-semibold border border-white/10 transition flex items-center gap-1"
          >
            <Globe className="w-3 h-3" />
            {lang === "en" ? "বাংলা" : "EN"}
          </button>
        </div>

        {/* USER PROFILE CARD — auto-detected from start link */}
        {/* USER PROFILE CARD — works for website, Telegram, and external API users */}
        {userId && (
          <div className="mb-4 rounded-2xl bg-gradient-to-br from-white/[0.07] to-white/[0.02] border border-white/10 p-3 flex items-center gap-3 backdrop-blur-xl">
            <div className="relative w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-fuchsia-500/40 to-cyan-500/40 flex items-center justify-center border border-white/15 flex-shrink-0">
              {profile?.photoURL ? (
                <img
                  src={profile.photoURL}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <UserIcon className="w-5 h-5 text-white/80" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-white/50 leading-none mb-0.5">
                {t.welcome}
              </div>
              {profileLoading ? (
                <div className="flex items-center gap-2 text-xs text-white/60">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t.detecting}
                </div>
              ) : profile ? (
                <>
                  <div className="text-sm font-bold truncate">
                    {profile.name}
                  </div>
                  {profile.username ? (
                    <div className="text-[10px] text-cyan-300/80 truncate">
                      @{profile.username}
                    </div>
                  ) : profile.email ? (
                    <div className="text-[10px] text-white/50 truncate">
                      {profile.email}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-xs text-rose-300 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {t.invalidUser}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mode badge */}
        {(isApiMode || isShortMode) && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-400/30 text-amber-200 text-xs flex items-center gap-2">
            <Lock className="w-3.5 h-3.5" />
            {isShortMode
              ? `${shortLabel || "External"} link · unlock after 5 ads`
              : t.apiMode}
          </div>
        )}

        {/* Granted state */}
        {granted ? (
          <div className="rounded-3xl bg-gradient-to-br from-emerald-500/15 via-cyan-500/10 to-transparent border border-emerald-400/30 p-6 text-center backdrop-blur-xl">
            <div className="relative inline-block mb-4">
              <div className="absolute inset-0 bg-emerald-400 blur-2xl opacity-40" />
              <CheckCircle2 className="relative w-16 h-16 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-extrabold mb-2">{t.granted}</h2>
            <p className="text-white/70 text-sm mb-5">{t.grantedDesc}</p>
            {info && <p className="text-cyan-300 text-xs mb-3">{info}</p>}

            {mode === "short" && shortDest && (
              <a
                href={shortDest}
                className="block w-full py-3 mb-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-400 text-black font-bold shadow-lg hover:scale-[1.02] active:scale-[0.98] transition"
              >
                <ExternalLink className="inline w-4 h-4 mr-2" />
                {t.openShortDest}
              </a>
            )}

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
            {/* Hero title */}
            <div className="mb-5">
              <h1 className="text-[26px] font-extrabold leading-tight tracking-tight bg-gradient-to-r from-white via-fuchsia-100 to-cyan-100 bg-clip-text text-transparent">
                {t.title}
              </h1>
              <p className="text-white/55 text-[13px] mt-1">{t.subtitle}</p>
            </div>

            {/* Trust badges */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 text-center">
                <Shield className="w-4 h-4 mx-auto mb-1 text-emerald-300" />
                <div className="text-[10px] font-semibold text-white/80">
                  {t.secure}
                </div>
              </div>
              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 text-center">
                <Zap className="w-4 h-4 mx-auto mb-1 text-amber-300" />
                <div className="text-[10px] font-semibold text-white/80">
                  {t.fast}
                </div>
              </div>
              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 text-center">
                <Sparkles className="w-4 h-4 mx-auto mb-1 text-fuchsia-300" />
                <div className="text-[10px] font-semibold text-white/80">
                  {t.free}
                </div>
              </div>
            </div>

            {/* Progress card */}
            <div className="rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/10 p-4 mb-5 backdrop-blur-xl">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[11px] uppercase tracking-wider text-white/55 font-semibold flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  {t.progress}
                </span>
                <span className="text-base font-extrabold tabular-nums">
                  <span className="text-emerald-400">{views}</span>
                  <span className="text-white/40"> / {REQUIRED_VIEWS}</span>
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-400 transition-all duration-700 shadow-[0_0_12px_rgba(217,70,239,0.6)]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 gap-1">
                {Array.from({ length: REQUIRED_VIEWS }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 h-1.5 rounded-full transition-all ${
                      i < views
                        ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                        : "bg-white/10"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Ad type chooser */}
            {!adType && views < REQUIRED_VIEWS && (
              <>
                <div className="text-xs font-semibold text-white/70 mb-2 uppercase tracking-wider">
                  {t.chooseAd}
                </div>
                <div className="grid grid-cols-1 gap-2.5 mb-5">
                  <button
                    onClick={() => setAdType("rewarded")}
                    className="text-left p-3.5 rounded-2xl bg-gradient-to-br from-fuchsia-500/15 to-purple-600/5 border border-fuchsia-400/30 hover:border-fuchsia-300/60 transition group active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600 flex items-center justify-center shadow-lg shadow-fuchsia-500/40">
                        <Play className="w-5 h-5 text-white" fill="white" />
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-[14px]">{t.rewarded}</div>
                        <div className="text-[11px] text-white/55 mt-0.5 leading-snug">
                          {t.rewardedDesc}
                        </div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-white/30 group-hover:text-white/80 transition" />
                    </div>
                  </button>
                </div>
              </>
            )}

            {/* Watch ad button */}
            {adType && views < REQUIRED_VIEWS && (
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wider text-white/55 font-semibold">
                    {t.rewarded}
                    {!sdkReady && (
                      <span className="ml-2 text-amber-300 normal-case tracking-normal">
                        · {t.sdkLoading}
                      </span>
                    )}
                    {sdkReady && rewardReady && (
                      <span className="ml-2 text-emerald-300 normal-case tracking-normal">
                        · {t.rewardReady}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => setAdType(null)}
                    className="text-[11px] text-white/50 hover:text-white"
                  >
                    Change
                  </button>
                </div>
                <button
                  onClick={handleWatchAd}
                  disabled={adRunning}
                  className="relative w-full py-4 rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-400 text-black font-extrabold text-base shadow-xl shadow-fuchsia-500/40 hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-60 disabled:hover:scale-100 flex items-center justify-center gap-2 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                  {adRunning ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" /> {t.watching}
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5" fill="black" /> {t.watchAd} (
                      {views + 1}/{REQUIRED_VIEWS})
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
                className="w-full py-4 mb-5 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-400 text-black font-extrabold text-base shadow-xl shadow-emerald-500/50 hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center gap-2"
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

            {/* About card */}
            <div className="rounded-2xl bg-gradient-to-br from-fuchsia-500/5 to-cyan-500/5 border border-white/10 p-4 mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <img src={logoImg} alt="" className="w-5 h-5 rounded" />
                <div className="text-sm font-bold">{t.aboutTitle}</div>
              </div>
              <p className="text-[11.5px] text-white/60 leading-relaxed">
                {t.aboutDesc}
              </p>
            </div>

            {/* Rules */}
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 text-[11.5px] text-white/65 space-y-1.5 leading-relaxed">
              <div className="font-bold text-white/85 mb-1.5 text-xs uppercase tracking-wider">
                {lang === "en" ? "Rules" : "নিয়মাবলি"}
              </div>
              <div className="flex gap-1.5"><span className="text-fuchsia-400">•</span>{t.rule1}</div>
              <div className="flex gap-1.5"><span className="text-fuchsia-400">•</span>{t.rule2}</div>
              <div className="flex gap-1.5"><span className="text-fuchsia-400">•</span>{t.rule3}</div>
              <div className="flex gap-1.5"><span className="text-fuchsia-400">•</span>{t.rule4}</div>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
