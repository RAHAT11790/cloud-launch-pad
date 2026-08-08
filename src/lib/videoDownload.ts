import { toast } from "sonner";
import { isInTelegramWebView, openExternalBrowser } from "@/lib/openExternal";
import { db, ref, onValue } from "@/lib/firebase";
import { normalizeFunctionEndpointUrl } from "@/lib/edgeFunctionRouter";
import { fromOpaqueUrlToken, toOpaqueUrlToken } from "@/lib/anPlaybackProxy";

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const isManagedVideoDownloadUrl = (value: string) => {
  const raw = String(value || "").trim();
  if (/\/functions\/v1\/video-download(?:[/?#]|$)/i.test(raw)) return true;
  try {
    const parsed = new URL(raw);
    const hasTarget = parsed.searchParams.has("url") || parsed.searchParams.has("src");
    if (!hasTarget) return false;
    if (/(^|[.-])video-download([.-]|$)/i.test(parsed.hostname)) return true;
    const configuredBases = [overrideBaseUrl]
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    return configuredBases.some((entry) => {
      try {
        const base = new URL(entry);
        return parsed.origin === base.origin
          && parsed.pathname.replace(/\/+$/, "") === base.pathname.replace(/\/+$/, "");
      } catch { return false; }
    });
  } catch {
    return false;
  }
};
const isManagedVideoProxyUrl = (value: string) => /\/functions\/v1\/video-proxy(?:[/?#]|$)/i.test(String(value || ""));

const buildSafeFileName = (rawName: string) => {
  const cleaned = String(rawName || "video")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withExt = /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
  return withExt || "video.mp4";
};

let overrideBaseUrl = "";
let overrideEnabled = false;
let overrideIsAdmin = false; // true only when a Cloudflare/self-hosted admin override is active
let playbackProxyBaseUrl = "";
let playbackProxyEnabled = false;
let playbackProxyIsAdmin = false;
let downloadOverrideRaw: any = null;
let proxyOverrideRaw: any = null;

const DL_ROUTE_CACHE_KEY = "rs_video_download_route_v3";
const DL_ROUTE_ADMIN_FLAG = "rs_video_download_route_admin_v2";
const PROXY_ROUTE_CACHE_KEY = "rs_video_proxy_route_v3";
const PROXY_ROUTE_ADMIN_FLAG = "rs_video_proxy_route_admin_v2";
const VIDEO_SERVERS_CACHE_KEY = "rs_video_servers_cache_v2";

try {
  if (typeof window !== "undefined") {
    const cachedDownload = localStorage.getItem(DL_ROUTE_CACHE_KEY) || "";
    const cachedProxy = localStorage.getItem(PROXY_ROUTE_CACHE_KEY) || "";
    if (/^https?:\/\//i.test(cachedDownload)) {
      overrideBaseUrl = normalizeFunctionEndpointUrl("video-download", cachedDownload);
      overrideEnabled = true;
      overrideIsAdmin = localStorage.getItem(DL_ROUTE_ADMIN_FLAG) === "1";
    }
    if (/^https?:\/\//i.test(cachedProxy)) {
      playbackProxyBaseUrl = normalizeFunctionEndpointUrl("video-proxy", cachedProxy);
      playbackProxyEnabled = true;
      playbackProxyIsAdmin = localStorage.getItem(PROXY_ROUTE_ADMIN_FLAG) === "1";
    }
  }
} catch {}

const applyDownloadRoute = () => {
  const overrideUrl = normalizeFunctionEndpointUrl("video-download", String(downloadOverrideRaw?.customUrl || downloadOverrideRaw?.url || "").trim());
  const adminEnabled = Boolean(overrideUrl) && downloadOverrideRaw?.enabled !== false;
  const adminUrl = adminEnabled ? overrideUrl : "";
  overrideBaseUrl = adminUrl;
  overrideEnabled = Boolean(overrideBaseUrl);
  overrideIsAdmin = Boolean(adminUrl);
  try {
    if (overrideBaseUrl) localStorage.setItem(DL_ROUTE_CACHE_KEY, overrideBaseUrl);
    localStorage.setItem(DL_ROUTE_ADMIN_FLAG, overrideIsAdmin ? "1" : "0");
  } catch {}
};

const applyProxyRoute = () => {
  const overrideUrl = normalizeFunctionEndpointUrl("video-proxy", String(proxyOverrideRaw?.customUrl || proxyOverrideRaw?.url || "").trim());
  const adminEnabled = Boolean(overrideUrl) && proxyOverrideRaw?.enabled !== false;
  const adminUrl = adminEnabled ? overrideUrl : "";
  playbackProxyBaseUrl = adminUrl;
  playbackProxyEnabled = Boolean(playbackProxyBaseUrl);
  playbackProxyIsAdmin = Boolean(adminUrl);
  try {
    if (playbackProxyBaseUrl) localStorage.setItem(PROXY_ROUTE_CACHE_KEY, playbackProxyBaseUrl);
    localStorage.setItem(PROXY_ROUTE_ADMIN_FLAG, playbackProxyIsAdmin ? "1" : "0");
  } catch {}
};
try {
  if (typeof window !== "undefined") {
    onValue(ref(db, "settings/functionOverrides/video-download"), (snap) => {
      downloadOverrideRaw = snap.val() || {};
      applyDownloadRoute();
    });
    onValue(ref(db, "settings/functionOverrides/video-proxy"), (snap) => {
      proxyOverrideRaw = snap.val() || {};
      applyProxyRoute();
    });
  }
} catch {}

const unique = (items: string[]) => Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const readServerMirrorUrls = (rawUrl: string): string[] => {
  if (typeof window === "undefined") return [];
  const source = String(rawUrl || "").trim();
  if (!isHttpUrl(source)) return [];
  try {
    const parsed = new URL(source);
    const servers = JSON.parse(localStorage.getItem(VIDEO_SERVERS_CACHE_KEY) || "[]");
    const domains = Array.isArray(servers)
      ? servers.map((server: any) => String(server?.domain || "").trim().replace(/\/+$/, ""))
      : [];
    return unique(domains.map((domain) => {
      if (!isHttpUrl(domain)) return "";
      return `${domain}${parsed.pathname}${parsed.search}${parsed.hash}`;
    })).filter((url) => url !== source);
  } catch {
    return [];
  }
};

const pickUrlParam = (params: URLSearchParams) => {
  const directKeys = ["url", "source", "target", "u"];
  for (const key of directKeys) {
    const value = String(params.get(key) || "").trim();
    if (isHttpUrl(value)) return value;
  }

  const src = String(params.get("src") || "").trim();
  if (!src) return "";
  const decoded = fromOpaqueUrlToken(src);
  if (isHttpUrl(decoded)) return decoded;
  return isHttpUrl(src) ? src : "";
};

const pickUrlParams = (params: URLSearchParams) => {
  const values: string[] = [];
  const push = (value: string | null) => {
    const raw = String(value || "").trim();
    if (isHttpUrl(raw)) values.push(raw);
  };
  const pushToken = (value: string | null) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    const decoded = fromOpaqueUrlToken(raw);
    push(decoded || raw);
  };

  ["url", "source", "target", "u"].forEach((key) => push(params.get(key)));
  pushToken(params.get("src"));
  ["alt", "fallback", "mirror"].forEach((key) => params.getAll(key).forEach(push));
  ["altSrc", "fallbackSrc", "mirrorSrc"].forEach((key) => params.getAll(key).forEach(pushToken));
  for (let i = 2; i <= 10; i += 1) {
    push(params.get(`url${i}`));
    pushToken(params.get(`src${i}`));
  }
  return unique(values);
};

const unwrapProxyTarget = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    return pickUrlParam(new URL(trimmed).searchParams);
  } catch {
    return "";
  }
};

const unwrapProxyTargets = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return [];
  try {
    return pickUrlParams(new URL(trimmed).searchParams);
  } catch {
    return [];
  }
};

const buildDownloadProxyUrl = (base: string, rawUrl: string, rawFileName: string, fallbackUrls: string[] = []) => {
  const trimmedBase = String(base || "").trim().replace(/\/+$/, "");
  if (!trimmedBase) return "";
  const trimmedRaw = String(rawUrl || "").trim();
  if (!trimmedRaw || !isHttpUrl(trimmedRaw)) return "";
  const token = toOpaqueUrlToken(trimmedRaw);
  if (!token) return "";
  const fileName = buildSafeFileName(rawFileName);
  const params = new URLSearchParams();
  // Keep both params for live deployments during rollout:
  // - url: older RS/EGD download workers require this exact parameter.
  // - src: newer hardened workers prefer opaque tokens.
  params.set("filename", fileName);
  params.set("url", trimmedRaw);
  params.set("src", token);
  unique(fallbackUrls)
    .filter((url) => isHttpUrl(url) && url !== trimmedRaw)
    .slice(0, 8)
    .forEach((url) => params.append("alt", url));
  return `${trimmedBase}?${params.toString()}`;
};

const buildPlaybackProxyUrl = (base: string, rawUrl: string) => {
  const trimmedBase = String(base || "").trim().replace(/\/+$/, "");
  if (!trimmedBase) return "";
  if (/\.workers\.dev(?:\/)?$/i.test(trimmedBase.replace(/\?.*$/, ""))) {
    return `${trimmedBase}?url=${encodeURIComponent(rawUrl)}`;
  }
  return `${trimmedBase}?src=${encodeURIComponent(toOpaqueUrlToken(rawUrl))}`;
};

export function buildVideoDownloadUrlCandidates(rawUrl: string, rawFileName: string, fallbackUrls: string[] = []): string[] {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) return [];
  if (isManagedVideoProxyUrl(trimmedUrl) || isManagedVideoDownloadUrl(trimmedUrl)) {
    const targets = unwrapProxyTargets(trimmedUrl);
    const inner = targets[0] || "";
    if (!inner) return [];
    const rebuilt = buildVideoDownloadUrlCandidates(inner, rawFileName, unique([...targets.slice(1), ...fallbackUrls]));
    return unique([...rebuilt, trimmedUrl]);
  }

  const bases = unique([overrideBaseUrl].filter(Boolean) as string[]);
  const mirrorUrls = unique([...fallbackUrls, ...readServerMirrorUrls(trimmedUrl)]);
  const proxied = bases.map((base) => buildDownloadProxyUrl(base, trimmedUrl, rawFileName, mirrorUrls));

  // Every Firebase/admin-stored media link should go through the download
  // proxy first so HTTP sources work inside the HTTPS/PWA app and filename
  // renaming is controlled by Content-Disposition. Raw HTTPS is only a final
  // fallback; raw HTTP is never handed back to the browser from the web app.
  return unique([
    ...proxied,
    /^https:\/\//i.test(trimmedUrl) ? trimmedUrl : "",
  ]);
}

