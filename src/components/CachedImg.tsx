import { forwardRef, ImgHTMLAttributes, useState } from "react";

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

type Props = ImgHTMLAttributes<HTMLImageElement>;

const CachedImg = forwardRef<HTMLImageElement, Props>(function CachedImg(
  { src, loading, decoding, onLoad, style, ...rest },
  ref,
) {
  const url = typeof src === "string" ? src : "";
  const warm = !!url && (decodedCache.has(url) || seenSet.has(url));
  const [loaded, setLoaded] = useState(warm);

  return (
    <img
      ref={ref}
      {...rest}
      src={url || undefined}
      loading={loading ?? "lazy"}
      decoding={decoding ?? "async"}
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
