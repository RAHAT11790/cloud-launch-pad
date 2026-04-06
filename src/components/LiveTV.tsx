import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tv, Search, X, Radio, ChevronLeft, RefreshCw, Loader2, WifiOff, Shield, ShieldOff } from "lucide-react";
import { db, ref, onValue, set } from "@/lib/firebase";
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

const CHANNELS_PER_PAGE = 60;

/* ── Main LiveTV ── */
const LiveTV = ({ onClose }: { onClose: () => void }) => {
  const [customChannels, setCustomChannels] = useState<TVChannel[]>([]);
  const [m3uChannels, setM3uChannels] = useState<TVChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<TVChannel | null>(null);
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [m3uUrls, setM3uUrls] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(CHANNELS_PER_PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load settings from Firebase
  useEffect(() => {
    const unsub1 = onValue(ref(db, "settings/liveTvProxyUrl"), (snap) => {
      setProxyUrl(snap.val() || "");
    });
    const unsub2 = onValue(ref(db, "settings/liveTvProxyEnabled"), (snap) => {
      setProxyEnabled(snap.val() === true);
    });
    const unsub3 = onValue(ref(db, "settings/liveTvPlaylists"), (snap) => {
      const data = snap.val();
      if (data) {
        const urls = Object.values(data).map((v: any) => v.url || v).filter(Boolean) as string[];
        setM3uUrls(urls);
      } else {
        setM3uUrls([]);
      }
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  // Load custom channels
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

  // Fetch M3U playlists
  const fetchM3uPlaylists = useCallback(async () => {
    if (m3uUrls.length === 0) { setM3uChannels([]); return; }
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

  useEffect(() => { fetchM3uPlaylists(); }, [fetchM3uPlaylists]);

  const allChannels = useMemo(() => [...customChannels, ...m3uChannels], [customChannels, m3uChannels]);

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

  // Reset visible count on filter change
  useEffect(() => { setVisibleCount(CHANNELS_PER_PAGE); }, [selectedCategory, searchQuery]);

  const visibleChannels = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Infinite scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
        setVisibleCount((prev) => Math.min(prev + CHANNELS_PER_PAGE, filtered.length));
      }
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [filtered.length]);

  // Build stream URL for VideoPlayer (apply proxy logic)
  const getStreamUrl = useCallback((ch: TVChannel): string => {
    const rawUrl = ch.mpd || ch.streamUrl || "";
    if (!rawUrl) return "";

    // If proxy disabled, play direct
    if (!proxyEnabled || !proxyUrl) return rawUrl;

    // Smart proxy: HTTPS plays direct, HTTP uses proxy
    if (rawUrl.startsWith("https://")) return rawUrl;

    // HTTP stream - apply proxy
    const encoded = encodeURIComponent(rawUrl);
    if (proxyUrl.includes("{url}")) return proxyUrl.replace("{url}", encoded);
    return `${proxyUrl.replace(/\/$/, "")}?url=${encoded}`;
  }, [proxyEnabled, proxyUrl]);

  const toggleProxy = useCallback(() => {
    const newVal = !proxyEnabled;
    setProxyEnabled(newVal);
    set(ref(db, "settings/liveTvProxyEnabled"), newVal);
  }, [proxyEnabled]);

  // Suggested channels for player
  const suggestedChannels = useMemo(() => {
    if (!selectedChannel) return [];
    const sameCat = allChannels.filter(
      (ch) => ch.category === selectedChannel.category && `${ch.source}_${ch.id}` !== `${selectedChannel.source}_${selectedChannel.id}`
    );
    const others = allChannels.filter(
      (ch) => ch.category !== selectedChannel.category && `${ch.source}_${ch.id}` !== `${selectedChannel.source}_${selectedChannel.id}`
    );
    return [...sameCat, ...others].slice(0, 30);
  }, [selectedChannel, allChannels]);

  // VideoPlayer for selected channel
  if (selectedChannel) {
    const streamUrl = getStreamUrl(selectedChannel);
    const tokenPart = selectedChannel.token
      ? (streamUrl.includes("?") ? "&" : "?") + selectedChannel.token
      : "";
    const fullUrl = streamUrl + tokenPart;

    return (
      <div className="fixed inset-0 z-[70] bg-black flex flex-col">
        <VideoPlayer
          src={fullUrl}
          title={selectedChannel.name}
          subtitle={selectedChannel.category}
          poster={selectedChannel.logo}
          onClose={() => setSelectedChannel(null)}
          hideDownload
        />

        {/* Suggested channels below player */}
        <div className="flex-1 bg-background overflow-y-auto">
          <div className="px-3 pt-3 pb-1">
            <p className="text-xs font-bold text-foreground">আরও চ্যানেল</p>
          </div>
          <div className="px-3 pb-20 space-y-2">
            {suggestedChannels.map((ch) => (
              <div
                key={`${ch.source}_${ch.id}`}
                onClick={() => setSelectedChannel(ch)}
                className="flex items-center gap-3 p-2.5 rounded-xl bg-card border border-border/40 cursor-pointer hover:border-primary/40 transition-all active:scale-[0.98]"
              >
                <div className="w-14 h-10 rounded-lg bg-black/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {ch.logo ? (
                    <img src={ch.logo} alt="" className="w-full h-full object-contain p-1" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <Tv className="w-5 h-5 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{ch.name}</p>
                  <p className="text-[10px] text-muted-foreground">{ch.category}</p>
                </div>
                <div className="flex items-center gap-1 bg-red-600/80 px-1.5 py-0.5 rounded">
                  <Radio className="w-2 h-2 animate-pulse text-white" />
                  <span className="text-[7px] font-bold text-white">LIVE</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-[60] bg-background flex flex-col"
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
          <div className="flex items-center gap-1.5">
            {/* Proxy Toggle */}
            <button
              onClick={toggleProxy}
              className={`p-2 rounded-lg transition-colors ${proxyEnabled ? "bg-green-600/20 text-green-500" : "hover:bg-accent text-muted-foreground"}`}
              title={proxyEnabled ? "Proxy ON (HTTP only)" : "Proxy OFF"}
            >
              {proxyEnabled ? <Shield className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
            </button>
            <button onClick={() => setShowSearch(!showSearch)} className="p-2 rounded-lg hover:bg-accent transition-colors">
              {showSearch ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
            </button>
            <button onClick={fetchM3uPlaylists} className="p-2 rounded-lg hover:bg-accent transition-colors">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showSearch && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-4 pb-3">
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

      {/* Channel Grid with Infinite Scroll */}
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
              {visibleChannels.map((ch) => (
                <div
                  key={`${ch.source}_${ch.id}`}
                  onClick={() => setSelectedChannel(ch)}
                  className="bg-card rounded-xl border border-border/50 overflow-hidden cursor-pointer hover:border-primary/40 transition-all active:scale-95"
                >
                  <div className="aspect-square flex items-center justify-center p-2 bg-gradient-to-b from-muted/30 to-transparent">
                    {ch.logo ? (
                      <img
                        src={ch.logo}
                        alt={ch.name}
                        className="w-full h-full object-contain"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          const next = (e.target as HTMLImageElement).nextElementSibling;
                          if (next) next.classList.remove("hidden");
                        }}
                      />
                    ) : null}
                    <Tv className={`w-10 h-10 text-muted-foreground/40 ${ch.logo ? "hidden" : ""}`} />
                  </div>
                  <div className="px-2 pb-2">
                    <p className="text-[10px] font-semibold leading-tight line-clamp-2 text-center">{ch.name}</p>
                  </div>
                </div>
              ))}
            </div>
            {visibleCount < filtered.length && (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
};

export default LiveTV;
