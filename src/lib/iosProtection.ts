// ============================================================
// iOS Protection gateway (client side)
// ============================================================
// Safari on iPhone / iPad refuses media whose MIME type is wrong, and it also
// refuses ".mkv" links even when the bytes inside are really MP4. The
// `ios-protection` function fixes both. This module resolves that route from
// EGD Router (settings/functionOverrides/ios-protection) and wraps playback
// URLs with it for EVERY video server — but ONLY on iOS, so Android and
// desktop playback paths stay exactly as they are today.

import { db, ref, onValue } from "@/lib/firebase";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

const CACHE_KEY = "rs_ios_protection_route_v1";

let cachedRoute = "";
let watcherStarted = false;

export const isIosDevice = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
};

const clean = (value: string) => String(value || "").trim().replace(/\/+$/, "");

const writeCache = (value: string) => {
  cachedRoute = clean(value);
  try {
    if (cachedRoute) localStorage.setItem(CACHE_KEY, cachedRoute);
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
};

export const getIosProtectionRoute = (): string => {
  if (cachedRoute) return cachedRoute;
  try {
    cachedRoute = clean(localStorage.getItem(CACHE_KEY) || "");
  } catch {}
  return cachedRoute;
};

export const refreshIosProtectionRoute = async (): Promise<string> => {
  const resolved = clean(await getEdgeFunctionUrl("ios-protection").catch(() => ""));
  writeCache(resolved);
  return resolved;
};

export const ensureIosProtectionWatcher = () => {
  if (watcherStarted || typeof window === "undefined") return;
  watcherStarted = true;
  getIosProtectionRoute();
  try {
    onValue(ref(db, "settings/functionOverrides/ios-protection"), (snap) => {
      const row = snap.val() || {};
      const url = row?.enabled === false ? "" : clean(String(row?.customUrl || row?.url || ""));
      writeCache(url);
    });
  } catch {}
  void refreshIosProtectionRoute();
};

const isAlreadyWrapped = (value: string, route: string) =>
  !!route && value.startsWith(route);

/**
 * Wrap a playback URL with the iOS Protection gateway.
 * Returns "" when the gateway is not configured or the url is not wrappable,
 * so callers can keep their existing candidate order untouched.
 */
export const wrapWithIosProtection = (mediaUrl: string): string => {
  ensureIosProtectionWatcher();
  const raw = String(mediaUrl || "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return "";
  const route = getIosProtectionRoute();
  if (!route) return "";
  if (isAlreadyWrapped(raw, route)) return raw;
  return `${route}?url=${encodeURIComponent(raw)}`;
};
