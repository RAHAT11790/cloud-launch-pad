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
export type TelegramEpisodeSelection = { episode: number; qualities: string[] };
export type TelegramRequestGroup = { episodes: number[]; qualities: string[] };

/**
 * The bot accepts one quality set per link. Episodes that need the same
 * qualities share one link; different sets become separate steps, so no
 * episode is ever asked for a quality it does not have.
 */
export const groupTelegramSelections = (selections: TelegramEpisodeSelection[]): TelegramRequestGroup[] => {
  const order = ["480P", "720P", "1080P", "4K"];
  const groups = new Map<string, TelegramRequestGroup>();
  selections.forEach(({ episode, qualities }) => {
    const qs = Array.from(new Set(qualities.map((q) => String(q).toUpperCase())))
      .filter((q) => order.includes(q))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (!qs.length || !(episode > 0)) return;
    const key = qs.join("-");
    const g = groups.get(key) || { episodes: [], qualities: qs };
    g.episodes.push(episode);
    groups.set(key, g);
  });
  return Array.from(groups.values())
    .map((g) => ({ ...g, episodes: Array.from(new Set(g.episodes)).sort((a, b) => a - b) }))
    .sort((a, b) => a.episodes[0] - b.episodes[0]);
};
