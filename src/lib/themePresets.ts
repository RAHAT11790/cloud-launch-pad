export interface ThemePreset {
  id: string;
  name: string;
  emoji: string;
  description: string;
  colors: {
    primary: string;
    accent: string;
    background: string;
    card: string;
  };
  darkColors?: {
    background: string;
    card: string;
  };
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "default",
    name: "Default Gold",
    emoji: "⭐",
    description: "Classic neumorphic gold",
    colors: { primary: "#e6aa21", accent: "#e98f11", background: "#e2e7ef", card: "#ebeff5" },
  },
  {
    id: "eid-mubarak",
    name: "Eid Mubarak",
    emoji: "🕌",
    description: "পবিত্র ঈদের ডিজাইন",
    colors: { primary: "#1b8a4a", accent: "#d4a843", background: "#e8f0e4", card: "#f0f5ec" },
    darkColors: { background: "#0d1f14", card: "#132a1a" },
  },
  {
    id: "sakura",
    name: "Sakura Bloom",
    emoji: "🌸",
    description: "Cherry blossom pink",
    colors: { primary: "#e8598b", accent: "#f0a0c0", background: "#f5e8ef", card: "#faf0f4" },
    darkColors: { background: "#1a0f14", card: "#22141a" },
  },
  {
    id: "crimson-fire",
    name: "Crimson Fire",
    emoji: "🔥",
    description: "Bold red flame",
    colors: { primary: "#dc2626", accent: "#f97316", background: "#f0e5e5", card: "#f5eded" },
    darkColors: { background: "#1a0d0d", card: "#221414" },
  },
  {
    id: "ocean-blue",
    name: "Ocean Wave",
    emoji: "🌊",
    description: "Deep blue ocean",
    colors: { primary: "#2563eb", accent: "#06b6d4", background: "#e5eaf0", card: "#edf1f7" },
    darkColors: { background: "#0d111a", card: "#141822" },
  },
  {
    id: "amethyst",
    name: "Amethyst",
    emoji: "💜",
    description: "Royal purple crystal",
    colors: { primary: "#8b5cf6", accent: "#a78bfa", background: "#ede8f5", card: "#f3eff9" },
    darkColors: { background: "#130f1e", card: "#1a1426" },
  },
  {
    id: "forest-green",
    name: "Forest",
    emoji: "🌿",
    description: "Natural green forest",
    colors: { primary: "#16a34a", accent: "#22c55e", background: "#e4efe8", card: "#ecf5ef" },
    darkColors: { background: "#0d1a12", card: "#14221a" },
  },
  {
    id: "halloween",
    name: "Halloween",
    emoji: "🎃",
    description: "Spooky orange & dark",
    colors: { primary: "#f97316", accent: "#a855f7", background: "#f0e8e0", card: "#f5efe8" },
    darkColors: { background: "#1a120a", card: "#221a12" },
  },
  {
    id: "winter-snow",
    name: "Winter Snow",
    emoji: "❄️",
    description: "Icy cold blue",
    colors: { primary: "#38bdf8", accent: "#7dd3fc", background: "#e8eff5", card: "#f0f5fa" },
    darkColors: { background: "#0a1420", card: "#101c2a" },
  },
  {
    id: "sunset",
    name: "Sunset Glow",
    emoji: "🌅",
    description: "Warm sunset gradient",
    colors: { primary: "#f59e0b", accent: "#ef4444", background: "#f0e8e0", card: "#f5efe8" },
    darkColors: { background: "#1a140d", card: "#221c14" },
  },
  {
    id: "christmas",
    name: "Christmas",
    emoji: "🎄",
    description: "Festive red & green",
    colors: { primary: "#dc2626", accent: "#16a34a", background: "#f0e5e8", card: "#f5edef" },
    darkColors: { background: "#1a0d10", card: "#221416" },
  },
  {
    id: "midnight",
    name: "Midnight",
    emoji: "🌙",
    description: "Deep dark navy",
    colors: { primary: "#6366f1", accent: "#818cf8", background: "#e5e5f0", card: "#ededf5" },
    darkColors: { background: "#0a0a18", card: "#121220" },
  },
  {
    id: "chocolate",
    name: "Chocolate",
    emoji: "🍫",
    description: "Warm brown tones",
    colors: { primary: "#92400e", accent: "#b45309", background: "#f0e8e0", card: "#f5ede5" },
    darkColors: { background: "#1a140d", card: "#221a14" },
  },
  {
    id: "diamond",
    name: "Diamond",
    emoji: "💎",
    description: "Cyan & silver shine",
    colors: { primary: "#06b6d4", accent: "#22d3ee", background: "#e5f0f2", card: "#edf5f7" },
    darkColors: { background: "#0d1618", card: "#141e22" },
  },
  {
    id: "neon-cyber",
    name: "Neon Cyber",
    emoji: "🎵",
    description: "Cyberpunk neon",
    colors: { primary: "#ec4899", accent: "#06b6d4", background: "#f0e5ef", card: "#f5edf4" },
    darkColors: { background: "#1a0d18", card: "#221422" },
  },
  {
    id: "sunflower",
    name: "Sunflower",
    emoji: "🌻",
    description: "Bright yellow sunshine",
    colors: { primary: "#eab308", accent: "#facc15", background: "#f0ece0", card: "#f5f2e8" },
    darkColors: { background: "#1a180d", card: "#222014" },
  },
  {
    id: "grape",
    name: "Grape",
    emoji: "🍇",
    description: "Deep purple vine",
    colors: { primary: "#7c3aed", accent: "#9333ea", background: "#ede5f5", card: "#f3edf9" },
    darkColors: { background: "#140d1e", card: "#1c1428" },
  },
  {
    id: "lunar-year",
    name: "Lunar New Year",
    emoji: "🏮",
    description: "Lucky red & gold",
    colors: { primary: "#dc2626", accent: "#eab308", background: "#f0e5e5", card: "#f5eded" },
    darkColors: { background: "#1a0d0d", card: "#221414" },
  },
  {
    id: "rainbow",
    name: "Rainbow",
    emoji: "🌈",
    description: "Colorful joy",
    colors: { primary: "#e63946", accent: "#457b9d", background: "#f0e8ef", card: "#f5eff4" },
    darkColors: { background: "#1a0f18", card: "#221420" },
  },
  {
    id: "monochrome",
    name: "Monochrome",
    emoji: "🖤",
    description: "Clean black & white",
    colors: { primary: "#404040", accent: "#737373", background: "#e8e8e8", card: "#f0f0f0" },
    darkColors: { background: "#111111", card: "#1a1a1a" },
  },
];
