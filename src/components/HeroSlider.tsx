import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { Play, Star } from "lucide-react";
import { getAnimeTitleStyle } from "@/lib/animeFonts";
import { optimizedImageUrl } from "@/lib/imageCache";

export interface HeroSlide {
  id: string;
  title: string;
  backdrop: string;
  subtitle: string;
  rating: string;
  year: string;
  type: string;
  isCustom?: boolean;
  description?: string;
  titleColor?: string;
  titleFont?: string;
  episodeInfo?: string;
  languageInfo?: string;
}

interface HeroSliderProps {
  slides: HeroSlide[];
  onPlay: (index: number) => void;
  onInfo?: (index: number) => void;
}

const SLIDE_DURATION = 7000;
const XFADE_MS = 900;
const SETTLE_MS = 1200;

const imageReadyCache = new Map<string, Promise<void>>();
const waitForImage = (src: string) => {
  if (!src || typeof window === "undefined") return Promise.resolve();
  const cached = imageReadyCache.get(src);
  if (cached) return cached;
  const p = new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
    if (img.complete) resolve();
  });
  imageReadyCache.set(src, p);
  return p;
};

const HeroSlider = ({ slides, onPlay, onInfo }: HeroSliderProps) => {
  const [current, setCurrent] = useState(0);
  const [previousSlide, setPreviousSlide] = useState<HeroSlide | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [progressKey, setProgressKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dragDx, setDragDx] = useState(0);
  const [renderSlides, setRenderSlides] = useState<HeroSlide[]>([]);
  const [settled, setSettled] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const xfadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const renderSlidesRef = useRef(renderSlides);
  const currentRef = useRef(current);
  const lockRef = useRef(false);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  renderSlidesRef.current = renderSlides;
  currentRef.current = current;

  const slidesSignature = useMemo(
    () => slides.map((s) => `${s.id}:${s.backdrop}`).join("|"),
    [slides]
  );

  // Content-signature debounce — never advance until the source list is stable.
  useEffect(() => {
    if (!slides || slides.length === 0) {
      if (settleRef.current) clearTimeout(settleRef.current);
      setRenderSlides([]);
      setPreviousSlide(null);
      setTransitioning(false);
      lockRef.current = false;
      setSettled(true);
      return;
    }
    const snap = slides;
    setSettled(false);
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(async () => {
      // Preload the first backdrop before revealing content — kills the initial flash-swipe cascade.
      await waitForImage(optimizedImageUrl(snap[0]?.backdrop || "", "backdrop"));
      const curId = renderSlidesRef.current[currentRef.current]?.id;
      const preserved = curId ? snap.findIndex((s) => s.id === curId) : -1;
      const nextIdx = preserved >= 0 ? preserved : 0;
      setRenderSlides(snap);
      setCurrent(nextIdx);
      currentRef.current = nextIdx;
      setPreviousSlide(null);
      setTransitioning(false);
      lockRef.current = false;
      setProgressKey((k) => k + 1);
      setSettled(true);
    }, SETTLE_MS);
    return () => {
      if (settleRef.current) clearTimeout(settleRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slidesSignature]);

  const goTo = useCallback((idx: number) => {
    const list = renderSlidesRef.current;
    const n = list.length;
    if (n <= 1 || lockRef.current) return;
    const from = currentRef.current;
    const next = ((idx % n) + n) % n;
    if (next === from) return;
    const fromSlide = list[from];
    const nextSlide = list[next];
    if (!fromSlide || !nextSlide) return;

    lockRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);

    waitForImage(optimizedImageUrl(nextSlide.backdrop, "backdrop")).finally(() => {
      const latest = renderSlidesRef.current;
      const safeNext = latest.findIndex((s) => s.id === nextSlide.id);
      const safeFrom = latest[currentRef.current];
      if (safeNext < 0 || !safeFrom) {
        lockRef.current = false;
        return;
      }
      setPreviousSlide(safeFrom);
      setTransitioning(true);
      currentRef.current = safeNext;
      setCurrent(safeNext);

      if (xfadeRef.current) clearTimeout(xfadeRef.current);
      xfadeRef.current = setTimeout(() => {
        setPreviousSlide(null);
        setTransitioning(false);
        lockRef.current = false;
        setProgressKey((k) => k + 1);
      }, XFADE_MS + 40);
    });
  }, []);

  // Auto-advance timer
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!settled || transitioning || paused) return;
    if (renderSlides.length <= 1) return;
    if (typeof document !== "undefined" && document.hidden) return;
    timerRef.current = setTimeout(() => goTo(currentRef.current + 1), SLIDE_DURATION);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [goTo, current, paused, settled, transitioning, renderSlides.length, progressKey]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (timerRef.current) clearTimeout(timerRef.current);
      } else {
        setProgressKey((k) => k + 1);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Preload neighbors
  useEffect(() => {
    if (renderSlides.length <= 1) return;
    const n = renderSlides.length;
    [(current + 1) % n, (current - 1 + n) % n].forEach((idx) => {
      const s = renderSlides[idx];
      if (!s?.backdrop) return;
      waitForImage(optimizedImageUrl(s.backdrop, "backdrop"));
    });
  }, [current, renderSlides]);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.changedTouches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    setPaused(true);
  };
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > Math.abs(dy)) setDragDx(Math.max(-120, Math.min(120, dx)));
  };
  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const t = e.changedTouches[0];
    touchStartRef.current = null;
    setPaused(false);
    setDragDx(0);
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    goTo(dx > 0 ? currentRef.current - 1 : currentRef.current + 1);
  };

  if (renderSlides.length === 0) {
    return (
      <div
        data-no-swipe="true"
        className="relative w-full h-[46vh] min-h-[320px] overflow-hidden rounded-b-[28px] bg-card flex items-center justify-center"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-muted/40 via-card to-background" />
      </div>
    );
  }

  const slide = renderSlides[current];
  if (!slide) return null;

  const handlePrimary = () => {
    if (slide.isCustom && onInfo) return onInfo(current);
    onPlay(current);
  };

  return (
    <div
      data-no-swipe="true"
      className="relative w-full h-[46vh] min-h-[320px] overflow-hidden rounded-b-[28px] bg-black select-none"
      style={{ touchAction: "pan-y pinch-zoom" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Outgoing */}
      {previousSlide && (
        <div key={`prev-${previousSlide.id}`} className="hero-layer hero-layer-exit">
          <img
            src={optimizedImageUrl(previousSlide.backdrop, "backdrop")}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover hero-image"
            draggable={false}
          />
        </div>
      )}

      {/* Active */}
      <div
        key={`cur-${slide.id}-${current}`}
        className={`hero-layer ${previousSlide ? "hero-layer-enter" : "hero-layer-current"}`}
        style={{
          transform: `translate3d(${dragDx * 0.3}px, 0, 0)`,
          transition: "transform 260ms ease-out",
        }}
      >
        <img
          src={optimizedImageUrl(slide.backdrop, "backdrop")}
          alt={slide.title}
          className="absolute inset-0 w-full h-full object-cover hero-image hero-kenburns"
          loading="eager"
          decoding="async"
          draggable={false}
        />
      </div>

      {/* Cinematic gradient — richer bottom fade so text always reads */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(to top,
              hsl(var(--background)) 0%,
              hsla(var(--background)/0.92) 18%,
              hsla(var(--background)/0.55) 40%,
              hsla(var(--background)/0.15) 62%,
              transparent 82%),
            linear-gradient(to bottom, hsla(0,0%,0%,0.35) 0%, transparent 30%)
          `,
        }}
      />

      {/* Content — single Play CTA, tighter typographic hierarchy */}
      <div
        key={`info-${slide.id}-${current}`}
        className="absolute inset-x-0 bottom-0 px-5 pb-16 z-10 pointer-events-none hero-fade-in"
      >
        <div className="max-w-[560px]">
          {/* Meta row (above title) */}
          <div className="flex items-center gap-2 mb-3 pointer-events-auto">
            <span
              className="uppercase tracking-[0.18em] text-[10px] font-bold text-primary"
              style={{ textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}
            >
              {slide.isCustom ? "Featured" : slide.type === "webseries" ? "Series" : "Movie"}
            </span>
            {slide.rating && !slide.isCustom && (
              <>
                <span className="text-white/40">•</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/90">
                  <Star className="w-3 h-3 fill-primary text-primary" />
                  {slide.rating}
                </span>
              </>
            )}
            {slide.year && !slide.isCustom && (
              <>
                <span className="text-white/40">•</span>
                <span className="text-[11px] font-medium text-white/80">{slide.year}</span>
              </>
            )}
          </div>

          {/* Title */}
          <h1
            className="text-[30px] leading-[1.05] font-black mb-3 line-clamp-2 pointer-events-auto"
            style={{
              ...getAnimeTitleStyle(slide.title),
              ...(slide.titleColor ? { color: slide.titleColor } : { color: "white" }),
              ...(slide.titleFont ? { fontFamily: slide.titleFont } : {}),
              textShadow: "0 4px 24px rgba(0,0,0,0.75)",
              letterSpacing: "-0.01em",
            }}
          >
            {slide.title}
          </h1>

          {/* Subline — description or episode/language chips */}
          {slide.isCustom && slide.description ? (
            <p className="text-white/75 text-[13px] leading-snug mb-5 line-clamp-2 max-w-[320px] pointer-events-auto">
              {slide.description}
            </p>
          ) : (
            <div className="flex items-center gap-2 flex-wrap mb-5 pointer-events-auto">
              {slide.episodeInfo && (
                <span className="bg-white/15 backdrop-blur-md text-white text-[10.5px] font-semibold px-2.5 py-1 rounded-full border border-white/10">
                  {slide.episodeInfo}
                </span>
              )}
              {slide.languageInfo && (
                <span className="bg-white/15 backdrop-blur-md text-white text-[10.5px] font-semibold px-2.5 py-1 rounded-full border border-white/10">
                  {slide.languageInfo}
                </span>
              )}
              {slide.subtitle && !slide.episodeInfo && (
                <span className="text-white/70 text-[12px] font-medium line-clamp-1">
                  {slide.subtitle}
                </span>
              )}
            </div>
          )}

          {/* Single Play CTA */}
          <div className="pointer-events-auto">
            <button
              onClick={handlePrimary}
              className="group relative inline-flex items-center gap-2.5 gradient-primary text-primary-foreground pl-5 pr-6 py-3 rounded-full font-bold text-[14px] active:scale-95 transition-transform"
              style={{
                boxShadow:
                  "0 10px 32px -8px hsla(var(--primary)/0.55), 0 2px 8px rgba(0,0,0,0.35)",
              }}
              aria-label={`Play ${slide.title}`}
            >
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-white/25 backdrop-blur-sm">
                <Play className="w-3.5 h-3.5 fill-current" />
              </span>
              <span className="tracking-wide">Watch Now</span>
            </button>
          </div>
        </div>
      </div>

      {/* Progress indicators */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
        {renderSlides.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className="relative h-[3px] rounded-full overflow-hidden transition-all duration-500"
            style={{ width: i === current ? 28 : 14 }}
            aria-label={`Go to slide ${i + 1}`}
          >
            <div
              className={`absolute inset-0 rounded-full ${
                i === current ? "bg-white/25" : "bg-white/20"
              }`}
            />
            {i === current && !paused && settled && !transitioning && (
              <div
                key={`prog-${current}-${progressKey}`}
                className="absolute inset-0 rounded-full bg-white hero-progress-bar"
                style={{ animationDuration: `${SLIDE_DURATION}ms` }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default memo(HeroSlider);
