import { useState, useEffect, useRef } from "react";
import { Bell, Check, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { db, ref, onValue, set, update } from "@/lib/firebase";

interface NotifItem {
  id: string;
  title: string;
  message: string;
  type?: string;
  contentId?: string;
  image?: string;
  read: boolean;
  timestamp: number;
}

interface NotificationPanelProps {
  userId?: string;
  onOpenContent?: (contentId: string) => void;
}

const NotificationPanel = ({ userId, onOpenContent }: NotificationPanelProps) => {
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [showFullPage, setShowFullPage] = useState(false);
  const knownRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) { setNotifications([]); return; }
    const unsub = onValue(ref(db, `notifications/${userId}`), (snap) => {
      const data = snap.val();
      if (!data) { setNotifications([]); knownRef.current = new Set(); return; }
      const items: NotifItem[] = Object.entries(data).map(([id, item]: [string, any]) => ({
        id,
        title: item.title || "",
        message: item.message || "",
        type: item.type || "",
        contentId: item.contentId || "",
        image: item.image || item.poster || "",
        read: !!item.read,
        timestamp: item.timestamp || Date.now(),
      })).sort((a, b) => b.timestamp - a.timestamp);
      knownRef.current = new Set(items.map((i) => i.id));
      setNotifications(items);
    });
    return () => unsub();
  }, [userId]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = () => {
    if (!userId) return;
    const updates: Record<string, boolean> = {};
    notifications.forEach((n) => { if (!n.read) updates[`notifications/${userId}/${n.id}/read`] = true; });
    if (Object.keys(updates).length) update(ref(db), updates);
  };

  const openNotif = (n: NotifItem) => {
    if (!n.read && userId) set(ref(db, `notifications/${userId}/${n.id}/read`), true);
    setShowFullPage(false);
    if (n.contentId && onOpenContent) onOpenContent(n.contentId);
  };

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "Just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <>
      <button
        onClick={() => setShowFullPage(true)}
        className="relative w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
        style={{ boxShadow: "var(--neu-shadow-sm)", background: "hsl(var(--secondary))" }}
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4 text-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center px-1 animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {showFullPage && (
          <motion.div
            key="notif-panel"
            className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.25 }}
          >
            <div className="flex items-center justify-between mb-5">
              <button onClick={() => setShowFullPage(false)} className="flex items-center gap-2 text-sm hover:text-primary transition-colors">
                <ArrowLeft className="w-5 h-5" />
                <span className="font-semibold">Notifications</span>
              </button>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                  <Check className="w-3 h-3" /> Mark all read
                </button>
              )}
            </div>
            <div className="space-y-2">
              {notifications.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No notifications yet</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => openNotif(n)}
                    className={`px-4 py-3 rounded-xl cursor-pointer transition-all ${!n.read ? "bg-primary/5 border border-primary/30" : "bg-secondary"}`}
                    style={{ boxShadow: "var(--neu-shadow-sm)" }}
                  >
                    <div className="flex items-start gap-3">
                      {n.image ? (
                        <img src={n.image} alt="" className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        !n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {!n.read && n.image && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                          <p className="text-sm font-semibold leading-tight truncate">{n.title}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-primary/70 mt-1">{timeAgo(n.timestamp)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default NotificationPanel;
