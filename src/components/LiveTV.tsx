import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tv, Search, X, Radio, ChevronLeft, RefreshCw, Loader2, Wifi, WifiOff } from "lucide-react";
import { db, ref, onValue } from "@/lib/firebase";

interface TVChannel {
  id: number | string;
  name: string;
  logo: string;
  category: string;
  mpd?: string;
  token?: string;
  referer?: string;
  userAgent?: string;
  drm?: Record<string, string>;
  streamUrl?: string; // for custom channels (HLS/direct)
  source: "api" | "custom";
}

const API_URL = "https://servertvhub.site/api/channels.json";

const LiveTV = ({ onClose }: { onClose: () => void }) => {
  const [channels, setChannels] = useState<TVChannel[]>([]);
  const [customChannels, setCustomChannels] = useState<TVChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<TVChannel | null>(null);
  const [apiEnabled, setApiEnabled] = useState(true);

  // Load API setting from Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, "settings/liveTvApiEnabled"), (snap) => {
      const val = snap.val();
      setApiEnabled(val !== false);
    });
    return () => unsub();
  }, []);

  // Load custom channels from Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, "liveTvChannels"), (snap) => {
      const data = snap.val();
      if (data) {
        const arr = Object.entries(data).map(([key, val]: any) => ({
          id: key,
          name: val.name || "",
          logo: val.logo || "",
          category: val.category || "Custom",
          streamUrl: val.streamUrl || "",
          mpd: val.mpd || "",
          token: val.token || "",
          referer: val.referer || "",
          userAgent: val.userAgent || "",
          source: "custom" as const,
        }));
        setCustomChannels(arr);
      } else {
        setCustomChannels([]);
      }
    });
    return () => unsub();
  }, []);

  // Fetch API channels
  const fetchChannels = useCallback(async () => {
    if (!apiEnabled) {
      setChannels([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      const parsed: TVChannel[] = (data as any[])
        .filter((item: any) => item.id && item.name)
        .map((item: any) => ({
          id: item.id,
          name: item.name,
          logo: item.logo || "",
          category: item.category || "General",
          mpd: item.mpd || "",
          token: item.token || "",
          referer: item.referer || "",
          userAgent: item.userAgent || "",
          drm: item.drm || undefined,
          source: "api" as const,
        }));
      setChannels(parsed);
    } catch (e) {
      setError("চ্যানেল লোড করা যায়নি");
    } finally {
      setLoading(false);
    }
  }, [apiEnabled]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const allChannels = useMemo(() => [...customChannels, ...channels], [customChannels, channels]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    allChannels.forEach((ch) => cats.add(ch.category));
    return ["All", ...Array.from(cats).sort()];
  }, [allChannels]);

  const filtered = useMemo(() => {
    let list = allChannels;
    if (selectedCategory !== "All") list = list.filter((ch) => ch.category === selectedCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((ch) => ch.name.toLowerCase().includes(q) || ch.category.toLowerCase().includes(q));
    }
    return list;
  }, [allChannels, selectedCategory, searchQuery]);

  // Build playback URL
  const getPlayUrl = (ch: TVChannel): string => {
    if (ch.streamUrl) return ch.streamUrl;
    if (ch.mpd) {
      let url = ch.mpd;
      if (ch.token) url += (url.includes("?") ? "&" : "?") + ch.token;
      return url;
    }
    return "";
  };

  // Channel Player View
  if (selectedChannel) {
    const playUrl = getPlayUrl(selectedChannel);
    const hasDrm = selectedChannel.drm && Object.keys(selectedChannel.drm).length > 0;

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] bg-background flex flex-col"
      >
        {/* Player Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-card/80 backdrop-blur-sm border-b border-border/30">
          <button onClick={() => setSelectedChannel(null)} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <img src={selectedChannel.logo} alt="" className="w-8 h-8 rounded-lg object-contain bg-white/10" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{selectedChannel.name}</p>
            <div className="flex items-center gap-1.5">
              <Radio className="w-3 h-3 text-red-500 animate-pulse" />
              <span className="text-[10px] text-red-400 font-medium">LIVE</span>
              <span className="text-[10px] text-muted-foreground ml-1">{selectedChannel.category}</span>
            </div>
          </div>
        </div>

        {/* Video Area */}
        <div className="flex-1 bg-black flex items-center justify-center relative">
          {playUrl ? (
            hasDrm ? (
              // DRM content - use iframe approach
              <iframe
                src={`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.dashjs.org/latest/dash.all.min.js"><\/script><style>*{margin:0;padding:0}body,html{width:100%;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain}</style></head><body><video id="v" controls autoplay></video><script>var player=dashjs.MediaPlayer().create();player.initialize(document.getElementById("v"),"${selectedChannel.mpd}${selectedChannel.token ? (selectedChannel.mpd?.includes("?") ? "&" : "?") + selectedChannel.token : ""}",true);${selectedChannel.drm ? `player.setProtectionData({"com.widevine.alpha":{"serverURL":"","clearkeys":${JSON.stringify(selectedChannel.drm)}}});` : ""}<\/script></body></html>`)}`}
                className="w-full h-full border-none"
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
                sandbox="allow-scripts allow-same-origin"
              />
            ) : (
              // Non-DRM - direct video
              <video
                src={playUrl}
                controls
                autoPlay
                className="w-full h-full object-contain"
                playsInline
              />
            )
          ) : (
            <div className="text-center text-muted-foreground">
              <WifiOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Stream URL পাওয়া যায়নি</p>
            </div>
          )}
        </div>

        {/* Channel Info */}
        <div className="px-4 py-3 bg-card/80 border-t border-border/30">
          <p className="text-xs text-muted-foreground">
            Source: {selectedChannel.source === "custom" ? "Custom Channel" : "ServerTV Hub"}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-[60] bg-background overflow-y-auto"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-md border-b border-border/30">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
                <Tv className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-base font-bold">Live TV</h1>
                <p className="text-[10px] text-muted-foreground">{allChannels.length} channels</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSearch(!showSearch)} className="p-2 rounded-lg hover:bg-accent transition-colors">
              {showSearch ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
            </button>
            <button onClick={fetchChannels} className="p-2 rounded-lg hover:bg-accent transition-colors">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Search */}
        <AnimatePresence>
          {showSearch && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden px-4 pb-3"
            >
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="চ্যানেল খুঁজুন..."
                className="w-full px-4 py-2.5 rounded-xl bg-card border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Category Pills */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-all border ${
                selectedCategory === cat
                  ? "gradient-primary text-primary-foreground border-primary/30 shadow-sm"
                  : "bg-card border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 pb-24">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
            <p className="text-sm text-muted-foreground">চ্যানেল লোড হচ্ছে...</p>
          </div>
        ) : error && allChannels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <WifiOff className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <button onClick={fetchChannels} className="mt-4 px-4 py-2 gradient-primary text-primary-foreground rounded-xl text-sm font-semibold">
              আবার চেষ্টা করুন
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Tv className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-40" />
            <p className="text-sm text-muted-foreground">কোন চ্যানেল পাওয়া যায়নি</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {filtered.map((ch) => (
              <motion.div
                key={`${ch.source}_${ch.id}`}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedChannel(ch)}
                className="relative bg-card rounded-xl border border-border/50 overflow-hidden cursor-pointer hover:border-primary/40 transition-all group"
              >
                {/* Live Badge */}
                <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 bg-red-600/90 px-1.5 py-0.5 rounded-md">
                  <Radio className="w-2.5 h-2.5 animate-pulse" />
                  <span className="text-[8px] font-bold text-white">LIVE</span>
                </div>

                {/* Custom badge */}
                {ch.source === "custom" && (
                  <div className="absolute top-1.5 left-1.5 z-10 bg-primary/80 px-1.5 py-0.5 rounded-md">
                    <span className="text-[8px] font-bold text-primary-foreground">CUSTOM</span>
                  </div>
                )}

                {/* Logo */}
                <div className="aspect-video flex items-center justify-center p-3 bg-gradient-to-b from-white/5 to-transparent">
                  {ch.logo ? (
                    <img
                      src={ch.logo}
                      alt={ch.name}
                      className="w-full h-full object-contain max-h-[50px] group-hover:scale-105 transition-transform"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                      }}
                    />
                  ) : null}
                  <Tv className={`w-8 h-8 text-muted-foreground/40 ${ch.logo ? "hidden" : ""}`} />
                </div>

                {/* Name */}
                <div className="px-2 pb-2">
                  <p className="text-[10px] font-semibold leading-tight line-clamp-2 text-center">{ch.name}</p>
                  <p className="text-[8px] text-muted-foreground text-center mt-0.5 truncate">{ch.category}</p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default LiveTV;
