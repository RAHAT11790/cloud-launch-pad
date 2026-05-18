import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { AnimeItem, Episode } from "@/data/animeData";
import VideoPlayer from "@/components/VideoPlayer";
import SplashLoader from "@/components/SplashLoader";
import { useFirebaseData } from "@/hooks/useFirebaseData";
import { db, get, ref } from "@/lib/firebase";
import { animeSaltApi } from "@/lib/animeSaltApi";

const isInvalidPlaybackUrl = (url?: string | null) => {
  const normalized = String(url || "").trim().toLowerCase().split("?")[0].split("#")[0];
  if (!normalized) return true;
  return /\.(avif|gif|jpe?g|png|svg|webp|bmp)$/i.test(normalized);
};

const isDirectMediaPlaybackUrl = (url?: string | null) => {
  const normalized = String(url || "").trim().toLowerCase();
  return /\.(m3u8|mp4|webm|ogg|mov|mkv)(?:[?#].*)?$/.test(normalized);
};

const getEpisodeSrc = (ep?: Episode | null): string => {
  if (!ep) return "";
  return [ep.link, ep.link480, ep.link720, ep.link1080, ep.link4k].find((url) => !isInvalidPlaybackUrl(url)) || "";
};

const getMovieSrc = (anime: AnimeItem): string => {
  return [anime.movieLink, anime.movieLink480, anime.movieLink720, anime.movieLink1080, anime.movieLink4k].find((url) => !isInvalidPlaybackUrl(url)) || "";
};

const getEpisodeQualityOptions = (ep?: Episode | null): { label: string; src: string }[] => {
  if (!ep) return [];
  const qualityOptions: { label: string; src: string }[] = [];
  if (!isInvalidPlaybackUrl(ep.link480)) qualityOptions.push({ label: "480p", src: ep.link480! });
  if (!isInvalidPlaybackUrl(ep.link720)) qualityOptions.push({ label: "720p", src: ep.link720! });
  if (!isInvalidPlaybackUrl(ep.link1080)) qualityOptions.push({ label: "1080p", src: ep.link1080! });
  if (!isInvalidPlaybackUrl(ep.link4k)) qualityOptions.push({ label: "4K", src: ep.link4k! });
  return qualityOptions;
};

const getAnimeSaltPlaybackSources = (payload: any): { primarySrc: string; qualityOptions?: { label: string; src: string }[] } => {
  const seen = new Set<string>();
  const normalize = (value?: string | null) => String(value || "").trim();
  const pushUnique = (list: { label: string; src: string }[], label: string, src?: string | null) => {
    const cleanSrc = normalize(src);
    if (!cleanSrc || seen.has(cleanSrc)) return;
    seen.add(cleanSrc);
    list.push({ label, src: cleanSrc });
  };

  const directOptions: { label: string; src: string }[] = [];
  const embedOptions: { label: string; src: string }[] = [];

  const links = Array.isArray(payload?.links) ? payload.links : [];
  links.forEach((entry: any, index: number) => {
    const cleanSrc = normalize(entry?.url || entry?.src);
    if (!cleanSrc) return;
    const label = String(entry?.quality || entry?.label || `Source ${index + 1}`);
    if (isDirectMediaPlaybackUrl(cleanSrc)) {
      pushUnique(directOptions, label, cleanSrc);
    } else {
      pushUnique(embedOptions, `Server ${embedOptions.length + 1}`, cleanSrc);
    }
  });

  [payload?.streamUrl, payload?.videoUrl, payload?.directUrl, payload?.file].forEach((candidate, index) => {
    if (isDirectMediaPlaybackUrl(candidate)) {
      pushUnique(directOptions, index === 0 ? "Auto" : `Source ${index + 1}`, candidate);
    }
  });

  const embedCandidates = [payload?.embedUrl, payload?.movieEmbedUrl, ...(Array.isArray(payload?.allEmbeds) ? payload.allEmbeds : [])];
  embedCandidates.forEach((candidate) => {
    if (isDirectMediaPlaybackUrl(candidate)) {
      pushUnique(directOptions, `Source ${directOptions.length + 1}`, candidate);
    } else {
      pushUnique(embedOptions, `Server ${embedOptions.length + 1}`, candidate);
    }
  });

  if (directOptions.length > 0) {
    return {
      primarySrc: directOptions[0].src,
      qualityOptions: directOptions.length > 1 ? directOptions : undefined,
    };
  }

  return {
    primarySrc: embedOptions[0]?.src || "",
    qualityOptions: embedOptions.length > 1 ? embedOptions : undefined,
  };
};

const Watch = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { allAnime, loading } = useFirebaseData();
  const animeId = params.get("anime") || "";
  const seasonParam = Number(params.get("season") || "0");
  const episodeParam = Number(params.get("episode") || "0");
  const [resolvedSrc, setResolvedSrc] = useState("");
  const [resolvedQualityOptions, setResolvedQualityOptions] = useState<{ label: string; src: string }[] | undefined>(undefined);
  const [forceEmbedMode, setForceEmbedMode] = useState(false);
  const [loadingPlayer, setLoadingPlayer] = useState(true);

  const anime = useMemo(() => allAnime.find((item) => item.id === animeId), [allAnime, animeId]);
  const seasonIdx = Number.isFinite(seasonParam) ? seasonParam : 0;
  const epIdx = Number.isFinite(episodeParam) ? episodeParam : 0;

  const saveVideoProgress = useCallback((currentTime: number, duration: number) => {
    if (!anime?.id) return;
    try {
      const user = localStorage.getItem("rsanime_user");
      if (!user) return;
      const userId = JSON.parse(user).id;
      if (!userId) return;
      import("@/lib/firebase").then(({ update }) => {
        update(ref(db, `users/${userId}/watchHistory/${anime.id}`), { currentTime, duration, watchedAt: Date.now() }).catch(() => {});
      });
    } catch {}
  }, [anime?.id]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (loading) return;
      if (!anime) {
        setLoadingPlayer(false);
        return;
      }

      setLoadingPlayer(true);
      setForceEmbedMode(false);
      setResolvedQualityOptions(undefined);

      if (anime.type === "webseries") {
        const episode = anime.seasons?.[seasonIdx]?.episodes?.[epIdx];
        const rawSrc = getEpisodeSrc(episode);

        if (String(rawSrc).startsWith("animesalt://")) {
          try {
            const epSlug = rawSrc.replace("animesalt://", "");
            const result = await animeSaltApi.getEpisode(epSlug);
            if (cancelled) return;
            const { primarySrc, qualityOptions } = getAnimeSaltPlaybackSources(result);
            setResolvedSrc(primarySrc);
            setResolvedQualityOptions(qualityOptions);
            setForceEmbedMode(!isDirectMediaPlaybackUrl(primarySrc));
          } catch {
            if (!cancelled) toast.error("Failed to load video");
          } finally {
            if (!cancelled) setLoadingPlayer(false);
          }
          return;
        }

        setResolvedSrc(rawSrc);
        setResolvedQualityOptions(getEpisodeQualityOptions(episode));
        setLoadingPlayer(false);
        return;
      }

      const movieSrc = getMovieSrc(anime);
      if (String(movieSrc).startsWith("animesalt_movie://")) {
        try {
          const movieSlug = movieSrc.replace("animesalt_movie://", "");
          const result = await animeSaltApi.getMovie(movieSlug);
          if (cancelled) return;
          const { primarySrc, qualityOptions } = getAnimeSaltPlaybackSources(result.success ? result.data : result);
          setResolvedSrc(primarySrc);
          setResolvedQualityOptions(qualityOptions);
          setForceEmbedMode(!isDirectMediaPlaybackUrl(primarySrc));
        } catch {
          if (!cancelled) toast.error("Failed to load movie");
        } finally {
          if (!cancelled) setLoadingPlayer(false);
        }
        return;
      }

      setResolvedSrc(movieSrc);
      setResolvedQualityOptions([
        !isInvalidPlaybackUrl(anime.movieLink480) ? { label: "480p", src: anime.movieLink480! } : null,
        !isInvalidPlaybackUrl(anime.movieLink720) ? { label: "720p", src: anime.movieLink720! } : null,
        !isInvalidPlaybackUrl(anime.movieLink1080) ? { label: "1080p", src: anime.movieLink1080! } : null,
        !isInvalidPlaybackUrl(anime.movieLink4k) ? { label: "4K", src: anime.movieLink4k! } : null,
      ].filter(Boolean) as { label: string; src: string }[]);
      setLoadingPlayer(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [anime, epIdx, loading, seasonIdx]);

  const episode = anime?.type === "webseries" ? anime.seasons?.[seasonIdx]?.episodes?.[epIdx] : undefined;
  const audioTracks = episode?.audioTracks;
  const subtitle = anime?.type === "webseries" && episode
    ? `${anime.seasons?.[seasonIdx]?.name || `Season ${seasonIdx + 1}`} - Episode ${episode.episodeNumber}`
    : "Movie";

  const episodeList = anime?.type === "webseries"
    ? anime.seasons?.[seasonIdx]?.episodes.map((ep, index) => ({
        number: ep.episodeNumber,
        title: ep.title,
        active: index === epIdx,
        onClick: () => navigate(`/video?anime=${anime.id}&season=${seasonIdx}&episode=${index}`),
      }))
    : undefined;

  const onNextEpisode = anime?.type === "webseries" && anime.seasons?.[seasonIdx]?.episodes?.[epIdx + 1]
    ? () => navigate(`/video?anime=${anime.id}&season=${seasonIdx}&episode=${epIdx + 1}`)
    : undefined;

  if (loading || loadingPlayer) {
    return <SplashLoader />;
  }

  if (!anime || !resolvedSrc) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6 text-center">
        <div>
          <p className="text-foreground font-semibold mb-2">Video not found</p>
          <button onClick={() => navigate(-1)} className="text-sm text-muted-foreground">Go back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      <VideoPlayer
        src={resolvedSrc}
        title={anime.title}
        subtitle={subtitle}
        poster={anime.poster}
        onClose={() => navigate(-1)}
        qualityOptions={resolvedQualityOptions}
        audioTracks={audioTracks}
        animeId={anime.id}
        onSaveProgress={saveVideoProgress}
        onNextEpisode={onNextEpisode}
        episodeList={episodeList}
        seasons={anime.seasons}
        currentSeasonIdx={anime.type === "webseries" ? seasonIdx : undefined}
        onSeasonChange={anime.type === "webseries" ? (idx) => navigate(`/video?anime=${anime.id}&season=${idx}&episode=0`) : undefined}
        suggestedAnime={[]}
        onSuggestedClick={(nextAnime) => navigate(`/?anime=${nextAnime.id}`)}
        nextEpisodeSrc={anime.type === "webseries" ? getEpisodeSrc(anime.seasons?.[seasonIdx]?.episodes?.[epIdx + 1] as Episode) : undefined}
        forceEmbedMode={forceEmbedMode}
      />
    </div>
  );
};

export default Watch;