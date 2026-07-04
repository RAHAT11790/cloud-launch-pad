export const readPersistentCache = <T,>(key: string, fallback: T): T => {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const writePersistentCache = (key: string, value: unknown) => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

export const sameJson = (a: unknown, b: unknown) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

export const updateCachedState = <T,>(
  setter: (updater: (previous: T) => T) => void,
  cacheKey: string,
  next: T,
) => {
  setter((previous) => {
    if (sameJson(previous, next)) return previous;
    writePersistentCache(cacheKey, next);
    return next;
  });
};