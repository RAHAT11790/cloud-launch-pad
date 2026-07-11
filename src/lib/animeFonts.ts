// Stylish Google font families for anime titles — a unique font per title (stable hash)
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
  "'Monoton', cursive",
  "'Faster One', cursive",
  "'Bowlby One', sans-serif",
  "'Staatliches', cursive",
  "'Anton', sans-serif",
  "'Passion One', cursive",
  "'Alfa Slab One', cursive",
  "'Fjalla One', sans-serif",
  "'Bungee Shade', cursive",
  "'Bangers', cursive",
  "'Rubik Mono One', sans-serif",
  "'Kanit', sans-serif",
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getAnimeFont(title: string): string {
  if (!title) return ANIME_FONTS[0];
  return ANIME_FONTS[hashCode(title) % ANIME_FONTS.length];
}

export function getAnimeTitleStyle(title: string): React.CSSProperties {
  return {
    fontFamily: getAnimeFont(title),
    letterSpacing: '0.5px',
  };
}
