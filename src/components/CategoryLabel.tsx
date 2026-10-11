import { memo, useEffect, useRef } from "react";
import { categoryFx } from "@/lib/categoryFx";
import { gateMotion } from "@/lib/motionGate";

const LITE = typeof document !== "undefined" && document.documentElement.classList.contains("rs-lite");

/**
 * Category title: the emoji and the text move together on one shared beat.
 * Letters ripple only while the title is on screen (motion gate) and only on
 * capable phones — low-end phones animate the word as one piece.
 */
const CategoryLabel = memo(({ title, className = "" }: { title: string; className?: string }) => {
  const { emoji, label, fx } = categoryFx(title);
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => gateMotion(rootRef.current), []);
  const letters = LITE ? null : Array.from(label);
  return (
    <span ref={rootRef} className={`cat-label cat-t-${fx.text} cat-k-${fx.motion} ${className}`} aria-label={label}>
      <span aria-hidden className={`cat-emo cat-m-${fx.motion}`}><span className="cat-emo-in">{emoji}</span></span>
      <span aria-hidden className="cat-txt">
        {letters
          ? letters.map((ch, i) => (
              <span key={i} className="cat-ch" style={{ ["--i" as string]: i }}>{ch === " " ? "\u00A0" : ch}</span>
            ))
          : label}
      </span>
    </span>
  );
});
CategoryLabel.displayName = "CategoryLabel";
export default CategoryLabel;
