// Hide Continue Watching / Watch History cards whose series was removed by admin.
// Only Firebase-owned content is checked; live AN (an_) and AnimeSalt (as_) items
// come from external catalogues and are kept as-is.
export const isExternalHistoryId = (id: unknown) => /^(as_|an_)/.test(String(id || ""));

export function filterExistingHistory<T extends { id?: unknown }>(items: T[], catalog: Array<{ id?: unknown }> | undefined, catalogReady: boolean): T[] {
  if (!catalogReady || !catalog || catalog.length === 0) return items;
  const ids = new Set(catalog.map((a) => String(a?.id || "")));
  return items.filter((item) => isExternalHistoryId(item?.id) || ids.has(String(item?.id || "")));
}
