import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, MessageCircle, LifeBuoy, ExternalLink } from "lucide-react";
import { db, ref, onValue } from "@/lib/firebase";

// ============================================================
// TelegramWelcomeModal
// Shows once per browser (localStorage-gated) on very first site visit.
// Buttons + copy pulled from Firebase: settings/telegramWelcome
// Admin-controlled via Admin → Settings → "Telegram Welcome Popup"
// ============================================================

export type TgWelcomeButton = {
  id: string;
  title: string;
  subtitle?: string;
  url: string;
  color?: "blue" | "purple" | "green" | "pink" | "orange";
  icon?: "send" | "chat" | "support" | "link";
  order?: number;
};

export type TgWelcomeConfig = {
  enabled?: boolean;
  heading?: string;
  description?: string;
  buttons?: Record<string, TgWelcomeButton> | TgWelcomeButton[];
};

export const DEFAULT_TG_WELCOME_BUTTONS: TgWelcomeButton[] = [
  { id: "channel", title: "Update Channel", subtitle: "New episode & release alerts", url: "https://t.me/CARTOONFUNNY03", color: "blue", icon: "send", order: 1 },
  { id: "group",   title: "Join Chat Group", subtitle: "Chat with community & requests",  url: "https://t.me/hindianime03",  color: "purple", icon: "chat", order: 2 },
  { id: "support", title: "Contact Support", subtitle: "Report an issue or get help",      url: "https://t.me/rs_woner",       color: "green", icon: "support", order: 3 },
];

const STORAGE_KEY = "rs_tg_welcome_seen_v1";

const iconFor = (name?: string) => {
  switch (name) {
    case "chat":    return <MessageCircle className="w-5 h-5" strokeWidth={2.4} />;
    case "support": return <LifeBuoy className="w-5 h-5" strokeWidth={2.4} />;
    case "link":    return <ExternalLink className="w-5 h-5" strokeWidth={2.4} />;
    case "send":
    default:        return <Send className="w-5 h-5" strokeWidth={2.4} />;
  }
};

const gradientFor = (color?: string) => {
  switch (color) {
    case "purple": return "from-[#5a2ea6] via-[#6a2fbf] to-[#8b3ff5]";
    case "green":  return "from-[#0f9b6a] via-[#12a875] to-[#18c98a]";
    case "pink":   return "from-[#c2185b] via-[#d81b60] to-[#ec407a]";
    case "orange": return "from-[#e65100] via-[#f57c00] to-[#ff9800]";
    case "blue":
    default:       return "from-[#0369a1] via-[#0284c7] to-[#0ea5e9]";
  }
};

