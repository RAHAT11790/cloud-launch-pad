import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Megaphone, Sparkles, X, CheckCheck, Play } from "lucide-react";
import { db, ref, onValue } from "@/lib/firebase";
import {
  activeAnnouncements, releaseNotices, bellItems, unreadCount, nextPopup, readSeenPopups, markPopupSeen,
  timeAgo, BELL_READ_KEY, type Announcement, type BellItem,
} from "@/lib/announcements";

const readReadAt = () => { try { return Number(localStorage.getItem(BELL_READ_KEY)) || 0; } catch { return 0; } };

export default function NotificationBell({ onOpenContent }: { onOpenContent?: (contentId: string) => void }) {
  const [annRaw, setAnnRaw] = useState<Record<string, any>>({});
  const [relRaw, setRelRaw] = useState<Record<string, any>>({});
  const [open, setOpen] = useState(false);
  const [readAt, setReadAt] = useState(readReadAt);
  const [popup, setPopup] = useState<Announcement | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => onValue(ref(db, "announcements"), s => setAnnRaw(s.val() || {})), []);
  useEffect(() => onValue(ref(db, "newEpisodeReleases"), s => setRelRaw(s.val() || {})), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);

  const announcements = useMemo(() => activeAnnouncements(annRaw, now), [annRaw, now]);
  const items = useMemo(() => bellItems(announcements, releaseNotices(relRaw, now)), [announcements, relRaw, now]);
  const unread = unreadCount(items, readAt);

  // One-time popup: shown once per device, after the page settles and any welcome window is closed.
  useEffect(() => {
    if (popup) return;
    const next = nextPopup(announcements, readSeenPopups());
    if (!next) return;
    let calm = 0;
    const t = setInterval(() => {
      calm = document.querySelector("[data-welcome-modal]") ? 0 : calm + 1;
      if (calm < 2) return;
      clearInterval(t); markPopupSeen(next.id, announcements); setPopup(next);
    }, 700);
    return () => clearInterval(t);
  }, [announcements, popup]);

  const close = () => {
    setOpen(false);
    const at = Date.now();
    setReadAt(at);
    try { localStorage.setItem(BELL_READ_KEY, String(at)); } catch {}
  };
  const openItem = (item: BellItem) => {
    if (item.type === "release" && item.contentId) { close(); onOpenContent?.(item.contentId); }
  };

  return <>
    <button type="button" onClick={() => (open ? close() : setOpen(true))} aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
      className="relative w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-transform active:scale-95"
      style={{ boxShadow: "var(--neu-shadow-sm)" }}>
      <Bell className={`w-[18px] h-[18px] text-foreground ${unread ? "bell-ring" : ""}`} />
      {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold leading-[17px] text-center ring-2 ring-background">{unread > 9 ? "9+" : unread}</span>}
    </button>

    {open && createPortal(<div className="fixed inset-0 z-[200]" onClick={close}>
      <div className="absolute inset-0 bg-background/40 backdrop-blur-[2px]" />
      <section role="dialog" aria-label="Notifications" onClick={e => e.stopPropagation()}
        className="notif-panel absolute right-2 top-[64px] w-[min(94vw,380px)] max-h-[72vh] flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Bell size={16} className="text-primary" />
          <h2 className="text-sm font-bold">Notifications</h2>
          {unread > 0 && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">{unread} new</span>}
          <button onClick={close} className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"><CheckCheck size={14} />Mark read</button>
          <button onClick={close} aria-label="Close notifications" className="ml-1 rounded-full p-1 text-muted-foreground hover:bg-muted"><X size={16} /></button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain p-2">
          {items.length === 0 ? <div className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted"><Bell size={20} className="text-muted-foreground" /></span>
            <p className="text-sm font-semibold">You're all caught up</p>
            <p className="text-xs text-muted-foreground">New releases and updates will appear here.</p>
          </div> : items.map(item => {
            const fresh = item.time > readAt;
            const release = item.type === "release";
            return <article key={item.id} onClick={() => openItem(item)}
              className={`relative flex gap-3 rounded-xl p-2.5 mb-1 transition-colors ${release ? "cursor-pointer hover:bg-muted/70" : ""} ${fresh ? "bg-primary/[0.06]" : ""}`}>
              {fresh && <span className="absolute left-1 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-primary" />}
              {release ? (item.image
                ? <img src={item.image} alt="" loading="lazy" className="h-14 w-10 shrink-0 rounded-md object-cover" />
                : <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded-md bg-muted"><Play size={16} /></span>)
                : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">{item.type === "popup" ? <Sparkles size={17} /> : <Megaphone size={17} />}</span>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${release ? "text-accent-foreground bg-accent" : "text-primary bg-primary/10"} rounded px-1.5 py-[1px]`}>{release ? "New release" : item.type === "popup" ? "Update" : "Message"}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{timeAgo(item.time, now)}</span>
                </div>
                <h3 className="mt-1 text-[13px] font-bold leading-snug line-clamp-2">{item.title}</h3>
                {item.body && <p className={`mt-0.5 text-xs leading-relaxed text-muted-foreground ${release ? "" : "whitespace-pre-line line-clamp-4"}`}>{item.body}</p>}
                {!release && item.image && <img src={item.image} alt="" loading="lazy" className="mt-2 aspect-[3/1] w-full rounded-lg object-cover" />}
              </div>
            </article>;
          })}
        </div>
      </section>
    </div>, document.body)}

    {popup && createPortal(<div className="fixed inset-0 z-[210] flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-label={popup.title}>
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setPopup(null)} />
      <section className="notif-popup relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl">
        {popup.image && <img src={popup.image} alt="" className="aspect-[3/1] w-full object-cover" />}
        <button onClick={() => setPopup(null)} aria-label="Close" className="absolute right-2 top-2 rounded-full bg-background/80 p-1.5 text-foreground"><X size={15} /></button>
        <div className="p-5">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary"><Sparkles size={14} />What's new</div>
          <h2 className="text-lg font-bold leading-snug">{popup.title}</h2>
          {popup.description && <p className="mt-2 max-h-[40vh] overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{popup.description}</p>}
          <button onClick={() => setPopup(null)} className="mt-5 h-11 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground active:scale-[0.98] transition-transform">Got it</button>
        </div>
      </section>
    </div>, document.body)}
  </>;
}
