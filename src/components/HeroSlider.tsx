import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Info, Star } from "lucide-react";
import { getAnimeTitleStyle } from "@/lib/animeFonts";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";

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
}

interface HeroSliderProps {
  slides: HeroSlide[];
  onPlay: (index: number) => void;
  onInfo: (index: number) => void;
}

const HeroSlider = ({ slides, onPlay, onInfo }: HeroSliderProps) => {
  const [[current, direction], setSlide] = useState([0, 1]);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const SLIDE_DURATION = 6000;

  const resetAutoPlay = useCallback(() => {
    if (autoTimer.current) clearInterval(autoTimer.current);
    if (slides.length <= 1) return;
    autoTimer.current = setInterval(() => {
      setSlide(([c]) => [(c + 1) % slides.length, 1]);
    }, SLIDE_DURATION);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length === 0) return;
    resetAutoPlay();
    return () => { if (autoTimer.current) clearInterval(autoTimer.current); };
  }, [slides.length, resetAutoPlay]);

  useEffect(() => {
    if (slides.length > 0 && current >= slides.length) {
      setSlide([0, 1]);
    }
  }, [slides.length, current]);

  const goTo = useCallback((idx: number, dir: number) => {
    setSlide([idx, dir]);
    resetAutoPlay();
  }, [resetAutoPlay]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    const { velocity, offset } = info;
    if (offset.x < -50 || velocity.x < -300) {
      goTo((current + 1) % slides.length, 1);
    } else if (offset.x > 50 || velocity.x > 300) {
      goTo((current - 1 + slides.length) % slides.length, -1);
    }
  };

  if (slides.length === 0) {
    return (
      <div className="relative w-full h-[42vh] min-h-[300px] bg-card flex items-center justify-center" style={{ boxShadow: "var(--neu-shadow)" }}>
        <p className="text-muted-foreground">No content available</p>
      </div>
    );
  }

  const slide = slides[current];
  if (!slide) return null;

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? "100%" : "-100%",
      scale: 1.15,
      opacity: 0,
    }),
    center: {
      x: 0,
      scale: 1,
      opacity: 1,
      transition: {
        x: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
        scale: { duration: 6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
        opacity: { duration: 0.4 },
      },
    },
    exit: (dir: number) => ({
      x: dir > 0 ? "-30%" : "30%",
      scale: 1.05,
      opacity: 0,
      transition: {
        duration: 0.5,
        ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
      },
    }),
  };

  return (
    <div className="relative w-full h-[42vh] min-h-[300px] overflow-hidden rounded-b-3xl" style={{ boxShadow: "0 8px 30px rgba(0,0,0,0.1)" }}>
      {/* Background with cinematic zoom-out effect */}
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.div
          key={slide.id + current}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.08}
          onDragEnd={handleDragEnd}
          className="absolute inset-0 cursor-grab active:cursor-grabbing will-change-transform"
          style={{ touchAction: "pan-y" }}
        >
          <img
            src={slide.backdrop}
            alt={slide.title}
            className="w-full h-full object-cover"
            draggable={false}
          />
        </motion.div>
      </AnimatePresence>

      {/* Gradient overlays */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `
          linear-gradient(to top, hsl(var(--background)) 0%, hsla(var(--background)/0.5) 25%, transparent 55%),
          linear-gradient(to bottom, hsla(var(--background)/0.3) 0%, transparent 20%)
        `
      }} />

      {/* Content */}
      <div className="absolute bottom-[80px] left-0 right-0 px-5 z-10">
        <AnimatePresence mode="wait">
          <motion.div key={slide.id + "-" + current + "-info"} className="max-w-lg">
            <motion.h1
              initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -20, filter: "blur(6px)" }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="text-[26px] leading-[1.1] font-extrabold mb-3 line-clamp-2 drop-shadow-[0_4px_20px_rgba(0,0,0,0.8)]"
              style={{
                ...getAnimeTitleStyle(slide.title),
                ...(slide.titleColor ? { color: slide.titleColor } : { color: "white" }),
                ...(slide.titleFont ? { fontFamily: slide.titleFont } : {}),
              }}
            >
              {slide.title}
            </motion.h1>

            {!slide.isCustom ? (
              <motion.div
                className="flex items-center gap-2 text-xs flex-wrap mb-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, delay: 0.25 }}
              >
                {slide.rating && (
                  <span className="gradient-primary px-2.5 py-1 rounded-md text-[11px] font-bold text-primary-foreground flex items-center gap-1"
                    style={{ boxShadow: "0 2px 10px hsla(42,80%,50%,0.4)" }}>
                    <Star className="w-3 h-3" /> {slide.rating}
                  </span>
                )}
                {slide.year && <span className="text-white/80 font-medium">{slide.year}</span>}
                {slide.subtitle && <><span className="text-white/60">•</span><span className="text-white/80 font-medium">{slide.subtitle}</span></>}
                <span className="bg-white/20 text-white px-2.5 py-1 rounded-md text-[10px] font-bold backdrop-blur-sm">
                  {slide.type === "webseries" ? "Series" : "Movie"}
                </span>
              </motion.div>
            ) : slide.description ? (
              <motion.p
                className="text-white/80 text-xs mb-4 line-clamp-2 max-w-[280px]"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, delay: 0.25 }}
              >
                {slide.description}
              </motion.p>
            ) : null}

            <motion.div
              className="flex gap-3"
              initial={{ opacity: 0, y: 25 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.35 }}
            >
              <motion.button
                onClick={() => slide.isCustom ? onInfo(current) : onPlay(current)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="gradient-primary text-primary-foreground px-7 py-3 rounded-xl font-bold text-sm flex items-center gap-2 btn-glow"
              >
                {slide.isCustom ? <><Info className="w-4 h-4" /> View</> : <><Play className="w-4 h-4 fill-current" /> Play Now</>}
              </motion.button>
              <motion.button
                onClick={() => onInfo(current)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="bg-white/20 text-white px-6 py-3 rounded-xl font-semibold text-sm flex items-center gap-2 backdrop-blur-lg hover:bg-white/30 transition-colors"
              >
                <Info className="w-4 h-4" /> Details
              </motion.button>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Slide indicators with progress */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-2 z-10">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i, i > current ? 1 : -1)}
            className="relative h-[6px] rounded-full overflow-hidden transition-all duration-500"
            style={{ width: i === current ? 32 : 8 }}
          >
            <div className={`absolute inset-0 rounded-full transition-colors duration-300 ${i === current ? "bg-white/40" : "bg-white/25"}`} />
            {i === current && (
              <motion.div
                ref={progressRef}
                className="absolute inset-0 rounded-full gradient-primary"
                initial={{ scaleX: 0, originX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: SLIDE_DURATION / 1000, ease: "linear" }}
                key={`prog-${current}`}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default HeroSlider;
