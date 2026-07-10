import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Play } from "lucide-react";
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

const SLIDE_DURATION = 7200;
const TRANSITION_MS = 760;
const MAX_SLIDES = 8;

const imageReadyCache = new Map<string, Promise<void>>();

const waitForImage = (src: string) => {
  if (!src || typeof window === "undefined") return Promise.resolve();
  const cached = imageReadyCache.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
    if (img.complete) resolve();
  });

  imageReadyCache.set(src, promise);
  return promise;
};

const normalizeSlides = (items: HeroSlide[]) => {
  const seen = new Set<string>();
  const clean: HeroSlide[] = [];

  for (const item of items) {
    if (!item?.id || !item.backdrop || seen.has(item.id)) continue;
    seen.add(item.id);
    clean.push(item);
    if (clean.length >= MAX_SLIDES) break;
  }

  return clean;
};

const HeroSlider = ({ slides, onPlay, onInfo }: HeroSliderProps) => {
  const [deck, setDeck] = useState<HeroSlide[]>(() => normalizeSlides(slides));
  const [current, setCurrent] = useState(0);
  const [previousSlide, setPreviousSlide] = useState<HeroSlide | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [progressKey, setProgressKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dragDx, setDragDx] = useState(0);

  const deckRef = useRef(deck);
  const currentRef = useRef(current);
  const slidesRef = useRef(slides);
  const lockRef = useRef(false);
  const mountedRef = useRef(false);
  const transitionTokenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const slidesSignature = useMemo(
    () => normalizeSlides(slides).map((item) => `${item.id}:${item.backdrop}`).join("|"),
    [slides]
  );

  deckRef.current = deck;
  currentRef.current = current;
  slidesRef.current = slides;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (cleanupRef.current) clearTimeout(cleanupRef.current);
    };
  }, []);

  useEffect(() => {
    const nextDeck = normalizeSlides(slides);

    setDeck((prevDeck) => {
      if (nextDeck.length === 0) return [];
      if (prevDeck.length === 0) return nextDeck;

      const currentId = prevDeck[currentRef.current]?.id;
      const preservedIndex = currentId ? nextDeck.findIndex((item) => item.id === currentId) : -1;

      if (preservedIndex >= 0 && preservedIndex !== currentRef.current) {
        currentRef.current = preservedIndex;
        setCurrent(preservedIndex);
      }

      if (preservedIndex < 0) {
        currentRef.current = 0;
        setCurrent(0);
        setPreviousSlide(null);
        setTransitioning(false);
        lockRef.current = false;
        setProgressKey((key) => key + 1);
      }

      return nextDeck;
    });
  }, [slidesSignature, slides]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const getSourceIndex = useCallback((slide: HeroSlide) => {
    const sourceIndex = slidesRef.current.findIndex((item) => item.id === slide.id);
    return sourceIndex >= 0 ? sourceIndex : currentRef.current;
  }, []);

  const goTo = useCallback((targetIndex: number) => {
    const list = deckRef.current;
    const count = list.length;
    if (count <= 1 || lockRef.current) return;

    const fromIndex = currentRef.current;
    const toIndex = ((targetIndex % count) + count) % count;
    if (toIndex === fromIndex) return;

    const fromSlide = list[fromIndex];
    const toSlide = list[toIndex];
    if (!fromSlide || !toSlide) return;

    lockRef.current = true;
    clearTimer();

    const token = transitionTokenRef.current + 1;
    transitionTokenRef.current = token;

    waitForImage(optimizedImageUrl(toSlide.backdrop, "backdrop")).finally(() => {
      if (!mountedRef.current || transitionTokenRef.current !== token) return;

      const latest = deckRef.current;
      const safeToIndex = latest.findIndex((item) => item.id === toSlide.id);
      const safeFromSlide = latest[currentRef.current];
      if (safeToIndex < 0 || !safeFromSlide) {
        lockRef.current = false;
        return;
      }

      setPreviousSlide(safeFromSlide);
      setTransitioning(true);
      currentRef.current = safeToIndex;
      setCurrent(safeToIndex);

      if (cleanupRef.current) clearTimeout(cleanupRef.current);
      cleanupRef.current = setTimeout(() => {
        if (!mountedRef.current || transitionTokenRef.current !== token) return;
        setPreviousSlide(null);
        setTransitioning(false);
        lockRef.current = false;
        setProgressKey((key) => key + 1);
      }, TRANSITION_MS + 80);
    });
  }, [clearTimer]);

  useEffect(() => {
    clearTimer();
    if (paused || transitioning || deck.length <= 1) return;
    if (typeof document !== "undefined" && document.hidden) return;

    timerRef.current = setTimeout(() => {
      goTo(currentRef.current + 1);
    }, SLIDE_DURATION);

    return clearTimer;
  }, [clearTimer, current, deck.length, goTo, paused, progressKey, transitioning]);

  useEffect(() => {
    const onVisibilityChange = () => {
      clearTimer();
      if (!document.hidden) setProgressKey((key) => key + 1);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [clearTimer]);

  useEffect(() => {
    if (deck.length === 0) return;
    const first = deck[0];
    void waitForImage(optimizedImageUrl(first.backdrop, "backdrop"));
  }, [deck]);

  useEffect(() => {
    const list = deckRef.current;
    if (list.length <= 1) return;
    const next = list[(current + 1) % list.length];
    const prev = list[(current - 1 + list.length) % list.length];
    [next, prev].forEach((slide) => {
      if (slide?.backdrop) void waitForImage(optimizedImageUrl(slide.backdrop, "backdrop"));
    });
  }, [current, deck.length]);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    setPaused(true);
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    if (!start || lockRef.current) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > Math.abs(dy) + 8) {
      setDragDx(Math.max(-90, Math.min(90, dx)));
    }
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;
    setPaused(false);
    setDragDx(0);
    if (!start || !touch || lockRef.current) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    goTo(dx > 0 ? currentRef.current - 1 : currentRef.current + 1);
  };

  if (deck.length === 0) {
    return (
      <div
        data-no-swipe="true"
        className="relative w-full h-[50vh] min-h-[360px] overflow-hidden bg-card"
      />
    );
  }

  const slide = deck[current] || deck[0];
  const metaLabel = slide.isCustom ? "Featured" : slide.type === "webseries" ? "Series" : "Movie";
  const sourceIndex = getSourceIndex(slide);

  const handlePrimary = () => {
    if (slide.isCustom && onInfo) {
      onInfo(sourceIndex);
      return;
    }
    onPlay(sourceIndex);
  };

  return (
    <section
      data-no-swipe="true"
      aria-label="Featured anime"
      className="relative w-full h-[52vh] min-h-[380px] max-h-[560px] overflow-hidden bg-background select-none"
      style={{ touchAction: "pan-y pinch-zoom", "--hero-drag-x": `${dragDx * 0.22}px` } as CSSProperties}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {previousSlide && (
        <div key={`out-${previousSlide.id}`} className="hero-layer hero-panel hero-panel-out">
          <img
            src={optimizedImageUrl(previousSlide.backdrop, "backdrop")}
            alt=""
            aria-hidden
            className="hero-backdrop"
            draggable={false}
          />
        </div>
      )}

      <div key={`in-${slide.id}-${current}`} className={`hero-layer hero-panel ${previousSlide ? "hero-panel-in" : "hero-panel-still"}`}>
        <img
          src={optimizedImageUrl(slide.backdrop, "backdrop")}
          alt={slide.title}
          className="hero-backdrop"
          loading="eager"
          decoding="async"
          draggable={false}
        />
      </div>

      <div className="hero-vignette" aria-hidden />

      <div key={`copy-${slide.id}-${current}`} className="absolute inset-x-0 bottom-0 z-10 px-5 pb-[72px] pointer-events-none hero-copy-enter">
        <div className="max-w-[620px]">
          <div className="flex items-center gap-2 mb-3 pointer-events-auto">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-primary drop-shadow-[0_2px_8px_rgba(0,0,0,0.65)]">
              {metaLabel}
            </span>
            {slide.year && !slide.isCustom && (
              <span className="text-[11px] font-semibold text-primary-foreground/75 drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
                {slide.year}
              </span>
            )}
            {slide.rating && !slide.isCustom && (
              <span className="text-[11px] font-semibold text-primary-foreground/75 drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
                ★ {slide.rating}
              </span>
            )}
          </div>

          <h1
            className="max-w-[18ch] text-[34px] leading-[1.02] font-black mb-4 line-clamp-2 pointer-events-auto sm:text-[42px]"
            style={{
              ...getAnimeTitleStyle(slide.title),
              ...(slide.titleColor ? { color: slide.titleColor } : { color: "hsl(var(--primary-foreground))" }),
              ...(slide.titleFont ? { fontFamily: slide.titleFont } : {}),
              textShadow: "0 4px 26px hsl(0 0% 0% / 0.8)",
              letterSpacing: 0,
            }}
          >
            {slide.title}
          </h1>

          {slide.isCustom && slide.description ? (
            <p className="max-w-[340px] text-[13px] leading-snug text-primary-foreground/78 mb-5 line-clamp-2 pointer-events-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.75)]">
              {slide.description}
            </p>
          ) : (
            <div className="flex items-center gap-2 flex-wrap mb-5 pointer-events-auto">
              {(slide.episodeInfo || slide.subtitle) && (
                <span className="hero-meta-pill">{slide.episodeInfo || slide.subtitle}</span>
              )}
              {slide.languageInfo && <span className="hero-meta-pill">{slide.languageInfo}</span>}
            </div>
          )}

          <div className="pointer-events-auto">
            <button
              type="button"
              onClick={handlePrimary}
              className="hero-play-button group"
              aria-label={`Play ${slide.title}`}
            >
              <span className="hero-play-icon">
                <Play className="w-4 h-4 fill-current" />
              </span>
              <span>Watch Now</span>
            </button>
          </div>
        </div>
      </div>

      {deck.length > 1 && (
        <div className="absolute bottom-6 left-5 right-5 z-10 flex items-center gap-1.5" aria-label="Hero slides">
          {deck.map((item, index) => (
            <button
              type="button"
              key={item.id}
              onClick={() => goTo(index)}
              className="hero-dot"
              style={{ flexGrow: index === current ? 1 : 0, width: index === current ? undefined : 18 }}
              aria-label={`Go to ${item.title}`}
              aria-current={index === current ? "true" : undefined}
            >
              <span className="hero-dot-track" />
              {index === current && !paused && !transitioning && (
                <span
                  key={`progress-${current}-${progressKey}`}
                  className="hero-dot-fill"
                  style={{ animationDuration: `${SLIDE_DURATION}ms` }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

export default memo(HeroSlider);