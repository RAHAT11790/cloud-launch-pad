const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[role='button']:not([aria-disabled='true'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const isTvMode = () => {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("tv-mode");
};

const isEditableTarget = (target: EventTarget | null) => {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
};

const isVisible = (el: HTMLElement) => {
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  // NOTE: no viewport-bounds check — off-screen items (episode/season/download
  // lists below the fold) must stay reachable with the TV remote; we scroll to them.
  return rect.width > 2 && rect.height > 2;
};

const getFocusableElements = () => {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true" && isVisible(el));
};


const scoreCandidate = (from: DOMRect, to: DOMRect, key: string) => {
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  const toX = to.left + to.width / 2;
  const toY = to.top + to.height / 2;
  const dx = toX - fromX;
  const dy = toY - fromY;

  if (key === "ArrowRight" && dx <= 8) return Infinity;
  if (key === "ArrowLeft" && dx >= -8) return Infinity;
  if (key === "ArrowDown" && dy <= 8) return Infinity;
  if (key === "ArrowUp" && dy >= -8) return Infinity;

  const primary = key === "ArrowRight" || key === "ArrowLeft" ? Math.abs(dx) : Math.abs(dy);
  const secondary = key === "ArrowRight" || key === "ArrowLeft" ? Math.abs(dy) : Math.abs(dx);
  return primary + secondary * 2.6;
};

export const setupTvNavigation = () => {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  const focusElement = (el: HTMLElement) => {
    el.focus({ preventScroll: true });
    const rect = el.getBoundingClientRect();
    const offscreen = rect.top < 80 || rect.bottom > window.innerHeight - 40;
    el.scrollIntoView({ block: offscreen ? "center" : "nearest", inline: "nearest" });
  };


  const handleKeyDown = (event: KeyboardEvent) => {
    if (!isTvMode() || isEditableTarget(event.target)) return;
    const key = event.key;

    if (key === "Enter" || key === " ") {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && active.matches(FOCUSABLE_SELECTOR)) {
        event.preventDefault();
        active.click();
      }
      return;
    }

    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return;

    const focusables = getFocusableElements();
    if (focusables.length === 0) return;
    const active = document.activeElement as HTMLElement | null;

    if (!active || active === document.body || !focusables.includes(active)) {
      event.preventDefault();
      focusElement(focusables[0]);
      return;
    }

    const activeRect = active.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let bestScore = Infinity;

    for (const el of focusables) {
      if (el === active) continue;
      const score = scoreCandidate(activeRect, el.getBoundingClientRect(), key);
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (best) {
      event.preventDefault();
      focusElement(best);
    }
  };

  document.addEventListener("keydown", handleKeyDown, true);
  return () => document.removeEventListener("keydown", handleKeyDown, true);
};