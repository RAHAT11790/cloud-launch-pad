import { forwardRef, ImgHTMLAttributes } from "react";

/**
 * CachedImg — drop-in <img> with three caching layers:
 *   1. In-memory hard ref (Map of decoded HTMLImageElements) so GC can't
 *      evict and force a re-download mid-session.
 *   2. localStorage "seen URL" set — survives reloads. URLs previously
 *      rendered are flagged eager / decoding="sync" so they paint
 *      instantly without the fade flicker.
 *   3. Cache Storage API ("rs-img-v1") — persists the actual bytes
 *      across sessions; the browser HTTP cache reuses them when the
 *      same URL is re-requested.
 */

const SEEN_KEY = "rs_img_seen_v1";
const SEEN_CAP = 3000;
const CACHE_NAME = "rs-img-v1";

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
  }, 1500);
};

const persistBytes = (url: string) => {
  if (!("caches" in window)) return;
  try {
    caches.open(CACHE_NAME).then((c) => {
      c.match(url).then((hit) => {
        if (!hit) c.add(url).catch(() => {});
      });
    }).catch(() => {});
  } catch {}
};

const markSeen = (url: string, el?: HTMLImageElement) => {
  if (!url) return;
  if (el && !decodedCache.has(url)) decodedCache.set(url, el);
  if (!seenSet.has(url)) {
    seenSet.add(url);
    schedulePersist();
    persistBytes(url);
  }
};

type Props = ImgHTMLAttributes<HTMLImageElement>;

const CachedImg = forwardRef<HTMLImageElement, Props>(function CachedImg(
  { src, loading, decoding, onLoad, ...rest },
  ref,
) {
  const url = typeof src === "string" ? src : "";
  const warm = !!url && (decodedCache.has(url) || seenSet.has(url));

  return (
    <img
      ref={ref}
      {...rest}
      src={url || undefined}
      loading={loading ?? (warm ? "eager" : "lazy")}
      decoding={decoding ?? (warm ? "sync" : "async")}
      onLoad={(event) => {
        markSeen(url, event.currentTarget);
        onLoad?.(event);
      }}
    />
  );
});

export default CachedImg;
