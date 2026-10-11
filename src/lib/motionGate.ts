// One shared IntersectionObserver for every decorative looping animation.
// Elements get `data-live` only while on screen; CSS pauses everything else,
// so a home page with 20 category titles runs only the 3-4 the user can see.

let io: IntersectionObserver | null = null;

function observer(): IntersectionObserver | null {
  if (io) return io;
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return null;
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting) el.setAttribute("data-live", "");
        else el.removeAttribute("data-live");
      }
    },
    { rootMargin: "40px 0px" },
  );
  return io;
}

/** Start gating an element's animations; returns the cleanup. */
export function gateMotion(el: Element | null): () => void {
  if (!el) return () => {};
  const o = observer();
  if (!o) {
    el.setAttribute("data-live", "");
    return () => {};
  }
  o.observe(el);
  return () => o.unobserve(el);
}
