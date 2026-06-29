import { toast } from "sonner";
import { isInTelegramWebView, openExternalBrowser } from "@/lib/openExternal";
import { db, ref, onValue } from "@/lib/firebase";

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
try {
  if (typeof window !== "undefined") {
    onValue(ref(db, "settings/functionOverrides/video-download"), (snap) => {
      const v = snap.val() || {};
      overrideBaseUrl = String(v.customUrl || "").trim();
      overrideEnabled = v.enabled === true;
    });
  }
} catch {}

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || "";
const DEFAULT_DOWNLOAD_BASE = SUPABASE_URL ? `${String(SUPABASE_URL).replace(/\/+$/, "")}/functions/v1/video-download` : "";

const resolveBaseSync = (): string => {
  if (overrideEnabled && overrideBaseUrl) return overrideBaseUrl.replace(/\/+$/, "");
  return DEFAULT_DOWNLOAD_BASE;
};

export function buildVideoDownloadUrl(rawUrl: string, rawFileName: string): string | null {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) return null;
  if (isManagedVideoDownloadUrl(trimmedUrl)) return trimmedUrl;
  if (isManagedVideoProxyUrl(trimmedUrl)) {
    try {
      const inner = new URL(trimmedUrl).searchParams.get("url");
      if (inner) return buildVideoDownloadUrl(inner, rawFileName);
    } catch {}
  }
  const base = resolveBaseSync();
  if (!base) return null;
  const fileName = buildSafeFileName(rawFileName);
  return `${base}?filename=${encodeURIComponent(fileName)}&url=${encodeURIComponent(trimmedUrl)}`;
}

export function unwrapManagedVideoUrl(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (isManagedVideoDownloadUrl(trimmed) || isManagedVideoProxyUrl(trimmed)) {
    try {
      return new URL(trimmed).searchParams.get("url") || trimmed;
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
  // HTTP file hosts are often blocked as hidden mixed-content downloads. A new
  // tab keeps it as a user navigation/download, which browsers allow more often.
  if (/^http:\/\//i.test(finalUrl)) link.target = "_blank";
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
  const unwrapped = unwrapManagedVideoUrl(trimmedUrl);
  // On an HTTPS app, raw http:// downloads are mixed-content and get blocked.
  // Use the admin video-download function first; direct is only a last fallback.
  const preferDirect = false;
  const directUrl = buildDirectDownloadUrl(trimmedUrl);
  const proxiedUrl = buildVideoDownloadUrl(trimmedUrl, fileName);
  const finalUrl = preferDirect ? (directUrl || proxiedUrl) : (proxiedUrl || directUrl);
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
      const unwrapped = unwrapManagedVideoUrl(u);
      const preferDirect = false;
      const direct = buildDirectDownloadUrl(u);
      const proxied = buildVideoDownloadUrl(u, fn);
      const final = preferDirect ? (direct || proxied) : (proxied || direct);
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
