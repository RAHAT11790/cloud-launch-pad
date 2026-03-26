import { Home, Film, Video, User } from "lucide-react";

interface BottomNavProps {
  activePage: string;
  onNavigate: (page: string) => void;
}

const navItems = [
  { id: "home", label: "Home", icon: Home },
  { id: "series", label: "Series", icon: Film },
  { id: "movies", label: "Movies", icon: Video },
  { id: "profile", label: "Profile", icon: User },
];

const BottomNav = ({ activePage, onNavigate }: BottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 h-[65px] z-50 flex items-center justify-around px-2.5 bg-background"
      style={{ boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
      {navItems.map((item) => {
        const isActive = activePage === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className="relative flex flex-col items-center gap-1 py-2 px-4 transition-all rounded-xl"
            style={isActive ? { boxShadow: "var(--neu-shadow-inset)", background: "hsl(var(--secondary))" } : {}}
          >
            {isActive && (
              <span className="absolute top-[-1px] left-1/2 -translate-x-1/2 w-7 h-[3px] rounded-b gradient-primary" style={{ boxShadow: "0 2px 8px hsla(42,80%,50%,0.4)" }} />
            )}
            <Icon className={`w-5 h-5 transition-all ${isActive ? "text-primary scale-110" : "text-muted-foreground"}`} />
            <span className={`text-[9px] font-medium ${isActive ? "text-primary" : "text-muted-foreground"}`}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;
