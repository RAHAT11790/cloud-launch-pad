import { db, ref, set, remove } from "@/lib/firebase";

type Collection = "webseries" | "movies";

const stripUndefined = <T,>(value: T): T => {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, any>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefined(entry)]),
    ) as T;
  }
  return value;
};

const countEpisodes = (seasons: any): { seasonsCount: number; episodeCount: number } => {
  const list = Array.isArray(seasons) ? seasons : seasons && typeof seasons === "object" ? Object.values(seasons) : [];
  let episodeCount = 0;
  list.forEach((season: any) => {
    const episodes = Array.isArray(season?.episodes)
      ? season.episodes
      : season?.episodes && typeof season.episodes === "object"
        ? Object.values(season.episodes)
        : [];
    episodeCount += episodes.length;
  });
  return { seasonsCount: list.length, episodeCount };
};

export const buildPublicCatalogItem = (collection: Collection, id: string, item: any) => {
  const isAn = Boolean(item?.anSlug || item?.animeSaltSlug || item?.sourceName === "AnimeSalt" || item?.source === "animesalt");
  const counts = collection === "webseries" ? countEpisodes(item?.seasons) : { seasonsCount: 0, episodeCount: 0 };
  return stripUndefined({
    id,
    title: item?.title || "",
    poster: item?.poster || "",
    backdrop: item?.backdrop || item?.poster || "",
    year: item?.year || "",
    rating: item?.rating || "",
    language: item?.language || "",
    baseLanguage: item?.baseLanguage || item?.language || "",
    availableLanguages: Array.isArray(item?.availableLanguages) ? item.availableLanguages : undefined,
    category: item?.category || "",
    dubType: item?.dubType || "official",
    visibility: item?.visibility === "private" ? "private" : "public",
    type: collection === "movies" ? "movie" : "webseries",
    source: isAn ? "animesalt" : (item?.source || "firebase"),
    sourceName: item?.sourceName || (isAn ? "AnimeSalt" : undefined),
    anSlug: item?.anSlug || item?.animeSaltSlug || undefined,
    animeSaltSlug: item?.animeSaltSlug || item?.anSlug || undefined,
    displayAs: item?.displayAs || (isAn ? "an" : undefined),
    slug: item?.slug || item?.anSlug || item?.animeSaltSlug || undefined,
    tmdbId: item?.tmdbId ?? undefined,
    movieLink: collection === "movies" ? (item?.movieLink || "") : undefined,
    movieLink480: collection === "movies" ? (item?.movieLink480 || "") : undefined,
    movieLink720: collection === "movies" ? (item?.movieLink720 || "") : undefined,
    movieLink1080: collection === "movies" ? (item?.movieLink1080 || "") : undefined,
    movieLink4k: collection === "movies" ? (item?.movieLink4k || "") : undefined,
    seasonsCount: counts.seasonsCount || undefined,
    episodeCount: counts.episodeCount || undefined,
    createdAt: item?.createdAt || 0,
    updatedAt: item?.updatedAt || item?.createdAt || Date.now(),
  });
};

export const savePublicCatalogItem = async (collection: Collection, id: string, item: any) => {
  if (!id) return;
  if (item?.visibility === "private") {
    await remove(ref(db, `publicCatalog/${collection}/${id}`));
    return;
  }
  await set(ref(db, `publicCatalog/${collection}/${id}`), buildPublicCatalogItem(collection, id, item));
};

export const removePublicCatalogItem = async (collection: Collection, id: string) => {
  if (!id) return;
  await remove(ref(db, `publicCatalog/${collection}/${id}`));
};