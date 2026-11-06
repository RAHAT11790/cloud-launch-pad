import { memo, useEffect, useState } from "react";
import { currentChatProfile, subscribeMentions } from "@/lib/communityChat";
import { useLiveTvEnabled, mainPagesFor } from "@/lib/liveTvToggle";
import { House, FilmStrip, Television, FilmReel, ChatsCircle, UserCircle, type Icon } from "@phosphor-icons/react";

interface BottomNavProps {
  activePage: string;
  onNavigate: (page: string) => void;
}

const ALL_ITEMS: { id: string; label: string; Icon: Icon }[] = [
  { id: "home", label: "Home", Icon: House },
  { id: "series", label: "Series", Icon: FilmStrip },
  { id: "livetv", label: "Live TV", Icon: Television },
  { id: "movies", label: "Movies", Icon: FilmReel },
  { id: "chat", label: "Chat", Icon: ChatsCircle },
  { id: "profile", label: "Profile", Icon: UserCircle },
];

/** Red count of unread reply-tags for the signed-in member (cleared when the chat opens). */
function useChatMentionCount() {
  const [uid, setUid] = useState(() => currentChatProfile()?.id || "");
  const [count, setCount] = useState(0);
  useEffect(() => {
    const refresh = () => setUid(currentChatProfile()?.id || "");
    window.addEventListener("rs_auth_changed", refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("rs_auth_changed", refresh); window.removeEventListener("storage", refresh); };
  }, []);
  useEffect(() => { if (!uid) { setCount(0); return; } return subscribeMentions(uid, rows => setCount(rows.length)); }, [uid]);
  return count;
}

const BottomNav = ({ activePage, onNavigate }: BottomNavProps) => {
  const mentions = useChatMentionCount();
  const liveOn = useLiveTvEnabled();
  const pages = [...mainPagesFor(liveOn), "profile"];
  const items = ALL_ITEMS.filter((item) => pages.includes(item.id));
  return (
    <nav className="nv-bar fixed bottom-0 left-0 right-0 h-[65px] z-50 grid items-center px-2"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, boxShadow: "0 -6px 20px hsl(var(--foreground) / 0.08)" }}>
      {items.map(({ id, label, Icon }) => {
        const isActive = activePage === id;
        return (
          <button
            type="button"
            key={id}
            onClick={() => onNavigate(id)}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={`nv-item nv-${id} ${isActive ? "nv-on" : ""}`}
          >
            <span className="nv-ico"><Icon className="nv-svg" weight={isActive ? "fill" : "duotone"} /></span>
            <span className="nv-lbl">{label}</span>
            {id === "chat" && mentions > 0 && <span className="nv-badge" aria-label={`${mentions} replies to you`}>{mentions > 9 ? "9+" : mentions}</span>}
          </button>
        );
      })}
    </nav>
  );
};

export default memo(BottomNav);
