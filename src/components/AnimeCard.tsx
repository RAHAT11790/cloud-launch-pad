import { memo, useState, useEffect, useMemo } from "react";
import { Star, Heart, Crown } from "lucide-react";
import type { AnimeItem } from "@/data/animeData";
import { db, ref, set, remove, get } from "@/lib/firebase";
import { optimizedImageUrl } from "@/lib/imageCache";

const watchlistCacheByUser = new Map<string, Set<string>>();
const watchlistLoadByUser = new Map<string, Promise<Set<string>>>();

const loadWatchlistIds = (userId: string) => {
  const cached = watchlistCacheByUser.get(userId);
  if (cached) return Promise.resolve(cached);
  const pending = watchlistLoadByUser.get(userId);
  if (pending) return pending;
  const load = get(ref(db, `users/${userId}/watchlist`))
    .then((snap) => {
      const ids = new Set<string>(Object.keys(snap.val() || {}));
      watchlistCacheByUser.set(userId, ids);
      watchlistLoadByUser.delete(userId);
      return ids;
    })
    .catch(() => {
      watchlistLoadByUser.delete(userId);
      return new Set<string>();
    });
  watchlistLoadByUser.set(userId, load);
  return load;
};

interface AnimeCardProps {
  anime: AnimeItem;
  onClick: (anime: AnimeItem) => void;
}

