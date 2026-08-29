// ============================================================
// RS Anime — Ad Blocker Detected gate (EN / বাংলা / हिन्दी)
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert, RefreshCw, X, Loader2, CheckCircle2, Globe, Wifi, Chrome, Smartphone } from "lucide-react";
import { getGateState, recheckAndClear, subscribeGate, CLEARED_PATH } from "@/lib/adBlockGate";

type Lang = "en" | "bn" | "hi";

const COPY: Record<Lang, {
  label: string;
  title: string;
  subtitle: string;
  why: string;
  whyBody: string;
  stepsTitle: string;
  steps: { icon: "ext" | "dns" | "vpn" | "browser"; head: string; body: string }[];
  recheck: string;
  checking: string;
  close: string;
  stillBlocked: string;
  evidence: string;
}> = {
  en: {
    label: "English",
    title: "Ad Blocker Detected",
    subtitle: "RS Anime is free because of ads. Please turn off your ad blocker, DNS filter or VPN filtering to continue watching.",
    why: "Why am I seeing this?",
    whyBody: "Our servers can reach the ad network, but your device cannot. That means something on your side — an extension, a filtering DNS, a VPN or a blocking browser — is stopping it.",
    stepsTitle: "How to fix it",
    steps: [
      { icon: "ext", head: "Disable the extension", body: "uBlock Origin / AdBlock / AdGuard / Ghostery — click the icon and choose “Disabled on this site”, then reload." },
      { icon: "dns", head: "Turn off filtering DNS", body: "Android: Settings → Network → Private DNS → set to Automatic/Off. Remove AdGuard DNS, NextDNS, ControlD or Pi-hole." },
      { icon: "vpn", head: "Turn off blocking VPN", body: "VPNs with built-in ad blocking (AdGuard VPN, 1.1.1.1 for Families, Blokada) must be switched off." },
      { icon: "browser", head: "Use a normal browser", body: "Brave / Opera / UC / Kiwi block ads by default. Open the site in Chrome, or turn Shields off for this site." },
    ],
    recheck: "Re-Check Now",
    checking: "Verifying…",
    close: "Close Site",
    stillBlocked: "Still blocked. Please complete the steps above and re-check.",
    evidence: "Detection details",
  },
  bn: {
    label: "বাংলা",
    title: "অ্যাড ব্লকার শনাক্ত হয়েছে",
    subtitle: "RS Anime বিজ্ঞাপনের কারণেই ফ্রি। দেখতে চাইলে আপনার অ্যাড ব্লকার, DNS ফিল্টার বা VPN ফিল্টারিং বন্ধ করুন।",
    why: "কেন এই পেজ দেখছি?",
    whyBody: "আমাদের সার্ভার অ্যাড নেটওয়ার্কে পৌঁছাতে পারছে, কিন্তু আপনার ডিভাইস পারছে না। অর্থাৎ আপনার দিক থেকে কোনো এক্সটেনশন, ফিল্টারিং DNS, VPN বা ব্লকিং ব্রাউজার এটি আটকাচ্ছে।",
    stepsTitle: "কীভাবে ঠিক করবেন",
    steps: [
      { icon: "ext", head: "এক্সটেনশন বন্ধ করুন", body: "uBlock Origin / AdBlock / AdGuard / Ghostery — আইকনে ক্লিক করে “Disabled on this site” দিন, তারপর রিলোড করুন।" },
      { icon: "dns", head: "ফিল্টারিং DNS বন্ধ করুন", body: "Android: Settings → Network → Private DNS → Automatic/Off করুন। AdGuard DNS, NextDNS, ControlD বা Pi-hole সরিয়ে দিন।" },
      { icon: "vpn", head: "ব্লকিং VPN বন্ধ করুন", body: "যেসব VPN-এ অ্যাড ব্লকিং আছে (AdGuard VPN, 1.1.1.1 for Families, Blokada) সেগুলো বন্ধ রাখুন।" },
      { icon: "browser", head: "সাধারণ ব্রাউজার ব্যবহার করুন", body: "Brave / Opera / UC / Kiwi ডিফল্টে অ্যাড ব্লক করে। Chrome-এ ওপেন করুন অথবা এই সাইটের জন্য Shields বন্ধ করুন।" },
    ],
    recheck: "আবার চেক করুন",
    checking: "যাচাই করা হচ্ছে…",
    close: "সাইট বন্ধ করুন",
    stillBlocked: "এখনো ব্লক করা আছে। উপরের ধাপগুলো শেষ করে আবার চেক করুন।",
    evidence: "শনাক্তকরণের বিস্তারিত",
  },
  hi: {
    label: "हिन्दी",
    title: "ऐड ब्लॉकर मिला है",
    subtitle: "RS Anime विज्ञापनों की वजह से मुफ़्त है। देखने के लिए अपना ऐड ब्लॉकर, DNS फ़िल्टर या VPN फ़िल्टरिंग बंद करें।",
    why: "यह पेज क्यों दिख रहा है?",
    whyBody: "हमारा सर्वर ऐड नेटवर्क तक पहुँच पा रहा है, पर आपका डिवाइस नहीं। यानी आपकी तरफ़ कोई एक्सटेंशन, फ़िल्टरिंग DNS, VPN या ब्लॉकिंग ब्राउज़र इसे रोक रहा है।",
    stepsTitle: "कैसे ठीक करें",
    steps: [
      { icon: "ext", head: "एक्सटेंशन बंद करें", body: "uBlock Origin / AdBlock / AdGuard / Ghostery — आइकन पर क्लिक करके “Disabled on this site” चुनें, फिर रीलोड करें।" },
      { icon: "dns", head: "फ़िल्टरिंग DNS बंद करें", body: "Android: Settings → Network → Private DNS → Automatic/Off करें। AdGuard DNS, NextDNS, ControlD या Pi-hole हटाएँ।" },
      { icon: "vpn", head: "ब्लॉकिंग VPN बंद करें", body: "ऐड ब्लॉकिंग वाले VPN (AdGuard VPN, 1.1.1.1 for Families, Blokada) बंद रखें।" },
      { icon: "browser", head: "सामान्य ब्राउज़र इस्तेमाल करें", body: "Brave / Opera / UC / Kiwi डिफ़ॉल्ट रूप से ऐड ब्लॉक करते हैं। Chrome में खोलें या इस साइट के लिए Shields बंद करें।" },
    ],
    recheck: "फिर से जाँचें",
    checking: "जाँच हो रही है…",
    close: "साइट बंद करें",
    stillBlocked: "अभी भी ब्लॉक है। ऊपर के चरण पूरे करके फिर जाँचें।",
    evidence: "डिटेक्शन विवरण",
  },
};

