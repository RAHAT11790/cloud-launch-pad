import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import SearchPage from "@/components/SearchPage";
import { useFirebaseData } from "@/hooks/useFirebaseData";
import { useSelectedAnimeSalt } from "@/hooks/useSelectedAnimeSalt";
import type { AnimeItem } from "@/data/animeData";

const SearchPageRoute = () => {
  const navigate = useNavigate();
  const { allAnime: firebaseAnime } = useFirebaseData();
  const { items: animeSaltItems } = useSelectedAnimeSalt();

  const allAnime = useMemo(() => {
    const combined = [...firebaseAnime, ...animeSaltItems];
    combined.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return combined;
  }, [firebaseAnime, animeSaltItems]);

  const handleCardClick = (anime: AnimeItem) => {
    navigate(`/anime/${encodeURIComponent(anime.id)}`);
  };

  const handleClose = () => {
    // Prefer real back navigation; fall back to home if no history.
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return <SearchPage allAnime={allAnime} onClose={handleClose} onCardClick={handleCardClick} />;
};

export default SearchPageRoute;
