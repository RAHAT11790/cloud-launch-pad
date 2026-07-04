import { toast } from "sonner";
import { isInTelegramWebView, openExternalBrowser } from "@/lib/openExternal";
import { db, ref, onValue } from "@/lib/firebase";
import { buildSelfHostedFunctionUrl, normalizeFunctionEndpointUrl } from "@/lib/edgeFunctionRouter";
import { fromOpaqueUrlToken, toOpaqueUrlToken } from "@/lib/anPlaybackProxy";

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const isManagedVideoDownloadUrl = (value: string) => /\/functions\/v1\/video-download(?:[/?#]|$)/i.test(String(value || ""));
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
let playbackProxyBaseUrl = "";
let playbackProxyEnabled = false;
let routerBaseUrl = "";
let downloadOverrideRaw: any = null;
let proxyOverrideRaw: any = null;

const applyDownloadRoute = () => {
  const overrideUrl = normalizeFunctionEndpointUrl("video-download", String(downloadOverrideRaw?.customUrl || downloadOverrideRaw?.url || "").trim());
  const selfHosted = buildSelfHostedFunctionUrl("video-download", routerBaseUrl);
  const enabled = Boolean(overrideUrl) && downloadOverrideRaw?.enabled !== false;
  overrideBaseUrl = enabled ? overrideUrl : selfHosted;
  overrideEnabled = Boolean(overrideBaseUrl);
};

const applyProxyRoute = () => {
  const overrideUrl = normalizeFunctionEndpointUrl("video-proxy", String(proxyOverrideRaw?.customUrl || proxyOverrideRaw?.url || "").trim());
  const selfHosted = buildSelfHostedFunctionUrl("video-proxy", routerBaseUrl);
  const enabled = Boolean(overrideUrl) && proxyOverrideRaw?.enabled !== false;
  playbackProxyBaseUrl = enabled ? overrideUrl : selfHosted;
  playbackProxyEnabled = Boolean(playbackProxyBaseUrl);
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
    onValue(ref(db, "settings/edgeRouter"), (snap) => {
      const v = snap.val() || {};
      routerBaseUrl = String(v.cloudflareBaseUrl || v.denoBaseUrl || "").trim();
      applyDownloadRoute();
      applyProxyRoute();
    });
  }
} catch {}

const unique = (items: string[]) => Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

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

const unwrapProxyTarget = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    return pickUrlParam(new URL(trimmed).searchParams);
  } catch {
    return "";
  }
};

const buildDownloadProxyUrl = (base: string, rawUrl: string, rawFileName: string) => {
  const trimmedBase = String(base || "").trim().replace(/\/+$/, "");
  if (!trimmedBase) return "";
  const trimmedRaw = String(rawUrl || "").trim();
  if (!trimmedRaw || !isHttpUrl(trimmedRaw)) return "";
  const token = toOpaqueUrlToken(trimmedRaw);
  if (!token) return "";
  const fileName = buildSafeFileName(rawFileName);
  // Keep both params for live deployments during rollout:
  // - url: older RS/EGD download workers require this exact parameter.
  // - src: newer hardened workers prefer opaque tokens.
  return `${trimmedBase}?filename=${encodeURIComponent(fileName)}&url=${encodeURIComponent(trimmedRaw)}&src=${encodeURIComponent(token)}`;
};

const buildPlaybackProxyUrl = (base: string, rawUrl: string) => {
  const trimmedBase = String(base || "").trim().replace(/\/+$/, "");
  if (!trimmedBase) return "";
  if (/\.workers\.dev(?:\/)?$/i.test(trimmedBase.replace(/\?.*$/, ""))) {
    return `${trimmedBase}?url=${encodeURIComponent(rawUrl)}`;
  }
  return `${trimmedBase}?src=${encodeURIComponent(toOpaqueUrlToken(rawUrl))}`;
};

export function buildVideoDownloadUrlCandidates(rawUrl: string, rawFileName: string): string[] {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) return [];
  if (isManagedVideoProxyUrl(trimmedUrl) || isManagedVideoDownloadUrl(trimmedUrl)) {
    const inner = unwrapProxyTarget(trimmedUrl);
    if (!inner) return [];
    const rebuilt = buildVideoDownloadUrlCandidates(inner, rawFileName);
    return unique([...rebuilt, trimmedUrl]);
  }

  if (/^https:\/\//i.test(trimmedUrl)) return [trimmedUrl];

  const bases = overrideEnabled && overrideBaseUrl ? [overrideBaseUrl] : [];
  return unique([
    ...bases.map((base) => buildDownloadProxyUrl(base, trimmedUrl, rawFileName)),
    trimmedUrl,
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

export function buildVideoDownloadUrl(rawUrl: string, rawFileName: string): string | null {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) return null;
  if (isManagedVideoDownloadUrl(trimmedUrl)) {
    const inner = unwrapProxyTarget(trimmedUrl);
    if (!inner) return null;
    return buildVideoDownloadUrlCandidates(inner, rawFileName)[0] || trimmedUrl;
  }
  if (isManagedVideoProxyUrl(trimmedUrl)) {
    const inner = unwrapProxyTarget(trimmedUrl);
    if (inner) return buildVideoDownloadUrl(inner, rawFileName);
    return null;
  }
  return buildVideoDownloadUrlCandidates(trimmedUrl, rawFileName)[0] || null;
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
  const link = document.createElement("a");
  link.href = finalUrl;
  link.rel = "noopener noreferrer";
  // A visible browser navigation/download is more reliable for cross-origin
  // file hosts than a hidden async fetch. Keep the target blank so pop-up/file
  // download handling stays tied to the user's gesture.
  link.target = "_blank";
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Hidden iframe fallback — used for bulk downloads so we don't trip the
// browser's "multiple popup" blocker. The proxy's Content-Disposition:
// attachment header still forces the browser's native downloader.
function openDownloadViaIframe(finalUrl: string) {
  if (isInTelegramWebView()) { openExternalBrowser(finalUrl); return; }
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;border:0;";
  iframe.setAttribute("aria-hidden", "true");
  iframe.src = finalUrl;
  document.body.appendChild(iframe);
  window.setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 60_000);
}

export function triggerBackgroundVideoDownload(rawUrl: string, rawFileName: string): boolean {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) {
    toast.error("Download link is invalid");
    return false;
  }
  const fileName = buildSafeFileName(rawFileName);
  const proxiedUrls = buildVideoDownloadUrlCandidates(trimmedUrl, fileName);
  const finalUrl = proxiedUrls[0] || null;
  if (!finalUrl) {
    toast.error("Download service is unavailable");
    return false;
  }
  openDownloadLink(finalUrl, fileName);
  return true;
}

export function triggerBulkBackgroundDownloads(
  items: Array<{ url: string; fileName: string }>,
): number {
  if (!Array.isArray(items) || items.length === 0) return 0;

  const valid = items
    .map((it) => {
      const u = String(it?.url || "").trim();
      if (!u || !isHttpUrl(u)) return null;
      const fn = buildSafeFileName(it?.fileName || "video");
      const proxied = buildVideoDownloadUrlCandidates(u, fn)[0] || buildVideoDownloadUrl(u, fn);
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


