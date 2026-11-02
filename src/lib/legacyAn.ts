const normalize = (value: unknown) => String(value || "").trim().toLowerCase();

const isLegacyAnKey = (key: unknown): boolean => {
  const lowerKey = normalize(key);
  return (
    lowerKey.startsWith("an_") ||
    lowerKey.startsWith("an-mv") ||
    lowerKey.startsWith("an_mv_") ||
    lowerKey.startsWith("as_") ||
    lowerKey.startsWith("as-mv")
  );
};

const isLegacyAnValue = (value: any): boolean => {
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