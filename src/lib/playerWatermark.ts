/** The RS ANIME03 corner watermark shows only to free users; premium never sees it
 *  (and nothing shows while premium status is still loading). */
export const showPlayerWatermark = (isPremium: boolean | null): boolean => isPremium === false;
