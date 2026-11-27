/**
 * RS ANIME03 player glyphs: duotone solid icons (soft filled body + crisp outline).
 * Depth comes from the two-tone fill, never from glow, blur or shadows.
 */
export type PlayerGlyphName =
  | "back" | "fit" | "server" | "cc" | "lock" | "replay" | "forward" | "play" | "pause"
  | "volume" | "mute" | "audio" | "next" | "settings" | "expand" | "shrink" | "chevron"
  | "bookmark" | "bookmarked" | "share" | "download" | "library";

const B = { fill: "currentColor", fillOpacity: 0.28, stroke: "none" } as const;

function paths(name: PlayerGlyphName) {
  switch (name) {
    case "back": return <><circle cx="12" cy="12" r="9" {...B} /><path d="M13.5 7.5 9 12l4.5 4.5M9.5 12H17" /></>;
    case "fit": return <><rect x="3" y="5" width="18" height="14" rx="3" {...B} /><path d="M3 9V7a2 2 0 0 1 2-2h2M17 5h2a2 2 0 0 1 2 2v2M21 15v2a2 2 0 0 1-2 2h-2M7 19H5a2 2 0 0 1-2-2v-2" /></>;
    case "server": return <><rect x="3.5" y="4" width="17" height="7" rx="2.5" {...B} /><rect x="3.5" y="13" width="17" height="7" rx="2.5" {...B} /><rect x="3.5" y="4" width="17" height="7" rx="2.5" /><rect x="3.5" y="13" width="17" height="7" rx="2.5" /><path d="M7.5 7.5h.01M7.5 16.5h.01" strokeWidth={3} /></>;
    case "cc": return <><rect x="2.5" y="5" width="19" height="14" rx="3.5" {...B} /><rect x="2.5" y="5" width="19" height="14" rx="3.5" /><path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6" /></>;
    case "lock": return <><rect x="4.5" y="10.5" width="15" height="10" rx="3" {...B} /><rect x="4.5" y="10.5" width="15" height="10" rx="3" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" /></>;
    case "replay": return <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4 3.5v4h4" /></>;
    case "forward": return <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M20 3.5v4h-4" /></>;
    case "play": return <path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2Z" fill="currentColor" stroke="none" />;
    case "pause": return <><rect x="6" y="4.5" width="4.2" height="15" rx="1.4" fill="currentColor" stroke="none" /><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.4" fill="currentColor" stroke="none" /></>;
    case "volume": return <><path d="M4 9.5h3l4.5-4v13L7 14.5H4z" fill="currentColor" stroke="none" /><path d="M15 9a4 4 0 0 1 0 6M17.8 6.5a7.5 7.5 0 0 1 0 11" /></>;
    case "mute": return <><path d="M4 9.5h3l4.5-4v13L7 14.5H4z" fill="currentColor" stroke="none" /><path d="m15.5 9.5 5 5M20.5 9.5l-5 5" /></>;
    case "audio": return <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V17h-.5A2.5 2.5 0 0 1 4 14.5z" {...B} /><path d="M8.5 9v3.5M12 7.5v6.5M15.5 9.5v2.5" /></>;
    case "next": return <><path d="M5.5 6.2v11.6a.9.9 0 0 0 1.4.75l8.4-5.8a.9.9 0 0 0 0-1.5L6.9 5.45a.9.9 0 0 0-1.4.75Z" fill="currentColor" stroke="none" /><path d="M18.5 5.5v13" strokeWidth={2.6} /></>;
    case "settings": return <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.6" fill="currentColor" stroke="none" /><circle cx="9" cy="17" r="2.6" fill="currentColor" stroke="none" /></>;
    case "expand": return <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" strokeWidth={2.4} />;
    case "shrink": return <path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" strokeWidth={2.4} />;
    case "chevron": return <path d="m7 10 5 5 5-5" />;
    case "bookmark": return <><path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4-6.5 4V5a1 1 0 0 1 1-1Z" {...B} /><path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4-6.5 4V5a1 1 0 0 1 1-1Z" /></>;
    case "bookmarked": return <><path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4-6.5 4V5a1 1 0 0 1 1-1Z" fill="currentColor" /><path d="m9.3 10 1.9 1.9 3.6-3.6" stroke="hsl(var(--background))" /></>;
    case "share": return <><path d="m8.6 10.6 6.8-3.7M8.6 13.4l6.8 3.7" /><circle cx="6" cy="12" r="3" fill="currentColor" stroke="none" /><circle cx="18" cy="5.5" r="3" fill="currentColor" stroke="none" /><circle cx="18" cy="18.5" r="3" fill="currentColor" stroke="none" /></>;
    case "download": return <><path d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15z" {...B} /><path d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" /></>;
    case "library": return <><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.5l2 2.5H18a2.5 2.5 0 0 1 2.5 2.5v7.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5z" {...B} /><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.5l2 2.5H18a2.5 2.5 0 0 1 2.5 2.5v7.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5z" /><path d="m9.5 12 2.5 2.5 2.5-2.5M12 9.5v5" /></>;
  }
}

export function PlayerGlyph({ name, className = "" }: { name: PlayerGlyphName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`pg-glyph ${className}`} fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths(name)}
    </svg>
  );
}
