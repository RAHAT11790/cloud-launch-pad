import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Bell, Check, ArrowLeft } from "lucide-react";
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

const getExistingUserId = (): string | undefined => {
  try {
    const raw = localStorage.getItem("rsanime_user");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed?.id || undefined;
  } catch {
    return undefined;
  }
};

const NotificationsPage = () => {
  const navigate = useNavigate();
  const [userId] = useState<string | undefined>(() => getExistingUserId());
  const [notifications, setNotifications] = useState<NotifItem[]>([]);

  useEffect(() => {
    if (!userId) { setNotifications([]); return; }
    const notifsRef = ref(db, `notifications/${userId}`);
    const unsub = onValue(notifsRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) { setNotifications([]); return; }
      const items: NotifItem[] = Object.entries(data).map(([id, item]: [string, any]) => ({
        id,
        title: item.title || "",
        message: item.message || "",
        type: item.type || "",
        contentId: item.contentId || "",
        image: item.image || item.poster || "",
        read: item.read || false,
        timestamp: item.timestamp || Date.now(),
      }));
      items.sort((a, b) => b.timestamp - a.timestamp);
      setNotifications(items);
    });
    return () => unsub();
  }, [userId]);

  const markAllAsRead = () => {
    if (!userId || notifications.length === 0) return;
    const updates: Record<string, boolean> = {};
    notifications.forEach((n) => { if (!n.read) updates[`notifications/${userId}/${n.id}/read`] = true; });
    if (Object.keys(updates).length > 0) update(ref(db), updates);
  };

  const openNotification = (notif: NotifItem) => {
    if (!notif.read && userId) set(ref(db, `notifications/${userId}/${notif.id}/read`), true);
    if (notif.contentId) {
      navigate(`/anime/${encodeURIComponent(notif.contentId)}`);
    } else {
      handleBack();
    }
  };

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
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

  return (
    <motion.div
      className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <div className="flex items-center justify-between mb-5">
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur?.();
            handleBack();
          }}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back"
        >
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
            <div
              key={notif.id}
              onClick={() => openNotification(notif)}
              className={`glass-card px-4 py-3 rounded-xl cursor-pointer transition-all hover:translate-x-1 ${!notif.read ? "ring-2 ring-primary/20" : ""}`}
            >
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
  );
};

export default NotificationsPage;
