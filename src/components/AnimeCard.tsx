import { useState, useEffect } from "react";
import { Heart } from "lucide-react";
import type { AnimeItem } from "@/data/animeData";
import { db, ref, set, remove, onValue } from "@/lib/firebase";
import { getAnimeTitleStyle } from "@/lib/animeFonts";
import { useBranding } from "@/hooks/useBranding";
import { getStoredUser, isGuestUser, hasGuestWatchlistItem, setGuestWatchlistItemNotify, removeGuestWatchlistItemNotify, subscribeGuestWatchlist } from "@/lib/guestSession";

interface AnimeCardProps {
  anime: AnimeItem;
  onClick: (anime: AnimeItem) => void;
}

const AnimeCard = ({ anime, onClick }: AnimeCardProps) => {
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const branding = useBranding();

  const getUserId = (): string | null => getStoredUser()?.id || null;

  const userId = getUserId();

  useEffect(() => {
    if (!userId) return;
    if (isGuestUser()) {
      setIsInWatchlist(hasGuestWatchlistItem(anime.id));
      const unsub = subscribeGuestWatchlist(() => setIsInWatchlist(hasGuestWatchlistItem(anime.id)));
      return () => unsub();
    }
    const wlRef = ref(db, `users/${userId}/watchlist/${anime.id}`);
    const unsub = onValue(wlRef, (snap) => setIsInWatchlist(snap.exists()));
    return () => unsub();
  }, [userId, anime.id]);

  const toggleWatchlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!userId) return;
    if (isInWatchlist) {
      if (isGuestUser()) removeGuestWatchlistItemNotify(anime.id);
      else remove(ref(db, `users/${userId}/watchlist/${anime.id}`));
    } else {
      const item = {
        id: anime.id, title: anime.title, poster: anime.poster,
        year: anime.year, rating: anime.rating, type: anime.type, addedAt: Date.now(),
      };
      if (isGuestUser()) setGuestWatchlistItemNotify(anime.id, item);
      else set(ref(db, `users/${userId}/watchlist/${anime.id}`), item);
    }
  };

  return (
    <div
      className="relative aspect-[2/3] rounded-md overflow-hidden cursor-pointer poster-hover bg-card min-w-[120px] max-w-[140px] flex-shrink-0"
      onClick={() => onClick(anime)}
      style={{ boxShadow: "var(--neu-shadow-sm)" }}
    >
      <img src={anime.poster} alt={anime.title} className="w-full h-full object-cover" loading="eager" decoding="async" />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 40%, transparent 70%)" }} />
      <button
        className={`absolute top-1.5 left-1.5 w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110 z-10 ${
          isInWatchlist ? "bg-primary" : "bg-white/80 hover:bg-primary"
        }`}
        onClick={toggleWatchlist}
        style={{ boxShadow: "var(--neu-shadow-sm)" }}
      >
        <Heart className={`w-3.5 h-3.5 ${isInWatchlist ? "fill-white text-white" : "text-foreground"}`} />
      </button>
      <div className="absolute top-1 right-1 flex flex-col items-end gap-0.5 z-10">
        <span
          className="gradient-primary px-1.5 py-[1px] rounded text-[8px] font-bold text-primary-foreground uppercase tracking-wide max-w-[80px] truncate"
          style={{ boxShadow: "0 2px 8px hsla(42,80%,50%,0.3)" }}
          title={anime.langLabel || anime.language}
        >
          {anime.langLabel || anime.language}
        </span>
        <span
          className="px-1 py-[1px] rounded text-[7px] font-black tracking-wider bg-primary/85 text-primary-foreground"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
        >
          RS
        </span>
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-2">
        <p className="text-[10px] font-semibold leading-tight line-clamp-2 text-white" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}>
          {anime.title}
        </p>
      </div>
    </div>
  );
};

export default AnimeCard;
