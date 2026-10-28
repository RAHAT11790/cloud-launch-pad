import { memo, useRef } from "react";
import { ChevronRight } from "lucide-react";
import AnimeCard from "./AnimeCard";
import AnimatedTitle from "./AnimatedTitle";
import RailArrows from "./RailArrows";
import type { AnimeItem } from "@/data/animeData";

interface AnimeSectionProps {
  title: string;
  items: AnimeItem[];
  onCardClick: (anime: AnimeItem) => void;
  onViewAll?: () => void;
  showWhenEmpty?: boolean;
}

const AnimeSection = ({ title, items, onCardClick, onViewAll, showWhenEmpty = false }: AnimeSectionProps) => {
  const rowRef = useRef<HTMLDivElement>(null);
  if (items.length === 0 && !showWhenEmpty) return null;

  return (
    <section className="rail-section py-5 -mt-10 relative z-20 first:mt-0">
      <div className="rail-head flex justify-between items-center px-4 mb-3">
        <h3 className="text-base font-bold flex items-center category-bar"><AnimatedTitle title={title} /></h3>
        {onViewAll && (
          <button onClick={onViewAll} className="text-primary text-xs font-semibold flex items-center gap-1 transition-all hover:gap-2">
            View All <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="rail-body relative">
        <div ref={rowRef} data-no-swipe="true" className="rail-row flex gap-2.5 overflow-x-auto px-4 pb-3.5 snap-x snap-mandatory no-scrollbar" style={{ touchAction: "pan-x pan-y" }}>
          {items.length > 0 ? items.map((anime) => (
            <AnimeCard key={anime.id} anime={anime} onClick={onCardClick} />
          )) : (
            <div className="py-2 text-xs text-muted-foreground">No anime found</div>
          )}
        </div>
        {items.length > 0 && <RailArrows targetRef={rowRef} />}
      </div>
    </section>
  );
};

// Rows get fresh `items` arrays each parent render; skip work when the same anime are shown.
const sameItems = (a: AnimeItem[], b: AnimeItem[]) => a.length === b.length && a.every((x, i) => x === b[i]);
export default memo(AnimeSection, (p, n) => p.title === n.title && p.onCardClick === n.onCardClick && p.showWhenEmpty === n.showWhenEmpty && !!p.onViewAll === !!n.onViewAll && sameItems(p.items, n.items));
