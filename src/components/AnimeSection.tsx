import { ChevronRight } from "lucide-react";
import AnimeCard from "./AnimeCard";
import type { AnimeItem } from "@/data/animeData";

interface AnimeSectionProps {
  title: string;
  items: AnimeItem[];
  onCardClick: (anime: AnimeItem) => void;
  onViewAll?: () => void;
}

const AnimeSection = ({ title, items, onCardClick, onViewAll }: AnimeSectionProps) => {
  if (items.length === 0) return null;

  return (
    <div className="py-5 -mt-10 relative z-20 first:mt-0">
      <div className="flex justify-between items-center px-4 mb-3">
        <h3 className="text-base font-bold flex items-center category-bar">{title}</h3>
        {onViewAll && (
          <button onClick={onViewAll} className="text-primary text-xs font-semibold flex items-center gap-1 transition-all hover:gap-2">
            View All <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex gap-2.5 overflow-x-auto px-4 pb-3.5 snap-x snap-mandatory no-scrollbar">
        {items.map((anime) => (
          <AnimeCard key={anime.id} anime={anime} onClick={onCardClick} />
        ))}
      </div>
    </div>
  );
};

export default AnimeSection;