const TelegramWelcomeModal = () => {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<TgWelcomeConfig | null>(null);

  useEffect(() => {
    // Only show if never seen before on this device.
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch { return; }

    const unsub = onValue(ref(db, "settings/telegramWelcome"), (snap) => {
      const val = (snap.val() || {}) as TgWelcomeConfig;
      setConfig(val);
      const enabled = val?.enabled !== false; // default ON
      if (enabled) {
        // small delay for smoother splash → modal transition
        setTimeout(() => setOpen(true), 600);
      }
    });
    return () => unsub();
  }, []);

  const close = (persist: boolean) => {
    setOpen(false);
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    }
  };

  const buttons: TgWelcomeButton[] = (() => {
    const raw = config?.buttons;
    let list: TgWelcomeButton[] = [];
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === "object") list = Object.values(raw);
    if (!list.length) list = DEFAULT_TG_WELCOME_BUTTONS;
    return list
      .filter((b) => b && b.url && b.title)
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  })();

  const heading = config?.heading?.trim() || "Join our Telegram community";
  const description =
    config?.description?.trim() ||
    "Get instant notifications for every new episode, movie & series update. Direct download links, exclusive posts and everything about the site — all delivered to your Telegram.";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-3 pb-4 sm:pb-3"
          onClick={() => close(true)}
        >
          <motion.div
            initial={{ y: 60, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 40, scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-3xl overflow-hidden border border-white/10 shadow-2xl"
            style={{
              background: "linear-gradient(180deg, #0b0f1e 0%, #0a0d18 60%, #06070d 100%)",
            }}
          >
            {/* Close (X) — does NOT persist "seen" so user can see it next open too? 
                Requirement: two close functions. Keep both persistent for one-per-device rule. */}
            <button
              onClick={() => close(true)}
              aria-label="Close"
              className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 border border-white/10 flex items-center justify-center text-white/90 transition"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Hero — neon telegram illustration */}
            <div className="relative h-52 sm:h-56 overflow-hidden">
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(ellipse at 50% 60%, rgba(30,144,255,0.35) 0%, rgba(88,45,180,0.35) 40%, rgba(0,0,0,0.9) 80%)",
                }}
              />
              {/* stars */}
              <div className="absolute inset-0 opacity-70" style={{
                backgroundImage:
                  "radial-gradient(1px 1px at 20% 30%, #ffffff 50%, transparent 51%)," +
                  "radial-gradient(1px 1px at 70% 20%, #b3e5fc 50%, transparent 51%)," +
                  "radial-gradient(1.5px 1.5px at 45% 70%, #ffffff 50%, transparent 51%)," +
                  "radial-gradient(1px 1px at 85% 55%, #81d4fa 50%, transparent 51%)," +
                  "radial-gradient(1px 1px at 10% 65%, #ffffff 50%, transparent 51%)," +
                  "radial-gradient(1.5px 1.5px at 60% 40%, #4fc3f7 50%, transparent 51%)",
              }} />
              {/* neon paper plane circle */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <div className="relative">
                  <div className="w-24 h-24 rounded-full border-2 border-cyan-300 flex items-center justify-center"
                       style={{ boxShadow: "0 0 30px rgba(6,182,212,0.75), inset 0 0 20px rgba(6,182,212,0.35)" }}>
                    <Send className="w-11 h-11 text-cyan-200 -mr-1 -mt-1" strokeWidth={1.6}
                          style={{ filter: "drop-shadow(0 0 6px rgba(6,182,212,0.9))" }} />
                  </div>
                </div>
                <div className="text-3xl sm:text-4xl font-black tracking-[0.25em] text-transparent bg-clip-text"
                     style={{
                       backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 100%)",
                       WebkitTextStroke: "0.5px rgba(255,255,255,0.15)",
                     }}>
                  TELEGRAM
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-5 pt-4 pb-5">
              <h2 className="text-white text-xl sm:text-[22px] font-extrabold text-center leading-tight">
                {heading}
              </h2>
              <p className="mt-2 text-center text-[13px] leading-relaxed text-white/60">
                {description}
              </p>

              {/* Buttons */}
              <div className="mt-4 space-y-2.5">
                {buttons.map((b) => (
                  <a
                    key={b.id}
                    href={b.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group flex items-center gap-3 w-full rounded-2xl px-4 py-3 text-white font-semibold text-[14px]
                      bg-gradient-to-r ${gradientFor(b.color)} shadow-[0_6px_20px_-8px_rgba(0,0,0,0.9)]
                      border border-white/10 hover:brightness-110 active:scale-[0.98] transition`}
                  >
                    <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
                      {iconFor(b.icon)}
                    </span>
                    <span className="flex-1 text-left leading-tight">
                      <span className="block">{b.title}</span>
                      {b.subtitle && (
                        <span className="block text-[11px] font-normal text-white/75 mt-0.5">
                          {b.subtitle}
                        </span>
                      )}
                    </span>
                  </a>
                ))}
              </div>

              {/* Already joined */}
              <button
                onClick={() => close(true)}
                className="mt-3 w-full rounded-2xl border border-white/12 bg-white/[0.03] hover:bg-white/[0.07]
                           text-white/80 font-semibold text-[14px] py-3 transition"
              >
                Already joined
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TelegramWelcomeModal;
