import { useState, useEffect, useMemo, useRef, forwardRef } from "react";
import { ArrowLeft, Search, Clock, X } from "lucide-react";
import { type AnimeItem } from "@/data/animeData";
import { motion } from "framer-motion";
import { optimizedImageUrl } from "@/lib/imageCache";

interface SearchPageProps {
  allAnime: AnimeItem[];
  onClose: () => void;
  onCardClick: (anime: AnimeItem) => void;
}

const HISTORY_KEY = "rs_search_history";
const MAX_HISTORY = 20;

const getSearchHistory = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch { return []; }
};

const addToSearchHistory = (animeId: string) => {
  const history = getSearchHistory().filter(id => id !== animeId);
  history.unshift(animeId);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
};

const getSourceBadge = (anime: AnimeItem) => {
  const isAn = anime.source === "animesalt"
    || String(anime.id || "").startsWith("as_")
    || String(anime.id || "").startsWith("an_")
    || /animesalt/i.test(String(anime.sourceName || ""))
    || !!anime.anSlug
    || !!anime.animeSaltSlug
    || String(anime.displayAs || "").toLowerCase() === "an";
  return isAn ? "AN" : "RS";
};

const removeFromHistory = (animeId: string) => {
  const history = getSearchHistory().filter(id => id !== animeId);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
};

const clearHistory = () => {
  localStorage.removeItem(HISTORY_KEY);
};

const SearchPage = forwardRef<HTMLDivElement, SearchPageProps>(({ allAnime, onClose, onCardClick }, _ref) => {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [historyIds, setHistoryIds] = useState<string[]>(getSearchHistory());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 180);
    return () => clearTimeout(t);
  }, [query]);

  // Pre-lowercase titles ONCE for fast filtering
  const indexed = useMemo(
    () => allAnime.map((a) => ({ a, t: a.title.toLowerCase() })),
    [allAnime]
  );

  const results = useMemo(() => {
    if (!debouncedQuery) return [];
    const q = debouncedQuery;
    const out: AnimeItem[] = [];
    for (let i = 0; i < indexed.length; i++) {
      if (indexed[i].t.includes(q)) {
        out.push(indexed[i].a);
        if (out.length >= 60) break;
      }
    }
    return out;
  }, [debouncedQuery, indexed]);

  const historyAnime = useMemo(() => {
    return historyIds
      .map(id => allAnime.find(a => a.id === id))
      .filter(Boolean) as AnimeItem[];
  }, [historyIds, allAnime]);

  const openingCardRef = useRef<string | null>(null);

  const handleCardClick = (anime: AnimeItem) => {
    if (openingCardRef.current === anime.id) return;
    openingCardRef.current = anime.id;
    (document.activeElement as HTMLElement | null)?.blur?.();
    addToSearchHistory(anime.id);
    setHistoryIds(getSearchHistory());
    onCardClick(anime);
    window.setTimeout(() => {
      if (openingCardRef.current === anime.id) openingCardRef.current = null;
    }, 1200);
  };

  // Native onClick fires only after a true tap (browser already filters
  // scroll gestures). Previous onPointerDown handler was opening cards
  // mid-scroll — removed for that reason.
  const handleCardKeyDown = (e: React.KeyboardEvent, anime: AnimeItem) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    handleCardClick(anime);
  };

  const handleRemoveHistory = (e: React.MouseEvent, animeId: string) => {
    e.stopPropagation();
    removeFromHistory(animeId);
    setHistoryIds(getSearchHistory());
  };

  const handleClearAll = () => {
    clearHistory();
    setHistoryIds([]);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[200] bg-background overflow-y-auto px-4 pb-24 pt-5"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <div className="flex items-center gap-2.5 mb-5">
        <button
          onPointerDown={(e) => {
            // Single-tap back: blur input (closes mobile keyboard) and navigate immediately.
            // Without onPointerDown, the virtual keyboard intercepts the first tap and the
            // user has to tap twice — once to dismiss the keyboard, once to actually close.
            e.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur?.();
            onClose();
          }}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:bg-primary bg-card"
          style={{ boxShadow: "var(--neu-shadow-sm)" }}
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search anime..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full py-3 pl-11 pr-4 rounded-xl bg-card text-foreground text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
            style={{ boxShadow: "var(--neu-shadow-inset)" }}
            autoFocus
          />
        </div>
      </div>

      {!query.trim() ? (
        <>
          {historyAnime.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Search History
                </h3>
                <button onClick={handleClearAll} className="text-[11px] text-muted-foreground hover:text-destructive transition-colors">
                  Clear All
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {historyAnime.map((anime) => (
                  <div key={anime.id} data-anime-card="true" role="button" tabIndex={0} className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover touch-manipulation" style={{ boxShadow: "var(--neu-shadow-sm)" }} onClick={() => handleCardClick(anime)} onKeyDown={(e) => handleCardKeyDown(e, anime)}>
                    <img src={optimizedImageUrl(anime.poster, "poster")} alt={anime.title} className="poster-img w-full h-full object-cover" loading="eager" decoding="async" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 40%, transparent 70%)" }} />
                    <button aria-label="Remove from history" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => handleRemoveHistory(e, anime.id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/80 flex items-center justify-center hover:bg-destructive transition-colors z-10">
                      <X className="w-3 h-3" />
                    </button>
                    <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 z-10">
                      <span className="gradient-primary px-2 py-0.5 rounded text-[9px] font-bold text-primary-foreground">{anime.year}</span>
                      {(() => { const badge = getSourceBadge(anime); return <span className={`px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider ${badge === "AN" ? "bg-accent/85 text-accent-foreground" : "bg-primary/85 text-primary-foreground"}`}>{badge}</span>; })()}
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-2">
                      <p className="text-[11px] font-semibold leading-tight line-clamp-2 text-white">{anime.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {historyAnime.length === 0 && (
            <div className="text-center py-12">
              <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center bg-card" style={{ boxShadow: "var(--neu-shadow)" }}>
                <Search className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Search Anime</h3>
              <p className="text-sm text-muted-foreground">Find your favorite series and movies</p>
            </div>
          )}
        </>
      ) : results.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center bg-card" style={{ boxShadow: "var(--neu-shadow)" }}>
            <Search className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No Results Found</h3>
          <p className="text-sm text-muted-foreground">Try a different search term</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {results.map((anime) => (
            <div key={anime.id} className="w-full">
              <div data-anime-card="true" role="button" tabIndex={0} className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover touch-manipulation" style={{ boxShadow: "var(--neu-shadow-sm)" }} onClick={() => handleCardClick(anime)} onKeyDown={(e) => handleCardKeyDown(e, anime)}>
                <img src={optimizedImageUrl(anime.poster, "poster")} alt={anime.title} className="poster-img w-full h-full object-cover" loading="eager" decoding="async" />
                <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 40%, transparent 70%)" }} />
                <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 z-10">
                  <span className="gradient-primary px-2 py-0.5 rounded text-[9px] font-bold text-primary-foreground">{anime.year}</span>
                  {(() => { const badge = getSourceBadge(anime); return <span className={`px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider ${badge === "AN" ? "bg-accent/85 text-accent-foreground" : "bg-primary/85 text-primary-foreground"}`}>{badge}</span>; })()}
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-2">
                  <p className="text-[11px] font-semibold leading-tight line-clamp-2 text-white">{anime.title}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
});

SearchPage.displayName = "SearchPage";

export default SearchPage;
