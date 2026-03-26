import { useState, useEffect, useRef } from "react";
import { Bell, X, Check, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { db, ref, onValue, set, update } from "@/lib/firebase";
import { SITE_ICON_URL } from "@/lib/siteConfig";

// Request notification permission and register FCM SW
const requestNotificationPermission = async () => {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  try {
    await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
  } catch {}
};

// Show browser notification (foreground only) with duplicate guard
const showBrowserNotification = (title: string, body: string, contentId?: string, image?: string): boolean => {
  try {
    const pushPref = localStorage.getItem("rs_notif_push");
    if (pushPref === "false") return false;
  } catch {}

  if (!("Notification" in window) || Notification.permission !== "granted") return false;

  try {
    const options = {
      body,
      icon: SITE_ICON_URL,
      badge: SITE_ICON_URL,
      image: image || undefined,
      tag: contentId ? `rsanime-${contentId}` : `rsanime-${Date.now()}`,
      data: { url: contentId ? `/?anime=${contentId}` : "/" },
      vibrate: [200, 100, 200],
      requireInteraction: false,
    } as NotificationOptions;

    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready.then((reg) => { reg.showNotification(title, options); });
    } else {
      new Notification(title, options);
    }
    return true;
  } catch { return false; }
};

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

const SHOWN_PUSH_KEY = "rs_shown_push_ids";
const getShownPushIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(SHOWN_PUSH_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
};
const addShownPushId = (id: string) => {
  try {
    const ids = getShownPushIds();
    ids.add(id);
    const arr = [...ids].slice(-200);
    localStorage.setItem(SHOWN_PUSH_KEY, JSON.stringify(arr));
  } catch {}
};

const NotificationPanel = ({ userId, onOpenContent }: NotificationPanelProps) => {
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [showFullPage, setShowFullPage] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const knownNotifIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => { requestNotificationPermission(); }, []);

  useEffect(() => {
    if (!userId) { setNotifications([]); knownNotifIdsRef.current = new Set(); return; }
    const notifsRef = ref(db, `notifications/${userId}`);
    const unsub = onValue(notifsRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) { setNotifications([]); knownNotifIdsRef.current = new Set(); return; }
      const items: NotifItem[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        items.push({ id, title: item.title || "", message: item.message || "", type: item.type || "", contentId: item.contentId || "", image: item.image || item.poster || "", read: item.read || false, timestamp: item.timestamp || Date.now() });
      });
      items.sort((a, b) => b.timestamp - a.timestamp);
      const shownIds = getShownPushIds();
      const unreadUnshown = items.filter((item) => !item.read && !shownIds.has(item.id));
      const isFirstHydration = knownNotifIdsRef.current.size === 0;
      const candidates = (isFirstHydration ? unreadUnshown : unreadUnshown.filter((item) => !knownNotifIdsRef.current.has(item.id))).slice(0, 5).reverse();
      candidates.forEach((item) => { const displayed = showBrowserNotification(item.title, item.message, item.contentId, item.image); if (displayed) addShownPushId(item.id); });
      knownNotifIdsRef.current = new Set(items.map((item) => item.id));
      setNotifications(items);
    });
    return () => { unsub(); knownNotifIdsRef.current = new Set(); };
  }, [userId]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllAsRead = () => {
    if (!userId || notifications.length === 0) return;
    const updates: Record<string, boolean> = {};
    notifications.forEach((n) => { if (!n.read) updates[`notifications/${userId}/${n.id}/read`] = true; });
    if (Object.keys(updates).length > 0) update(ref(db), updates);
  };

  const openNotification = (notif: NotifItem) => {
    if (!notif.read && userId) set(ref(db, `notifications/${userId}/${notif.id}/read`), true);
    setShowFullPage(false);
    if (notif.contentId && onOpenContent) onOpenContent(notif.contentId);
  };

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  if (showFullPage) {
    return (
      <>
        <button onClick={() => setShowFullPage(true)}
          className="relative w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-110 bg-card"
          style={{ boxShadow: "var(--neu-shadow-sm)" }}>
          <Bell className="w-4 h-4 text-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center px-1">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
        <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
          initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
          transition={{ type: "tween", duration: 0.3 }}>
          <div className="flex items-center justify-between mb-5">
            <button onClick={() => setShowFullPage(false)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
              <span className="font-medium">Notifications</span>
            </button>
            <button onClick={markAllAsRead} className="text-[11px] text-primary hover:underline flex items-center gap-1">
              <Check className="w-3 h-3" /> Mark all read
            </button>
          </div>
          <div className="space-y-2">
            {notifications.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <div className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center bg-card" style={{ boxShadow: "var(--neu-shadow)" }}>
                  <Bell className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              notifications.map((notif) => (
                <div key={notif.id} onClick={() => openNotification(notif)}
                  className={`glass-card px-4 py-3 rounded-xl cursor-pointer transition-all hover:translate-x-1 ${!notif.read ? "ring-2 ring-primary/20" : ""}`}>
                  <div className="flex items-start gap-3">
                    {notif.image ? (
                      <img src={notif.image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0 mt-0.5" />
                    ) : (
                      !notif.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {!notif.read && notif.image && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                        <p className="text-sm font-semibold leading-tight">{notif.title}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                      <p className="text-[10px] text-primary mt-1">{timeAgo(notif.timestamp)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button onClick={() => setShowFullPage(true)}
        className="relative w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-110 bg-card"
        style={{ boxShadow: "var(--neu-shadow-sm)" }}>
        <Bell className="w-4 h-4 text-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center px-1 animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
};

export default NotificationPanel;
