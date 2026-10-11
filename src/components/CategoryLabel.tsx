import { memo } from "react";
import { categoryFx } from "@/lib/categoryFx";

/**
 * Category title with a moving emoji and letters that animate one after
 * another. Everything is transform/opacity only, so it stays smooth on
 * low-end phones.
 */
const CategoryLabel = memo(({ title, className = "" }: { title: string; className?: string }) => {
  const { emoji, label, fx } = categoryFx(title);
  return (
    <span className={`cat-label cat-t-${fx.text} ${className}`} aria-label={label}>
      <span aria-hidden className={`cat-emo cat-m-${fx.motion}`}><span className="cat-emo-in">{emoji}</span></span>
      <span aria-hidden className="cat-txt">{label}</span>
    </span>
  );
});
CategoryLabel.displayName = "CategoryLabel";
export default CategoryLabel;
