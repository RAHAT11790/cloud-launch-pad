import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, MessageCircle, LifeBuoy, ExternalLink } from "lucide-react";
import { db, ref, onValue } from "@/lib/firebase";

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

// Subtle tint dot per button — main styling stays on-brand
const dotColor = (color?: string) => {
  switch (color) {
    case "purple": return "bg-purple-400";
    case "green":  return "bg-emerald-400";
    case "pink":   return "bg-pink-400";
    case "orange": return "bg-orange-400";
    default:       return "bg-sky-400";
  }
};

const TelegramWelcomeModal = () => {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<TgWelcomeConfig | null>(null);

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

            {/* Header — compact brand accent */}
            <div className="pt-5 pb-3 px-5 text-center">
              <div
                className="mx-auto w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)",
                  boxShadow: "0 8px 24px -8px hsl(var(--primary) / 0.6)",
                }}
              >
                <Send className="w-5 h-5 text-primary-foreground -mr-0.5" strokeWidth={2.4} />
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
                  className="group flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 bg-secondary/60 hover:bg-secondary border border-border/50 hover:border-primary/40 transition-colors"
                >
                  <span className="w-8 h-8 rounded-lg bg-background/70 border border-border/50 flex items-center justify-center text-foreground/80 flex-shrink-0 relative">
                    {iconFor(b.icon)}
                    <span className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${dotColor(b.color)}`} />
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