const StepIcon = ({ kind }: { kind: "ext" | "dns" | "vpn" | "browser" }) => {
  const cls = "w-5 h-5 text-primary";
  if (kind === "dns") return <Globe className={cls} />;
  if (kind === "vpn") return <Wifi className={cls} />;
  if (kind === "browser") return <Chrome className={cls} />;
  return <Smartphone className={cls} />;
};

const AdBlockerDetected = () => {
  const nav = useNavigate();
  const [lang, setLang] = useState<Lang>(() => {
    const n = (navigator.language || "").toLowerCase();
    if (n.startsWith("bn")) return "bn";
    if (n.startsWith("hi")) return "hi";
    return "en";
  });
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [signals, setSignals] = useState(getGateState().signals);

  const t = COPY[lang];

  useEffect(() => {
    const off = subscribeGate((s) => setSignals(s.signals));
    return () => { off(); };
  }, []);
  useEffect(() => { document.title = `${t.title} · RS Anime`; }, [t.title]);

  const reasons = useMemo(() => signals?.reasons ?? [], [signals]);

  const onRecheck = async () => {
    setChecking(true);
    setFailed(false);
    const clean = await recheckAndClear();
    setChecking(false);
    if (clean) nav(CLEARED_PATH, { replace: true });
    else setFailed(true);
  };

  const onClose = () => {
    try { window.close(); } catch { /* ignore */ }
    setTimeout(() => { window.location.href = "about:blank"; }, 150);
  };

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="relative rounded-3xl border border-border bg-card/80 backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-destructive via-primary to-destructive" />

          <div className="p-6 sm:p-8">
            {/* Language switch */}
            <div className="flex justify-center gap-1 p-1 rounded-full bg-muted/60 w-fit mx-auto mb-6">
              {(Object.keys(COPY) as Lang[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setLang(k)}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                    lang === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {COPY[k].label}
                </button>
              ))}
            </div>

            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-destructive/15 border border-destructive/30 flex items-center justify-center mb-4">
                <ShieldAlert className="w-8 h-8 text-destructive" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t.title}</h1>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{t.subtitle}</p>
            </div>

            <div className="mt-6 rounded-2xl bg-muted/40 border border-border p-4">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide">{t.why}</p>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{t.whyBody}</p>
            </div>

            <div className="mt-6">
              <p className="text-sm font-bold mb-3">{t.stepsTitle}</p>
              <ul className="space-y-3">
                {t.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 rounded-xl border border-border bg-background/60 p-3">
                    <div className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <StepIcon kind={s.icon} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{s.head}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {failed && (
              <p className="mt-5 text-center text-sm font-medium text-destructive">{t.stillBlocked}</p>
            )}

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                onClick={onRecheck}
                disabled={checking}
                className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity"
              >
                {checking ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                {checking ? t.checking : t.recheck}
              </button>
              <button
                onClick={onClose}
                className="sm:w-40 h-12 rounded-xl border border-border bg-muted/50 text-foreground font-semibold flex items-center justify-center gap-2 hover:bg-muted transition-colors"
              >
                <X className="w-5 h-5" />
                {t.close}
              </button>
            </div>

            {reasons.length > 0 && (
              <details className="mt-5 group">
                <summary className="text-xs text-muted-foreground cursor-pointer select-none">{t.evidence}</summary>
                <ul className="mt-2 space-y-1">
                  {reasons.map((r, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground flex gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-destructive shrink-0 mt-px" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </div>
    </main>
  );
};

export default AdBlockerDetected;
