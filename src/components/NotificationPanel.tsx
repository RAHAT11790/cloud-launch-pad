import { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { db, ref, onValue } from "@/lib/firebase";

interface NotifItem {
  id: string;
  read: boolean;
  timestamp: number;
}

interface NotificationPanelProps {
  userId?: string;
  /**
   * Legacy prop kept for backwards compatibility. The bell now always
   * navigates to the dedicated /notifications route, so callers do not
   * need to wire this anymore.
   */
  onOpenContent?: (contentId: string) => void;
}

const NotificationPanel = ({ userId }: NotificationPanelProps) => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const knownNotifIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) { setNotifications([]); knownNotifIdsRef.current = new Set(); return; }
    const notifsRef = ref(db, `notifications/${userId}`);
    const unsub = onValue(notifsRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) { setNotifications([]); knownNotifIdsRef.current = new Set(); return; }
      const items: NotifItem[] = Object.entries(data).map(([id, item]: [string, any]) => ({
        id,
        read: !!item.read,
        timestamp: item.timestamp || Date.now(),
      }));
      items.sort((a, b) => b.timestamp - a.timestamp);
      knownNotifIdsRef.current = new Set(items.map((item) => item.id));
      setNotifications(items);
    });
    return () => { unsub(); knownNotifIdsRef.current = new Set(); };
  }, [userId]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <button
      onClick={() => navigate("/notifications")}
      className="relative w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-110 bg-card"
      style={{ boxShadow: "var(--neu-shadow-sm)" }}
      aria-label="Notifications"
    >
      <Bell className="w-4 h-4 text-foreground" />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center px-1 animate-pulse">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  );
};

export default NotificationPanel;
