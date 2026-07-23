import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue, set, remove } from "@/lib/firebase";
import { ThumbsUp, ThumbsDown, Eye } from "lucide-react";
import { toast } from "sonner";

interface Props {
  animeId: string;
  className?: string;
}

const getLocalUserId = (): string | null => {
  try {
    const raw = localStorage.getItem("rsanime_user");
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u?.id ? String(u.id) : null;
  } catch {
    return null;
  }
};

const formatCount = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
};

const VideoReactionsBar = ({ animeId, className = "" }: Props) => {
  const uid = useMemo(() => getLocalUserId(), []);
  const [likes, setLikes] = useState(0);
  const [dislikes, setDislikes] = useState(0);
  const [views, setViews] = useState(0);
  const [mine, setMine] = useState<"like" | "dislike" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!animeId) return;
    const un = onValue(ref(db, `engagement/${animeId}/likes`), (snap) => {
      const raw = snap.val() || {};
      const keys = Object.keys(raw);
      setLikes(keys.length);
      setMine((prev) => (uid && keys.includes(uid) ? "like" : prev === "like" ? null : prev));
    });
    return un;
  }, [animeId, uid]);

  useEffect(() => {
    if (!animeId) return;
    const un = onValue(ref(db, `engagement/${animeId}/dislikes`), (snap) => {
      const raw = snap.val() || {};
      const keys = Object.keys(raw);
      setDislikes(keys.length);
      setMine((prev) => (uid && keys.includes(uid) ? "dislike" : prev === "dislike" ? null : prev));
    });
    return un;
  }, [animeId, uid]);

  useEffect(() => {
    if (!animeId) return;
    const un = onValue(ref(db, `analytics/totals/views/${animeId}`), (snap) => {
      const v = snap.val();
      setViews(Number(v?.count || 0));
    });
    return un;
  }, [animeId]);

  const react = async (kind: "like" | "dislike") => {
    if (busy) return;
    if (!uid) {
      toast.error("Please log in to react");
      return;
    }
    setBusy(true);
    const likeRef = ref(db, `engagement/${animeId}/likes/${uid}`);
    const dislikeRef = ref(db, `engagement/${animeId}/dislikes/${uid}`);
    try {
      if (mine === kind) {
        await remove(kind === "like" ? likeRef : dislikeRef);
        setMine(null);
      } else {
        await set(kind === "like" ? likeRef : dislikeRef, { ts: Date.now() });
        await remove(kind === "like" ? dislikeRef : likeRef).catch(() => {});
        setMine(kind);
      }
    } catch {
      toast.error("Failed to update reaction");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex items-center rounded-full border border-border bg-foreground/[0.06] overflow-hidden">
        <button
          onClick={() => react("like")}
          disabled={busy}
          aria-pressed={mine === "like"}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-all active:scale-95 ${mine === "like" ? "text-primary" : "text-foreground/85 hover:text-foreground"}`}
        >
          <ThumbsUp className={`w-3.5 h-3.5 ${mine === "like" ? "fill-primary" : ""}`} strokeWidth={2} />
          <span className="tabular-nums min-w-[1ch]">{formatCount(likes)}</span>
        </button>
        <div className="h-4 w-px bg-border" />
        <button
          onClick={() => react("dislike")}
          disabled={busy}
          aria-pressed={mine === "dislike"}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-all active:scale-95 ${mine === "dislike" ? "text-destructive" : "text-foreground/85 hover:text-foreground"}`}
        >
          <ThumbsDown className={`w-3.5 h-3.5 ${mine === "dislike" ? "fill-destructive" : ""}`} strokeWidth={2} />
          <span className="tabular-nums min-w-[1ch]">{formatCount(dislikes)}</span>
        </button>
      </div>
      <div className="ml-auto flex items-center gap-1.5 rounded-full border border-border bg-foreground/[0.06] px-3 py-1.5 text-[11px] font-semibold text-foreground/85">
        <Eye className="w-3.5 h-3.5 text-primary" strokeWidth={2} />
        <span className="tabular-nums">{formatCount(views)}</span>
        <span className="text-muted-foreground font-medium">views</span>
      </div>
    </div>
  );
};

export default VideoReactionsBar;
