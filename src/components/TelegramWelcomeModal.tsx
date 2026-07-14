import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, MessageCircle, LifeBuoy, ExternalLink, Users, Bell } from "lucide-react";
import { db, ref, onValue } from "@/lib/firebase";

// Official Telegram paper-plane logo (SVG, brand blue gradient)
const TelegramLogo = ({ className = "w-7 h-7" }: { className?: string }) => (
  <svg viewBox="0 0 240 240" className={className} xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="tg-brand" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#37bbfe" />
        <stop offset="1" stopColor="#007dbb" />
      </linearGradient>
    </defs>
    <circle cx="120" cy="120" r="120" fill="url(#tg-brand)" />
    <path
      fill="#fff"
      d="M81.2 128.9l-27.6-8.6c-6-1.9-6-6 1.3-8.9l107.6-41.5c5-2 9.8 1.2 7.9 8.9l-18.3 86.3c-1.3 6.2-5 7.7-10 4.8l-27.5-20.3-13.3 12.8c-1.5 1.5-2.7 2.7-5.5 2.7l1.9-27.9 50.8-45.9c2.2-2-.5-3-3.4-1.1l-62.8 39.6z"
    />
  </svg>
);

// ============================================================
// TelegramWelcomeModal — compact, centered, on-brand (amber/gold)
// Shown once per device (localStorage-gated).
// Admin-editable via settings/telegramWelcome.
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
  { id: "channel", title: "Update Channel", subtitle: "New episodes & releases", url: "https://t.me/CARTOONFUNNY03", color: "blue", icon: "send", order: 1 },
  { id: "group",   title: "Chat Group",     subtitle: "Community & requests",    url: "https://t.me/hindianime03",   color: "purple", icon: "chat", order: 2 },
  { id: "support", title: "Support",        subtitle: "Report an issue",         url: "https://t.me/rs_woner",        color: "green", icon: "support", order: 3 },
];

const STORAGE_KEY = "rs_tg_welcome_seen_v1";

const iconFor = (name?: string) => {
  const cls = "w-4 h-4";
  switch (name) {
    case "chat":    return <MessageCircle className={cls} strokeWidth={2.4} />;
    case "support": return <LifeBuoy className={cls} strokeWidth={2.4} />;
    case "link":    return <ExternalLink className={cls} strokeWidth={2.4} />;
    default:        return <Send className={cls} strokeWidth={2.4} />;
  }
};

// Vivid gradient tint per button
const iconGradient = (color?: string) => {
  switch (color) {
    case "purple": return "linear-gradient(135deg,#8b5cf6,#6d28d9)";
    case "green":  return "linear-gradient(135deg,#10b981,#047857)";
    case "pink":   return "linear-gradient(135deg,#ec4899,#be185d)";
    case "orange": return "linear-gradient(135deg,#fb923c,#c2410c)";
    default:       return "linear-gradient(135deg,#38bdf8,#0369a1)";
  }
};

const CYCLE_ICONS = [
  { Icon: Bell, color: "#fbbf24" },
  { Icon: Users, color: "#a78bfa" },
  { Icon: MessageCircle, color: "#34d399" },
];

const TelegramWelcomeModal = () => {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<TgWelcomeConfig | null>(null);
  const [cycleIdx, setCycleIdx] = useState(0);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setCycleIdx((i) => (i + 1) % CYCLE_ICONS.length), 1800);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch { return; }

    const unsub = onValue(ref(db, "settings/telegramWelcome"), (snap) => {
      const val = (snap.val() || {}) as TgWelcomeConfig;
      setConfig(val);
      if (val?.enabled !== false) {
        setTimeout(() => setOpen(true), 500);
      }
    });
    return () => unsub();
  }, []);

  const close = () => {
    setOpen(false);
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
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

  const heading = config?.heading?.trim() || "Join our Telegram";
  const description =
    config?.description?.trim() ||
    "Get instant updates for new episodes, movies & releases.";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-[6px] p-4"
          onClick={close}
          style={{ willChange: "opacity" }}
        >
          <motion.div
            initial={{ y: 12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 8, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[340px] rounded-2xl overflow-hidden border border-border/60 bg-card shadow-2xl"
            style={{
              willChange: "transform, opacity",
              boxShadow: "0 20px 60px -20px rgba(0,0,0,0.6), 0 0 0 1px hsl(var(--primary) / 0.08)",
            }}
          >
            {/* Close */}
            <button
              onClick={close}
              aria-label="Close"
              className="absolute top-2.5 right-2.5 z-10 w-7 h-7 rounded-full bg-background/60 hover:bg-background border border-border/60 flex items-center justify-center text-foreground/70 hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>

            {/* Header — real Telegram logo + cycling secondary badge */}
            <div className="pt-6 pb-3 px-5 text-center relative">
              {/* soft brand glow */}
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-24 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(60% 100% at 50% 0%, rgba(55,187,254,0.18) 0%, transparent 70%)",
                }}
              />
              <div className="relative mx-auto w-16 h-16 mb-3">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{ boxShadow: "0 10px 30px -8px rgba(0,125,187,0.55)" }}
                />
                <TelegramLogo className="w-16 h-16 relative" />
                {/* Cycling side badge */}
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-card border-2 border-card shadow-lg overflow-hidden">
                  <AnimatePresence mode="wait">
                    {(() => {
                      const { Icon, color } = CYCLE_ICONS[cycleIdx];
                      return (
                        <motion.div
                          key={cycleIdx}
                          initial={{ y: 12, opacity: 0, scale: 0.7 }}
                          animate={{ y: 0, opacity: 1, scale: 1 }}
                          exit={{ y: -12, opacity: 0, scale: 0.7 }}
                          transition={{ duration: 0.28, ease: "easeOut" }}
                          className="absolute inset-0 flex items-center justify-center rounded-full"
                          style={{ background: `${color}22` }}
                        >
                          <Icon className="w-3.5 h-3.5" style={{ color }} strokeWidth={2.6} />
                        </motion.div>
                      );
                    })()}
                  </AnimatePresence>
                </div>
              </div>
              <h2 className="text-foreground text-[15px] font-bold leading-tight">
                {heading}
              </h2>
              <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                {description}
              </p>
            </div>

            {/* Buttons */}
            <div className="px-4 pb-4 space-y-1.5">
              {buttons.map((b) => (
                <a
                  key={b.id}
                  href={b.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 bg-secondary/60 hover:bg-secondary border border-border/50 hover:border-primary/50 transition-colors"
                >
                  <span
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-white flex-shrink-0 shadow-md"
                    style={{ background: iconGradient(b.color) }}
                  >
                    {iconFor(b.icon)}
                  </span>
                  <span className="flex-1 text-left leading-tight min-w-0">
                    <span className="block text-[12.5px] font-semibold text-foreground truncate">{b.title}</span>
                    {b.subtitle && (
                      <span className="block text-[10.5px] text-muted-foreground truncate">{b.subtitle}</span>
                    )}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors" />
                </a>
              ))}

              <button
                onClick={close}
                className="mt-2 w-full rounded-xl border border-border/50 bg-transparent hover:bg-secondary/60 text-muted-foreground hover:text-foreground text-[12px] font-medium py-2 transition-colors"
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
