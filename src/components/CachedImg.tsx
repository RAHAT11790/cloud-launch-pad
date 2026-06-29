import { forwardRef, ImgHTMLAttributes, useEffect, useState, useRef } from "react";

/**
 * CachedImg — drop-in replacement for <img> that:
 *  - Holds a hard reference to decoded HTMLImageElement objects in a module-level
 *    Map so the browser image cache never evicts them (instant re-render when
 *    the user switches admin tabs).
 *  - Skips the flash/decode flicker on remount: if the src has been decoded
 *    before, it renders the <img> immediately with no loading transition.
 *  - Forwards all standard <img> props (className, style, onError, alt, …).
 */

// Hard refs to decoded images so GC cannot drop them and force a re-download.
const decodedCache = new Map<string, HTMLImageElement>();

// Track in-flight decodes so multiple instances don't duplicate work.
const inflight = new Map<string, Promise<HTMLImageElement>>();

function preload(src: string): Promise<HTMLImageElement> {
  const hit = decodedCache.get(src);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(src);
  if (pending) return pending;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      decodedCache.set(src, img);
      inflight.delete(src);
      resolve(img);
    };
    img.onerror = (e) => {
      inflight.delete(src);
      reject(e);
    };
    img.src = src;
  });
  inflight.set(src, p);
  return p;
}

type Props = ImgHTMLAttributes<HTMLImageElement>;

const CachedImg = forwardRef<HTMLImageElement, Props>(function CachedImg(
  { src, loading, decoding, ...rest },
  ref,
) {
  const url = typeof src === "string" ? src : "";
  const wasCached = !!url && decodedCache.has(url);
  const [ready, setReady] = useState(wasCached || !url);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!url) {
      setReady(true);
      return;
    }
    if (decodedCache.has(url)) {
      setReady(true);
      return;
    }
    setReady(false);
    preload(url)
      .then(() => {
        if (mounted.current) setReady(true);
      })
      .catch(() => {
        if (mounted.current) setReady(true); // let native onError fire
      });
  }, [url]);

  return (
    <img
      ref={ref}
      {...rest}
      src={ready ? url : undefined}
      loading={loading ?? "lazy"}
      decoding={decoding ?? "async"}
    />
  );
});

export default CachedImg;
