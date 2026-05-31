import { useEffect, useMemo, useRef, useState } from "react";
import { db, ref, onValue, set, remove, push, update, get } from "@/lib/firebase";
import { ThumbsUp, ThumbsDown, MessageCircle, Share2, Send, X, Trash2, Heart } from "lucide-react";
import { toast } from "sonner";
import { SITE_URL } from "@/lib/siteConfig";

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
  likeCount: number;
  iLiked: boolean;
}

const VideoEngagement = ({ animeId, title }: Props) => {
  const user = useMemo(() => getLocalUser(), []);
  const [likes, setLikes] = useState<Record<string, any>>({});
  const [dislikes, setDislikes] = useState<Record<string, any>>({});
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!animeId) return;
    const unsubs: Array<() => void> = [];
    unsubs.push(
      onValue(ref(db, `engagement/${animeId}/likes`), (snap) => setLikes(snap.val() || {})),
    );
    unsubs.push(
      onValue(ref(db, `engagement/${animeId}/dislikes`), (snap) => setDislikes(snap.val() || {})),
    );
    unsubs.push(
      onValue(ref(db, `engagement/${animeId}/comments`), (snap) => {
        const raw = snap.val() || {};
        const list: CommentItem[] = Object.entries(raw).map(([id, v]: [string, any]) => {
          const cLikes = v?.likes && typeof v.likes === "object" ? v.likes : {};
          return {
            id,
            uid: String(v?.uid || ""),
            userName: String(v?.userName || "User"),
            text: String(v?.text || ""),
            ts: Number(v?.ts || 0),
            likeCount: Object.keys(cLikes).length,
            iLiked: !!(user?.id && cLikes[user.id]),
          };
        });
        list.sort((a, b) => b.ts - a.ts);
        setComments(list);
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [animeId, user?.id]);

  const likeCount = Object.keys(likes).length;
  const dislikeCount = Object.keys(dislikes).length;
  const iLiked = !!(user?.id && likes[user.id]);
  const iDisliked = !!(user?.id && dislikes[user.id]);

  const ensureUser = (): boolean => {
    if (!user) {
      toast.error("Please log in to react");
      return false;
    }
    return true;
  };

  const toggleLike = async () => {
    if (!ensureUser()) return;
    const myLikeRef = ref(db, `engagement/${animeId}/likes/${user!.id}`);
    const myDislikeRef = ref(db, `engagement/${animeId}/dislikes/${user!.id}`);
    if (iLiked) {
      await remove(myLikeRef).catch(() => {});
    } else {
      await set(myLikeRef, { ts: Date.now() }).catch(() => {});
      if (iDisliked) await remove(myDislikeRef).catch(() => {});
    }
  };

  const toggleDislike = async () => {
    if (!ensureUser()) return;
    const myLikeRef = ref(db, `engagement/${animeId}/likes/${user!.id}`);
    const myDislikeRef = ref(db, `engagement/${animeId}/dislikes/${user!.id}`);
    if (iDisliked) {
      await remove(myDislikeRef).catch(() => {});
    } else {
      await set(myDislikeRef, { ts: Date.now() }).catch(() => {});
      if (iLiked) await remove(myLikeRef).catch(() => {});
    }
  };

  const shareLink = async () => {
    const url = `${SITE_URL}?anime=${encodeURIComponent(animeId)}`;
    const shareData = { title: title || "Watch", text: title || "", url };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      /* user cancelled */
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Share not supported on this device");
    }
  };

  const postComment = async () => {
    if (!ensureUser()) return;
    const text = commentText.trim();
    if (!text) return;
    setSending(true);
    try {
      const node = push(ref(db, `engagement/${animeId}/comments`));
      await set(node, {
        uid: user!.id,
        userName: user!.name,
        text: text.slice(0, 500),
        ts: Date.now(),
      });
      setCommentText("");
    } catch {
      toast.error("Failed to post comment");
    } finally {
      setSending(false);
    }
  };

  const toggleCommentLike = async (c: CommentItem) => {
    if (!ensureUser()) return;
    const r = ref(db, `engagement/${animeId}/comments/${c.id}/likes/${user!.id}`);
    if (c.iLiked) await remove(r).catch(() => {});
    else await set(r, true).catch(() => {});
  };

  const deleteComment = async (c: CommentItem) => {
    if (!user || user.id !== c.uid) return;
    await remove(ref(db, `engagement/${animeId}/comments/${c.id}`)).catch(() => {});
  };

  return (
    <div className="w-full mt-3 px-1">
      {/* YouTube-style action bar */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        {/* Like / Dislike grouped pill */}
        <div className="flex items-center bg-secondary/70 rounded-full overflow-hidden shrink-0">
          <button
            onClick={toggleLike}
            className={`flex items-center gap-1.5 px-3.5 py-2 transition-all active:scale-95 ${
              iLiked ? "text-primary" : "text-foreground"
            }`}
            aria-label="Like"
          >
            <ThumbsUp className="w-4 h-4" fill={iLiked ? "currentColor" : "none"} strokeWidth={2} />
            <span className="text-xs font-semibold tabular-nums">{formatCount(likeCount)}</span>
          </button>
          <div className="w-px h-5 bg-border/60" />
          <button
            onClick={toggleDislike}
            className={`flex items-center gap-1.5 px-3.5 py-2 transition-all active:scale-95 ${
              iDisliked ? "text-rose-400" : "text-foreground"
            }`}
            aria-label="Dislike"
          >
            <ThumbsDown
              className="w-4 h-4"
              fill={iDisliked ? "currentColor" : "none"}
              strokeWidth={2}
            />
            {dislikeCount > 0 && (
              <span className="text-xs font-semibold tabular-nums">{formatCount(dislikeCount)}</span>
            )}
          </button>
        </div>

        <button
          onClick={() => {
            setShowComments(true);
            setTimeout(() => inputRef.current?.focus(), 250);
          }}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-secondary/70 rounded-full text-foreground active:scale-95 transition-all shrink-0"
          aria-label="Comments"
        >
          <MessageCircle className="w-4 h-4" strokeWidth={2} />
          <span className="text-xs font-semibold tabular-nums">{formatCount(comments.length)}</span>
        </button>

        <button
          onClick={shareLink}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-secondary/70 rounded-full text-foreground active:scale-95 transition-all shrink-0"
          aria-label="Share"
        >
          <Share2 className="w-4 h-4" strokeWidth={2} />
          <span className="text-xs font-semibold">Share</span>
        </button>
      </div>

      {/* Comments bottom sheet */}
      {showComments && (
        <div
          className="fixed inset-0 z-[500] bg-black/70 backdrop-blur-sm flex items-end animate-in fade-in duration-150"
          onClick={() => setShowComments(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-h-[85vh] bg-card border-t border-border rounded-t-3xl flex flex-col animate-in slide-in-from-bottom duration-200"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border/60">
              <div>
                <h3 className="text-base font-bold text-foreground">Comments</h3>
                <p className="text-[11px] text-muted-foreground">{comments.length} {comments.length === 1 ? "comment" : "comments"}</p>
              </div>
              <button
                onClick={() => setShowComments(false)}
                className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center active:scale-95 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {comments.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Be the first to comment</p>
                </div>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                      {(c.userName || "?").trim().charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-foreground truncate">{c.userName}</span>
                        <span className="text-[10px] text-muted-foreground">{timeAgo(c.ts)}</span>
                      </div>
                      <p className="text-sm text-foreground/90 break-words whitespace-pre-wrap">{c.text}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <button
                          onClick={() => toggleCommentLike(c)}
                          className={`flex items-center gap-1 text-[11px] active:scale-95 transition-all ${
                            c.iLiked ? "text-primary" : "text-muted-foreground"
                          }`}
                        >
                          <Heart className="w-3.5 h-3.5" fill={c.iLiked ? "currentColor" : "none"} />
                          {c.likeCount > 0 && <span className="tabular-nums">{c.likeCount}</span>}
                        </button>
                        {user?.id === c.uid && (
                          <button
                            onClick={() => deleteComment(c)}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground active:text-rose-400 transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-border/60 p-3 pb-[max(12px,env(safe-area-inset-bottom))] bg-card">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
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
                  placeholder={user ? "Add a comment..." : "Log in to comment"}
                  disabled={!user || sending}
                  maxLength={500}
                  className="flex-1 bg-secondary/60 rounded-full px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                />
                <button
                  onClick={postComment}
                  disabled={!user || sending || !commentText.trim()}
                  className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-primary-foreground active:scale-95 transition-all disabled:opacity-40 disabled:active:scale-100"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoEngagement;
