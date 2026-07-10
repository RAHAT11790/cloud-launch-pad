import { useState, useEffect, useRef, useCallback, memo } from "react";
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

const SLIDE_DURATION = 6000;

const HeroSlider = ({ slides, onPlay, onInfo }: HeroSliderProps) => {
  const [current, setCurrent] = useState(0);
  const [progressKey, setProgressKey] = useState(0); // forces progress restart
  const [paused, setPaused] = useState(false);
  // Internal, stable snapshot of the slides array. We do NOT render from the
  // `slides` prop directly — the parent re-shuffles/re-orders it as Firebase
  // snapshots stream in during the first few seconds, which visually looked
  // like the slider was rapidly scrolling through many cards (even though
  // `current` was still 0). Rendering from this snapshot fully decouples us
  // from that churn.
  const [renderSlides, setRenderSlides] = useState<HeroSlide[]>(slides);
  const [settled, setSettled] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const slidesLenRef = useRef(renderSlides.length);
  slidesLenRef.current = renderSlides.length;

  // Debounce: only adopt the parent's slides after they've been STABLE for
  // 1.5s (no new prop update in that window). Then flip `settled` so the
  // auto-advance timer + progress bar can start.
  useEffect(() => {
    if (!slides || slides.length === 0) return;
    const t = setTimeout(() => {
      setRenderSlides(slides);
      setCurrent(0);
      setProgressKey((k) => k + 1);
      setSettled(true);
    }, 1500);
    return () => clearTimeout(t);
  }, [slides]);

  // Clamp current if renderSlides changes
  useEffect(() => {
    if (renderSlides.length > 0 && current >= renderSlides.length) setCurrent(0);
  }, [renderSlides.length, current]);

  // Schedule next slide — only when settled, not paused, tab visible.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!settled) return;
    if (slidesLenRef.current <= 1) return;
    if (paused) return;
    if (typeof document !== "undefined" && document.hidden) return;
    timerRef.current = setTimeout(() => {
      setCurrent((c) => (c + 1) % Math.max(1, slidesLenRef.current));
      setProgressKey((k) => k + 1);
    }, SLIDE_DURATION);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [current, progressKey, paused, settled]);

  // Pause on tab hidden / blur; resume on focus
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (timerRef.current) clearTimeout(timerRef.current);
      } else {
        // restart progress + timer cleanly
        setProgressKey((k) => k + 1);
      }
    };
    const onBlur = () => { if (timerRef.current) clearTimeout(timerRef.current); };
    const onFocus = () => setProgressKey((k) => k + 1);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Preload neighbor backdrops for snappy swipe
  useEffect(() => {
    if (renderSlides.length <= 1) return;
    const next = renderSlides[(current + 1) % renderSlides.length];
    const prev = renderSlides[(current - 1 + renderSlides.length) % renderSlides.length];
    [next, prev].forEach((s) => {
      if (!s?.backdrop) return;
      const i = new Image();
      i.decoding = "async";
      i.src = optimizedImageUrl(s.backdrop, "backdrop");
    });
  }, [current, renderSlides]);

  const goTo = useCallback((idx: number) => {
    setCurrent(((idx % renderSlides.length) + renderSlides.length) % renderSlides.length);
    setProgressKey((k) => k + 1);
  }, [renderSlides.length]);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    setPaused(true);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;
    setPaused(false);
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    goTo(dx > 0 ? current - 1 : current + 1);
  };

  if (renderSlides.length === 0) {
    return (
      <div className="relative w-full h-[42vh] min-h-[300px] bg-card flex items-center justify-center" style={{ boxShadow: "var(--neu-shadow)" }}>
        <p className="text-muted-foreground">No content available</p>
      </div>
    );
  }

  const slide = renderSlides[current];
  if (!slide) return null;

  return (
    <div
      data-no-swipe="true"
      className="relative w-full h-[42vh] min-h-[300px] overflow-hidden rounded-b-3xl bg-black"
      style={{ boxShadow: "0 8px 30px rgba(0,0,0,0.1)", touchAction: "pan-y pinch-zoom" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Cross-fade backdrops — single layer per slide, pure CSS opacity */}
      {renderSlides.map((s, i) => (
        <img
          key={s.id + i}
          src={optimizedImageUrl(s.backdrop, "backdrop")}
          alt={s.title}
          aria-hidden={i !== current}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{
            opacity: i === current ? 1 : 0,
            transition: "opacity 600ms ease",
            willChange: i === current ? "opacity" : undefined,
          }}
          loading={i === current ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
        />
      ))}

      {/* Gradient overlays */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `
          linear-gradient(to top, hsl(var(--background)) 0%, hsla(var(--background)/0.5) 25%, transparent 55%),
          linear-gradient(to bottom, hsla(var(--background)/0.3) 0%, transparent 20%)
        `,
      }} />

      {/* Content */}
      <div key={`info-${slide.id}-${current}`} className="absolute bottom-[80px] left-0 right-0 px-5 z-10 pointer-events-none hero-fade-in">
        <div className="max-w-lg">
          <h1
            className="text-[26px] leading-[1.1] font-extrabold mb-3 line-clamp-2 drop-shadow-[0_4px_20px_rgba(0,0,0,0.8)] pointer-events-auto"
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

      {/* Slide indicators with CSS progress (auto-pauses with the timer because key resets) */}
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
            {i === current && !paused && settled && (
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
