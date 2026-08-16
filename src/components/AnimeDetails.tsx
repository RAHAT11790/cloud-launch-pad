import { useState, useEffect, useCallback, forwardRef } from "react";
import { X, Play, Heart, Star, BookOpen, List, ArrowLeft, MessageCircle, Send, Trash2, Share2, Check, Reply, ChevronDown, ChevronUp } from "lucide-react";
import type { AnimeItem } from "@/data/animeData";
import { motion } from "framer-motion";
import { db, ref, set, remove, onValue, push } from "@/lib/firebase";
import { getAnimeTitleStyle } from "@/lib/animeFonts";
// FCM removed — in-app notifications only
import { SITE_URL } from "@/lib/siteConfig";
import { useBranding } from "@/hooks/useBranding";

interface AnimeDetailsProps {
  anime: AnimeItem;
  onClose: () => void;
  onPlay: (anime: AnimeItem, seasonIdx?: number, epIdx?: number) => void;
}

interface CommentData {
  key: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
  replies?: Record<string, ReplyData>;
}

interface ReplyData {
  key: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
}

const AnimeDetails = forwardRef<HTMLDivElement, AnimeDetailsProps>(({ anime, onClose, onPlay }, _ref) => {
  const branding = useBranding();
  const sourceBadge = anime.source === "animesalt" || String(anime.id || "").startsWith("an_") || String(anime.id || "").startsWith("as_") || !!anime.anSlug || !!anime.animeSaltSlug
    ? "AN"
    : "RS";
  const genres = Array.isArray(anime.genres) ? anime.genres.filter(Boolean) : [];
  const displayCategory = genres.length ? genres.join(", ") : anime.category;
  const storyline = anime.storyline || (anime as any).overview || "No storyline available yet.";
  const directors = Array.isArray(anime.directors) ? anime.directors.filter(Boolean).slice(0, 4) : [];
  const cast = Array.isArray(anime.cast) ? anime.cast.filter((p) => p?.name || p?.character || p?.photo).slice(0, 12) : [];
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [comments, setComments] = useState<CommentData[]>([]);
  const [commentText, setCommentText] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  // Active "NEW" ranges from admin's notification publishing (per season)
  // Map: seasonNumber -> array of { start, end, ts }
  const [newRanges, setNewRanges] = useState<Record<number, { start: number; end: number; ts: number }[]>>({});

  useEffect(() => {
    const r = ref(db, "newEpisodeReleases");
    const unsub = onValue(r, (snap) => {
      const data = snap.val() || {};
      const NEW_WINDOW_MS = 36 * 60 * 60 * 1000;
      const now = Date.now();
      const map: Record<number, { start: number; end: number; ts: number }[]> = {};
      Object.values<any>(data).forEach((rel) => {
        if (!rel || rel.active === false) return;
        if (rel.contentId !== anime.id) return;
        const ts = Number(rel.timestamp || 0);
        if (!ts || now - ts > NEW_WINDOW_MS) return;
        const info = rel.episodeInfo || {};
        const sNum = Number(info.seasonNumber || 0);
        const start = Number(info.episodeNumber || 0);
        const end = Number(info.episodeNumberEnd || info.episodeNumber || 0);
        if (!sNum || !start) return;
        if (!map[sNum]) map[sNum] = [];
        map[sNum].push({ start, end: Math.max(end, start), ts });
      });
      setNewRanges(map);
    });
    return () => unsub();
  }, [anime.id]);

  const getUserId = (): string | null => {
    try { const u = localStorage.getItem("rsanime_user"); if (u) return JSON.parse(u).id; } catch {} return null;
  };
  const userId = getUserId();

  const getUserName = useCallback((): string => {
    try { return localStorage.getItem("rs_display_name") || JSON.parse(localStorage.getItem("rsanime_user") || "{}").name || "User"; } catch { return "User"; }
  }, []);

  useEffect(() => {
    if (!userId) return;
    const wlRef = ref(db, `users/${userId}/watchlist/${anime.id}`);
    const unsub = onValue(wlRef, (snap) => setIsInWatchlist(snap.exists()));
    return () => unsub();
  }, [userId, anime.id]);

  // Load comments with replies
  useEffect(() => {
    const commRef = ref(db, `comments/${anime.id}`);
    const unsub = onValue(commRef, (snap) => {
      const data = snap.val() || {};
      const list: CommentData[] = Object.entries(data).map(([key, val]: any) => {
        const replies: Record<string, ReplyData> = {};
        if (val.replies) {
          Object.entries(val.replies).forEach(([rKey, rVal]: any) => {
            replies[rKey] = { key: rKey, userId: rVal.userId, userName: rVal.userName, text: rVal.text, timestamp: rVal.timestamp };
          });
        }
        return { key, userId: val.userId, userName: val.userName, text: val.text, timestamp: val.timestamp || 0, replies };
      });
      list.sort((a, b) => b.timestamp - a.timestamp);
      setComments(list);
    });
    return () => unsub();
  }, [anime.id]);

  const postComment = useCallback(() => {
    if (!userId || !commentText.trim()) return;
    const text = commentText.trim();
    const userName = getUserName();
    // Optimistic: clear input immediately
    setCommentText("");
    const newRef = push(ref(db, `comments/${anime.id}`));
    set(newRef, { userId, userName, text, timestamp: Date.now() })
      .catch((err) => {
        console.error("Comment post failed:", err);
        setCommentText(text); // Restore on failure
        import("sonner").then(({ toast }) => toast.error("Failed to post comment. Please try again."));
      });
  }, [userId, commentText, anime.id, getUserName]);

  const postReply = useCallback(async (commentKey: string) => {
    if (!userId || !replyText.trim()) return;

    const text = replyText.trim();
    const userName = getUserName();
    const targetComment = comments.find((c) => c.key === commentKey);

    setReplyText("");
    setReplyingTo(null);
    setExpandedReplies(prev => new Set(prev).add(commentKey));

    try {
      const now = Date.now();
      const replyRef = push(ref(db, `comments/${anime.id}/${commentKey}/replies`));
      await set(replyRef, { userId, userName, text, timestamp: now });

    } catch (err) {
      console.error("Reply post failed:", err);
      setReplyText(text);
      import("sonner").then(({ toast }) => toast.error("Failed to post reply. Please try again."));
    }
  }, [userId, replyText, anime.id, anime.poster, anime.title, anime.type, comments, getUserName]);

  const deleteComment = (commentKey: string) => {
    remove(ref(db, `comments/${anime.id}/${commentKey}`))
      .catch(() => import("sonner").then(({ toast }) => toast.error("Failed to delete")));
  };

  const deleteReply = (commentKey: string, replyKey: string) => {
    remove(ref(db, `comments/${anime.id}/${commentKey}/replies/${replyKey}`))
      .catch(() => import("sonner").then(({ toast }) => toast.error("Failed to delete")));
  };

  const toggleWatchlist = () => {
    if (!userId) return;
    if (isInWatchlist) {
      remove(ref(db, `users/${userId}/watchlist/${anime.id}`));
    } else {
      set(ref(db, `users/${userId}/watchlist/${anime.id}`), {
        id: anime.id, title: anime.title, poster: anime.poster,
        year: anime.year, rating: anime.rating, type: anime.type, addedAt: Date.now(),
      });
    }
  };

  const toggleReplies = (commentKey: string) => {
    setExpandedReplies(prev => {
      const next = new Set(prev);
      if (next.has(commentKey)) next.delete(commentKey);
      else next.add(commentKey);
      return next;
    });
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
      className="fixed inset-0 z-[200] bg-background overflow-y-auto"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "tween", duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
    >
      {/* Header Image */}
      <div className="relative w-full h-[45vh] min-h-[300px] overflow-hidden">
        <img src={anime.backdrop} alt={anime.title} className="w-full h-full object-cover" />
        <div className="absolute inset-0" style={{
          background: "linear-gradient(to top, hsl(var(--background)) 0%, hsl(var(--background) / 0.4) 40%, transparent 60%), linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 25%)"
        }} />
        <div className="absolute bottom-6 left-0 right-0 px-5 text-center">
          <h1 className="text-2xl font-extrabold mb-2" style={{ ...getAnimeTitleStyle(anime.title), textShadow: "0 4px 20px rgba(0,0,0,0.9)" }}>
            {anime.title}
          </h1>
          <div className="flex items-center justify-center gap-2 text-[11px] text-secondary-foreground flex-wrap">
            {anime.rating && (
              <span className="bg-accent px-2.5 py-1 rounded text-accent-foreground font-semibold shadow-[0_2px_10px_hsla(38,90%,55%,0.4)] flex items-center gap-1">
                <Star className="w-3 h-3" /> {anime.rating}
              </span>
            )}
            {anime.year && <span>{anime.year}</span>}
            <span>{anime.language}</span>
            <span className="bg-foreground/15 px-2.5 py-1 rounded text-[10px] backdrop-blur-[10px]">
              {anime.type === "webseries" ? "Series" : "Movie"}
            </span>
            <span className={`px-2.5 py-1 rounded text-[10px] font-black tracking-wider ${
              anime.source === "animesalt"
                ? "bg-accent/85 text-accent-foreground"
                : "bg-primary/85 text-primary-foreground"
            }`}>
              {sourceBadge === "AN" ? (branding.anCardLabel || "AN") : (branding.rsCardLabel || "RS")}
            </span>
          </div>
        </div>
      </div>


      {/* Back button */}
      <button onClick={onClose}
        className="fixed left-4 top-5 w-10 h-10 rounded-full bg-background/70 backdrop-blur-[20px] border-2 border-foreground/20 flex items-center justify-center z-[210] transition-all hover:bg-primary hover:border-primary hover:scale-110">
        <ArrowLeft className="w-5 h-5" />
      </button>

      {/* Content */}
      <div className="relative px-4 pb-24 z-10">
        <div className="flex gap-2.5 mb-5">
          <button
            onClick={() => {
              const hasMultiParts = anime.type === "movie" && Array.isArray(anime.parts) && anime.parts.length > 1;
              const hasSinglePart = anime.type === "movie" && Array.isArray(anime.parts) && anime.parts.length === 1;
              if ((anime.type === "webseries" && anime.seasons) || hasMultiParts) { onPlay(anime, 0, 0); }
              else if (hasSinglePart) { onPlay(anime, 0, 0); }
              else { onPlay(anime); }
            }}
            className="flex-1 py-3 rounded-xl gradient-primary font-bold text-sm flex items-center justify-center gap-2 btn-glow">
            {anime.type === "webseries" ? <><List className="w-4 h-4" /> Watch</> : (Array.isArray(anime.parts) && anime.parts.length > 1 ? <><List className="w-4 h-4" /> Watch</> : <><Play className="w-4 h-4" /> Play</>)}
          </button>
          <button onClick={toggleWatchlist}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 border transition-all hover:-translate-y-0.5 ${
              isInWatchlist ? "bg-primary/20 border-primary text-primary" : "bg-foreground/10 backdrop-blur-[20px] border-foreground/20 hover:bg-foreground/20"
            }`}>
            <Heart className={`w-4 h-4 ${isInWatchlist ? "fill-primary" : ""}`} />
            {isInWatchlist ? "In Watchlist" : "Watchlist"}
          </button>
        </div>

        {/* Share button */}
        <button
          onClick={() => {
            const url = `${SITE_URL}/watch/${encodeURIComponent(anime.id)}`;
            navigator.clipboard.writeText(url).then(() => {
              setShareCopied(true);
              setTimeout(() => setShareCopied(false), 2000);
            }).catch(() => {
              const ta = document.createElement("textarea");
              ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
              setShareCopied(true);
              setTimeout(() => setShareCopied(false), 2000);
            });
          }}
          className="w-full py-3 rounded-xl bg-secondary border border-foreground/20 font-semibold text-sm flex items-center justify-center gap-2 mb-5 transition-all hover:-translate-y-0.5 hover:border-primary"
        >
          {shareCopied ? <><Check className="w-4 h-4 text-green-400" /> Link Copied!</> : <><Share2 className="w-4 h-4" /> Share</>}
        </button>

        {/* Download Notice Box */}
        <div className="rounded-xl p-4 mb-5 border bg-accent/10 border-accent/30">
          <p className="text-[13px] leading-relaxed text-center font-medium text-foreground">
            😍 You Can Download <span className="font-bold text-primary">{branding.rsCardLabel}</span> Video And Also Watch With Offline Player! 🫠
          </p>
        </div>

        <div className="glass-card p-4 mb-5">
          <h3 className="text-[15px] font-bold mb-2.5 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" /> Storyline
          </h3>
          <p className="text-[13px] leading-relaxed text-secondary-foreground">{storyline}</p>
        </div>

        {(directors.length > 0 || cast.length > 0) && (
          <div className="glass-card p-4 mb-5">
            <h3 className="text-[15px] font-bold mb-3 flex items-center gap-2">
              <Star className="w-4 h-4 text-primary" /> Cast & Crew
            </h3>
            {directors.length > 0 && (
              <p className="text-[12px] text-secondary-foreground mb-3">
                <span className="text-muted-foreground">Director:</span> {directors.join(", ")}
              </p>
            )}
            {cast.length > 0 && (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {cast.map((person, idx) => (
                  <div key={`${person.name}-${idx}`} className="w-[76px] flex-shrink-0 text-center">
                    <div className="w-[58px] h-[58px] mx-auto rounded-full overflow-hidden bg-secondary border border-foreground/10 mb-1.5">
                      {person.photo ? <img src={person.photo} alt={person.name} className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full grid place-items-center text-lg">👤</div>}
                    </div>
                    <p className="text-[10px] font-semibold line-clamp-2">{person.name}</p>
                    {person.character && <p className="text-[9px] text-muted-foreground line-clamp-1">{person.character}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Episode List for webseries */}
        {anime.type === "webseries" && anime.seasons && (
          <div className="mb-5 space-y-4">
            {anime.seasons.map((season, sIdx) => {
              const NEW_WINDOW_MS = 36 * 60 * 60 * 1000;
              const now = Date.now();
              const animeUpdated = Number((anime as any).updatedAt || 0);
              const animeRecent = animeUpdated > 0 && now - animeUpdated < NEW_WINDOW_MS;
              const maxEpNum = season.episodes.reduce((m, e) => Math.max(m, Number(e.episodeNumber || 0)), 0);
              return (
              <div key={sIdx} className="glass-card p-3.5 rounded-xl">
                <h3 className="text-[15px] font-bold mb-3 flex items-center category-bar">{(() => {
                  const m = String(season.name || "").trim().match(/season\s*(\d+)/i);
                  return m ? `Season ${m[1]}` : `Season ${sIdx + 1}`;
                })()}</h3>
                <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1">
                  {season.episodes.map((ep, eIdx) => {
                    const epAddedAt = Number((ep as any).addedAt || 0);
                    const seasonNumMatch = String(season.name || "").trim().match(/season\s*(\d+)/i);
                    const seasonNum = seasonNumMatch ? parseInt(seasonNumMatch[1]) : (sIdx + 1);
                    const epNum = Number(ep.episodeNumber || 0);
                    const inRange = (newRanges[seasonNum] || []).some(rg => epNum >= rg.start && epNum <= rg.end);
                    const isNew = inRange
                      || (epAddedAt > 0 && (now - epAddedAt < NEW_WINDOW_MS))
                      || (epAddedAt === 0 && animeRecent && epNum === maxEpNum);
                    return (
                    <button
                      key={eIdx}
                      onClick={() => onPlay(anime, sIdx, eIdx)}
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-secondary/60 border border-border/30 hover:border-primary hover:bg-primary/10 transition-all group relative"
                    >
                      {/* Thumbnail */}
                      <div className="w-[72px] h-[42px] min-w-[72px] flex-shrink-0 rounded-lg overflow-hidden bg-card relative">
                        <img
                          src={anime.poster}
                          alt={`Ep ${ep.episodeNumber}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play className="w-4 h-4 text-white" fill="white" />
                        </div>
                        <span className="absolute bottom-0.5 right-0.5 text-[8px] font-bold bg-black/70 text-white px-1 rounded">EP {ep.episodeNumber}</span>
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-[13px] font-semibold truncate flex items-center gap-1.5">
                          Episode {ep.episodeNumber}
                          {isNew && (
                            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-gradient-to-r from-red-500 to-pink-500 text-white animate-pulse">NEW</span>
                          )}
                        </p>
                        {ep.title && ep.title !== `Episode ${ep.episodeNumber}` && (
                          <p className="text-[11px] text-muted-foreground truncate">{ep.title}</p>
                        )}
                      </div>
                      <Play className="w-4 h-4 flex-shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                    </button>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        )}

        {/* Parts List for movies with multiple parts */}
        {anime.type === "movie" && Array.isArray(anime.parts) && anime.parts.length > 1 && (
          <div className="mb-5">
            <div className="glass-card p-3.5 rounded-xl">
              <h3 className="text-[15px] font-bold mb-3 flex items-center category-bar">Parts</h3>
              <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1">
                {anime.parts.map((part, pIdx) => (
                  <button
                    key={pIdx}
                    onClick={() => onPlay(anime, 0, pIdx)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-secondary/60 border border-border/30 hover:border-primary hover:bg-primary/10 transition-all group relative"
                  >
                    <div className="w-[72px] h-[42px] min-w-[72px] flex-shrink-0 rounded-lg overflow-hidden bg-card relative">
                      <img src={anime.poster} alt={`Part ${part.partNumber}`} className="w-full h-full object-cover" loading="lazy" />
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="w-4 h-4 text-white" fill="white" />
                      </div>
                      <span className="absolute bottom-0.5 right-0.5 text-[8px] font-bold bg-black/70 text-white px-1 rounded">P {part.partNumber}</span>
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-[13px] font-semibold truncate">Part {part.partNumber}</p>
                      {part.title && <p className="text-[11px] text-muted-foreground truncate">{part.title}</p>}
                    </div>
                    <Play className="w-4 h-4 flex-shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}


        {/* Comments with Reply System */}
        <div className="glass-card p-4 mb-5">
          <h3 className="text-[15px] font-bold mb-3 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-primary" /> Comments ({comments.length})
          </h3>
          {userId && (
            <div className="flex gap-2 mb-3 items-end">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postComment(); } }}
                placeholder="Write a comment..."
                rows={1}
                className="flex-1 bg-secondary border border-foreground/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-primary resize-none min-h-[40px] max-h-[120px]"
                style={{ overflow: "auto" }}
                onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }}
              />
              <button onClick={postComment} className="w-10 h-10 min-w-[40px] rounded-full gradient-primary flex items-center justify-center btn-glow">
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="space-y-2.5 max-h-[400px] overflow-y-auto">
            {comments.length === 0 && <p className="text-[12px] text-muted-foreground text-center py-3">No comments yet</p>}
            {comments.map((c) => {
              const repliesList = c.replies ? Object.values(c.replies).sort((a, b) => a.timestamp - b.timestamp) : [];
              const isExpanded = expandedReplies.has(c.key);
              return (
                <div key={c.key} className="bg-secondary/50 rounded-lg p-2.5">
                  <div className="flex justify-between items-start">
                    <span className="text-[12px] font-semibold text-primary">{c.userName}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground">{timeAgo(c.timestamp)}</span>
                      {c.userId === userId && (
                        <button onClick={() => deleteComment(c.key)} className="text-destructive hover:scale-110 transition-transform">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[12px] text-secondary-foreground mt-1 break-words overflow-wrap-anywhere">{c.text}</p>
                  
                  {/* Reply button & count */}
                  <div className="flex items-center gap-3 mt-1.5">
                    {userId && (
                      <button onClick={() => { setReplyingTo(replyingTo === c.key ? null : c.key); setReplyText(""); }}
                        className="text-[10px] text-primary hover:underline flex items-center gap-1">
                        <Reply className="w-3 h-3" /> Reply
                      </button>
                    )}
                    {repliesList.length > 0 && (
                      <button onClick={() => toggleReplies(c.key)}
                        className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {repliesList.length} {repliesList.length === 1 ? "reply" : "replies"}
                      </button>
                    )}
                  </div>

                  {/* Reply input */}
                  {replyingTo === c.key && (
                    <div className="flex gap-2 mt-2 items-end ml-4">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postReply(c.key); } }}
                        placeholder={`Reply to ${c.userName}...`}
                        rows={1}
                        className="flex-1 bg-background border border-foreground/10 rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-primary resize-none min-h-[32px] max-h-[80px]"
                        onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 80) + "px"; }}
                        autoFocus
                      />
                      <button onClick={() => postReply(c.key)} className="w-8 h-8 min-w-[32px] rounded-full gradient-primary flex items-center justify-center">
                        <Send className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {/* Replies list */}
                  {isExpanded && repliesList.length > 0 && (
                    <div className="ml-4 mt-2 space-y-1.5 border-l-2 border-primary/20 pl-3">
                      {repliesList.map((r) => (
                        <div key={r.key} className="bg-background/50 rounded-md p-2">
                          <div className="flex justify-between items-start">
                            <span className="text-[11px] font-semibold text-accent">{r.userName}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] text-muted-foreground">{timeAgo(r.timestamp)}</span>
                              {r.userId === userId && (
                                <button onClick={() => deleteReply(c.key, r.key)} className="text-destructive hover:scale-110 transition-transform">
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

        {/* Info */}
        <div className="glass-card p-4">
          <div className="flex justify-between text-[12px] mb-2">
            <span className="text-muted-foreground">Category</span>
            <span className="font-medium text-right max-w-[65%]">{displayCategory}</span>
          </div>
          {genres.length > 0 && (
            <div className="flex justify-between text-[12px] mb-2">
              <span className="text-muted-foreground">Genres</span>
              <span className="font-medium text-right max-w-[65%]">{genres.join(", ")}</span>
            </div>
          )}
          {anime.rating && (
            <div className="flex justify-between text-[12px] mb-2">
              <span className="text-muted-foreground">Rating</span>
              <span className="font-medium">★ {anime.rating}</span>
            </div>
          )}
          <div className="flex justify-between text-[12px] mb-2">
            <span className="text-muted-foreground">Language</span>
            <span className="font-medium">{anime.language}</span>
          </div>
          {anime.year && (
            <div className="flex justify-between text-[12px]">
              <span className="text-muted-foreground">Year</span>
              <span className="font-medium">{anime.year}</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
});

AnimeDetails.displayName = "AnimeDetails";

export default AnimeDetails;
