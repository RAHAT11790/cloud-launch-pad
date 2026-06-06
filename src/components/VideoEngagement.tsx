import { useEffect, useMemo, useRef, useState } from "react";
import { db, ref, onValue, set, remove, push } from "@/lib/firebase";
import { MessageCircle, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

/**
 * YouTube-style engagement bar shown directly below the video player.
 * Like / Dislike / Comment / Share with live counts, persisted in Firebase RTDB.
 *
 * Firebase shape (per anime):
 *   engagement/{animeId}/likes/{uid}            = { ts }
 *   engagement/{animeId}/dislikes/{uid}         = { ts }
 *   engagement/{animeId}/comments/{cid}         = { uid, userName, text, ts, likes: { uid: true } }
 */
interface Props {
  animeId: string;
  title?: string;
}

const getLocalUser = (): { id: string; name: string } | null => {
  try {
    const raw = localStorage.getItem("rsanime_user");
    if (!raw) return null;
    const u = JSON.parse(raw);
    if (!u?.id) return null;
    const name =
      localStorage.getItem("rs_display_name") ||
      u.name ||
      u.displayName ||
      (u.email ? String(u.email).split("@")[0] : "User");
    return { id: String(u.id), name: String(name) };
  } catch {
    return null;
  }
};

const formatCount = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
};

const timeAgo = (ts: number): string => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
};

interface CommentItem {
  id: string;
  uid: string;
  userName: string;
  text: string;
  ts: number;
}

const normalizeComment = (id: string, value: any): CommentItem => ({
  id,
  uid: String(value?.userId || value?.uid || ""),
  userName: String(value?.userName || "User"),
  text: String(value?.text || ""),
  ts: Number(value?.timestamp || value?.ts || 0),
});

const VideoEngagement = ({ animeId, title }: Props) => {
  const user = useMemo(() => getLocalUser(), []);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!animeId) return;
    return onValue(ref(db, `comments/${animeId}`), (snap) => {
      const raw = snap.val() || {};
      const list: CommentItem[] = Object.entries(raw).map(([id, v]: [string, any]) => normalizeComment(id, v));
      list.sort((a, b) => b.ts - a.ts);
      setComments(list);
    });
  }, [animeId, user?.id]);

  const ensureUser = (): boolean => {
    if (!user) {
      toast.error("Please log in to react");
      return false;
    }
    return true;
  };


  const postComment = async () => {
    if (!ensureUser()) return;
    const text = commentText.trim();
    if (!text) return;
    setSending(true);
    try {
      const node = push(ref(db, `comments/${animeId}`));
      await set(node, {
        userId: user!.id,
        userName: user!.name,
        text: text.slice(0, 500),
        timestamp: Date.now(),
      });
      setCommentText("");
    } catch {
      toast.error("Failed to post comment");
    } finally {
      setSending(false);
    }
  };

  const deleteComment = async (c: CommentItem) => {
    if (!user || user.id !== c.uid) return;
    await remove(ref(db, `comments/${animeId}/${c.id}`)).catch(() => {});
  };

  return (
      <div className="w-full max-w-full min-w-0 overflow-hidden px-0">
        <div className="w-full max-w-full min-w-0 rounded-[12px] border border-border/70 bg-card/55 px-3 py-3 overflow-hidden">
          <div className="mb-3 flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" strokeWidth={2} />
            <div>
              <h3 className="text-sm font-bold text-foreground">Comments</h3>
              <p className="text-[11px] text-muted-foreground">{comments.length} {comments.length === 1 ? "comment" : "comments"}</p>
            </div>
          </div>

          <div className="space-y-3">
            {comments.length === 0 ? (
              <div className="rounded-[10px] bg-secondary/40 px-3 py-6 text-center text-muted-foreground">
                <MessageCircle className="mx-auto mb-2 h-8 w-8 opacity-40" />
                <p className="text-sm">Be the first to comment</p>
              </div>
            ) : (
              comments.map((c) => (
                <div key={c.id} className="flex gap-3 rounded-[10px] bg-secondary/35 px-3 py-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full gradient-primary text-xs font-bold text-primary-foreground">
                    {(c.userName || "?").trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-2">
                      <span className="truncate text-xs font-semibold text-foreground">{c.userName}</span>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(c.ts)}</span>
                    </div>
                    <p className="break-words whitespace-pre-wrap text-[13px] leading-5 text-foreground/90">{c.text}</p>
                    {user?.id === c.uid && (
                      <button
                        onClick={() => deleteComment(c)}
                        className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground transition-all active:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 border-t border-border/60 pt-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full gradient-primary text-xs font-bold text-primary-foreground">
                {(user?.name || "?").trim().charAt(0).toUpperCase()}
              </div>
              <input
                ref={inputRef}
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    postComment();
                  }
                }}
                placeholder={user ? `Comment on ${title || "this anime"}...` : "Log in to comment"}
                disabled={!user || sending}
                maxLength={500}
                className="min-w-0 flex-1 rounded-full bg-secondary/60 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              />
              <button
                onClick={postComment}
                disabled={!user || sending || !commentText.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-full gradient-primary text-primary-foreground transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
  );
};

export default VideoEngagement;
