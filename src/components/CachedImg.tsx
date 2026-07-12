import { forwardRef, ImgHTMLAttributes, useEffect, useState } from "react";

/**
 * CachedImg — drop-in <img> with zero-duplicate-fetch caching.
 *
 * Previous version called `caches.add(url)` inside `onLoad`, which issued
 * a SECOND network request for every image. In the Admin panel that
 * showed up as the "বারবার preload" the user complained about.
 *
 * Strategy now:
 *   1. In-memory Map<url, HTMLImageElement> — survives re-renders so the
 *      browser keeps the decoded bitmap and paints instantly.
 *   2. localStorage "seen" set — survives reloads. Known URLs render with
 *      eager loading + sync decoding so no fade flicker on the second
 *      session.
 *   3. Browser HTTP cache + Service Worker handle persistence. No extra
 *      fetches are issued from JS.
 */

const SEEN_KEY = "rs_img_seen_v1";
const SEEN_CAP = 4000;

const decodedCache = new Map<string, HTMLImageElement>();
const preloadInflight = new Map<string, Promise<void>>();
let seenSet: Set<string>;
try {
  seenSet = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
} catch {
  seenSet = new Set();
}
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const schedulePersist = () => {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const arr = Array.from(seenSet).slice(-SEEN_CAP);
      localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
    } catch {}
  }, 2000);
};

const markSeen = (url: string, el?: HTMLImageElement) => {
  if (!url) return;
  if (el && !decodedCache.has(url)) decodedCache.set(url, el);
  if (!seenSet.has(url)) {
    seenSet.add(url);
    schedulePersist();
  }
};

export const isImageCacheWarm = (url: unknown) => {
  const key = typeof url === "string" ? url : "";
  return !!key && (decodedCache.has(key) || seenSet.has(key));
};

export const preloadCachedImages = (urls: unknown[], limit = 160) => {
  if (typeof window === "undefined") return Promise.resolve();
  const unique = Array.from(new Set(
    (urls || [])
      .map((url) => String(url || "").trim())
      .filter(Boolean),
  )).slice(0, Math.max(0, limit));

  const tasks = unique.map((url) => {
    if (decodedCache.has(url) || seenSet.has(url)) return Promise.resolve();
    const running = preloadInflight.get(url);
    if (running) return running;
    const task = new Promise<void>((resolve) => {
      const img = new window.Image();
      img.decoding = "async";
      img.loading = "eager";
      img.onload = async () => {
        try { await img.decode?.(); } catch {}
        markSeen(url, img);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    }).finally(() => preloadInflight.delete(url));
    preloadInflight.set(url, task);
    return task;
  });

  return Promise.allSettled(tasks).then(() => undefined);
};

type Props = ImgHTMLAttributes<HTMLImageElement>;

const CachedImg = forwardRef<HTMLImageElement, Props>(function CachedImg(
  { src, loading, decoding, onLoad, style, ...rest },
  ref,
) {
  const url = typeof src === "string" ? src : "";
  const warm = !!url && (decodedCache.has(url) || seenSet.has(url));
  const [loaded, setLoaded] = useState(warm);

  useEffect(() => {
    if (!url) return;
    if (decodedCache.has(url) || seenSet.has(url)) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    preloadCachedImages([url], 1).then(() => {
      if (!cancelled && decodedCache.has(url)) setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [url]);

  return (
    <img
      ref={ref}
      {...rest}
      src={url || undefined}
      // Warm (already-seen) URLs render eagerly + sync-decoded so scrolling
      // fast does NOT briefly blank them to the placeholder background —
      // exactly the "black flash while scrolling" the user complained about.
      loading={warm ? "eager" : (loading ?? "lazy")}
      decoding={warm ? "sync" : (decoding ?? "async")}
      style={{
        ...(style || {}),
        opacity: 1,
        transition: loaded || warm ? undefined : "none",
      }}
      onLoad={(event) => {
        markSeen(url, event.currentTarget);
        setLoaded(true);
        onLoad?.(event);
      }}
    />
  );
});

export default CachedImg;
