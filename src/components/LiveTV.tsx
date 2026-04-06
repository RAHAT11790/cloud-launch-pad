import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tv, Search, X, Radio, ChevronLeft, RefreshCw, Loader2, WifiOff } from "lucide-react";
import { db, ref, onValue } from "@/lib/firebase";
import { fetchAllPlaylists } from "@/lib/m3uParser";
import VideoPlayer from "@/components/VideoPlayer";

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
  streamUrl?: string;
  source: "custom" | "m3u";
}

const CHANNELS_PER_PAGE = 120;
const LOAD_MORE_THRESHOLD = 900;

const buildChannelTargetUrl = (channel: TVChannel): string => {
  const rawUrl = channel.mpd || channel.streamUrl || "";
  if (!rawUrl) return "";
  if (!channel.token) return rawUrl;
  return `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}${channel.token}`;
};

const LiveTV = ({ onClose }: { onClose: () => void }) => {
  const [customChannels, setCustomChannels] = useState<TVChannel[]>([]);
  const [m3uChannels, setM3uChannels] = useState<TVChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<TVChannel | null>(null);
  const [m3uUrls, setM3uUrls] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(CHANNELS_PER_PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/liveTvPlaylists"), (snap) => {
      const data = snap.val();
      if (data) {
        const urls = Object.values(data).map((v: any) => v.url || v).filter(Boolean) as string[];
        setM3uUrls(urls);
      } else {
        setM3uUrls([]);
      }
    });

    return () => {
      unsub();
    };
  }, []);

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
          drm: val.drm && typeof val.drm === "object" ? val.drm : undefined,
          source: "custom" as const,
        }));
        setCustomChannels(arr);
      } else {
        setCustomChannels([]);
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const fetchM3uPlaylists = useCallback(async () => {
    if (m3uUrls.length === 0) {
      setM3uChannels([]);
      return;
    }

    setLoading(true);
    try {
      const parsed = await fetchAllPlaylists(m3uUrls);
      const mapped: TVChannel[] = parsed.map((ch, i) => ({
        id: `m3u_${i}`,
        name: ch.name,
        logo: ch.logo,
        category: ch.group || "M3U",
        streamUrl: ch.url,
        source: "m3u" as const,
      }));
      setM3uChannels(mapped);
    } catch {
      console.error("M3U playlists fetch failed");
    } finally {
      setLoading(false);
    }
  }, [m3uUrls]);

  useEffect(() => {
    fetchM3uPlaylists();
  }, [fetchM3uPlaylists]);

  const allChannels = useMemo(() => [...customChannels, ...m3uChannels], [customChannels, m3uChannels]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    allChannels.forEach((channel) => cats.add(channel.category));
    return ["All", ...Array.from(cats).sort((a, b) => a.localeCompare(b))];
  }, [allChannels]);

  const filtered = useMemo(() => {
    let list = allChannels;

    if (selectedCategory !== "All") {
      list = list.filter((channel) => channel.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (channel) =>
          channel.name.toLowerCase().includes(q) ||
          channel.category.toLowerCase().includes(q)
      );
    }

    return list;
  }, [allChannels, searchQuery, selectedCategory]);

  useEffect(() => {
    setVisibleCount(CHANNELS_PER_PAGE);
  }, [selectedCategory, searchQuery]);

  useEffect(() => {
    const warmLimit = Math.min(filtered.length, CHANNELS_PER_PAGE * 3);
    if (visibleCount >= warmLimit) return;

    const timeoutId = window.setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + CHANNELS_PER_PAGE, warmLimit));
    }, 90);

    return () => window.clearTimeout(timeoutId);
  }, [filtered.length, visibleCount]);

  const visibleChannels = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleScroll = () => {
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - LOAD_MORE_THRESHOLD) {
        setVisibleCount((prev) => Math.min(prev + CHANNELS_PER_PAGE, filtered.length));
      }
    };

    element.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => element.removeEventListener("scroll", handleScroll);
  }, [filtered.length]);

  const closePlayer = useCallback(() => {
    setSelectedChannel(null);
  }, []);

  const handleChannelSelect = useCallback((channel: TVChannel) => {
    setSelectedChannel(channel);
  }, []);

  const selectedChannelStreamUrl = useMemo(() => {
    if (!selectedChannel) return "";
    return buildChannelTargetUrl(selectedChannel);
  }, [selectedChannel]);

  const suggestedChannels = useMemo(() => {
    if (!selectedChannel) return [];

    const activeKey = `${selectedChannel.source}_${selectedChannel.id}`;
    const sameCategory = allChannels.filter(
      (channel) => channel.category === selectedChannel.category && `${channel.source}_${channel.id}` !== activeKey
    );
    const otherChannels = allChannels.filter(
      (channel) => channel.category !== selectedChannel.category && `${channel.source}_${channel.id}` !== activeKey
    );

    return [...sameCategory, ...otherChannels].slice(0, 24);
  }, [allChannels, selectedChannel]);

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-[60] bg-background flex flex-col"
    >
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

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowSearch(!showSearch)} className="p-2 rounded-lg hover:bg-accent transition-colors">
              {showSearch ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
            </button>
            <button onClick={fetchM3uPlaylists} className="p-2 rounded-lg hover:bg-accent transition-colors">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

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
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="চ্যানেল খুঁজুন..."
                className="w-full px-4 py-2.5 rounded-xl bg-card border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-all border ${
                selectedCategory === category
                  ? "gradient-primary text-primary-foreground border-primary/30 shadow-sm"
                  : "bg-card border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
            <p className="text-sm text-muted-foreground">চ্যানেল লোড হচ্ছে...</p>
          </div>
        ) : allChannels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <WifiOff className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">কোন চ্যানেল নেই। Admin Panel থেকে চ্যানেল যোগ করুন।</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Tv className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-40" />
            <p className="text-sm text-muted-foreground">কোন চ্যানেল পাওয়া যায়নি</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {visibleChannels.map((channel) => (
                <div
                  key={`${channel.source}_${channel.id}`}
                  onClick={() => handleChannelSelect(channel)}
                  className="bg-card rounded-xl border border-border/50 overflow-hidden cursor-pointer hover:border-primary/40 transition-all active:scale-95"
                >
                  <div className="aspect-square flex items-center justify-center p-2 bg-gradient-to-b from-muted/30 to-transparent">
                    {channel.logo ? (
                      <img
                        src={channel.logo}
                        alt={channel.name}
                        className="w-full h-full object-contain"
                        loading="lazy"
                        onError={(event) => {
                          (event.target as HTMLImageElement).style.display = "none";
                          const next = (event.target as HTMLImageElement).nextElementSibling;
                          if (next) next.classList.remove("hidden");
                        }}
                      />
                    ) : null}
                    <Tv className={`w-10 h-10 text-muted-foreground/40 ${channel.logo ? "hidden" : ""}`} />
                  </div>
                  <div className="px-2 pb-2">
                    <p className="text-[10px] font-semibold leading-tight line-clamp-2 text-center">{channel.name}</p>
                  </div>
                </div>
              ))}
            </div>

            {visibleCount < filtered.length && (
              <div className="flex justify-center py-5">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </>
        )}
      </div>

      <AnimatePresence>
        {selectedChannel && selectedChannelStreamUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="fixed inset-0 z-[70] bg-background"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.985, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.985, y: 20 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className="absolute inset-0"
            >
              <VideoPlayer
                key={`${selectedChannel.source}_${selectedChannel.id}_${selectedChannelStreamUrl}`}
                src={selectedChannelStreamUrl}
                title={selectedChannel.name}
                subtitle={selectedChannel.category}
                poster={selectedChannel.logo}
                disablePlaybackRouting
                onClose={closePlayer}
                hideDownload
              />
            </motion.div>

            {suggestedChannels.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="fixed inset-x-0 bottom-0 z-[360] max-h-[32svh] overflow-y-auto rounded-t-[28px] border-t border-border bg-background/96 shadow-lg"
              >
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <div>
                    <p className="text-sm font-bold text-foreground">আরও চ্যানেল</p>
                    <p className="text-[11px] text-muted-foreground">{selectedChannel.category} + more live picks</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary">
                    <Radio className="w-3 h-3" />
                    LIVE
                  </div>
                </div>

                <div className="px-3 pb-[calc(env(safe-area-inset-bottom)+14px)]">
                  <div className="grid grid-cols-3 gap-2.5">
                    {suggestedChannels.map((channel) => (
                      <button
                        key={`${channel.source}_${channel.id}`}
                        onClick={() => handleChannelSelect(channel)}
                        className="w-full rounded-2xl border border-border/50 bg-card px-2 py-2 text-center transition-all hover:border-primary/40 active:scale-[0.985]"
                      >
                        <div className="mx-auto mb-2 flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-muted/40">
                          {channel.logo ? (
                            <img
                              src={channel.logo}
                              alt={channel.name}
                              className="w-full h-full object-contain p-1.5"
                              loading="lazy"
                              onError={(event) => {
                                (event.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <Tv className="w-6 h-6 text-muted-foreground/40" />
                          )}
                        </div>
                        <p className="line-clamp-2 text-[10px] font-semibold leading-tight text-foreground">{channel.name}</p>
                        <div className="mx-auto mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[9px] font-bold text-primary">
                          <Radio className="h-2.5 w-2.5 animate-pulse" />
                          LIVE
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default LiveTV;
