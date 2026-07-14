import type { AnimeItem, AudioTrack, Episode, MoviePart, Season, SubtitleTrack } from "@/data/animeData";
import {
  normalizeCastFrom,
  normalizeCategoryFrom,
  normalizeDirectorsFrom,
  normalizeGenresFrom,
  normalizeOverviewFrom,
  normalizeRatingFrom,
  normalizeYearFrom,
} from "@/lib/contentMetadata";

type MapOptions = { full?: boolean };

const values = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
};

const mapAudioTracks = (tracks: any): AudioTrack[] | undefined => {
  const list = values(tracks)
    .map((at: any) => ({
      language: at?.language || "",
      label: at?.label || at?.language || "",
      link: at?.link || at?.audioUrl || at?.rawAudioUrl || "",
      audioUrl: at?.audioUrl || at?.link || at?.rawAudioUrl || undefined,
      rawAudioUrl: at?.rawAudioUrl || at?.audioUrl || at?.link || undefined,
      isDefault: at?.isDefault === true,
      link480: at?.link480 || undefined,
      link720: at?.link720 || undefined,
      link1080: at?.link1080 || undefined,
      link4k: at?.link4k || undefined,
    }))
    .filter((at) => at.language || at.label || at.link);
  return list.length ? list : undefined;
};

const mapSubtitleTracks = (tracks: any): SubtitleTrack[] | undefined => {
  const list = values(tracks)
    .map((st: any) => ({
      language: st?.language || undefined,
      label: st?.label || st?.language || "Subtitle",
      url: st?.url || st?.link || "",
    }))
    .filter((st) => st.url);
  return list.length ? list : undefined;
};

const mapEpisode = (ep: any): Episode => ({
  episodeNumber: Number(ep?.episodeNumber || ep?.number || 0) || 0,
  title: ep?.title || "",
  link: ep?.link || "",
  link480: ep?.link480 || undefined,
  link720: ep?.link720 || undefined,
  link1080: ep?.link1080 || undefined,
  link4k: ep?.link4k || undefined,
  subtitleTracks: mapSubtitleTracks(ep?.subtitleTracks),
  audioTracks: mapAudioTracks(ep?.audioTracks),
});

const mapSeasons = (seasons: any): Season[] | undefined => {
  const list = values(seasons)
    .map((s: any) => ({
      name: s?.name || "",
      episodes: values(s?.episodes)
        .map(mapEpisode)
        .sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0)),
    }))
    .filter((season) => season.name || season.episodes.length);
  return list.length ? list : undefined;
};

const countEpisodes = (seasons: any): number | undefined => {
  const total = values(seasons).reduce((sum, season: any) => sum + values(season?.episodes).length, 0);
  return total > 0 ? total : undefined;
};

const countBestEpisodes = (item: any): number | undefined => {
  const stored = Number(item?.episodeCount || 0) || 0;
  if (stored > 0) return stored;
  const direct = countEpisodes(item?.seasons);
  if (direct) return direct;
  const custom = countEpisodes(item?.customSeasons);
  if (custom) return custom;
  if (item?.seasonsByLanguage && typeof item.seasonsByLanguage === "object") {
    const best = Math.max(0, ...Object.values(item.seasonsByLanguage).map((seasons) => countEpisodes(seasons) || 0));
    return best > 0 ? best : undefined;
  }
  return undefined;
};

const mapMovieParts = (parts: any): MoviePart[] | undefined => {
  const list = values(parts)
    .map((p: any, idx: number): MoviePart => ({
      partNumber: Number(p?.partNumber || p?.number || idx + 1) || (idx + 1),
      title: p?.title || undefined,
      link: p?.link || p?.movieLink || "",
      link480: p?.link480 || p?.movieLink480 || undefined,
      link720: p?.link720 || p?.movieLink720 || undefined,
      link1080: p?.link1080 || p?.movieLink1080 || undefined,
      link4k: p?.link4k || p?.movieLink4k || undefined,
    }))
    .filter((p) => p.link || p.link480 || p.link720 || p.link1080 || p.link4k)
    .sort((a, b) => (a.partNumber || 0) - (b.partNumber || 0));
  return list.length ? list : undefined;
};

const isAnimeSaltRow = (item: any) => Boolean(item?.anSlug || item?.animeSaltSlug || item?.sourceName === "AnimeSalt" || item?.source === "animesalt");

