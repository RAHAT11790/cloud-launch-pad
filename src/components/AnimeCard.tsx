import { memo, useState, useEffect } from "react";
import { Star, Heart } from "lucide-react";
import type { AnimeItem } from "@/data/animeData";
import { db, ref, set, remove, get } from "@/lib/firebase";
import { useBranding } from "@/hooks/useBranding";

interface AnimeCardProps {
  anime: AnimeItem;
  onClick: (anime: AnimeItem) => void;
}

const AnimeCard = ({ anime, onClick }: AnimeCardProps) => {
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const branding = useBranding();

  const getUserId = (): string | null => {
    try { const u = localStorage.getItem("rsanime_user"); if (u) return JSON.parse(u).id; } catch {} return null;
  };

  const userId = getUserId();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void get(ref(db, `users/${userId}/watchlist/${anime.id}`))
      .then((snap) => {
        if (!cancelled) setIsInWatchlist(snap.exists());
      })
      .catch(() => {
        if (!cancelled) setIsInWatchlist(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, anime.id]);

  const toggleWatchlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!userId) return;
    if (isInWatchlist) {
      setIsInWatchlist(false);
      remove(ref(db, `users/${userId}/watchlist/${anime.id}`));
    } else {
      setIsInWatchlist(true);
      set(ref(db, `users/${userId}/watchlist/${anime.id}`), {
        id: anime.id, title: anime.title, poster: anime.poster,
        year: anime.year, rating: anime.rating, type: anime.type, addedAt: Date.now(),
      });
    }
  };

  // ---- Compute language label (handles both RS and AnimeSalt; merges audio tracks) ----
  const languageLabel = (() => {
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
    if (anime.seasons) {
      anime.seasons.forEach((s: any) => {
        (s.episodes || []).forEach((ep: any) => {
          (ep.audioTracks || []).forEach((at: any) => push(at.language || at.label));
        });
      });
    }
    const arr = Array.from(set).filter(Boolean);
    if (arr.length === 0) return "";
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return "Dual";
    return "Multiple";
  })();

  // ---- Episode / season count ----
  const epInfo = (() => {
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
  })();

  return (
    <div
      data-anime-card="true"
      className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover min-w-[120px] max-w-[140px] flex-shrink-0"
      onClick={() => onClick(anime)}
      style={{
        boxShadow: "var(--neu-shadow-sm)",
        background: "linear-gradient(135deg, hsl(var(--muted)) 0%, hsl(var(--card)) 100%)",
      }}
    >
      <img
        src={anime.poster}
        alt={anime.title}
        className={`poster-img w-full h-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
        loading="eager"
        decoding="async"
        fetchPriority="low"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.25) 45%, transparent 75%)" }} />
      <button
        className={`absolute top-1.5 left-1.5 w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110 z-10 ${
          isInWatchlist ? "bg-primary" : "bg-white/80 hover:bg-primary"
        }`}
        onClick={toggleWatchlist}
        style={{ boxShadow: "var(--neu-shadow-sm)" }}
      >
        <Heart className={`w-3.5 h-3.5 ${isInWatchlist ? "fill-white text-white" : "text-foreground"}`} />
      </button>
      <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 z-10">
        {languageLabel && (
          <span
            className="px-1.5 py-0.5 rounded-md text-[8px] font-bold bg-black/75 text-white backdrop-blur-sm"
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
          >
            {languageLabel}
          </span>
        )}
        <span
          className={`px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider ${
            anime.source === "animesalt"
              ? "bg-accent/85 text-accent-foreground"
              : "bg-primary/85 text-primary-foreground"
          }`}
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
        >
          {anime.source === "animesalt" ? branding.anCardLabel : branding.rsCardLabel}
        </span>
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
            <span className="text-[8px] font-semibold text-white bg-white/15 backdrop-blur-sm px-1.5 py-0.5 rounded">
              {epInfo}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(AnimeCard, (prev, next) => prev.anime === next.anime);
