import { useState, useEffect, useMemo } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import { Play, Radio, Search, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import VideoPlayer from "./VideoPlayer";

interface TvChannel {
  id: string;
  name: string;
  logo: string;
  banner: string;
  streamUrl: string;
  category?: string;
  order?: number;
}

interface LiveTvPageProps {
  onBack?: () => void;
}

const LiveTvPage = ({ onBack }: LiveTvPageProps) => {
  const [channels, setChannels] = useState<TvChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChannel, setActiveChannel] = useState<TvChannel | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [activeCategory, setActiveCategory] = useState("All");

  useEffect(() => {
    const unsub = onValue(ref(db, "liveTvChannels"), (snap) => {
      const data = snap.val();
      if (data) {
        const list: TvChannel[] = Object.entries(data).map(([id, val]: any) => ({
          id,
          name: val.name || "",
          logo: val.logo || "",
          banner: val.banner || "",
          streamUrl: val.streamUrl || "",
          category: val.category || "General",
          order: val.order || 0,
        }));
        list.sort((a, b) => (a.order || 0) - (b.order || 0));
        setChannels(list);
      } else {
        setChannels([]);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    channels.forEach(ch => cats.add(ch.category || "General"));
    return ["All", ...Array.from(cats).sort()];
  }, [channels]);

  const filtered = useMemo(() => {
    let list = channels;
    if (activeCategory !== "All") {
      list = list.filter(ch => ch.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(ch => ch.name.toLowerCase().includes(q));
    }
    return list;
  }, [channels, activeCategory, searchQuery]);

  const suggestedChannels = useMemo(() => {
    if (!activeChannel) return [];
    return channels.filter(ch => ch.id !== activeChannel.id).slice(0, 12);
  }, [activeChannel, channels]);

  if (activeChannel) {
    return (
      <VideoPlayer
        src={activeChannel.streamUrl}
        title={activeChannel.name}
        subtitle="🔴 LIVE"
        poster={activeChannel.logo}
        onClose={() => setActiveChannel(null)}
        hideDownload
        noProxy
        suggestedAnime={suggestedChannels.map(ch => ({
          id: ch.id,
          title: ch.name,
          poster: ch.logo,
          backdrop: ch.logo,
          type: "movie" as const,
          category: ch.category || "General",
          rating: "",
          year: "",
          storyline: "",
          language: "",
          seasons: [],
        }))}
        onSuggestedClick={(anime) => {
          const ch = channels.find(c => c.id === anime.id);
          if (ch) setActiveChannel(ch);
        }}
      />
    );
  }

  return (
    <div className="pt-[65px] pb-24 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Radio className="w-5 h-5 text-destructive animate-pulse" />
          Live TV
        </h2>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className="w-9 h-9 rounded-xl bg-card border border-border flex items-center justify-center"
        >
          {showSearch ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
        </button>
      </div>

      {/* Search */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-3"
          >
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search channels..."
              className="w-full px-4 py-2.5 rounded-xl bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              autoFocus
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Category Pills */}
      <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide mb-4">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
              activeCategory === cat
                ? "gradient-primary text-primary-foreground border-primary/30 shadow-[0_2px_12px_hsla(var(--primary)/0.3)]"
                : "bg-card border-border text-muted-foreground"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-muted border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Channel Grid - 16:9 Banners */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((channel) => (
            <motion.div
              key={channel.id}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveChannel(channel)}
              className="relative aspect-video rounded-2xl overflow-hidden cursor-pointer group bg-card border border-border/50"
              style={{ boxShadow: "var(--neu-shadow)" }}
            >
              {/* Background Logo */}
              <img
                src={channel.banner || channel.logo}
                alt={channel.name}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "/placeholder.svg";
                }}
              />
              {/* Gradient Overlay */}
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(135deg, hsla(var(--background)/0.85) 0%, hsla(var(--background)/0.4) 50%, hsla(var(--background)/0.7) 100%)",
                }}
              />

              {/* Channel Info */}
              <div className="absolute inset-0 flex items-center justify-between px-5">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Channel Logo Small */}
                  <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0">
                    <img
                      src={channel.logo}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-foreground truncate">{channel.name}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                      <span className="text-[10px] text-destructive font-medium">LIVE</span>
                      {channel.category && (
                        <span className="text-[10px] text-muted-foreground ml-1">• {channel.category}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Play Button */}
                <div className="w-11 h-11 rounded-full gradient-primary flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                  <Play className="w-5 h-5 text-primary-foreground fill-current ml-0.5" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-20">
          <Radio className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-sm text-muted-foreground">
            {searchQuery ? "No channels found" : "No live TV channels available"}
          </p>
        </div>
      )}
    </div>
  );
};

export default LiveTvPage;
