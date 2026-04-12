import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { ArrowLeft, Lock, Eye, EyeOff, KeyRound, Play, ChevronDown, ChevronRight, Loader2, Film, X, List, Star, BookOpen, Heart, Share2, Check, MessageCircle, Send, Reply, ChevronUp, Trash2 } from "lucide-react";
import { db, ref, onValue, get, set, push, remove } from "@/lib/firebase";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { useBranding } from "@/hooks/useBranding";
import HeroSlider, { type HeroSlide } from "@/components/HeroSlider";
import CategoryPills from "@/components/CategoryPills";
import AnimeSection from "@/components/AnimeSection";
import type { AnimeItem, Season } from "@/data/animeData";

const VideoPlayer = lazy(() => import("@/components/VideoPlayer"));

interface PrivateEpisode {
  episodeNumber: number;
  title: string;
  link: string;
  link480?: string;
  link720?: string;
  link1080?: string;
  link4k?: string;
  audioTracks?: { language: string; label: string; link: string; link480?: string; link720?: string; link1080?: string; link4k?: string }[];
}

interface PrivateSeason {
  name: string;
  seasonNumber: number;
  episodes: PrivateEpisode[];
}

interface PrivateSeries {
  id: string;
  title: string;
  description?: string;
  backdrop?: string;
  poster?: string;
  category?: string;
  rating?: string;
  year?: string;
  type?: string;
  language?: string;
  seasons?: PrivateSeason[];
  episodes?: PrivateEpisode[];
  createdAt?: number;
  updatedAt?: number;
}

interface PrivateContentPageProps {
  onClose: () => void;
}

// Helper to get best src from episode
const getEpisodeSrc = (ep: PrivateEpisode): string => {
  return ep.link || ep.link480 || ep.link720 || ep.link1080 || ep.link4k || "";
};

