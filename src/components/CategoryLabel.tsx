import { memo } from "react";
import { categoryFx } from "@/lib/categoryFx";

/**
 * Category title with a moving emoji and letters that animate one after
 * another. Everything is transform/opacity only, so it stays smooth on
 * low-end phones.
 */
const CategoryLabel = memo(({ title, className = "" }: { title: string; className?: string }) => {
  const { emoji, label, fx } = categoryFx(title);
  const letters = Array.from(label);
  return (
    <span className={`cat-label cat-t-${fx.text} ${className}`} aria-label={label}>
      <span aria-hidden className={`cat-emo cat-m-${fx.motion}`}><span className="cat-emo-in">{emoji}</span></span>
      <span aria-hidden className="cat-txt">
        {letters.map((ch, i) => (
          <span key={i} className="cat-ch" style={{ ["--i" as string]: i }}>{ch === " " ? "\u00A0" : ch}</span>
        ))}
      </span>
    </span>
  );
});
CategoryLabel.displayName = "CategoryLabel";
export default CategoryLabel;
