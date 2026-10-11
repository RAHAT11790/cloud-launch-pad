const EMOJI: [RegExp, string, string][] = [
  [/new|release|latest/i, "🔥", "cat-fx-flame"], [/action|fight/i, "⚔️", "cat-fx-slash"], [/movie|film/i, "🎬", "cat-fx-pop"],
  [/romance|love/i, "💖", "cat-fx-beat"], [/comedy|funny/i, "😂", "cat-fx-wiggle"], [/horror|dark/i, "👻", "cat-fx-float"],
  [/hindi|dub/i, "🎙️", "cat-fx-pop"], [/series|tv|show/i, "📺", "cat-fx-float"], [/fantasy|magic|isekai/i, "✨", "cat-fx-spin"],
  [/sport/i, "⚽", "cat-fx-bounce"], [/adventure/i, "🧭", "cat-fx-spin"], [/top|popular|trend/i, "🏆", "cat-fx-bounce"],
];
const emojiFor = (cat: string) => EMOJI.find(([re]) => re.test(cat));

interface CategoryPillsProps {
  active: string;
  onSelect: (cat: string) => void;
  categories: string[];
}

const CategoryPills = ({ active, onSelect, categories }: CategoryPillsProps) => {
  const visibleCategories = categories.filter(Boolean);

  return (
    <div data-no-swipe="true" className="flex gap-2 overflow-x-auto px-4 py-4 no-scrollbar" style={{ touchAction: "pan-x pan-y" }}>
      <button
        onClick={() => onSelect("All")}
        className={`cat-pill flex-shrink-0 px-5 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
          active === "All"
            ? "gradient-primary text-primary-foreground -translate-y-0.5"
            : "bg-card text-muted-foreground"
        }`}
        style={active === "All"
          ? { boxShadow: "0 4px 15px hsla(42,80%,50%,0.35)" }
          : { boxShadow: "var(--neu-shadow-sm)" }
        }
      >
        All
      </button>
      {visibleCategories.map((cat, index) => (
        <button
          key={`${cat}-${index}`}
          onClick={() => onSelect(cat)}
          className={`cat-pill flex-shrink-0 px-5 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
            active === cat
              ? "gradient-primary text-primary-foreground -translate-y-0.5"
              : "bg-card text-muted-foreground"
          }`}
          style={active === cat
            ? { boxShadow: "0 4px 15px hsla(42,80%,50%,0.35)" }
            : { boxShadow: "var(--neu-shadow-sm)" }
          }
        >
          {(() => { const e = /\p{Extended_Pictographic}/u.test(cat) ? null : emojiFor(cat); return e ? <span aria-hidden className={`cat-fx ${e[2]} mr-1 inline-block`}>{e[1]}</span> : null; })()}
          {cat}
        </button>
      ))}
    </div>
  );
};

export default CategoryPills;
