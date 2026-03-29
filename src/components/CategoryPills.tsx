interface CategoryPillsProps {
  active: string;
  onSelect: (cat: string) => void;
  categories: string[];
}

const CategoryPills = ({ active, onSelect, categories }: CategoryPillsProps) => {
  const uniqueCategories = categories.filter((cat, index) => Boolean(cat) && categories.indexOf(cat) === index);

  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-4 no-scrollbar">
      <button
        onClick={() => onSelect("All")}
        className={`flex-shrink-0 px-5 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
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
      {uniqueCategories.map((cat, index) => (
        <button
          key={`${cat}-${index}`}
          onClick={() => onSelect(cat)}
          className={`flex-shrink-0 px-5 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
            active === cat
              ? "gradient-primary text-primary-foreground -translate-y-0.5"
              : "bg-card text-muted-foreground"
          }`}
          style={active === cat
            ? { boxShadow: "0 4px 15px hsla(42,80%,50%,0.35)" }
            : { boxShadow: "var(--neu-shadow-sm)" }
          }
        >
          {cat}
        </button>
      ))}
    </div>
  );
};

export default CategoryPills;
