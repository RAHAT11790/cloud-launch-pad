import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { Play, Info, Star } from "lucide-react";
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
  onInfo: (index: number) => void;
}

const SLIDE_DURATION = 6800;
const TRANSITION_MS = 1080;

const HERO_MOTIONS = ["pan", "veil", "depth", "rise", "prism"] as const;
type HeroMotion = typeof HERO_MOTIONS[number];

const imageReadyCache = new Map<string, Promise<void>>();

const waitForImage = (src: string) => {
  if (!src || typeof window === "undefined") return Promise.resolve();
  const cached = imageReadyCache.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    const done = () => {
      const decode = img.decode?.();
      if (decode) decode.catch(() => undefined).finally(resolve);
      else resolve();
    };
    img.onload = done;
    img.onerror = () => resolve();
    img.src = src;
    if (img.complete) done();
  });
  imageReadyCache.set(src, promise);
  return promise;
};

const HeroSlider = ({ slides, onPlay, onInfo }: HeroSliderProps) => {
  const [current, setCurrent] = useState(0);
  const [outgoingSlide, setOutgoingSlide] = useState<HeroSlide | null>(null);
  const [motion, setMotion] = useState<HeroMotion>("pan");
  const [motionKey, setMotionKey] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [progressKey, setProgressKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dragDx, setDragDx] = useState(0);
  const [renderSlides, setRenderSlides] = useState<HeroSlide[]>(() => slides.filter((s) => !!s?.backdrop));
  const [settled, setSettled] = useState(() => slides.length > 0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const slidesLenRef = useRef(renderSlides.length);
  const renderSlidesRef = useRef(renderSlides);
  const currentRef = useRef(current);
  const transitionLockedRef = useRef(false);
  const transitionRunRef = useRef(0);
  const motionIndexRef = useRef(0);
  const mountedRef = useRef(false);

  slidesLenRef.current = renderSlides.length;
  renderSlidesRef.current = renderSlides;
  currentRef.current = current;

  // Primitive signature: parent array reference churn will not reset the slider.
  const slidesSignature = useMemo(
    () => slides.filter((s) => !!s?.backdrop).map((s) => `${s.id}:${s.backdrop}:${s.title}`).join("|"),
    [slides],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (transitionCleanupRef.current) clearTimeout(transitionCleanupRef.current);
      transitionRunRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const snapshot = slides.filter((s) => !!s?.backdrop).slice(0, 8);
    transitionRunRef.current += 1;

    if (snapshot.length === 0) {
      setRenderSlides([]);
      setOutgoingSlide(null);
      setTransitioning(false);
      transitionLockedRef.current = false;
      setSettled(true);
      return;
    }

    const currentId = renderSlidesRef.current[currentRef.current]?.id;
    const preservedIndex = currentId ? snapshot.findIndex((s) => s.id === currentId) : -1;
    const nextIndex = preservedIndex >= 0 ? preservedIndex : 0;
    setRenderSlides(snapshot);
    setCurrent(nextIndex);
    currentRef.current = nextIndex;
    setOutgoingSlide(null);
    setTransitioning(false);
    transitionLockedRef.current = false;
    setProgressKey((k) => k + 1);
    setSettled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slidesSignature]);

  useEffect(() => {
    if (renderSlides.length > 0 && current >= renderSlides.length) setCurrent(0);
  }, [renderSlides.length, current]);

  const goTo = useCallback((idx: number) => {
    const list = renderSlidesRef.current;
    const n = list.length;
    if (n <= 1 || transitionLockedRef.current) return;

    const from = currentRef.current;
    const next = ((idx % n) + n) % n;
    if (next === from) return;

    const fromSlide = list[from];
    const nextSlide = list[next];
    if (!fromSlide || !nextSlide) return;

    transitionLockedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (transitionCleanupRef.current) clearTimeout(transitionCleanupRef.current);

    const runId = ++transitionRunRef.current;
    const nextMotion = HERO_MOTIONS[motionIndexRef.current % HERO_MOTIONS.length];
    motionIndexRef.current += 1;

    waitForImage(optimizedImageUrl(nextSlide.backdrop, "backdrop")).finally(() => {
      if (!mountedRef.current || runId !== transitionRunRef.current) return;
      const latest = renderSlidesRef.current;
      const safeNext = latest.findIndex((s) => s.id === nextSlide.id);
      const safeFrom = latest[currentRef.current];
      if (safeNext < 0 || !safeFrom) {
        transitionLockedRef.current = false;
        return;
      }

      setMotion(nextMotion);
      setMotionKey(runId);
      setOutgoingSlide(safeFrom);
      setTransitioning(true);
      currentRef.current = safeNext;
      setCurrent(safeNext);

      transitionCleanupRef.current = setTimeout(() => {
        if (!mountedRef.current || runId !== transitionRunRef.current) return;
        setOutgoingSlide(null);
        setTransitioning(false);
        transitionLockedRef.current = false;
        setProgressKey((k) => k + 1);
      }, TRANSITION_MS + 80);
    });
  }, []);

  // Advance timer — one card at a time, locked during image-load + crossfade.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!settled || transitioning) return;
    if (slidesLenRef.current <= 1) return;
    if (paused) return;
    if (typeof document !== "undefined" && document.hidden) return;
    timerRef.current = setTimeout(() => goTo(currentRef.current + 1), SLIDE_DURATION);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [goTo, current, paused, settled, transitioning, renderSlides.length]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (timerRef.current) clearTimeout(timerRef.current);
      } else {
        setProgressKey((k) => k + 1);
      }
    };
    const onBlur = () => { if (timerRef.current) clearTimeout(timerRef.current); };
    const onFocus = () => {
      if (!transitionLockedRef.current) setProgressKey((k) => k + 1);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Preload neighbors
  useEffect(() => {
    if (renderSlides.length <= 1) return;
    const n = renderSlides.length;
    [(current + 1) % n, (current + 2) % n, (current - 1 + n) % n].forEach((idx) => {
      const s = renderSlides[idx];
      if (!s?.backdrop) return;
      void waitForImage(optimizedImageUrl(s.backdrop, "backdrop"));
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
    goTo(dx > 0 ? current - 1 : current + 1);
  };

  if (renderSlides.length === 0) {
    return (
      <div
        data-no-swipe="true"
        className="relative w-full h-[46vh] min-h-[320px] max-h-[520px] overflow-hidden rounded-b-3xl bg-card flex items-center justify-center"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-muted/40 via-card to-background" />
        <p className="relative z-10 text-muted-foreground">{settled ? "No content available" : ""}</p>
      </div>
    );
  }

  const slide = renderSlides[current];
  if (!slide) return null;
  return (
    <div
      data-no-swipe="true"
      className="hero-stage relative w-full h-[46vh] min-h-[320px] max-h-[520px] overflow-hidden rounded-b-3xl select-none"
      style={{ touchAction: "pan-y pinch-zoom" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        key={`cur-${slide.id}-${current}-${motionKey}`}
        className={`hero-layer hero-layer-in ${outgoingSlide ? `hero-motion-${motion}` : "hero-layer-current"}`}
        style={{
          backgroundImage: `url(${optimizedImageUrl(slide.backdrop, "backdrop")})`,
          transform: `translate3d(${dragDx * 0.28}px, 0, 0)`,
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

      {/* Outgoing layer stays above the already-loaded incoming slide; this removes black/white flash. */}
      {outgoingSlide && (
        <div
          key={`out-${outgoingSlide.id}-${motionKey}`}
          className={`hero-layer hero-layer-out hero-motion-${motion}`}
          style={{ backgroundImage: `url(${optimizedImageUrl(outgoingSlide.backdrop, "backdrop")})` }}
        >
          <img
            src={optimizedImageUrl(outgoingSlide.backdrop, "backdrop")}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover hero-image"
            draggable={false}
          />
        </div>
      )}

      {/* Gradient overlays */}
      <div className="hero-vignette absolute inset-0 pointer-events-none" style={{
        background: `
          linear-gradient(to top, hsl(var(--background)) 0%, hsl(var(--background) / 0.68) 25%, hsl(var(--background) / 0.18) 56%, transparent 74%),
          linear-gradient(to bottom, hsl(var(--background) / 0.34) 0%, transparent 25%),
          radial-gradient(circle at 18% 65%, hsl(var(--primary) / 0.18), transparent 34%)
        `,
      }} />

      {/* Content */}
      <div key={`info-${slide.id}-${current}`} className="absolute bottom-[84px] left-0 right-0 px-5 z-10 pointer-events-none hero-fade-in">
        <div className="max-w-lg">
          <h1
            className="text-[28px] leading-[1.05] font-extrabold mb-3 line-clamp-2 drop-shadow-[0_5px_22px_rgba(0,0,0,0.72)] pointer-events-auto"
            style={{
              ...getAnimeTitleStyle(slide.title),
              ...(slide.titleColor ? { color: slide.titleColor } : { color: "white" }),
              ...(slide.titleFont ? { fontFamily: slide.titleFont } : {}),
            }}
          >
            {slide.title}
          </h1>

          {!slide.isCustom ? (
            <div className="flex items-center gap-2 text-xs flex-wrap mb-4 pointer-events-auto">
              {slide.rating && (
                <span className="gradient-primary px-2.5 py-1 rounded-md text-[11px] font-bold text-primary-foreground flex items-center gap-1"
                  style={{ boxShadow: "0 2px 10px hsla(42,80%,50%,0.4)" }}>
                  <Star className="w-3 h-3" /> {slide.rating}
                </span>
              )}
              {slide.year && <span className="text-white/80 font-medium">{slide.year}</span>}
              {slide.subtitle && <><span className="text-white/60">•</span><span className="text-white/80 font-medium">{slide.subtitle}</span></>}
              <span className="bg-white/20 text-white px-2.5 py-1 rounded-md text-[10px] font-bold">
                {slide.type === "webseries" ? "Series" : "Movie"}
              </span>
              {slide.episodeInfo && (
                <span className="bg-primary/85 text-primary-foreground px-2.5 py-1 rounded-md text-[10px] font-bold">
                  {slide.episodeInfo}
                </span>
              )}
              {slide.languageInfo && (
                <span className="bg-black/55 text-white px-2.5 py-1 rounded-md text-[10px] font-bold">
                  {slide.languageInfo}
                </span>
              )}
            </div>
          ) : slide.description ? (
            <p className="text-white/80 text-xs mb-4 line-clamp-2 max-w-[280px] pointer-events-auto">
              {slide.description}
            </p>
          ) : null}

          <div className="flex gap-3 pointer-events-auto">
            <button
              onClick={() => slide.isCustom ? onInfo(current) : onPlay(current)}
              className="gradient-primary text-primary-foreground px-7 py-3 rounded-xl font-bold text-sm flex items-center gap-2 btn-glow active:scale-95 transition-transform"
            >
              {slide.isCustom ? <><Info className="w-4 h-4" /> View</> : <><Play className="w-4 h-4 fill-current" /> Play Now</>}
            </button>
            <button
              onClick={() => onInfo(current)}
              className="bg-white/20 text-white px-6 py-3 rounded-xl font-semibold text-sm flex items-center gap-2 hover:bg-white/30 active:scale-95 transition-all"
            >
              <Info className="w-4 h-4" /> Details
            </button>
          </div>
        </div>
      </div>

      {/* Indicators + progress */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-2 z-10">
        {renderSlides.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className="relative h-[6px] rounded-full overflow-hidden transition-all duration-500"
            style={{ width: i === current ? 32 : 8 }}
            aria-label={`Go to slide ${i + 1}`}
          >
            <div className={`absolute inset-0 rounded-full ${i === current ? "bg-white/40" : "bg-white/25"}`} />
            {i === current && !paused && settled && !transitioning && (
              <div
                key={`prog-${current}-${progressKey}`}
                className="absolute inset-0 rounded-full gradient-primary hero-progress-bar"
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
