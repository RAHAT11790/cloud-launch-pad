import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, MessageCircle, Reply, Send, Trash2 } from "lucide-react";
import { db, onValue, push, ref, remove, set } from "@/lib/firebase";

interface CommentSectionProps {
  animeId: string;
  embedded?: boolean;
  hideHeader?: boolean;
  onCountChange?: (n: number) => void;
}


interface ReplyData {
  key: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
}

interface CommentData {
  key: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
  replies?: Record<string, ReplyData>;
}

const getUserId = (): string | null => {
  try {
    const u = localStorage.getItem("rsanime_user");
    if (u) return JSON.parse(u).id;
  } catch {}
  return null;
};

const getUserName = (): string => {
  try {
    return (
      localStorage.getItem("rs_display_name") ||
      JSON.parse(localStorage.getItem("rsanime_user") || "{}").name ||
      "User"
    );
  } catch {
    return "User";
  }
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

const CommentSection = ({ animeId, embedded = false, hideHeader = false, onCountChange }: CommentSectionProps) => {
  const userId = getUserId();
  const [comments, setComments] = useState<CommentData[]>([]);
  const [commentText, setCommentText] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());

  useEffect(() => {
    const commRef = ref(db, `comments/${animeId}`);
    const unsub = onValue(commRef, (snap) => {
      const data = snap.val() || {};
      const list: CommentData[] = Object.entries(data).map(([key, val]: any) => {
        const replies: Record<string, ReplyData> = {};
        if (val.replies) {
          Object.entries(val.replies).forEach(([rKey, rVal]: any) => {
            replies[rKey] = {
              key: rKey,
              userId: rVal.userId,
              userName: rVal.userName,
              text: rVal.text,
              timestamp: rVal.timestamp || 0,
            };
          });
        }
        return {
          key,
          userId: val.userId,
          userName: val.userName,
          text: val.text,
          timestamp: val.timestamp || 0,
          replies,
        };
      });
      list.sort((a, b) => b.timestamp - a.timestamp);
      setComments(list);
      onCountChange?.(list.length);
    });

    return () => unsub();
  }, [animeId]);

  const postComment = useCallback(() => {
    if (!userId || !commentText.trim()) return;
    const text = commentText.trim();
    const userName = getUserName();
    setCommentText("");
    const newRef = push(ref(db, `comments/${animeId}`));
    set(newRef, { userId, userName, text, timestamp: Date.now() }).catch(() => {
      setCommentText(text);
      import("sonner").then(({ toast }) => toast.error("কমেন্ট পোস্ট করা যায়নি।"));
    });
  }, [userId, commentText, animeId]);

  const postReply = useCallback(
    async (commentKey: string) => {
      if (!userId || !replyText.trim()) return;
      const text = replyText.trim();
      const userName = getUserName();
      setReplyText("");
      setReplyingTo(null);
      setExpandedReplies((prev) => new Set(prev).add(commentKey));
      try {
        const replyRef = push(ref(db, `comments/${animeId}/${commentKey}/replies`));
        await set(replyRef, { userId, userName, text, timestamp: Date.now() });
      } catch {
        setReplyText(text);
        import("sonner").then(({ toast }) => toast.error("রিপ্লাই পোস্ট করা যায়নি।"));
      }
    },
    [userId, replyText, animeId],
  );

  const deleteComment = (commentKey: string) => {
    remove(ref(db, `comments/${animeId}/${commentKey}`)).catch(() =>
      import("sonner").then(({ toast }) => toast.error("ডিলিট করা যায়নি")),
    );
  };

  const deleteReply = (commentKey: string, replyKey: string) => {
    remove(ref(db, `comments/${animeId}/${commentKey}/replies/${replyKey}`)).catch(() =>
      import("sonner").then(({ toast }) => toast.error("ডিলিট করা যায়নি")),
    );
  };

  const toggleReplies = (commentKey: string) => {
    setExpandedReplies((prev) => {
      const next = new Set(prev);
      if (next.has(commentKey)) next.delete(commentKey);
      else next.add(commentKey);
      return next;
    });
  };

  return (
    <div className={embedded ? "" : "mt-5"}>
      {!hideHeader && (
        <div className={`flex items-baseline justify-between mb-3 pb-2 ${embedded ? "border-b border-border/60" : "border-b border-border"}`}>
          <h3 className="text-[15px] font-bold text-foreground flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-primary" /> Comments ({comments.length})
          </h3>
        </div>
      )}


      {userId && (
        <div className="flex gap-2 mb-3 items-end">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                postComment();
              }
            }}
            placeholder="Write a comment..."
            rows={1}
            className="flex-1 bg-secondary border border-foreground/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-primary resize-none min-h-[40px] max-h-[120px]"
            style={{ overflow: "auto" }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={postComment}
            className="w-10 h-10 min-w-[40px] rounded-full bg-primary text-primary-foreground flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="space-y-2.5 max-h-[400px] overflow-y-auto">
        {comments.length === 0 && (
          <p className="text-[12px] text-muted-foreground text-center py-3">No comments yet</p>
        )}
        {comments.map((c) => {
          const repliesList = c.replies
            ? Object.values(c.replies).sort((a, b) => a.timestamp - b.timestamp)
            : [];
          const isExpanded = expandedReplies.has(c.key);
          return (
            <div key={c.key} className="bg-secondary/50 rounded-lg p-2.5">
              <div className="flex justify-between items-start">
                <span className="text-[12px] font-semibold text-primary">{c.userName}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground">{timeAgo(c.timestamp)}</span>
                  {c.userId === userId && (
                    <button onClick={() => deleteComment(c.key)} className="text-destructive">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[12px] text-secondary-foreground mt-1 break-words">{c.text}</p>

              <div className="flex items-center gap-3 mt-1.5">
                {userId && (
                  <button
                    onClick={() => {
                      setReplyingTo(replyingTo === c.key ? null : c.key);
                      setReplyText("");
                    }}
                    className="text-[10px] text-primary hover:underline flex items-center gap-1"
                  >
                    <Reply className="w-3 h-3" /> Reply
                  </button>
                )}
                {repliesList.length > 0 && (
                  <button
                    onClick={() => toggleReplies(c.key)}
                    className="text-[10px] text-muted-foreground flex items-center gap-1"
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {repliesList.length} {repliesList.length === 1 ? "reply" : "replies"}
                  </button>
                )}
              </div>

              {replyingTo === c.key && (
                <div className="flex gap-2 mt-2 items-end ml-4">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        postReply(c.key);
                      }
                    }}
                    placeholder={`Reply to ${c.userName}...`}
                    rows={1}
                    className="flex-1 bg-background border border-foreground/10 rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-primary resize-none min-h-[32px] max-h-[80px]"
                    onInput={(e) => {
                      const t = e.currentTarget;
                      t.style.height = "auto";
                      t.style.height = Math.min(t.scrollHeight, 80) + "px";
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => postReply(c.key)}
                    className="w-8 h-8 min-w-[32px] rounded-full bg-primary text-primary-foreground flex items-center justify-center"
                  >
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              )}

              {isExpanded && repliesList.length > 0 && (
                <div className="ml-4 mt-2 space-y-1.5 border-l-2 border-primary/20 pl-3">
                  {repliesList.map((r) => (
                    <div key={r.key} className="bg-background/50 rounded-md p-2">
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-semibold text-accent">{r.userName}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-muted-foreground">{timeAgo(r.timestamp)}</span>
                          {r.userId === userId && (
                            <button
                              onClick={() => deleteReply(c.key, r.key)}
                              className="text-destructive"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-secondary-foreground mt-0.5 break-words">{r.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CommentSection;
