import { useEffect, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Prev/next buttons for horizontal card rails. Hidden on phones via CSS
 * (`.rail-arrow` only shows inside the large-screen layer), so touch users keep
 * swiping while mouse / TV-remote users get a one-click way to page the row.
 */
const RailArrows = ({ targetRef }: { targetRef: RefObject<HTMLElement> }) => {
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = el.scrollWidth - el.clientWidth;
      setCanPrev(el.scrollLeft > 4);
      setCanNext(max - el.scrollLeft > 4);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    el.addEventListener("scroll", schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("scroll", schedule);
      ro.disconnect();
    };
  }, [targetRef]);

  const page = (dir: 1 | -1) => {
    const el = targetRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.85), behavior: "smooth" });
  };

  return (
    <>
      <button
        type="button"
        aria-label="Scroll left"
        className={`rail-arrow rail-arrow-prev ${canPrev ? "" : "is-off"}`}
        onClick={() => page(-1)}
        tabIndex={canPrev ? 0 : -1}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="Scroll right"
        className={`rail-arrow rail-arrow-next ${canNext ? "" : "is-off"}`}
        onClick={() => page(1)}
        tabIndex={canNext ? 0 : -1}
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </>
  );
};

export default RailArrows;
