import { toast } from "sonner";

import { isInTelegramWebView, openExternalBrowser } from "@/lib/openExternal";
import { SUPABASE_URL } from "@/lib/siteConfig";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const buildSafeFileName = (rawName: string) => {
  const cleaned = String(rawName || "video")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withExt = /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
  return withExt || "video.mp4";
};

// Resolve the download proxy base URL — prefers admin-configured override
// (settings/functionOverrides/video-download.customUrl) and falls back to
// the project's default Supabase Edge Function URL.
async function resolveDownloadBase(): Promise<string> {
  try {
    const fromRouter = await getEdgeFunctionUrl("video-download");
    if (fromRouter) return fromRouter;
  } catch {}
  if (!SUPABASE_URL) return "";
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/video-download`;
}

export async function buildVideoDownloadUrl(rawUrl: string, rawFileName: string): Promise<string | null> {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) return null;
  const base = await resolveDownloadBase();
  if (!base) return null;
  const fileName = buildSafeFileName(rawFileName);
  return `${base}?filename=${encodeURIComponent(fileName)}&url=${encodeURIComponent(trimmedUrl)}`;
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
 * Route every download through the dedicated `video-download` edge function.
 * That function adds:
 *  - upstream retries (no more ERR_INVALID_RESPONSE in the browser)
 *  - clean Content-Disposition with the chosen filename
 *  - HTTP origin support on an HTTPS app (no mixed-content block)
 *  - JSON-formatted errors instead of raw broken bytes
 */
export function triggerBackgroundVideoDownload(rawUrl: string, rawFileName: string): boolean {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) {
    toast.error("Download link is invalid");
    return false;
  }
  const fileName = buildSafeFileName(rawFileName);
  // Resolve async, but kick off the download as soon as we have the URL.
  buildVideoDownloadUrl(trimmedUrl, fileName)
    .then((finalUrl) => {
      if (!finalUrl) {
        toast.error("Download service is unavailable");
        return;
      }
      openDownloadLink(finalUrl, fileName);
    })
    .catch(() => toast.error("Download service is unavailable"));
  return true;
}