const AnimeCard = ({ anime, onClick }: AnimeCardProps) => {
  const [isInWatchlist, setIsInWatchlist] = useState(false);

  const getUserId = (): string | null => {
    try { const u = localStorage.getItem("rsanime_user"); if (u) return JSON.parse(u).id; } catch {} return null;
  };

  const userId = getUserId();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const cached = watchlistCacheByUser.get(userId);
    if (cached) {
      if (cached.has(anime.id)) setIsInWatchlist(true);
      return;
    }
    void loadWatchlistIds(userId)
      .then((ids) => {
        if (!cancelled && ids.has(anime.id)) setIsInWatchlist(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, anime.id]);

  const toggleWatchlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!userId) return;
    if (isInWatchlist) {
      setIsInWatchlist(false);
      watchlistCacheByUser.get(userId)?.delete(anime.id);
      remove(ref(db, `users/${userId}/watchlist/${anime.id}`));
    } else {
      setIsInWatchlist(true);
      const ids = watchlistCacheByUser.get(userId) || new Set<string>();
      ids.add(anime.id);
      watchlistCacheByUser.set(userId, ids);
      set(ref(db, `users/${userId}/watchlist/${anime.id}`), {
        id: anime.id, title: anime.title, poster: anime.poster,
        year: anime.year, rating: anime.rating, type: anime.type, addedAt: Date.now(),
      });
    }
  };

  // ---- Compute language label (handles both RS and AnimeSalt; merges audio tracks) ----
  const languageLabel = useMemo(() => {
    const set = new Set<string>();
    const push = (raw?: string) => {
      if (!raw) return;
      String(raw).split(/[,/|]+/).forEach((s) => {
        const t = s.trim();
        if (t) set.add(t);
      });
    };
    (anime.availableLanguages || []).forEach((lang) => push(lang));
    push(anime.baseLanguage || anime.language);
    const arr = Array.from(set).filter(Boolean);
    if (arr.length === 0) return "";
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return "Dual";
    return "Multiple";
  }, [anime.availableLanguages, anime.baseLanguage, anime.language]);

  // ---- Episode / season count ----
  const epInfo = useMemo(() => {
    if (anime.type === "movie") return "Movie";
    if (anime.seasons && anime.seasons.length > 0) {
      const total = anime.seasons.reduce((sum: number, s: any) => sum + ((s.episodes || []).length), 0);
      if (total > 0) {
        return anime.seasons.length > 1
          ? `${anime.seasons.length}S · ${total} EP`
          : `${total} EP`;
      }
    }
    if (typeof (anime as any).episodeCount === "number" && (anime as any).episodeCount > 0) {
      return `${(anime as any).episodeCount} EP`;
    }
    return "";
  }, [anime]);

  const sourceBadge = useMemo(() => {
    const isAn = anime.source === "animesalt"
      || String(anime.id || "").startsWith("as_")
      || String(anime.id || "").startsWith("an_")
      || /animesalt/i.test(String(anime.sourceName || ""))
      || !!anime.anSlug
      || !!anime.animeSaltSlug
      || String(anime.displayAs || "").toLowerCase() === "an";
    return isAn ? "AN" : "RS";
  }, [anime]);

  const isPremium = !!(anime as any).premium;
  const lockedEpisodes = useMemo(() => {
    const eps = (anime as any).premiumEpisodes || {};
    return Object.values(eps).filter(Boolean).length;
  }, [(anime as any).premiumEpisodes]);

  return (
    <div
      data-anime-card="true"
      role="button"
      tabIndex={0}
      className={`relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover min-w-[120px] max-w-[140px] flex-shrink-0 transition-transform duration-150 ease-out active:scale-[0.94] active:brightness-90 ${
        isPremium ? "premium-card-glow ring-1 ring-amber-400/50" : ""
      }`}
      onClick={() => onClick(anime)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(anime); } }}
      onPointerDown={() => { try { (window as any).__rsPrefetchAnime?.(anime); } catch {} }}
      style={{
        boxShadow: isPremium ? "0 6px 24px -6px rgba(251,191,36,0.45)" : "var(--neu-shadow-sm)",
        background: "linear-gradient(135deg, hsl(var(--muted)) 0%, hsl(var(--card)) 100%)",
      }}
    >
      <img
        src={optimizedImageUrl(anime.poster, "poster")}
        alt={anime.title}
        className="poster-img w-full h-full object-cover"
        loading="eager"
        decoding="async"
      />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.25) 45%, transparent 75%)" }} />
      <button
        className={`absolute top-1.5 left-1.5 w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110 z-10 ${
          isInWatchlist
            ? "bg-primary text-primary-foreground"
            : "bg-background/85 text-foreground hover:bg-primary hover:text-primary-foreground border border-border/40 backdrop-blur-sm"
        }`}
        onClick={toggleWatchlist}
        style={{ boxShadow: "var(--neu-shadow-sm)" }}
      >
        <Heart className={`w-3.5 h-3.5 ${isInWatchlist ? "fill-current" : "fill-current/20"}`} />
      </button>
      <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 z-10">
        {languageLabel && (
          <span
            className="px-1.5 py-0.5 rounded-md text-[8px] font-bold bg-black/75 text-white"
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
          >
            {languageLabel}
          </span>
        )}
        <span
          className={`px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider ${
            sourceBadge === "AN"
              ? "bg-accent/85 text-accent-foreground"
              : "bg-primary/85 text-primary-foreground"
          }`}
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
        >
          {sourceBadge}
        </span>
        {isPremium && (
          <span
            className="premium-shine flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider bg-gradient-to-r from-amber-400 to-yellow-500 text-black"
            style={{ textShadow: "0 1px 1px rgba(255,255,255,0.4)" }}
          >
            <Crown className="w-2 h-2" /> PRO
          </span>
        )}
        {!isPremium && lockedEpisodes > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[7px] font-bold bg-amber-500/85 text-black flex items-center gap-0.5">
            <Crown className="w-2 h-2" /> {lockedEpisodes}
          </span>
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-2">
        <p className="text-[10px] font-semibold leading-tight line-clamp-2 text-white" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}>
          {anime.title}
        </p>
        <div className="flex items-center justify-between mt-1 gap-1">
          <p className="text-[8px] text-white/85 flex items-center gap-1">
            <Star className="w-2 h-2 text-primary" /> {anime.rating}
            <span className="opacity-60">· {anime.year}</span>
          </p>
          {epInfo && (
            <span className="text-[8px] font-semibold text-white bg-white/15 px-1.5 py-0.5 rounded">
              {epInfo}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(AnimeCard, (prev, next) => prev.anime === next.anime);