export function buildVideoProxyUrlCandidates(rawUrl: string): string[] {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) return [];
  // Playback proxy is only for insecure http:// media rescue. HTTPS media hosts
  // must stay direct in the browser/video tag and must not be routed through
  // video-proxy for probing/download fallback.
  if (!/^http:\/\//i.test(trimmedUrl)) return [];
  if (isManagedVideoProxyUrl(trimmedUrl)) return [trimmedUrl];
  if (isManagedVideoDownloadUrl(trimmedUrl)) {
    const inner = unwrapProxyTarget(trimmedUrl);
    if (inner) return buildVideoProxyUrlCandidates(inner);
    return [];
  }
  const bases = playbackProxyEnabled && playbackProxyBaseUrl ? [playbackProxyBaseUrl] : [];
  return unique(bases.map((base) => buildPlaybackProxyUrl(base, trimmedUrl)));
}

export function buildVideoDownloadUrl(rawUrl: string, rawFileName: string, fallbackUrls: string[] = []): string | null {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) return null;
  if (isManagedVideoDownloadUrl(trimmedUrl)) {
    const targets = unwrapProxyTargets(trimmedUrl);
    const inner = targets[0] || "";
    if (!inner) return null;
    return buildVideoDownloadUrlCandidates(inner, rawFileName, unique([...targets.slice(1), ...fallbackUrls]))[0] || trimmedUrl;
  }
  if (isManagedVideoProxyUrl(trimmedUrl)) {
    const targets = unwrapProxyTargets(trimmedUrl);
    const inner = targets[0] || "";
    if (inner) return buildVideoDownloadUrl(inner, rawFileName, unique([...targets.slice(1), ...fallbackUrls]));
    return null;
  }
  return buildVideoDownloadUrlCandidates(trimmedUrl, rawFileName, fallbackUrls)[0] || null;
}

