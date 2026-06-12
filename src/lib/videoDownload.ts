import { toast } from "sonner";

import { isInTelegramWebView, openExternalBrowser } from "@/lib/openExternal";
import { SUPABASE_URL } from "@/lib/siteConfig";

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);
const isHttpsUrl = (value: string) => /^https:\/\//i.test(value);

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

/**
 * Downloads always work — never gated by our proxy.
 *  - HTTPS sources: open the ORIGINAL link directly. The browser/CDN serves the file
 *    natively, so users never see proxy errors like ERR_INVALID_RESPONSE.
 *  - HTTP (mixed-content) sources: route through the Supabase proxy so the browser
 *    will accept the response on the HTTPS app.
 */
export function triggerBackgroundVideoDownload(rawUrl: string, rawFileName: string): boolean {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) {
    toast.error("Download link is invalid");
    return false;
  }

  const fileName = buildSafeFileName(rawFileName);
  const directUrl = isHttpsUrl(trimmedUrl) ? trimmedUrl : null;
  const proxyUrl = directUrl ? null : buildVideoDownloadUrl(trimmedUrl, fileName);
  const finalUrl = directUrl || proxyUrl;

  if (!finalUrl) {
    toast.error("Download link is invalid");
    return false;
  }

  if (isInTelegramWebView()) {
    openExternalBrowser(finalUrl);
    return true;
  }

  const link = document.createElement("a");
  link.href = finalUrl;
  link.rel = "noopener noreferrer";
  link.download = fileName;
  // For direct (cross-origin) HTTPS links, `download` is advisory; opening in a new
  // tab still triggers the browser's native save flow without surfacing proxy errors.
  if (directUrl) link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
}
