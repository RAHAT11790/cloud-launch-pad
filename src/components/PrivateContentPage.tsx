import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { ArrowLeft, Lock, Eye, EyeOff, KeyRound, Loader2, Film } from "lucide-react";
import { db, ref, onValue, get, set } from "@/lib/firebase";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useBranding } from "@/hooks/useBranding";
import HeroSlider, { type HeroSlide } from "@/components/HeroSlider";
import CategoryPills from "@/components/CategoryPills";
import AnimeSection from "@/components/AnimeSection";
import AnimeDetails from "@/components/AnimeDetails";
import type { AnimeItem, Episode, Season } from "@/data/animeData";
import { useFirebaseData } from "@/hooks/useFirebaseData";

const VideoPlayer = lazy(() => import("@/components/VideoPlayer"));

interface PrivateContentPageProps {
  onClose: () => void;
}

const getEpisodeSrc = (episode?: Partial<Episode>) => {
  return episode?.link || episode?.link480 || episode?.link720 || episode?.link1080 || episode?.link4k || "";
};

const getMovieSrc = (anime: AnimeItem) => {
  return anime.movieLink || anime.movieLink480 || anime.movieLink720 || anime.movieLink1080 || anime.movieLink4k || "";
};

const buildEpisodeQualityOptions = (episode?: Partial<Episode>) => {
  if (!episode) return undefined;
  const options: { label: string; src: string }[] = [];
  if (episode.link480) options.push({ label: "480p", src: episode.link480 });
  if (episode.link720) options.push({ label: "720p", src: episode.link720 });
  if (episode.link1080) options.push({ label: "1080p", src: episode.link1080 });
  if (episode.link4k) options.push({ label: "4K", src: episode.link4k });
  return options.length > 0 ? options : undefined;
};

const buildMovieQualityOptions = (anime: AnimeItem) => {
  const options: { label: string; src: string }[] = [];
  if (anime.movieLink480) options.push({ label: "480p", src: anime.movieLink480 });
  if (anime.movieLink720) options.push({ label: "720p", src: anime.movieLink720 });
  if (anime.movieLink1080) options.push({ label: "1080p", src: anime.movieLink1080 });
  if (anime.movieLink4k) options.push({ label: "4K", src: anime.movieLink4k });
  return options.length > 0 ? options : undefined;
};

