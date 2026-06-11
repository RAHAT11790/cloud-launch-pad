export type LocalAuthUser = {
  id?: string;
  name?: string;
  email?: string;
};

export const PROFILE_PHOTO_KEY = "rs_profile_photo";
export const DISPLAY_NAME_KEY = "rs_display_name";

export const getLocalAuthUser = (): LocalAuthUser | null => {
  try {
    const raw = localStorage.getItem("rsanime_user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
};

export const buildEmailAliasKey = (email?: string | null) =>
  String(email || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, ",")
    .replace(/[^a-z0-9@,_-]/g, "_");

export const buildScopedLocalKey = (baseKey: string, userId?: string | null) =>
  userId ? `${baseKey}_${userId}` : baseKey;

export const readScopedLocalValue = (baseKey: string, userId?: string | null): string | null => {
  try {
    if (userId) {
      return localStorage.getItem(buildScopedLocalKey(baseKey, userId));
    }
    return localStorage.getItem(baseKey);
  } catch {
    return null;
  }
};

export const writeScopedLocalValue = (baseKey: string, value: string, userId?: string | null) => {
  try {
    if (userId) {
      localStorage.setItem(buildScopedLocalKey(baseKey, userId), value);
    }
    localStorage.setItem(baseKey, value);
  } catch {}
};

export const removeScopedLocalValue = (baseKey: string, userId?: string | null) => {
  try {
    if (userId) {
      localStorage.removeItem(buildScopedLocalKey(baseKey, userId));
    }
    localStorage.removeItem(baseKey);
  } catch {}
};

export const clearActiveLocalValue = (baseKey: string) => {
  try {
    localStorage.removeItem(baseKey);
  } catch {}
};

export const readProfilePhoto = (userId?: string | null) => readScopedLocalValue(PROFILE_PHOTO_KEY, userId);
export const writeProfilePhoto = (value: string, userId?: string | null) => writeScopedLocalValue(PROFILE_PHOTO_KEY, value, userId);
export const clearActiveProfilePhoto = () => clearActiveLocalValue(PROFILE_PHOTO_KEY);
export const removeProfilePhoto = (userId?: string | null) => removeScopedLocalValue(PROFILE_PHOTO_KEY, userId);

export const readDisplayName = (userId?: string | null) => readScopedLocalValue(DISPLAY_NAME_KEY, userId);
export const writeDisplayName = (value: string, userId?: string | null) => writeScopedLocalValue(DISPLAY_NAME_KEY, value, userId);
export const clearActiveDisplayName = () => clearActiveLocalValue(DISPLAY_NAME_KEY);
export const removeDisplayName = (userId?: string | null) => removeScopedLocalValue(DISPLAY_NAME_KEY, userId);