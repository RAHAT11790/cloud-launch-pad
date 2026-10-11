import CategoryLabel from "./CategoryLabel";

interface CategoryPillsProps {
  active: string;
  onSelect: (cat: string) => void;
  categories: string[];
}

const CategoryPills = ({ active, onSelect, categories }: CategoryPillsProps) => {
  const visibleCategories = categories.filter(Boolean);
  const all = ["All", ...visibleCategories];

  return (
    <div data-no-swipe="true" className="flex gap-2 overflow-x-auto px-4 py-4 no-scrollbar" style={{ touchAction: "pan-x pan-y" }}>
      {all.map((cat, index) => {
        const isActive = active === cat;
        return (
          <button
            key={`${cat}-${index}`}
            onClick={() => onSelect(cat)}
            className={`cat-pill flex-shrink-0 px-4 py-2 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
              isActive ? "gradient-primary text-primary-foreground -translate-y-0.5 cat-pill-on" : "bg-card text-muted-foreground"
            }`}
            style={{
              animationDelay: `${index * 45}ms`,
              boxShadow: isActive ? "0 4px 15px hsl(var(--primary) / 0.35)" : "var(--neu-shadow-sm)",
            }}
          >
            <CategoryLabel title={cat} />
          </button>
        );
      })}
    </div>
  );
};

export default CategoryPills;