export function unwrapManagedVideoUrl(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (isManagedVideoDownloadUrl(trimmed) || isManagedVideoProxyUrl(trimmed)) {
    return unwrapProxyTarget(trimmed) || "";
  }
  return trimmed;
}

export function buildDirectDownloadUrl(rawUrl: string): string | null {
  const trimmedUrl = unwrapManagedVideoUrl(rawUrl);
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) return null;
  return trimmedUrl;
}

function openDownloadLink(finalUrl: string, fileName: string) {
  if (isInTelegramWebView()) { openExternalBrowser(finalUrl); return; }
  // Use a same-document iframe navigation so attachment responses go straight
  // to the browser/PWA download manager instead of opening a JSON/error tab.
  const frame = document.createElement("iframe");
  frame.src = finalUrl;
  frame.title = `Download ${fileName}`;
  frame.style.position = "fixed";
  frame.style.left = "-9999px";
  frame.style.top = "-9999px";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.opacity = "0";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);
  window.setTimeout(() => {
    try { frame.remove(); } catch {}
  }, 60_000);
}



export function triggerBackgroundVideoDownload(rawUrl: string, rawFileName: string, fallbackUrls: string[] = []): boolean {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) {
    toast.error("Download link is invalid");
    return false;
  }
  const fileName = buildSafeFileName(rawFileName);
  const proxiedUrls = isManagedVideoDownloadUrl(trimmedUrl)
    ? [trimmedUrl]
    : buildVideoDownloadUrlCandidates(trimmedUrl, fileName, fallbackUrls);
  const finalUrl = proxiedUrls[0] || null;
  if (!finalUrl) {
    toast.error("Download service is unavailable");
    return false;
  }
  openDownloadLink(finalUrl, fileName);
  return true;
}

export function triggerBulkBackgroundDownloads(
  items: Array<{ url: string; fileName: string; fallbackUrls?: string[] }>,
): number {
  if (!Array.isArray(items) || items.length === 0) return 0;

  const valid = items
    .map((it) => {
      const u = String(it?.url || "").trim();
      if (!u || !isHttpUrl(u)) return null;
      const fn = buildSafeFileName(it?.fileName || "video");
      const fallbacks = Array.isArray(it?.fallbackUrls) ? it.fallbackUrls : [];
      const proxied = buildVideoDownloadUrlCandidates(u, fn, fallbacks)[0] || buildVideoDownloadUrl(u, fn, fallbacks);
      return proxied ? { final: proxied, fn } : null;
    })
    .filter((x): x is { final: string; fn: string } => !!x);

  if (valid.length === 0) {
    toast.error("No downloadable links found");
    return 0;
  }

  // Fire every download as a real anchor click, all in one synchronous batch
  // from the user's gesture. Browser's native downloader handles the queue —
  // user can pause/resume individually from the browser's download tray.
  valid.forEach((entry) => openDownloadLink(entry.final, entry.fn));

  return valid.length;
}


