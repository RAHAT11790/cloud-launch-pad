import { useEffect, useMemo, useRef, useState } from "react";
import { db, ref, onValue, set, remove, push } from "@/lib/firebase";
import { MessageCircle, Send, Trash2, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { readProfilePhoto } from "@/lib/localUser";

/**
 * YouTube-style comment section with nested replies + per-comment reactions.
 *
 * Firebase shape (flat, parentId links replies to top-level comments):
 *   comments/{animeId}/{cid} = {
 *     userId, userName, text, timestamp,
 *     parentId?: string,
 *     likes?: { uid: true },
 *     dislikes?: { uid: true }
 *   }
 */
interface Props {
  animeId: string;
  title?: string;
}

const getLocalUser = (): { id: string; name: string; photo?: string } | null => {
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
    const photo = readProfilePhoto(String(u.id)) || u.photoURL || u.photo || undefined;
    return { id: String(u.id), name: String(name), photo: photo ? String(photo) : undefined };
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
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
};

interface CommentItem {
  id: string;
  uid: string;
  userName: string;
  userPhoto?: string;
  text: string;
  ts: number;
  parentId?: string;
  likes: string[];
  dislikes: string[];
}

const normalizeComment = (id: string, value: any): CommentItem => ({
  id,
  uid: String(value?.userId || value?.uid || ""),
  userName: String(value?.userName || "User"),
  userPhoto: value?.userPhoto ? String(value.userPhoto) : undefined,
  text: String(value?.text || ""),
  ts: Number(value?.timestamp || value?.ts || 0),
  parentId: value?.parentId ? String(value.parentId) : undefined,
  likes: value?.likes && typeof value.likes === "object" ? Object.keys(value.likes) : [],
  dislikes: value?.dislikes && typeof value.dislikes === "object" ? Object.keys(value.dislikes) : [],
});

const avatarColor = (name: string) => {
  const colors = [
    "from-rose-500 to-pink-600",
    "from-amber-500 to-orange-600",
    "from-emerald-500 to-teal-600",
    "from-sky-500 to-blue-600",
    "from-violet-500 to-purple-600",
    "from-fuchsia-500 to-pink-600",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
};

const Avatar = ({ name, photo, size = "md" }: { name: string; photo?: string; size?: "sm" | "md" }) => {
  const cls = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  if (photo) {
    return (
      <img
        src={photo}
        alt={name}
        loading="lazy"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        className={`shrink-0 rounded-full object-cover ${cls} shadow-sm ring-1 ring-border/40`}
      />
    );
  }
  return (
    <div className={`shrink-0 rounded-full bg-gradient-to-br ${avatarColor(name || "?")} ${cls} flex items-center justify-center font-bold text-white shadow-sm`}>
      {(name || "?").trim().charAt(0).toUpperCase()}
    </div>
  );
};

const VideoEngagement = ({ animeId, title }: Props) => {
  const user = useMemo(() => getLocalUser(), []);
  const [allComments, setAllComments] = useState<CommentItem[]>([]);
  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [reactionBusy, setReactionBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!animeId) return;
    return onValue(ref(db, `comments/${animeId}`), (snap) => {
      const raw = snap.val() || {};
      const list: CommentItem[] = Object.entries(raw).map(([id, v]: [string, any]) => normalizeComment(id, v));
      list.sort((a, b) => b.ts - a.ts);
      setAllComments(list);
    });
  }, [animeId]);

  const { topLevel, repliesByParent, totalCount } = useMemo(() => {
    const top: CommentItem[] = [];
    const map: Record<string, CommentItem[]> = {};
    for (const c of allComments) {
      if (c.parentId) {
        (map[c.parentId] ||= []).push(c);
      } else {
        top.push(c);
      }
    }
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.ts - b.ts));
    return { topLevel: top, repliesByParent: map, totalCount: allComments.length };
  }, [allComments]);

  const ensureUser = (): boolean => {
    if (!user) {
      toast.error("Please log in to continue");
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
        ...(user!.photo ? { userPhoto: user!.photo } : {}),
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

  const postReply = async (parentId: string) => {
    if (!ensureUser()) return;
    const text = replyText.trim();
    if (!text) return;
    setReplySending(true);
    try {
      const node = push(ref(db, `comments/${animeId}`));
      await set(node, {
        userId: user!.id,
        userName: user!.name,
        ...(user!.photo ? { userPhoto: user!.photo } : {}),
        text: text.slice(0, 500),
        timestamp: Date.now(),
        parentId,
      });
      setReplyText("");
      setReplyingTo(null);
      setExpandedReplies((prev) => ({ ...prev, [parentId]: true }));
    } catch {
      toast.error("Failed to post reply");
    } finally {
      setReplySending(false);
    }
  };

  const deleteComment = async (c: CommentItem) => {
    if (!user || user.id !== c.uid) return;
    // remove the comment
    await remove(ref(db, `comments/${animeId}/${c.id}`)).catch(() => {});
    // if top-level, remove its replies too
    if (!c.parentId) {
      const kids = repliesByParent[c.id] || [];
      await Promise.all(kids.map((k) => remove(ref(db, `comments/${animeId}/${k.id}`)).catch(() => {})));
    }
  };

  const reactToComment = async (c: CommentItem, kind: "like" | "dislike") => {
    if (!ensureUser() || reactionBusy) return;
    setReactionBusy(c.id);
    const uid = user!.id;
    const likedNow = c.likes.includes(uid);
    const dislikedNow = c.dislikes.includes(uid);
    const likeRef = ref(db, `comments/${animeId}/${c.id}/likes/${uid}`);
    const dislikeRef = ref(db, `comments/${animeId}/${c.id}/dislikes/${uid}`);
    try {
      if (kind === "like") {
        if (likedNow) await remove(likeRef);
        else {
          await set(likeRef, true);
          if (dislikedNow) await remove(dislikeRef).catch(() => {});
        }
      } else {
        if (dislikedNow) await remove(dislikeRef);
        else {
          await set(dislikeRef, true);
          if (likedNow) await remove(likeRef).catch(() => {});
        }
      }
    } catch {
      toast.error("Failed to update reaction");
    } finally {
      setReactionBusy(null);
    }
  };

  const renderComment = (c: CommentItem, isReply = false) => {
    const myLike = user ? c.likes.includes(user.id) : false;
    const myDislike = user ? c.dislikes.includes(user.id) : false;
    const kids = repliesByParent[c.id] || [];
    const expanded = expandedReplies[c.id];
    return (
      <div key={c.id} className="flex gap-2.5">
        <Avatar name={c.userName} size={isReply ? "sm" : "md"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="truncate text-[12px] font-semibold text-foreground">@{c.userName}</span>
            <span className="text-[10px] text-muted-foreground">{timeAgo(c.ts)}</span>
          </div>
          <p className="break-words whitespace-pre-wrap text-[13px] leading-[1.35rem] text-foreground/90">{c.text}</p>
          <div className="mt-1 flex items-center gap-1 -ml-1.5">
            <button
              onClick={() => reactToComment(c, "like")}
              disabled={reactionBusy === c.id}
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition-all active:scale-90 ${myLike ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-foreground/10"}`}
            >
              <ThumbsUp className={`h-3.5 w-3.5 ${myLike ? "fill-primary" : ""}`} strokeWidth={2} />
              {c.likes.length > 0 && <span className="tabular-nums">{formatCount(c.likes.length)}</span>}
            </button>
            <button
              onClick={() => reactToComment(c, "dislike")}
              disabled={reactionBusy === c.id}
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition-all active:scale-90 ${myDislike ? "text-destructive" : "text-muted-foreground hover:text-foreground hover:bg-foreground/10"}`}
            >
              <ThumbsDown className={`h-3.5 w-3.5 ${myDislike ? "fill-destructive" : ""}`} strokeWidth={2} />
              {c.dislikes.length > 0 && <span className="tabular-nums">{formatCount(c.dislikes.length)}</span>}
            </button>
            {!isReply && (
              <button
                onClick={() => {
                  setReplyingTo((prev) => (prev === c.id ? null : c.id));
                  setReplyText("");
                }}
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground active:scale-95"
              >
                Reply
              </button>
            )}
            {user?.id === c.uid && (
              <button
                onClick={() => deleteComment(c)}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground transition-all hover:text-destructive active:scale-95"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Reply composer */}
          {!isReply && replyingTo === c.id && (
            <div className="mt-2 flex items-center gap-2">
              <Avatar name={user?.name || "?"} size="sm" />
              <input
                type="text"
                autoFocus
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    postReply(c.id);
                  }
                }}
                placeholder={`Reply to @${c.userName}...`}
                disabled={!user || replySending}
                maxLength={500}
                className="min-w-0 flex-1 border-b border-border bg-transparent px-1 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={() => {
                  setReplyingTo(null);
                  setReplyText("");
                }}
                className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-foreground/10"
              >
                Cancel
              </button>
              <button
                onClick={() => postReply(c.id)}
                disabled={!user || replySending || !replyText.trim()}
                className="rounded-full gradient-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground disabled:opacity-40 active:scale-95"
              >
                Reply
              </button>
            </div>
          )}

          {/* Reply toggle + list */}
          {!isReply && kids.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setExpandedReplies((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold text-primary transition-all hover:bg-primary/10 active:scale-95"
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {kids.length} {kids.length === 1 ? "reply" : "replies"}
              </button>
              {expanded && (
                <div className="mt-2 space-y-3 pl-1">
                  {kids.map((k) => renderComment(k, true))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden px-0">
      <div className="w-full max-w-full min-w-0 rounded-[14px] border border-border/70 bg-card/55 px-3.5 py-3.5 overflow-hidden">
        <div className="mb-3.5 flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" strokeWidth={2.25} />
          <h3 className="text-[14px] font-bold text-foreground">Comments</h3>
          <span className="text-[12px] font-semibold text-muted-foreground tabular-nums">{formatCount(totalCount)}</span>
        </div>

        {/* Top composer */}
        <div className="mb-4 flex items-center gap-2.5">
          <Avatar name={user?.name || "?"} />
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
            className="min-w-0 flex-1 border-b border-border bg-transparent px-1 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={postComment}
            disabled={!user || sending || !commentText.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-full gradient-primary text-primary-foreground transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100"
            aria-label="Post comment"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        {/* Comments list */}
        <div className="space-y-4">
          {topLevel.length === 0 ? (
            <div className="rounded-[10px] bg-secondary/30 px-3 py-8 text-center text-muted-foreground">
              <MessageCircle className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p className="text-sm font-medium">Be the first to comment</p>
              <p className="text-[11px] opacity-70 mt-0.5">on {title || "this anime"}</p>
            </div>
          ) : (
            topLevel.map((c) => renderComment(c))
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoEngagement;
