import { db, ref, onValue } from "@/lib/firebase";
import { getEdgeFunctionUrl, normalizeFunctionEndpointUrl } from "@/lib/edgeFunctionRouter";

const AN_PLAYBACK_CACHE_KEY = "rs_an_playback_route_v2";

let cachedAnPlaybackBase = "";
let watcherStarted = false;

const stripHlsEndpoint = (value: string) => String(value || "").trim().replace(/\/+$/, "").replace(/\/(?:hls)(?:\?.*)?$/i, "");

export const normalizeAnPlaybackBaseUrl = (value: string): string => {
  const normalized = normalizeFunctionEndpointUrl("an-playback", String(value || "").trim());
  return stripHlsEndpoint(normalized);
};

const readCachedRoute = () => {
  if (cachedAnPlaybackBase) return cachedAnPlaybackBase;
  try {
    cachedAnPlaybackBase = normalizeAnPlaybackBaseUrl(localStorage.getItem(AN_PLAYBACK_CACHE_KEY) || "");
  } catch {}
  return cachedAnPlaybackBase;
};

const writeCachedRoute = (value: string) => {
  cachedAnPlaybackBase = normalizeAnPlaybackBaseUrl(value);
  try {
    if (cachedAnPlaybackBase) localStorage.setItem(AN_PLAYBACK_CACHE_KEY, cachedAnPlaybackBase);
    else localStorage.removeItem(AN_PLAYBACK_CACHE_KEY);
  } catch {}
};

export const getCachedAnPlaybackHlsPrefix = () => {
  const base = readCachedRoute();
  if (base) {
    // Ensure the prefix always ends with /hls
    const normalized = base.replace(/\/+$/, "");
    return normalized.endsWith("/hls") ? normalized : `${normalized}/hls`;
  }
  
  // Hard enforcement: If no custom route is set, we return empty to prevent Supabase fallback.
  // The user explicitly requested to remove any "Supabase" traces when custom URL is missing.
  return "";
};

export const refreshAnPlaybackRoute = async (): Promise<string> => {
  const resolved = normalizeAnPlaybackBaseUrl(await getEdgeFunctionUrl("an-playback").catch(() => ""));
  writeCachedRoute(resolved);
  return resolved;
};

export const ensureAnPlaybackRouteWatcher = () => {
  if (watcherStarted || typeof window === "undefined") return;
  watcherStarted = true;
  readCachedRoute();
  try {
    onValue(ref(db, "settings/functionOverrides/an-playback"), (snap) => {
      const row = snap.val() || {};
      const url = row?.enabled === false ? "" : normalizeAnPlaybackBaseUrl(String(row?.customUrl || row?.url || ""));
      writeCachedRoute(url);
    });
  } catch {}
  void refreshAnPlaybackRoute();
};

const isAnPlaybackProxyPath = (pathname: string) => {
  const p = pathname.toLowerCase();
  return p.includes("/an-playback") || p.includes("/an-api") || p.endsWith("/hls");
};

export const wrapAnHlsPlaybackUrl = (value: string, explicitPrefix?: string): string => {
  ensureAnPlaybackRouteWatcher();
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("data:application/vnd.apple.mpegurl")) return raw;
  const prefix = explicitPrefix || getCachedAnPlaybackHlsPrefix();

  try {
    const parsed = new URL(raw);
    const srcParam = parsed.searchParams.get("src") || parsed.searchParams.get("url");
    const wrapped = isAnPlaybackProxyPath(parsed.pathname)
      ? (srcParam?.startsWith("http") ? srcParam : fromOpaqueUrlToken(srcParam || ""))
      : "";
    if (wrapped && prefix) {
      const params = new URLSearchParams({ src: toOpaqueUrlToken(wrapped) });
      const origin = parsed.searchParams.get("origin") || parsed.searchParams.get("parent") || parsed.searchParams.get("ref") || "";
      if (origin) params.set("origin", origin);
      return `${prefix}?${params.toString()}`;
    }
    if (wrapped) return raw;
  } catch {}

  if (/^https?:\/\//i.test(raw) && prefix) {
    return `${prefix}?src=${encodeURIComponent(toOpaqueUrlToken(raw))}`;
  }
  return raw;
};

export const toOpaqueUrlToken = (value: string) => {
  try {
    return btoa(unescape(encodeURIComponent(String(value || ""))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  } catch {
    return "";
  }
};

export const fromOpaqueUrlToken = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return "";
  }
};