const PrivateContentPage = ({ onClose }: PrivateContentPageProps) => {
  const branding = useBranding();
  const { privateWebseries, privateMovies, loading: contentLoading } = useFirebaseData();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedAnimeId, setSelectedAnimeId] = useState(() => {
    try {
      return sessionStorage.getItem("rs_private_selected_id") || "";
    } catch {
      return "";
    }
  });
  const [activeCategory, setActiveCategory] = useState("All");
  const [playerState, setPlayerState] = useState<{
    src: string;
    subtitle: string;
    anime: AnimeItem;
    seasonIdx: number;
    epIdx: number;
    qualityOptions?: { label: string; src: string }[];
    audioTracks?: Episode["audioTracks"];
  } | null>(null);
  const [forgotMode, setForgotMode] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [newPin, setNewPin] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);

  const userId = useMemo(() => {
    try {
      const raw = localStorage.getItem("rsanime_user");
      return raw ? JSON.parse(raw)?.id : null;
    } catch {
      return null;
    }
  }, []);

  const userEmail = useMemo(() => {
    try {
      const raw = localStorage.getItem("rsanime_user");
      return raw ? JSON.parse(raw)?.email : null;
    } catch {
      return null;
    }
  }, []);

  const privateItems = useMemo(() => {
    const merged = [...privateWebseries, ...privateMovies];
    merged.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return merged;
  }, [privateMovies, privateWebseries]);

  const selectedAnime = useMemo(
    () => privateItems.find((item) => item.id === selectedAnimeId) || null,
    [privateItems, selectedAnimeId],
  );

  useEffect(() => {
    if (!userId) return;
    const unsub = onValue(ref(db, `users/${userId}/privatePin`), (snap) => {
      setHasPin(snap.val() !== null);
    });
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    try {
      if (selectedAnimeId) sessionStorage.setItem("rs_private_selected_id", selectedAnimeId);
      else sessionStorage.removeItem("rs_private_selected_id");
    } catch {}
  }, [selectedAnimeId]);

  useEffect(() => {
    if (selectedAnimeId && !privateItems.some((item) => item.id === selectedAnimeId)) {
      setSelectedAnimeId("");
    }
  }, [privateItems, selectedAnimeId]);

  const verifyPin = useCallback(async () => {
    if (!userId || !pin.trim()) return;
    setLoading(true);
    try {
      const snap = await get(ref(db, `users/${userId}/privatePin`));
      if (snap.val() === pin.trim()) {
        setIsAuthenticated(true);
        toast.success("✅ Access granted!");
      } else {
        toast.error("❌ Wrong password!");
      }
    } catch { toast.error("Error verifying"); }
    setLoading(false);
  }, [userId, pin]);

  const setNewPinForUser = useCallback(async () => {
    if (!userId || !pin.trim() || pin.trim().length < 4) {
      toast.error("Password must be at least 4 characters");
      return;
    }
    setLoading(true);
    try {
      await set(ref(db, `users/${userId}/privatePin`), pin.trim());
      setHasPin(true);
      setIsAuthenticated(true);
      toast.success("✅ Password set!");
    } catch { toast.error("Error setting password"); }
    setLoading(false);
  }, [userId, pin]);

  const sendOtp = useCallback(async () => {
    if (!userId || !userEmail) { toast.error("Email not found"); return; }
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
      toast.success(`📧 Code sent to: ${userEmail}`);
    } catch { toast.error("Error sending code"); }
    setOtpLoading(false);
  }, [userId, userEmail, branding.siteName]);

  const verifyOtpAndResetPin = useCallback(async () => {
    if (!userId || !otpInput.trim() || !newPin.trim()) return;
    if (newPin.trim().length < 4) { toast.error("Password must be at least 4 characters"); return; }
    setOtpLoading(true);
    try {
      const snap = await get(ref(db, `users/${userId}/pinResetOtp`));
      const otpData = snap.val();
      if (!otpData || otpData.code !== otpInput.trim()) { toast.error("❌ Wrong code!"); setOtpLoading(false); return; }
      if (otpData.expiresAt < Date.now()) { toast.error("⏰ Code expired!"); setOtpLoading(false); return; }
      await set(ref(db, `users/${userId}/privatePin`), newPin.trim());
      await set(ref(db, `users/${userId}/pinResetOtp`), null);
      setForgotMode(false); setOtpSent(false); setOtpInput(""); setNewPin(""); setPin("");
      toast.success("✅ Password reset successfully!");
    } catch { toast.error("Error resetting"); }
    setOtpLoading(false);
  }, [userId, otpInput, newPin]);

  const categories = useMemo(() => {
    return Array.from(new Set(privateItems.map((item) => item.category).filter(Boolean)));
  }, [privateItems]);

  const filteredItems = useMemo(() => {
    if (activeCategory === "All") return privateItems;
    return privateItems.filter((item) => item.category === activeCategory);
  }, [activeCategory, privateItems]);

  const categoryGroups = useMemo(() => {
    const groups: Record<string, AnimeItem[]> = {};
    privateItems.forEach((item) => {
      const cat = item.category || "Uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }, [privateItems]);

  const heroSlides = useMemo((): HeroSlide[] => {
    const withBackdrop = privateItems.filter((item) => item.backdrop);
    if (withBackdrop.length === 0) return [];
    return withBackdrop.slice(0, 6).map((item) => ({
      id: item.id,
      title: item.title,
      backdrop: item.backdrop,
      subtitle: item.category || "",
      rating: item.rating || "",
      year: item.year || "",
      type: item.type,
      isCustom: false,
      description: item.storyline || "",
    }));
  }, [privateItems]);

  const newReleases = useMemo(() => {
    return [...privateItems]
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .slice(0, 10);
  }, [privateItems]);

  const handlePlay = useCallback((anime: AnimeItem, seasonIdx = 0, epIdx = 0) => {
    if (anime.type === "movie") {
      const src = getMovieSrc(anime);
      if (!src) {
        toast.error("ভিডিও লিংক নেই");
        return;
      }

      setPlayerState({
        src,
        subtitle: anime.year || "Movie",
        anime,
        seasonIdx: 0,
        epIdx: 0,
        qualityOptions: buildMovieQualityOptions(anime),
      });
      return;
    }

    const season = anime.seasons?.[seasonIdx];
    const episode = season?.episodes?.[epIdx];
    const src = getEpisodeSrc(episode);

    if (!season || !episode || !src) {
      toast.error("ভিডিও লিংক নেই");
      return;
    }

    setPlayerState({
      src,
      subtitle: `${season.name} - Episode ${episode.episodeNumber}`,
      anime,
      seasonIdx,
      epIdx,
      qualityOptions: buildEpisodeQualityOptions(episode),
      audioTracks: episode.audioTracks,
    });
  }, []);

  const handleCardClick = useCallback((anime: AnimeItem) => {
    setSelectedAnimeId(anime.id);
  }, []);

  if (playerState) {
    if (playerState.anime.type === "movie") {
      return (
        <div className="fixed inset-0 z-[300]">
          <Suspense fallback={<div className="fixed inset-0 bg-black flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
            <VideoPlayer
              src={playerState.src}
              title={playerState.anime.title}
              subtitle={playerState.subtitle}
              poster={playerState.anime.backdrop || playerState.anime.poster}
              onClose={() => setPlayerState(null)}
              qualityOptions={playerState.qualityOptions}
              animeId={`private_${playerState.anime.id}`}
            />
          </Suspense>
        </div>
      );
    }

    const seasons = playerState.anime.seasons || [];
    const episodes = seasons[playerState.seasonIdx]?.episodes || [];

    const episodeList = episodes.map((episode, index) => ({
      number: episode.episodeNumber || index + 1,
      title: episode.title,
      active: index === playerState.epIdx,
      onClick: () => {
        const clickedSrc = getEpisodeSrc(episode);
        if (!clickedSrc) return;

        setPlayerState((current) => current ? {
          ...current,
          src: clickedSrc,
          subtitle: `${seasons[current.seasonIdx].name} - Episode ${episode.episodeNumber}`,
          epIdx: index,
          qualityOptions: buildEpisodeQualityOptions(episode),
          audioTracks: episode.audioTracks,
        } : null);
      },
    }));

    const handleNextEpisode = playerState.epIdx < episodes.length - 1
      ? () => {
          const nextEpisode = episodes[playerState.epIdx + 1];
          const nextSrc = getEpisodeSrc(nextEpisode);
          if (!nextSrc) return;

          setPlayerState((current) => current ? {
            ...current,
            src: nextSrc,
            subtitle: `${seasons[current.seasonIdx].name} - Episode ${nextEpisode.episodeNumber}`,
            epIdx: current.epIdx + 1,
            qualityOptions: buildEpisodeQualityOptions(nextEpisode),
            audioTracks: nextEpisode.audioTracks,
          } : null);
        }
      : undefined;

    const handleSeasonChange = (nextSeasonIdx: number) => {
      const nextSeason = seasons[nextSeasonIdx];
      const firstEpisode = nextSeason?.episodes?.[0];
      const nextSrc = getEpisodeSrc(firstEpisode);
      if (!nextSeason || !firstEpisode || !nextSrc) return;

      setPlayerState((current) => current ? {
        ...current,
        src: nextSrc,
        subtitle: `${nextSeason.name} - Episode ${firstEpisode.episodeNumber}`,
        seasonIdx: nextSeasonIdx,
        epIdx: 0,
        qualityOptions: buildEpisodeQualityOptions(firstEpisode),
        audioTracks: firstEpisode.audioTracks,
      } : null);
    };

    return (
      <div className="fixed inset-0 z-[300]">
        <Suspense fallback={<div className="fixed inset-0 bg-black flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
          <VideoPlayer
            src={playerState.src}
            title={playerState.anime.title}
            subtitle={playerState.subtitle}
            poster={playerState.anime.backdrop || playerState.anime.poster}
            onClose={() => setPlayerState(null)}
            onNextEpisode={handleNextEpisode}
            episodeList={episodeList}
            qualityOptions={playerState.qualityOptions}
            audioTracks={playerState.audioTracks}
            seasons={seasons.length > 1 ? seasons : undefined}
            currentSeasonIdx={playerState.seasonIdx}
            onSeasonChange={seasons.length > 1 ? handleSeasonChange : undefined}
            animeId={`private_${playerState.anime.id}`}
          />
        </Suspense>
      </div>
    );
  }

  if (selectedAnime && isAuthenticated) {
    return <AnimeDetails anime={selectedAnime} onClose={() => setSelectedAnimeId("")} onPlay={handlePlay} />;
  }

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
              const found = privateItems.find((item) => item.id === slide.id);
              if (found) handlePlay(found, 0, 0);
            }}
            onInfo={(idx) => {
              const slide = heroSlides[idx];
              setSelectedAnimeId(slide.id);
            }}
          />
        )}

        {/* Category Pills */}
        {categories.length > 0 && (
          <CategoryPills active={activeCategory} onSelect={setActiveCategory} categories={categories} />
        )}

        {activeCategory !== "All" ? (
          <div className="px-4 pb-6">
            <h2 className="text-base font-bold mb-3 flex items-center category-bar">{activeCategory}</h2>
            {filteredItems.length > 0 ? (
              <div className="grid grid-cols-3 gap-2.5">
                {filteredItems.map((anime) => (
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
            {newReleases.length > 0 && (
              <AnimeSection title="🔥 New Releases" items={newReleases} onCardClick={handleCardClick} />
            )}

            {Object.entries(categoryGroups).map(([cat, items]) => (
              <AnimeSection key={cat} title={cat} items={items.slice(0, 10)} onCardClick={handleCardClick} />
            ))}

            {privateItems.length > 0 && (
              <div className="px-4 mb-6">
                <h3 className="text-base font-bold mb-3 flex items-center category-bar">📺 All Content</h3>
                <div className="grid grid-cols-3 gap-2.5">
                  {privateItems.map((anime) => {
                    return (
                      <div key={anime.id} className="relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer poster-hover bg-card" onClick={() => handleCardClick(anime)}>
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

            {(contentLoading || privateItems.length === 0) && (
              <div className="text-center py-16">
                {contentLoading ? <Loader2 className="w-12 h-12 text-primary mx-auto mb-3 animate-spin" /> : <Film className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />}
                <p className="text-sm text-muted-foreground">{contentLoading ? "প্রাইভেট কন্টেন্ট লোড হচ্ছে..." : "এখনো কোনো প্রাইভেট কন্টেন্ট নেই"}</p>
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