const PrivateContentPage = ({ onClose }: PrivateContentPageProps) => {
  const branding = useBranding();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [series, setSeries] = useState<PrivateSeries[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<PrivateSeries | null>(null);
  const [activeCategory, setActiveCategory] = useState("All");

  // Player state
  const [playerState, setPlayerState] = useState<{
    src: string;
    title: string;
    subtitle: string;
    series: PrivateSeries;
    seasonIdx: number;
    epIdx: number;
    qualityOptions?: { label: string; src: string }[];
    audioTracks?: any[];
  } | null>(null);

  // Forgot PIN states
  const [forgotMode, setForgotMode] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [newPin, setNewPin] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);

  const userId = useMemo(() => {
    try {
      const raw = localStorage.getItem("rsanime_user");
      return raw ? JSON.parse(raw)?.id : null;
    } catch { return null; }
  }, []);

  const userEmail = useMemo(() => {
    try {
      const raw = localStorage.getItem("rsanime_user");
      return raw ? JSON.parse(raw)?.email : null;
    } catch { return null; }
  }, []);

  // Check if user has PIN set
  useEffect(() => {
    if (!userId) return;
    const unsub = onValue(ref(db, `users/${userId}/privatePin`), (snap) => {
      setHasPin(snap.val() !== null);
    });
    return () => unsub();
  }, [userId]);

  // Load private content
  useEffect(() => {
    const unsub = onValue(ref(db, "privateContent"), (snap) => {
      const data = snap.val();
      if (!data) { setSeries([]); return; }
      const items: PrivateSeries[] = Object.entries(data).map(([id, val]: [string, any]) => {
        let seasons: PrivateSeason[] | undefined;
        if (val.seasons) {
          seasons = Object.values(val.seasons).map((s: any) => ({
            name: s.name || `Season ${s.seasonNumber || 1}`,
            seasonNumber: s.seasonNumber || 1,
            episodes: s.episodes ? Object.values(s.episodes).map((ep: any) => ({
              episodeNumber: ep.episodeNumber || 1,
              title: ep.title || "",
              link: ep.link || "",
              link480: ep.link480 || "",
              link720: ep.link720 || "",
              link1080: ep.link1080 || "",
              link4k: ep.link4k || "",
              audioTracks: ep.audioTracks ? Object.values(ep.audioTracks) : undefined,
            })) : [],
          }));
          seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
        }

        let episodes: PrivateEpisode[] | undefined;
        if (!seasons && val.episodes) {
          episodes = Object.values(val.episodes).map((ep: any) => ({
            episodeNumber: ep.episodeNumber || 1,
            title: ep.title || "",
            link: ep.link || "",
            link480: ep.link480 || "",
            link720: ep.link720 || "",
            link1080: ep.link1080 || "",
            link4k: ep.link4k || "",
            audioTracks: ep.audioTracks ? Object.values(ep.audioTracks) : undefined,
          }));
        }

        return {
          id, title: val.title || "", description: val.description || "",
          backdrop: val.backdrop || "", poster: val.poster || "",
          category: val.category || "Uncategorized",
          rating: val.rating || "", year: val.year || "",
          type: val.type || "webseries", language: val.language || "",
          seasons, episodes,
          createdAt: val.createdAt || 0, updatedAt: val.updatedAt || 0,
        };
      });
      items.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      setSeries(items);
    });
    return () => unsub();
  }, []);

  const verifyPin = useCallback(async () => {
    if (!userId || !pin.trim()) return;
    setLoading(true);
    try {
      const snap = await get(ref(db, `users/${userId}/privatePin`));
      if (snap.val() === pin.trim()) {
        setIsAuthenticated(true);
        toast.success("✅ অ্যাক্সেস দেওয়া হয়েছে!");
      } else {
        toast.error("❌ পাসওয়ার্ড ভুল!");
      }
    } catch { toast.error("Error verifying"); }
    setLoading(false);
  }, [userId, pin]);

  const setNewPinForUser = useCallback(async () => {
    if (!userId || !pin.trim() || pin.trim().length < 4) {
      toast.error("পাসওয়ার্ড কমপক্ষে ৪ ক্যারেক্টার হতে হবে");
      return;
    }
    setLoading(true);
    try {
      await set(ref(db, `users/${userId}/privatePin`), pin.trim());
      setHasPin(true);
      setIsAuthenticated(true);
      toast.success("✅ পাসওয়ার্ড সেট হয়েছে!");
    } catch { toast.error("Error setting password"); }
    setLoading(false);
  }, [userId, pin]);

  const sendOtp = useCallback(async () => {
    if (!userId || !userEmail) { toast.error("ইমেইল পাওয়া যায়নি"); return; }
    setOtpLoading(true);
    try {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      await set(ref(db, `users/${userId}/pinResetOtp`), {
        code: otp, expiresAt: Date.now() + 5 * 60 * 1000, email: userEmail,
      });
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        await supabase.functions.invoke("send-otp-email", {
          body: { email: userEmail, otp, siteName: branding.siteName },
        });
      } catch { console.log("Email sending failed, OTP stored in Firebase"); }
      setOtpSent(true);
      toast.success(`📧 কোড পাঠানো হয়েছে: ${userEmail}`);
    } catch { toast.error("Error sending code"); }
    setOtpLoading(false);
  }, [userId, userEmail, branding.siteName]);

  const verifyOtpAndResetPin = useCallback(async () => {
    if (!userId || !otpInput.trim() || !newPin.trim()) return;
    if (newPin.trim().length < 4) { toast.error("পাসওয়ার্ড কমপক্ষে ৪ ক্যারেক্টার"); return; }
    setOtpLoading(true);
    try {
      const snap = await get(ref(db, `users/${userId}/pinResetOtp`));
      const otpData = snap.val();
      if (!otpData || otpData.code !== otpInput.trim()) { toast.error("❌ কোড ভুল!"); setOtpLoading(false); return; }
      if (otpData.expiresAt < Date.now()) { toast.error("⏰ কোডের মেয়াদ শেষ!"); setOtpLoading(false); return; }
      await set(ref(db, `users/${userId}/privatePin`), newPin.trim());
      await set(ref(db, `users/${userId}/pinResetOtp`), null);
      setForgotMode(false); setOtpSent(false); setOtpInput(""); setNewPin(""); setPin("");
      toast.success("✅ নতুন পাসওয়ার্ড সেট হয়েছে!");
    } catch { toast.error("Error resetting"); }
    setOtpLoading(false);
  }, [userId, otpInput, newPin]);

  // Categories from content
  const categories = useMemo(() => {
    const cats = new Set<string>();
    series.forEach(s => { if (s.category) cats.add(s.category); });
    return Array.from(cats);
  }, [series]);

  // Filtered content
  const filteredSeries = useMemo(() => {
    if (activeCategory === "All") return series;
    return series.filter(s => s.category === activeCategory);
  }, [series, activeCategory]);

  // Category groups for home sections
  const categoryGroups = useMemo(() => {
    const groups: Record<string, PrivateSeries[]> = {};
    series.forEach(s => {
      const cat = s.category || "Uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    });
    return groups;
  }, [series]);

  // Hero slides from content with backdrop
  const heroSlides = useMemo((): HeroSlide[] => {
    const withBackdrop = series.filter(s => s.backdrop);
    if (withBackdrop.length === 0) return [];
    return withBackdrop.slice(0, 6).map(s => ({
      id: s.id,
      title: s.title,
      backdrop: s.backdrop!,
      subtitle: s.category || "",
      rating: s.rating || "",
      year: s.year || "",
      type: s.type || "webseries",
      isCustom: false,
      description: s.description || "",
    }));
  }, [series]);

  // New releases (latest updated content)
  const newReleases = useMemo(() => {
    return [...series]
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .slice(0, 10);
  }, [series]);

  // Convert PrivateSeries to AnimeItem for reuse of AnimeSection/AnimeCard
  const toAnimeItem = useCallback((s: PrivateSeries): AnimeItem => ({
    id: s.id,
    title: s.title,
    poster: s.poster || s.backdrop || "",
    backdrop: s.backdrop || "",
    year: s.year || "",
    rating: s.rating || "",
    type: (s.type || "webseries") as "webseries" | "movie",
    category: s.category || "Uncategorized",
    storyline: s.description || "",
    language: s.language || "",
    createdAt: s.createdAt || 0,
    updatedAt: s.updatedAt || 0,
    seasons: s.seasons?.map(sn => ({
      name: sn.name,
      episodes: sn.episodes.map(ep => ({
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        link: ep.link,
        link480: ep.link480,
        link720: ep.link720,
        link1080: ep.link1080,
        link4k: ep.link4k,
        audioTracks: ep.audioTracks,
      })),
    })),
  }), []);

  // Get seasons for selected series
  const getSeasons = useCallback((s: PrivateSeries): Season[] => {
    if (s.seasons && s.seasons.length > 0) {
      return s.seasons.map(sn => ({
        name: sn.name,
        episodes: sn.episodes.map(ep => ({
          episodeNumber: ep.episodeNumber, title: ep.title, link: ep.link,
          link480: ep.link480, link720: ep.link720, link1080: ep.link1080, link4k: ep.link4k,
          audioTracks: ep.audioTracks,
        })),
      }));
    }
    if (s.episodes && s.episodes.length > 0) {
      return [{ name: "Season 1", episodes: s.episodes.map(ep => ({
        episodeNumber: ep.episodeNumber, title: ep.title, link: ep.link,
        link480: ep.link480, link720: ep.link720, link1080: ep.link1080, link4k: ep.link4k,
        audioTracks: ep.audioTracks,
      })) }];
    }
    return [];
  }, []);

  // Handle play
  const handlePlay = useCallback((s: PrivateSeries, seasonIdx = 0, epIdx = 0) => {
    const seasons = getSeasons(s);
    const season = seasons[seasonIdx];
    if (!season?.episodes?.[epIdx]) return;
    const ep = season.episodes[epIdx];
    const src = getEpisodeSrc(ep as PrivateEpisode);
    if (!src) { toast.error("ভিডিও লিংক নেই"); return; }
    const qOpts: { label: string; src: string }[] = [];
    if (ep.link480) qOpts.push({ label: "480p", src: ep.link480 });
    if (ep.link720) qOpts.push({ label: "720p", src: ep.link720 });
    if (ep.link1080) qOpts.push({ label: "1080p", src: ep.link1080 });
    if (ep.link4k) qOpts.push({ label: "4K", src: ep.link4k });
    setPlayerState({
      src, title: s.title,
      subtitle: `${season.name} - Episode ${ep.episodeNumber}`,
      series: s, seasonIdx, epIdx,
      qualityOptions: qOpts.length > 0 ? qOpts : undefined,
      audioTracks: (ep as PrivateEpisode).audioTracks,
    });
  }, [getSeasons]);

  const handleCardClick = useCallback((anime: AnimeItem) => {
    const found = series.find(s => s.id === anime.id);
    if (found) setSelectedSeries(found);
  }, [series]);

  // ========== VIDEO PLAYER ==========
  if (playerState) {
    const seasons = getSeasons(playerState.series);
    const eps = seasons[playerState.seasonIdx]?.episodes || [];
    const episodeList = eps.map((ep, i) => ({
      number: ep.episodeNumber || i + 1,
      title: ep.title,
      active: i === playerState.epIdx,
      onClick: () => {
        const clickedSrc = getEpisodeSrc(ep as PrivateEpisode);
        if (!clickedSrc) return;
        const qO: { label: string; src: string }[] = [];
        if (ep.link480) qO.push({ label: "480p", src: ep.link480 });
        if (ep.link720) qO.push({ label: "720p", src: ep.link720 });
        if (ep.link1080) qO.push({ label: "1080p", src: ep.link1080 });
        if (ep.link4k) qO.push({ label: "4K", src: ep.link4k });
        setPlayerState({
          ...playerState, src: clickedSrc,
          subtitle: `${seasons[playerState.seasonIdx].name} - Episode ${ep.episodeNumber}`,
          epIdx: i, qualityOptions: qO.length > 0 ? qO : undefined,
          audioTracks: (ep as PrivateEpisode).audioTracks,
        });
      },
    }));

    const handleNextEpisode = playerState.epIdx < eps.length - 1 ? () => {
      const nextEp = eps[playerState.epIdx + 1];
      const nextSrc = getEpisodeSrc(nextEp as PrivateEpisode);
      if (!nextSrc) return;
      const qO: { label: string; src: string }[] = [];
      if (nextEp.link480) qO.push({ label: "480p", src: nextEp.link480 });
      if (nextEp.link720) qO.push({ label: "720p", src: nextEp.link720 });
      if (nextEp.link1080) qO.push({ label: "1080p", src: nextEp.link1080 });
      if (nextEp.link4k) qO.push({ label: "4K", src: nextEp.link4k });
      setPlayerState({
        ...playerState, src: nextSrc,
        subtitle: `${seasons[playerState.seasonIdx].name} - Episode ${nextEp.episodeNumber}`,
        epIdx: playerState.epIdx + 1, qualityOptions: qO.length > 0 ? qO : undefined,
        audioTracks: (nextEp as PrivateEpisode).audioTracks,
      });
    } : undefined;

    const handleSeasonChange = (newIdx: number) => {
      const newSeason = seasons[newIdx];
      if (!newSeason?.episodes?.length) return;
      const ep = newSeason.episodes[0];
      const src = getEpisodeSrc(ep as PrivateEpisode);
      if (!src) return;
      const qO: { label: string; src: string }[] = [];
      if (ep.link480) qO.push({ label: "480p", src: ep.link480 });
      if (ep.link720) qO.push({ label: "720p", src: ep.link720 });
      if (ep.link1080) qO.push({ label: "1080p", src: ep.link1080 });
      if (ep.link4k) qO.push({ label: "4K", src: ep.link4k });
      setPlayerState({
        ...playerState, src,
        subtitle: `${newSeason.name} - Episode ${ep.episodeNumber}`,
        seasonIdx: newIdx, epIdx: 0,
        qualityOptions: qO.length > 0 ? qO : undefined,
        audioTracks: (ep as PrivateEpisode).audioTracks,
      });
    };

    return (
      <div className="fixed inset-0 z-[300]">
        <Suspense fallback={<div className="fixed inset-0 bg-black flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
          <VideoPlayer
            src={playerState.src}
            title={playerState.title}
            subtitle={playerState.subtitle}
            poster={playerState.series.backdrop || playerState.series.poster}
            onClose={() => setPlayerState(null)}
            onNextEpisode={handleNextEpisode}
            episodeList={episodeList}
            qualityOptions={playerState.qualityOptions}
            audioTracks={playerState.audioTracks}
            seasons={seasons.length > 1 ? seasons : undefined}
            currentSeasonIdx={playerState.seasonIdx}
            onSeasonChange={seasons.length > 1 ? handleSeasonChange : undefined}
            animeId={`private_${playerState.series.id}`}
          />
        </Suspense>
      </div>
    );
  }

  // ========== DETAILS VIEW (clone of AnimeDetails) ==========
  if (selectedSeries && isAuthenticated) {
    const s = selectedSeries;
    const seasons = getSeasons(s);
    return (
      <motion.div
        className="fixed inset-0 z-[250] bg-background overflow-y-auto"
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      >
        {/* Header Image */}
        <div className="relative w-full h-[45vh] min-h-[300px] overflow-hidden">
          <img src={s.backdrop || s.poster} alt={s.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{
            background: "linear-gradient(to top, hsl(var(--background)) 0%, hsl(var(--background) / 0.4) 40%, transparent 60%), linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 25%)"
          }} />
          <div className="absolute bottom-6 left-0 right-0 px-5 text-center">
            <h1 className="text-2xl font-extrabold mb-2 drop-shadow-[0_4px_20px_rgba(0,0,0,0.9)]" style={{ color: "white" }}>
              {s.title}
            </h1>
            <div className="flex items-center justify-center gap-2 text-[11px] text-secondary-foreground flex-wrap">
              {s.rating && (
                <span className="bg-accent px-2.5 py-1 rounded text-accent-foreground font-semibold shadow-[0_2px_10px_hsla(38,90%,55%,0.4)] flex items-center gap-1">
                  <Star className="w-3 h-3" /> {s.rating}
                </span>
              )}
              {s.year && <span>{s.year}</span>}
              {s.language && <span>{s.language}</span>}
              <span className="bg-foreground/15 px-2.5 py-1 rounded text-[10px] backdrop-blur-[10px]">
                {s.type === "movie" ? "Movie" : "Series"}
              </span>
            </div>
          </div>
        </div>

        {/* Back button */}
        <button onClick={() => setSelectedSeries(null)}
          className="fixed left-4 top-5 w-10 h-10 rounded-full bg-background/70 backdrop-blur-[20px] border-2 border-foreground/20 flex items-center justify-center z-[260] transition-all hover:bg-primary hover:border-primary hover:scale-110">
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="relative px-4 pb-24 z-10">
          <div className="flex gap-2.5 mb-5">
            <button onClick={() => handlePlay(s, 0, 0)}
              className="flex-1 py-3 rounded-xl gradient-primary font-bold text-sm flex items-center justify-center gap-2 btn-glow">
              {s.type === "movie" ? <><Play className="w-4 h-4" /> Play</> : <><List className="w-4 h-4" /> Watch</>}
            </button>
          </div>

          {s.description && (
            <div className="glass-card p-4 mb-5">
              <h3 className="text-[15px] font-bold mb-2.5 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" /> Storyline
              </h3>
              <p className="text-[13px] leading-relaxed text-secondary-foreground">{s.description}</p>
            </div>
          )}

          {/* Episode List like AnimeDetails */}
          {seasons.length > 0 && (
            <div className="mb-5 space-y-4">
              {seasons.map((season, sIdx) => (
                <div key={sIdx} className="glass-card p-3.5 rounded-xl">
                  <h3 className="text-[15px] font-bold mb-3 flex items-center category-bar">{season.name}</h3>
                  <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1">
                    {season.episodes.map((ep, eIdx) => (
                      <button key={eIdx} onClick={() => handlePlay(s, sIdx, eIdx)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-secondary/60 border border-border/30 hover:border-primary hover:bg-primary/10 transition-all group">
                        <div className="w-[72px] h-[42px] min-w-[72px] flex-shrink-0 rounded-lg overflow-hidden bg-card relative">
                          <img src={s.poster || s.backdrop} alt={`Ep ${ep.episodeNumber}`} className="w-full h-full object-cover" loading="lazy" />
                          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Play className="w-4 h-4 text-white" fill="white" />
                          </div>
                          <span className="absolute bottom-0.5 right-0.5 text-[8px] font-bold bg-black/70 text-white px-1 rounded">EP {ep.episodeNumber}</span>
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-[13px] font-semibold truncate">Episode {ep.episodeNumber}</p>
                          {ep.title && ep.title !== `Episode ${ep.episodeNumber}` && (
                            <p className="text-[11px] text-muted-foreground truncate">{ep.title}</p>
                          )}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          {ep.link1080 && <span className="text-[8px] bg-primary/20 text-primary px-1 rounded">HD</span>}
                          {ep.link4k && <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1 rounded">4K</span>}
                        </div>
                        <Play className="w-4 h-4 flex-shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // ========== LOGIN / SET PIN ==========
  if (!isAuthenticated) {
    return (
      <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "tween", duration: 0.3 }}>
        <button onClick={onClose} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" /> Back
        </button>

        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-full gradient-primary flex items-center justify-center mx-auto mb-4">
            <Lock className="w-10 h-10 text-primary-foreground" />
          </div>
          <h2 className="text-xl font-bold mb-1">Private Content</h2>
          <p className="text-sm text-muted-foreground">
            {hasPin === false ? "প্রথমে একটি পাসওয়ার্ড সেট করুন" : "পাসওয়ার্ড দিয়ে এক্সেস করুন"}
          </p>
        </div>

        {forgotMode ? (
          <div className="max-w-sm mx-auto">
            {!otpSent ? (
              <div className="space-y-4">
                <p className="text-sm text-center text-muted-foreground">
                  আপনার ইমেইলে ({userEmail || "N/A"}) একটি কোড পাঠানো হবে
                </p>
                <button onClick={sendOtp} disabled={otpLoading || !userEmail}
                  className="w-full py-3 rounded-xl gradient-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  কোড পাঠান
                </button>
                <button onClick={() => setForgotMode(false)} className="w-full py-2 text-sm text-muted-foreground hover:text-foreground">
                  ← Back to Login
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">ইমেইলে পাঠানো কোড</label>
                  <input type="text" value={otpInput} onChange={e => setOtpInput(e.target.value)}
                    placeholder="৬ ডিজিটের কোড" maxLength={6}
                    className="w-full py-3 px-4 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-center text-lg font-mono tracking-[8px] focus:border-primary focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">নতুন পাসওয়ার্ড</label>
                  <input type="password" value={newPin} onChange={e => setNewPin(e.target.value)}
                    placeholder="নতুন পাসওয়ার্ড (মিনিমাম ৪)"
                    className="w-full py-3 px-4 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none" />
                </div>
                <button onClick={verifyOtpAndResetPin} disabled={otpLoading || !otpInput || !newPin}
                  className="w-full py-3 rounded-xl gradient-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  পাসওয়ার্ড রিসেট করুন
                </button>
                <button onClick={() => { setOtpSent(false); setForgotMode(false); }} className="w-full py-2 text-sm text-muted-foreground">
                  ← Back
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-sm mx-auto space-y-4">
            {hasPin === null ? (
              <div className="flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : (
              <>
                <div className="relative">
                  <input
                    type={showPin ? "text" : "password"} value={pin} onChange={e => setPin(e.target.value)}
                    placeholder={hasPin ? "পাসওয়ার্ড দিন" : "নতুন পাসওয়ার্ড সেট করুন (মিনিমাম ৪)"}
                    className="w-full py-3 px-4 pr-12 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none"
                    onKeyDown={e => e.key === "Enter" && (hasPin ? verifyPin() : setNewPinForUser())}
                  />
                  <button onClick={() => setShowPin(!showPin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <button onClick={hasPin ? verifyPin : setNewPinForUser} disabled={loading || !pin.trim()}
                  className="w-full py-3 rounded-xl gradient-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  {hasPin ? "এক্সেস করুন" : "পাসওয়ার্ড সেট করুন"}
                </button>
                {hasPin && (
                  <button onClick={() => setForgotMode(true)} className="w-full py-2 text-sm text-primary hover:underline">
                    পাসওয়ার্ড ভুলে গেছেন?
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </motion.div>
    );
  }

  // ========== MAIN HOME PAGE CLONE ==========
  const animeItems = filteredSeries.map(toAnimeItem);

  return (
    <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto"
      initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
      transition={{ type: "tween", duration: 0.3 }}>

      {/* Header bar */}
      <div className="fixed top-0 left-0 right-0 z-[210] h-[60px] flex items-center justify-between px-4 backdrop-blur-xl" style={{
        background: "hsla(var(--background) / 0.85)",
        borderBottom: "1px solid hsla(var(--foreground) / 0.08)"
      }}>
        <button onClick={onClose} className="flex items-center gap-2 text-sm text-secondary-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Lock className="w-4 h-4 text-primary" /> Private
        </h2>
        <div className="w-10" />
      </div>

      <div className="pt-[60px]">
        {/* Hero Slider */}
        {heroSlides.length > 0 && (
          <HeroSlider
            slides={heroSlides}
            onPlay={(idx) => {
              const slide = heroSlides[idx];
              const found = series.find(s => s.id === slide.id);
              if (found) handlePlay(found, 0, 0);
            }}
            onInfo={(idx) => {
              const slide = heroSlides[idx];
              const found = series.find(s => s.id === slide.id);
              if (found) setSelectedSeries(found);
            }}
          />
        )}

        {/* Category Pills */}
        {categories.length > 0 && (
          <CategoryPills active={activeCategory} onSelect={setActiveCategory} categories={categories} />
        )}

        {activeCategory !== "All" ? (
          // Filtered view - grid
          <div className="px-4 pb-6">
            <h2 className="text-base font-bold mb-3 flex items-center category-bar">{activeCategory}</h2>
            {animeItems.length > 0 ? (
              <div className="grid grid-cols-3 gap-2.5">
                {animeItems.map(anime => (
                  <div key={anime.id} className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover bg-card" onClick={() => handleCardClick(anime)}>
                    <img src={anime.poster} alt={anime.title} className="w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 40%, transparent 70%)" }} />
                    {anime.year && <span className="absolute top-1.5 right-1.5 gradient-primary px-2 py-0.5 rounded text-[9px] font-bold">{anime.year}</span>}
                    <div className="absolute bottom-0 left-0 right-0 p-2">
                      <p className="text-[11px] font-semibold leading-tight line-clamp-2">{anime.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-10">No content found in this category</p>
            )}
          </div>
        ) : (
          <>
            {/* New Releases Section */}
            {newReleases.length > 0 && (
              <AnimeSection title="🔥 New Releases" items={newReleases.map(toAnimeItem)} onCardClick={handleCardClick} />
            )}

            {/* Category Sections */}
            {Object.entries(categoryGroups).map(([cat, items]) => (
              <AnimeSection key={cat} title={cat} items={items.slice(0, 10).map(toAnimeItem)} onCardClick={handleCardClick} />
            ))}

            {/* All content grid */}
            {series.length > 0 && (
              <div className="px-4 mb-6">
                <h3 className="text-base font-bold mb-3 flex items-center category-bar">📺 All Content</h3>
                <div className="grid grid-cols-3 gap-2.5">
                  {series.map(s => {
                    const anime = toAnimeItem(s);
                    return (
                      <div key={s.id} className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover bg-card" onClick={() => handleCardClick(anime)}>
                        <img src={anime.poster} alt={anime.title} className="w-full h-full object-cover" loading="lazy" />
                        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 40%, transparent 70%)" }} />
                        {anime.year && <span className="absolute top-1.5 right-1.5 gradient-primary px-2 py-0.5 rounded text-[9px] font-bold">{anime.year}</span>}
                        <div className="absolute bottom-0 left-0 right-0 p-2">
                          <p className="text-[11px] font-semibold leading-tight line-clamp-2">{anime.title}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {series.length === 0 && (
              <div className="text-center py-16">
                <Film className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">এখনো কোনো প্রাইভেট কন্টেন্ট নেই</p>
              </div>
            )}
          </>
        )}

        <footer className="text-center py-8 pb-24 px-4 border-t border-border/30 mt-8">
          <div className="text-2xl font-black text-primary text-glow tracking-wide mb-2">{branding.siteName}</div>
          <p className="text-[10px] text-muted-foreground">Private Content • Only for authorized users</p>
        </footer>
      </div>
    </motion.div>
  );
};

export default PrivateContentPage;
