/**
 * Profile media store + permanent cache.
 * - Gallery uploads (≤10MB video / GIF) are saved straight into the database as
 *   base64 chunks under `profileMedia/{id}`; the shop item stores `rtdb:{id}`.
 * - Every backdrop video (uploaded or URL) is kept in the phone's Cache Storage,
 *   so returning to the profile plays instantly from disk with no download.
 * - Entries no longer used by the shop are deleted (live cache, never stale:
 *   a changed item gets a new id/URL, so the old entry is replaced).
 */
import { db, get, ref, remove, set } from "@/lib/firebase";

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const CHUNK = 900 * 1024; // base64 chars per chunk (well under RTDB limits)
const CACHE_NAME = "rs-profile-media-v1";
const MEDIA_PATH = "profileMedia";

export const isStoredMedia = (url: string) => String(url || "").startsWith("rtdb:");

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export const uploadMediaFile = async (file: File): Promise<string> => {
  if (file.size > MAX_MEDIA_BYTES) throw new Error("too-large");
  const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const b64 = await blobToBase64(file);
  const chunks: Record<string, string> = {};
  for (let i = 0, n = 0; i < b64.length; i += CHUNK, n++) chunks[`c${String(n).padStart(3, "0")}`] = b64.slice(i, i + CHUNK);
  await set(ref(db, `${MEDIA_PATH}/${id}`), { type: file.type || "video/mp4", size: file.size, count: Object.keys(chunks).length, chunks, createdAt: Date.now() });
  const url = `rtdb:${id}`;
  // Admin's own phone gets it cached immediately.
  await putCache(url, new Blob([file], { type: file.type || "video/mp4" })).catch(() => undefined);
  return url;
};

export const deleteStoredMedia = async (url: string) => {
  if (!isStoredMedia(url)) return;
  await remove(ref(db, `${MEDIA_PATH}/${url.slice(5)}`)).catch(() => undefined);
};

const cacheKey = (url: string) => `https://profile-media.cache/${encodeURIComponent(url)}`;
const openCache = () => (typeof caches !== "undefined" ? caches.open(CACHE_NAME) : Promise.reject(new Error("no-cache")));

const putCache = async (url: string, blob: Blob) => {
  const c = await openCache();
  await c.put(cacheKey(url), new Response(blob, { headers: { "content-type": blob.type || "video/mp4" } }));
};

const readCache = async (url: string): Promise<Blob | null> => {
  try {
    const hit = await (await openCache()).match(cacheKey(url));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
};

const fetchStored = async (url: string): Promise<Blob> => {
  const snap = await get(ref(db, `${MEDIA_PATH}/${url.slice(5)}`));
  const v = snap.val();
  if (!v?.chunks) throw new Error("missing");
  const b64 = Object.keys(v.chunks).sort().map((k) => v.chunks[k]).join("");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: v.type || "video/mp4" });
};

const fetchRemote = async (url: string): Promise<Blob | null> => {
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") || 0);
    if (len > 24 * 1024 * 1024) { res.body?.cancel().catch(() => undefined); return null; }
    const blob = await res.blob();
    return blob.size && blob.size <= 24 * 1024 * 1024 ? blob : null;
  } catch {
    return null;
  }
};

const memory = new Map<string, Promise<string>>();

/** Returns a playable URL: memory → phone cache → database/network (then cached). */
export const resolveMediaUrl = (url: string): Promise<string> => {
  const clean = String(url || "").trim();
  if (!clean) return Promise.resolve("");
  const hit = memory.get(clean);
  if (hit) return hit;
  const job = (async () => {
    const cached = await readCache(clean);
    if (cached?.size) return URL.createObjectURL(cached);
    const blob = isStoredMedia(clean) ? await fetchStored(clean).catch(() => null) : await fetchRemote(clean);
    if (!blob) return isStoredMedia(clean) ? "" : clean; // non-CORS URL streams directly
    putCache(clean, blob).catch(() => undefined);
    return URL.createObjectURL(blob);
  })();
  memory.set(clean, job);
  job.then((u) => { if (!u) memory.delete(clean); });
  return job;
};

/** Warm the cache in the background (e.g. the equipped backdrop). */
export const prefetchMedia = (url: string) => { if (url) resolveMediaUrl(url).catch(() => undefined); };

/** Drop cached files the shop no longer uses. */
export const pruneMediaCache = async (activeUrls: string[]) => {
  try {
    const keep = new Set(activeUrls.filter(Boolean).map(cacheKey));
    const c = await openCache();
    for (const req of await c.keys()) if (!keep.has(req.url)) await c.delete(req);
  } catch { /* no cache api */ }
};
