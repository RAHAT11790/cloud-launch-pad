import { db, get, limitToLast, orderByChild, query, ref, remove, set } from "@/lib/firebase";
import { firebaseRestGet, firebaseRestShallowKeys } from "@/lib/firebaseRest";
import { isLegacyAnEntry } from "@/lib/legacyAn";

export type AdminContentKind = "webseries" | "movies";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Admin cards are mostly static; do NOT re-fetch on every router open.
const DEFAULT_RECENT_LIMIT = 500;
const memoryListCache = new Map<AdminContentKind, { ts: number; items: any[] }>();

const cacheKeyFor = (kind: AdminContentKind) => `rs_admin_${kind}_index_v2`;
const countCacheKeyFor = (path: string) => `rs_admin_count_${path}_v1`;
const indexPathFor = (kind: AdminContentKind) => `adminContentIndex/${kind}`;

const values = (value: any): any[] => Array.isArray(value) ? value : (value && typeof value === "object" ? Object.values(value) : []);
const stripLegacyAnFromAdminList = (items: any[]) => (items || []).filter((item) => !isLegacyAnEntry(item?.id, item));

const countEpisodes = (item: any) => {
  if (Number.isFinite(Number(item?.episodeCount)) && Number(item.episodeCount) > 0) return Number(item.episodeCount);
  const countSeasonList = (seasons: any) => values(seasons).reduce((sum, season) => sum + values(season?.episodes).length, 0);
  const direct = countSeasonList(item?.seasons);
  if (direct > 0) return direct;
  const custom = countSeasonList(item?.customSeasons);
  if (custom > 0) return custom;
  if (item?.seasonsByLanguage && typeof item.seasonsByLanguage === "object") {
    const fromLangs = Math.max(0, ...Object.values(item.seasonsByLanguage).map(countSeasonList));
    if (fromLangs > 0) return fromLangs;
  }
  const declared = Number(item?.totalEpisodes || item?.numberOfEpisodes || 0);
  return Number.isFinite(declared) && declared > 0 ? declared : 0;
};

const countSeasons = (item: any) => {
  if (Number.isFinite(Number(item?.seasonCount)) && Number(item.seasonCount) > 0) return Number(item.seasonCount);
  const direct = values(item?.seasons).length;
  if (direct > 0) return direct;
  const custom = values(item?.customSeasons).length;
  if (custom > 0) return custom;
  if (item?.seasonsByLanguage && typeof item.seasonsByLanguage === "object") {
    const fromLangs = Math.max(0, ...Object.values(item.seasonsByLanguage).map((seasons) => values(seasons).length));
    if (fromLangs > 0) return fromLangs;
  }
  const declared = Number(item?.numberOfSeasons || 0);
  return Number.isFinite(declared) && declared > 0 ? declared : 0;
};


export const buildAdminContentIndexItem = (id: string, item: any, kind: AdminContentKind) => ({
  id,
  title: String(item?.title || "Untitled"),
  poster: String(item?.poster || item?.image || ""),
  backdrop: String(item?.backdrop || item?.poster || ""),
  logo: String(item?.logo || item?.titleLogo || ""),
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
  premium: !!item?.premium,
  premiumEpisodes: item?.premiumEpisodes || {},
  seasonCount: kind === "webseries" ? countSeasons(item) : 0,
  episodeCount: kind === "webseries" ? countEpisodes(item) : 0,
  createdAt: Number(item?.createdAt || 0),
  updatedAt: Number(item?.updatedAt || item?.createdAt || 0),
});

export const readCachedAdminContentList = (kind: AdminContentKind) => {
  try {
    const memory = memoryListCache.get(kind);
    if (memory?.ts && Date.now() - Number(memory.ts) <= CACHE_TTL_MS && memory.items.length) return stripLegacyAnFromAdminList(memory.items);
    const raw = localStorage.getItem(cacheKeyFor(kind));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || Date.now() - Number(parsed.ts) > CACHE_TTL_MS) return [];
    const items = Array.isArray(parsed.items) ? stripLegacyAnFromAdminList(parsed.items) : [];
    if (items.length) memoryListCache.set(kind, { ts: Number(parsed.ts), items });
    return items;
  } catch {
    return [];
  }
};

