import { db, get, limitToLast, orderByChild, query, ref, remove, set } from "@/lib/firebase";
import { firebaseRestGet, firebaseRestShallowKeys } from "@/lib/firebaseRest";

export type AdminContentKind = "webseries" | "movies";

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RECENT_LIMIT = 120;

const cacheKeyFor = (kind: AdminContentKind) => `rs_admin_${kind}_index_v1`;
const indexPathFor = (kind: AdminContentKind) => `adminContentIndex/${kind}`;

const toArray = (value: any): any[] => Array.isArray(value) ? value : [];

const countEpisodes = (item: any) => {
  if (Number.isFinite(Number(item?.episodeCount))) return Number(item.episodeCount) || 0;
  const countSeasonList = (seasons: any) => toArray(seasons).reduce((sum, season) => sum + toArray(season?.episodes).length, 0);
  const direct = countSeasonList(item?.seasons);
  if (direct > 0) return direct;
  const custom = countSeasonList(item?.customSeasons);
  if (custom > 0) return custom;
  if (item?.seasonsByLanguage && typeof item.seasonsByLanguage === "object") {
    return Math.max(0, ...Object.values(item.seasonsByLanguage).map(countSeasonList));
  }
  return 0;
};

const countSeasons = (item: any) => {
  const direct = toArray(item?.seasons).length;
  if (direct > 0) return direct;
  const custom = toArray(item?.customSeasons).length;
  if (custom > 0) return custom;
  if (item?.seasonsByLanguage && typeof item.seasonsByLanguage === "object") {
    return Math.max(0, ...Object.values(item.seasonsByLanguage).map((seasons) => toArray(seasons).length));
  }
  return 0;
};

export const buildAdminContentIndexItem = (id: string, item: any, kind: AdminContentKind) => ({
  id,
  title: String(item?.title || "Untitled"),
  poster: String(item?.poster || item?.image || ""),
  backdrop: String(item?.backdrop || item?.poster || ""),
  year: String(item?.year || ""),
  rating: String(item?.rating || ""),
  language: String(item?.language || item?.baseLanguage || ""),
  category: String(item?.category || ""),
  visibility: item?.visibility === "private" ? "private" : "public",
  type: kind === "movies" ? "movie" : "webseries",
  tmdbId: item?.tmdbId ?? null,
  anSlug: String(item?.anSlug || item?.animeSaltSlug || ""),
  animeSaltSlug: String(item?.animeSaltSlug || item?.anSlug || ""),
  source: String(item?.source || ""),
  sourceName: String(item?.sourceName || ""),
  displayAs: String(item?.displayAs || ""),
  dubType: String(item?.dubType || "official"),
  seasonCount: kind === "webseries" ? countSeasons(item) : 0,
  episodeCount: kind === "webseries" ? countEpisodes(item) : 0,
  createdAt: Number(item?.createdAt || 0),
  updatedAt: Number(item?.updatedAt || item?.createdAt || 0),
});

export const readCachedAdminContentList = (kind: AdminContentKind) => {
  try {
    const raw = localStorage.getItem(cacheKeyFor(kind));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || Date.now() - Number(parsed.ts) > CACHE_TTL_MS) return [];
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
};

export const writeCachedAdminContentList = (kind: AdminContentKind, items: any[]) => {
  try {
    localStorage.setItem(cacheKeyFor(kind), JSON.stringify({ ts: Date.now(), items }));
  } catch {}
};

export const sortAdminContentList = (items: any[]) => [...items].sort((a, b) =>
  Number(b?.updatedAt || b?.createdAt || 0) - Number(a?.updatedAt || a?.createdAt || 0) ||
  String(a?.title || "").localeCompare(String(b?.title || "")),
);

export const mergeAdminContentLists = (...lists: any[][]) => {
  const map = new Map<string, any>();
  lists.flat().forEach((item) => {
    if (!item?.id) return;
    map.set(String(item.id), { ...(map.get(String(item.id)) || {}), ...item });
  });
  return sortAdminContentList(Array.from(map.values()));
};

export const fetchAdminContentIndex = async (kind: AdminContentKind) => {
  const snap = await get(ref(db, indexPathFor(kind)));
  const data = snap.val() || {};
  return sortAdminContentList(Object.entries(data).map(([id, item]: [string, any]) => ({ id, ...item })));
};

export const fetchRecentAdminContentList = async (kind: AdminContentKind, limit = DEFAULT_RECENT_LIMIT) => {
  // 1) Try the indexed query — fastest path when items carry `updatedAt`.
  try {
    const snap = await get(query(ref(db, kind), orderByChild("updatedAt"), limitToLast(limit)));
    const data = snap.val() || {};
    const items = Object.entries(data).map(([id, item]: [string, any]) => buildAdminContentIndexItem(id, item, kind));
    if (items.length) return sortAdminContentList(items);
  } catch {}
  // 2) Fallback: shallow keys + paginated REST hydration. Required because
  // legacy webseries/movies rows written before the indexing system don't have
  // `updatedAt`, and `orderByChild("updatedAt")` silently drops them — which
  // is why the Admin panel was showing an empty list.
  try {
    const keys = await firebaseRestShallowKeys(kind);
    const recent = keys.slice(-limit);
    const items: any[] = [];
    const chunkSize = 8;
    for (let i = 0; i < recent.length; i += chunkSize) {
      const chunk = recent.slice(i, i + chunkSize);
      const rows = await Promise.all(chunk.map(async (id) => {
        try {
          const item = await firebaseRestGet<any>(`${kind}/${id}`);
          return item ? buildAdminContentIndexItem(id, item, kind) : null;
        } catch { return null; }
      }));
      rows.forEach((row) => { if (row) items.push(row); });
    }
    return sortAdminContentList(items);
  } catch {
    return [];
  }
};

export const upsertAdminContentIndex = async (kind: AdminContentKind, id: string, item: any) => {
  if (!id) return;
  await set(ref(db, `${indexPathFor(kind)}/${id}`), buildAdminContentIndexItem(id, item, kind));
};

export const removeAdminContentIndex = async (kind: AdminContentKind, id: string) => {
  if (!id) return;
  await remove(ref(db, `${indexPathFor(kind)}/${id}`));
};

export const primeAdminContentIndexFromList = async (kind: AdminContentKind, items: any[]) => {
  await Promise.all((items || []).slice(0, DEFAULT_RECENT_LIMIT).map((item: any) => upsertAdminContentIndex(kind, item.id, item).catch(() => {})));
};