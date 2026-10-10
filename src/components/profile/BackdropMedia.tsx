import { forwardRef, useEffect, useRef, useState } from "react";
import type { ShopItem } from "@/lib/profileShop";
import { captureVideoFrame, getResolvedMediaUrl, isStoredMedia, readPoster, resolveMediaUrl, savePoster } from "@/lib/profileMediaStore";

/**
 * Profile backdrop: a still image, or a muted video that loops forever.
 * - First paint already shows the right picture: the admin poster, or the
 *   video's own first frame remembered on this phone. Never a different image.
 * - The video plays from memory / phone cache with the native gapless loop.
 * - Video only plays while on screen and while the tab is visible (battery).
 * - A failed video retries a few times, then quietly stays on the poster.
 */

type Props = {
  item?: Pick<ShopItem, "mediaType" | "videoUrl" | "imageUrl" | "name"> | null;
  fallbackSrc?: string;
  className?: string;
  /** Shop/admin previews load lighter and only play when scrolled into view. */
  preview?: boolean;
  width?: number;
  height?: number;
};

const MAX_RETRIES = 4;
const BackdropMedia = forwardRef<HTMLSpanElement, Props>(({ item, fallbackSrc, className = "", preview = false, width, height }, ref) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoUrl = item?.mediaType === "video" ? String(item.videoUrl || "").trim() : "";
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  // Already resolved this session → render the video in the very first paint.
  const [src, setSrc] = useState(() => getResolvedMediaUrl(videoUrl));
  const [playing, setPlaying] = useState(false);
  const [capturedPoster, setCapturedPoster] = useState(() => readPoster(videoUrl));

  const ownPoster = String(item?.imageUrl || "").trim();
  // A video backdrop never borrows the default banner: that was the "wrong image" on return.
  const poster = ownPoster || capturedPoster || (videoUrl ? "" : fallbackSrc || "");
  const showVideo = !!videoUrl && !failed && !!src;

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    setCapturedPoster(readPoster(videoUrl));
    const ready = getResolvedMediaUrl(videoUrl);
    setSrc(ready);
    if (!videoUrl || ready) return;
    setPlaying(false);
    let alive = true;
    // Previews of URL videos stream directly (many cards); everything else plays from memory.
    if (preview && !isStoredMedia(videoUrl)) { setSrc(videoUrl); return; }
    resolveMediaUrl(videoUrl).then((u) => { if (!alive) return; if (u) setSrc(u); else setFailed(true); });
    return () => { alive = false; };
  }, [videoUrl, preview]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !showVideo) return;
    // React does not reliably reflect `muted`; autoplay needs it set as a property AND attribute.
    el.muted = true;
    el.defaultMuted = true;
    el.setAttribute("muted", "");
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");

    let visible = !preview;
    const tryPlay = () => {
      if (!visible || document.hidden) return;
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => undefined);
    };
    const onVisibility = () => (document.hidden ? el.pause() : tryPlay());
    // Safety net for browsers that ignore `loop`.
    const onEnded = () => {
      try { el.currentTime = 0; } catch { /* ignore */ }
      tryPlay();
    };
    if (el.readyState >= 2 && !el.paused) setPlaying(true);
    document.addEventListener("visibilitychange", onVisibility);
    el.addEventListener("ended", onEnded);

    let observer: IntersectionObserver | null = null;
    if (preview && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(([entry]) => {
        visible = !!entry?.isIntersecting;
        if (visible) tryPlay();
        else el.pause();
      }, { threshold: 0.25 });
      observer.observe(el);
    } else {
      visible = true;
    }
    tryPlay();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      el.removeEventListener("ended", onEnded);
      observer?.disconnect();
    };
  }, [showVideo, attempt, preview, src]);

  const handlePlaying = () => {
    setPlaying(true);
    const el = videoRef.current;
    if (!el || ownPoster || capturedPoster || !src.startsWith("blob:")) return;
    // Remember the first frame so the next visit paints the right picture instantly.
    const grab = () => {
      const data = captureVideoFrame(el);
      if (data) { savePoster(videoUrl, data); setCapturedPoster(data); }
    };
    const anyEl = el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (typeof anyEl.requestVideoFrameCallback === "function") anyEl.requestVideoFrameCallback(grab);
    else window.setTimeout(grab, 120);
  };

  const handleError = () => {
    setPlaying(false);
    if (src.startsWith("blob:") && !isStoredMedia(videoUrl)) { setSrc(videoUrl); return; }
    if (attempt + 1 >= MAX_RETRIES) {
      setFailed(true);
      return;
    }
    window.setTimeout(() => setAttempt((n) => n + 1), 1200 * (attempt + 1));
  };

  return (
    <span ref={ref} className={`pf-backdrop ${className}`}>
      {poster && (
        <img src={poster} alt="" className="pf-backdrop-poster" loading={preview ? "lazy" : "eager"} decoding="async" width={width} height={height} draggable={false} />
      )}
      {showVideo && (
        <video
          key={`${src}#${attempt}`}
          ref={videoRef}
          className={`pf-backdrop-video ${playing ? "is-playing" : ""} ${poster ? "has-poster" : ""}`}
          src={src}
          muted
          loop
          autoPlay
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          controls={false}
          preload={preview ? "metadata" : "auto"}
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={handlePlaying}
          onError={handleError}
        />
      )}
      {showVideo && preview && <span className="pf-backdrop-live">VIDEO</span>}
    </span>
  );
});
BackdropMedia.displayName = "BackdropMedia";

export default BackdropMedia;
