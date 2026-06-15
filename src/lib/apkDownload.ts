import { toast } from "sonner";

import { isInTelegramWebView, openExternalBrowser } from "@/lib/openExternal";
import { buildVideoDownloadUrl } from "@/lib/videoDownload";

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

/**
 * APK download proxy now reuses the hardened `video-download` edge function
 * instead of the old (removed) `apk-download` endpoint. The video-download
 * proxy already supports HTTP-origin files on HTTPS, retries, and proper
 * Content-Disposition — exactly what an APK needs.
 */
export function buildApkProxyUrl(rawUrl: string, fileName = "app.apk"): string | null {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed || !isHttpUrl(trimmed)) return null;
  const safeName = /\.apk$/i.test(fileName) ? fileName : `${fileName.replace(/\.[^.]+$/, "")}.apk`;
  return buildVideoDownloadUrl(trimmed, safeName);
}

export function triggerApkDownload(rawUrl: string, fileName?: string): boolean {
  const name = fileName || "app.apk";
  const proxyUrl = buildApkProxyUrl(rawUrl, name);

  if (!proxyUrl) {
    toast.error("Download link is invalid");
    return false;
  }

  if (isInTelegramWebView()) {
    openExternalBrowser(proxyUrl);
    return true;
  }

  const link = document.createElement("a");
  link.href = proxyUrl;
  link.rel = "noopener noreferrer";
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
}
