import { memo } from "react";
import { useLiveTvEnabled } from "@/lib/liveTvToggle";

interface BottomNavProps {
  activePage: string;
  onNavigate: (page: string) => void;
}

/* Modern duotone icons — each one has its own small, GPU-cheap motion
   (transform/opacity only) that plays once when the tab becomes active. */
const HomeIcon = () => (
  <svg viewBox="0 0 24 24" className="nv-svg">
    <path className="nv-fill" d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
    <path className="nv-line" d="M3 11 12 3.8 21 11M5.5 9.6V19c0 .8.7 1.5 1.5 1.5h10c.8 0 1.5-.7 1.5-1.5V9.6" />
    <rect className="nv-line nv-door" x="10" y="14" width="4" height="6.5" rx="1.2" />
  </svg>
);
const SeriesIcon = () => (
  <svg viewBox="0 0 24 24" className="nv-svg">
    <rect className="nv-fill" x="3" y="6.5" width="18" height="13" rx="3" />
    <rect className="nv-line" x="3" y="6.5" width="18" height="13" rx="3" />
    <path className="nv-line nv-stack" d="M6.5 3.5h11" />
    <path className="nv-line nv-play" d="M10.5 10.2v5.6l4.6-2.8z" />
  </svg>
);
const LiveIcon = () => (
  <svg viewBox="0 0 24 24" className="nv-svg">
    <rect className="nv-fill" x="2.5" y="7" width="19" height="13" rx="3" />
    <rect className="nv-line" x="2.5" y="7" width="19" height="13" rx="3" />
    <path className="nv-line" d="m8.5 3 3.5 4 3.5-4" />
    <circle className="nv-dot" cx="12" cy="13.5" r="2.2" />
    <path className="nv-line nv-wave" d="M7.8 10.6a5 5 0 0 0 0 5.8M16.2 10.6a5 5 0 0 1 0 5.8" />
  </svg>
);
const MoviesIcon = () => (
  <svg viewBox="0 0 24 24" className="nv-svg">
    <circle className="nv-fill" cx="12" cy="12" r="9" />
    <g className="nv-reel">
      <circle className="nv-line" cx="12" cy="12" r="9" />
      <circle className="nv-line" cx="12" cy="7.6" r="1.7" />
      <circle className="nv-line" cx="12" cy="16.4" r="1.7" />
      <circle className="nv-line" cx="7.6" cy="12" r="1.7" />
      <circle className="nv-line" cx="16.4" cy="12" r="1.7" />
    </g>
  </svg>
);
const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" className="nv-svg">
    <path className="nv-fill" d="M4.5 20.5c.6-3.9 3.7-6.3 7.5-6.3s6.9 2.4 7.5 6.3z" />
    <g className="nv-head"><circle className="nv-fill" cx="12" cy="8" r="4" /><circle className="nv-line" cx="12" cy="8" r="4" /></g>
    <path className="nv-line" d="M4.5 20.5c.6-3.9 3.7-6.3 7.5-6.3s6.9 2.4 7.5 6.3" />
  </svg>
);

const ALL_ITEMS = [
  { id: "home", label: "Home", Icon: HomeIcon },
  { id: "series", label: "Series", Icon: SeriesIcon },
  { id: "livetv", label: "Live TV", Icon: LiveIcon },
  { id: "movies", label: "Movies", Icon: MoviesIcon },
  { id: "profile", label: "Profile", Icon: ProfileIcon },
];

const BottomNav = ({ activePage, onNavigate }: BottomNavProps) => {
  const liveOn = useLiveTvEnabled();
  const items = liveOn ? ALL_ITEMS : ALL_ITEMS.filter((i) => i.id !== "livetv");
  return (
    <nav className="nv-bar fixed bottom-0 left-0 right-0 h-[65px] z-50 grid items-center px-2 bg-background"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, boxShadow: "0 -4px 16px hsl(var(--foreground) / 0.06)" }}>
      {items.map(({ id, label, Icon }) => {
        const isActive = activePage === id;
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={`nv-item nv-${id} ${isActive ? "nv-on" : ""}`}
          >
            <span className="nv-ico"><Icon /></span>
            <span className="nv-lbl">{label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default memo(BottomNav);
