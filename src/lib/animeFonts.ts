// Stylish font families for anime titles - each anime gets a unique font based on its name
const ANIME_FONTS = [
  "'Righteous', cursive",
  "'Russo One', sans-serif",
  "'Orbitron', sans-serif",
  "'Audiowide', cursive",
  "'Rajdhani', sans-serif",
  "'Teko', sans-serif",
  "'Black Ops One', system-ui",
  "'Bungee', cursive",
  "'Bebas Neue', sans-serif",
  "'Permanent Marker', cursive",
];

// Simple hash to pick a consistent font per title
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getAnimeFont(title: string): string {
  return ANIME_FONTS[hashCode(title) % ANIME_FONTS.length];
}

export function getAnimeTitleStyle(title: string): React.CSSProperties {
  return {
    fontFamily: getAnimeFont(title),
    letterSpacing: '0.5px',
  };
}
