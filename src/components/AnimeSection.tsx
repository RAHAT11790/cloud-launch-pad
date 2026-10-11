import { memo } from "react";
import { ChevronRight } from "lucide-react";
import AnimeCard from "./AnimeCard";
import AnimatedTitle from "./AnimatedTitle";
import type { AnimeItem } from "@/data/animeData";

interface AnimeSectionProps {
  title: string;
  items: AnimeItem[];
  onCardClick: (anime: AnimeItem) => void;
  onViewAll?: () => void;
  showWhenEmpty?: boolean;
}

const AnimeSection = ({ title, items, onCardClick, onViewAll, showWhenEmpty = false }: AnimeSectionProps) => {
  if (items.length === 0 && !showWhenEmpty) return null;

  return (
    <section className="rail-section py-5 -mt-10 relative z-20 first:mt-0">
      <div className="flex justify-between items-center px-4 mb-3">
        <h3 className="text-base font-bold flex items-center category-bar"><AnimatedTitle title={title} /></h3>
        {onViewAll && (
          <button onClick={onViewAll} className="text-primary text-xs font-semibold flex items-center gap-1 px-2 py-1 -mr-2 rounded-full transition-[gap,background-color] duration-150 hover:gap-2 active:bg-primary/10">
            View All <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
      <div data-no-swipe="true" className="flex gap-2.5 overflow-x-auto px-4 pb-3.5 snap-x snap-mandatory no-scrollbar" style={{ touchAction: "pan-x pan-y" }}>
        {items.length > 0 ? items.map((anime) => (
          <AnimeCard key={anime.id} anime={anime} onClick={onCardClick} />
        )) : (
          <div className="py-2 text-xs text-muted-foreground">No anime found</div>
        )}
      </div>
    </section>
  );
};

export default memo(AnimeSection);
