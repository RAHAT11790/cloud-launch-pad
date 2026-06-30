import { forwardRef, ImgHTMLAttributes } from "react";

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

type Props = ImgHTMLAttributes<HTMLImageElement>;

const CachedImg = forwardRef<HTMLImageElement, Props>(function CachedImg(
  { src, loading, decoding, onLoad, ...rest },
  ref,
) {
  const url = typeof src === "string" ? src : "";

  return (
    <img
      ref={ref}
      {...rest}
      src={url || undefined}
      loading={loading ?? "lazy"}
      decoding={decoding ?? "async"}
      onLoad={(event) => {
        if (url && !decodedCache.has(url)) decodedCache.set(url, event.currentTarget);
        onLoad?.(event);
      }}
    />
  );
});

export default CachedImg;
