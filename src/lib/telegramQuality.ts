const TELEGRAM_QUALITY_ORDER = ["480p", "720p", "1080p", "4K"] as const;

const hasMediaLink = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

/** Returns only qualities physically present on the supplied episodes/parts. */
export const collectTelegramEpisodeQualities = (items: unknown[]): string[] => {
  const found = new Set<string>();
  (Array.isArray(items) ? items : []).forEach((item: any) => {
    if (hasMediaLink(item?.link480)) found.add("480p");
    if (hasMediaLink(item?.link720)) found.add("720p");
    if (hasMediaLink(item?.link1080)) found.add("1080p");
    if (hasMediaLink(item?.link4k)) found.add("4K");
  });
  return TELEGRAM_QUALITY_ORDER.filter((quality) => found.has(quality));
};