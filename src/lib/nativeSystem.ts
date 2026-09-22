// Bridge to the RS ANIME03 native Android plugin (RsNative):
// immersive fullscreen, REAL system volume, REAL screen brightness and
// orientation locking. Every call is a safe no-op on the web build.
import { isNativeApp } from "@/lib/nativeRuntime";

type RsNative = {
  immersive(): Promise<void>;
  getVolume(): Promise<{ value: number }>;
  setVolume(o: { value: number }): Promise<{ value: number }>;
  getBrightness(): Promise<{ value: number }>;
  setBrightness(o: { value: number }): Promise<{ value: number }>;
  lockLandscape(): Promise<void>;
  lockPortrait(): Promise<void>;
  unlockOrientation(): Promise<void>;
};

const plugin = (): RsNative | null => {
  try {
    const p = (globalThis as any)?.Capacitor?.Plugins?.RsNative;
    return p && isNativeApp() ? (p as RsNative) : null;
  } catch {
    return null;
  }
};

export const nativeSystemAvailable = () => Boolean(plugin());

export const applyImmersive = () => { void plugin()?.immersive().catch(() => {}); };

export const getSystemVolume = async (): Promise<number | null> => {
  try { return (await plugin()?.getVolume())?.value ?? null; } catch { return null; }
};

export const setSystemVolume = async (value: number): Promise<number | null> => {
  try { return (await plugin()?.setVolume({ value }))?.value ?? null; } catch { return null; }
};

export const getSystemBrightness = async (): Promise<number | null> => {
  try { return (await plugin()?.getBrightness())?.value ?? null; } catch { return null; }
};

export const setSystemBrightness = async (value: number): Promise<number | null> => {
  try { return (await plugin()?.setBrightness({ value }))?.value ?? null; } catch { return null; }
};

export const lockLandscape = () => { void plugin()?.lockLandscape().catch(() => {}); };
export const unlockOrientation = () => { void plugin()?.unlockOrientation().catch(() => {}); };
