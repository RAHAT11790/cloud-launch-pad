import { useState, useEffect, forwardRef } from "react";
import { Zap, ChevronRight, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { db, ref, onValue } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";
import { getAnimeTitleStyle } from "@/lib/animeFonts";

interface EpisodeRelease {
  id: string;
  contentId: string;
  title?: string;
  poster?: string;
  year?: string;
  rating?: string;
  season?: number;
  episode?: number;
  seasonName?: string;
  timestamp: number;
  active?: boolean;
}

interface NewEpisodeReleasesProps {
  allAnime: AnimeItem[];
  onCardClick: (anime: AnimeItem) => void;
}

const NewEpisodeReleases = forwardRef<HTMLDivElement, NewEpisodeReleasesProps>(({ allAnime, onCardClick }, _ref) => {
  const [releases, setReleases] = useState<EpisodeRelease[]>([]);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const relRef = ref(db, "newEpisodeReleases");
    const unsub = onValue(relRef, (snapshot) => {
      const data = snapshot.val() || {};
      const items: EpisodeRelease[] = [];
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        items.push({ id, ...item });
      });
      items.sort((a, b) => b.timestamp - a.timestamp);
      setReleases(items);
    });
    return () => unsub();
  }, []);

  // Filter active releases within 30 days - only RS Anime content (no AnimeSalt)
  const activeReleases = releases.filter(
    (r) => r.active !== false && Date.now() - r.timestamp < 30 * 24 * 60 * 60 * 1000
      && (r as any).contentType !== "animesalt"
  );

  if (activeReleases.length === 0) return null;

  const getContent = (contentId: string) => allAnime.find((a) => a.id === contentId);

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

  const handleClick = (release: EpisodeRelease) => {
    const content = getContent(release.contentId);
    if (content) onCardClick(content);
  };

  return (
    <>
      <div className="px-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold flex items-center gap-2 category-bar">
            <Zap className="w-4 h-4 text-accent" />
            New Episode Release
          </h3>
          <button
            onClick={() => setShowModal(true)}
            className="text-xs text-primary flex items-center gap-1 hover:underline"
          >
            View All <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {activeReleases.slice(0, 10).map((release) => {
            const content = getContent(release.contentId);
            const poster = content?.poster || release.poster || "";
            const title = content?.title || release.title || "Unknown";
            const year = content?.year || release.year || "N/A";
            const rating = content?.rating || release.rating || "N/A";

            return (
              <div
                key={release.id}
                className="relative flex-shrink-0 w-[120px] cursor-pointer group"
                onClick={() => handleClick(release)}
              >
                <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-card">
                  {/* NEW badge */}
                  <div className="absolute top-1.5 left-1.5 z-10 bg-gradient-to-r from-accent to-pink-500 text-white text-[9px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5" /> NEW
                  </div>
                  <img src={poster} alt={title} className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 40%, transparent 70%)" }} />
                  <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 z-10">
                    <span className="gradient-primary px-2 py-0.5 rounded text-[9px] font-bold">{year}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider ${content?.source === "animesalt" ? "bg-accent/85 text-accent-foreground" : "bg-primary/85 text-primary-foreground"}`}>{content?.source === "animesalt" ? "AN" : "RS"}</span>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <p className="text-[11px] font-semibold leading-tight line-clamp-2" style={getAnimeTitleStyle(title)}>{title}</p>
                    {(release.season || release.episode) && (
                      <p className="text-[9px] text-accent mt-0.5">
                        {release.seasonName || (release.season ? `Season ${release.season}` : "")}
                        {release.season && release.episode ? " • " : ""}
                        {release.episode ? `Episode ${release.episode}` : ""}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      ⭐ {rating}
                      <span className="ml-1.5 text-[8px]">{timeAgo(release.timestamp)}</span>
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* View All Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/95 flex items-center justify-center p-5"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-card rounded-2xl w-full max-w-[500px] max-h-[80vh] overflow-hidden"
            >
              <div className="flex justify-between items-center px-5 py-4 border-b border-border/30">
                <h3 className="text-lg font-bold">All New Episode Releases</h3>
                <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto max-h-[60vh] p-5 space-y-2.5">
                {activeReleases.map((release) => {
                  const content = getContent(release.contentId);
                  if (!content) return null;
                  return (
                    <div
                      key={release.id}
                      onClick={() => { handleClick(release); setShowModal(false); }}
                      className="flex gap-4 p-3 rounded-xl bg-foreground/5 cursor-pointer transition-all hover:bg-primary/20 hover:translate-x-1"
                    >
                      <img src={content.poster} alt={content.title} className="w-[60px] h-[80px] rounded-lg object-cover flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold mb-1" style={getAnimeTitleStyle(content.title)}>{content.title}</h4>
                        {(release.seasonName || release.episode) && (
                          <p className="text-xs text-muted-foreground mb-1">
                            {release.seasonName || "New Season"} • Episode {release.episode || "New"}
                          </p>
                        )}
                        <span className="text-[10px] text-primary/70">{timeAgo(release.timestamp)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});

NewEpisodeReleases.displayName = "NewEpisodeReleases";

export default NewEpisodeReleases;
