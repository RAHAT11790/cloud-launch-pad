import { toast } from "sonner";

import { isInTelegramWebView, openExternalBrowser } from "@/lib/openExternal";
import { SUPABASE_URL } from "@/lib/siteConfig";

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const buildSafeFileName = (rawName: string) => {
  const cleaned = String(rawName || "video")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withExt = /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
  return withExt || "video.mp4";
};

export function buildVideoDownloadUrl(rawUrl: string, rawFileName: string): string | null {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl) || !SUPABASE_URL) return null;

  const fileName = buildSafeFileName(rawFileName);
  return `${SUPABASE_URL}/functions/v1/video-proxy?download=1&filename=${encodeURIComponent(fileName)}&url=${encodeURIComponent(trimmedUrl)}`;
}

export function triggerBackgroundVideoDownload(rawUrl: string, rawFileName: string): boolean {
  const proxyUrl = buildVideoDownloadUrl(rawUrl, rawFileName);
  if (!proxyUrl) {
    toast.error("Download link is invalid");
    return false;
  }

  if (isInTelegramWebView()) {
    openExternalBrowser(proxyUrl);
    return true;
  }

  const fileName = buildSafeFileName(rawFileName);
  const link = document.createElement("a");
  link.href = proxyUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
}