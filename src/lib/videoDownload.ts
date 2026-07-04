import { toast } from "sonner";
import { isInTelegramWebView, openExternalBrowser } from "@/lib/openExternal";
import { db, ref, onValue } from "@/lib/firebase";
import { buildSelfHostedFunctionUrl, normalizeFunctionEndpointUrl } from "@/lib/edgeFunctionRouter";
import { fromOpaqueUrlToken, toOpaqueUrlToken } from "@/lib/anPlaybackProxy";

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const isManagedVideoDownloadUrl = (value: string) => /\/functions\/v1\/video-download\?/i.test(String(value || ""));
const isManagedVideoProxyUrl = (value: string) => /\/functions\/v1\/video-proxy\?/i.test(String(value || ""));

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

const buildDownloadProxyUrl = (base: string, rawUrl: string, rawFileName: string) => {
  const trimmedBase = String(base || "").trim().replace(/\/+$/, "");
  if (!trimmedBase) return "";
  const fileName = buildSafeFileName(rawFileName);
  return `${trimmedBase}?filename=${encodeURIComponent(fileName)}&src=${encodeURIComponent(toOpaqueUrlToken(rawUrl))}`;
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
    try {
      const parsed = new URL(trimmedUrl);
      const inner = parsed.searchParams.get("url") || fromOpaqueUrlToken(parsed.searchParams.get("src") || "");
      if (inner) return unique([trimmedUrl, ...buildVideoDownloadUrlCandidates(inner, rawFileName)]);
    } catch {}
    return [trimmedUrl];
  }

  const bases = overrideEnabled && overrideBaseUrl ? [overrideBaseUrl] : [];
  return unique(bases.map((base) => buildDownloadProxyUrl(base, trimmedUrl, rawFileName)));
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
    try {
      const parsed = new URL(trimmedUrl);
      const inner = parsed.searchParams.get("url") || fromOpaqueUrlToken(parsed.searchParams.get("src") || "");
      if (inner) return buildVideoProxyUrlCandidates(inner);
    } catch {}
  }
  const bases = playbackProxyEnabled && playbackProxyBaseUrl ? [playbackProxyBaseUrl] : [];
  return unique(bases.map((base) => buildPlaybackProxyUrl(base, trimmedUrl)));
}

export function buildVideoDownloadUrl(rawUrl: string, rawFileName: string): string | null {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) return null;
  if (isManagedVideoDownloadUrl(trimmedUrl)) return trimmedUrl;
  if (isManagedVideoProxyUrl(trimmedUrl)) {
    try {
      const parsed = new URL(trimmedUrl);
      const inner = parsed.searchParams.get("url") || fromOpaqueUrlToken(parsed.searchParams.get("src") || "");
      if (inner) return buildVideoDownloadUrl(inner, rawFileName);
    } catch {}
  }
  return buildVideoDownloadUrlCandidates(trimmedUrl, rawFileName)[0] || null;
}

export function unwrapManagedVideoUrl(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (isManagedVideoDownloadUrl(trimmed) || isManagedVideoProxyUrl(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.searchParams.get("url") || fromOpaqueUrlToken(parsed.searchParams.get("src") || "") || trimmed;
    } catch {
      return trimmed;
    }
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

function openDownloadViaIframe(finalUrl: string) {
  try {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = finalUrl;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch {}
    }, 10_000);
  } catch {
    const link = document.createElement("a");
    link.href = finalUrl;
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

export function triggerBackgroundVideoDownload(rawUrl: string, rawFileName: string): boolean {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) {
    toast.error("Download link is invalid");
    return false;
  }
  const fileName = buildSafeFileName(rawFileName);
  // HTTPS file hosts are most reliable when the browser downloads them directly
  // from the user's own IP/session. Only route http:// or already-proxied links
  // through the download proxy to avoid mixed-content blocks.
  const proxiedUrls = buildVideoDownloadUrlCandidates(trimmedUrl, fileName);
  const proxiedUrl = proxiedUrls[0] || null;
  const finalUrl = proxiedUrl;
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
      const final = proxied;
      return final ? { final, fn } : null;
    })
    .filter((x): x is { final: string; fn: string } => !!x);

  if (valid.length === 0) {
    toast.error("No downloadable links found");
    return 0;
  }

  const [head, ...rest] = valid;
  openDownloadLink(head.final, head.fn);

  rest.forEach((entry, idx) => {
    setTimeout(() => openDownloadViaIframe(entry.final), 80 * (idx + 1));
  });

  return valid.length;
}
