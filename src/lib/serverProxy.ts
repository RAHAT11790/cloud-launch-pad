// ============================================================
// Per-server proxy resolver
// ============================================================
// Every video server configured in Admin → Video Servers can carry its OWN
// proxy URL. A single shared proxy (the old EGD Router `video-proxy` route)
// became a bottleneck: all HTTP mirrors funnelled through one worker, so the
// worker — not the mirrors — decided how many viewers could watch at once.
//
// Rule now:
//   * server.proxy set   → that server plays ONLY through that proxy
//   * server.proxy empty → the server plays direct (HTTPS servers)
// There is no global fallback proxy anywhere in the app.

export interface ProxyServerEntry {
  name?: string;
  domain: string;
  proxy?: string;
  locked?: boolean;
}

export const VIDEO_SERVERS_CACHE_KEY = "rs_video_servers_cache_v2";

const hostOf = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).host.toLowerCase();
  } catch {
    return "";
  }
};

export const normalizeProxyServers = (val: unknown): ProxyServerEntry[] => {
  let list: any[] = [];
  if (Array.isArray(val)) list = val;
  else if (val && typeof val === "object") list = Object.values(val as any);
  return list
    .filter((s: any) => s && s.domain)
    .map((s: any) => ({
      name: String(s.name || "").trim(),
      domain: String(s.domain || "").trim(),
      proxy: String(s.proxy || "").trim(),
      locked: !!s.locked,
    }))
    .filter((s) => !!s.domain);
};

export const readCachedProxyServers = (): ProxyServerEntry[] => {
  try {
    if (typeof localStorage === "undefined") return [];
    return normalizeProxyServers(JSON.parse(localStorage.getItem(VIDEO_SERVERS_CACHE_KEY) || "[]"));
  } catch {
    return [];
  }
};

/**
 * Find the proxy configured for the server that owns `mediaUrl`.
 * Matching is by host so it works no matter which path/quality is playing.
 */
export const resolveServerProxyForUrl = (
  mediaUrl: string,
  servers?: ProxyServerEntry[] | null,
): string => {
  const host = hostOf(mediaUrl);
  if (!host) return "";
  const list = servers?.length ? servers : readCachedProxyServers();
  const match = list.find((server) => hostOf(server.domain) === host);
  return match?.proxy || "";
};

/** Build the playback URL for a given proxy base. */
export const buildServerProxyUrl = (
  proxyBase: string,
  targetUrl: string,
  encodeToken?: (value: string) => string,
): string => {
  const base = String(proxyBase || "").trim();
  const target = String(targetUrl || "").trim();
  if (!base || !target) return target;
  const encoded = encodeURIComponent(target);
  if (base.includes("{url}")) return base.split("{url}").join(encoded);
  const clean = base.replace(/\/+$/, "");
  if (/\?$/.test(base) || /[?&]url=$/.test(base)) return `${base}${encoded}`;
  // Cloudflare Worker proxies (the recommended deployment) accept `?url=`.
  if (/\.workers\.dev$/i.test(clean.replace(/^https?:\/\//i, "").split("/")[0] || "")) {
    return `${clean}?url=${encoded}`;
  }
  if (encodeToken) return `${clean}?src=${encodeURIComponent(encodeToken(target))}`;
  return `${clean}?url=${encoded}`;
};