export const isAdminContentCacheFresh = (kind: AdminContentKind) => {
  try {
    const memory = memoryListCache.get(kind);
    if (memory?.ts && Date.now() - Number(memory.ts) <= CACHE_TTL_MS && memory.items.length) return true;
    const raw = localStorage.getItem(cacheKeyFor(kind));
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts) return false;
    if (Date.now() - Number(parsed.ts) > CACHE_TTL_MS) return false;
    return Array.isArray(parsed.items) && parsed.items.length > 0;
  } catch {
    return false;
  }
};

export const invalidateAdminContentCache = (kind?: AdminContentKind) => {
  try {
    if (kind) { localStorage.removeItem(cacheKeyFor(kind)); memoryListCache.delete(kind); }
    else {
      localStorage.removeItem(cacheKeyFor("webseries"));
      localStorage.removeItem(cacheKeyFor("movies"));
      memoryListCache.clear();
    }
  } catch {}
};

export const writeCachedAdminContentList = (kind: AdminContentKind, items: any[]) => {
  try {
    const clean = stripLegacyAnFromAdminList(items);
    memoryListCache.set(kind, { ts: Date.now(), items: clean });
    localStorage.setItem(cacheKeyFor(kind), JSON.stringify({ ts: Date.now(), items: clean }));
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
    if (isLegacyAnEntry(item.id, item)) return;
    map.set(String(item.id), { ...(map.get(String(item.id)) || {}), ...item });
  });
  return sortAdminContentList(Array.from(map.values()));
};

export const fetchAdminContentIndex = async (kind: AdminContentKind) => {
  const snap = await get(ref(db, indexPathFor(kind)));
  const data = snap.val() || {};
  return sortAdminContentList(stripLegacyAnFromAdminList(Object.entries(data).map(([id, item]: [string, any]) => ({ id, ...item }))));
};

export const fetchRecentAdminContentList = async (kind: AdminContentKind, limit = DEFAULT_RECENT_LIMIT) => {
  // 1) Try the indexed query — fastest path when items carry `updatedAt`.
  try {
    const snap = await get(query(ref(db, kind), orderByChild("updatedAt"), limitToLast(limit)));
    const data = snap.val() || {};
    const items = Object.entries(data).map(([id, item]: [string, any]) => buildAdminContentIndexItem(id, item, kind));
    const cleanItems = stripLegacyAnFromAdminList(items);
    if (cleanItems.length) return sortAdminContentList(cleanItems);
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
            return item && !isLegacyAnEntry(id, item) ? buildAdminContentIndexItem(id, item, kind) : null;
        } catch { return null; }
      }));
      rows.forEach((row) => { if (row) items.push(row); });
    }
    return sortAdminContentList(items);
  } catch {
    return [];
  }
};

export const fetchAdminCount = async (path: string, ttlMs = 30 * 1000) => {
  const key = countCacheKeyFor(path);
  try {
    const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.ts && Date.now() - Number(parsed.ts) < ttlMs) return Number(parsed.count || 0);
    }
  } catch {}
  const keys = await firebaseRestShallowKeys(path);
  // Strip legacy AN keys (an_/as_ prefixed) so deleted-but-leftover rows don't inflate counts.
  const filtered = (path === "movies" || path === "webseries")
    ? keys.filter((k) => !isLegacyAnEntry(k))
    : keys;
  const count = filtered.length;
  try {
    const payload = JSON.stringify({ ts: Date.now(), count });
    sessionStorage.setItem(key, payload);
    localStorage.setItem(key, payload);
  } catch {}
  return count;
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
  const rows = (items || []).filter((item: any) => item?.id && !isLegacyAnEntry(item.id, item));
  const chunkSize = 25;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await Promise.all(rows.slice(i, i + chunkSize).map((item: any) => upsertAdminContentIndex(kind, item.id, item).catch(() => {})));
  }
};