export const mapFirebaseWebseriesItem = (id: string, item: any, opts: MapOptions = {}): AnimeItem => {
  const isAn = isAnimeSaltRow(item);
  const displayAs = String(item?.displayAs || (isAn ? "an" : "rs")).toLowerCase();
  const genres = normalizeGenresFrom(item);
  const cast = normalizeCastFrom(item, 12);
  const directors = normalizeDirectorsFrom(item);
  const seasons = opts.full ? mapSeasons(item?.seasons) : undefined;
  const seasonsByLanguage = opts.full && item?.seasonsByLanguage && typeof item.seasonsByLanguage === "object"
    ? Object.fromEntries(
        Object.entries(item.seasonsByLanguage).map(([lang, langSeasons]) => [lang, mapSeasons(langSeasons) || []]),
      )
    : undefined;

  return {
    id,
    source: displayAs === "an" ? "animesalt" : "firebase",
    sourceName: item?.sourceName || (isAn ? "AnimeSalt" : undefined),
    anSlug: item?.anSlug || item?.animeSaltSlug || undefined,
    animeSaltSlug: item?.animeSaltSlug || item?.anSlug || undefined,
    displayAs: item?.displayAs || undefined,
    slug: item?.slug || item?.anSlug || item?.animeSaltSlug || undefined,
    title: item?.title || "",
    poster: item?.poster || "",
    backdrop: item?.backdrop || "",
    logo: item?.logo || item?.titleLogo || "",
    year: normalizeYearFrom(item),
    rating: normalizeRatingFrom(item),
    language: item?.language || "",
    baseLanguage: item?.baseLanguage || item?.language || "",
    availableLanguages: Array.isArray(item?.availableLanguages) ? item.availableLanguages : undefined,
    seasonsByLanguage,
    category: normalizeCategoryFrom(item, genres, ""),
    type: "webseries",
    storyline: normalizeOverviewFrom(item),
    tmdbId: item?.tmdbId || undefined,
    genres: genres.length ? genres : undefined,
    directors: directors.length ? directors : undefined,
    cast: opts.full ? (cast.length ? cast : undefined) : (cast.length ? cast : undefined),
    audioTracks: opts.full ? mapAudioTracks(item?.audioTracks) : undefined,
    dubType: item?.dubType || "official",
    premium: !!item?.premium,
    premiumEpisodes: item?.premiumEpisodes || {},
    seasons,
    episodeCount: opts.full ? undefined : countBestEpisodes(item),
    trailer: item?.trailer || undefined,
    movieLink: undefined,
    createdAt: item?.createdAt || 0,
    updatedAt: item?.updatedAt || 0,
  };
};

export const mapFirebaseMovieItem = (id: string, item: any, opts: MapOptions = {}): AnimeItem => {
  const isAn = isAnimeSaltRow(item);
  const displayAs = String(item?.displayAs || (isAn ? "an" : "rs")).toLowerCase();
  const genres = normalizeGenresFrom(item);
  const cast = normalizeCastFrom(item, 12);
  const directors = normalizeDirectorsFrom(item);
  return {
    id,
    source: displayAs === "an" ? "animesalt" : "firebase",
    sourceName: item?.sourceName || (isAn ? "AnimeSalt" : undefined),
    anSlug: item?.anSlug || item?.animeSaltSlug || undefined,
    animeSaltSlug: item?.animeSaltSlug || item?.anSlug || undefined,
    displayAs: item?.displayAs || undefined,
    slug: item?.slug || item?.anSlug || item?.animeSaltSlug || undefined,
    title: item?.title || "",
    poster: item?.poster || "",
    backdrop: item?.backdrop || "",
    logo: item?.logo || item?.titleLogo || "",
    year: normalizeYearFrom(item),
    rating: normalizeRatingFrom(item),
    language: item?.language || "",
    baseLanguage: item?.baseLanguage || item?.language || "",
    availableLanguages: Array.isArray(item?.availableLanguages) ? item.availableLanguages : undefined,
    category: normalizeCategoryFrom(item, genres, ""),
    type: "movie",
    storyline: normalizeOverviewFrom(item),
    tmdbId: item?.tmdbId || undefined,
    genres: genres.length ? genres : undefined,
    directors: directors.length ? directors : undefined,
    cast: opts.full ? (cast.length ? cast : undefined) : (cast.length ? cast : undefined),
    audioTracks: mapAudioTracks(item?.audioTracks),
    dubType: item?.dubType || "official",
    premium: !!item?.premium,
    premiumEpisodes: item?.premiumEpisodes || {},
    movieLink: item?.movieLink || "",
    movieLink480: item?.movieLink480 || undefined,
    movieLink720: item?.movieLink720 || undefined,
    movieLink1080: item?.movieLink1080 || undefined,
    movieLink4k: item?.movieLink4k || undefined,
    parts: mapMovieParts(item?.parts),
    trailer: item?.trailer || undefined,
    seasons: undefined,
    createdAt: item?.createdAt || 0,
    updatedAt: item?.updatedAt || 0,
  };
};

export const mapAnimeSaltSelectedItem = (slug: string, item: any): AnimeItem => {
  const isMovie = item?.type === "movies" || item?.type === "movie";
  const genres = normalizeGenresFrom(item);
  const cast = normalizeCastFrom(item, 12);
  const directors = normalizeDirectorsFrom(item);
  return {
    id: isMovie ? `as_mv_${slug}` : `as_${slug}`,
    source: "animesalt",
    sourceName: "AnimeSalt",
    anSlug: slug,
    animeSaltSlug: slug,
    slug,
    title: item?.title || slug,
    poster: item?.poster || item?.tmdbPoster || item?.posterUrl || "",
    backdrop: item?.backdrop || item?.tmdbBackdrop || item?.backdropUrl || item?.poster || "",
    year: normalizeYearFrom(item),
    rating: normalizeRatingFrom(item),
    language: item?.language || "",
    baseLanguage: item?.baseLanguage || item?.language || "",
    availableLanguages: Array.isArray(item?.availableLanguages) ? item.availableLanguages : undefined,
    category: normalizeCategoryFrom(item, genres, "Anime"),
    type: isMovie ? "movie" : "webseries",
    storyline: normalizeOverviewFrom(item),
    tmdbId: item?.tmdbId || undefined,
    genres: genres.length ? genres : undefined,
    directors: directors.length ? directors : undefined,
    cast: cast.length ? cast : undefined,
    dubType: item?.dubType || "official",
    premium: !!item?.premium,
    premiumEpisodes: item?.premiumEpisodes || {},
    createdAt: item?.createdAt || item?.addedAt || 0,
    updatedAt: item?.updatedAt || item?.addedAt || 0,
    episodeCount: countBestEpisodes(item),
  };
};