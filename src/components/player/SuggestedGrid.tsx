import { memo } from "react";
import type { AnimeItem } from "@/data/animeData";
import { optimizedImageUrl } from "@/lib/imageCache";

interface Props {
  items: AnimeItem[];
  pendingId: string | null;
  onPick: (anime: AnimeItem) => void;
}

/** "For you" grid under the player — memoized so playback ticks never redraw it. */
const SuggestedGrid = memo(({ items, pendingId, onPick }: Props) => (
  <div className="grid grid-cols-3 gap-2.5">
    {items.slice(0, 15).map((anime, idx) => {
      const isPending = pendingId === anime.id;
      const busy = !!pendingId && !isPending;
      return (
        <button
          key={anime.id}
          onClick={() => onPick(anime)}
          disabled={busy}
          className={`group suggest-card text-left transition-transform duration-150 ${isPending ? "scale-95" : "active:scale-95"} ${busy ? "opacity-50" : ""}`}
        >
          <div className={`relative aspect-[2/3] rounded-xl overflow-hidden bg-foreground/5 ring-1 ring-border/40 ${isPending ? "magic-card-pulse" : ""}`}>
            {anime.poster ? (
              <img src={optimizedImageUrl(anime.poster, "poster")} alt={anime.title} loading={idx < 6 ? "eager" : "lazy"} decoding="async" draggable={false} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No image</div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent)" }} />
            {anime.language && <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-[9px] font-bold leading-none text-white">{anime.language}</span>}
            {(anime.rating || anime.year) && (
              <span className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1 text-[9px] font-semibold text-white/90 leading-none">
                {anime.rating ? <span>★ {anime.rating}</span> : null}
                {anime.rating && anime.year ? <span className="opacity-50">·</span> : null}
                {anime.year ? <span>{anime.year}</span> : null}
              </span>
            )}
          </div>
          <p className={`text-[12px] font-semibold line-clamp-2 leading-tight mt-1.5 ${isPending ? "text-primary" : "text-foreground"}`}>{anime.title}</p>
        </button>
      );
    })}
  </div>
));
SuggestedGrid.displayName = "SuggestedGrid";
export default SuggestedGrid;
