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

/**
 * Build the Supabase video-proxy URL. All downloads go through the proxy so
 * the server can set Content-Disposition with the custom filename the user
 * picked (anime + season + episode + quality), and so HTTP origins work on
 * the HTTPS app without mixed-content blocks.
 */
export function buildVideoDownloadUrl(rawUrl: string, rawFileName: string): string | null {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl) || !SUPABASE_URL) return null;

  const fileName = buildSafeFileName(rawFileName);
  return `${SUPABASE_URL}/functions/v1/video-proxy?download=1&filename=${encodeURIComponent(fileName)}&url=${encodeURIComponent(trimmedUrl)}`;
}

function openDownloadLink(finalUrl: string, fileName: string) {
  if (isInTelegramWebView()) { openExternalBrowser(finalUrl); return; }
  const link = document.createElement("a");
  link.href = finalUrl;
  link.rel = "noopener noreferrer";
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Always route downloads through the Supabase video-proxy. This guarantees:
 *  - Custom file name (anime - season - episode - quality.mp4) via Content-Disposition.
 *  - HTTP origins work on HTTPS app (no mixed-content block).
 *  - HTTPS origins that go dead (e.g. Render 502) never reach the user as
 *    a "This page isn't working" screen — the proxy handles upstream errors.
 */
export function triggerBackgroundVideoDownload(rawUrl: string, rawFileName: string): boolean {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) {
    toast.error("Download link is invalid");
    return false;
  }

  const fileName = buildSafeFileName(rawFileName);
  const proxyUrl = buildVideoDownloadUrl(trimmedUrl, fileName);
  if (!proxyUrl) {
    toast.error("Download service is unavailable");
    return false;
  }

  openDownloadLink(proxyUrl, fileName);
  return true;
}
