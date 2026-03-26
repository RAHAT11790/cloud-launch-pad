export interface UiThemeConfig {
  primary: string;
  accent: string;
  background: string;
  card: string;
}

export const UI_THEME_STORAGE_KEY = "rs_ui_theme_custom";

export const DEFAULT_UI_THEME: UiThemeConfig = {
  primary: "#e6aa21",
  accent: "#e98f11",
  background: "#e2e7ef",
  card: "#ebeff5",
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const hexToRgb = (hex: string) => {
  const value = hex.replace("#", "").trim();
  if (![3, 6].includes(value.length)) return null;
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const int = parseInt(full, 16);
  if (Number.isNaN(int)) return null;
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
};

const rgbToHsl = ({ r, g, b }: { r: number; g: number; b: number }) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  if (delta !== 0) {
    switch (max) {
      case rn:
        h = 60 * (((gn - bn) / delta) % 6);
        break;
      case gn:
        h = 60 * ((bn - rn) / delta + 2);
        break;
      default:
        h = 60 * ((rn - gn) / delta + 4);
        break;
    }
  }

  const normalizedH = h < 0 ? h + 360 : h;
  return {
    h: Math.round(normalizedH),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
};

const toTriplet = (hex: string, fallback: string) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  const hsl = rgbToHsl(rgb);
  return `${hsl.h} ${hsl.s}% ${hsl.l}%`;
};

const shiftLightness = (triplet: string, delta: number) => {
  const [hRaw, sRaw, lRaw] = triplet.split(" ");
  const h = Number(hRaw);
  const s = Number(sRaw.replace("%", ""));
  const l = Number(lRaw.replace("%", ""));
  if ([h, s, l].some((v) => Number.isNaN(v))) return triplet;
  return `${h} ${clamp(s, 0, 100)}% ${clamp(l + delta, 2, 98)}%`;
};

const getForegroundTriplet = (hex: string) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return "220 25% 12%";
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.6 ? "220 25% 12%" : "0 0% 100%";
};

const setVar = (name: string, value: string) => {
  document.documentElement.style.setProperty(name, value);
};

export const applyCustomUiTheme = (config: UiThemeConfig | null) => {
  if (typeof window === "undefined") return;

  const managedVars = [
    "--primary",
    "--primary-dark",
    "--primary-foreground",
    "--accent",
    "--accent-foreground",
    "--ring",
    "--background",
    "--card",
    "--popover",
    "--secondary",
    "--muted",
    "--border",
    "--input",
    "--sidebar-background",
    "--sidebar-accent",
  ];

  if (!config) {
    managedVars.forEach((key) => document.documentElement.style.removeProperty(key));
    return;
  }

  const primary = toTriplet(config.primary, "42 80% 50%");
  const accent = toTriplet(config.accent, "38 90% 48%");
  const background = toTriplet(config.background, "220 15% 90%");
  const card = toTriplet(config.card, "220 15% 92%");

  setVar("--primary", primary);
  setVar("--primary-dark", shiftLightness(primary, -10));
  setVar("--primary-foreground", getForegroundTriplet(config.primary));
  setVar("--accent", accent);
  setVar("--accent-foreground", getForegroundTriplet(config.accent));
  setVar("--ring", primary);

  setVar("--background", background);
  setVar("--card", card);
  setVar("--popover", shiftLightness(card, -1));
  setVar("--secondary", shiftLightness(background, -4));
  setVar("--muted", shiftLightness(background, -7));
  setVar("--border", shiftLightness(background, -9));
  setVar("--input", shiftLightness(background, -6));

  setVar("--sidebar-background", background);
  setVar("--sidebar-accent", shiftLightness(background, -4));
};

export const getStoredUiTheme = (): UiThemeConfig | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(UI_THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.primary || !parsed?.accent || !parsed?.background || !parsed?.card) return null;
    return parsed as UiThemeConfig;
  } catch {
    return null;
  }
};

export const saveUiTheme = (config: UiThemeConfig) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(UI_THEME_STORAGE_KEY, JSON.stringify(config));
  applyCustomUiTheme(config);
};

export const clearUiTheme = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(UI_THEME_STORAGE_KEY);
  applyCustomUiTheme(null);
};

export const initializeUiTheme = () => {
  if (typeof window === "undefined") return;
  applyCustomUiTheme(getStoredUiTheme());
};

/** Apply a theme preset by its colors config */
export const applyThemePresetColors = (colors: UiThemeConfig) => {
  saveUiTheme(colors);
};
