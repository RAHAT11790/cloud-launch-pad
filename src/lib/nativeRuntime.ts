// Native (Capacitor / Android) runtime helpers.
// The same codebase powers the website and the RS ANIME03 Android app; every
// native-only behaviour is gated behind these helpers so the web build is
// completely unchanged.

let cachedNative: boolean | null = null;

export const isNativeApp = (): boolean => {
  if (cachedNative !== null) return cachedNative;
  try {
    const cap = (globalThis as any)?.Capacitor;
    cachedNative = Boolean(cap?.isNativePlatform?.() ?? cap?.isNative);
  } catch {
    cachedNative = false;
  }
  return cachedNative;
};

export const nativePlatform = (): string => {
  try {
    return String((globalThis as any)?.Capacitor?.getPlatform?.() || "web");
  } catch {
    return "web";
  }
};

export const isAndroidApp = () => isNativeApp() && nativePlatform() === "android";

/**
 * Inside the Android app there is no mixed-content restriction and no rename
 * problem, so http:// media plays and downloads straight from the source.
 */
export const allowsDirectInsecureMedia = () => isNativeApp();
