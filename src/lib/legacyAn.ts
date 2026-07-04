export const LEGACY_AN_ROOTS = ["animesaltCache", "anSeries", "anMovies", "animesalt", "animesaltSelected"] as const;
export const LEGACY_AN_ROOT_SET = new Set<string>(LEGACY_AN_ROOTS);
export const LEGACY_AN_CARD_ROOTS = ["webseries", "movies", "newEpisodeReleases"] as const;

const normalize = (value: unknown) => String(value || "").trim().toLowerCase();

export const isLegacyAnKey = (key: unknown): boolean => {
  const lowerKey = normalize(key);
  return (
    lowerKey.startsWith("an_") ||
    lowerKey.startsWith("an-mv") ||
    lowerKey.startsWith("an_mv_") ||
    lowerKey.startsWith("as_") ||
    lowerKey.startsWith("as-mv")
  );
};

export const isLegacyAnValue = (value: any): boolean => {
  if (!value || typeof value !== "object") return false;
  const id = normalize(value.id);
  const source = normalize(value.source);
  const sourceName = normalize(value.sourceName);
  const provider = normalize(value.provider);
  const displayAs = normalize(value.displayAs);
  return (
    isLegacyAnKey(id) ||
    Boolean(value.anSlug || value.animeSaltSlug) ||
    source === "an" ||
    source === "animesalt" ||
    sourceName.includes("animesalt") ||
    provider.includes("animesalt") ||
    displayAs === "an"
  );
};

export const isLegacyAnEntry = (keyOrValue: unknown, maybeValue?: any): boolean => {
  if (maybeValue === undefined) return isLegacyAnValue(keyOrValue) || isLegacyAnKey((keyOrValue as any)?.id);
  return isLegacyAnKey(keyOrValue) || isLegacyAnValue({ ...maybeValue, id: maybeValue?.id || keyOrValue });
};

export const stripLegacyAnItems = <T,>(items: T[] | undefined | null): T[] =>
  Array.isArray(items) ? (items.filter((item) => !isLegacyAnEntry(item)) as T[]) : [];

export const clearLegacyAnBrowserCaches = () => {
  if (typeof window === "undefined") return;
  const directKeys = [
    "rs_cache_webseries_v1",
    "rs_cache_movies_v1",
    "rs_admin_webseries_index_v1",
    "rs_admin_movies_index_v1",
    "rs_admin_count_webseries_v1",
    "rs_admin_count_movies_v1",
    "rs_admin_count_newEpisodeReleases_v1",
  ];
  directKeys.forEach((key) => {
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  });
  [localStorage, sessionStorage].forEach((storage) => {
    try {
      Object.keys(storage)
        .filter((key) => key.startsWith("rs_rest_cache:webseries") || key.startsWith("rs_rest_cache:movies") || key.startsWith("rs_rest_cache:newEpisodeReleases") || key.startsWith("rs_rest_cache:adminContentIndex"))
        .forEach((key) => storage.removeItem(key));
    } catch {}
  });
};