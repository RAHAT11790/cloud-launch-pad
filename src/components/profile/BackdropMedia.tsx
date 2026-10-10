import { forwardRef, useEffect, useRef, useState } from "react";
import type { ShopItem } from "@/lib/profileShop";
import { isStoredMedia, resolveMediaUrl } from "@/lib/profileMediaStore";

/**
 * Profile backdrop: a still image, or a muted video that loops forever.
 * - Poster / fallback image stays underneath so there is never a black flash.
 * - Video only plays while on screen and while the tab is visible (battery).
 * - A failed or stalled video retries a few times, then quietly falls back
 *   to the poster image.
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
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  const videoUrl = item?.mediaType === "video" ? String(item.videoUrl || "").trim() : "";
  const poster = String(item?.imageUrl || "").trim() || fallbackSrc || "";
  const [src, setSrc] = useState("");
  const showVideo = !!videoUrl && !failed && !!src;

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    setPlaying(false);
    setSrc("");
    if (!videoUrl) return;
    let alive = true;
    // Previews stream directly (many cards); the real profile header loads into memory.
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
    // Safety net for browsers that ignore `loop` on some streams.
    const onEnded = () => {
      try { el.currentTime = 0; } catch { /* ignore */ }
      tryPlay();
    };
    // Jump back a hair before the real end: avoids the decoder's end-of-stream stall.
    const onTime = () => {
      const d = el.duration;
      if (d && Number.isFinite(d) && d > 1 && el.currentTime >= d - 0.12) {
        try { el.currentTime = 0.01; } catch { /* ignore */ }
      }
    };
    el.addEventListener("timeupdate", onTime);

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
      el.removeEventListener("timeupdate", onTime);
      observer?.disconnect();
    };
  }, [showVideo, attempt, preview, src]);

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
        <img src={poster} alt="" className="pf-backdrop-poster" loading={preview ? "lazy" : "eager"} width={width} height={height} draggable={false} />
      )}
      {showVideo && (
        <video
          key={`${src}#${attempt}`}
          ref={videoRef}
          className={`pf-backdrop-video ${playing ? "is-playing" : ""}`}
          src={src}
          poster={poster || undefined}
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
          onPlaying={() => setPlaying(true)}
          onError={handleError}
        />
      )}
      {showVideo && preview && <span className="pf-backdrop-live">VIDEO</span>}
    </span>
  );
});
BackdropMedia.displayName = "BackdropMedia";

export default BackdropMedia;
