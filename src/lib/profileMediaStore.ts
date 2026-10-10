/**
 * Profile media store + permanent cache.
 * - Gallery uploads (≤10MB video / GIF) are saved in the database as base64
 *   chunks under `profileMedia/{id}`; the shop item stores `rtdb:{id}`.
 * - Stored media is downloaded over plain HTTPS (REST), never through the
 *   realtime socket — a 5MB download on the socket used to block every other
 *   listener (frame, customization) for seconds. Base64 is decoded natively
 *   by the browser, off the main thread.
 * - Every backdrop video is kept in Cache Storage, so returning to the
 *   profile plays instantly from disk; a tiny first-frame poster is kept in
 *   localStorage so the very first paint already shows the right picture.
 * - Entries the shop no longer uses are deleted (live cache, never stale).
 */
import { db, get, ref, remove, set } from "@/lib/firebase";

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const CHUNK = 900 * 1024; // base64 chars per chunk (well under RTDB limits)
export const MEDIA_CACHE_NAME = "rs-profile-media-v1";
const MEDIA_PATH = "profileMedia";
const POSTER_PREFIX = "rs_pf_poster_v1:";

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
const openCache = () => (typeof caches !== "undefined" ? caches.open(MEDIA_CACHE_NAME) : Promise.reject(new Error("no-cache")));

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

const decodeBase64 = async (b64: string, type: string): Promise<Blob> => {
  try {
    // Native decoder: fast and does not freeze the page on low-end phones.
    const res = await fetch(`data:${type};base64,${b64}`);
    const blob = await res.blob();
    if (blob.size) return blob;
  } catch { /* fall through */ }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

const joinChunks = (chunks: Record<string, string>) => Object.keys(chunks).sort().map((k) => chunks[k]).join("");

const fetchStored = async (url: string): Promise<Blob> => {
  const id = url.slice(5);
  const base = String((db as any)?.app?.options?.databaseURL || "").replace(/\/$/, "");
  if (base) {
    try {
      const res = await fetch(`${base}/${MEDIA_PATH}/${encodeURIComponent(id)}.json`, { credentials: "omit", cache: "no-store" });
      if (res.ok) {
        const v = await res.json();
        if (v?.chunks) return decodeBase64(joinChunks(v.chunks), v.type || "video/mp4");
      }
    } catch { /* fall back to the SDK */ }
  }
  const snap = await get(ref(db, `${MEDIA_PATH}/${id}`));
  const v = snap.val();
  if (!v?.chunks) throw new Error("missing");
  return decodeBase64(joinChunks(v.chunks), v.type || "video/mp4");
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
const resolved = new Map<string, string>();

/** Already-playable URL for this media, if it was resolved earlier in this session. */
export const getResolvedMediaUrl = (url: string) => resolved.get(String(url || "").trim()) || "";

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
  job.then((u) => {
    if (u) resolved.set(clean, u);
    else memory.delete(clean);
  });
  return job;
};

/** Warm the cache in the background (e.g. the equipped backdrop). */
export const prefetchMedia = (url: string) => { if (url) resolveMediaUrl(url).catch(() => undefined); };

/* ---------- First-frame posters (instant, correct first paint) ---------- */
export const readPoster = (url: string): string => {
  if (!url) return "";
  try { return localStorage.getItem(POSTER_PREFIX + url) || ""; } catch { return ""; }
};

export const savePoster = (url: string, dataUrl: string) => {
  if (!url || !dataUrl.startsWith("data:image/")) return;
  try { localStorage.setItem(POSTER_PREFIX + url, dataUrl); } catch { /* quota */ }
};

/** Grabs the current video frame as a small JPEG (works for blob/same-origin video). */
export const captureVideoFrame = (video: HTMLVideoElement, maxWidth = 360): string => {
  try {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return "";
    const scale = Math.min(1, maxWidth / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return "";
  }
};

/** First frame of a local video file as a JPEG blob (admin auto-poster). */
export const posterFromFile = (file: File, maxWidth = 960): Promise<Blob | null> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const done = (b: Blob | null) => { URL.revokeObjectURL(url); resolve(b); };
    const timer = window.setTimeout(() => done(null), 8000);
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.05, (v.duration || 1) / 2); } catch { /* ignore */ } };
    v.onseeked = () => {
      window.clearTimeout(timer);
      const data = captureVideoFrame(v, maxWidth);
      if (!data) return done(null);
      fetch(data).then((r) => r.blob()).then(done, () => done(null));
    };
    v.onerror = () => { window.clearTimeout(timer); done(null); };
    v.src = url;
  });

/** Drop cached files and posters the shop no longer uses. */
export const pruneMediaCache = async (activeUrls: string[]) => {
  const active = activeUrls.filter(Boolean);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(POSTER_PREFIX) && !active.includes(k.slice(POSTER_PREFIX.length))) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
  try {
    const keep = new Set(active.map(cacheKey));
    const c = await openCache();
    for (const req of await c.keys()) if (!keep.has(req.url)) await c.delete(req);
  } catch { /* no cache api */ }
};

/**
 * Called at app start (idle): loads the equipped frame artwork and backdrop
 * video into memory before the profile is opened, so it paints instantly.
 */
export const warmProfileAssets = async () => {
  try {
    const user = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
    const uid = String(user?.id || "");
    if (!uid) return;
    const customKey = `rs_profile_custom_cache_v1_${uid}`;
    let custom = JSON.parse(localStorage.getItem(customKey) || "null");
    if (!custom) {
      // First visit after login: read it over HTTPS so the realtime socket's startup queue can't delay it.
      const base = String((db as any)?.app?.options?.databaseURL || "").replace(/\/$/, "");
      const res = base ? await fetch(`${base}/users/${encodeURIComponent(uid)}/profileCustomization.json`, { credentials: "omit" }).catch(() => null) : null;
      custom = res && res.ok ? await res.json().catch(() => null) : null;
      if (custom) try { localStorage.setItem(customKey, JSON.stringify(custom)); window.dispatchEvent(new Event("rs_profile_custom_cached")); } catch { /* quota */ }
    }
    const { readCachedShop } = await import("@/lib/profileShop");
    const shop = readCachedShop();
    const frame = shop.frames.find((f) => f.id === custom?.frameId);
    const bg = shop.backgrounds.find((b) => b.id === custom?.backgroundId);
    for (const src of [frame?.imageUrl, bg?.imageUrl]) {
      if (src) { const img = new Image(); img.decoding = "async"; img.src = src; }
    }
    if (bg?.mediaType === "video" && bg.videoUrl) prefetchMedia(bg.videoUrl);
  } catch { /* ignore */ }
};
