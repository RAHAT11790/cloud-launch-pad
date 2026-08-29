// ============================================================
// RS Anime — Ad Blocker Removed confirmation (EN / বাংলা / हिन्दी)
// ============================================================
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Play } from "lucide-react";
import { takeReturnPath } from "@/lib/adBlockGate";

type Lang = "en" | "bn" | "hi";

const COPY: Record<Lang, { label: string; title: string; body: string; cta: string; auto: (s: number) => string }> = {
  en: {
    label: "English",
    title: "Thank you! Ads are working again",
    body: "Your ad blocker is off. Enjoy RS Anime — every ad you see keeps the site free for everyone.",
    cta: "Continue Watching",
    auto: (s) => `Returning in ${s}s…`,
  },
  bn: {
    label: "বাংলা",
    title: "ধন্যবাদ! বিজ্ঞাপন আবার কাজ করছে",
    body: "আপনার অ্যাড ব্লকার বন্ধ হয়েছে। RS Anime উপভোগ করুন — আপনার দেখা প্রতিটি বিজ্ঞাপনই সাইটটিকে ফ্রি রাখে।",
    cta: "দেখা চালিয়ে যান",
    auto: (s) => `${s} সেকেন্ডে ফিরে যাচ্ছে…`,
  },
  hi: {
    label: "हिन्दी",
    title: "धन्यवाद! विज्ञापन फिर से चल रहे हैं",
    body: "आपका ऐड ब्लॉकर बंद है। RS Anime का आनंद लें — हर विज्ञापन साइट को सबके लिए मुफ़्त रखता है।",
    cta: "देखना जारी रखें",
    auto: (s) => `${s} सेकंड में वापस…`,
  },
};

const AdBlockerRemoved = () => {
  const nav = useNavigate();
  const [lang, setLang] = useState<Lang>(() => {
    const n = (navigator.language || "").toLowerCase();
    if (n.startsWith("bn")) return "bn";
    if (n.startsWith("hi")) return "hi";
    return "en";
  });
  const [left, setLeft] = useState(4);
  const t = COPY[lang];

  const go = () => nav(takeReturnPath(), { replace: true });

  useEffect(() => {
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { if (left <= 0) go(); /* eslint-disable-next-line */ }, [left]);

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card/80 backdrop-blur-xl shadow-2xl p-8 text-center">
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

        <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto mb-4">
          <ShieldCheck className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">{t.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{t.body}</p>

        <button
          onClick={go}
          className="mt-6 w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2"
        >
          <Play className="w-5 h-5" />
          {t.cta}
        </button>
        <p className="mt-3 text-xs text-muted-foreground">{t.auto(Math.max(0, left))}</p>
      </div>
    </main>
  );
};

export default AdBlockerRemoved;
