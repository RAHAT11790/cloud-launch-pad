/** Player corner watermark — admin settings in Firebase `settings/playerWatermark`. */
export interface WatermarkSettings {
  enabled: boolean;
  /** Empty = the site logo. */
  logoUrl: string;
  /** Logo size in px (normal player); fullscreen is 1.3×. */
  size: number;
  /** 0.05 – 1 */
  opacity: number;
  /** 0.3 – 2 (1 = normal) */
  brightness: number;
  showText: boolean;
  text: string;
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: true, logoUrl: "", size: 26, opacity: 0.42, brightness: 1, showText: true, text: "RS ANIME03",
};

const clamp = (v: unknown, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

export function normalizeWatermark(raw: any): WatermarkSettings {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: s.enabled !== false,
    logoUrl: typeof s.logoUrl === "string" ? s.logoUrl : "",
    size: clamp(s.size, DEFAULT_WATERMARK.size, 14, 80),
    opacity: clamp(s.opacity, DEFAULT_WATERMARK.opacity, 0.05, 1),
    brightness: clamp(s.brightness, DEFAULT_WATERMARK.brightness, 0.3, 2),
    showText: s.showText !== false,
    text: typeof s.text === "string" ? s.text.slice(0, 24) : DEFAULT_WATERMARK.text,
  };
}

/** The corner watermark shows only to free users, only while the admin has it on;
 *  premium never sees it (and nothing shows while premium status is still loading). */
export const showPlayerWatermark = (isPremium: boolean | null, enabled = true): boolean => enabled && isPremium === false;
